import { MAX_NOTE_AMOUNT, MAX_NOTE_BITS } from './constants.js';
import { err, ok, type Result } from './result.js';

export function isDenomination(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_NOTE_AMOUNT) return false;
  return Number.isInteger(Math.log2(value));
}

// Power-of-two notes for an amount, largest first, like Fedimint.
export function toDenominations(amount: number): number[] {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_NOTE_AMOUNT) {
    throw new RangeError(`amount must be an integer in [1, ${MAX_NOTE_AMOUNT}]`);
  }
  const notes: number[] = [];
  let remaining = amount;
  for (let bit = MAX_NOTE_BITS; bit >= 0; bit--) {
    const value = 2 ** bit;
    if (remaining >= value) {
      notes.push(value);
      remaining -= value;
    }
  }
  return notes;
}

// Unknown and spent notes share one error so probes learn nothing.
export function checkSpend(
  unspent: ReadonlySet<string>,
  noteIds: readonly string[],
): Result<readonly string[]> {
  if (noteIds.length === 0) return err('emptySpend');
  if (new Set(noteIds).size !== noteIds.length) return err('duplicateNote');
  if (noteIds.some((id) => !unspent.has(id))) return err('noteUnavailable');
  return ok(noteIds);
}

// Returns the unspent set after a validated spend.
export function applySpend(
  unspent: ReadonlySet<string>,
  noteIds: readonly string[],
): Result<Set<string>> {
  const check = checkSpend(unspent, noteIds);
  if (!check.ok) return check;
  const next = new Set(unspent);
  for (const id of noteIds) next.delete(id);
  return ok(next);
}
