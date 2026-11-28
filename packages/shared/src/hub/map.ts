// Beach Town: a floating island with a lagoon, a boardwalk, seven shops and room to wander.
import type { CitadelMap, Vec2 } from '../map.js';
import { BEACH_SHOP_IDS, type BeachShopId } from '../economy/catalog.js';

export const BEACH_WIDTH = 48;
export const BEACH_HEIGHT = 34;

// Where each shop's 2x2 booth stands (top-left tile). Its counter is the tile in front.
export const SHOP_BOOTHS: Readonly<Record<BeachShopId, { readonly col: number; readonly row: number }>> = Object.freeze({
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

export const BEACH_LANDMARKS = [
  { id: 'gardens', col: 34, row: 5, width: 3, depth: 2, approach: { x: 35.5, y: 7.5 } },
  { id: 'promenade', col: 41, row: 12, width: 2, depth: 2, approach: { x: 41.5, y: 14.5 } },
  { id: 'tideglass', col: 39, row: 25, width: 3, depth: 2, approach: { x: 40.5, y: 27.5 } },
] as const;

// . sand, , gardens, d paved paths, = boardwalk, ~ sea, T palm, H building, R rock, U umbrella, L torch.
function buildRows(): string[] {
  const grid: string[][] = Array.from({ length: BEACH_HEIGHT }, (_, r) =>
    Array.from({ length: BEACH_WIDTH }, (_, c) => {
      if (c === 0 || r === 0) return '~';
      if (c <= 28) return r < Math.max(16, 16 + Math.round(1.2 * Math.sin(c / 3.1))) ? '.' : '~';
      const promenade = c <= 44 && r >= 2 + Math.floor(Math.max(0, c - 37) / 2) && r <= 17 - Math.floor(Math.max(0, c - 40) / 2);
      const point = ((c - 39) / 6.3) ** 2 + ((r - 25) / 5.5) ** 2 < 1;
      return promenade || point ? '.' : '~';
    }),
  );
  const set = (c: number, r: number, t: string): void => {
    const row = grid[r];
    if (row !== undefined && c > 0 && c < BEACH_WIDTH - 1 && r > 0 && r < BEACH_HEIGHT - 1) row[c] = t;
  };
  // Keep the original ferry pier, and connect the east promenade to Tideglass Point by a footbridge.
  for (let r = 14; r <= 21; r++) {
    set(14, r, '=');
    set(15, r, '=');
  }
  for (let c = 12; c <= 15; c++) set(c, 21, '=');
  for (let c = 29; c <= 43; c++) for (let r = 9; r <= 10; r++) set(c, r, 'd');
  for (let r = 4; r <= 16; r++) for (let c = 36; c <= 37; c++) set(c, r, 'd');
  for (let r = 16; r <= 23; r++) for (let c = 36; c <= 37; c++) set(c, r, '=');
  for (let r = 3; r <= 8; r++) for (let c = 30; c <= 40; c++) if (grid[r]?.[c] === '.') set(c, r, ',');
  for (let c = 35; c <= 43; c++) set(c, 24, 'd');
  for (const { col, row, width, depth } of BEACH_LANDMARKS) {
    for (let c = col; c < col + width; c++) for (let r = row; r < row + depth; r++) set(c, r, 'H');
  }
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
  for (const [c, r] of [[30, 4], [33, 3], [39, 4], [41, 6], [31, 12], [33, 15], [39, 15], [42, 7], [43, 26], [37, 28], [40, 22]] as const) set(c, r, 'T');
  for (const [c, r] of [[31, 7], [38, 7], [42, 10], [39, 13], [35, 25], [42, 23]] as const) set(c, r, 'U');
  for (const [c, r] of [[44, 14], [34, 26], [40, 29], [43, 28], [45, 24]] as const) if (grid[r]?.[c] !== '~') set(c, r, 'R');
  for (const [c, r] of [[29, 8], [34, 9], [38, 10], [42, 9], [35, 16], [38, 16], [35, 21], [38, 23], [38, 26], [42, 25]] as const) if (grid[r]?.[c] !== '~') set(c, r, 'L');
  return grid.map((row) => row.join(''));
}

export const BEACH_MAP: CitadelMap = Object.freeze({ width: BEACH_WIDTH, height: BEACH_HEIGHT, rows: Object.freeze(buildRows()) });

// The counter in front of a shop, where a guardian stands to shop or hand over a parcel.
export function shopCounter(shop: BeachShopId): Vec2 {
  const b = SHOP_BOOTHS[shop];
  return { x: b.col + 1, y: b.row + 2.5 };
}

export const SHOP_RANGE = 1.6;

export function atShop(pos: Vec2, shop: BeachShopId): boolean {
  const c = shopCounter(shop);
  return Math.hypot(pos.x - c.x, pos.y - c.y) <= SHOP_RANGE;
}

// The shop whose counter a position is at, if any.
export function shopAt(pos: Vec2): BeachShopId | null {
  return BEACH_SHOP_IDS.find((s) => atShop(pos, s)) ?? null;
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
