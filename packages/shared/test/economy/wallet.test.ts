import { describe, expect, it } from 'vitest';
import { MAX_NOTE_AMOUNT, MAX_NOTE_BITS } from '../../src/constants.js';
import { toDenominations } from '../../src/notes.js';
import type { Result } from '../../src/result.js';
import {
  MAX_WALLET_BALANCE,
  MAX_WALLET_NOTES,
  CreditSchema,
  NoteSchema,
  NoteSelectionSchema,
  PaymentSchema,
  WalletSchema,
  balanceOf,
  credit,
  payWithNotes,
  validateWallet,
  walletFromAmount,
  type Payment,
  type Wallet,
} from '../../src/economy/index.js';

const MAX = 2 ** 20;
const DENOMINATIONS: readonly number[] = Array.from({ length: MAX_NOTE_BITS + 1 }, (_, bit) => 2 ** bit);

function unwrap<T, E extends string>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

function sum(notes: readonly number[]): number {
  return notes.reduce((total, note) => total + note, 0);
}

function desc(notes: readonly number[]): number[] {
  return [...notes].sort((a, b) => b - a);
}

function repeat(note: number, count: number): number[] {
  return Array.from({ length: count }, () => note);
}

// Untyped values for abuse cases, without scattering casts through the tests.
function asWallet(value: unknown): Wallet {
  return value as Wallet;
}

function asNumber(value: unknown): number {
  return value as number;
}

// [4, <hole>, 2]: index 1 is missing, not undefined.
function holey(): number[] {
  const notes = new Array<number>(3);
  notes[0] = 4;
  notes[2] = 2;
  return notes;
}

// Reference split written independently of the rules: whole 2^20 notes, then the binary digits of the rest.
function fewest(amount: number): number[] {
  const notes: number[] = [];
  let rest = amount;
  while (rest >= MAX) {
    notes.push(MAX);
    rest -= MAX;
  }
  for (let bit = MAX_NOTE_BITS - 1; bit >= 0; bit--) {
    if (Math.floor(rest / 2 ** bit) % 2 === 1) notes.push(2 ** bit);
  }
  return notes;
}

function counts(notes: readonly number[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const note of notes) map.set(note, (map.get(note) ?? 0) + 1);
  return map;
}

function isSubMultiset(part: readonly number[], whole: readonly number[]): boolean {
  const have = counts(whole);
  return [...counts(part)].every(([note, count]) => (have.get(note) ?? 0) >= count);
}

// Seeded generator so any failure reproduces from the printed seed.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

function shuffle(rng: () => number, notes: readonly number[]): number[] {
  const out = [...notes];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const a = out[i] ?? 0;
    out[i] = out[j] ?? 0;
    out[j] = a;
  }
  return out;
}

// Random valid wallet in random order, skewed toward small notes like real change.
function randomWallet(rng: () => number, maxNotes = MAX_WALLET_NOTES, maxBit = MAX_NOTE_BITS): number[] {
  const length = randInt(rng, maxNotes + 1);
  const notes: number[] = [];
  let total = 0;
  for (let i = 0; i < length; i++) {
    const bit = Math.min(randInt(rng, maxBit + 1), randInt(rng, maxBit + 1));
    const note = 2 ** bit;
    if (total + note > MAX_WALLET_BALANCE) continue;
    notes.push(note);
    total += note;
  }
  return shuffle(rng, notes);
}

function randomSubset(rng: () => number, notes: readonly number[]): number[] {
  return notes.filter(() => rng() < 0.4);
}

// What payWithNotes must answer, from the rule as written rather than the implementation's shortcut.
function expectedPayError(wallet: readonly number[], selection: readonly number[], price: number): string | null {
  if (sum(wallet) < price) return 'insufficientFunds';
  if (selection.length < 1 || selection.length > MAX_WALLET_NOTES) return 'invalidSelection';
  if (!isSubMultiset(selection, wallet)) return 'notInWallet';
  const paid = sum(selection);
  if (paid < price) return 'underpaid';
  if (selection.some((note) => paid - note >= price)) return 'overpaid';
  return null;
}

// Every invariant of a successful payment.
function checkPayment(wallet: readonly number[], price: number, payment: Payment, context: string): void {
  const before = sum(wallet);
  const paid = sum(payment.spent);
  expect(sum(payment.wallet), context).toBe(before - price);
  expect(paid - sum(payment.change), context).toBe(price);
  expect([...payment.change], context).toStrictEqual(paid === price ? [] : toDenominations(paid - price));
  expect(sum(payment.change), context).toBeLessThan(Math.min(...payment.spent));
  expect(paid - Math.min(...payment.spent), context).toBeLessThan(price);
  expect(isSubMultiset(payment.spent, wallet), context).toBe(true);
  expect([...payment.spent], context).toStrictEqual(desc(payment.spent));
  expect([...payment.wallet], context).toStrictEqual(desc(payment.wallet));
  expect(payment.wallet.length, context).toBeLessThanOrEqual(MAX_WALLET_NOTES);
  expect(validateWallet(payment.wallet), context).toStrictEqual({ ok: true, value: [...payment.wallet] });
  expect(PaymentSchema.safeParse(payment).success, context).toBe(true);
  const naive = wallet.length - payment.spent.length + payment.change.length;
  expect(payment.reissued, context).toBe(naive > MAX_WALLET_NOTES);
  if (payment.reissued) {
    expect([...payment.wallet], context).toStrictEqual(fewest(before - price));
  } else {
    const expected = new Map(counts(wallet));
    for (const note of payment.spent) expected.set(note, (expected.get(note) ?? 0) - 1);
    for (const note of payment.change) expected.set(note, (expected.get(note) ?? 0) + 1);
    const remaining = [...expected].flatMap(([note, count]) => repeat(note, count));
    expect([...payment.wallet], context).toStrictEqual(desc(remaining));
  }
}

// Invalid wallets: wrong type, wrong notes, too many notes or over the balance cap.
const INVALID_WALLETS: readonly { label: string; value: unknown }[] = [
  { label: 'undefined', value: undefined },
  { label: 'null', value: null },
  { label: 'a number', value: 4 },
  { label: 'a string', value: '4' },
  { label: 'an object', value: { notes: [4] } },
  { label: 'an array-like object', value: { length: 1, 0: 4 } },
  { label: 'a Set', value: new Set([4]) },
  { label: 'a typed array', value: Uint32Array.of(4) },
  { label: 'a hole', value: holey() },
  { label: 'a zero note', value: [0] },
  { label: 'a negative zero note', value: [-0] },
  { label: 'a negative note', value: [-4] },
  { label: 'a note that is not a power of two', value: [3] },
  { label: 'a fractional note', value: [0.5] },
  { label: 'a nearly whole note', value: [4.000_000_1] },
  { label: 'NaN', value: [Number.NaN] },
  { label: 'Infinity', value: [Number.POSITIVE_INFINITY] },
  { label: 'a note above 2^20', value: [2 ** 21] },
  { label: 'a string note', value: ['4'] },
  { label: 'a bigint note', value: [4n] },
  { label: 'a null note', value: [null] },
  { label: 'a nested array', value: [[4]] },
  { label: 'a boxed number', value: [new Number(4)] },
  { label: 'more than 64 notes', value: repeat(1, MAX_WALLET_NOTES + 1) },
  { label: 'a balance over the cap', value: [...fewest(MAX_WALLET_BALANCE), 1] },
  { label: 'a huge sparse array', value: new Array(2 ** 32 - 1) },
];

describe('wallet constants', () => {
  it('caps a wallet at 64 notes and 10,000,000 sats', () => {
    expect(MAX_WALLET_NOTES).toBe(64);
    expect(MAX_WALLET_BALANCE).toBe(10_000_000);
    expect(MAX_NOTE_AMOUNT).toBe(MAX);
  });

  it('fits the fewest notes for every allowed balance in 28 notes', () => {
    let most = 0;
    for (let whole = 0; whole * MAX <= MAX_WALLET_BALANCE; whole++) {
      const limit = Math.min(MAX - 1, MAX_WALLET_BALANCE - whole * MAX);
      // The most one-bits of any number up to limit: limit itself, or all ones one bit shorter.
      const shorter = Math.floor(Math.log2(Math.max(limit, 1)));
      const ones = Math.max(fewest(limit).length, shorter);
      most = Math.max(most, whole + ones);
    }
    expect(most).toBe(28);
    expect(most).toBeLessThanOrEqual(MAX_WALLET_NOTES / 2);
    expect(unwrap(walletFromAmount(8 * MAX + MAX - 1))).toHaveLength(28);
  });
});

describe('walletFromAmount', () => {
  it.each([
    { amount: 0, notes: [] },
    { amount: 1, notes: [1] },
    { amount: 3, notes: [2, 1] },
    { amount: 400, notes: [256, 128, 16] },
    { amount: 3000, notes: [2048, 512, 256, 128, 32, 16, 8] },
    { amount: MAX, notes: [MAX] },
    { amount: MAX + 1, notes: [MAX, 1] },
    { amount: 3 * MAX + 5, notes: [MAX, MAX, MAX, 4, 1] },
  ])('splits $amount into the fewest notes', ({ amount, notes }) => {
    expect(walletFromAmount(amount)).toStrictEqual({ ok: true, value: notes });
  });

  it('treats -0 as an empty wallet', () => {
    expect(walletFromAmount(-0)).toStrictEqual({ ok: true, value: [] });
  });

  it('reaches exactly the balance cap', () => {
    const wallet = unwrap(walletFromAmount(MAX_WALLET_BALANCE));
    expect(sum(wallet)).toBe(MAX_WALLET_BALANCE);
    expect([...wallet]).toStrictEqual(fewest(MAX_WALLET_BALANCE));
  });

  it('matches the reference split on seeded random amounts', () => {
    const rng = mulberry32(0x5eed01);
    for (let i = 0; i < 2_000; i++) {
      const amount = randInt(rng, MAX_WALLET_BALANCE + 1);
      expect([...unwrap(walletFromAmount(amount))], `amount ${amount}`).toStrictEqual(fewest(amount));
    }
  });

  it.each([
    { label: '-1', value: -1 },
    { label: '0.5', value: 0.5 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
    { label: 'the cap plus one', value: MAX_WALLET_BALANCE + 1 },
    { label: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
    { label: '2^53', value: 2 ** 53 },
    { label: "the string '5'", value: '5' },
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'a bigint', value: 5n },
    { label: 'an array', value: [5] },
  ])('refuses $label with invalidAmount', ({ value }) => {
    expect(walletFromAmount(asNumber(value))).toStrictEqual({ ok: false, error: 'invalidAmount' });
  });

  it('returns a fresh array every call', () => {
    const first = unwrap(walletFromAmount(3)) as number[];
    first.push(99);
    expect(unwrap(walletFromAmount(3))).toStrictEqual([2, 1]);
  });
});

describe('validateWallet', () => {
  it('accepts an empty wallet', () => {
    expect(validateWallet([])).toStrictEqual({ ok: true, value: [] });
  });

  it('builds a real hole for the abuse cases', () => {
    const notes = holey();
    expect(notes).toHaveLength(3);
    expect(1 in notes).toBe(false);
  });

  it('reads the length of an exotic array once and never past it', () => {
    let lengthReads = 0;
    const shifty = new Proxy([4], {
      get(target, key, receiver): unknown {
        if (key === 'length') {
          lengthReads++;
          return lengthReads === 1 ? 1 : 1e9;
        }
        const value: unknown = Reflect.get(target, key, receiver);
        return value;
      },
    });
    expect(validateWallet(shifty)).toStrictEqual({ ok: true, value: [4] });
    expect(lengthReads).toBe(1);
  });

  it('reads each selected note once, so a note cannot change after it is checked', () => {
    let noteReads = 0;
    const flipping = new Proxy([4], {
      get(target, key, receiver): unknown {
        if (key === '0') {
          noteReads++;
          return noteReads === 1 ? 4 : 3;
        }
        const value: unknown = Reflect.get(target, key, receiver);
        return value;
      },
    });
    expect(payWithNotes([4, 2], flipping, 3)).toStrictEqual({
      ok: true,
      value: { wallet: [2, 1], spent: [4], change: [1], reissued: false },
    });
    expect(noteReads).toBe(1);
  });

  it('returns a sorted copy and leaves the input alone', () => {
    const input = Object.freeze([1, 64, 4, 64, 1024]);
    const result = unwrap(validateWallet(input));
    expect(result).toStrictEqual([1024, 64, 64, 4, 1]);
    expect(result).not.toBe(input);
    expect(input).toStrictEqual([1, 64, 4, 64, 1024]);
  });

  it('accepts every denomination, 64 notes and a balance right at the cap', () => {
    expect(validateWallet(DENOMINATIONS).ok).toBe(true);
    expect(validateWallet(repeat(MAX, 9)).ok).toBe(true);
    expect(validateWallet(repeat(1, MAX_WALLET_NOTES)).ok).toBe(true);
    expect(validateWallet(fewest(MAX_WALLET_BALANCE)).ok).toBe(true);
  });

  it.each(INVALID_WALLETS)('rejects $label', ({ value }) => {
    expect(validateWallet(value)).toStrictEqual({ ok: false, error: 'invalidWallet' });
    expect(WalletSchema.safeParse(value).success).toBe(false);
  });

  it('agrees with WalletSchema on seeded random note lists', () => {
    const rng = mulberry32(0x5eed02);
    for (let i = 0; i < 500; i++) {
      const notes = Array.from({ length: randInt(rng, 70) }, () => (rng() < 0.9 ? 2 ** randInt(rng, 22) : randInt(rng, 100)));
      expect(validateWallet(notes).ok, JSON.stringify(notes)).toBe(WalletSchema.safeParse(notes).success);
    }
  });
});

describe('balanceOf', () => {
  it('adds up the notes in any order', () => {
    expect(balanceOf([])).toBe(0);
    expect(balanceOf([1, 1024, 2])).toBe(1027);
    expect(balanceOf(fewest(MAX_WALLET_BALANCE))).toBe(MAX_WALLET_BALANCE);
  });

  it.each(INVALID_WALLETS)('throws RangeError for $label', ({ value }) => {
    expect(() => balanceOf(asWallet(value))).toThrow(RangeError);
  });
});

describe('payWithNotes', () => {
  it('pays 400 sats with one note and gets change as fresh notes', () => {
    const wallet = Object.freeze(fewest(3000));
    const payment = unwrap(payWithNotes(wallet, Object.freeze([512]), 400));
    expect(payment).toStrictEqual({
      wallet: [2048, 256, 128, 64, 32, 32, 16, 16, 8],
      spent: [512],
      change: [64, 32, 16],
      reissued: false,
    });
    checkPayment(wallet, 400, payment, 'example');
  });

  it('pays the exact amount with no change', () => {
    const payment = unwrap(payWithNotes([256, 128, 16, 8, 4, 2], [2, 4, 8, 16], 30));
    expect(payment).toStrictEqual({ wallet: [256, 128], spent: [16, 8, 4, 2], change: [], reissued: false });
  });

  it('spends repeated notes when the wallet holds them', () => {
    const payment = unwrap(payWithNotes([4, 4, 2], [4, 4], 7));
    expect(payment).toStrictEqual({ wallet: [2, 1], spent: [4, 4], change: [1], reissued: false });
  });

  it('takes the selection in any order', () => {
    const a = payWithNotes([16, 8, 4, 2, 1], [1, 4, 8], 13);
    expect(a).toStrictEqual(payWithNotes([16, 8, 4, 2, 1], [8, 4, 1], 13));
    expect(unwrap(a).wallet).toStrictEqual([16, 2]);
  });

  it('lets a player break a big note for a small price', () => {
    const payment = unwrap(payWithNotes([MAX], [MAX], 1));
    expect(payment.change).toStrictEqual(toDenominations(MAX - 1));
    expect(payment.wallet).toStrictEqual(toDenominations(MAX - 1));
  });

  it('refuses an overpayment where a note could be dropped', () => {
    expect(payWithNotes([4, 2, 1], [4, 2, 1], 5)).toStrictEqual({ ok: false, error: 'overpaid' });
    expect(payWithNotes([8, 1], [8, 1], 8)).toStrictEqual({ ok: false, error: 'overpaid' });
    expect(payWithNotes([8, 8], [8, 8], 8)).toStrictEqual({ ok: false, error: 'overpaid' });
    expect(payWithNotes([64, 32, 1], [64, 32], 60)).toStrictEqual({ ok: false, error: 'overpaid' });
    expect(payWithNotes([64, 32, 1], [64], 60).ok).toBe(true);
  });

  it('refuses notes that do not cover the price', () => {
    expect(payWithNotes([4, 2, 1], [4], 5)).toStrictEqual({ ok: false, error: 'underpaid' });
    expect(payWithNotes([4, 2, 1], [2, 1], 7)).toStrictEqual({ ok: false, error: 'underpaid' });
  });

  it('refuses notes the wallet does not hold, counting repeats', () => {
    expect(payWithNotes([8, 4, 2], [16], 9)).toStrictEqual({ ok: false, error: 'notInWallet' });
    expect(payWithNotes([8, 4, 2], [4, 4], 8)).toStrictEqual({ ok: false, error: 'notInWallet' });
    expect(payWithNotes([4, 4, 2], [4, 4, 4], 9)).toStrictEqual({ ok: false, error: 'notInWallet' });
  });

  it('refuses a price the wallet cannot reach, whatever was selected', () => {
    expect(payWithNotes([4, 2], [4, 2], 7)).toStrictEqual({ ok: false, error: 'insufficientFunds' });
    expect(payWithNotes([], [1], 1)).toStrictEqual({ ok: false, error: 'insufficientFunds' });
    expect(payWithNotes([4], asWallet('junk'), 9)).toStrictEqual({ ok: false, error: 'insufficientFunds' });
  });

  it.each([
    { label: 'an empty selection', value: [] },
    { label: '65 notes', value: repeat(1, MAX_WALLET_NOTES + 1) },
    { label: 'a string', value: '4' },
    { label: 'null', value: null },
    { label: 'an array-like object', value: { length: 1, 0: 4 } },
    { label: 'a hole', value: holey() },
    { label: 'a non-denomination', value: [3] },
    { label: 'a zero note', value: [0, 4] },
    { label: 'a negative note', value: [-4, 8] },
    { label: 'a fraction', value: [4.5] },
    { label: 'NaN', value: [Number.NaN] },
    { label: 'a string note', value: ['4'] },
    { label: 'a note above 2^20', value: [2 ** 21] },
    { label: 'a huge sparse array', value: new Array(2 ** 32 - 1) },
  ])('refuses $label with invalidSelection', ({ value }) => {
    const wallet = Object.freeze(repeat(4, 8));
    expect(payWithNotes(wallet, asWallet(value), 4)).toStrictEqual({ ok: false, error: 'invalidSelection' });
  });

  it.each([
    { label: '0', value: 0 },
    { label: '-0', value: -0 },
    { label: '-5', value: -5 },
    { label: '1.5', value: 1.5 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: 'the cap plus one', value: MAX_WALLET_BALANCE + 1 },
    { label: "the string '4'", value: '4' },
    { label: 'null', value: null },
    { label: 'a bigint', value: 4n },
  ])('refuses a price of $label with invalidAmount', ({ value }) => {
    expect(payWithNotes([4, 4], [4], asNumber(value))).toStrictEqual({ ok: false, error: 'invalidAmount' });
  });

  it.each(INVALID_WALLETS)('refuses a wallet with $label before anything else', ({ value }) => {
    expect(payWithNotes(asWallet(value), [4], 4)).toStrictEqual({ ok: false, error: 'invalidWallet' });
    expect(payWithNotes(asWallet(value), asWallet('junk'), Number.NaN)).toStrictEqual({ ok: false, error: 'invalidWallet' });
  });

  it('keeps 64 notes without a reissue when nothing grows', () => {
    const wallet = Object.freeze(repeat(1, MAX_WALLET_NOTES));
    const payment = unwrap(payWithNotes(wallet, [1], 1));
    expect(payment.wallet).toHaveLength(MAX_WALLET_NOTES - 1);
    expect(payment.reissued).toBe(false);
  });

  it('reissues the wallet when change would push it past 64 notes', () => {
    const wallet = Object.freeze([MAX, ...repeat(1, MAX_WALLET_NOTES - 1)]);
    const payment = unwrap(payWithNotes(wallet, [MAX], 1));
    expect(payment.reissued).toBe(true);
    expect(payment.spent).toStrictEqual([MAX]);
    expect(payment.change).toStrictEqual(toDenominations(MAX - 1));
    expect(payment.wallet).toStrictEqual(fewest(MAX_WALLET_NOTES - 1 + MAX - 1));
    checkPayment(wallet, 1, payment, 'reissue');
  });

  it('returns fresh arrays that callers may change safely', () => {
    const wallet = Object.freeze([8, 4]);
    const payment = unwrap(payWithNotes(wallet, [8], 5));
    (payment.change as number[]).push(1_000);
    (payment.wallet as number[]).length = 0;
    expect(unwrap(payWithNotes(wallet, [8], 5))).toStrictEqual({ wallet: [4, 2, 1], spent: [8], change: [2, 1], reissued: false });
  });
});

describe('credit', () => {
  it('adds fresh notes for the amount', () => {
    expect(credit([], 400)).toStrictEqual({
      ok: true,
      value: { wallet: [256, 128, 16], received: [256, 128, 16], reissued: false },
    });
    expect(credit(Object.freeze([2, 8]), 5)).toStrictEqual({
      ok: true,
      value: { wallet: [8, 4, 2, 1], received: [4, 1], reissued: false },
    });
  });

  it('pays amounts above 2^20 in several big notes', () => {
    expect(unwrap(credit([], 2 * MAX + 3)).received).toStrictEqual([MAX, MAX, 2, 1]);
  });

  it('fills a wallet exactly to the cap and no further', () => {
    const almost = fewest(MAX_WALLET_BALANCE - 10);
    expect(balanceOf(unwrap(credit(almost, 10)).wallet)).toBe(MAX_WALLET_BALANCE);
    expect(credit(almost, 11)).toStrictEqual({ ok: false, error: 'walletFull' });
    expect(credit(fewest(MAX_WALLET_BALANCE), 1)).toStrictEqual({ ok: false, error: 'walletFull' });
  });

  it('reissues when new notes would pass 64', () => {
    const wallet = Object.freeze(repeat(1, MAX_WALLET_NOTES));
    expect(credit(wallet, 1)).toStrictEqual({ ok: true, value: { wallet: [64, 1], received: [1], reissued: true } });
  });

  it('refuses bad amounts and wallets', () => {
    for (const amount of [0, -0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_WALLET_BALANCE + 1, asNumber('5')]) {
      expect(credit([4], amount)).toStrictEqual({ ok: false, error: 'invalidAmount' });
    }
    for (const { value } of INVALID_WALLETS) {
      expect(credit(asWallet(value), 1)).toStrictEqual({ ok: false, error: 'invalidWallet' });
    }
  });
});

describe('result wire schemas', () => {
  const payment = { wallet: [256, 128], spent: [512], change: [64, 32, 16], reissued: false };
  const received = { wallet: [8, 4, 2, 1], received: [4, 1], reissued: false };

  it('accepts real results', () => {
    expect(PaymentSchema.safeParse(payment).success).toBe(true);
    expect(PaymentSchema.safeParse({ ...payment, change: [] }).success).toBe(true);
    expect(PaymentSchema.safeParse(unwrap(payWithNotes([MAX], [MAX], 1))).success).toBe(true);
    expect(CreditSchema.safeParse(received).success).toBe(true);
    expect(CreditSchema.safeParse(unwrap(credit(repeat(1, MAX_WALLET_NOTES), 1))).success).toBe(true);
  });

  it.each([
    { label: 'an extra key', value: { ...payment, price: 400 } },
    { label: 'a missing flag', value: { wallet: payment.wallet, spent: payment.spent, change: payment.change } },
    { label: 'a string flag', value: { ...payment, reissued: 'no' } },
    { label: 'nothing spent', value: { ...payment, spent: [] } },
    { label: 'a bad change note', value: { ...payment, change: [3] } },
    { label: 'more change notes than any change can need', value: { ...payment, change: repeat(1, MAX_NOTE_BITS + 1) } },
    { label: 'an invalid wallet', value: { ...payment, wallet: repeat(1, MAX_WALLET_NOTES + 1) } },
    { label: 'a JSON __proto__ member', value: JSON.parse('{"__proto__":{},"wallet":[],"spent":[1],"change":[],"reissued":false}') as unknown },
  ])('rejects a payment with $label', ({ value }) => {
    expect(PaymentSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    { label: 'an extra key', value: { ...received, amount: 5 } },
    { label: 'nothing received', value: { ...received, received: [] } },
    { label: 'a bad received note', value: { ...received, received: [5] } },
    { label: 'a wallet over the cap', value: { ...received, wallet: [...fewest(MAX_WALLET_BALANCE), 1] } },
  ])('rejects a credit with $label', ({ value }) => {
    expect(CreditSchema.safeParse(value).success).toBe(false);
  });
});

describe('note schemas', () => {
  it('accepts every denomination and nothing else as a note', () => {
    for (const note of DENOMINATIONS) expect(NoteSchema.safeParse(note).success).toBe(true);
    for (const bad of [0, -0, -1, 3, 0.5, 2 ** 21, Number.NaN, Number.POSITIVE_INFINITY, '1', null, 1n]) {
      expect(NoteSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('accepts selections of 1 to 64 notes', () => {
    expect(NoteSelectionSchema.safeParse([1]).success).toBe(true);
    expect(NoteSelectionSchema.safeParse(repeat(MAX, MAX_WALLET_NOTES)).success).toBe(true);
    expect(NoteSelectionSchema.safeParse([]).success).toBe(false);
    expect(NoteSelectionSchema.safeParse(repeat(1, MAX_WALLET_NOTES + 1)).success).toBe(false);
    expect(NoteSelectionSchema.safeParse([4, 3]).success).toBe(false);
    expect(NoteSelectionSchema.safeParse('4').success).toBe(false);
  });
});

// Exact notes when greedy finds them, else the smallest covering note, else largest first: always a valid payment.
function coveringNotes(wallet: readonly number[], price: number): number[] {
  const notes = desc(wallet);
  const exact: number[] = [];
  let rest = price;
  for (const note of notes) {
    if (note <= rest) {
      exact.push(note);
      rest -= note;
    }
  }
  if (rest === 0) return exact;
  const covering = notes.filter((note) => note >= price);
  const smallest = covering[covering.length - 1];
  if (smallest !== undefined) return [smallest];
  const picked: number[] = [];
  let total = 0;
  for (const note of notes) {
    if (total >= price) break;
    picked.push(note);
    total += note;
  }
  return picked;
}

describe('wallet properties (seeded)', () => {
  it('pays every affordable price with the suggested notes and conserves value', () => {
    const seed = 0xec0001;
    const rng = mulberry32(seed);
    let reissues = 0;
    for (let i = 0; i < 3_000; i++) {
      const wallet = Object.freeze(randomWallet(rng));
      const balance = sum(wallet);
      if (balance === 0) continue;
      const price = 1 + randInt(rng, balance);
      const context = `seed ${seed} case ${i}: price ${price} wallet ${JSON.stringify(wallet)}`;
      const suggestion = coveringNotes(wallet, price);
      expect(expectedPayError(wallet, suggestion, price), context).toBeNull();
      const payment = unwrap(payWithNotes(wallet, Object.freeze([...suggestion]), price));
      checkPayment(wallet, price, payment, context);
      if (payment.reissued) reissues++;
    }
    expect(reissues).toBeGreaterThan(0);
  });

  it('classifies random selections exactly like the rule as written', () => {
    const seed = 0xec0002;
    const rng = mulberry32(seed);
    const seen = new Map<string, number>();
    for (let i = 0; i < 4_000; i++) {
      const wallet = Object.freeze(randomWallet(rng, 24, 12));
      const balance = sum(wallet);
      const roll = rng();
      const selection = Object.freeze(
        roll < 0.6
          ? randomSubset(rng, wallet)
          : roll < 0.85
            ? Array.from({ length: randInt(rng, 6) }, () => 2 ** randInt(rng, 13))
            : [...randomSubset(rng, wallet), 2 ** randInt(rng, 13)],
      );
      const price = Math.min(MAX_WALLET_BALANCE, 1 + randInt(rng, balance + 16));
      const context = `seed ${seed} case ${i}: price ${price} wallet ${JSON.stringify(wallet)} selection ${JSON.stringify(selection)}`;
      const expected = expectedPayError(wallet, selection, price);
      const result = payWithNotes(wallet, selection, price);
      seen.set(expected ?? 'ok', (seen.get(expected ?? 'ok') ?? 0) + 1);
      if (expected === null) {
        checkPayment(wallet, price, unwrap(result), context);
      } else {
        expect(result, context).toStrictEqual({ ok: false, error: expected });
      }
    }
    for (const outcome of ['ok', 'insufficientFunds', 'invalidSelection', 'notInWallet', 'underpaid', 'overpaid']) {
      expect(seen.get(outcome) ?? 0, outcome).toBeGreaterThan(20);
    }
  });

  it('credits conserve value, respect the caps and reissue only past 64 notes', () => {
    const seed = 0xec0004;
    const rng = mulberry32(seed);
    let reissues = 0;
    for (let i = 0; i < 3_000; i++) {
      const wallet = Object.freeze(randomWallet(rng));
      const balance = sum(wallet);
      const amount = rng() < 0.1 ? MAX_WALLET_BALANCE - balance + randInt(rng, 3) : 1 + randInt(rng, rng() < 0.5 ? 2_000 : 3 * MAX);
      const context = `seed ${seed} case ${i}: amount ${amount} wallet ${JSON.stringify(wallet)}`;
      const result = credit(wallet, amount);
      if (amount < 1) {
        expect(result, context).toStrictEqual({ ok: false, error: 'invalidAmount' });
        continue;
      }
      if (balance + amount > MAX_WALLET_BALANCE) {
        expect(result, context).toStrictEqual({ ok: false, error: amount > MAX_WALLET_BALANCE ? 'invalidAmount' : 'walletFull' });
        continue;
      }
      const { wallet: next, received, reissued } = unwrap(result);
      expect(CreditSchema.safeParse(unwrap(result)).success, context).toBe(true);
      expect(sum(next), context).toBe(balance + amount);
      expect([...received], context).toStrictEqual(fewest(amount));
      expect(validateWallet(next), context).toStrictEqual({ ok: true, value: [...next] });
      expect(reissued, context).toBe(wallet.length + received.length > MAX_WALLET_NOTES);
      expect([...next], context).toStrictEqual(reissued ? fewest(balance + amount) : desc([...wallet, ...received]));
      if (reissued) reissues++;
    }
    expect(reissues).toBeGreaterThan(0);
  });
});
