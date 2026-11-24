// The archipelago (docs/world.md): islands open by Guardian Rank or by Academy stars, whichever comes first.
import { rankFor } from './rank.js';

export interface Island {
  readonly id: string;
  readonly name: string;
  readonly concept: string;
  readonly about: string;
  // Opens at this rank, or with this many Academy stars; 0 and 0 means open from the start.
  readonly rank: number;
  readonly stars: number;
  // False while the island's content is still being built.
  readonly ready: boolean;
  // Map position in a 0-100 box, for the menu drawing.
  readonly x: number;
  readonly y: number;
}

export const ISLANDS: readonly Island[] = Object.freeze([
  { id: 'mint', name: 'Mint Island', concept: 'Ecash notes and blind signatures', about: 'The Mint Citadel, its four stations and the Consensus bar. Every guardian starts here.', rank: 0, stars: 0, ready: true, x: 18, y: 50 },
  { id: 'signing', name: 'Signing Isle', concept: 'Threshold signatures', about: 'Withdrawals that need enough guardian signatures, forgeries and audits, plus two Academy levels on thresholds: how many signatures a federation of n guardians needs.', rank: 2, stars: 3, ready: true, x: 40, y: 22 },
  { id: 'council', name: 'Council Isle', concept: 'The one-third rule', about: 'Council meetings and votes: rotate out the right keys, because every honest key lost brings a halt closer. Its Academy levels drill the one-third rule and voting on evidence.', rank: 4, stars: 6, ready: true, x: 60, y: 48 },
  { id: 'watchtower', name: 'Watchtower Peaks', concept: 'Network partitions', about: 'A match map of mountain tops on rope bridges, where a partition cuts the bridges between the two ranges, plus Academy levels on reading a split network.', rank: 6, stars: 9, ready: true, x: 82, y: 22 },
  { id: 'reef', name: 'Lightning Reef', concept: 'Lightning payments', about: 'A match map of sandy islets joined by plank bridges, where the Gateway Harbour’s channels run tight, plus two Academy levels of harder Lightning work. Pick it in a private room.', rank: 8, stars: 12, ready: true, x: 36, y: 80 },
  { id: 'beach', name: 'Beach Town', concept: 'Spending ecash', about: 'The social hub: shops paid with the ecash notes in your wallet, change reissued by the mint, and courier jobs between the stalls.', rank: 3, stars: 4, ready: true, x: 78, y: 80 },
]);

export function islandOpen(island: Island, rank: number, stars: number): boolean {
  return rank >= island.rank || (island.stars > 0 && stars >= island.stars);
}

// Whether a profile with this XP and these Academy stars has opened an island; unknown ids stay shut.
export function islandOpenFor(id: string, xp: number, academy: readonly number[]): boolean {
  const island = ISLANDS.find((i) => i.id === id);
  if (island === undefined) return false;
  const stars = academy.reduce((sum, s) => sum + (Number.isSafeInteger(s) && s > 0 ? s : 0), 0);
  return islandOpen(island, rankFor(xp).rank, stars);
}
