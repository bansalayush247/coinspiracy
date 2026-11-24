import { describe, expect, it, vi } from 'vitest';
import {
  BUILDING_KINDS,
  CHUNK,
  CITY_BUILDINGS,
  CITY_DISTRICTS,
  CITY_HEIGHT,
  CITY_MAP,
  CITY_SPAWNS,
  CITY_WALKABLE,
  CITY_WIDTH,
  DISTRICT_IDS,
  INTEREST_HIDE,
  INTEREST_SHOW,
  chunkOf,
  chunksAround,
  districtAt,
  keepsInView,
} from '../src/city/index.js';
import { isWalkableTile, tileAt } from '../src/map.js';
import { canStand, findPath } from '../src/pathfinding.js';

const walkable = (c: number, r: number): boolean => isWalkableTile(CITY_MAP, c, r);

describe('Port Concord map', () => {
  it('is 128 x 128 with a void rim', () => {
    expect(CITY_MAP.width).toBe(CITY_WIDTH);
    expect(CITY_MAP.height).toBe(CITY_HEIGHT);
    expect(CITY_MAP.rows).toHaveLength(CITY_HEIGHT);
    for (const row of CITY_MAP.rows) expect(row).toHaveLength(CITY_WIDTH);
    for (let i = 0; i < CITY_WIDTH; i++) {
      expect(tileAt(CITY_MAP, i, 0)).toBe('#');
      expect(tileAt(CITY_MAP, i, CITY_HEIGHT - 1)).toBe('#');
      expect(tileAt(CITY_MAP, 0, i)).toBe('#');
      expect(tileAt(CITY_MAP, CITY_WIDTH - 1, i)).toBe('#');
    }
  });

  it('is the same map every time it is built', async () => {
    vi.resetModules();
    const again = await import('../src/city/map.js');
    expect(again.CITY_MAP).not.toBe(CITY_MAP);
    expect(again.CITY_MAP.rows).toEqual(CITY_MAP.rows);
  });

  it('only walks on the city tiles the movement rules know', () => {
    for (const t of CITY_WALKABLE) expect(isWalkableTile({ width: 1, height: 1, rows: [t] }, 0, 0)).toBe(true);
  });

  it('is one connected city: every walkable tile reaches every other', () => {
    const W = CITY_WIDTH;
    const total = CITY_MAP.rows.join('').split('').filter((t) => CITY_WALKABLE.includes(t)).length;
    const start = CITY_SPAWNS[0];
    if (start === undefined) throw new Error('spawn');
    const seen = new Set<number>([Math.floor(start.y) * W + Math.floor(start.x)]);
    const queue = [...seen];
    while (queue.length > 0) {
      const i = queue.pop() ?? 0;
      const c = i % W;
      const r = (i - c) / W;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = (r + dr) * W + c + dc;
        if (!seen.has(n) && walkable(c + dc, r + dr)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(total);
    // Big enough to explore: many times a match arena.
    expect(total).toBeGreaterThan(5000);
  });

  it('spawns everyone on their own standable spot', () => {
    expect(CITY_SPAWNS.length).toBeGreaterThanOrEqual(8);
    for (const s of CITY_SPAWNS) expect(canStand(CITY_MAP, s)).toBe(true);
  });

  it('reaches every district on foot from the spawn', () => {
    const start = CITY_SPAWNS[0];
    if (start === undefined) throw new Error('spawn');
    for (const d of CITY_DISTRICTS) {
      let target: { x: number; y: number } | null = null;
      for (let r = d.box.r0; r <= d.box.r1 && target === null; r++) {
        for (let c = d.box.c0; c <= d.box.c1 && target === null; c++) if (canStand(CITY_MAP, { x: c + 0.5, y: r + 0.5 })) target = { x: c + 0.5, y: r + 0.5 };
      }
      expect(target, d.id).not.toBeNull();
      if (target !== null) expect(findPath(CITY_MAP, start, target).ok, d.id).toBe(true);
    }
  });

  it('names a district for every tile, and every district is on the map', () => {
    expect(new Set(CITY_DISTRICTS.map((d) => d.id))).toEqual(new Set(DISTRICT_IDS));
    for (let r = 1; r < CITY_HEIGHT - 1; r += 7) for (let c = 1; c < CITY_WIDTH - 1; c += 7) expect(districtAt({ x: c + 0.5, y: r + 0.5 })).not.toBeNull();
    expect(districtAt({ x: -3, y: 4 })).toBeNull();
  });

  it('marks every building on the map, without overlaps, and has each landmark once', () => {
    const owner = new Map<string, number>();
    CITY_BUILDINGS.forEach((b, i) => {
      expect(BUILDING_KINDS).toContain(b.kind);
      for (let r = b.box.r0; r <= b.box.r1; r++) {
        for (let c = b.box.c0; c <= b.box.c1; c++) {
          expect(tileAt(CITY_MAP, c, r)).toBe('B');
          expect(owner.has(`${String(c)},${String(r)}`)).toBe(false);
          owner.set(`${String(c)},${String(r)}`, i);
        }
      }
    });
    for (const kind of ['mintHall', 'gateTower', 'cityHall', 'hospital', 'fishMarket', 'lighthouse', 'radioMast', 'gatehouse'] as const) {
      expect(CITY_BUILDINGS.filter((b) => b.kind === kind), kind).toHaveLength(1);
    }
    // Every B tile belongs to a building the client knows how to draw.
    let tiles = 0;
    for (const row of CITY_MAP.rows) for (const t of row) if (t === 'B') tiles++;
    expect(tiles).toBe(owner.size);
  });
});

describe('interest management', () => {
  it('shows players inside the near range and keeps them until the far range', () => {
    const me = { x: 50, y: 50 };
    expect(keepsInView(me, { x: 50 + INTEREST_SHOW, y: 50 }, false)).toBe(true);
    expect(keepsInView(me, { x: 50 + INTEREST_SHOW + 1, y: 50 }, false)).toBe(false);
    // Already visible: kept a little further out, so walking along the edge doesn't flicker.
    expect(keepsInView(me, { x: 50 + INTEREST_SHOW + 1, y: 50 }, true)).toBe(true);
    expect(keepsInView(me, { x: 50, y: 50 + INTEREST_HIDE + 0.5 }, true)).toBe(false);
  });

  it('streams chunks nearest first and never off the map', () => {
    expect(chunkOf({ x: CHUNK * 2 + 0.5, y: 3 })).toEqual({ cx: 2, cy: 0 });
    const keys = chunksAround({ x: 1, y: 1 }, 1, CITY_WIDTH, CITY_HEIGHT);
    expect(keys[0]).toBe('0,0');
    expect(keys).toHaveLength(4);
    const middle = chunksAround({ x: 64, y: 64 }, 2, CITY_WIDTH, CITY_HEIGHT);
    expect(middle).toHaveLength(25);
    expect(middle[0]).toBe('4,4');
  });
});
