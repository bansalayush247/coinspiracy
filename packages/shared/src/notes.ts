import { MAX_NOTE_AMOUNT, MAX_NOTE_BITS } from './constants.js';

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
