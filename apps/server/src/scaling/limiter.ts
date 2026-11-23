// Per-network fixed-window rate limits: in memory (one process) or in Redis (every process shares one window).
import { z } from 'zod';
import { FixedWindowLimiter } from '../rateLimit.js';
import type { RedisHealth } from './health.js';
import { isNetworkKey, rateKey, type NetworkKeys } from './keys.js';
import type { CommandRunner } from './redis.js';

export interface RateLimiter {
  // Counts one hit for the key; resolves true while the key is within its limit. Never rejects.
  take(key: string): Promise<boolean>;
  stop(): void;
}

export interface LimitSpec {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

const NAME = /^[a-z][A-Za-z0-9]{0,31}$/;
// Keys the in-memory fallback may track, the same cap as FixedWindowLimiter's default.
export const FALLBACK_MAX_KEYS = 50_000;

export function assertLimitSpec(spec: LimitSpec): void {
  if (!NAME.test(spec.name)) throw new RangeError('limiter name must be 1-32 letters or digits, starting lowercase');
  if (!Number.isSafeInteger(spec.limit) || spec.limit < 1 || spec.limit > 1_000_000) throw new RangeError('limiter limit must be 1-1,000,000');
  if (!Number.isSafeInteger(spec.windowMs) || spec.windowMs < 100 || spec.windowMs > 86_400_000) {
    throw new RangeError('limiter window must be 100 ms to 24 h');
  }
}

// Today's per-process behaviour behind the async interface.
export class LocalRateLimiter implements RateLimiter {
  readonly #inner: FixedWindowLimiter;

  constructor(
    readonly spec: LimitSpec,
    now: () => number = Date.now,
  ) {
    assertLimitSpec(spec);
    this.#inner = new FixedWindowLimiter(spec.limit, spec.windowMs, FALLBACK_MAX_KEYS, now);
  }

  take(key: string): Promise<boolean> {
    return Promise.resolve(isNetworkKey(key) && this.#inner.take(key));
  }

  stop(): void {
    this.#inner.stop();
  }
}

const Count = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export interface RedisLimiterDeps {
  readonly runner: CommandRunner;
  readonly health: RedisHealth;
  readonly keys: NetworkKeys;
  readonly now?: () => number;
}

// One window per network shared by every process: MULTI INCR + PEXPIRE NX. Falls back to a
// per-process window with the same limit while Redis is unhealthy.
export class RedisRateLimiter implements RateLimiter {
  readonly #deps: RedisLimiterDeps;
  readonly #fallback: FixedWindowLimiter;

  constructor(
    readonly spec: LimitSpec,
    deps: RedisLimiterDeps,
  ) {
    assertLimitSpec(spec);
    this.#deps = deps;
    this.#fallback = new FixedWindowLimiter(spec.limit, spec.windowMs, FALLBACK_MAX_KEYS, deps.now ?? Date.now);
  }

  async take(key: string): Promise<boolean> {
    if (!isNetworkKey(key)) return false;
    const { health, runner, keys } = this.#deps;
    if (!health.up) return this.#fallback.take(key);
    const redisKey = rateKey(this.spec.name, keys.token(key));
    try {
      // INCR keeps an existing TTL; PEXPIRE NX starts the window on the first hit and repairs a key without one.
      const replies = await runner.multi([
        ['incr', redisKey],
        ['pexpire', redisKey, this.spec.windowMs, 'NX'],
      ]);
      return Count.parse(replies[0]) <= this.spec.limit;
    } catch (error) {
      health.fail(error);
      return this.#fallback.take(key);
    }
  }

  stop(): void {
    this.#fallback.stop();
  }
}
