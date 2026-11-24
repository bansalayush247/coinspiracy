// Arenas: the maps a match can be played on. Each has the same seven rooms and four stations,
// so every rule works everywhere; only the geography (and the routing difficulty) changes.
import { z } from 'zod';
import type { RoomId } from './constants.js';
import { CITADEL_MAP, ROOM_REGIONS, SPAWN_POINTS, isBlocked, type CitadelMap, type RoomRegions, type Vec2 } from './map.js';
import { PLAYER_RADIUS } from './movement.js';
import { buildIsletMap, scaleBox, scaleRect, scaleTile, withCuts, type Box, type IslandBuilding } from './isletMap.js';
import { COUNCIL_SEAL } from './meeting.js';
import { RELAYS } from './sabotage.js';
import { TASK_STATIONS, type TaskStations } from './tasks.js';

export const ARENA_IDS = ['citadel', 'reef', 'peaks'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];
export const ArenaIdSchema = z.enum(ARENA_IDS);

export interface Arena {
  readonly id: ArenaId;
  readonly name: string;
  // The island on the world map that opens this arena.
  readonly island: 'mint' | 'reef' | 'watchtower';
  readonly map: CitadelMap;
  readonly regions: RoomRegions;
  // Place names as quick chat and the HUD say them, with their article.
  readonly roomNames: Readonly<Record<RoomId, string>>;
  readonly stations: TaskStations;
  // One spawn per seat.
  readonly spawns: readonly Vec2[];
  readonly relays: readonly Vec2[];
  // Where a council is called from and where everyone gathers for it.
  readonly seal: Vec2;
  // Gateway payments here use tight channel margins: decoy routes miss by only a few sats.
  readonly hardRoutes: boolean;
  // Bridges that are down while a partition lasts, and the map without them; none where a partition
  // leaves the ground whole.
  readonly cutBridges: readonly Box[];
  readonly partitionMap: CitadelMap | null;
}

// The ground guardians walk on right now: during a partition some arenas lose their bridges.
export function movementMap(arena: Arena, partitioned: boolean): CitadelMap {
  return partitioned && arena.partitionMap !== null ? arena.partitionMap : arena.map;
}

// Where a guardian ends up when the ground under them goes (a bridge coming down): the nearest
// spot they can stand, searching outward tile by tile. Already standing is left alone.
export function nearestStandable(map: CitadelMap, pos: Vec2): Vec2 {
  if (!isBlocked(map, pos, PLAYER_RADIUS)) return pos;
  let best: Vec2 | null = null;
  let bestDistance = Infinity;
  const c0 = Math.floor(pos.x);
  const r0 = Math.floor(pos.y);
  for (let r = r0 - 6; r <= r0 + 6; r++) {
    for (let c = c0 - 6; c <= c0 + 6; c++) {
      const at = { x: c + 0.5, y: r + 0.5 };
      if (isBlocked(map, at, PLAYER_RADIUS)) continue;
      const d = Math.hypot(at.x - pos.x, at.y - pos.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = at;
      }
    }
  }
  return best ?? pos;
}

export const CITADEL: Arena = Object.freeze({
  id: 'citadel',
  name: 'The Mint Citadel',
  island: 'mint',
  map: CITADEL_MAP,
  regions: ROOM_REGIONS,
  roomNames: Object.freeze({
    plaza: 'the Plaza',
    vault: 'the Vault',
    ledgerArchive: 'the Ledger Archive',
    watchtower: 'the Watchtower',
    signingHall: 'the Signing Hall',
    depositGate: 'the Deposit Gate',
    gatewayDock: 'the Gateway Dock',
  }),
  stations: TASK_STATIONS,
  spawns: SPAWN_POINTS,
  relays: RELAYS,
  seal: COUNCIL_SEAL,
  hardRoutes: false,
  cutBridges: Object.freeze([]),
  partitionMap: null,
});

// The island maps are laid out on a small grid and grown by this factor, which keeps bridges meeting
// their islets and gives each islet room for its landmark, props and open ground.
export const ISLAND_SCALE = 1.5;
const S = ISLAND_SCALE;
const grow = (b: Box): Box => scaleBox(b, S);
const growAll = <K extends string>(boxes: Readonly<Record<K, Box>>): Readonly<Record<K, Box>> =>
  Object.freeze(Object.fromEntries(Object.entries<Box>(boxes).map(([k, b]) => [k, grow(b)])) as Record<K, Box>);
const growRegions = (regions: RoomRegions): RoomRegions =>
  Object.freeze(Object.fromEntries(Object.entries(regions).map(([k, r]) => [k, Object.freeze(scaleRect(r, S))])) as unknown as RoomRegions);
const growPoint = (x: number, y: number): Vec2 => Object.freeze({ x: x * S, y: y * S });
const growStations = (stations: TaskStations): TaskStations =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(stations).map(([k, st]) => {
        const [col, row] = scaleTile(st.col, st.row, S);
        return [k, Object.freeze({ ...st, col, row })];
      }),
    ) as unknown as TaskStations,
  );
// Spawn seats in a ring, one per seat.
const ring = (x: number, y: number, radius: number): readonly Vec2[] =>
  Object.freeze(
    Array.from({ length: 9 }, (_, i) => {
      const angle = (i * 2 * Math.PI) / 9 - Math.PI / 2;
      return Object.freeze({ x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) });
    }),
  );

export const REEF_WIDTH = Math.round(32 * S);
export const REEF_HEIGHT = Math.round(28 * S);

// Islet footprints (inclusive tile bounds) and the plank bridges between them.
export const REEF_ISLETS: Readonly<Record<RoomId, Box>> = growAll({
  vault: { c0: 2, r0: 2, c1: 9, r1: 8 },
  ledgerArchive: { c0: 13, r0: 2, c1: 20, r1: 6 },
  watchtower: { c0: 24, r0: 2, c1: 29, r1: 8 },
  plaza: { c0: 11, r0: 10, c1: 20, r1: 18 },
  signingHall: { c0: 2, r0: 12, c1: 8, r1: 20 },
  depositGate: { c0: 9, r0: 22, c1: 16, r1: 25 },
  gatewayDock: { c0: 22, r0: 17, c1: 29, r1: 25 },
});
export const REEF_BRIDGES: readonly Box[] = Object.freeze(
  [
    { c0: 10, r0: 4, c1: 12, r1: 5 }, // vault - ledger
    { c0: 21, r0: 3, c1: 23, r1: 4 }, // ledger - lighthouse
    { c0: 4, r0: 9, c1: 5, r1: 11 }, // vault - signing
    { c0: 15, r0: 7, c1: 16, r1: 9 }, // ledger - square
    { c0: 26, r0: 9, c1: 27, r1: 16 }, // lighthouse - harbour causeway
    { c0: 9, r0: 14, c1: 10, r1: 15 }, // signing - square
    { c0: 21, r0: 17, c1: 21, r1: 18 }, // square - harbour
    { c0: 13, r0: 19, c1: 14, r1: 21 }, // square - deposit pier
  ].map(grow),
);

// Landmarks: the pearl vault, the tide-ledger house, the lighthouse, the harbour house and the signing
// pavilion, plus fishers' huts and a market stall that make the islets lived in.
export const REEF_BUILDINGS: readonly IslandBuilding[] = Object.freeze([
  { kind: 'pearlVault', box: grow({ c0: 3, r0: 3, c1: 5, r1: 5 }) },
  { kind: 'ledgerHouse', box: grow({ c0: 13, r0: 2, c1: 14, r1: 3 }) },
  { kind: 'lighthouse', box: grow({ c0: 27, r0: 3, c1: 28, r1: 4 }) },
  { kind: 'harbourHouse', box: grow({ c0: 28, r0: 18, c1: 29, r1: 19 }) },
  { kind: 'pavilion', box: grow({ c0: 4, r0: 15, c1: 5, r1: 16 }) },
  { kind: 'hut', box: { c0: 39, r0: 31, c1: 40, r1: 32 } },
  { kind: 'hut', box: { c0: 13, r0: 9, c1: 14, r1: 10 } },
  { kind: 'hut', box: { c0: 10, r0: 18, c1: 11, r1: 19 } },
  { kind: 'stall', box: { c0: 27, r0: 15, c1: 28, r1: 15 } },
  { kind: 'stall', box: { c0: 23, r0: 26, c1: 24, r1: 26 } },
]);

export const REEF_STATIONS: TaskStations = growStations({
  deposit: { kind: 'deposit', room: 'depositGate', col: 12, row: 25 },
  ledger: { kind: 'ledger', room: 'ledgerArchive', col: 17, row: 2 },
  route: { kind: 'route', room: 'gatewayDock', col: 27, row: 23 },
  watchtower: { kind: 'watchtower', room: 'watchtower', col: 25, row: 6 },
});

// Legend: # void, ~ lagoon, . sand, = planks, B building, S station, L lantern, T palm, K signing table,
// R coral rock, C crates, U parasol, N net rack.
function buildReef(): CitadelMap {
  return buildIsletMap({
    width: REEF_WIDTH,
    height: REEF_HEIGHT,
    gap: '~',
    islets: REEF_ISLETS,
    bridges: REEF_BRIDGES,
    decorate: (fill, set) => {
      for (const b of REEF_BUILDINGS) fill(b.box, b.kind === 'pavilion' ? 'K' : 'B');
      for (const s of Object.values(REEF_STATIONS)) set(s.col, s.row, 'S');
      const grown = (list: readonly (readonly [number, number])[], t: string): void => {
        for (const [c, r] of list) set(...scaleTile(c, r, S), t);
      };
      grown([[12, 11], [19, 11], [12, 17], [19, 17], [7, 13], [24, 24], [3, 7], [20, 5]], 'L');
      grown([[2, 20], [8, 2], [29, 8], [9, 8], [22, 25], [16, 22], [2, 12]], 'T');
      grown([[24, 2], [29, 25], [9, 25], [20, 2]], 'R');
      grown([[23, 20], [23, 21]], 'C');
      // Extra palms, rocks, parasols and drying nets placed on the grown grid, clear of every path.
      for (const [c, r] of [[3, 12], [3, 3], [14, 3], [43, 3], [44, 12], [4, 18], [12, 30], [24, 37], [33, 26], [44, 26], [17, 15], [30, 16]] as const) set(c, r, 'T');
      for (const [c, r] of [[29, 3], [3, 30], [44, 38], [13, 38]] as const) set(c, r, 'R');
      for (const [c, r] of [[20, 19], [26, 26], [10, 11], [36, 38]] as const) set(c, r, 'U');
      for (const [c, r] of [[35, 28], [36, 28], [10, 30]] as const) set(c, r, 'N');
      for (const [c, r] of [[35, 32], [34, 33]] as const) set(c, r, 'C');
    },
  });
}

export const REEF_MAP: CitadelMap = buildReef();

export const REEF: Arena = Object.freeze({
  id: 'reef',
  name: 'Lightning Reef',
  island: 'reef',
  map: REEF_MAP,
  // First match wins, so the bridges at the edges of a box belong to that islet.
  regions: growRegions({
    vault: { x: 1, y: 1, w: 10, h: 9 },
    ledgerArchive: { x: 12, y: 1, w: 10, h: 7 },
    watchtower: { x: 23, y: 1, w: 8, h: 9 },
    signingHall: { x: 1, y: 11, w: 9, h: 11 },
    depositGate: { x: 8, y: 21, w: 10, h: 6 },
    gatewayDock: { x: 21, y: 16, w: 10, h: 11 },
    plaza: { x: 10, y: 9, w: 11, h: 11 },
  }),
  roomNames: Object.freeze({
    plaza: 'Lagoon Square',
    vault: 'the Pearl Vault',
    ledgerArchive: 'the Tide Ledger',
    watchtower: 'the Lighthouse',
    signingHall: 'the Signing Pavilion',
    depositGate: 'the Deposit Pier',
    gatewayDock: 'the Gateway Harbour',
  }),
  stations: REEF_STATIONS,
  // A ring on Lagoon Square, one point per seat.
  spawns: ring(15.9 * S, 14.4 * S, 2.3),
  // The pavilion's far corner and the harbour's: a repair spans the whole reef.
  relays: Object.freeze([growPoint(3.5, 18.5), growPoint(28.5, 21.5)]),
  // The compass rose in the middle of Lagoon Square, inside the spawn ring.
  seal: growPoint(15.9, 14.4),
  hardRoutes: true,
  cutBridges: Object.freeze([]),
  partitionMap: null,
});

export const PEAKS_WIDTH = Math.round(32 * S);
export const PEAKS_HEIGHT = Math.round(28 * S);

// Mountain tops (inclusive tile bounds) and the rope bridges over the chasms between them. The west
// range (Summit Square, the Ice Vault, the Signing Lodge, the Deposit Pass) and the east range (the
// Ledger Crag, the Watchtower Summit, the Gateway Ridge) meet only on the three bridges a partition cuts.
export const PEAKS_TOPS: Readonly<Record<RoomId, Box>> = growAll({
  vault: { c0: 2, r0: 2, c1: 8, r1: 8 },
  ledgerArchive: { c0: 13, r0: 2, c1: 20, r1: 7 },
  watchtower: { c0: 24, r0: 2, c1: 29, r1: 9 },
  plaza: { c0: 12, r0: 11, c1: 19, r1: 17 },
  signingHall: { c0: 2, r0: 12, c1: 8, r1: 20 },
  depositGate: { c0: 8, r0: 22, c1: 15, r1: 25 },
  gatewayDock: { c0: 22, r0: 15, c1: 29, r1: 25 },
});
// The three bridges between the ranges, which a partition takes down.
export const PEAKS_CUTS: readonly Box[] = Object.freeze(
  [
    { c0: 9, r0: 4, c1: 12, r1: 5 }, // Ice Vault - Ledger Crag
    { c0: 16, r0: 8, c1: 17, r1: 10 }, // Ledger Crag - Summit Square
    { c0: 20, r0: 15, c1: 21, r1: 16 }, // Summit Square - Gateway Ridge
  ].map(grow),
);
export const PEAKS_BRIDGES: readonly Box[] = Object.freeze([
  ...PEAKS_CUTS,
  ...[
    { c0: 4, r0: 9, c1: 5, r1: 11 }, // Ice Vault - Signing Lodge
    { c0: 9, r0: 15, c1: 11, r1: 16 }, // Signing Lodge - Summit Square
    { c0: 13, r0: 18, c1: 14, r1: 21 }, // Summit Square - Deposit Pass
    { c0: 21, r0: 3, c1: 23, r1: 4 }, // Ledger Crag - Watchtower Summit
    { c0: 26, r0: 10, c1: 27, r1: 16 }, // Watchtower Summit - Gateway Ridge
  ].map(grow),
]);

// The ice vault, the stone watchtower, chalets for the ledger and the gateway, the signing lodge's table,
// a herders' cabin and a stone arch over Summit Square's north side.
export const PEAKS_BUILDINGS: readonly IslandBuilding[] = Object.freeze([
  { kind: 'iceVault', box: grow({ c0: 3, r0: 3, c1: 5, r1: 5 }) },
  { kind: 'ledgerChalet', box: grow({ c0: 13, r0: 2, c1: 14, r1: 3 }) },
  { kind: 'stoneTower', box: grow({ c0: 27, r0: 3, c1: 28, r1: 4 }) },
  { kind: 'gatewayChalet', box: grow({ c0: 28, r0: 18, c1: 29, r1: 19 }) },
  { kind: 'signingTable', box: grow({ c0: 4, r0: 16, c1: 5, r1: 17 }) },
  { kind: 'cabin', box: { c0: 10, r0: 18, c1: 11, r1: 19 } },
  { kind: 'cabin', box: { c0: 39, r0: 31, c1: 40, r1: 32 } },
]);

export const PEAKS_STATIONS: TaskStations = growStations({
  deposit: { kind: 'deposit', room: 'depositGate', col: 11, row: 25 },
  ledger: { kind: 'ledger', room: 'ledgerArchive', col: 18, row: 2 },
  route: { kind: 'route', room: 'gatewayDock', col: 25, row: 23 },
  watchtower: { kind: 'watchtower', room: 'watchtower', col: 25, row: 7 },
});

// Legend: # void, ^ chasm, . rock and grass, = rope bridge, B building, S station, L lantern, T pine,
// K signing table, R boulder, A cairn, W woodpile.
export const PEAKS_MAP: CitadelMap = buildIsletMap({
  width: PEAKS_WIDTH,
  height: PEAKS_HEIGHT,
  gap: '^',
  islets: PEAKS_TOPS,
  bridges: PEAKS_BRIDGES,
  decorate: (fill, set) => {
    for (const b of PEAKS_BUILDINGS) fill(b.box, b.kind === 'signingTable' ? 'K' : 'B');
    for (const st of Object.values(PEAKS_STATIONS)) set(st.col, st.row, 'S');
    const grown = (list: readonly (readonly [number, number])[], t: string): void => {
      for (const [c, r] of list) set(...scaleTile(c, r, S), t);
    };
    grown([[12, 11], [19, 11], [12, 17], [19, 17], [7, 13], [22, 24], [3, 8], [20, 6]], 'L');
    grown([[2, 20], [8, 2], [29, 9], [2, 12], [15, 25], [29, 25], [24, 2], [8, 8]], 'T');
    grown([[20, 2], [2, 2], [8, 25], [22, 17]], 'R');
    // Pine stands, cairns and woodpiles placed on the grown grid, clear of every path.
    for (const [c, r] of [[3, 4], [4, 3], [12, 13], [3, 25], [4, 30], [3, 19], [21, 3], [30, 4], [44, 4], [44, 5], [43, 14], [44, 22], [44, 37], [43, 38], [34, 38], [33, 27], [12, 37], [24, 38]] as const) set(c, r, 'T');
    for (const [c, r] of [[18, 20], [37, 7], [14, 33], [35, 23]] as const) set(c, r, 'A');
    for (const [c, r] of [[6, 30], [41, 33], [22, 4]] as const) set(c, r, 'W');
    for (const [c, r] of [[29, 9], [13, 30], [42, 30]] as const) set(c, r, 'R');
  },
});

export const PEAKS: Arena = Object.freeze({
  id: 'peaks',
  name: 'Watchtower Peaks',
  island: 'watchtower',
  map: PEAKS_MAP,
  regions: growRegions({
    vault: { x: 1, y: 1, w: 9, h: 9 },
    ledgerArchive: { x: 12, y: 1, w: 10, h: 8 },
    watchtower: { x: 23, y: 1, w: 8, h: 10 },
    signingHall: { x: 1, y: 11, w: 9, h: 11 },
    depositGate: { x: 7, y: 21, w: 10, h: 6 },
    gatewayDock: { x: 21, y: 15, w: 10, h: 12 },
    plaza: { x: 10, y: 10, w: 11, h: 9 },
  }),
  roomNames: Object.freeze({
    plaza: 'Summit Square',
    vault: 'the Ice Vault',
    ledgerArchive: 'the Ledger Crag',
    watchtower: 'the Watchtower Summit',
    signingHall: 'the Signing Lodge',
    depositGate: 'the Deposit Pass',
    gatewayDock: 'the Gateway Ridge',
  }),
  stations: PEAKS_STATIONS,
  spawns: ring(16 * S, 14 * S, 2.2),
  // One relay on each range, so a repair needs a guardian on both sides of the cut.
  relays: Object.freeze([growPoint(3.5, 19.5), growPoint(28.5, 23.5)]),
  seal: growPoint(16, 14),
  hardRoutes: false,
  cutBridges: PEAKS_CUTS,
  partitionMap: withCuts(PEAKS_MAP, PEAKS_CUTS, '^'),
});

export const ARENAS: Readonly<Record<ArenaId, Arena>> = Object.freeze({ citadel: CITADEL, reef: REEF, peaks: PEAKS });

// Unknown ids fall back to the Citadel rather than throwing on a stale client.
export function arenaById(id: unknown): Arena {
  const parsed = ArenaIdSchema.safeParse(id);
  return parsed.success ? ARENAS[parsed.data] : CITADEL;
}
