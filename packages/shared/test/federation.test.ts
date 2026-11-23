import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, MIN_PLAYERS } from '../src/constants.js';
import { byzantineCount, isHalted, maxFaulty, threshold } from '../src/federation.js';

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// Values an untyped caller could send where a count is expected.
const NOT_NUMBERS: readonly unknown[] = ['5', '', null, undefined, true, 5n, [5], {}];

describe('maxFaulty and threshold', () => {
  it.each([
    { n: 1, f: 0, t: 1 },
    { n: 2, f: 0, t: 2 },
    { n: 3, f: 0, t: 3 },
    { n: 4, f: 1, t: 3 },
    { n: 5, f: 1, t: 4 },
    { n: 6, f: 1, t: 5 },
    { n: 7, f: 2, t: 5 },
    { n: 8, f: 2, t: 6 },
    { n: 9, f: 2, t: 7 },
  ])('n=$n tolerates $f faulty and needs $t signatures', ({ n, f, t }) => {
    expect(maxFaulty(n)).toBe(f);
    expect(threshold(n)).toBe(t);
  });

  it('follows floor((n-1)/3) and n - maxFaulty(n) for n=1..1000', () => {
    for (const n of range(1, 1000)) {
      expect(maxFaulty(n), `n=${n}`).toBe(Math.floor((n - 1) / 3));
      expect(threshold(n), `n=${n}`).toBe(n - maxFaulty(n));
    }
  });

  it('keeps n >= 3f + 1 with f as large as possible (n=1..20)', () => {
    for (const n of range(1, 20)) {
      const f = maxFaulty(n);
      expect(3 * f + 1, `n=${n}`).toBeLessThanOrEqual(n);
      expect(3 * (f + 1) + 1, `n=${n}`).toBeGreaterThan(n);
    }
  });

  it('never lets f Byzantines reach the threshold alone (n=1..20)', () => {
    for (const n of range(1, 20)) {
      expect(maxFaulty(n), `n=${n}`).toBeLessThan(threshold(n));
    }
  });

  it('always lets the n - f honest members reach the threshold alone (n=1..20)', () => {
    for (const n of range(1, 20)) {
      expect(n - maxFaulty(n), `n=${n}`).toBeGreaterThanOrEqual(threshold(n));
    }
  });

  it('makes any two quorums share more than f members, so an honest one (n=1..20)', () => {
    for (const n of range(1, 20)) {
      expect(2 * threshold(n) - n, `n=${n}`).toBeGreaterThan(maxFaulty(n));
    }
  });

  it('never raises the threshold when the federation shrinks (n=1..20)', () => {
    for (const n of range(2, 20)) {
      expect(threshold(n - 1), `n=${n}`).toBeLessThanOrEqual(threshold(n));
    }
  });

  it('is exact at Number.MAX_SAFE_INTEGER', () => {
    expect(maxFaulty(Number.MAX_SAFE_INTEGER)).toBe(3002399751580330);
    expect(threshold(Number.MAX_SAFE_INTEGER)).toBe(6004799503160661);
  });

  it.each([0, -1, -9, 0.5, 1.5, 4.000001, Number.EPSILON, NaN, Infinity, -Infinity])(
    'throws RangeError for %s',
    (n) => {
      expect(() => maxFaulty(n)).toThrow(RangeError);
      expect(() => threshold(n)).toThrow(RangeError);
    },
  );

  it('throws RangeError for non-number values', () => {
    for (const value of NOT_NUMBERS) {
      expect(() => maxFaulty(value as number)).toThrow(RangeError);
      expect(() => threshold(value as number)).toThrow(RangeError);
    }
  });
});

describe('byzantineCount', () => {
  it('uses the 5..9 player bounds', () => {
    expect(MIN_PLAYERS).toBe(5);
    expect(MAX_PLAYERS).toBe(9);
  });

  it.each([
    { players: 5, byzantine: 1 },
    { players: 6, byzantine: 1 },
    { players: 7, byzantine: 2 },
    { players: 8, byzantine: 2 },
    { players: 9, byzantine: 2 },
  ])('deals $byzantine Byzantine for $players players', ({ players, byzantine }) => {
    expect(byzantineCount(players)).toBe(byzantine);
    expect(byzantineCount(players)).toBe(maxFaulty(players));
  });

  it.each([4, 10, 0, 1, 3, -5, 100, 5.5, 8.999, NaN, Infinity, -Infinity])(
    'throws RangeError for %s players',
    (players) => {
      expect(() => byzantineCount(players)).toThrow(RangeError);
    },
  );

  it('throws RangeError for non-number values', () => {
    for (const value of NOT_NUMBERS) {
      expect(() => byzantineCount(value as number)).toThrow(RangeError);
    }
  });
});

describe('isHalted', () => {
  it.each([
    { byzantine: 0, total: 0, halted: true },
    { byzantine: 0, total: 1, halted: false },
    { byzantine: 1, total: 1, halted: true },
    { byzantine: 0, total: 2, halted: false },
    { byzantine: 1, total: 2, halted: true },
    { byzantine: 2, total: 2, halted: true },
    { byzantine: 0, total: 3, halted: false },
    { byzantine: 1, total: 3, halted: true },
    { byzantine: 0, total: 4, halted: false },
    { byzantine: 1, total: 4, halted: false },
    { byzantine: 2, total: 4, halted: true },
    { byzantine: 1, total: 5, halted: false },
    { byzantine: 2, total: 5, halted: true },
    { byzantine: 1, total: 6, halted: false },
    { byzantine: 2, total: 6, halted: true },
    { byzantine: 2, total: 7, halted: false },
    { byzantine: 3, total: 7, halted: true },
    { byzantine: 2, total: 8, halted: false },
    { byzantine: 3, total: 8, halted: true },
    { byzantine: 2, total: 9, halted: false },
    { byzantine: 3, total: 9, halted: true },
    { byzantine: 9, total: 9, halted: true },
  ])('$byzantine Byzantine of $total members: halted=$halted', ({ byzantine, total, halted }) => {
    expect(isHalted(byzantine, total)).toBe(halted);
  });

  it('halts exactly when Byzantines are a third or more (total 1..20)', () => {
    for (const total of range(1, 20)) {
      for (const byzantine of range(0, total)) {
        expect(isHalted(byzantine, total), `${byzantine}/${total}`).toBe(3 * byzantine >= total);
      }
    }
  });

  it('halts exactly when Byzantines exceed maxFaulty (total 1..20)', () => {
    for (const total of range(1, 20)) {
      for (const byzantine of range(0, total)) {
        expect(isHalted(byzantine, total), `${byzantine}/${total}`).toBe(
          byzantine > maxFaulty(total),
        );
      }
    }
  });

  it.each([
    { byzantine: -1, total: 5 },
    { byzantine: 0, total: -1 },
    { byzantine: -1, total: -1 },
    { byzantine: 0.5, total: 3 },
    { byzantine: 1, total: 2.5 },
    { byzantine: NaN, total: 3 },
    { byzantine: 1, total: NaN },
    { byzantine: 1, total: Infinity },
    { byzantine: Infinity, total: Infinity },
    { byzantine: 4, total: 3 },
    { byzantine: 1, total: 0 },
    { byzantine: 10, total: 9 },
  ])('throws RangeError for $byzantine Byzantine of $total members', ({ byzantine, total }) => {
    expect(() => isHalted(byzantine, total)).toThrow(RangeError);
  });

  it('throws RangeError for non-number values', () => {
    for (const value of NOT_NUMBERS) {
      expect(() => isHalted(value as number, 5)).toThrow(RangeError);
      expect(() => isHalted(1, value as number)).toThrow(RangeError);
    }
  });
});

describe('fresh matches', () => {
  it.each(range(5, 9))('a fresh %i-player match is not halted', (n) => {
    expect(isHalted(byzantineCount(n), n)).toBe(false);
  });

  it.each(range(5, 9))(
    'the dealt Byzantines of a %i-player match cannot pass a proposal alone',
    (n) => {
      expect(byzantineCount(n)).toBeLessThan(threshold(n));
    },
  );

  it.each(range(5, 9))('one Byzantine beyond the dealt count would halt a %i-player match', (n) => {
    expect(isHalted(byzantineCount(n) + 1, n)).toBe(true);
  });
});
