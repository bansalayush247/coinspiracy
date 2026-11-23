// Spawns practice bots into rooms hosted by this process and keeps them in check: caps per room and
// per process, one shared 20 Hz ticker, a watchdog that sends bots home when no human is left, and
// a clean shutdown. Each bot is a real SDK client on loopback, so every room rule applies to it.
import { matchMaker } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { MAX_PLAYERS, TASK_TIMING, cryptoRandom, type RandomSource, type TaskTiming } from '@byzantine-council/shared';
import { CitadelState } from '@byzantine-council/shared/state';
import { z } from 'zod';
import { log } from '../logger.js';
import { BOT_TICK_MS, BotBrain, type BotLink } from './brain.js';
import { pickBotNickname } from './names.js';
import { BotProfileSchema, HUMANLIKE_PROFILE, type BotProfile } from './profile.js';
import { botSeatTickets, isLoopbackAddress, type BotSeatTickets } from './seats.js';
import { defaultStrategies, type StrategySet } from './strategy.js';

// At least one seat always stays with a person.
export const MAX_BOTS_PER_ROOM = MAX_PLAYERS - 1;
export const DEFAULT_MAX_BOTS_PER_PROCESS = 16;
// Hard ceiling whatever the configuration says.
export const MAX_BOTS_PER_PROCESS = 64;
const DEFAULT_JOIN_TIMEOUT_MS = 10_000;
const LEAVE_TIMEOUT_MS = 3_000;
const WATCHDOG_MS = 1_000;
// Consecutive watchdog checks without a human before the bots leave.
const LONELY_CHECKS = 2;
// Consented leave, as Colyseus reports it.
const CONSENTED = 4000;

const RoomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const SessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const SpawnCountSchema = z.number().int().min(1).max(MAX_BOTS_PER_ROOM);
const Ms = z.number().int().min(0).max(600_000);
const TaskTimingSchema = z.object({
  minSolveMs: z.object({ deposit: Ms, ledger: Ms, route: Ms, watchtower: Ms }),
  expireMs: Ms,
  retryMs: Ms,
  openCooldownMs: Ms,
});

// Bots must dial this process on a loopback IP literal; anything else could leave the host.
function isLoopbackEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    return url.protocol === 'ws:' && url.port !== '' && url.pathname === '/' && url.search === '' && isLoopbackAddress(host);
  } catch {
    return false;
  }
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

const OptionsSchema = z.object({
  endpoint: z.string().max(256).refine(isLoopbackEndpoint, 'endpoint must be ws://<loopback ip>:<port>'),
  origin: z.string().max(256).refine(isOrigin, 'origin must be an http(s) origin the server allows'),
  maxBotsPerRoom: z.number().int().min(1).max(MAX_BOTS_PER_ROOM).optional(),
  maxBotsPerProcess: z.number().int().min(1).max(MAX_BOTS_PER_PROCESS).optional(),
  joinTimeoutMs: z.number().int().min(100).max(60_000).optional(),
  social: z.boolean().optional(),
  profile: BotProfileSchema.optional(),
  taskTiming: TaskTimingSchema.optional(),
});

export interface BotManagerOptions {
  // ws://127.0.0.1:<port> of this very process.
  readonly endpoint: string;
  // One of the server's allowed client origins, sent as the bots' Origin header.
  readonly origin: string;
  readonly maxBotsPerRoom?: number;
  // Keep at or below maxSeatsPerIp: bots share the loopback socket budget of the HTTP gate.
  readonly maxBotsPerProcess?: number;
  readonly joinTimeoutMs?: number;
  // Lets bots send the M4 intents; only once the room handles them.
  readonly social?: boolean;
  readonly profile?: BotProfile;
  // Must match the room policy's timing, so bots never answer before minSolveMs.
  readonly taskTiming?: TaskTiming;
  readonly rng?: RandomSource;
  readonly strategies?: StrategySet;
  readonly tickets?: BotSeatTickets;
}

export type SpawnRefusal =
  | 'invalidRequest'
  | 'stopped'
  | 'busy'
  | 'roomNotFound'
  | 'roomLocked'
  | 'roomFull'
  | 'roomCap'
  | 'processCap'
  | 'joinFailed';

export interface SpawnResult {
  readonly added: number;
  // Why fewer bots than asked for joined, if so.
  readonly refused?: SpawnRefusal;
}

function consume(client: Client, seat: { name: string; sessionId: string; roomId: string; processId: string }) {
  return client.consumeSeatReservation(seat, CitadelState);
}
type BotRoom = Awaited<ReturnType<typeof consume>>;

interface BotHandle {
  readonly sessionId: string;
  readonly nickname: string;
  readonly room: BotRoom;
  readonly brain: BotBrain;
  leaving: Promise<void> | null;
}

interface RoomGroup {
  readonly bots: Map<string, BotHandle>;
  spawning: boolean;
  lonely: number;
}

// Settles with the room, or rejects after `ms`; a room that arrives late is left at once.
function joinWithin(attempt: Promise<BotRoom>, ms: number): Promise<BotRoom> {
  return new Promise((resolve, reject) => {
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      reject(new Error('bot join timed out'));
    }, ms);
    attempt.then(
      (room) => {
        clearTimeout(timer);
        if (late) room.leave(true).catch(() => undefined);
        else resolve(room);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (!late) reject(error instanceof Error ? error : new Error('bot join failed'));
      },
    );
  });
}

interface LocalRoom {
  readonly locked: boolean;
  hasReachedMaxClients(): boolean;
}

// Typed as always present, but undefined at runtime once a room is gone or lives elsewhere.
function localRoom(roomId: string): LocalRoom | null {
  const room: unknown = matchMaker.getLocalRoomById(roomId);
  return typeof room === 'object' && room !== null && 'hasReachedMaxClients' in room && 'locked' in room ? (room as LocalRoom) : null;
}

// Colyseus errors carry a numeric code; messages are not logged.
function errorCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : undefined;
}

export class BotManager {
  readonly #endpoint: string;
  readonly #origin: string;
  readonly #maxPerRoom: number;
  readonly #maxPerProcess: number;
  readonly #joinTimeoutMs: number;
  readonly #social: boolean;
  readonly #profile: BotProfile;
  readonly #timing: TaskTiming;
  readonly #rng: RandomSource;
  readonly #strategies: StrategySet;
  readonly #tickets: BotSeatTickets;
  readonly #rooms = new Map<string, RoomGroup>();
  #pending = 0;
  #ticker: NodeJS.Timeout | null = null;
  #watchdog: NodeJS.Timeout | null = null;
  #stopped = false;

  // Throws on bad configuration, naming the fields but not echoing values.
  constructor(options: BotManagerOptions) {
    const parsed = OptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new Error(`invalid bot manager options: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    }
    const o = parsed.data;
    this.#endpoint = o.endpoint;
    this.#origin = o.origin;
    this.#maxPerRoom = o.maxBotsPerRoom ?? MAX_BOTS_PER_ROOM;
    this.#maxPerProcess = o.maxBotsPerProcess ?? DEFAULT_MAX_BOTS_PER_PROCESS;
    this.#joinTimeoutMs = o.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS;
    this.#social = o.social ?? false;
    this.#profile = options.profile ?? HUMANLIKE_PROFILE;
    this.#timing = options.taskTiming ?? TASK_TIMING;
    this.#rng = options.rng ?? cryptoRandom;
    this.#strategies = options.strategies ?? defaultStrategies(this.#profile, this.#timing);
    this.#tickets = options.tickets ?? botSeatTickets();
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  // Bots connected now, in one room or in all.
  count(roomId?: string): number {
    if (roomId !== undefined) return this.#rooms.get(roomId)?.bots.size ?? 0;
    let total = 0;
    for (const group of this.#rooms.values()) total += group.bots.size;
    return total;
  }

  // Session ids of the bots in a room.
  bots(roomId: string): string[] {
    return [...(this.#rooms.get(roomId)?.bots.keys() ?? [])];
  }

  // Adds up to `count` bots to a room on this process; never more than the caps allow.
  async spawn(roomId: unknown, count: unknown): Promise<SpawnResult> {
    if (this.#stopped) return { added: 0, refused: 'stopped' };
    const id = RoomIdSchema.safeParse(roomId);
    const n = SpawnCountSchema.safeParse(count);
    if (!id.success || !n.success) return { added: 0, refused: 'invalidRequest' };
    let group = this.#rooms.get(id.data);
    if (group === undefined) {
      group = { bots: new Map(), spawning: false, lonely: 0 };
      this.#rooms.set(id.data, group);
    }
    // One batch per room at a time, so a host cannot stack requests.
    if (group.spawning) return { added: 0, refused: 'busy' };
    group.spawning = true;
    let added = 0;
    let refused: SpawnRefusal | undefined;
    try {
      for (let i = 0; i < n.data && refused === undefined; i++) {
        refused = this.#refusal(id.data, group);
        if (refused !== undefined) break;
        if (await this.#join(id.data, group)) added += 1;
        else refused = 'joinFailed';
      }
    } finally {
      group.spawning = false;
      this.#dropIfEmpty(id.data, group);
    }
    if (added > 0) log.info('bots joined', { roomId: id.data, added, bots: group.bots.size, total: this.count() });
    return refused === undefined ? { added } : { added, refused };
  }

  // Makes one bot leave; false if it is not one of this manager's bots in that room.
  async remove(roomId: unknown, sessionId: unknown): Promise<boolean> {
    const id = RoomIdSchema.safeParse(roomId);
    const sid = SessionIdSchema.safeParse(sessionId);
    if (!id.success || !sid.success) return false;
    const handle = this.#rooms.get(id.data)?.bots.get(sid.data);
    if (handle === undefined) return false;
    await this.#leave(id.data, handle);
    return true;
  }

  // Makes every bot in a room leave; returns how many there were.
  async removeAll(roomId: unknown): Promise<number> {
    const id = RoomIdSchema.safeParse(roomId);
    if (!id.success) return 0;
    const handles = [...(this.#rooms.get(id.data)?.bots.values() ?? [])];
    await Promise.all(handles.map((h) => this.#leave(id.data, h)));
    return handles.length;
  }

  // Stops spawning, makes every bot leave and clears the timers.
  async shutdown(): Promise<void> {
    if (this.#stopped && this.count() === 0) return;
    this.#stopped = true;
    const leaving: Promise<void>[] = [];
    for (const [roomId, group] of this.#rooms) for (const h of group.bots.values()) leaving.push(this.#leave(roomId, h));
    await Promise.all(leaving);
    this.#stopTimers();
    log.info('bots stopped', { rooms: this.#rooms.size });
  }

  #refusal(roomId: string, group: RoomGroup): SpawnRefusal | undefined {
    if (this.#stopped) return 'stopped';
    if (group.bots.size >= this.#maxPerRoom) return 'roomCap';
    if (this.count() + this.#pending >= this.#maxPerProcess) return 'processCap';
    // Only rooms on this process: bots always dial their own process on loopback.
    const room = localRoom(roomId);
    if (room === null) return 'roomNotFound';
    // Locked means mid-match (or full); the matchmaker would refuse anyway.
    if (room.hasReachedMaxClients()) return 'roomFull';
    if (room.locked) return 'roomLocked';
    return undefined;
  }

  async #join(roomId: string, group: RoomGroup): Promise<boolean> {
    this.#pending += 1;
    let sessionId: string | null = null;
    try {
      const taken = new Set([...group.bots.values()].map((h) => h.nickname));
      const nickname = pickBotNickname(taken, this.#rng);
      // Reserved in-process with no auth context: the HTTP route and its per-network limits are
      // not involved, but the matchmaker still refuses locked rooms and full rooms.
      const seat = await matchMaker.joinById(roomId, { nickname });
      sessionId = seat.sessionId;
      if (seat.processId !== matchMaker.processId) throw new Error('room is hosted by another process');
      if (!this.#tickets.issue(seat.sessionId, roomId)) throw new Error('bot seat tickets exhausted');
      const client = new Client(this.#endpoint, { headers: { Origin: this.#origin } });
      // Only the fields needed to dial this process; a public address would send the bot elsewhere.
      const room = await joinWithin(
        consume(client, { name: seat.name, sessionId: seat.sessionId, roomId: seat.roomId, processId: seat.processId }),
        this.#joinTimeoutMs,
      );
      if (this.#stopped) {
        room.leave(true).catch(() => undefined);
        return false;
      }
      this.#attach(roomId, group, room, nickname);
      return true;
    } catch (error) {
      if (sessionId !== null) this.#tickets.revoke(sessionId);
      log.warn('bot could not join', { roomId, code: errorCode(error) });
      return false;
    } finally {
      this.#pending -= 1;
    }
  }

  #attach(roomId: string, group: RoomGroup, room: BotRoom, nickname: string): void {
    // The server holds a dropped seat from the first second, so retry from the first second too.
    room.reconnection.minUptime = 0;
    const sessionId = room.sessionId;
    const link: BotLink = {
      sessionId,
      get isOpen() {
        return room.connection.isOpen;
      },
      get state() {
        return room.state;
      },
      send: (type, payload) => {
        room.send(type, payload);
      },
    };
    const brain = new BotBrain(link, {
      roomId,
      profile: this.#profile,
      timing: this.#timing,
      strategies: this.#strategies,
      rng: this.#rng,
      social: this.#social,
      onFatal: () => {
        void this.remove(roomId, sessionId);
      },
    });
    group.bots.set(sessionId, { sessionId, nickname, room, brain, leaving: null });
    room.onStateChange(() => {
      brain.onState();
    });
    // Catch-all, so new server message types never warn per message.
    room.onMessage('*', (type: string | number, payload: unknown) => {
      brain.onMessage(String(type), payload);
    });
    room.onDrop(() => {
      brain.onDrop();
    });
    room.onReconnect(() => {
      brain.onReconnect();
    });
    room.onLeave((code: number) => {
      this.#forget(roomId, sessionId, code);
    });
    this.#startTimers();
  }

  // Consented leave, bounded in time; the bookkeeping is cleared either way.
  #leave(roomId: string, handle: BotHandle): Promise<void> {
    handle.leaving ??= (async () => {
      handle.brain.dispose();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          resolve('timeout');
        }, LEAVE_TIMEOUT_MS);
      });
      const outcome = await Promise.race([handle.room.leave(true).catch(() => CONSENTED), timeout]);
      clearTimeout(timer);
      if (outcome === 'timeout') handle.room.connection.close();
      this.#forget(roomId, handle.sessionId, CONSENTED);
    })();
    return handle.leaving;
  }

  #forget(roomId: string, sessionId: string, code: number): void {
    const group = this.#rooms.get(roomId);
    const handle = group?.bots.get(sessionId);
    if (group === undefined || handle === undefined) return;
    handle.brain.dispose();
    group.bots.delete(sessionId);
    this.#tickets.revoke(sessionId);
    this.#dropIfEmpty(roomId, group);
    if (this.count() === 0 && this.#pending === 0) this.#stopTimers();
    log.info('bot left', { roomId, sessionId, code });
  }

  #dropIfEmpty(roomId: string, group: RoomGroup): void {
    if (group.bots.size === 0 && !group.spawning) this.#rooms.delete(roomId);
  }

  #startTimers(): void {
    if (this.#ticker === null) {
      this.#ticker = setInterval(() => {
        this.#tickAll();
      }, BOT_TICK_MS);
      this.#ticker.unref();
    }
    if (this.#watchdog === null) {
      this.#watchdog = setInterval(() => {
        this.#checkRooms();
      }, WATCHDOG_MS);
      this.#watchdog.unref();
    }
  }

  #stopTimers(): void {
    if (this.#ticker !== null) clearInterval(this.#ticker);
    if (this.#watchdog !== null) clearInterval(this.#watchdog);
    this.#ticker = null;
    this.#watchdog = null;
  }

  #tickAll(): void {
    for (const group of this.#rooms.values()) for (const handle of group.bots.values()) handle.brain.tick();
  }

  // Bots leave a room with no human seat left, and a room that no longer exists.
  #checkRooms(): void {
    for (const [roomId, group] of this.#rooms) {
      if (group.spawning || group.bots.size === 0) continue;
      if (localRoom(roomId) === null) {
        void this.removeAll(roomId);
        continue;
      }
      const state = this.#syncedState(group);
      if (state === null) continue;
      let humans = 0;
      for (const id of state.players.keys()) if (!group.bots.has(id)) humans += 1;
      group.lonely = humans === 0 ? group.lonely + 1 : 0;
      if (group.lonely >= LONELY_CHECKS) {
        log.info('no humans left, bots leaving', { roomId, bots: group.bots.size });
        void this.removeAll(roomId);
      }
    }
  }

  // A bot's view that has synced at least its own seat; held seats of dropped people still count.
  #syncedState(group: RoomGroup): CitadelState | null {
    for (const handle of group.bots.values()) {
      if (handle.room.connection.isOpen && handle.room.state.players.has(handle.sessionId)) return handle.room.state;
    }
    return null;
  }
}
