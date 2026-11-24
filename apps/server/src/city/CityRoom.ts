// Port Concord: the open city, one region server. Movement is server-checked as in matches, and each
// guardian is only sent the players and coin piles near them, so the city can be large without every client
// syncing everyone. Fights are server-decided: a client only says "punch", the server picks who it lands on.
import { randomBytes } from 'node:crypto';
import { StateView } from '@colyseus/schema';
import { ErrorCode, Room, ServerError, validate, type AuthContext, type Client } from '@colyseus/core';
import { CLOSE_CODES, MovePayloadSchema, NoPayloadSchema, SERVER_TICK_HZ, TICK_SECONDS, cryptoRandom, stepMovement, uniqueNickname, type RandomSource } from '@byzantine-council/shared';
import { credit, isCosmeticId } from '@byzantine-council/shared/economy';
import { dayFor } from '@byzantine-council/shared/progression';
import {
  CITY_MAP,
  CITY_MAX_PLAYERS,
  CITY_MESSAGES,
  CITY_SPAWNS,
  CityDrop,
  CityJoinSchema,
  CityPlayer,
  CityState,
  DROP_LIFETIME_MS,
  KNOCKOUT_MS,
  LOOSE_COINS_EVERY_MS,
  LOOSE_COINS_LIVE,
  LOOSE_COIN_MAX,
  LOOSE_COIN_MIN,
  MAX_DROPS,
  MAX_HEALTH,
  MAX_POCKET,
  PUNCH_COOLDOWN_MS,
  VAULT_DAILY_LIMIT,
  ROUGH_STREETS,
  SHIELD_MS,
  afterPunch,
  atVault,
  canPickUp,
  depositable,
  keepsInView,
  pickTarget,
  regenerate,
  takeFromPile,
  type DepositReason,
  type DepositResult,
  type Fighter,
  type PunchLine,
} from '@byzantine-council/shared/city';
import { EMOTE_GAP_MS, EmotePayloadSchema, type Emote } from '@byzantine-council/shared/hub';
import { VIEW_TAGS } from '@byzantine-council/shared/state';
import { ipKey } from '../clientIp.js';
import { InputQueue, type MoveInput } from '../inputQueue.js';
import { log } from '../logger.js';
import { roomPolicy } from '../policy.js';
import { profileIdFromCookieHeader } from '../profile/session.js';
import { loadProfile } from '../profile/store.js';
import { holdSeat } from '../scaling/index.js';

interface Auth {
  readonly nickname: string;
  readonly profileId: string | null;
}
type CityClient = Client<{ auth: Auth }>;

interface Sim {
  readonly client: CityClient;
  readonly view: StateView;
  readonly inputs: InputQueue;
  readonly profileId: string | null;
  // Session ids and coin piles this client is currently sent.
  readonly sees: Set<string>;
  readonly seesDrops: Set<string>;
  readonly home: { readonly x: number; readonly y: number };
  health: number;
  knockedOutUntil: number;
  shieldUntil: number;
  lastHitMs: number;
  lastPunchMs: number;
  depositing: boolean;
  lastActiveMs: number;
  lastEmoteMs: number;
  lastLookMs: number;
}

const IDLE_MS = 15 * 60_000;
const IDLE_CHECK_MS = 30_000;
// Who-sees-whom is refreshed five times a second; positions still sync every tick.
const INTEREST_EVERY_TICKS = 4;
// Leaving this soon after being hit still drops your pocket, so nobody escapes a fight by quitting.
const COMBAT_LOG_MS = 10_000;

interface Drop {
  readonly state: CityDrop;
  readonly expiresAt: number;
  readonly loose: boolean;
}

export class CityRoom extends Room<{ state: CityState; client: CityClient }> {
  override maxClients = CITY_MAX_PLAYERS;
  override state = new CityState();
  override maxMessagesPerSecond = 40;
  override seatReservationTimeout = 8;
  readonly #sims = new Map<string, Sim>();
  readonly #drops = new Map<string, Drop>();
  #nextDrop = 0;
  #lastLooseMs = 0;
  #tick = 0;
  // Swapped in tests for a fixed sequence.
  random: RandomSource = cryptoRandom;

  override messages = {
    move: validate(MovePayloadSchema, (client: CityClient, input: MoveInput) => {
      const sim = this.#sims.get(client.sessionId);
      if (sim === undefined) return;
      sim.lastActiveMs = Date.now();
      sim.inputs.push(input);
    }),
    emote: validate(EmotePayloadSchema, (client: CityClient, payload: { emote: Emote }) => {
      const sim = this.#sims.get(client.sessionId);
      const now = Date.now();
      if (sim === undefined || now - sim.lastEmoteMs < EMOTE_GAP_MS) return;
      sim.lastEmoteMs = now;
      sim.lastActiveMs = now;
      // Only the guardians who can see you see the emote.
      const line = { from: client.sessionId, emote: payload.emote };
      for (const other of this.#sims.values()) if (other.sees.has(client.sessionId)) other.client.send(CITY_MESSAGES.EMOTE, line);
    }),
    punch: validate(NoPayloadSchema, (client: CityClient) => {
      this.#punch(client.sessionId, Date.now());
    }),
    deposit: validate(NoPayloadSchema, (client: CityClient) => {
      void this.#deposit(client.sessionId);
    }),
    refreshLook: validate(NoPayloadSchema, (client: CityClient) => {
      const sim = this.#sims.get(client.sessionId);
      const now = Date.now();
      if (sim?.profileId == null || now - sim.lastLookMs < 10_000) return;
      sim.lastLookMs = now;
      void this.#wearLook(client.sessionId, sim.profileId);
    }),
  };

  static override async onAuth(_token: string, options: unknown, context: AuthContext): Promise<true> {
    const key = ipKey(context.ip);
    const policy = roomPolicy();
    if (!(await policy.matchmake.take(key)) || !(await policy.reservations.take(key))) {
      throw new ServerError(CLOSE_CODES.RATE_LIMITED, 'Too many attempts. Wait a moment and try again.');
    }
    if (!CityJoinSchema.safeParse(options).success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname.');
    return true;
  }

  override onCreate(): void {
    this.setFixedTimestep(() => {
      this.#step();
    }, SERVER_TICK_HZ);
    this.patchRate = null;
    this.clock.setInterval(() => {
      const cutoff = Date.now() - IDLE_MS;
      for (const sim of this.#sims.values()) if (sim.lastActiveMs < cutoff) sim.client.leave(CLOSE_CODES.IDLE, 'Removed for being idle too long.');
    }, IDLE_CHECK_MS);
  }

  override async onAuth(client: CityClient, options: unknown, context: AuthContext): Promise<Auth> {
    const parsed = CityJoinSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname.');
    if (!(await holdSeat(roomPolicy().ipSlots, ipKey(context.ip), client.ref))) {
      throw new ServerError(CLOSE_CODES.TOO_MANY_CONNECTIONS, 'Too many players from your network.');
    }
    const profiles = roomPolicy().profiles;
    const profileId = profiles === null ? null : profileIdFromCookieHeader(profiles.keys, context.headers.get('cookie'), Date.now());
    return { nickname: parsed.data.nickname, profileId };
  }

  override onJoin(client: CityClient): void {
    const auth = client.auth;
    if (auth === undefined) throw new ServerError(ErrorCode.APPLICATION_ERROR, 'Not authorised.');
    const taken = new Set(Array.from(this.state.players.values(), (p) => p.seat));
    const seat = Array.from({ length: CITY_MAX_PLAYERS }, (_, i) => i).find((i) => !taken.has(i)) ?? 0;
    const spawn = CITY_SPAWNS[seat % CITY_SPAWNS.length] ?? { x: 73, y: 63 };
    const names = Array.from(this.state.players.values(), (p) => p.name);
    // Colours cycle through the ten guardian palettes.
    const player = new CityPlayer({ name: uniqueNickname(auth.nickname, names), seat: seat % 10, x: spawn.x, y: spawn.y, health: MAX_HEALTH, shielded: true });
    player.ack = 0;
    player.pocket = 0;
    const now = Date.now();
    this.state.players.set(client.sessionId, player);
    const view = new StateView();
    view.add(player);
    view.add(player, VIEW_TAGS.OWNER);
    client.view = view;
    this.#sims.set(client.sessionId, {
      client,
      view,
      inputs: new InputQueue(),
      profileId: auth.profileId,
      sees: new Set([client.sessionId]),
      seesDrops: new Set(),
      home: spawn,
      health: MAX_HEALTH,
      knockedOutUntil: 0,
      shieldUntil: now + SHIELD_MS,
      lastHitMs: 0,
      lastPunchMs: 0,
      depositing: false,
      lastActiveMs: now,
      lastEmoteMs: 0,
      lastLookMs: 0,
    });
    this.state.population = this.state.players.size;
    this.#refreshInterest();
    if (auth.profileId !== null) void this.#wearLook(client.sessionId, auth.profileId);
  }

  override onLeave(client: CityClient): void {
    const player = this.state.players.get(client.sessionId);
    const leaving = this.#sims.get(client.sessionId);
    if (player !== undefined && leaving !== undefined && Date.now() - leaving.lastHitMs < COMBAT_LOG_MS) this.#dropPocket(player, Date.now());
    for (const sim of this.#sims.values()) {
      if (player !== undefined && sim.sees.delete(client.sessionId) && sim.client !== client) sim.view.remove(player);
    }
    this.state.players.delete(client.sessionId);
    this.#sims.delete(client.sessionId);
    this.state.population = this.state.players.size;
    client.view?.dispose();
  }

  #step(): void {
    const now = performance.now();
    const wall = Date.now();
    for (const [id, sim] of this.#sims) {
      const player = this.state.players.get(id);
      if (player === undefined) continue;
      this.#recover(player, sim, wall);
      const down = sim.knockedOutUntil > wall;
      sim.inputs.drain(now, (input) => {
        if (down) return;
        const next = stepMovement({ x: player.x, y: player.y }, { x: input.dx, y: input.dy }, TICK_SECONDS, CITY_MAP);
        if (next.x !== player.x) player.x = next.x;
        if (next.y !== player.y) player.y = next.y;
      });
      if (player.ack !== sim.inputs.ack) player.ack = sim.inputs.ack;
      if (!down) this.#collect(player);
    }
    this.#tidyDrops(wall);
    this.#tick = (this.#tick + 1) % INTEREST_EVERY_TICKS;
    if (this.#tick === 0) this.#refreshInterest();
    this.broadcastPatch();
  }

  // Adds the players that came near each guardian to their view, and drops the ones that went far away.
  #refreshInterest(): void {
    for (const [id, sim] of this.#sims) {
      const me = this.state.players.get(id);
      if (me === undefined) continue;
      for (const [otherId, other] of this.state.players) {
        if (otherId === id) continue;
        const now = sim.sees.has(otherId);
        const next = keepsInView(me, other, now);
        if (next === now) continue;
        if (next) {
          sim.view.add(other);
          sim.sees.add(otherId);
        } else {
          sim.view.remove(other);
          sim.sees.delete(otherId);
        }
      }
      for (const [dropId, drop] of this.#drops) {
        const now = sim.seesDrops.has(dropId);
        const next = keepsInView(me, drop.state, now);
        if (next === now) continue;
        if (next) {
          sim.view.add(drop.state);
          sim.seesDrops.add(dropId);
        } else {
          sim.view.remove(drop.state);
          sim.seesDrops.delete(dropId);
        }
      }
    }
  }

  #fighter(player: CityPlayer, sim: Sim): Fighter {
    return { x: player.x, y: player.y, health: sim.health, knockedOutUntil: sim.knockedOutUntil, shieldUntil: sim.shieldUntil };
  }

  // One swing per cooldown. The server picks the nearest guardian it can legally hit, or records a miss.
  #punch(sessionId: string, now: number): void {
    const sim = this.#sims.get(sessionId);
    const me = this.state.players.get(sessionId);
    if (sim === undefined || me === undefined || now - sim.lastPunchMs < PUNCH_COOLDOWN_MS || sim.knockedOutUntil > now) return;
    sim.lastPunchMs = now;
    sim.lastActiveMs = now;
    const attacker = this.#fighter(me, sim);
    const nearby: (readonly [string, Fighter])[] = [];
    for (const id of sim.sees) {
      const other = this.state.players.get(id);
      const otherSim = this.#sims.get(id);
      if (id !== sessionId && other !== undefined && otherSim !== undefined) nearby.push([id, this.#fighter(other, otherSim)]);
    }
    const targetId = pickTarget(attacker, nearby, now);
    const line: PunchLine = { from: sessionId, to: targetId, knockedOut: false };
    if (targetId !== null) {
      const target = this.state.players.get(targetId);
      const targetSim = this.#sims.get(targetId);
      if (target !== undefined && targetSim !== undefined) {
        sim.shieldUntil = 0;
        me.shielded = false;
        const hit = afterPunch(targetSim.health);
        targetSim.health = hit.health;
        targetSim.lastHitMs = now;
        target.health = Math.round(hit.health);
        if (hit.knockedOut) {
          line.knockedOut = true;
          targetSim.knockedOutUntil = now + KNOCKOUT_MS;
          target.down = true;
          this.#dropPocket(target, now);
        }
      }
    }
    for (const other of this.#sims.values()) if (other.sees.has(sessionId)) other.client.send(CITY_MESSAGES.PUNCH, line);
  }

  // Wakes knocked-out guardians at home with full health and a shield, regenerates health, ends shields.
  #recover(player: CityPlayer, sim: Sim, now: number): void {
    if (player.down && sim.knockedOutUntil <= now) {
      player.down = false;
      player.x = sim.home.x;
      player.y = sim.home.y;
      sim.health = MAX_HEALTH;
      sim.shieldUntil = now + SHIELD_MS;
    }
    if (!player.down) sim.health = regenerate(sim.health, sim.lastHitMs, now, TICK_SECONDS);
    const shown = Math.round(sim.health);
    if (player.health !== shown) player.health = shown;
    const shielded = sim.shieldUntil > now;
    if (player.shielded !== shielded) player.shielded = shielded;
  }

  #dropPocket(player: CityPlayer, now: number): void {
    const amount = player.pocket ?? 0;
    if (amount <= 0) return;
    player.pocket = 0;
    this.#addDrop(player.x, player.y, amount, now, false);
  }

  // At the cap the oldest pile is swept away, so the room's memory stays bounded.
  #addDrop(x: number, y: number, amount: number, now: number, loose: boolean): void {
    if (this.#drops.size >= MAX_DROPS) {
      const oldest = this.#drops.keys().next().value;
      if (oldest !== undefined) this.#removeDrop(oldest);
    }
    const id = `d${String(this.#nextDrop++)}`;
    const state = new CityDrop({ x, y, amount });
    this.#drops.set(id, { state, expiresAt: now + DROP_LIFETIME_MS, loose });
    this.state.drops.set(id, state);
  }

  #removeDrop(id: string): void {
    const drop = this.#drops.get(id);
    if (drop === undefined) return;
    for (const sim of this.#sims.values()) if (sim.seesDrops.delete(id)) sim.view.remove(drop.state);
    this.#drops.delete(id);
    this.state.drops.delete(id);
  }

  #collect(player: CityPlayer): void {
    for (const [id, drop] of this.#drops) {
      if (!canPickUp(player, drop.state)) continue;
      const took = takeFromPile(player.pocket ?? 0, drop.state.amount);
      if (took.left === drop.state.amount) continue;
      player.pocket = took.pocket;
      if (took.left === 0) this.#removeDrop(id);
      else drop.state.amount = took.left;
    }
  }

  // Expires old piles and scatters new loose coins on the rough streets.
  #tidyDrops(now: number): void {
    for (const [id, drop] of this.#drops) if (drop.expiresAt <= now) this.#removeDrop(id);
    if (now - this.#lastLooseMs < LOOSE_COINS_EVERY_MS || ROUGH_STREETS.length === 0) return;
    this.#lastLooseMs = now;
    let loose = 0;
    for (const drop of this.#drops.values()) if (drop.loose) loose++;
    if (loose >= LOOSE_COINS_LIVE) return;
    const spot = ROUGH_STREETS[this.random.int(ROUGH_STREETS.length)];
    if (spot !== undefined) this.#addDrop(spot.x, spot.y, LOOSE_COIN_MIN + this.random.int(LOOSE_COIN_MAX - LOOSE_COIN_MIN + 1), now, true);
  }

  // Carries the pocket into the wallet. The pocket is emptied first so the same coins can never be spent twice,
  // then whatever today's allowance or the wallet did not take is handed back.
  async #deposit(sessionId: string): Promise<void> {
    const sim = this.#sims.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (sim === undefined || player === undefined) return;
    sim.lastActiveMs = Date.now();
    const answer = (reason: DepositReason, paid: number, kept: number, today: number): void => {
      const result: DepositResult = { paid, kept, reason, today, limit: VAULT_DAILY_LIMIT };
      sim.client.send(CITY_MESSAGES.VAULT, result);
    };
    const pocket = player.pocket ?? 0;
    const profiles = roomPolicy().profiles;
    const refused: DepositReason | null = sim.depositing
      ? 'busy'
      : player.down || !atVault(player)
        ? 'notAtVault'
        : pocket <= 0
          ? 'empty'
          : profiles === null || sim.profileId === null
            ? 'noProfile'
            : null;
    if (refused !== null || profiles === null || sim.profileId === null) {
      answer(refused ?? 'noProfile', 0, pocket, 0);
      return;
    }
    sim.depositing = true;
    player.pocket = 0;
    let paid = 0;
    let today = 0;
    let reason: DepositReason = 'error';
    try {
      const now = Date.now();
      const out = await profiles.store.change<{ paid: number; today: number; reason: DepositReason }>(sim.profileId, `vault:${randomBytes(12).toString('base64url')}`, now, (data) => {
        const day = dayFor(data.progress.day, now);
        const before = day.vault ?? 0;
        const amount = depositable(pocket, before);
        if (amount === 0) return { data, result: { paid: 0, today: before, reason: 'dailyLimit' } };
        const fee = credit(data.wallet, amount);
        if (!fee.ok) return { data, result: { paid: 0, today: before, reason: 'walletFull' } };
        const progress = { ...data.progress, day: { ...day, vault: before + amount } };
        return { data: { ...data, wallet: fee.value.wallet, progress }, result: { paid: amount, today: before + amount, reason: 'paid' } };
      });
      if (out.ok) ({ paid, today, reason } = out.result);
    } catch (error) {
      log.error('vault deposit failed', error, { roomId: this.roomId });
    } finally {
      sim.depositing = false;
    }
    const back = pocket - paid;
    const still = this.state.players.get(sessionId);
    if (still === undefined) return;
    const fits = Math.min(back, MAX_POCKET - (still.pocket ?? 0));
    still.pocket = (still.pocket ?? 0) + fits;
    if (back > fits) this.#addDrop(still.x, still.y, back - fits, Date.now(), false);
    answer(reason, paid, back, today);
  }

  // For tests: end a guardian's spawn protection early.
  shieldOff(sessionId: string): void {
    const sim = this.#sims.get(sessionId);
    if (sim !== undefined) sim.shieldUntil = 0;
  }

  // For tests: put a pile on the ground.
  dropCoins(x: number, y: number, amount: number): void {
    this.#addDrop(x, y, amount, Date.now(), false);
  }

  // Only the ids a client is sent: for tests and the HUD's "nearby" count.
  seenBy(sessionId: string): readonly string[] {
    return [...(this.#sims.get(sessionId)?.sees ?? [])];
  }

  async #wearLook(sessionId: string, profileId: string): Promise<void> {
    const profiles = roomPolicy().profiles;
    if (profiles === null) return;
    try {
      const look = (await loadProfile(profiles.store, profileId, Date.now())).look;
      const player = this.state.players.get(sessionId);
      if (player === undefined) return;
      player.hat = look.hat !== null && isCosmeticId(look.hat) ? look.hat : '';
      player.shades = look.shades !== null && isCosmeticId(look.shades) ? look.shades : '';
      player.outfit = isCosmeticId(look.outfit) ? look.outfit : '';
    } catch (error) {
      log.warn('city look not loaded', { roomId: this.roomId, error: error instanceof Error ? error.name : 'unknown' });
    }
  }
}
