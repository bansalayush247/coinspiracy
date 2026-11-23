import { afterEach, describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../src/rateLimit.js';

const limiters: FixedWindowLimiter[] = [];
function limiter(limit: number, windowMs: number, maxKeys: number, clock: { t: number }): FixedWindowLimiter {
  const l = new FixedWindowLimiter(limit, windowMs, maxKeys, () => clock.t);
  limiters.push(l);
  return l;
}

afterEach(() => {
  for (const l of limiters.splice(0)) l.stop();
});

describe('FixedWindowLimiter', () => {
  it('allows the limit per window and resets when the window ends', () => {
    const clock = { t: 0 };
    const l = limiter(3, 1000, 100, clock);
    expect([1, 2, 3, 4].map(() => l.take('a'))).toStrictEqual([true, true, true, false]);
    expect(l.take('b')).toBe(true);
    clock.t = 999;
    expect(l.take('a')).toBe(false);
    clock.t = 1000;
    expect(l.take('a')).toBe(true);
  });

  it('bounds memory by evicting the oldest key at the cap', () => {
    const clock = { t: 0 };
    const l = limiter(1, 60_000, 3, clock);
    for (const key of ['a', 'b', 'c', 'd']) l.take(key);
    expect(l.size).toBe(3);
    // 'a' was evicted, so it starts a fresh window.
    expect(l.take('a')).toBe(true);
    expect(l.take('d')).toBe(false);
  });

  it('sweeps expired keys', () => {
    const clock = { t: 0 };
    const l = limiter(1, 100, 100, clock);
    l.take('a');
    l.take('b');
    clock.t = 100;
    l.sweep();
    expect(l.size).toBe(0);
  });
});
