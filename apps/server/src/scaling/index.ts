// Horizontal scaling: Colyseus presence and driver plus per-network limits shared through Redis,
// or today's single-process versions when no Redis is configured.
import { LocalDriver, LocalPresence, type MatchMakerDriver, type Presence } from '@colyseus/core';
import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import { Redis } from 'ioredis';
import { isPublicAddress } from './config.js';
import { RedisHealth } from './health.js';
import { NetworkKeys } from './keys.js';
import { LocalRateLimiter, RedisRateLimiter, type RateLimiter } from './limiter.js';
import { log } from '../logger.js';
import { DEFAULT_TUNING, errorName, ioredisRunner, isLoopbackHost, parseRedisUrl, redisOptions, retryDelay, type CommandRunner } from './redis.js';
import { LocalSeatCounter, RedisSeatCounter, type SeatCounter, type SeatTiming } from './seats.js';

export { holdSeat, type CloseEmitter, type SeatCounter } from './seats.js';
export { type RateLimiter } from './limiter.js';
export { loadScalingConfig, type ScalingConfig } from './config.js';

export interface Scaling {
  readonly mode: 'local' | 'redis';
  // Pass both to defineServer; Colyseus shuts them down with the server.
  readonly presence: Presence;
  readonly driver: MatchMakerDriver;
  // This process's address for room sockets; pass to defineServer when set.
  readonly publicAddress: string | undefined;
  rateLimiter(name: string, limit: number, windowMs: number): RateLimiter;
  seatCounter(max: number): SeatCounter;
  // False while Redis-backed limits run on the per-process fallback.
  healthy(): boolean;
  // Connects and writes the first heartbeat; call before server.listen(). Throws if Redis never answers.
  start(): Promise<void>;
  // Stops timers and the lane's own connection; call after Colyseus has shut down.
  stop(): Promise<void>;
}

export interface ScalingOptions {
  readonly redisUrl?: string | null;
  readonly keySecret?: string | null;
  readonly publicAddress?: string | undefined;
  readonly production?: boolean;
  /** Heartbeat and startup timing; SCALING_TIMING when omitted. */
  readonly timing?: ScalingTiming;
}

export interface ScalingTiming {
  // Heartbeat, lease refresh and breaker probe interval.
  readonly beatMs: number;
  // start() gives up after this; Infinity waits for Redis as long as it takes.
  readonly startTimeoutMs: number;
  /** While start() waits, a warning is logged at the first failure and then this often. */
  readonly waitLogMs?: number;
  readonly seats?: SeatTiming;
}

/** Default timing. Startup waits for Redis instead of exiting, so an outage never becomes a supervisor restart loop. */
export const SCALING_TIMING: ScalingTiming = Object.freeze({ beatMs: 5_000, startTimeoutMs: Number.POSITIVE_INFINITY, waitLogMs: 30_000 });

function checkedAddress(publicAddress: string | undefined): string | undefined {
  if (publicAddress !== undefined && !isPublicAddress(publicAddress)) throw new Error('invalid public address');
  return publicAddress;
}

class LocalScaling implements Scaling {
  readonly mode = 'local';
  readonly presence: Presence = new LocalPresence();
  readonly driver: MatchMakerDriver = new LocalDriver();
  readonly #limiters = new Set<RateLimiter>();

  constructor(readonly publicAddress: string | undefined) {}

  rateLimiter(name: string, limit: number, windowMs: number): RateLimiter {
    return track(this.#limiters, new LocalRateLimiter({ name, limit, windowMs }));
  }

  seatCounter(max: number): SeatCounter {
    return new LocalSeatCounter(max);
  }

  healthy(): boolean {
    return true;
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    for (const limiter of [...this.#limiters]) limiter.stop();
    return Promise.resolve();
  }
}

// Remembers a limiter until it is stopped, so stop() can reach the ones nobody stopped.
function track(set: Set<RateLimiter>, limiter: RateLimiter): RateLimiter {
  set.add(limiter);
  return {
    take: (key) => limiter.take(key),
    stop: () => {
      limiter.stop();
      set.delete(limiter);
    },
  };
}

export interface RedisScalingDeps {
  readonly runner: CommandRunner;
  readonly keys: NetworkKeys;
  readonly presence: Presence;
  readonly driver: MatchMakerDriver;
  readonly publicAddress?: string | undefined;
  // Connections to open in start(); the first is the lane's own and is closed by stop().
  readonly clients?: readonly Redis[];
  readonly now?: () => number;
  readonly timing?: ScalingTiming;
  readonly generation?: () => string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves once a connecting client is ready; rejects on its next error or after timeoutMs, so a ping never races the connect.
function ready(client: Redis, timeoutMs: number): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const settle = (error: unknown): void => {
      clearTimeout(timer);
      client.off('ready', onReady);
      client.off('error', onError);
      if (error === null) resolve();
      else reject(error instanceof Error ? error : new Error('redis not ready'));
    };
    const onReady = (): void => {
      settle(null);
    };
    const onError = (error: unknown): void => {
      settle(error);
    };
    const timer = setTimeout(() => {
      settle(new Error('redis connect timed out'));
    }, timeoutMs);
    client.once('ready', onReady);
    client.once('error', onError);
  });
}

export class RedisScaling implements Scaling {
  readonly mode = 'redis';
  readonly presence: Presence;
  readonly driver: MatchMakerDriver;
  readonly publicAddress: string | undefined;
  readonly health = new RedisHealth();
  readonly #deps: RedisScalingDeps;
  readonly #timing: ScalingTiming;
  readonly #limiters = new Set<RateLimiter>();
  readonly #seats = new Set<RedisSeatCounter>();
  #timer: NodeJS.Timeout | null = null;
  #beating = false;
  #started = false;
  #stopped = false;

  constructor(deps: RedisScalingDeps) {
    this.#deps = deps;
    this.#timing = deps.timing ?? SCALING_TIMING;
    this.presence = deps.presence;
    this.driver = deps.driver;
    this.publicAddress = checkedAddress(deps.publicAddress);
  }

  rateLimiter(name: string, limit: number, windowMs: number): RateLimiter {
    const { runner, keys, now } = this.#deps;
    return track(this.#limiters, new RedisRateLimiter({ name, limit, windowMs }, { runner, health: this.health, keys, ...(now === undefined ? {} : { now }) }));
  }

  seatCounter(max: number): SeatCounter {
    const { runner, keys, now, generation } = this.#deps;
    const seats = new RedisSeatCounter(max, {
      runner,
      health: this.health,
      keys,
      ...(now === undefined ? {} : { now }),
      ...(generation === undefined ? {} : { generation }),
      ...(this.#timing.seats === undefined ? {} : { timing: this.#timing.seats }),
    });
    this.#seats.add(seats);
    // Created after start(): announce it now rather than at the next beat.
    if (this.#started && !this.#stopped) void this.heartbeat();
    return seats;
  }

  healthy(): boolean {
    return this.health.up;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const clients = this.#deps.clients ?? [];
    for (const client of clients) if (client.status === 'wait') client.connect().catch(() => undefined);
    const failure = await this.#waitForRedis(clients);
    // Fail closed: without Redis this process cannot share rooms or limits. Only the error class is kept.
    if (failure !== null) throw new Error(`scaling: redis did not answer at startup (${errorName(failure.error)})`);
    this.health.ok();
    this.#timer = setInterval(() => {
      void this.heartbeat();
    }, this.#timing.beatMs);
    this.#timer.unref();
  }

  // One heartbeat: probe, recover after an outage, refresh leases. Exposed for tests and operators.
  async heartbeat(): Promise<void> {
    if (this.#beating || this.#stopped || !this.#started) return;
    this.#beating = true;
    try {
      await this.#beatAll(this.health.state === 'down');
      this.health.ok();
    } catch (error) {
      this.health.fail(error);
    } finally {
      this.#beating = false;
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    for (const limiter of [...this.#limiters]) limiter.stop();
    await Promise.all([...this.#seats].map((seats) => seats.stop()));
    this.#seats.clear();
    const [own, ...colyseus] = this.#deps.clients ?? [];
    if (own !== undefined) await close(own);
    // Colyseus quits these during its shutdown; anything still open (it never got them) is dropped.
    for (const client of colyseus) if (client.status !== 'end') client.disconnect();
  }

  // Retries with capped backoff until every connection answers and the first heartbeat lands; the last error once the deadline passes.
  async #waitForRedis(clients: readonly Redis[]): Promise<{ readonly error: unknown } | null> {
    const now = this.#deps.now ?? Date.now;
    const deadline = now() + this.#timing.startTimeoutMs;
    const logEvery = this.#timing.waitLogMs ?? 30_000;
    let loggedAt = -Infinity;
    for (let attempt = 1; ; attempt++) {
      try {
        await Promise.all(clients.map((client) => ready(client, DEFAULT_TUNING.connectTimeoutMs)));
        await Promise.all(clients.map((client) => client.ping()));
        await this.#beatAll(false);
        if (attempt > 1) log.info('scaling: redis answered, starting');
        return null;
      } catch (error) {
        if (now() >= deadline || this.#stopped) return { error };
        if (now() - loggedAt >= logEvery) {
          loggedAt = now();
          log.warn('scaling: waiting for redis before accepting players', { error: errorName(error), attempt });
        }
        await sleep(retryDelay(attempt));
      }
    }
  }

  async #beatAll(recovering: boolean): Promise<void> {
    await this.#deps.runner.pipeline([['ping']]);
    for (const seats of [...this.#seats]) {
      if (seats.stopped) {
        this.#seats.delete(seats);
        continue;
      }
      if (recovering) await seats.recover();
      else await seats.beat();
    }
  }
}

async function close(client: Redis): Promise<void> {
  if (client.status === 'ready') {
    try {
      await client.quit();
      return;
    } catch {
      // Fall through to a hard disconnect.
    }
  }
  if (client.status !== 'end') client.disconnect();
}

// Local mode without a Redis URL; otherwise RedisPresence, RedisDriver and Redis-backed limits.
export function createScaling(options: ScalingOptions = {}): Scaling {
  const publicAddress = checkedAddress(options.publicAddress);
  if (options.redisUrl === undefined || options.redisUrl === null || options.redisUrl === '') return new LocalScaling(publicAddress);
  const endpoint = parseRedisUrl(options.redisUrl);
  if (options.production === true && !endpoint.tls && !isLoopbackHost(endpoint.host)) {
    throw new Error('REDIS_URL must use rediss:// unless Redis is on loopback');
  }
  if (options.keySecret === undefined || options.keySecret === null) throw new Error('SCALING_KEY_SECRET is required with REDIS_URL');
  const keys = new NetworkKeys(options.keySecret);
  const own = new Redis(redisOptions(endpoint, 'commands'));
  const presenceClient = new Redis(redisOptions(endpoint, 'presence'));
  const driverClient = new Redis(redisOptions(endpoint, 'driver'));
  // Failures surface through commands and the breaker; this only keeps ioredis from printing them.
  own.on('error', () => undefined);
  return new RedisScaling({
    runner: ioredisRunner(own),
    keys,
    presence: new RedisPresence(presenceClient),
    driver: new RedisDriver(driverClient),
    publicAddress,
    clients: [own, presenceClient, driverClient],
    ...(options.timing === undefined ? {} : { timing: options.timing }),
  });
}
