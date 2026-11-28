// Port Concord: the open harbour city. One deterministic 128 x 128 tile map built from districts, a road
// grid, a river, the harbour basin and the Shallows islets. The server and every client build the same map.
import type { Box } from '../isletMap.js';
import type { CitadelMap, Vec2 } from '../map.js';

export const CITY_WIDTH = 128;
export const CITY_HEIGHT = 128;

// Legend: # void edge, ~ sea or river, . pavement, : road, , park grass, d dirt, = bridge or pier (all walkable);
// B building, T tree, L street lamp, C container or crates, M rubbish mound (all blocking).
export const CITY_WALKABLE = Object.freeze(['.', ':', ',', 'd', '=']);

export const DISTRICT_IDS = ['gullmoor', 'mint', 'heights', 'docks', 'council', 'signet', 'saltmarket', 'lowtide', 'shallows'] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];

export interface District {
  readonly id: DistrictId;
  readonly name: string;
  // What it used to be on the archipelago map, for players who knew the islands.
  readonly was: string;
  readonly box: Box;
}

// Inclusive tile bounds; the first match wins where boxes touch.
export const CITY_DISTRICTS: readonly District[] = Object.freeze([
  { id: 'shallows', name: 'The Shallows', was: 'new', box: { c0: 1, r0: 84, c1: 45, r1: 126 } },
  { id: 'gullmoor', name: 'Gullmoor', was: 'new', box: { c0: 1, r0: 1, c1: 45, r1: 29 } },
  { id: 'mint', name: 'The Mint', was: 'Mint Island', box: { c0: 46, r0: 1, c1: 85, r1: 29 } },
  { id: 'heights', name: 'The Heights', was: 'Watchtower Peaks', box: { c0: 86, r0: 1, c1: 126, r1: 45 } },
  { id: 'docks', name: 'The Reef Docks', was: 'Lightning Reef', box: { c0: 1, r0: 30, c1: 45, r1: 83 } },
  { id: 'council', name: 'Council Hill', was: 'Council Isle', box: { c0: 46, r0: 30, c1: 85, r1: 61 } },
  { id: 'signet', name: 'Signet Row', was: 'Signing Isle', box: { c0: 86, r0: 46, c1: 126, r1: 77 } },
  { id: 'saltmarket', name: 'Saltmarket', was: 'Beach Town', box: { c0: 46, r0: 62, c1: 85, r1: 126 } },
  { id: 'lowtide', name: 'Low Tide', was: 'new', box: { c0: 86, r0: 78, c1: 126, r1: 126 } },
]);

export function districtAt(pos: Vec2): District | null {
  const c = Math.floor(pos.x);
  const r = Math.floor(pos.y);
  return CITY_DISTRICTS.find((d) => c >= d.box.c0 && c <= d.box.c1 && r >= d.box.r0 && r <= d.box.r1) ?? null;
}

// A named landmark or an ordinary building, for the client to draw the right shape and height.
export const BUILDING_KINDS = ['mintHall', 'gateTower', 'cityHall', 'hospital', 'fishMarket', 'lighthouse', 'radioMast', 'gatehouse', 'warehouse', 'office', 'tower', 'shop', 'house', 'mansion', 'stall', 'arcade', 'chapel', 'temple', 'mandir'] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export interface CityBuilding {
  readonly kind: BuildingKind;
  readonly district: DistrictId;
  readonly box: Box;
  // Wall height in art pixels (64 px tiles).
  readonly height: number;
  // A stable per-building number for colours and details.
  readonly seed: number;
}

// Road centre lines: each road is two tiles wide starting at these.
export const ROAD_COLS = Object.freeze([30, 46, 56, 72, 86, 102, 116]);
export const ROAD_ROWS = Object.freeze([14, 30, 46, 62, 78]);
const RIVER: { readonly c0: number; readonly c1: number } = { c0: 63, c1: 65 };
const HARBOUR: Box = { c0: 2, r0: 40, c1: 21, r1: 74 };
export const CITY_SHALLOWS_ISLETS: readonly Box[] = [
  { c0: 14, r0: 90, c1: 26, r1: 99 },
  { c0: 30, r0: 96, c1: 38, r1: 106 },
  { c0: 12, r0: 106, c1: 22, r1: 116 },
];

// The coast: the land's southern edge, by column.
function coastRow(c: number): number {
  if (c < 40) return 82 + Math.round(2 * Math.sin(c / 5));
  return 98 + Math.round(3 * Math.sin(c / 8));
}

function seeded(seed: number): () => number {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Landmarks and the block each takes over, by the block's first column and row.
const LANDMARKS: readonly { kind: BuildingKind; at: readonly [number, number]; height: number }[] = [
  { kind: 'mintHall', at: [74, 16], height: 190 },
  { kind: 'cityHall', at: [74, 32], height: 170 },
  { kind: 'gateTower', at: [74, 48], height: 520 },
  { kind: 'hospital', at: [104, 48], height: 210 },
  { kind: 'fishMarket', at: [48, 64], height: 90 },
  { kind: 'arcade', at: [74, 64], height: 110 },
  { kind: 'chapel', at: [88, 32], height: 160 },
  { kind: 'temple', at: [104, 80], height: 130 },
  { kind: 'mandir', at: [88, 48], height: 120 },
  { kind: 'gatehouse', at: [32, 16], height: 70 },
];

export interface CityLayout {
  readonly map: CitadelMap;
  readonly buildings: readonly CityBuilding[];
}

function build(): CityLayout {
  const W = CITY_WIDTH;
  const H = CITY_HEIGHT;
  const grid: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => '~'));
  const inBounds = (c: number, r: number): boolean => c > 0 && r > 0 && c < W - 1 && r < H - 1;
  const at = (c: number, r: number): string => (inBounds(c, r) ? (grid[r]?.[c] ?? '#') : '#');
  const set = (c: number, r: number, t: string): void => {
    const row = grid[r];
    if (row !== undefined && inBounds(c, r)) row[c] = t;
  };
  const fill = (b: Box, t: string): void => {
    for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) set(c, r, t);
  };
  // Like fill, but only over open pavement: blocks never spill into the sea or the river.
  const paint = (b: Box, t: string): void => {
    for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) if (at(c, r) === '.') set(c, r, t);
  };
  const isLand = (c: number, r: number): boolean => {
    const west = 11 + Math.round(1.5 * Math.sin(r / 6));
    return c >= west && c <= W - 4 && r >= 3 && r <= coastRow(c);
  };
  // Land, then water cut into it: the harbour basin and the river.
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (isLand(c, r)) set(c, r, '.');
  fill(HARBOUR, '~');
  for (let r = 0; r < H; r++) for (let c = RIVER.c0; c <= RIVER.c1; c++) set(c, r, '~');
  // Roads, bridged where they cross water inside the city.
  const road = (c: number, r: number): void => {
    const t = at(c, r);
    if (t === '.') set(c, r, ':');
    else if (t === '~' && isLand(c, r)) set(c, r, '=');
  };
  for (const c0 of ROAD_COLS) for (let r = 3; r < H; r++) for (const c of [c0, c0 + 1]) if (isLand(c, r)) road(c, r);
  for (const r0 of ROAD_ROWS) for (let c = 1; c < W; c++) for (const r of [r0, r0 + 1]) if (isLand(c, r)) road(c, r);
  // The seafront boardwalk along the southern coast, two planks wide.
  for (let c = 40; c < W - 4; c++) {
    const r = coastRow(c);
    set(c, r, '=');
    set(c, r - 1, '=');
  }
  // Piers into the harbour basin.
  for (const pr of [48, 58, 68]) for (let c = 6; c <= HARBOUR.c1; c++) for (const r of [pr, pr + 1]) set(c, r, '=');
  // The Shallows: islets beyond the breakwater, joined to the docks by a long pier.
  for (const b of CITY_SHALLOWS_ISLETS) fill(b, '.');
  for (let r = 70; r <= 89; r++) for (const c of [24, 25]) if (at(c, r) === '~') set(c, r, '=');
  fill({ c0: 27, r0: 98, c1: 29, r1: 99 }, '=');
  fill({ c0: 17, r0: 100, c1: 18, r1: 105 }, '=');
  // A breakwater with a lighthouse on a rocky tip.
  fill({ c0: 2, r0: 76, c1: 10, r1: 77 }, '=');
  fill({ c0: 2, r0: 72, c1: 6, r1: 75 }, '.');

  const buildings: CityBuilding[] = [];
  let seed = 1;
  const place = (kind: BuildingKind, district: DistrictId, box: Box, height: number): void => {
    for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) if (at(c, r) !== '.') return;
    fill(box, 'B');
    buildings.push(Object.freeze({ kind, district, box: Object.freeze(box), height, seed: seed++ }));
  };
  const districtOf = (c: number, r: number): DistrictId => districtAt({ x: c + 0.5, y: r + 0.5 })?.id ?? 'saltmarket';

  // Blocks: the land between roads. Each keeps a one-tile pavement ring and is filled by its district's style.
  const edges = (lines: readonly number[], max: number): [number, number][] => {
    const cuts = [0, ...lines.flatMap((l) => [l, l + 2]), max];
    const out: [number, number][] = [];
    for (let i = 0; i < cuts.length; i += 2) {
      const a = cuts[i] ?? 0;
      const b = (cuts[i + 1] ?? max) - 1;
      if (b > a) out.push([a, b]);
    }
    return out;
  };
  const landmarkBlocks = new Map<string, (typeof LANDMARKS)[number]>();
  for (const l of LANDMARKS) landmarkBlocks.set(`${String(l.at[0])},${String(l.at[1])}`, l);
  for (const [bc0, bc1] of edges(ROAD_COLS, W)) {
    for (const [br0, br1] of edges(ROAD_ROWS, H)) {
      const inner: Box = { c0: bc0 + 1, r0: br0 + 1, c1: bc1 - 1, r1: br1 - 1 };
      if (inner.c1 - inner.c0 < 2 || inner.r1 - inner.r0 < 2) continue;
      const district = districtOf((inner.c0 + inner.c1) >> 1, (inner.r0 + inner.r1) >> 1);
      const landmark = landmarkBlocks.get(`${String(bc0)},${String(br0)}`);
      const rand = seeded(bc0 * 131 + br0 * 17);
      if (landmark !== undefined) {
        const lm: Box = { c0: inner.c0 + 1, r0: inner.r0 + 1, c1: Math.min(inner.c1 - 1, inner.c0 + 9), r1: Math.min(inner.r1 - 1, inner.r0 + 9) };
        place(landmark.kind, district, lm, landmark.height);
        // The rest of a landmark block is its forecourt: trees and lamps.
        for (let r = inner.r0; r <= inner.r1; r += 3) for (let c = inner.c0; c <= inner.c1; c += 4) if (at(c, r) === '.' && rand() < 0.5) set(c, r, (c + r) % 2 === 0 ? 'T' : ',');
        continue;
      }
      fillBlock(district, inner, rand);
    }
  }

  function fillBlock(district: DistrictId, b: Box, rand: () => number): void {
    const w = b.c1 - b.c0 + 1;
    const d = b.r1 - b.r0 + 1;
    if (district === 'gullmoor') {
      // The tip: dirt, rubbish mounds on a loose grid and crates of scrap.
      paint(b, 'd');
      for (let r = b.r0 + 1; r < b.r1; r += 3) for (let c = b.c0 + 1; c < b.c1; c += 3) if (at(c, r) === 'd' && rand() < 0.7) set(c, r, rand() < 0.8 ? 'M' : 'C');
      return;
    }
    if (district === 'shallows') return;
    // A small park now and then.
    if (rand() < (district === 'heights' ? 0.3 : district === 'lowtide' ? 0.15 : 0.1)) {
      paint(b, ',');
      for (let i = 0; i < Math.max(2, (w * d) / 14); i++) {
        const c = b.c0 + 1 + Math.floor(rand() * Math.max(1, w - 2));
        const r = b.r0 + 1 + Math.floor(rand() * Math.max(1, d - 2));
        if (at(c, r) === ',' && (c + r) % 2 === 0) set(c, r, 'T');
      }
      return;
    }
    const style: Readonly<Record<DistrictId, { lot: number; kind: BuildingKind; h: [number, number] }>> = {
      gullmoor: { lot: 4, kind: 'warehouse', h: [50, 70] },
      mint: { lot: 6, kind: 'office', h: [140, 230] },
      heights: { lot: 6, kind: 'mansion', h: [90, 130] },
      docks: { lot: 7, kind: 'warehouse', h: [70, 100] },
      council: { lot: 5, kind: 'office', h: [150, 300] },
      signet: { lot: 5, kind: 'tower', h: [180, 340] },
      saltmarket: { lot: 4, kind: 'shop', h: [70, 120] },
      lowtide: { lot: 3, kind: 'house', h: [60, 90] },
      shallows: { lot: 3, kind: 'house', h: [60, 80] },
    };
    const s = style[district];
    // Lots in rows and columns with one-tile alleys, so every lot touches open ground.
    for (let r = b.r0; r + 1 <= b.r1; r += s.lot + 1) {
      for (let c = b.c0; c + 1 <= b.c1; c += s.lot + 1) {
        const box: Box = { c0: c, r0: r, c1: Math.min(b.c1, c + s.lot - 1), r1: Math.min(b.r1, r + s.lot - 1) };
        if (box.c1 - box.c0 < 1 || box.r1 - box.r0 < 1) continue;
        if (district === 'docks' && rand() < 0.3) {
          // A container yard instead of a warehouse.
          for (let rr = box.r0; rr <= box.r1; rr += 2) for (let cc = box.c0; cc <= box.c1; cc++) if (at(cc, rr) === '.' && rand() < 0.75) set(cc, rr, 'C');
          continue;
        }
        if (district === 'saltmarket' && rand() < 0.25) {
          place('stall', district, { ...box, r1: box.r0 }, 60);
          continue;
        }
        const kind: BuildingKind = district === 'heights' && rand() < 0.25 ? 'house' : s.kind;
        const h = s.h[0] + Math.round(rand() * (s.h[1] - s.h[0]));
        place(kind, district, box, h);
      }
    }
  }

  // Landmarks outside the grid: the breakwater lighthouse, the radio mast on the Heights, cottages on the Shallows.
  place('lighthouse', 'docks', { c0: 2, r0: 72, c1: 4, r1: 74 }, 260);
  place('radioMast', 'heights', { c0: 120, r0: 5, c1: 121, r1: 6 }, 600);
  place('house', 'shallows', { c0: 16, r0: 92, c1: 18, r1: 94 }, 70);
  place('house', 'shallows', { c0: 33, r0: 99, c1: 35, r1: 101 }, 70);
  place('house', 'shallows', { c0: 14, r0: 109, c1: 16, r1: 111 }, 70);
  place('mandir', 'shallows', { c0: 20, r0: 93, c1: 23, r1: 96 }, 80);
  // Street trees on the Heights and the Mint, and lamps at road corners.
  for (const c0 of ROAD_COLS) {
    for (const r0 of ROAD_ROWS) {
      for (const [c, r] of [[c0 - 1, r0 - 1], [c0 + 2, r0 + 2]] as const) if (at(c, r) === '.') set(c, r, 'L');
    }
  }
  for (let r = 3; r < H; r += 4) {
    for (let c = 3; c < W; c += 4) {
      const district = districtOf(c, r);
      if ((district === 'heights' || district === 'mint' || district === 'shallows') && at(c, r) === '.' && (at(c + 1, r) === ':' || at(c - 1, r) === ':' || at(c, r + 1) === ':' || at(c, r - 1) === ':')) set(c, r, 'T');
    }
  }
  // Palms and crates on the Shallows islets.
  for (const b of CITY_SHALLOWS_ISLETS) for (let r = b.r0; r <= b.r1; r += 3) for (let c = b.c0; c <= b.c1; c += 4) if (at(c, r) === '.' && (c * 7 + r) % 3 === 0) set(c, r, 'T');
  // The void rim.
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (!inBounds(c, r)) (grid[r] ?? [])[c] = '#';
  // No walkable pocket may be sealed off: anything not reachable from the spawn becomes a tree.
  const walk = new Set(CITY_WALKABLE);
  const seen = new Uint8Array(W * H);
  const start = CITY_SPAWN_TILE;
  const queue = [start[1] * W + start[0]];
  seen[queue[0] ?? 0] = 1;
  while (queue.length > 0) {
    const i = queue.pop() ?? 0;
    const c = i % W;
    const r = (i - c) / W;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      const ni = nr * W + nc;
      if (inBounds(nc, nr) && seen[ni] === 0 && walk.has(at(nc, nr))) {
        seen[ni] = 1;
        queue.push(ni);
      }
    }
  }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (walk.has(at(c, r)) && seen[r * W + c] === 0) set(c, r, at(c, r) === '=' ? '~' : 'T');
  const map: CitadelMap = Object.freeze({ width: W, height: H, rows: Object.freeze(grid.map((row) => row.join(''))) });
  return { map, buildings: Object.freeze(buildings) };
}

// Everyone arrives on the Saltmarket boardwalk, looking up at the city with the sea behind them.
const SPAWN_COL = 61;
const CITY_SPAWN_TILE = [SPAWN_COL, coastRow(SPAWN_COL)] as const;

const LAYOUT = build();
export const CITY_MAP: CitadelMap = LAYOUT.map;
export const CITY_BUILDINGS: readonly CityBuilding[] = LAYOUT.buildings;

// Spawn points in a loose ring on the crossroads, so new arrivals don't stack.
export const CITY_SPAWNS: readonly Vec2[] = Object.freeze(
  Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 2 * Math.PI) / 12;
    return Object.freeze({ x: CITY_SPAWN_TILE[0] + 0.5 + 1.4 * Math.cos(angle), y: CITY_SPAWN_TILE[1] + 0.5 * Math.sin(angle) });
  }),
);
