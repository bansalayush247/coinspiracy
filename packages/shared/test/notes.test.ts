import { describe, expect, it } from 'vitest';
import { MAX_NOTE_AMOUNT, MAX_NOTE_BITS } from '../src/constants.js';
import { applySpend, checkSpend, isDenomination, toDenominations } from '../src/notes.js';
import type { Result } from '../src/result.js';

const MAX = 2 ** 20;
// Every valid note value, 2^0 through 2^20.
const DENOMINATIONS: readonly number[] = Array.from({ length: 21 }, (_, bit) => 2 ** bit);
const DENOMINATION_SET: ReadonlySet<number> = new Set(DENOMINATIONS);

// Real Set whose mutators throw, so any write to an input fails the test.
function lockedSet(ids: readonly string[]): ReadonlySet<string> {
  const set = new Set(ids);
  const refuse = (): never => {
    throw new Error('input set was mutated');
  };
  Object.assign(set, { add: refuse, delete: refuse, clear: refuse });
  return Object.freeze(set);
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

// Null when a split meets the spec, otherwise why it does not.
function splitProblem(amount: number, notes: readonly number[]): string | null {
  let sum = 0;
  let previous = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    if (!DENOMINATION_SET.has(note)) return `${note} is not a denomination`;
    if (note >= previous) return 'notes are not strictly descending';
    previous = note;
    sum += note;
  }
  return sum === amount ? null : `notes sum to ${sum}`;
}

describe('note constants', () => {
  it('caps notes at 2^20', () => {
    expect(MAX_NOTE_BITS).toBe(20);
    expect(MAX_NOTE_AMOUNT).toBe(MAX);
  });
});

describe('toDenominations', () => {
  const SPLITS: readonly { label: string; amount: number; notes: readonly number[] }[] = [
    { label: '1', amount: 1, notes: [1] },
    { label: '2', amount: 2, notes: [2] },
    { label: '3', amount: 3, notes: [2, 1] },
    { label: '64', amount: 64, notes: [64] },
    { label: '100', amount: 100, notes: [64, 32, 4] },
    { label: '2^20', amount: MAX, notes: [MAX] },
    {
      label: '2^20 - 1',
      amount: MAX - 1,
      notes: Array.from({ length: 20 }, (_, index) => 2 ** (19 - index)),
    },
  ];

  it.each(SPLITS)('splits $label into distinct powers of two, largest first', ({ amount, notes }) => {
    const split = toDenominations(amount);
    expect(split).toEqual(notes);
    expect(split.reduce((sum, note) => sum + note, 0)).toBe(amount);
    expect(new Set(split).size).toBe(split.length);
    expect(split).toEqual([...split].sort((a, b) => b - a));
    expect(split.every((note) => isDenomination(note))).toBe(true);
  });

  it('splits 2^20 - 1 into all twenty smaller notes', () => {
    expect(toDenominations(MAX - 1)).toHaveLength(20);
  });

  it('splits every amount to 2^16, a stride to 2^20 and every power-of-two edge', () => {
    const amounts: number[] = [];
    for (let amount = 1; amount <= 2 ** 16; amount++) amounts.push(amount);
    for (let amount = 2 ** 16 + 1; amount <= MAX; amount += 257) amounts.push(amount);
    for (const power of DENOMINATIONS) {
      for (const amount of [power - 1, power, power + 1]) {
        if (amount >= 1 && amount <= MAX) amounts.push(amount);
      }
    }
    const failures: string[] = [];
    for (const amount of amounts) {
      const problem = splitProblem(amount, toDenominations(amount));
      if (problem !== null) failures.push(`${amount}: ${problem}`);
    }
    expect(failures).toEqual([]);
    expect(amounts).toContain(MAX);
  });

  const INVALID_AMOUNTS: readonly { label: string; amount: number }[] = [
    { label: '0', amount: 0 },
    { label: '-0', amount: -0 },
    { label: '-1', amount: -1 },
    { label: '-2^20', amount: -MAX },
    { label: '0.5', amount: 0.5 },
    { label: '1.5', amount: 1.5 },
    { label: '2^20 - 0.5', amount: MAX - 0.5 },
    { label: 'NaN', amount: Number.NaN },
    { label: 'Infinity', amount: Number.POSITIVE_INFINITY },
    { label: '-Infinity', amount: Number.NEGATIVE_INFINITY },
    { label: '2^20 + 1', amount: MAX + 1 },
    { label: '2^21', amount: 2 ** 21 },
    { label: 'MAX_SAFE_INTEGER', amount: Number.MAX_SAFE_INTEGER },
    { label: '2^53', amount: 2 ** 53 },
    { label: '1e21', amount: 1e21 },
  ];

  it.each(INVALID_AMOUNTS)('throws RangeError for $label', ({ amount }) => {
    expect(() => toDenominations(amount)).toThrow(RangeError);
  });

  const NON_NUMBERS: readonly { label: string; value: unknown }[] = [
    { label: "the string '4'", value: '4' },
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'true', value: true },
    { label: 'the bigint 4n', value: 4n },
    { label: 'an array', value: [4] },
    { label: 'an object', value: { amount: 4 } },
  ];

  it.each(NON_NUMBERS)('throws RangeError for $label', ({ value }) => {
    expect(() => toDenominations(value as number)).toThrow(RangeError);
  });

  it('returns a fresh array on every call', () => {
    const first = toDenominations(3);
    first.push(99);
    expect(toDenominations(3)).toEqual([2, 1]);
  });
});

describe('isDenomination', () => {
  it.each(DENOMINATIONS)('is true for %i', (value) => {
    expect(isDenomination(value)).toBe(true);
  });

  const NON_DENOMINATIONS: readonly { label: string; value: number }[] = [
    { label: '0', value: 0 },
    { label: '-0', value: -0 },
    { label: '-1', value: -1 },
    { label: '-2', value: -2 },
    { label: '-1024', value: -1024 },
    { label: '3', value: 3 },
    { label: '5', value: 5 },
    { label: '6', value: 6 },
    { label: '7', value: 7 },
    { label: '12', value: 12 },
    { label: '100', value: 100 },
    { label: '1023', value: 1023 },
    { label: '1025', value: 1025 },
    { label: '2^20 - 1', value: MAX - 1 },
    { label: '2^20 + 1', value: MAX + 1 },
    { label: '2^21, a power of two above the range', value: 2 ** 21 },
    { label: '2^30', value: 2 ** 30 },
    { label: '2^53', value: 2 ** 53 },
    { label: '0.5, a power of two below 1', value: 0.5 },
    { label: '0.25', value: 0.25 },
    { label: '1.5', value: 1.5 },
    { label: '2.5', value: 2.5 },
    { label: 'Number.EPSILON', value: Number.EPSILON },
    { label: 'Number.MIN_VALUE', value: Number.MIN_VALUE },
    { label: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
  ];

  it.each(NON_DENOMINATIONS)('is false for $label', ({ value }) => {
    expect(isDenomination(value)).toBe(false);
  });

  it('matches the denomination table for every integer from -64 to 2^21', () => {
    const wrong: number[] = [];
    for (let value = -64; value <= 2 ** 21; value++) {
      if (isDenomination(value) !== DENOMINATION_SET.has(value)) wrong.push(value);
    }
    expect(wrong).toEqual([]);
  });

  const NON_NUMBERS: readonly { label: string; value: unknown }[] = [
    { label: "the string '2'", value: '2' },
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'true', value: true },
    { label: 'the bigint 2n', value: 2n },
    { label: 'an array', value: [2] },
  ];

  it.each(NON_NUMBERS)('is false for $label', ({ value }) => {
    expect(isDenomination(value as number)).toBe(false);
  });
});

describe('checkSpend', () => {
  const wallet = (): ReadonlySet<string> => lockedSet(['n1', 'n2', 'n3']);

  it('rejects an empty spend with emptySpend', () => {
    expect(checkSpend(wallet(), Object.freeze([]))).toStrictEqual({ ok: false, error: 'emptySpend' });
    expect(checkSpend(lockedSet([]), [])).toStrictEqual({ ok: false, error: 'emptySpend' });
  });

  it.each([
    { label: 'an adjacent repeat', ids: ['n1', 'n1'] },
    { label: 'a non-adjacent repeat', ids: ['n1', 'n2', 'n1'] },
    { label: 'a triple repeat', ids: ['n3', 'n3', 'n3'] },
  ])('rejects $label with duplicateNote', ({ ids }) => {
    expect(checkSpend(wallet(), Object.freeze(ids))).toStrictEqual({
      ok: false,
      error: 'duplicateNote',
    });
  });

  it('reports duplicateNote whether or not the repeated note exists', () => {
    const known = checkSpend(wallet(), ['n1', 'n1']);
    expect(known).toStrictEqual({ ok: false, error: 'duplicateNote' });
    expect(checkSpend(wallet(), ['ghost', 'ghost'])).toStrictEqual(known);
    expect(checkSpend(lockedSet([]), ['ghost', 'ghost'])).toStrictEqual(known);
  });

  it.each([
    { label: 'an unknown id', ids: ['ghost'] },
    { label: 'a case variant of a real id', ids: ['N1'] },
    { label: 'a real id with a trailing space', ids: ['n1 '] },
    { label: 'the empty string', ids: [''] },
    { label: 'one unknown id among real ones', ids: ['n1', 'ghost', 'n2'] },
  ])('rejects $label with noteUnavailable', ({ ids }) => {
    expect(checkSpend(wallet(), Object.freeze(ids))).toStrictEqual({
      ok: false,
      error: 'noteUnavailable',
    });
  });

  it('rejects any spend from an empty wallet with noteUnavailable', () => {
    expect(checkSpend(lockedSet([]), ['n1'])).toStrictEqual({ ok: false, error: 'noteUnavailable' });
  });

  it('gives unknown and already-spent notes the identical error', () => {
    const afterSpend = unwrap(applySpend(wallet(), ['n1']));
    const spentProbe = checkSpend(afterSpend, ['n1']);
    const unknownProbe = checkSpend(afterSpend, ['never-minted']);
    expect(spentProbe).toStrictEqual({ ok: false, error: 'noteUnavailable' });
    expect(unknownProbe).toStrictEqual(spentProbe);
  });

  it('accepts distinct unspent ids and returns them in the order given', () => {
    expect(checkSpend(wallet(), Object.freeze(['n3', 'n1']))).toStrictEqual({
      ok: true,
      value: ['n3', 'n1'],
    });
  });

  it('accepts spending the whole wallet at once', () => {
    expect(checkSpend(wallet(), ['n1', 'n2', 'n3'])).toStrictEqual({
      ok: true,
      value: ['n1', 'n2', 'n3'],
    });
  });

  it('never mutates the unspent set or the id list', () => {
    const unspent = lockedSet(['n1', 'n2']);
    const ids = Object.freeze(['n1']);
    checkSpend(unspent, ids);
    checkSpend(unspent, Object.freeze(['n1', 'n1']));
    checkSpend(unspent, Object.freeze(['ghost']));
    expect(Array.from(unspent)).toEqual(['n1', 'n2']);
    expect(ids).toEqual(['n1']);
  });
});

describe('applySpend', () => {
  it('returns a new set without the spent ids', () => {
    const unspent = lockedSet(['n1', 'n2', 'n3']);
    const next = unwrap(applySpend(unspent, Object.freeze(['n1', 'n3'])));
    expect(next).toBeInstanceOf(Set);
    expect(next).not.toBe(unspent);
    expect(Array.from(next)).toEqual(['n2']);
    expect(Array.from(unspent)).toEqual(['n1', 'n2', 'n3']);
  });

  it('returns an empty set after spending every note', () => {
    const next = unwrap(applySpend(lockedSet(['n1', 'n2']), ['n2', 'n1']));
    expect(next.size).toBe(0);
  });

  it('keeps the input intact when the caller changes the returned set', () => {
    const unspent = lockedSet(['n1', 'n2']);
    const next = unwrap(applySpend(unspent, ['n1']));
    next.add('forged');
    next.delete('n2');
    expect(Array.from(unspent)).toEqual(['n1', 'n2']);
  });

  it.each([
    { label: 'an empty spend', ids: [], error: 'emptySpend' },
    { label: 'a repeated note', ids: ['n1', 'n1'], error: 'duplicateNote' },
    { label: 'an unknown note', ids: ['ghost'], error: 'noteUnavailable' },
  ])('returns $error for $label and spends nothing', ({ ids, error }) => {
    const unspent = lockedSet(['n1', 'n2']);
    expect(applySpend(unspent, Object.freeze(ids))).toStrictEqual({ ok: false, error });
    expect(Array.from(unspent)).toEqual(['n1', 'n2']);
  });

  it('spends nothing when one id in the batch is unavailable', () => {
    const unspent = lockedSet(['n1', 'n2']);
    expect(applySpend(unspent, ['n1', 'ghost'])).toStrictEqual({ ok: false, error: 'noteUnavailable' });
    expect(Array.from(unspent)).toEqual(['n1', 'n2']);
    expect(Array.from(unwrap(applySpend(unspent, ['n1'])))).toEqual(['n2']);
  });

  it('rejects a double spend of the same note on the second call', () => {
    const afterFirst = unwrap(applySpend(lockedSet(['n1', 'n2']), ['n1']));
    expect(applySpend(afterFirst, ['n1'])).toStrictEqual({ ok: false, error: 'noteUnavailable' });
    expect(applySpend(afterFirst, ['n2', 'n1'])).toStrictEqual({
      ok: false,
      error: 'noteUnavailable',
    });
    expect(Array.from(afterFirst)).toEqual(['n2']);
  });

  it('rejects the same note twice within one spend', () => {
    expect(applySpend(lockedSet(['n1']), ['n1', 'n1'])).toStrictEqual({
      ok: false,
      error: 'duplicateNote',
    });
  });

  it('is pure, so only the returned set records the spend', () => {
    const unspent = lockedSet(['n1', 'n2']);
    const first = applySpend(unspent, ['n1']);
    expect(applySpend(unspent, ['n1'])).toStrictEqual(first);
    expect(Array.from(unspent)).toEqual(['n1', 'n2']);
  });

  it('spends a minted wallet note by note and refuses every replay', () => {
    const ids = toDenominations(MAX - 1).map((value) => `note-${value}`);
    let unspent: ReadonlySet<string> = lockedSet(ids);
    const spent: string[] = [];
    for (const id of ids) {
      unspent = unwrap(applySpend(unspent, [id]));
      spent.push(id);
      for (const old of spent) {
        expect(applySpend(unspent, [old])).toStrictEqual({ ok: false, error: 'noteUnavailable' });
      }
    }
    expect(unspent.size).toBe(0);
  });
});
