// Guardian Rank: XP thresholds, titles and the Rank Road of unlocks. See docs/progression.md.
import type { RewardId } from '../economy/catalog.js';

export const MAX_RANK = 50;
// After rank 50, one star per this much XP; stars are for display only.
export const STAR_XP = 1000;
export const MAX_STARS = 999;
// Play sats paid for every rank-up.
export const RANK_UP_SATS = 100;

export function xpToNext(rank: number): number {
  return Math.min(100 + 25 * (rank - 1), 600);
}

// RANK_START[r - 1] is the total XP at which rank r begins.
export const RANK_START: readonly number[] = Object.freeze(
  Array.from({ length: MAX_RANK }, (_, i) => Array.from({ length: i }, (_, r) => xpToNext(r + 1)).reduce((a, b) => a + b, 0)),
);

export interface RankInfo {
  readonly rank: number;
  // XP into the current rank, and XP the next rank needs (0 at the top).
  readonly into: number;
  readonly forNext: number;
  readonly stars: number;
}

export function rankFor(xp: number): RankInfo {
  const total = Number.isSafeInteger(xp) && xp > 0 ? xp : 0;
  let rank = 1;
  while (rank < MAX_RANK && total >= (RANK_START[rank] ?? Infinity)) rank += 1;
  const start = RANK_START[rank - 1] ?? 0;
  if (rank === MAX_RANK) {
    const over = total - start;
    return { rank, into: over % STAR_XP, forNext: STAR_XP, stars: Math.min(MAX_STARS, Math.floor(over / STAR_XP)) };
  }
  return { rank, into: total - start, forNext: xpToNext(rank), stars: 0 };
}

export const FRAME_IDS = ['copper', 'silver', 'gold', 'sapphire', 'aurora', 'genesis', 'epoch'] as const;
export type FrameId = (typeof FRAME_IDS)[number];
export const FRAME_NAMES: Readonly<Record<FrameId, string>> = Object.freeze({
  copper: 'Copper frame',
  silver: 'Silver frame',
  gold: 'Gold frame',
  sapphire: 'Sapphire frame',
  aurora: 'Aurora frame',
  genesis: 'Genesis frame',
  epoch: 'Epoch frame',
});

export const RANK_TITLE_IDS = ['apprentice', 'noteKeeper', 'signer', 'keyholder', 'guardian', 'councilElder', 'archon', 'genesisGuardian'] as const;
export type RankTitleId = (typeof RANK_TITLE_IDS)[number];

// The title each rank band carries, from the rank it starts at.
export const RANK_TITLES: readonly { readonly rank: number; readonly id: RankTitleId; readonly name: string }[] = Object.freeze([
  { rank: 1, id: 'apprentice', name: 'Apprentice' },
  { rank: 5, id: 'noteKeeper', name: 'Note Keeper' },
  { rank: 10, id: 'signer', name: 'Signer' },
  { rank: 15, id: 'keyholder', name: 'Keyholder' },
  { rank: 20, id: 'guardian', name: 'Guardian' },
  { rank: 30, id: 'councilElder', name: 'Council Elder' },
  { rank: 40, id: 'archon', name: 'Archon' },
  { rank: 50, id: 'genesisGuardian', name: 'Genesis Guardian' },
]);

export function rankTitle(rank: number): RankTitleId {
  let title: RankTitleId = 'apprentice';
  for (const t of RANK_TITLES) if (rank >= t.rank) title = t.id;
  return title;
}

// What reaching a rank unlocks besides the rank-up sats.
export interface RankUnlock {
  readonly frame?: FrameId;
  readonly item?: RewardId;
}

export const RANK_ROAD: ReadonlyMap<number, RankUnlock> = new Map<number, RankUnlock>([
  [2, { frame: 'copper' }],
  [5, { item: 'rank5' }],
  [10, { frame: 'silver', item: 'rank10' }],
  [15, { item: 'rank15' }],
  [20, { frame: 'gold', item: 'rank20' }],
  [30, { frame: 'sapphire', item: 'rank30' }],
  [40, { frame: 'aurora', item: 'rank40' }],
  [50, { frame: 'genesis', item: 'rank50' }],
]);

// The next rank with a frame or item, for the "what you'll get" teaser.
export function nextUnlock(rank: number): { readonly rank: number; readonly unlock: RankUnlock } | null {
  for (let r = rank + 1; r <= MAX_RANK; r++) {
    const unlock = RANK_ROAD.get(r);
    if (unlock !== undefined) return { rank: r, unlock };
  }
  return null;
}
