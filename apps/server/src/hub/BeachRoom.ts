// Beach Town: a public free-roam hub. Movement is server-checked like in matches; courier jobs pay
// play sats once per job, only after a real walk, and at most COURIER_DAILY_LIMIT times a day.
import { randomBytes } from 'node:crypto';
import { StateView } from '@colyseus/schema';
import { ErrorCode, Room, ServerError, validate, type AuthContext, type Client } from '@colyseus/core';
import { CLOSE_CODES, MovePayloadSchema, NoPayloadSchema, SERVER_TICK_HZ, TICK_SECONDS, cryptoRandom, stepMovement, uniqueNickname } from '@byzantine-council/shared';
import { credit, type ShopId } from '@byzantine-council/shared/economy';
import { LOOK_GAP_MS, dress } from './look.js';
import {
  BEACH_MAP,
  BEACH_MAX_PLAYERS,
  BEACH_MESSAGES,
  BEACH_SPAWNS,
  BeachJoinSchema,
  COURIER_DAILY_LIMIT,
  HubPlayer,
  HubState,
  EMOTE_GAP_MS,
  JUMP_GAP_MS,
  EmotePayloadSchema,
  TakeJobPayloadSchema,
  type Emote,
  atShop,
  courierReward,
  minDeliveryMs,
  pickDestination,
  type CourierDone,
  type CourierJob,
  type CourierRefused,
} from '@byzantine-council/shared/hub';
import { applyCourierDelivery, dayFor, islandOpenFor } from '@byzantine-council/shared/progression';
import { ferryArrival } from '@byzantine-council/shared/city';
import { VIEW_TAGS } from '@byzantine-council/shared/state';
import { ipKey } from '../clientIp.js';
import { InputQueue, type MoveInput } from '../inputQueue.js';
import { log } from '../logger.js';
import { roomPolicy } from '../policy.js';
import { profileIdFromCookieHeader } from '../profile/session.js';
import { loadProfile } from '../profile/store.js';
import { pay } from '../profile/rewards.js';
import { holdSeat } from '../scaling/index.js';

interface Auth {
  readonly nickname: string;
  readonly profileId: string | null;
  readonly byFerry: boolean;
}
type BeachClient = Client<{ auth: Auth }>;

interface Job extends CourierJob {
  readonly takenAt: number;
}

interface Sim {
  readonly inputs: InputQueue;
  readonly profileId: string | null;
  job: Job | null;
  lastActiveMs: number;
  lastEmoteMs: number;
  lastJumpMs: number;
  lastLookMs: number;
  lookQueued: boolean;
}

const IDLE_MS = 15 * 60_000;
const IDLE_CHECK_MS = 30_000;

export class BeachRoom extends Room<{ state: HubState; client: BeachClient }> {
  override maxClients = BEACH_MAX_PLAYERS;
  override state = new HubState();
  override maxMessagesPerSecond = 40;
  override seatReservationTimeout = 8;
  readonly #sims = new Map<string, Sim>();

  override messages = {
    move: validate(MovePayloadSchema, (client: BeachClient, input: MoveInput) => {
      const sim = this.#sims.get(client.sessionId);
      if (sim === undefined) return;
      sim.lastActiveMs = Date.now();
      sim.inputs.push(input);
    }),
    takeJob: validate(TakeJobPayloadSchema, (client: BeachClient, payload: { shop: ShopId }) => {
      this.#takeJob(client, payload.shop);
    }),
    deliver: validate(NoPayloadSchema, (client: BeachClient) => {
      void this.#deliver(client);
    }),
    emote: validate(EmotePayloadSchema, (client: BeachClient, payload: { emote: Emote }) => {
      const sim = this.#sims.get(client.sessionId);
      const now = Date.now();
      // Paced per guardian, so nobody can flood the town.
      if (sim === undefined || now - sim.lastEmoteMs < EMOTE_GAP_MS) return;
      sim.lastEmoteMs = now;
      sim.lastActiveMs = now;
      this.broadcast(BEACH_MESSAGES.EMOTE, { from: client.sessionId, emote: payload.emote });
    }),
    // A jump, only for show: paced, and shown to everyone else in town.
    jump: validate(NoPayloadSchema, (client: BeachClient) => {
      const sim = this.#sims.get(client.sessionId);
      const now = Date.now();
      if (sim === undefined || now - sim.lastJumpMs < JUMP_GAP_MS) return;
      sim.lastJumpMs = now;
      sim.lastActiveMs = now;
      this.broadcast(BEACH_MESSAGES.JUMP, { from: client.sessionId }, { except: client });
    }),
    // After a wardrobe change: show the new look to the town, at most every ten seconds (it reads the profile store).
    refreshLook: validate(NoPayloadSchema, (client: BeachClient) => {
      const sim = this.#sims.get(client.sessionId);
      const now = Date.now();
      const profileId = sim?.profileId;
      if (sim === undefined || profileId == null || sim.lookQueued) return;
      sim.lookQueued = true;
      this.clock.setTimeout(() => {
        sim.lookQueued = false;
        sim.lastLookMs = Date.now();
        void this.#wearLook(client.sessionId, profileId);
      }, Math.max(0, sim.lastLookMs + LOOK_GAP_MS - now));
    }),
    dropJob: validate(NoPayloadSchema, (client: BeachClient) => {
      const sim = this.#sims.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (sim === undefined || player === undefined) return;
      sim.job = null;
      player.carrying = false;
    }),
  };

  static override async onAuth(_token: string, options: unknown, context: AuthContext): Promise<true> {
    const key = ipKey(context.ip);
    const policy = roomPolicy();
    if (!(await policy.matchmake.take(key)) || !(await policy.reservations.take(key))) {
      throw new ServerError(CLOSE_CODES.RATE_LIMITED, 'Too many attempts. Wait a moment and try again.');
    }
    if (!BeachJoinSchema.safeParse(options).success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname.');
    return true;
  }

  override onCreate(): void {
    this.setFixedTimestep(() => {
      this.#step();
    }, SERVER_TICK_HZ);
    this.patchRate = null;
    this.clock.setInterval(() => {
      const cutoff = Date.now() - IDLE_MS;
      for (const client of this.clients) {
        const sim = this.#sims.get(client.sessionId);
        if (sim !== undefined && sim.lastActiveMs < cutoff) client.leave(CLOSE_CODES.IDLE, 'Removed for being idle too long.');
      }
    }, IDLE_CHECK_MS);
  }

  override async onAuth(client: BeachClient, options: unknown, context: AuthContext): Promise<Auth> {
    const parsed = BeachJoinSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname.');
    const profiles = roomPolicy().profiles;
    const profileId = profiles === null ? null : profileIdFromCookieHeader(profiles.keys, context.headers.get('cookie'), Date.now());
    if (!(await this.#openedBeach(profileId))) throw new ServerError(CLOSE_CODES.ISLAND_LOCKED, 'Beach Town is not open for this guardian yet.');
    if (!(await holdSeat(roomPolicy().ipSlots, ipKey(context.ip), client.ref))) {
      throw new ServerError(CLOSE_CODES.TOO_MANY_CONNECTIONS, 'Too many players from your network.');
    }
    return { nickname: parsed.data.nickname, profileId, byFerry: parsed.data.arrive === 'ferry' };
  }

  override onJoin(client: BeachClient): void {
    const auth = client.auth;
    if (auth === undefined) throw new ServerError(ErrorCode.APPLICATION_ERROR, 'Not authorised.');
    const taken = new Set(Array.from(this.state.players.values(), (p) => p.seat));
    const seat = Array.from({ length: BEACH_MAX_PLAYERS }, (_, i) => i).find((i) => !taken.has(i)) ?? 0;
    const spawn = auth.byFerry ? ferryArrival('beach') : (BEACH_SPAWNS[seat] ?? { x: 15, y: 9.5 });
    const names = Array.from(this.state.players.values(), (p) => p.name);
    const player = new HubPlayer({ name: uniqueNickname(auth.nickname, names), seat, x: spawn.x, y: spawn.y });
    player.ack = 0;
    this.state.players.set(client.sessionId, player);
    const view = new StateView();
    view.add(player, VIEW_TAGS.OWNER);
    client.view = view;
    this.#sims.set(client.sessionId, { inputs: new InputQueue(), profileId: auth.profileId, job: null, lastActiveMs: Date.now(), lastEmoteMs: 0, lastJumpMs: 0, lastLookMs: 0, lookQueued: false });
    if (auth.profileId !== null) void this.#wearLook(client.sessionId, auth.profileId);
  }

  override onLeave(client: BeachClient): void {
    this.state.players.delete(client.sessionId);
    this.#sims.delete(client.sessionId);
    client.view?.dispose();
  }

  #step(): void {
    const now = performance.now();
    for (const [id, sim] of this.#sims) {
      const player = this.state.players.get(id);
      if (player === undefined) continue;
      sim.inputs.drain(now, (input) => {
        const next = stepMovement({ x: player.x, y: player.y }, { x: input.dx, y: input.dy }, TICK_SECONDS, BEACH_MAP);
        if (next.x !== player.x) player.x = next.x;
        if (next.y !== player.y) player.y = next.y;
      });
      if (player.ack !== sim.inputs.ack) player.ack = sim.inputs.ack;
    }
    this.broadcastPatch();
  }

  // Whether this guardian's own profile has opened Beach Town; anything unknown stays shut.
  async #openedBeach(profileId: string | null): Promise<boolean> {
    const profiles = roomPolicy().profiles;
    if (profiles === null || profileId === null) return false;
    try {
      const progress = (await loadProfile(profiles.store, profileId, Date.now())).progress;
      return islandOpenFor('beach', progress.xp, progress.academy);
    } catch (error) {
      log.warn('beach unlock not checked', { roomId: this.roomId, error: error instanceof Error ? error.name : 'unknown' });
      return false;
    }
  }

  async #wearLook(sessionId: string, profileId: string): Promise<void> {
    const profiles = roomPolicy().profiles;
    if (profiles === null) return;
    try {
      const look = (await loadProfile(profiles.store, profileId, Date.now())).look;
      const player = this.state.players.get(sessionId);
      if (player === undefined) return;
      dress(player, look);
    } catch (error) {
      log.warn('beach look not loaded', { roomId: this.roomId, error: error instanceof Error ? error.name : 'unknown' });
    }
  }

  #refuse(client: BeachClient, reason: CourierRefused['reason']): void {
    client.send(BEACH_MESSAGES.REFUSED, { reason } satisfies CourierRefused);
  }

  #takeJob(client: BeachClient, shop: ShopId): void {
    const sim = this.#sims.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (sim === undefined || player === undefined) return;
    if (sim.job !== null) {
      this.#refuse(client, 'busy');
      return;
    }
    if (!atShop({ x: player.x, y: player.y }, shop)) {
      this.#refuse(client, 'notHere');
      return;
    }
    const to = pickDestination(shop, cryptoRandom);
    const job: Job = { id: randomBytes(9).toString('base64url'), from: shop, to, reward: courierReward(shop, to), takenAt: Date.now() };
    sim.job = job;
    player.carrying = true;
    client.send(BEACH_MESSAGES.JOB, { id: job.id, from: job.from, to: job.to, reward: job.reward } satisfies CourierJob);
  }

  async #deliver(client: BeachClient): Promise<void> {
    const sim = this.#sims.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const job = sim?.job ?? null;
    if (sim === undefined || player === undefined || job === null) {
      this.#refuse(client, 'noJob');
      return;
    }
    if (!atShop({ x: player.x, y: player.y }, job.to)) {
      this.#refuse(client, 'wrongShop');
      return;
    }
    if (Date.now() - job.takenAt < minDeliveryMs(job.from, job.to)) {
      this.#refuse(client, 'tooFast');
      return;
    }
    sim.job = null;
    player.carrying = false;
    const done = await this.#pay(sim.profileId, job);
    // The store failed: give the parcel back so the delivery can be retried; the job's key stops a double payment.
    // Re-read: another message may have taken a new job while the payment was pending.
    const current = this.#sims.get(client.sessionId);
    if (done.reason === 'error' && current === sim && current.job === null) {
      sim.job = job;
      player.carrying = true;
    }
    client.send(BEACH_MESSAGES.DONE, done);
  }

  // One payment per job id, through the profile store's idempotency key, under the daily cap.
  // The delivery also counts toward the courier seals, with their XP and any rank-up sats.
  async #pay(profileId: string | null, job: Job): Promise<CourierDone> {
    const profiles = roomPolicy().profiles;
    const unpaid = (reason: CourierDone['reason'], today: number): CourierDone => ({ id: job.id, paid: 0, reason, deliveredToday: today, seals: [] });
    if (profiles === null || profileId === null) return unpaid('noProfile', 0);
    const now = Date.now();
    const height = roomPolicy().chain.current().height;
    try {
      const out = await profiles.store.change<CourierDone>(profileId, `courier:${job.id}`, now, (data) => {
        const day = dayFor(data.progress.day, now);
        const today = day.courier ?? 0;
        if (today >= COURIER_DAILY_LIMIT) return { data, result: unpaid('dailyLimit', today) };
        const fee = credit(data.wallet, job.reward);
        if (!fee.ok) return { data, result: unpaid('walletFull', today) };
        const applied = applyCourierDelivery({ ...data.progress, day: { ...day, courier: today + 1 } }, now, height);
        return { data: pay({ ...data, wallet: fee.value.wallet }, applied), result: { id: job.id, paid: job.reward, reason: 'paid', deliveredToday: today + 1, seals: [...applied.award.seals] } };
      });
      if (out.ok) return out.result;
      // This job's key is already spent: an earlier attempt paid it, so report it as paid, never retry.
      if (out.reason === 'duplicate') return { id: job.id, paid: job.reward, reason: 'paid', deliveredToday: 0, seals: [] };
    } catch (error) {
      log.error('courier payment failed', error, { roomId: this.roomId });
    }
    return unpaid('error', 0);
  }
}
