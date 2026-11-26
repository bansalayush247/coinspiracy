// Ecash wallet rules: a wallet is a list of power-of-two notes, and a payment hands over chosen notes for change.
import { z } from 'zod';
import { MAX_NOTE_AMOUNT, MAX_NOTE_BITS } from '../constants.js';
import { isDenomination, toDenominations } from '../notes.js';
import { err, ok, type Result } from '../result.js';

// Past this many notes a wallet is reissued as the fewest notes for its balance.
export const MAX_WALLET_NOTES = 64;
// Play-sat cap per wallet; keeps every sum a small exact integer.
export const MAX_WALLET_BALANCE = 10_000_000;

// Note amounts; every wallet these rules return is a fresh array, largest note first.
export type Wallet = readonly number[];

export type WalletError =
  | 'invalidWallet'
  | 'invalidAmount'
  | 'invalidSelection'
  | 'notInWallet'
  | 'insufficientFunds'
  | 'underpaid'
  | 'overpaid'
  | 'walletFull';
export type PayError = Exclude<WalletError, 'walletFull'>;

export interface Payment {
  readonly wallet: Wallet;
  // The notes handed over.
  readonly spent: Wallet;
  // Fresh notes for the amount paid over the price.
  readonly change: Wallet;
  // True when the wallet passed MAX_WALLET_NOTES and was reissued.
  readonly reissued: boolean;
}

export interface Credit {
  readonly wallet: Wallet;
  readonly received: Wallet;
  readonly reissued: boolean;
}

function total(notes: readonly number[]): number {
  let sum = 0;
  for (const note of notes) sum += note;
  return sum;
}

export const NoteSchema = z.number().refine((n) => isDenomination(n), 'not a note denomination');
export const WalletSchema = z
  .array(NoteSchema)
  .max(MAX_WALLET_NOTES)
  .refine((notes) => total(notes) <= MAX_WALLET_BALANCE, 'over the wallet balance cap');
// Notes a client picks to pay with.
export const NoteSelectionSchema = z.array(NoteSchema).min(1).max(MAX_WALLET_NOTES);
// Results as sent to their owner; change is below 2^20, so at most 20 notes.
export const PaymentSchema = z.strictObject({
  wallet: WalletSchema,
  spent: NoteSelectionSchema,
  change: z.array(NoteSchema).max(MAX_NOTE_BITS),
  reissued: z.boolean(),
});
export const CreditSchema = z.strictObject({
  wallet: WalletSchema,
  received: NoteSelectionSchema,
  reissued: z.boolean(),
});

const largestFirst = (a: number, b: number): number => b - a;

// Exact for powers of two up to 2^31.
function bitOf(note: number): number {
  return 31 - Math.clz32(note);
}

function countNotes(notes: readonly number[]): number[] {
  const counts = Array.from({ length: MAX_NOTE_BITS + 1 }, () => 0);
  for (const note of notes) counts[bitOf(note)] = (counts[bitOf(note)] ?? 0) + 1;
  return counts;
}

function fromCounts(counts: readonly number[]): number[] {
  const notes: number[] = [];
  for (let bit = MAX_NOTE_BITS; bit >= 0; bit--) {
    for (let i = 0; i < (counts[bit] ?? 0); i++) notes.push(2 ** bit);
  }
  return notes;
}

// Copies an untrusted note list, or null; the length is capped before any per-note work.
function readNotes(input: unknown, minLength: number): number[] | null {
  if (!Array.isArray(input)) return null;
  // Read once, so an exotic array cannot report a short length to the check and a long one to the loop.
  const length = input.length;
  if (length < minLength || length > MAX_WALLET_NOTES) return null;
  const notes: number[] = [];
  for (let i = 0; i < length; i++) {
    const note: unknown = input[i];
    if (typeof note !== 'number' || !isDenomination(note)) return null;
    notes.push(note);
  }
  return notes;
}

function readWallet(input: unknown): number[] | null {
  const notes = readNotes(input, 0);
  return notes !== null && total(notes) <= MAX_WALLET_BALANCE ? notes.sort(largestFirst) : null;
}

function isAmount(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= MAX_WALLET_BALANCE;
}

// Whole 2^20 notes, then the binary split of the rest.
function fewestNotes(amount: number): number[] {
  const notes: number[] = [];
  let rest = amount;
  while (rest > MAX_NOTE_AMOUNT) {
    notes.push(MAX_NOTE_AMOUNT);
    rest -= MAX_NOTE_AMOUNT;
  }
  if (rest > 0) notes.push(...toDenominations(rest));
  return notes;
}

function settle(notes: number[]): { readonly wallet: number[]; readonly reissued: boolean } {
  if (notes.length > MAX_WALLET_NOTES) return { wallet: fewestNotes(total(notes)), reissued: true };
  return { wallet: notes.sort(largestFirst), reissued: false };
}

// A sorted copy of a stored or received wallet, or invalidWallet.
export function validateWallet(input: unknown): Result<Wallet, 'invalidWallet'> {
  const notes = readWallet(input);
  return notes === null ? err('invalidWallet') : ok(notes);
}

// The fewest notes for 0 to MAX_WALLET_BALANCE sats.
export function walletFromAmount(amount: number): Result<Wallet, 'invalidAmount'> {
  return isAmount(amount, 0) ? ok(fewestNotes(amount)) : err('invalidAmount');
}

// Throws on an invalid wallet; run validateWallet on untrusted data first.
export function balanceOf(wallet: Wallet): number {
  const notes = readWallet(wallet);
  if (notes === null) throw new RangeError('not a valid wallet');
  return total(notes);
}

// Pays with chosen notes: they must be in the wallet, cover the price, and none can be dropped while still covering it.
export function payWithNotes(wallet: Wallet, selected: readonly number[], price: number): Result<Payment, PayError> {
  const notes = readWallet(wallet);
  if (notes === null) return err('invalidWallet');
  if (!isAmount(price, 1)) return err('invalidAmount');
  if (total(notes) < price) return err('insufficientFunds');
  const chosen = readNotes(selected, 1);
  if (chosen === null) return err('invalidSelection');
  const have = countNotes(notes);
  const take = countNotes(chosen);
  if (take.some((count, bit) => count > (have[bit] ?? 0))) return err('notInWallet');
  const paid = total(chosen);
  if (paid < price) return err('underpaid');
  // Dropping the smallest note frees the most room, so checking it alone is enough.
  if (paid - Math.min(...chosen) >= price) return err('overpaid');
  // Minimality keeps the change below the smallest chosen note, so it is always a valid split.
  const change = paid === price ? [] : toDenominations(paid - price);
  const kept = fromCounts(have.map((count, bit) => count - (take[bit] ?? 0)));
  const { wallet: next, reissued } = settle([...kept, ...change]);
  return ok({ wallet: next, spent: chosen.sort(largestFirst), change, reissued });
}

// Adds fresh notes for an amount, refusing anything that would pass MAX_WALLET_BALANCE.
export function credit(wallet: Wallet, amount: number): Result<Credit, 'invalidWallet' | 'invalidAmount' | 'walletFull'> {
  const notes = readWallet(wallet);
  if (notes === null) return err('invalidWallet');
  if (!isAmount(amount, 1)) return err('invalidAmount');
  if (total(notes) + amount > MAX_WALLET_BALANCE) return err('walletFull');
  const received = fewestNotes(amount);
  const { wallet: next, reissued } = settle([...notes, ...received]);
  return ok({ wallet: next, received, reissued });
}
