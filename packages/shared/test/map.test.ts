import { describe, expect, it } from 'vitest';
import { ROOMS, type RoomId } from '../src/constants.js';
import {
  CITADEL_MAP,
  ROOM_REGIONS,
  SPAWN_POINTS,
  WALKABLE_TILES,
  isBlocked,
  isWalkableTile,
  roomAt,
  tileAt,
  type Rect,
} from '../src/map.js';
import { PLAYER_RADIUS } from '../src/movement.js';

const DOCK_ROWS = [19, 20, 21];

function walkableTiles(): [number, number][] {
  const tiles: [number, number][] = [];
  for (let row = 0; row < CITADEL_MAP.height; row++) {
    for (let col = 0; col < CITADEL_MAP.width; col++) {
      if (isWalkableTile(CITADEL_MAP, col, row)) tiles.push([col, row]);
    }
  }
  return tiles;
}

// 4-neighbour flood fill over walkable tiles.
function reachableFrom(col: number, row: number): Set<string> {
  const seen = new Set<string>([`${col},${row}`]);
  const queue: [number, number][] = [[col, row]];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const [c, r] = next;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${c + dc},${r + dr}`;
      if (!seen.has(key) && isWalkableTile(CITADEL_MAP, c + dc, r + dr)) {
        seen.add(key);
        queue.push([c + dc, r + dr]);
      }
    }
  }
  return seen;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('CITADEL_MAP', () => {
  it('is a 32 x 28 grid of equal-length rows', () => {
    expect(CITADEL_MAP.width).toBe(32);
    expect(CITADEL_MAP.height).toBe(28);
    for (const row of CITADEL_MAP.rows) expect(row).toHaveLength(32);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CITADEL_MAP)).toBe(true);
    expect(Object.isFrozen(CITADEL_MAP.rows)).toBe(true);
  });

  it('only walks on floor and planks; the city-only ground never appears in the Citadel', () => {
    expect([...WALKABLE_TILES].sort()).toEqual([',', '.', ':', '=', 'd']);
    for (const row of CITADEL_MAP.rows) for (const t of [':', ',', 'd']) expect(row.includes(t)).toBe(false);
  });

  it('seals the top and bottom edges', () => {
    for (let col = 0; col < CITADEL_MAP.width; col++) {
      expect(isWalkableTile(CITADEL_MAP, col, 0)).toBe(false);
      expect(isWalkableTile(CITADEL_MAP, col, CITADEL_MAP.height - 1)).toBe(false);
    }
  });

  it('seals the left edge and the right edge except the dock', () => {
    for (let row = 0; row < CITADEL_MAP.height; row++) {
      expect(isWalkableTile(CITADEL_MAP, 0, row)).toBe(false);
      for (let col = 27; col < CITADEL_MAP.width; col++) {
        expect(isWalkableTile(CITADEL_MAP, col, row)).toBe(DOCK_ROWS.includes(row));
      }
    }
  });

  it('has no unreachable pockets: every walkable tile connects to the plaza', () => {
    const reachable = reachableFrom(15, 15);
    const all = walkableTiles();
    expect(all.length).toBeGreaterThan(400);
    for (const [col, row] of all) expect(reachable.has(`${col},${row}`)).toBe(true);
  });

  it('reaches the dock end, the Signing Hall and the Deposit Gate from the plaza', () => {
    const reachable = reachableFrom(15, 15);
    for (const key of ['31,20', '5,16', '3,26', '13,24']) expect(reachable.has(key)).toBe(true);
  });
});

describe('tileAt / isWalkableTile', () => {
  it.each([
    [-1, 5],
    [5, -1],
    [32, 5],
    [5, 28],
    [1.5, 9],
    [Number.NaN, 9],
  ])('reads (%s, %s) as void', (col, row) => {
    expect(tileAt(CITADEL_MAP, col, row)).toBe('#');
    expect(isWalkableTile(CITADEL_MAP, col, row)).toBe(false);
  });

  it.each([
    { tile: 'B', col: 4, row: 4 },
    { tile: 'P', col: 1, row: 15 },
    { tile: 'K', col: 4, row: 18 },
    { tile: 'L', col: 10, row: 10 },
    { tile: 'T', col: 26, row: 11 },
    { tile: 'C', col: 25, row: 22 },
    { tile: 'G', col: 2, row: 26 },
    { tile: '~', col: 12, row: 20 },
  ])('blocks $tile at ($col, $row)', ({ tile, col, row }) => {
    expect(tileAt(CITADEL_MAP, col, row)).toBe(tile);
    expect(isWalkableTile(CITADEL_MAP, col, row)).toBe(false);
  });

  it('walks across the bridge and the dock', () => {
    expect(tileAt(CITADEL_MAP, 12, 24)).toBe('=');
    expect(isWalkableTile(CITADEL_MAP, 12, 24)).toBe(true);
    expect(isWalkableTile(CITADEL_MAP, 31, 20)).toBe(true);
  });
});

describe('isBlocked', () => {
  it('is clear in open floor and blocked when the footprint touches a wall', () => {
    expect(isBlocked(CITADEL_MAP, { x: 1.5, y: 9.5 }, PLAYER_RADIUS)).toBe(false);
    expect(isBlocked(CITADEL_MAP, { x: 1.2, y: 9.5 }, PLAYER_RADIUS)).toBe(true);
    expect(isBlocked(CITADEL_MAP, { x: 5, y: 9.2 }, PLAYER_RADIUS)).toBe(true);
  });

  it('treats everything outside the grid as blocked', () => {
    expect(isBlocked(CITADEL_MAP, { x: -10, y: -10 }, PLAYER_RADIUS)).toBe(true);
    expect(isBlocked(CITADEL_MAP, { x: 100, y: 15 }, PLAYER_RADIUS)).toBe(true);
  });
});

describe('ROOM_REGIONS / roomAt', () => {
  it('defines a region for every room', () => {
    expect(Object.keys(ROOM_REGIONS).sort()).toEqual([...ROOMS].sort());
  });

  it('keeps regions from overlapping', () => {
    const entries = Object.entries(ROOM_REGIONS);
    for (const [i, [a, ra]] of entries.entries()) {
      for (const [b, rb] of entries.slice(i + 1)) {
        expect(overlaps(ra, rb), `${a} overlaps ${b}`).toBe(false);
      }
    }
  });

  it.each(Object.entries(ROOM_REGIONS) as [RoomId, Rect][])(
    'finds %s at the centre of its region and gives it walkable floor',
    (id, rect) => {
      expect(roomAt({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 })).toBe(id);
      let walkable = 0;
      for (let row = rect.y; row < rect.y + rect.h; row++) {
        for (let col = rect.x; col < rect.x + rect.w; col++) {
          if (isWalkableTile(CITADEL_MAP, col, row)) walkable++;
        }
      }
      expect(walkable).toBeGreaterThan(0);
    },
  );

  it('returns null between rooms', () => {
    expect(roomAt({ x: 11, y: 23 })).toBeNull();
    expect(roomAt({ x: -5, y: -5 })).toBeNull();
  });
});

describe('SPAWN_POINTS', () => {
  it('has one clear plaza spot per seat', () => {
    expect(SPAWN_POINTS).toHaveLength(9);
    for (const p of SPAWN_POINTS) {
      expect(isBlocked(CITADEL_MAP, p, PLAYER_RADIUS)).toBe(false);
      expect(roomAt(p)).toBe('plaza');
    }
  });

  it('keeps spawn points far enough apart that avatars do not overlap', () => {
    for (const [i, a] of SPAWN_POINTS.entries()) {
      for (const b of SPAWN_POINTS.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * PLAYER_RADIUS);
      }
    }
  });
});
