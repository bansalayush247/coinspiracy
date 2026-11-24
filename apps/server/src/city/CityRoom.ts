// Port Concord: the open city, one region server. Movement is server-checked as in matches, and each
// guardian is only sent the players near them, so the city can be large without every client syncing everyone.
import { StateView } from '@colyseus/schema';
import { ErrorCode, Room, ServerError, validate, type AuthContext, type Client } from '@colyseus/core';
import { CLOSE_CODES, MovePayloadSchema, NoPayloadSchema, SERVER_TICK_HZ, TICK_SECONDS, stepMovement, uniqueNickname } from '@byzantine-council/shared';
import { isCosmeticId } from '@byzantine-council/shared/economy';
import { CITY_MAP, CITY_MAX_PLAYERS, CITY_MESSAGES, CITY_SPAWNS, CityJoinSchema, CityPlayer, CityState, keepsInView } from '@byzantine-council/shared/city';
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
  // Session ids this client is currently sent.
  readonly sees: Set<string>;
  lastActiveMs: number;
  lastEmoteMs: number;
  lastLookMs: number;
}

const IDLE_MS = 15 * 60_000;
const IDLE_CHECK_MS = 30_000;
// Who-sees-whom is refreshed five times a second; positions still sync every tick.
const INTEREST_EVERY_TICKS = 4;

export class CityRoom extends Room<{ state: CityState; client: CityClient }> {
  override maxClients = CITY_MAX_PLAYERS;
  override state = new CityState();
  override maxMessagesPerSecond = 40;
  override seatReservationTimeout = 8;
  readonly #sims = new Map<string, Sim>();
  #tick = 0;

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
    const player = new CityPlayer({ name: uniqueNickname(auth.nickname, names), seat: seat % 10, x: spawn.x, y: spawn.y });
    player.ack = 0;
    this.state.players.set(client.sessionId, player);
    const view = new StateView();
    view.add(player);
    view.add(player, VIEW_TAGS.OWNER);
    client.view = view;
    this.#sims.set(client.sessionId, { client, view, inputs: new InputQueue(), profileId: auth.profileId, sees: new Set([client.sessionId]), lastActiveMs: Date.now(), lastEmoteMs: 0, lastLookMs: 0 });
    this.state.population = this.state.players.size;
    this.#refreshInterest();
    if (auth.profileId !== null) void this.#wearLook(client.sessionId, auth.profileId);
  }

  override onLeave(client: CityClient): void {
    const player = this.state.players.get(client.sessionId);
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
    for (const [id, sim] of this.#sims) {
      const player = this.state.players.get(id);
      if (player === undefined) continue;
      sim.inputs.drain(now, (input) => {
        const next = stepMovement({ x: player.x, y: player.y }, { x: input.dx, y: input.dy }, TICK_SECONDS, CITY_MAP);
        if (next.x !== player.x) player.x = next.x;
        if (next.y !== player.y) player.y = next.y;
      });
      if (player.ack !== sim.inputs.ack) player.ack = sim.inputs.ack;
    }
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
    }
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
