import { MAX_PLAYERS, MIN_PLAYERS } from './constants.js';

function assertCount(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}], got ${String(value)}`);
  }
}

// Largest f with n >= 3f + 1.
export function maxFaulty(guardians: number): number {
  assertCount(guardians, 1, Number.MAX_SAFE_INTEGER, 'guardians');
  return Math.floor((guardians - 1) / 3);
}

// Signatures a proposal needs to pass.
export function threshold(guardians: number): number {
  return guardians - maxFaulty(guardians);
}

// Hidden Byzantine guardians dealt at match start.
export function byzantineCount(players: number): number {
  assertCount(players, MIN_PLAYERS, MAX_PLAYERS, 'players');
  return maxFaulty(players);
}

// The federation halts once Byzantines are a third or more of its members.
export function isHalted(byzantineMembers: number, totalMembers: number): boolean {
  assertCount(totalMembers, 0, Number.MAX_SAFE_INTEGER, 'totalMembers');
  assertCount(byzantineMembers, 0, totalMembers, 'byzantineMembers');
  if (totalMembers === 0) return true;
  return 3 * byzantineMembers >= totalMembers;
}
