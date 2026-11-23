// The federation arithmetic the Codex teaches; test/rules.test.ts checks it against the game's own rules.

function assertGuardians(n: number): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError('guardian count must be a positive integer');
}

// Largest f with n >= 3f + 1 (Fedimint's NumPeers::max_evil).
export function faultyTolerated(n: number): number {
  assertGuardians(n);
  return Math.floor((n - 1) / 3);
}

// Signatures needed: n - f (Fedimint's NumPeers::threshold).
export function signingThreshold(n: number): number {
  return n - faultyTolerated(n);
}

// The game's halt rule: Byzantines are a third or more of the members.
export function halted(byzantine: number, members: number): boolean {
  return members === 0 || 3 * byzantine >= members;
}

// Honest guardians the council can wrongly rotate out before the federation halts.
export function wrongEjectionsSurvived(players: number): number {
  const byzantine = faultyTolerated(players);
  let members = players;
  let survived = 0;
  while (members - 1 > byzantine && !halted(byzantine, members - 1)) {
    members -= 1;
    survived += 1;
  }
  return survived;
}

export interface FederationRow {
  readonly guardians: number;
  readonly tolerated: number;
  readonly threshold: number;
}

export function federationRows(from: number, to: number): FederationRow[] {
  const rows: FederationRow[] = [];
  for (let n = from; n <= to; n++) rows.push({ guardians: n, tolerated: faultyTolerated(n), threshold: signingThreshold(n) });
  return rows;
}

export interface MatchRow extends FederationRow {
  readonly survivable: number;
}

export function matchRows(from: number, to: number): MatchRow[] {
  return federationRows(from, to).map((row) => ({ ...row, survivable: wrongEjectionsSurvived(row.guardians) }));
}

// The power-of-two notes that make up an amount, largest first (its binary digits).
export function powerOfTwoNotes(amount: number): number[] {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('amount must be a non-negative integer');
  const notes: number[] = [];
  for (let bit = 2 ** Math.floor(Math.log2(Math.max(amount, 1))); bit >= 1; bit /= 2) {
    if (amount >= bit) {
      notes.push(bit);
      amount -= bit;
    }
  }
  return notes;
}

// The median the federation agrees on: sort the votes and take the middle one.
export function agreedHeight(votes: readonly number[]): number {
  if (votes.length === 0) throw new RangeError('no votes');
  const sorted = [...votes].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
