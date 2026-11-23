// Beach Town: a floating island with a lagoon, a boardwalk, seven shops and room to wander.
import type { CitadelMap, Vec2 } from '../map.js';
import { SHOP_IDS, type ShopId } from '../economy/catalog.js';

export const BEACH_WIDTH = 30;
export const BEACH_HEIGHT = 24;

// Where each shop's 2x2 booth stands (top-left tile). Its counter is the tile in front.
export const SHOP_BOOTHS: Readonly<Record<ShopId, { readonly col: number; readonly row: number }>> = Object.freeze({
  tailor: { col: 3, row: 3 },
  barber: { col: 8, row: 3 },
  hats: { col: 13, row: 3 },
  surf: { col: 18, row: 3 },
  cafe: { col: 23, row: 3 },
  'pupusa-stand': { col: 4, row: 11 },
  'coconut-stand': { col: 24, row: 11 },
});

// Every guardian's own beach hut (the home plot) stands here; each player sees their own.
export const HOME_HUT: { readonly col: number; readonly row: number } = Object.freeze({ col: 26, row: 10 });

// Legend as in the citadel: # void, . sand (walkable), = boardwalk, ~ lagoon, T palm, H booth, R rock, U umbrella.
function buildRows(): string[] {
  const grid: string[][] = Array.from({ length: BEACH_HEIGHT }, (_, r) =>
    Array.from({ length: BEACH_WIDTH }, (_, c) => (r === 0 || c === 0 || r === BEACH_HEIGHT - 1 || c === BEACH_WIDTH - 1 ? '#' : '.')),
  );
  const set = (c: number, r: number, t: string): void => {
    const row = grid[r];
    if (row !== undefined && c > 0 && c < BEACH_WIDTH - 1 && r > 0 && r < BEACH_HEIGHT - 1) row[c] = t;
  };
  // The lagoon along the south, with a curved shore.
  for (let r = 16; r < BEACH_HEIGHT - 1; r++) {
    for (let c = 1; c < BEACH_WIDTH - 1; c++) {
      const shore = 16 + Math.round(1.2 * Math.sin(c / 3.1));
      if (r >= shore) set(c, r, '~');
    }
  }
  // The boardwalk pier out over the water.
  for (let r = 14; r < BEACH_HEIGHT - 2; r++) {
    set(14, r, '=');
    set(15, r, '=');
  }
  for (let c = 12; c <= 17; c++) set(c, BEACH_HEIGHT - 3, '=');
  for (const { col, row } of Object.values(SHOP_BOOTHS)) {
    set(col, row, 'H');
    set(col + 1, row, 'H');
    set(col, row + 1, 'H');
    set(col + 1, row + 1, 'H');
  }
  for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) set(HOME_HUT.col + dc, HOME_HUT.row + dr, 'H');
  for (const [c, r] of [[1, 1], [6, 1], [11, 1], [16, 1], [21, 1], [27, 1], [1, 8], [28, 8], [10, 13], [20, 13], [2, 14], [27, 14], [7, 8], [22, 8]] as const) set(c, r, 'T');
  for (const [c, r] of [[9, 10], [20, 10], [11, 13], [19, 13]] as const) set(c, r, 'U');
  for (const [c, r] of [[1, 15], [28, 15], [8, 15], [21, 15]] as const) set(c, r, 'R');
  // Tiki torches along the shore and the square; they light up after dark.
  for (const [c, r] of [[5, 14], [12, 14], [17, 14], [24, 14], [3, 7], [26, 7]] as const) set(c, r, 'L');
  return grid.map((row) => row.join(''));
}

export const BEACH_MAP: CitadelMap = Object.freeze({ width: BEACH_WIDTH, height: BEACH_HEIGHT, rows: Object.freeze(buildRows()) });

// The counter in front of a shop, where a guardian stands to shop or hand over a parcel.
export function shopCounter(shop: ShopId): Vec2 {
  const b = SHOP_BOOTHS[shop];
  return { x: b.col + 1, y: b.row + 2.5 };
}

export const SHOP_RANGE = 1.6;

export function atShop(pos: Vec2, shop: ShopId): boolean {
  const c = shopCounter(shop);
  return Math.hypot(pos.x - c.x, pos.y - c.y) <= SHOP_RANGE;
}

// The shop whose counter a position is at, if any.
export function shopAt(pos: Vec2): ShopId | null {
  return SHOP_IDS.find((s) => atShop(pos, s)) ?? null;
}

// The porch in front of the hut door.
export function homeDoor(): Vec2 {
  return { x: HOME_HUT.col + 1, y: HOME_HUT.row + 2.5 };
}

export const HOME_RANGE = 1.2;

export function atHome(pos: Vec2): boolean {
  const d = homeDoor();
  return Math.hypot(pos.x - d.x, pos.y - d.y) <= HOME_RANGE;
}

// Sixteen spawn points spread around the town square.
export const BEACH_SPAWNS: readonly Vec2[] = Object.freeze(
  Array.from({ length: 16 }, (_, i) => {
    const angle = (i * 2 * Math.PI) / 16;
    return Object.freeze({ x: 15 + 2.6 * Math.cos(angle), y: 9.5 + 1.8 * Math.sin(angle) });
  }),
);
