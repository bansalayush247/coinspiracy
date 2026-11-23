import type { RoomId } from './constants.js';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// Tile grid; tile (col, row) covers [col, col + 1) x [row, row + 1) in world units.
export interface CitadelMap {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
}

// Only floor and bridge/dock planks are walkable; everything else blocks.
export const WALKABLE_TILES = new Set(['.', '=']);

// Legend: # void/edge, . floor, = bridge or dock, B building, P pillar, K table,
// L lamp, T tree, C crates, G gate post, S task station, ~ water.
const ROWS = [
  '################################',
  '#............BBBBBBBBB..BBB#####',
  '#.BBBBBBB....BBBBBBBBB..BBB#####',
  '#.BBBBBBB....BBBBBBBBB..BBB#####',
  '#.BBBBBBB....BBBBBBBBB..BBB#####',
  '#.BBBBBBB....BBBBBBBBB..S..#####',
  '#.BBBBBBB....BBBBBBBBB.....#####',
  '#.BBBBBBB..........S.......#####',
  '#.BBBBBBB..................#####',
  '#..........................#####',
  '#.........L........L.......#####',
  '#.........................T#####',
  '#..........................#####',
  '#..........................#####',
  '#.........................T#####',
  '#P......P..................#####',
  '#..........................#####',
  '#..........................#####',
  '#...KK.....................#####',
  '#...KK....L........L.......=====',
  '#...........~~.............=====',
  '#...........~~.............=====',
  '#...........~~...........CS#####',
  '#P......P...~~........T....#####',
  '#...........==.............#####',
  '#...........~~.............#####',
  '#.G..G.S....~~.T...........#####',
  '################################',
] as const;

function buildMap(rows: readonly string[]): CitadelMap {
  const width = rows[0]?.length ?? 0;
  if (width === 0 || rows.some((r) => r.length !== width)) {
    throw new Error('citadel map rows must be non-empty and equal length');
  }
  return Object.freeze({ width, height: rows.length, rows: Object.freeze([...rows]) });
}

export const CITADEL_MAP: CitadelMap = buildMap(ROWS);

// Areas used for "which room am I in" (quick chat, tasks); first match wins.
export const ROOM_REGIONS: Readonly<Record<RoomId, Rect>> = Object.freeze({
  vault: { x: 1, y: 1, w: 9, h: 9 },
  ledgerArchive: { x: 12, y: 1, w: 11, h: 8 },
  watchtower: { x: 23, y: 1, w: 4, h: 7 },
  signingHall: { x: 1, y: 14, w: 9, h: 10 },
  depositGate: { x: 1, y: 24, w: 9, h: 3 },
  gatewayDock: { x: 22, y: 17, w: 10, h: 6 },
  plaza: { x: 10, y: 9, w: 10, h: 11 },
});

// Nine spawn points on a ring around the plaza seal, one per seat.
export const SPAWN_POINTS: readonly Vec2[] = Object.freeze(
  Array.from({ length: 9 }, (_, i) => {
    const angle = (i * 2 * Math.PI) / 9 - Math.PI / 2;
    return Object.freeze({ x: 15 + 2.2 * Math.cos(angle), y: 15 + 2.2 * Math.sin(angle) });
  }),
);

// Out-of-bounds reads as void so nothing can leave the island.
export function tileAt(map: CitadelMap, col: number, row: number): string {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return '#';
  return map.rows[row]?.[col] ?? '#';
}

export function isWalkableTile(map: CitadelMap, col: number, row: number): boolean {
  return WALKABLE_TILES.has(tileAt(map, col, row));
}

// Square footprint test: blocked if any overlapped tile is not walkable.
export function isBlocked(map: CitadelMap, pos: Vec2, radius: number): boolean {
  const minCol = Math.floor(pos.x - radius);
  const maxCol = Math.floor(pos.x + radius);
  const minRow = Math.floor(pos.y - radius);
  const maxRow = Math.floor(pos.y + radius);
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!isWalkableTile(map, col, row)) return true;
    }
  }
  return false;
}

function inRect(pos: Vec2, r: Rect): boolean {
  return pos.x >= r.x && pos.x < r.x + r.w && pos.y >= r.y && pos.y < r.y + r.h;
}

export function roomAt(pos: Vec2): RoomId | null {
  for (const [id, rect] of Object.entries(ROOM_REGIONS) as [RoomId, Rect][]) {
    if (inRect(pos, rect)) return id;
  }
  return null;
}
