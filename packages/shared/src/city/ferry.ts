// The ferry between Port Concord and Beach Town: where it moors on each island, where a guardian boards and steps
// off, and how long the crossing takes. The server only ever places an arrival at the dock named here.
import { z } from 'zod';
import { tileAt, type CitadelMap, type Vec2 } from '../map.js';
import { canStand } from '../pathfinding.js';
import { BEACH_MAP } from '../hub/map.js';
import { ISLANDS, islandOpen } from '../progression/world.js';
import { CITY_MAP } from './map.js';
import raw from './tuning/ferry.json' with { type: 'json' };

/** The two islands the ferry sails between. */
export const FERRY_ISLANDS = ['city', 'beach'] as const;
/** An island with a ferry stop. */
export type FerryIsland = (typeof FERRY_ISLANDS)[number];

/** The join option that asks a room to place the guardian at its ferry dock instead of the usual spawn. */
export const FerryArriveSchema = z.literal('ferry');

const Point = z.strictObject({ x: z.number(), y: z.number() });
const StopSchema = z.strictObject({
  at: Point,
  arrive: Point,
  ship: z.strictObject({ x: z.number(), y: z.number(), heading: z.enum(['n', 's', 'e', 'w']), seed: z.int().min(0).max(1_000_000) }),
  sign: Point,
});

/** The shape of `tuning/ferry.json`. */
export const FerryTuningSchema = z.strictObject({
  reach: z.number().positive().max(3),
  tripMs: z.int().min(2_000).max(30_000),
  skipAfterMs: z.int().min(0).max(10_000),
  reducedMs: z.int().min(300).max(6_000),
  landMs: z.int().min(0).max(3_000),
  hull: z.strictObject({ length: z.number().positive().max(8), beam: z.number().positive().max(4) }),
  stops: z.strictObject({ city: StopSchema, beach: StopSchema }),
});
/** The ferry's tuning, as checked by `FerryTuningSchema`. */
export type FerryTuning = z.infer<typeof FerryTuningSchema>;
/** One island's ferry stop: the boarding spot, the arrival spot, the moored ship and its sign. */
export type FerryStop = z.infer<typeof StopSchema>;

/** The tile map of an island with a ferry stop. */
export const ferryMap = (island: FerryIsland): CitadelMap => (island === 'city' ? CITY_MAP : BEACH_MAP);

/** Where the ferry from an island sails to. */
export const ferryDestination = (from: FerryIsland): FerryIsland => (from === 'city' ? 'beach' : 'city');

// The tile corners and middle of the moored ship's footprint on the water.
function hullSamples(stop: FerryStop, hull: FerryTuning['hull']): Vec2[] {
  const along = stop.ship.heading === 'e' || stop.ship.heading === 'w';
  const hx = (along ? hull.length : hull.beam) / 2;
  const hy = (along ? hull.beam : hull.length) / 2;
  const out: Vec2[] = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) out.push({ x: stop.ship.x - hx + (2 * hx * i) / 4, y: stop.ship.y - hy + (2 * hy * j) / 2 });
  return out;
}

/** Every way a ferry tuning can be wrong that its shape alone can't catch: stops off the dock, a ship on land. */
export function ferryTuningProblems(tuning: FerryTuning): string[] {
  const problems: string[] = [];
  for (const island of FERRY_ISLANDS) {
    const stop = tuning.stops[island];
    const map = ferryMap(island);
    if (!canStand(map, stop.at)) problems.push(`${island}: nobody can stand at the boarding spot`);
    if (!canStand(map, stop.arrive)) problems.push(`${island}: nobody can stand at the arrival spot`);
    if (Math.hypot(stop.arrive.x - stop.at.x, stop.arrive.y - stop.at.y) <= tuning.reach) problems.push(`${island}: arrivals land inside the boarding reach`);
    if (hullSamples(stop, tuning.hull).some((p) => tileAt(map, Math.floor(p.x), Math.floor(p.y)) !== '~')) problems.push(`${island}: the moored ferry is not all on water`);
    const shore = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => tileAt(map, Math.floor(stop.at.x) + dx, Math.floor(stop.at.y) + dy) === '~'));
    if (!shore) problems.push(`${island}: the boarding spot is not at the water`);
    if (tileAt(map, Math.floor(stop.sign.x), Math.floor(stop.sign.y)) !== '=') problems.push(`${island}: the sign is not on the dock`);
  }
  return problems;
}

/** The ferry's tuning, checked when the module loads. */
export const FERRY_TUNING: FerryTuning = Object.freeze(
  FerryTuningSchema.superRefine((tuning, ctx) => {
    for (const message of ferryTuningProblems(tuning)) ctx.addIssue({ code: 'custom', message });
  }).parse(raw),
);

/** Whether a guardian at `pos` stands close enough to an island's ferry to board it. */
export function atFerryStop(island: FerryIsland, pos: Vec2): boolean {
  const at = FERRY_TUNING.stops[island].at;
  return Number.isFinite(pos.x) && Number.isFinite(pos.y) && Math.hypot(pos.x - at.x, pos.y - at.y) <= FERRY_TUNING.reach;
}

/** Where a guardian steps off the ferry on an island. */
export function ferryArrival(island: FerryIsland): Vec2 {
  const p = FERRY_TUNING.stops[island].arrive;
  return { x: p.x, y: p.y };
}

/** Whether a guardian of this rank, with this many Academy stars, may sail to an island: Beach Town keeps its unlock. */
export function ferryOpenTo(to: FerryIsland, rank: number, stars: number): boolean {
  if (to === 'city') return true;
  const beach = ISLANDS.find((i) => i.id === 'beach');
  return beach !== undefined && islandOpen(beach, rank, stars);
}

/** What opens Beach Town: the Guardian Rank, or the Academy stars, whichever comes first. */
export function beachUnlock(): { readonly rank: number; readonly stars: number } {
  const beach = ISLANDS.find((i) => i.id === 'beach');
  return { rank: beach?.rank ?? 0, stars: beach?.stars ?? 0 };
}
