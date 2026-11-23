// Concurrent seats per network: in memory (today's IpSlots) or counted across every process in Redis.
import { randomBytes } from 'node:crypto';
import { IpSlots } from '../clientIp.js';
import type { RedisHealth } from './health.js';
import { PROCS_KEY, isNetworkKey, seatKey, type NetworkKeys } from './keys.js';
import { parseCount, parseHash, type CommandRunner, type RedisCommand } from './redis.js';

export interface SeatCounter {
  readonly max: number;
  // Takes a seat unless the network already holds `max`. Never rejects.
  tryAcquire(key: string): Promise<boolean>;
  // A reconnect reclaiming a seat its network already held: ignores the cap.
  forceAcquire(key: string): void;
  // Gives back one seat; never goes below zero.
  release(key: string): void;
  // Seats the network holds on every process.
  count(key: string): Promise<number>;
  stop(): Promise<void>;
}

export const MAX_SEAT_CAP = 1000;

export function assertSeatCap(max: number): void {
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_SEAT_CAP) throw new RangeError(`seat cap must be 1-${String(MAX_SEAT_CAP)}`);
}

// Today's per-process behaviour behind the async interface.
export class LocalSeatCounter implements SeatCounter {
  readonly #slots: IpSlots;

  constructor(readonly max: number) {
    assertSeatCap(max);
    this.#slots = new IpSlots(max);
  }

  tryAcquire(key: string): Promise<boolean> {
    return Promise.resolve(isNetworkKey(key) && this.#slots.tryAcquire(key));
  }

  forceAcquire(key: string): void {
    if (isNetworkKey(key)) this.#slots.forceAcquire(key);
  }

  release(key: string): void {
    if (isNetworkKey(key)) this.#slots.release(key);
  }

  count(key: string): Promise<number> {
    return Promise.resolve(isNetworkKey(key) ? this.#slots.count(key) : 0);
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

export interface CloseEmitter {
  once(event: 'close', listener: () => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
}

// Takes a seat for the socket's network and gives it back exactly once when the socket closes,
// including a close that happens while the seat is still being counted. False means full.
export async function holdSeat(seats: SeatCounter, key: string, socket: CloseEmitter): Promise<boolean> {
  // Shared with the close listener, which can run while tryAcquire is pending.
  const seat = { held: false, closed: false };
  const onClose = (): void => {
    seat.closed = true;
    if (seat.held) seats.release(key);
  };
  socket.once('close', onClose);
  let acquired: boolean;
  try {
    acquired = await seats.tryAcquire(key);
  } catch (error) {
    socket.removeListener('close', onClose);
    throw error;
  }
  if (!acquired) {
    socket.removeListener('close', onClose);
    return false;
  }
  seat.held = true;
  if (seat.closed) seats.release(key);
  return true;
}

export interface SeatTiming {
  // A network hash expires this long after its last write; holders refresh it after a third of it.
  readonly leaseMs: number;
  // A generation whose heartbeat is older than this no longer counts anywhere.
  readonly deadAfterMs: number;
  // Process-table entries older than this are deleted.
  readonly pruneAfterMs: number;
}

export const SEAT_TIMING: SeatTiming = Object.freeze({ leaseMs: 120_000, deadAfterMs: 30_000, pruneAfterMs: 120_000 });

// Commands per transaction when rewriting many networks, and stale fields deleted per pass.
const MAX_BATCH = 500;
const MAX_STALE_FIELDS = 64;

export function newGeneration(): string {
  return randomBytes(16).toString('base64url');
}

interface Held {
  readonly token: string;
  count: number;
  writtenAt: number;
}

export interface RedisSeatDeps {
  readonly runner: CommandRunner;
  readonly health: RedisHealth;
  readonly keys: NetworkKeys;
  readonly now?: () => number;
  readonly timing?: SeatTiming;
  readonly generation?: () => string;
}

// Each process writes its own absolute count per network under a random generation id; readers sum
// the generations that still heartbeat. A crashed process stops counting after deadAfterMs.
export class RedisSeatCounter implements SeatCounter {
  readonly #runner: CommandRunner;
  readonly #health: RedisHealth;
  readonly #keys: NetworkKeys;
  readonly #now: () => number;
  readonly #timing: SeatTiming;
  readonly #newGeneration: () => string;
  // Authoritative local mirror: network key -> seats this process holds.
  readonly #held = new Map<string, Held>();
  #gen: string;
  #beaten = false;
  #stopped = false;

  constructor(
    readonly max: number,
    deps: RedisSeatDeps,
  ) {
    assertSeatCap(max);
    this.#runner = deps.runner;
    this.#health = deps.health;
    this.#keys = deps.keys;
    this.#now = deps.now ?? Date.now;
    this.#timing = deps.timing ?? SEAT_TIMING;
    this.#newGeneration = deps.generation ?? newGeneration;
    if (this.#timing.leaseMs <= this.#timing.deadAfterMs || this.#timing.pruneAfterMs < this.#timing.deadAfterMs) {
      throw new RangeError('seat lease and prune times must exceed the dead-after time');
    }
    this.#gen = this.#newGeneration();
  }

  get generation(): string {
    return this.#gen;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  // Networks holding seats on this process.
  get networks(): number {
    return this.#held.size;
  }

  async tryAcquire(key: string): Promise<boolean> {
    if (this.#stopped || !isNetworkKey(key)) return false;
    const held = this.#hold(key);
    held.count += 1;
    if (!this.#health.up) return this.#decideLocally(key, held);
    const gen = this.#gen;
    const redisKey = seatKey(held.token);
    try {
      // Write this attempt first, then read: the later of two racing attempts always sees both.
      const replies = await this.#runner.multi([
        ['hset', redisKey, gen, held.count],
        ['pexpire', redisKey, this.#timing.leaseMs],
        ['hgetall', redisKey],
        ['hgetall', PROCS_KEY],
      ]);
      const now = this.#now();
      held.writtenAt = now;
      const { total, stale } = this.#tally(parseHash(replies[2]), parseHash(replies[3]), now, gen);
      if (stale.length > 0) this.#send([['hdel', redisKey, ...stale]]);
      if (total <= this.max) return true;
      this.#giveBack(key, held);
      return false;
    } catch (error) {
      this.#health.fail(error);
      return this.#decideLocally(key, held);
    }
  }

  forceAcquire(key: string): void {
    if (this.#stopped || !isNetworkKey(key)) return;
    const held = this.#hold(key);
    held.count += 1;
    this.#write(held);
  }

  release(key: string): void {
    if (!isNetworkKey(key)) return;
    const held = this.#held.get(key);
    if (held === undefined) return;
    held.count -= 1;
    if (held.count <= 0) this.#held.delete(key);
    this.#write(held);
  }

  async count(key: string): Promise<number> {
    if (!isNetworkKey(key)) return 0;
    const local = (): number => this.#held.get(key)?.count ?? 0;
    if (!this.#health.up || this.#stopped) return local();
    const redisKey = seatKey(this.#held.get(key)?.token ?? this.#keys.token(key));
    try {
      const replies = await this.#runner.multi([
        ['hgetall', redisKey],
        ['hgetall', PROCS_KEY],
      ]);
      return this.#tally(parseHash(replies[0]), parseHash(replies[1]), this.#now(), this.#gen, local()).total;
    } catch (error) {
      this.#health.fail(error);
      return local();
    }
  }

  // Heartbeat and lease refresh. Runs while the breaker is open too (it is the probe), so it rejects on any error.
  async beat(): Promise<void> {
    if (this.#stopped) return;
    const now = this.#now();
    const gen = this.#gen;
    const replies = await this.#runner.multi([
      ['hgetall', PROCS_KEY],
      ['hset', PROCS_KEY, gen, now],
      ['pexpire', PROCS_KEY, this.#procsTtlMs()],
    ]);
    const procs = parseHash(replies[0]);
    const previous = parseCount(procs.get(gen));
    // Missing or stale: other processes may already have dropped this generation's seats.
    if (this.#beaten && (previous === null || now - previous > this.#timing.deadAfterMs)) {
      await this.recover();
      return;
    }
    this.#beaten = true;
    const groups: RedisCommand[][] = [];
    const prune = [...procs].filter(([g, at]) => g !== gen && !this.#fresh(at, now, this.#timing.pruneAfterMs)).map(([g]) => g);
    if (prune.length > 0) groups.push([['hdel', PROCS_KEY, ...prune.slice(0, MAX_STALE_FIELDS)]]);
    for (const held of this.#held.values()) {
      if (now - held.writtenAt < this.#timing.leaseMs / 3) continue;
      held.writtenAt = now;
      groups.push(this.#assert(held, gen));
    }
    await this.#runGroups(groups);
  }

  // After an outage: a new generation rewrites every local count, and the old one stops counting at once.
  async recover(): Promise<void> {
    if (this.#stopped) return;
    const old = this.#gen;
    const gen = this.#newGeneration();
    this.#gen = gen;
    this.#beaten = false;
    const now = this.#now();
    const groups: RedisCommand[][] = [
      [
        ['hdel', PROCS_KEY, old],
        ['hset', PROCS_KEY, gen, now],
        ['pexpire', PROCS_KEY, this.#procsTtlMs()],
      ],
    ];
    for (const held of this.#held.values()) {
      held.writtenAt = now;
      groups.push([['hdel', seatKey(held.token), old], ...this.#assert(held, gen)]);
    }
    await this.#runGroups(groups);
    this.#beaten = true;
  }

  // Leaves the process table and deletes this generation's fields; what fails here expires with its lease.
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    const held = [...this.#held.values()];
    this.#held.clear();
    if (!this.#health.up) return;
    const groups: RedisCommand[][] = [[['hdel', PROCS_KEY, this.#gen]], ...held.map((h): RedisCommand[] => [['hdel', seatKey(h.token), this.#gen]])];
    try {
      await this.#runGroups(groups);
    } catch {
      // Without its heartbeat the generation stops counting after deadAfterMs anyway.
    }
  }

  #hold(key: string): Held {
    let held = this.#held.get(key);
    if (held === undefined) {
      held = { token: this.#keys.token(key), count: 0, writtenAt: 0 };
      this.#held.set(key, held);
    }
    return held;
  }

  // While Redis is unhealthy each process still caps every network at `max` on its own.
  #decideLocally(key: string, held: Held): boolean {
    if (held.count <= this.max) return true;
    this.#giveBack(key, held);
    return false;
  }

  #giveBack(key: string, held: Held): void {
    held.count -= 1;
    if (held.count <= 0 && this.#held.get(key) === held) this.#held.delete(key);
    this.#write(held);
  }

  // Absolute value in the background; skipped while unhealthy because recover() rewrites everything.
  #write(held: Held): void {
    if (!this.#health.up || this.#stopped) return;
    held.writtenAt = this.#now();
    this.#send(held.count > 0 ? this.#assert(held, this.#gen) : [['hdel', seatKey(held.token), this.#gen]], true);
  }

  #assert(held: Held, gen: string): RedisCommand[] {
    const redisKey = seatKey(held.token);
    return [
      ['hset', redisKey, gen, held.count],
      ['pexpire', redisKey, this.#timing.leaseMs],
    ];
  }

  #send(commands: RedisCommand[], atomic = false): void {
    const run = atomic ? this.#runner.multi(commands) : this.#runner.pipeline(commands);
    run.catch((error: unknown) => {
      this.#health.fail(error);
    });
  }

  // Groups stay whole, so a hash is never created without its TTL.
  async #runGroups(groups: readonly RedisCommand[][]): Promise<void> {
    let batch: RedisCommand[] = [];
    for (const group of groups) {
      if (batch.length > 0 && batch.length + group.length > MAX_BATCH) {
        await this.#runner.multi(batch);
        batch = [];
      }
      batch.push(...group);
    }
    if (batch.length > 0) await this.#runner.multi(batch);
  }

  #tally(hash: Map<string, string>, procs: Map<string, string>, now: number, own: string, ownCount?: number): { total: number; stale: string[] } {
    let total = 0;
    const stale: string[] = [];
    for (const [gen, raw] of hash) {
      const count = parseCount(raw);
      if (gen === own) {
        total += ownCount ?? count ?? 0;
      } else if (count !== null && this.#fresh(procs.get(gen), now, this.#timing.deadAfterMs)) {
        total += count;
      } else if (stale.length < MAX_STALE_FIELDS) {
        stale.push(gen);
      }
    }
    if (ownCount !== undefined && !hash.has(own)) total += ownCount;
    return { total, stale };
  }

  // A heartbeat no older than maxAgeMs, and not implausibly far in the future.
  #fresh(beat: string | undefined, now: number, maxAgeMs: number): boolean {
    const at = parseCount(beat);
    return at !== null && now - at <= maxAgeMs && at - now <= this.#timing.deadAfterMs;
  }

  #procsTtlMs(): number {
    return 5 * Math.max(this.#timing.pruneAfterMs, this.#timing.deadAfterMs);
  }
}
