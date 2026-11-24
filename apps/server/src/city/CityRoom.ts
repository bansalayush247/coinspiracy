// Port Concord: the open city, one region server. Movement is server-checked as in matches, and each
// guardian is only sent the players and coin piles near them, so the city can be large without every client
// syncing everyone. Fights are server-decided: a client only says "punch", the server picks who it lands on.
import { randomBytes } from 'node:crypto';
import { StateView } from '@colyseus/schema';
import { ErrorCode, Room, ServerError, validate, type AuthContext, type Client } from '@colyseus/core';
import { CLOSE_CODES, MovePayloadSchema, NoPayloadSchema, SERVER_TICK_HZ, TICK_SECONDS, cryptoRandom, stepMovement, uniqueNickname, type RandomSource } from '@byzantine-council/shared';
import { findPath } from '@byzantine-council/shared/pathfinding';
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
  BULLY_POCKET,
  BULLY_RANGE,
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
  PUNCH_DAMAGE,
  PUNCH_RANGE,
  ROUGH_DISTRICTS,
  TOUGHS_PER_DISTRICT,
  TOUGH_ANGRY_MS,
  TOUGH_CHASE,
  TOUGH_CHASE_SPEED,
  TOUGH_COOLDOWN_MS,
  TOUGH_DAMAGE,
  TOUGH_NAMES,
  TOUGH_PURSE_MAX,
  TOUGH_PURSE_MIN,
  TOUGH_RESPAWN_MS,
  TOUGH_WANDER_SPEED,
  VAULT_DAILY_LIMIT,
  ROUGH_STREETS,
  SHIELD_MS,
  SIGHT_GRACE_MS,
  afterPunch,
  atVault,
  canHit,
  canPickUp,
  depositable,
  districtAt,
  inSight,
  isRough,
  keepsInView,
  pickTarget,
  regenerate,
  takeFromPile,
  type DepositReason,
  type DistrictId,
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

interface FightState {
  health: number;
  knockedOutUntil: number;
  shieldUntil: number;
  lastHitMs: number;
  lastPunchMs: number;
}

interface Tough extends FightState {
  readonly district: DistrictId;
  readonly n: number;
  readonly home: { readonly x: number; readonly y: number };
  readonly bully: boolean;
  foe: string | null;
  angryUntil: number;
  path: { x: number; y: number }[];
  repathAt: number;
  waitUntil: number;
}

// Rough street tiles by district, where each district's toughs live and wander.
const ROUGH_BY_DISTRICT = new Map<DistrictId, { x: number; y: number }[]>();
for (const p of ROUGH_STREETS) {
  const d = districtAt(p)?.id;
  if (d !== undefined) ROUGH_BY_DISTRICT.set(d, [...(ROUGH_BY_DISTRICT.get(d) ?? []), p]);
}

interface Sim {
  readonly client: CityClient;
  readonly view: StateView;
  readonly inputs: InputQueue;
  readonly profileId: string | null;
  // Session ids and coin piles this client is currently sent.
  readonly sees: Set<string>;
  readonly seesDrops: Set<string>;
  // When each player or pile was last in this guardian's line of sight.
  readonly lastSeen: Map<string, number>;
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
  readonly #toughs = new Map<string, Tough>();
  #nextTough = 0;
  #toughsOn = true;
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
    let n = 0;
    for (const district of ROUGH_DISTRICTS) for (let i = 0; i < TOUGHS_PER_DISTRICT; i++) this.#spawnTough(district, n++);
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
      lastSeen: new Map(),
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
    this.state.population = this.#sims.size;
    this.#refreshInterest();
    if (auth.profileId !== null) void this.#wearLook(client.sessionId, auth.profileId);
  }

  override onLeave(client: CityClient): void {
    const player = this.state.players.get(client.sessionId);
    const leaving = this.#sims.get(client.sessionId);
    if (player !== undefined && leaving !== undefined && Date.now() - leaving.lastHitMs < COMBAT_LOG_MS) this.#dropPocket(player, Date.now());
    for (const sim of this.#sims.values()) {
      if (player !== undefined && sim.sees.delete(client.sessionId) && sim.client !== client) sim.view.remove(player);
      sim.lastSeen.delete(client.sessionId);
    }
    this.state.players.delete(client.sessionId);
    this.#sims.delete(client.sessionId);
    this.state.population = this.#sims.size;
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
    for (const [id, t] of this.#toughs) this.#brawl(id, t, wall);
    this.#tidyDrops(wall);
    this.#tick = (this.#tick + 1) % INTEREST_EVERY_TICKS;
    if (this.#tick === 0) this.#refreshInterest();
    this.broadcastPatch();
  }

  // Adds what each guardian can see to their view: near enough, and not behind a building. The rest is never sent.
  #refreshInterest(): void {
    const wall = Date.now();
    const visible = (sim: Sim, me: CityPlayer, key: string, at: { x: number; y: number }, now: boolean): boolean => {
      if (!keepsInView(me, at, now)) return false;
      if (inSight(me, at)) {
        sim.lastSeen.set(key, wall);
        return true;
      }
      return now && wall - (sim.lastSeen.get(key) ?? 0) < SIGHT_GRACE_MS;
    };
    for (const [id, sim] of this.#sims) {
      const me = this.state.players.get(id);
      if (me === undefined) continue;
      for (const [otherId, other] of this.state.players) {
        if (otherId === id) continue;
        const now = sim.sees.has(otherId);
        const next = visible(sim, me, otherId, other, now);
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
        const next = visible(sim, me, dropId, drop.state, now);
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

  #fighter(body: CityPlayer, f: FightState): Fighter {
    return { x: body.x, y: body.y, health: f.health, knockedOutUntil: f.knockedOutUntil, shieldUntil: f.shieldUntil };
  }

  // A guardian or a street tough: whoever can be hit.
  #fight(id: string): FightState | undefined {
    return this.#sims.get(id) ?? this.#toughs.get(id);
  }

  // One swing per cooldown. The server picks the nearest guardian or tough it can legally hit, or records a miss.
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
      const f = this.#fight(id);
      if (id !== sessionId && other !== undefined && f !== undefined) nearby.push([id, this.#fighter(other, f)]);
    }
    const targetId = pickTarget(attacker, nearby, now);
    this.#swing(sessionId, me, sim, targetId, PUNCH_DAMAGE, now);
  }

  // Lands (or misses) a punch and shows it to everyone who can see the attacker.
  #swing(attackerId: string, attacker: CityPlayer, f: FightState, targetId: string | null, damage: number, now: number): void {
    const line: PunchLine = { from: attackerId, to: targetId, knockedOut: false };
    const target = targetId === null ? undefined : this.state.players.get(targetId);
    const tf = targetId === null ? undefined : this.#fight(targetId);
    if (targetId !== null && target !== undefined && tf !== undefined) {
      f.shieldUntil = 0;
      attacker.shielded = false;
      const hit = afterPunch(tf.health, damage);
      tf.health = hit.health;
      tf.lastHitMs = now;
      target.health = Math.round(hit.health);
      const tough = this.#toughs.get(targetId);
      if (tough !== undefined && this.#sims.has(attackerId)) {
        tough.foe = attackerId;
        tough.angryUntil = now + TOUGH_ANGRY_MS;
      }
      if (hit.knockedOut) {
        line.knockedOut = true;
        tf.knockedOutUntil = now + KNOCKOUT_MS;
        target.down = true;
        if (tough !== undefined) this.#addDrop(target.x, target.y, TOUGH_PURSE_MIN + this.random.int(TOUGH_PURSE_MAX - TOUGH_PURSE_MIN + 1), now, false);
        else this.#dropPocket(target, now);
      }
    }
    for (const other of this.#sims.values()) if (other.sees.has(attackerId)) other.client.send(CITY_MESSAGES.PUNCH, line);
  }

  #spawnTough(district: DistrictId, n: number): void {
    if (!this.#toughsOn) return;
    const streets = ROUGH_BY_DISTRICT.get(district) ?? [];
    const home = streets[this.random.int(streets.length)];
    if (home === undefined) return;
    const id = `tough${String(this.#nextTough++)}`;
    const body = new CityPlayer({ name: TOUGH_NAMES[n % TOUGH_NAMES.length] ?? 'Tough', seat: 8 + (n % 2), x: home.x, y: home.y, health: MAX_HEALTH, npc: true });
    this.state.players.set(id, body);
    this.#toughs.set(id, {
      district, n, home, bully: n % 3 === 2, health: MAX_HEALTH, knockedOutUntil: 0, shieldUntil: 0, lastHitMs: 0, lastPunchMs: 0,
      foe: null, angryUntil: 0, path: [], repathAt: 0, waitUntil: 0,
    });
  }

  // Takes a tough off the street after a knockout; another turns up in the same district later.
  #retire(id: string): void {
    const tough = this.#toughs.get(id);
    const body = this.state.players.get(id);
    if (tough === undefined || body === undefined) return;
    for (const sim of this.#sims.values()) {
      if (sim.sees.delete(id)) sim.view.remove(body);
      sim.lastSeen.delete(id);
    }
    this.state.players.delete(id);
    this.#toughs.delete(id);
    this.clock.setTimeout(() => {
      this.#spawnTough(tough.district, tough.n);
    }, TOUGH_RESPAWN_MS);
  }

  // Each tick a tough heals, picks or drops a fight, swings when in reach, and otherwise walks: after a foe, or about.
  #brawl(id: string, t: Tough, now: number): void {
    const body = this.state.players.get(id);
    if (body === undefined) return;
    if (body.down) {
      if (t.knockedOutUntil <= now) this.#retire(id);
      return;
    }
    t.health = regenerate(t.health, t.lastHitMs, now, TICK_SECONDS);
    const shown = Math.round(t.health);
    if (body.health !== shown) body.health = shown;
    const reach = (p: CityPlayer): number => Math.hypot(p.x - body.x, p.y - body.y);
    if (t.foe !== null) {
      const foe = this.state.players.get(t.foe);
      const fs = this.#sims.get(t.foe);
      if (foe === undefined || fs === undefined || now > t.angryUntil || fs.knockedOutUntil > now || !isRough(foe) || reach(foe) > TOUGH_CHASE) t.foe = null;
    }
    if (t.foe === null && t.bully) {
      for (const [pid, sim] of this.#sims) {
        const p = this.state.players.get(pid);
        if (p === undefined || (p.pocket ?? 0) < BULLY_POCKET || reach(p) > BULLY_RANGE || sim.shieldUntil > now || sim.knockedOutUntil > now || !isRough(p) || !inSight(body, p)) continue;
        t.foe = pid;
        t.angryUntil = now + TOUGH_ANGRY_MS;
        break;
      }
    }
    const foe = t.foe === null ? undefined : this.state.players.get(t.foe);
    const fs = t.foe === null ? undefined : this.#sims.get(t.foe);
    if (t.foe !== null && foe !== undefined && fs !== undefined) {
      if (reach(foe) <= PUNCH_RANGE * 0.85) {
        t.path = [];
        if (now - t.lastPunchMs >= TOUGH_COOLDOWN_MS) {
          t.lastPunchMs = now;
          this.#swing(id, body, t, canHit(this.#fighter(body, t), this.#fighter(foe, fs), now) ? t.foe : null, TOUGH_DAMAGE, now);
        }
        return;
      }
      if (now >= t.repathAt) {
        t.repathAt = now + 500;
        const path = findPath(CITY_MAP, body, foe);
        t.path = path.ok ? path.value : [];
      }
      this.#walk(body, t, TOUGH_CHASE_SPEED);
      return;
    }
    if (t.path.length === 0) {
      if (now < t.waitUntil) return;
      const streets = ROUGH_BY_DISTRICT.get(t.district) ?? [];
      const goal = streets[this.random.int(streets.length)];
      if (goal !== undefined && Math.hypot(goal.x - t.home.x, goal.y - t.home.y) <= 8) {
        const path = findPath(CITY_MAP, body, goal);
        t.path = path.ok ? path.value : [];
      }
      t.waitUntil = now + 2_000 + this.random.int(3_000);
      return;
    }
    this.#walk(body, t, TOUGH_WANDER_SPEED);
  }

  #walk(body: CityPlayer, t: Tough, speed: number): void {
    const next = t.path[0];
    if (next === undefined) return;
    const dx = next.x - body.x;
    const dy = next.y - body.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.15) {
      t.path.shift();
      return;
    }
    const moved = stepMovement({ x: body.x, y: body.y }, { x: (dx / dist) * speed, y: (dy / dist) * speed }, TICK_SECONDS, CITY_MAP);
    if (!isRough(moved)) {
      t.path = [];
      return;
    }
    body.x = moved.x;
    body.y = moved.y;
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
    for (const sim of this.#sims.values()) {
      if (sim.seesDrops.delete(id)) sim.view.remove(drop.state);
      sim.lastSeen.delete(id);
    }
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

  // For tests: clear the street toughs away and keep them away.
  toughsOff(): void {
    this.#toughsOn = false;
    for (const id of [...this.#toughs.keys()]) {
      const body = this.state.players.get(id);
      for (const sim of this.#sims.values()) if (body !== undefined && sim.sees.delete(id)) sim.view.remove(body);
      this.state.players.delete(id);
      this.#toughs.delete(id);
    }
  }

  // For tests: the street toughs and where they stand.
  toughs(): { id: string; x: number; y: number; bully: boolean }[] {
    return [...this.#toughs].flatMap(([id, t]) => {
      const body = this.state.players.get(id);
      return body === undefined ? [] : [{ id, x: body.x, y: body.y, bully: t.bully }];
    });
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
