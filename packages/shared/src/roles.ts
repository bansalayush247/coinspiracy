import { MAX_PLAYERS, MIN_PLAYERS } from './constants.js';
import { byzantineCount } from './federation.js';
import type { PlayerId, Role } from './types.js';

export interface RandomSource {
  // Uniform integer in [0, maxExclusive).
  int(maxExclusive: number): number;
}

const UINT32_RANGE = 2 ** 32;

// Unbiased CSPRNG via rejection sampling; works in Node and browsers.
export const cryptoRandom: RandomSource = {
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new RangeError(`maxExclusive must be an integer in [1, 2^32], got ${String(maxExclusive)}`);
    }
    const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    const buffer = new Uint32Array(1);
    for (;;) {
      globalThis.crypto.getRandomValues(buffer);
      const value = buffer.at(0);
      if (value === undefined) throw new Error('getRandomValues returned no data');
      if (value < limit) return value % maxExclusive;
    }
  },
};

// Deals hidden roles with a Fisher-Yates shuffle.
export function assignRoles(
  playerIds: readonly PlayerId[],
  rng: RandomSource = cryptoRandom,
): Map<PlayerId, Role> {
  const count = playerIds.length;
  if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
    throw new RangeError(`need ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${count}`);
  }
  if (new Set(playerIds).size !== count) throw new Error('duplicate player id');

  const order = [...playerIds];
  for (let i = count - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new RangeError('RandomSource out of range');
    const a = order[i];
    const b = order[j];
    if (a === undefined || b === undefined) throw new Error('shuffle index out of bounds');
    order[i] = b;
    order[j] = a;
  }

  const byzantine = new Set(order.slice(0, byzantineCount(count)));
  // Insert in input order so map order never reveals the shuffle.
  const roles = new Map<PlayerId, Role>();
  for (const id of playerIds) roles.set(id, byzantine.has(id) ? 'byzantine' : 'honest');
  return roles;
}

// Roles a viewer may see: their own, plus fellow Byzantines if they are one.
export function visibleRoles(
  roles: ReadonlyMap<PlayerId, Role>,
  viewerId: PlayerId,
): Map<PlayerId, Role> {
  const own = roles.get(viewerId);
  const visible = new Map<PlayerId, Role>();
  if (own === undefined) return visible;
  visible.set(viewerId, own);
  if (own === 'byzantine') {
    for (const [id, role] of roles) if (role === 'byzantine') visible.set(id, role);
  }
  return visible;
}
