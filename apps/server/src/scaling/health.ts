// Circuit breaker shared by every Redis-backed limit in a process: while it is not 'up', nothing waits on Redis.
import { log } from '../logger.js';
import { errorName } from './redis.js';

// starting: before the first heartbeat; down: a command failed and the heartbeat has not recovered yet.
export type RedisState = 'starting' | 'up' | 'down';

export class RedisHealth {
  #state: RedisState = 'starting';

  get state(): RedisState {
    return this.#state;
  }

  get up(): boolean {
    return this.#state === 'up';
  }

  // Trips the breaker; logged once per outage with the error class only.
  fail(error: unknown): void {
    if (this.#state === 'down') return;
    const was = this.#state;
    this.#state = 'down';
    if (was === 'up') log.warn('scaling: redis limits degraded, using per-process limits', { error: errorName(error) });
  }

  // Only the heartbeat calls this, after it has rewritten any state the outage left stale.
  ok(): void {
    if (this.#state === 'up') return;
    if (this.#state === 'down') log.info('scaling: redis limits restored');
    this.#state = 'up';
  }
}
