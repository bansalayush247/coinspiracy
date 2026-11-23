import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { loadScalingConfig } from '../../src/scaling/config.js';
import { RedisHealth } from '../../src/scaling/health.js';
import { createScaling, holdSeat } from '../../src/scaling/index.js';
import { NetworkKeys } from '../../src/scaling/keys.js';
import { RedisRateLimiter } from '../../src/scaling/limiter.js';
import { RedisSeatCounter, type SeatTiming } from '../../src/scaling/seats.js';
import { FakeRedis } from './fakeRedis.js';

const SECRET = 's'.repeat(40);
const TIMING: SeatTiming = { leaseMs: 120_000, deadAfterMs: 30_000, pruneAfterMs: 120_000 };

function world() {
  let t = 1_000_000;
  const now = (): number => t;
  const redis = new FakeRedis(now);
  const keys = new NetworkKeys(SECRET);
  return {
    redis,
    keys,
    now,
    advance(ms: number) {
      t += ms;
    },
    // One "process": its own breaker and counters over the shared fake Redis.
    async process(max = 2) {
      const health = new RedisHealth();
      const seats = new RedisSeatCounter(max, { runner: redis, health, keys, now, timing: TIMING });
      await seats.beat();
      health.ok();
      const limiter = new RedisRateLimiter({ name: 'matchmake', limit: 3, windowMs: 60_000 }, { runner: redis, health, keys, now });
      return { health, seats, limiter };
    },
  };
}

describe('Redis rate limiter', () => {
  it('shares one window across processes', async () => {
    const w = world();
    const a = await w.process();
    const b = await w.process();
    expect(await a.limiter.take('198.18.0.1')).toBe(true);
    expect(await b.limiter.take('198.18.0.1')).toBe(true);
    expect(await a.limiter.take('198.18.0.1')).toBe(true);
    expect(await b.limiter.take('198.18.0.1')).toBe(false);
    expect(await b.limiter.take('198.18.0.2')).toBe(true);
    w.advance(60_001);
    expect(await a.limiter.take('198.18.0.1')).toBe(true);
  });

  it('never stores the network address, only a keyed token', async () => {
    const w = world();
    const a = await w.process();
    await a.limiter.take('198.18.0.77');
    expect(JSON.stringify(w.redis.commands)).not.toContain('198.18.0.77');
  });

  it('falls back to a per-process limit while Redis fails', async () => {
    const w = world();
    const a = await w.process();
    w.redis.down = true;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await a.limiter.take('198.18.0.1'));
    expect(results).toEqual([true, true, true, false, false]);
    expect(a.health.up).toBe(false);
  });
});

describe('Redis seat counter', () => {
  it('caps seats per network across processes and frees them on release', async () => {
    const w = world();
    const a = await w.process(2);
    const b = await w.process(2);
    expect(await a.seats.tryAcquire('198.18.1.1')).toBe(true);
    expect(await b.seats.tryAcquire('198.18.1.1')).toBe(true);
    expect(await a.seats.tryAcquire('198.18.1.1')).toBe(false);
    expect(await b.seats.count('198.18.1.1')).toBe(2);
    a.seats.release('198.18.1.1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await b.seats.tryAcquire('198.18.1.1')).toBe(true);
  });

  it('stops counting a crashed process once its heartbeat is stale', async () => {
    const w = world();
    const a = await w.process(1);
    const b = await w.process(1);
    expect(await a.seats.tryAcquire('198.18.2.1')).toBe(true);
    expect(await b.seats.tryAcquire('198.18.2.1')).toBe(false);
    // a "crashes": no more beats. b keeps beating.
    w.advance(31_000);
    await b.seats.beat();
    expect(await b.seats.tryAcquire('198.18.2.1')).toBe(true);
  });

  it('holds a seat until the socket closes, even if it closes mid-check', async () => {
    const w = world();
    const a = await w.process(1);
    const socket = new EventEmitter();
    expect(await holdSeat(a.seats, '198.18.3.1', socket)).toBe(true);
    expect(await a.seats.count('198.18.3.1')).toBe(1);
    socket.emit('close');
    expect(await a.seats.count('198.18.3.1')).toBe(0);
    const early = new EventEmitter();
    w.redis.gate();
    const pending = holdSeat(a.seats, '198.18.3.2', early);
    early.emit('close');
    w.redis.release();
    expect(await pending).toBe(true);
    expect(await a.seats.count('198.18.3.2')).toBe(0);
  });
});

describe('scaling setup', () => {
  it('stays in this process without Redis', () => {
    const scaling = createScaling();
    expect(scaling.mode).toBe('local');
    expect(scaling.healthy()).toBe(true);
  });

  it('demands TLS, a secret and a public address for Redis in production', () => {
    expect(() => loadScalingConfig({ REDIS_URL: 'redis://redis.internal:6379' }, true)).toThrow(/rediss/);
    expect(() => loadScalingConfig({ REDIS_URL: 'redis://127.0.0.1:6379' }, true)).toThrow(/SCALING_KEY_SECRET/);
    expect(() => loadScalingConfig({ REDIS_URL: 'redis://127.0.0.1:6379', SCALING_KEY_SECRET: SECRET }, true)).toThrow(/PUBLIC_ADDRESS/);
    expect(loadScalingConfig({ REDIS_URL: 'redis://127.0.0.1:6379', SCALING_KEY_SECRET: SECRET, PUBLIC_ADDRESS: 'play.example.org/colyseus/s1' }, true).redisUrl).toBe('redis://127.0.0.1:6379');
    expect(() => loadScalingConfig({ PUBLIC_ADDRESS: 'https://play.example.org' }, true)).toThrow(/PUBLIC_ADDRESS/);
  });
});
