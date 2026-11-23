import type { RandomSource } from '@byzantine-council/shared';

const UINT32 = 2 ** 32;

// Seeded mulberry32 for reproducible bot behaviour in tests; never use it for secrets.
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
  return {
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32) {
        throw new RangeError('maxExclusive must be an integer in [1, 2^32]');
      }
      return Math.floor(next() * maxExclusive);
    },
  };
}

// Uniform integer in [min, max]; a reversed or empty range gives min.
export function between(rng: RandomSource, min: number, max: number): number {
  return max <= min ? min : min + rng.int(max - min + 1);
}

// True with the given chance in percent.
export function chance(rng: RandomSource, percent: number): boolean {
  return percent > 0 && rng.int(100) < percent;
}

export function pickOne<T>(rng: RandomSource, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[rng.int(items.length)];
}
