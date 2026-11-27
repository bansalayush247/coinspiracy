// Walk-in buildings: which ones open, where their doors are, and the rooms inside. A room sits far off the city map,
// so nothing on the street (fights, coin piles, cars, toughs) can reach anyone inside, and the server sends a guardian
// inside only to the others in the same place. Houses are each guardian's own private flat.
import { z } from 'zod';
import { isBlocked, tileAt, type CitadelMap, type Vec2 } from '../map.js';
import { PLAYER_RADIUS, stepMovement } from '../movement.js';
import { BUILDING_KINDS, CITY_BUILDINGS, CITY_MAP, type BuildingKind, type CityBuilding } from './map.js';
import raw from './tuning/interiors.json' with { type: 'json' };

/** The kinds of room a building can open into. */
export const ROOM_KINDS = ['shop', 'mintHall', 'hospital', 'flat'] as const;
/** A kind of room a building can open into. */
export type RoomKind = (typeof ROOM_KINDS)[number];

/** Every piece of furniture a room can hold. */
export const PIECES = ['counter', 'shelf', 'rug', 'plant', 'lamp', 'table', 'chair', 'bed', 'sofa', 'bookcase', 'column', 'vaultDoor', 'noticeBoard', 'bench', 'desk', 'hospitalBed'] as const;
/** A piece of furniture. */
export type Piece = (typeof PIECES)[number];

// Pieces you walk over rather than round.
const FLAT_PIECES: ReadonlySet<Piece> = new Set(['rug']);

const FurnitureSchema = z.strictObject({ piece: z.enum(PIECES), c: z.int().min(1), r: z.int().min(1), w: z.int().min(1), d: z.int().min(1) });
const SpotSchema = z.strictObject({ kind: z.enum(['counter', 'reception', 'bed', 'board']), c: z.int().min(1), r: z.int().min(1) });
const LayoutSchema = z.strictObject({
  w: z.int().min(5).max(24),
  d: z.int().min(5).max(24),
  floor: z.enum(['planks', 'tile', 'marble', 'carpet']),
  wall: z.enum(['plaster', 'brick', 'panel', 'stone']),
  furniture: z.array(FurnitureSchema).max(40),
  spots: z.array(SpotSchema).max(8),
});

/** The shape of `tuning/interiors.json`: doors, which buildings open into which rooms, and every room's layout. */
export const InteriorTuningSchema = z.strictObject({
  door: z.strictObject({
    reach: z.number().positive().max(3),
    exitReach: z.number().positive().max(3),
    gapMs: z.int().min(0).max(10_000),
    lockMs: z.int().min(0).max(5_000),
    hitLockMs: z.int().min(0).max(60_000),
    maxOccupants: z.int().min(1).max(60),
  }),
  enterable: z.partialRecord(z.enum(BUILDING_KINDS), z.enum(ROOM_KINDS)),
  layouts: z.strictObject({ shop: z.array(LayoutSchema).min(1), mintHall: z.array(LayoutSchema).min(1), hospital: z.array(LayoutSchema).min(1), flat: z.array(LayoutSchema).min(1) }),
});
/** The interiors' tuning, as checked by `InteriorTuningSchema`. */
export type InteriorTuning = z.infer<typeof InteriorTuningSchema>;
/** One room's layout: its size in tiles, its finishes, its furniture and the spots where something can be done. */
export type RoomLayout = z.infer<typeof LayoutSchema>;
/** A piece of furniture placed in a room, by its back corner tile and its size. */
export type Furniture = z.infer<typeof FurnitureSchema>;
/** A place in a room where something can be done: a shop counter, the hospital desk, a bed, a notice board. */
export type RoomSpot = z.infer<typeof SpotSchema>;

/** The tile column of a room's door, in the middle of its front (south) wall. */
export const doorColumn = (layout: RoomLayout): number => Math.floor(layout.w / 2);

/** A room as a tile map: walls round the edge with the doorway open, floor inside, and solid furniture blocking. */
export function roomMap(layout: RoomLayout): CitadelMap {
  const rows: string[] = [];
  const door = doorColumn(layout);
  for (let r = 0; r < layout.d; r++) {
    let row = '';
    for (let c = 0; c < layout.w; c++) {
      const wall = r === 0 || c === 0 || c === layout.w - 1 || (r === layout.d - 1 && c !== door);
      row += wall ? '#' : '.';
    }
    rows.push(row);
  }
  const grid = rows.map((row) => row.split(''));
  for (const f of layout.furniture) {
    if (FLAT_PIECES.has(f.piece)) continue;
    for (let r = f.r; r < f.r + f.d; r++) for (let c = f.c; c < f.c + f.w; c++) if (grid[r]?.[c] === '.') (grid[r] ?? [])[c] = 'K';
  }
  return { width: layout.w, height: layout.d, rows: grid.map((row) => row.join('')) };
}

/** Where a guardian appears on entering: a step and a half inside the door. */
export const roomSpawn = (layout: RoomLayout): Vec2 => ({ x: doorColumn(layout) + 0.5, y: layout.d - 2.5 });

// Every way a layout can be wrong that its shape alone can't catch.
function layoutProblems(name: string, layout: RoomLayout): string[] {
  const problems: string[] = [];
  for (const f of layout.furniture) {
    if (f.c + f.w > layout.w - 1 || f.r + f.d > layout.d - 1) problems.push(`${name}: ${f.piece} at ${String(f.c)},${String(f.r)} is outside the room`);
  }
  const map = roomMap(layout);
  const spawn = roomSpawn(layout);
  if (isBlocked(map, spawn, PLAYER_RADIUS)) problems.push(`${name}: the way in is blocked`);
  if (isBlocked(map, { x: doorColumn(layout) + 0.5, y: layout.d - 1.5 }, PLAYER_RADIUS)) problems.push(`${name}: the inside of the door is blocked`);
  const seen = new Set<string>();
  const queue: [number, number][] = [[Math.floor(spawn.x), Math.floor(spawn.y)]];
  while (queue.length > 0) {
    const [c, r] = queue.pop() ?? [0, 0];
    const key = `${String(c)},${String(r)}`;
    if (seen.has(key) || tileAt(map, c, r) !== '.') continue;
    seen.add(key);
    queue.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  for (let r = 0; r < layout.d; r++) for (let c = 0; c < layout.w; c++) if (tileAt(map, c, r) === '.' && !seen.has(`${String(c)},${String(r)}`)) problems.push(`${name}: tile ${String(c)},${String(r)} can't be reached`);
  for (const s of layout.spots) if (tileAt(map, s.c, s.r) !== '.') problems.push(`${name}: the ${s.kind} spot is not on open floor`);
  return problems;
}

/** Every way the interiors' tuning can be wrong that its shape alone can't catch: furniture outside a room, a blocked way in, floor nobody can reach. */
export function interiorTuningProblems(t: InteriorTuning): string[] {
  return ROOM_KINDS.flatMap((kind) => t.layouts[kind].flatMap((layout, i) => layoutProblems(`${kind} ${String(i)}`, layout)));
}

/** The interiors' tuning, checked once at load so a bad edit fails loudly instead of playing wrong. */
export const INTERIOR_TUNING: InteriorTuning = Object.freeze(
  InteriorTuningSchema.superRefine((t, ctx) => {
    for (const message of interiorTuningProblems(t)) ctx.addIssue({ code: 'custom', message });
  }).parse(raw),
);

/** Door tuning: how near the door you must stand, the gap between trips, and the lock after being hit. */
export const DOOR_TUNING = INTERIOR_TUNING.door;

/** Rooms sit here, far beyond the city's edge, so no street rule can ever reach anyone inside. */
export const INTERIOR_ORIGIN: Vec2 = Object.freeze({ x: 4096, y: 4096 });

/** The kind of room a building opens into, or null if it stays shut. */
export function roomKindOf(kind: BuildingKind): RoomKind | null {
  return INTERIOR_TUNING.enterable[kind] ?? null;
}

const walkable = (p: Vec2): boolean => !isBlocked(CITY_MAP, p, PLAYER_RADIUS);

/** Where a building's door is, one step out on the street: the middle of its front face, else its east face; null if neither is open. */
export function doorOf(b: CityBuilding): Vec2 | null {
  const south = { x: (b.box.c0 + b.box.c1 + 1) / 2, y: b.box.r1 + 1.5 };
  if (walkable(south)) return south;
  const east = { x: b.box.c1 + 1.5, y: (b.box.r0 + b.box.r1 + 1) / 2 };
  return walkable(east) ? east : null;
}

/** Every building that opens, with its door and its room kind; worked out once. */
export const BUILDING_DOORS: readonly { readonly building: CityBuilding; readonly at: Vec2; readonly room: RoomKind }[] = Object.freeze(
  CITY_BUILDINGS.flatMap((building) => {
    const room = roomKindOf(building.kind);
    const at = room === null ? null : doorOf(building);
    return room === null || at === null ? [] : [Object.freeze({ building, at: Object.freeze(at), room })];
  }),
);

const BY_SEED = new Map(BUILDING_DOORS.map((d) => [d.building.seed, d]));

/** The door a guardian standing at `pos` on the street can go through, the nearest within reach; null if none. */
export function doorAt(pos: Vec2): (typeof BUILDING_DOORS)[number] | null {
  let best: (typeof BUILDING_DOORS)[number] | null = null;
  let bestDist: number = DOOR_TUNING.reach;
  for (const d of BUILDING_DOORS) {
    const dist = Math.hypot(pos.x - d.at.x, pos.y - d.at.y);
    if (dist <= bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

/** The door of the building with this seed, if it opens. */
export const doorBySeed = (seed: number): (typeof BUILDING_DOORS)[number] | null => BY_SEED.get(seed) ?? null;

/** The layout of a building's room: the same for everyone, picked by its seed, or for a flat by its owner's number. */
export function layoutFor(room: RoomKind, pick: number): RoomLayout {
  const list = INTERIOR_TUNING.layouts[room];
  const layout = list[Math.abs(Math.trunc(pick)) % list.length];
  if (layout === undefined) throw new Error(`no ${room} layouts`);
  return layout;
}

/** A stable number from an id, so a guardian's flat always looks the same. */
export function flatPick(ownerId: string): number {
  let h = 2166136261;
  for (let i = 0; i < ownerId.length; i++) h = Math.imul(h ^ ownerId.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A room-local point as a world point inside the rooms area, and back. */
export const toWorld = (local: Vec2): Vec2 => ({ x: local.x + INTERIOR_ORIGIN.x, y: local.y + INTERIOR_ORIGIN.y });
export const toLocal = (world: Vec2): Vec2 => ({ x: world.x - INTERIOR_ORIGIN.x, y: world.y - INTERIOR_ORIGIN.y });

/** Whether a world point lies in the rooms area rather than on the street. */
export const isIndoors = (world: Vec2): boolean => world.x >= INTERIOR_ORIGIN.x - 1 && world.y >= INTERIOR_ORIGIN.y - 1;

/** One step of walking inside a room, in world coordinates, against the room's walls and furniture. */
export function stepIndoors(world: Vec2, input: Vec2, dtSeconds: number, map: CitadelMap): Vec2 {
  return toWorld(stepMovement(toLocal(world), input, dtSeconds, map));
}

/** Whether a guardian inside stands close enough to the door to leave by it. */
export function atExit(world: Vec2, layout: RoomLayout): boolean {
  const local = toLocal(world);
  return Math.hypot(local.x - (doorColumn(layout) + 0.5), local.y - (layout.d - 1)) <= DOOR_TUNING.exitReach;
}

/** Whether a guardian inside has walked out through the doorway, past the line of the front wall. */
export function walkedOut(world: Vec2, layout: RoomLayout): boolean {
  return toLocal(world).y > layout.d - 1 + 0.35;
}

/** The spot in a room a guardian inside is close enough to use, if any. */
export function spotAt(world: Vec2, layout: RoomLayout, reach = 1.1): RoomSpot | null {
  const local = toLocal(world);
  return layout.spots.find((s) => Math.hypot(local.x - (s.c + 0.5), local.y - (s.r + 0.5)) <= reach) ?? null;
}
