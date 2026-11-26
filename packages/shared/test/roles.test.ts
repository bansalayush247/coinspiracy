import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHalted } from '../src/federation.js';
import { assignRoles, cryptoRandom, type RandomSource } from '../src/roles.js';
import type { PlayerId, Role } from '../src/types.js';

const NAMES = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan'];

// Byzantine count the spec fixes for each match size.
const DEALS = [
  { n: 5, k: 1 },
  { n: 6, k: 1 },
  { n: 7, k: 2 },
  { n: 8, k: 2 },
  { n: 9, k: 2 },
] as const;

function seats(n: number): PlayerId[] {
  return NAMES.slice(0, n);
}

function byzantines(roles: ReadonlyMap<PlayerId, Role>): PlayerId[] {
  return [...roles].filter(([, role]) => role === 'byzantine').map(([id]) => id);
}

// The full role map, in input order, with exactly `team` Byzantine.
function dealtTo(ids: readonly PlayerId[], team: readonly PlayerId[]): [PlayerId, Role][] {
  return ids.map((id) => [id, team.includes(id) ? 'byzantine' : 'honest']);
}

// One draw per Fisher-Yates step: maxExclusive n, n-1, ..., 2.
function drawSizes(n: number): number[] {
  return Array.from({ length: n - 1 }, (_, step) => n - step);
}

// Replays fixed draws and records the maxExclusive of every call.
function scripted(draws: readonly number[]) {
  const queue = [...draws];
  const asked: number[] = [];
  const rng: RandomSource = {
    int(maxExclusive) {
      asked.push(maxExclusive);
      const value = queue.shift();
      if (value === undefined) throw new Error('script exhausted');
      return value;
    },
  };
  return { rng, asked, remaining: () => queue.length };
}

// Fast replay for the exhaustive loops.
function replay(draws: readonly number[]): RandomSource {
  let next = 0;
  return {
    int() {
      const value = draws[next];
      next += 1;
      if (value === undefined) throw new Error('script exhausted');
      return value;
    },
  };
}

// Mixed-radix decode: indexes 0..n!-1 cover every possible draw script once.
function scriptAt(index: number, n: number): number[] {
  const draws: number[] = [];
  let rest = index;
  for (const size of drawSizes(n)) {
    draws.push(rest % size);
    rest = Math.floor(rest / size);
  }
  return draws;
}

// j = i at every step, so nothing moves.
const keep: RandomSource = { int: (max) => max - 1 };
// j = 0 at every step, which rotates the order left by one seat.
const zero: RandomSource = { int: () => 0 };
// An arbitrary in-range pattern.
const half: RandomSource = { int: (max) => Math.floor(max / 2) };

// Makes crypto.getRandomValues yield the given 32-bit words in order.
function feedWords(words: readonly number[]) {
  const queue = [...words];
  return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
    const word = queue.shift();
    if (word === undefined) throw new Error('no scripted words left');
    if (!(array instanceof Uint32Array)) throw new TypeError('expected a Uint32Array');
    array.fill(word);
    return array;
  });
}

const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

// Real CSPRNG with a per-test call cap, so a stuck rejection loop fails instead of hanging.
beforeEach(() => {
  let calls = 0;
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
    calls += 1;
    if (calls > 100_000) throw new Error('getRandomValues called too often');
    return realGetRandomValues(array);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  expect(vi.isMockFunction(Reflect.get(globalThis.crypto, 'getRandomValues'))).toBe(false);
});

describe('assignRoles', () => {
  describe('Byzantine count', () => {
    it.each(DEALS)('deals exactly $k Byzantine to $n players with cryptoRandom', ({ n, k }) => {
      const ids = seats(n);
      for (let deal = 0; deal < 100; deal++) {
        expect(byzantines(assignRoles(ids, cryptoRandom))).toHaveLength(k);
        expect(byzantines(assignRoles(ids))).toHaveLength(k);
      }
    });

    it.each(DEALS)('deals exactly $k Byzantine to $n players with scripted sources', ({ n, k }) => {
      for (const rng of [keep, zero, half]) {
        expect(byzantines(assignRoles(seats(n), rng))).toHaveLength(k);
      }
    });

    it.each(DEALS)('never halts a freshly dealt $n-player match', ({ n }) => {
      for (let deal = 0; deal < 50; deal++) {
        const roles = assignRoles(seats(n));
        expect(isHalted(byzantines(roles).length, roles.size)).toBe(false);
      }
    });
  });

  describe('Fisher-Yates shuffle', () => {
    it.each(DEALS)('draws once from [0, i] for each i from n-1 down to 1 ($n players)', ({ n }) => {
      const script = scripted(Array.from({ length: n - 1 }, () => 0));
      assignRoles(seats(n), script.rng);
      expect(script.asked).toEqual(drawSizes(n));
      expect(script.remaining()).toBe(0);
    });

    // Durstenfeld swaps worked by hand; the first k seats of the shuffle are Byzantine.
    it.each([
      { n: 5, draws: [2, 0, 1, 1], team: ['dave'] },
      { n: 6, draws: [0, 3, 3, 1, 0], team: ['carol'] },
      { n: 7, draws: [6, 1, 4, 0, 2, 0], team: ['dave', 'frank'] },
      { n: 8, draws: [5, 6, 2, 4, 0, 1, 1], team: ['dave', 'heidi'] },
      { n: 9, draws: [3, 7, 0, 5, 1, 2, 0, 1], team: ['erin', 'ivan'] },
    ])('deals $team for $n players with draws $draws', ({ n, draws, team }) => {
      const ids = seats(n);
      const first = scripted(draws);
      const second = scripted(draws);
      expect([...assignRoles(ids, first.rng)]).toEqual(dealtTo(ids, team));
      expect([...assignRoles(ids, second.rng)]).toEqual(dealtTo(ids, team));
      expect(first.asked).toEqual(drawSizes(n));
    });

    it.each([
      { n: 5, team: ['alice'] },
      { n: 6, team: ['alice'] },
      { n: 7, team: ['alice', 'bob'] },
      { n: 8, team: ['alice', 'bob'] },
      { n: 9, team: ['alice', 'bob'] },
    ])('makes the first seats Byzantine when no draw swaps ($n players)', ({ n, team }) => {
      expect([...assignRoles(seats(n), keep)]).toEqual(dealtTo(seats(n), team));
    });

    it.each([
      { n: 5, team: ['bob'] },
      { n: 6, team: ['bob'] },
      { n: 7, team: ['bob', 'carol'] },
      { n: 8, team: ['bob', 'carol'] },
      { n: 9, team: ['bob', 'carol'] },
    ])('makes seats 1..k Byzantine when every draw is 0 ($n players)', ({ n, team }) => {
      expect([...assignRoles(seats(n), zero)]).toEqual(dealtTo(seats(n), team));
    });

    it.each([
      { n: 5, k: 1, scripts: 120, teams: 5, each: 24 },
      { n: 6, k: 1, scripts: 720, teams: 6, each: 120 },
      { n: 7, k: 2, scripts: 5040, teams: 21, each: 240 },
      { n: 8, k: 2, scripts: 40320, teams: 28, each: 1440 },
      { n: 9, k: 2, scripts: 362880, teams: 36, each: 10080 },
    ])(
      '$n players: each of the $teams teams is dealt exactly $each times over all $scripts scripts',
      ({ n, k, scripts, teams, each }) => {
        const ids = seats(n);
        const tally = new Map<string, number>();
        const sizes = new Set<number>();
        for (let index = 0; index < scripts; index++) {
          const team = byzantines(assignRoles(ids, replay(scriptAt(index, n))));
          sizes.add(team.length);
          const key = team.join(',');
          tally.set(key, (tally.get(key) ?? 0) + 1);
        }
        expect([...sizes]).toEqual([k]);
        expect(tally.size).toBe(teams);
        expect(new Set(tally.values())).toEqual(new Set([each]));
      },
    );

    it.each(DEALS)('can deal every one of $n seats Byzantine', ({ n, k }) => {
      const ids = seats(n);
      for (const [seat, id] of ids.entries()) {
        // Swap this seat to the front at its own step, keep everything else.
        const roles = assignRoles(ids, { int: (max) => (max - 1 === seat ? 0 : max - 1) });
        expect(roles.get(id), id).toBe('byzantine');
        expect(byzantines(roles)).toHaveLength(k);
      }
    });

    it.each(DEALS)('can deal every one of $n seats honest', ({ n, k }) => {
      const ids = seats(n);
      for (const [seat, id] of ids.entries()) {
        // Swap this seat to the back on the first step, keep everything else.
        const roles = assignRoles(ids, { int: (max) => (max === n ? seat : max - 1) });
        expect(roles.get(id), id).toBe('honest');
        expect(byzantines(roles)).toHaveLength(k);
      }
    });

    // A seat misses all 200 deals with probability at most (5/6)^200 < 1e-15.
    it.each(DEALS)(
      'deals every one of $n seats Byzantine within 200 cryptoRandom deals',
      ({ n }) => {
        const ids = seats(n);
        const dealt = new Set<PlayerId>();
        for (let deal = 0; deal < 200; deal++) {
          for (const id of byzantines(assignRoles(ids, cryptoRandom))) dealt.add(id);
        }
        expect(dealt).toEqual(new Set(ids));
      },
    );

    it('defaults to cryptoRandom backed by crypto.getRandomValues', () => {
      const spy = feedWords(Array.from({ length: 8 }, () => 0));
      expect(byzantines(assignRoles(seats(9)))).toEqual(['bob', 'carol']);
      expect(spy).toHaveBeenCalledTimes(8);
    });

    it('never touches Math.random', () => {
      const mathRandom = vi.spyOn(Math, 'random');
      assignRoles(seats(9));
      cryptoRandom.int(10);
      expect(mathRandom).not.toHaveBeenCalled();
    });
  });

  describe('map order', () => {
    it.each(DEALS)('lists the $n players in input order whatever the shuffle', ({ n }) => {
      const ids = seats(n).reverse();
      for (const rng of [keep, zero, half, cryptoRandom]) {
        expect([...assignRoles(ids, rng).keys()]).toEqual(ids);
      }
    });

    it('lists players identically for deals with different Byzantines', () => {
      const ids = seats(7);
      const kept = assignRoles(ids, keep);
      const rotated = assignRoles(ids, zero);
      expect(byzantines(kept)).not.toEqual(byzantines(rotated));
      expect([...kept.keys()]).toEqual([...rotated.keys()]);
    });
  });

  describe('immutability', () => {
    it('never mutates the player list', () => {
      const ids = Object.freeze(seats(9));
      const before = [...ids];
      expect(() => assignRoles(ids, half)).not.toThrow();
      expect(() => assignRoles(ids)).not.toThrow();
      expect(ids).toEqual(before);
    });
  });

  describe('errors', () => {
    it.each([0, 1, 4, 10, 12])('throws RangeError for %i players before drawing', (count) => {
      const ids = Array.from({ length: count }, (_, i) => `player-${i}`);
      const script = scripted([]);
      expect(() => assignRoles(ids, script.rng)).toThrow(RangeError);
      expect(script.asked).toEqual([]);
    });

    it.each([
      { label: 'adjacent', ids: ['alice', 'alice', 'bob', 'carol', 'dave'] },
      { label: 'first and last', ids: ['alice', 'bob', 'carol', 'dave', 'erin', 'alice'] },
      { label: 'all the same', ids: ['eve', 'eve', 'eve', 'eve', 'eve'] },
      { label: 'in a full match', ids: [...seats(8), 'heidi'] },
    ])('throws on duplicate ids ($label) before drawing', ({ ids }) => {
      const script = scripted(Array.from({ length: ids.length - 1 }, () => 0));
      expect(() => assignRoles(ids, script.rng)).toThrow(Error);
      expect(script.asked).toEqual([]);
    });

    it.each([
      { label: 'negative', rule: () => -1 },
      { label: 'equal to maxExclusive', rule: (max: number) => max },
      { label: 'far above the range', rule: () => 1000 },
      { label: 'fractional', rule: () => 0.5 },
      { label: 'NaN', rule: () => NaN },
      { label: 'Infinity', rule: () => Infinity },
      { label: '-Infinity', rule: () => -Infinity },
    ])('throws RangeError when the source returns a $label value', ({ rule }) => {
      for (const { n } of DEALS) {
        expect(() => assignRoles(seats(n), { int: rule })).toThrow(RangeError);
      }
    });

    it('validates every draw, not just the first', () => {
      // On the last step 2 is a real array index but outside [0, 1].
      const last = scripted([0, 0, 0, 2]);
      expect(() => assignRoles(seats(5), last.rng)).toThrow(RangeError);
      expect(last.asked).toEqual([5, 4, 3, 2]);

      const middle = scripted([0, 0, 0, 0, 7, 0, 0, 0]);
      expect(() => assignRoles(seats(9), middle.rng)).toThrow(RangeError);
      expect(middle.asked).toEqual([9, 8, 7, 6, 5]);
    });
  });
});

describe('cryptoRandom.int', () => {
  it.each([1, 2, 3, 5, 9, 10, 1000, 2 ** 31, 2 ** 31 + 1, 3 * 2 ** 30, 2 ** 32 - 1, 2 ** 32])(
    'returns integers in [0, %s)',
    (max) => {
      const values = Array.from({ length: 200 }, () => cryptoRandom.int(max));
      expect(values.filter((v) => !(Number.isInteger(v) && v >= 0 && v < max))).toEqual([]);
    },
  );

  // A value is missed with probability at most 9 * (8/9)^400 < 1e-19.
  it.each([2, 3, 5, 9])('produces every value in [0, %s) within 400 draws', (max) => {
    const seen = new Set(Array.from({ length: 400 }, () => cryptoRandom.int(max)));
    expect(seen.size).toBe(max);
  });

  it('maps each accepted word to word % maxExclusive', () => {
    const spy = feedWords([4294967294, 7, 0]);
    expect(cryptoRandom.int(3)).toBe(2);
    expect(cryptoRandom.int(3)).toBe(1);
    expect(cryptoRandom.int(3)).toBe(0);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  // limit = largest multiple of maxExclusive that fits in 32 bits.
  it.each([
    { max: 3, limit: 4294967295 },
    { max: 6, limit: 4294967292 },
    { max: 7, limit: 4294967292 },
    { max: 9, limit: 4294967292 },
    { max: 10, limit: 4294967290 },
    { max: 2 ** 31 + 1, limit: 2147483649 },
    { max: 3 * 2 ** 30, limit: 3221225472 },
  ])('skips words at or above $limit for maxExclusive $max', ({ max, limit }) => {
    expect(limit % max).toBe(0);
    expect(2 ** 32 - limit).toBeLessThan(max);
    const rejected = [limit, Math.floor((limit + 0xffffffff) / 2), 0xffffffff];
    const spy = feedWords([...rejected, limit - 1]);
    expect(cryptoRandom.int(max)).toBe(max - 1);
    expect(spy).toHaveBeenCalledTimes(rejected.length + 1);
  });

  it.each([1, 2, 8, 2 ** 16, 2 ** 31])('never rejects a word for power-of-two range %s', (max) => {
    const spy = feedWords([0xffffffff]);
    expect(cryptoRandom.int(max)).toBe(max - 1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('accepts maxExclusive 2**32 and returns every word unchanged', () => {
    const spy = feedWords([0xffffffff, 0, 123456789]);
    expect(cryptoRandom.int(2 ** 32)).toBe(0xffffffff);
    expect(cryptoRandom.int(2 ** 32)).toBe(0);
    expect(cryptoRandom.int(2 ** 32)).toBe(123456789);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it.each([
    0,
    -1,
    0.5,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    2 ** 32 + 1,
    2 ** 33,
    Number.MAX_SAFE_INTEGER,
  ])(
    'throws RangeError for maxExclusive %s without drawing',
    (max) => {
      const spy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
        throw new Error('drew randomness for an invalid range');
      });
      expect(() => cryptoRandom.int(max)).toThrow(RangeError);
      expect(spy).not.toHaveBeenCalled();
    },
  );

  // Naive modulo would put half the draws below 2**30; the true share is a third.
  it('stays unbiased where naive modulo would not (maxExclusive 3 * 2**30)', () => {
    let low = 0;
    for (let draw = 0; draw < 3000; draw++) {
      if (cryptoRandom.int(3 * 2 ** 30) < 2 ** 30) low += 1;
    }
    // Bernstein bound: |low - 1000| >= 200 has probability < 3e-12.
    expect(low).toBeGreaterThan(800);
    expect(low).toBeLessThan(1200);
  });
});
