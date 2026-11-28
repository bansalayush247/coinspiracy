import type { Vec2 } from '@byzantine-council/shared';
import type { PreviewIslandId } from './islandObjectives.js';

export type FindIsland = 'beach' | PreviewIslandId;

export interface IslandFind {
  readonly id: string;
  readonly island: FindIsland;
  readonly rank: number;
  readonly name: string;
  readonly clue: string;
  readonly at: Vec2;
}

export const ISLAND_FINDS: readonly IslandFind[] = [
  { id: 'shell', island: 'beach', rank: 1, name: 'Rose Cowrie', clue: 'Search the sand between the two rocks west of the ferry pier.', at: { x: 5.5, y: 15.5 } },
  { id: 'garden-tile', island: 'beach', rank: 3, name: 'Painted Garden Tile', clue: 'Walk to Palm Gardens and look just in front of the green pavilion.', at: { x: 35.5, y: 7.5 } },
  { id: 'amber', island: 'beach', rank: 8, name: 'Sun Amber', clue: 'Look for the palm near the ocean, a few steps down from the East Promenade.', at: { x: 39.5, y: 16.5 } },
  { id: 'knotted-cord', island: 'beach', rank: 15, name: 'Sailor’s Knot', clue: 'Look down where the footbridge reaches the lantern at Tideglass Point.', at: { x: 37.5, y: 23.5 } },
  { id: 'sea-glass', island: 'beach', rank: 30, name: 'Green Sea Glass', clue: 'Follow the path past the lighthouse and look beside its seaward steps.', at: { x: 40.5, y: 27.5 } },
  { id: 'lens', island: 'beach', rank: 50, name: 'Lighthouse Lens', clue: 'Find the last palm beyond the lighthouse, on the far side of Tideglass Point.', at: { x: 43.5, y: 25.5 } },
  { id: 'blank', island: 'mint', rank: 1, name: 'Unstruck Coin', clue: 'Search the shoreward side of the little coin pavilion.', at: { x: 5.1, y: 12.5 } },
  { id: 'seal', island: 'mint', rank: 12, name: 'Mintmaster’s Seal', clue: 'Past the stack of coins, search beside the tall tree near the edge.', at: { x: 15.3, y: 11.9 } },
  { id: 'wax', island: 'signing', rank: 3, name: 'Red Sealing Wax', clue: 'Look just beyond the gate at the left end of the signing hall.', at: { x: 4.6, y: 11.9 } },
  { id: 'key', island: 'signing', rank: 20, name: 'Retired Guardian Key', clue: 'Leave the right-hand gate and follow the grass toward the lone tree.', at: { x: 15.3, y: 11.6 } },
  { id: 'ballot', island: 'council', rank: 6, name: 'Discarded Ballot', clue: 'Stop at the arrival arch and search along the side facing the shore.', at: { x: 8.4, y: 14.1 } },
  { id: 'pin', island: 'council', rank: 35, name: 'Founders’ Pin', clue: 'Go around the council seats to the small gold banner at the back.', at: { x: 10.4, y: 5.4 } },
  { id: 'coil', island: 'watchtower', rank: 10, name: 'Copper Relay Coil', clue: 'Search by the low rock between the arrival path and the west relay.', at: { x: 7.2, y: 12.9 } },
  { id: 'dial', island: 'watchtower', rank: 40, name: 'Brass Signal Dial', clue: 'Follow the signal uphill from the east relay and check the rocks behind it.', at: { x: 13.5, y: 7.6 } },
  { id: 'coral', island: 'reef', rank: 5, name: 'Coral Bead', clue: 'Search the shallows near the little rock just past the first coral channel.', at: { x: 5.7, y: 12.2 } },
  { id: 'charm', island: 'reef', rank: 25, name: 'Thunder Charm', clue: 'Circle the lagoon and search by the small rock beyond the orange coral.', at: { x: 14.1, y: 7.1 } },
];

const STORAGE_KEY = 'bc.island-finds';
export const FIND_REACH = 1.05;

export class IslandFinds {
  readonly #found = new Set<string>();

  constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      const saved: unknown = JSON.parse((storage ?? window.localStorage).getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) {
        for (const find of ISLAND_FINDS) if (saved.includes(find.id)) this.#found.add(find.id);
      }
    } catch {
      // The journal still works for this visit when storage is blocked or damaged.
    }
  }

  entries(island: FindIsland): readonly IslandFind[] {
    return ISLAND_FINDS.filter((find) => find.island === island);
  }

  has(find: IslandFind): boolean {
    return this.#found.has(find.id);
  }

  nearby(island: FindIsland, at: Vec2 | null, rank: number, reach: number): IslandFind | null {
    if (at === null) return null;
    let nearest: IslandFind | null = null;
    for (const find of ISLAND_FINDS) {
      if (find.island !== island || find.rank > rank || this.has(find)) continue;
      const distance = Math.hypot(at.x - find.at.x, at.y - find.at.y);
      if (distance > reach) continue;
      nearest = find;
      reach = distance;
    }
    return nearest;
  }

  search(island: FindIsland, at: Vec2 | null, rank: number): IslandFind | null {
    const find = this.nearby(island, at, rank, FIND_REACH);
    if (find === null) return null;
    this.#found.add(find.id);
    try {
      (this.storage ?? window.localStorage).setItem(STORAGE_KEY, JSON.stringify([...this.#found]));
    } catch {
      // Keep the find even if the browser doesn't persist it.
    }
    return find;
  }
}
