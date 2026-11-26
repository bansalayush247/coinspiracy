// Tile pathfinding for practice bots: A* over walkable tiles with clearance for the player's square
// footprint, then string-pulled into straight segments. Bounded and deterministic.
import { isWalkableTile, type CitadelMap, type Vec2 } from './map.js';
import { PLAYER_RADIUS, PLAYER_SPEED, TICK_SECONDS } from './movement.js';
import { err, ok, type Result } from './result.js';

// Largest grid a search allocates for.
export const MAX_PATH_TILES = 65_536;
// Largest footprint half-width a search accepts; a tile centre must fit the footprint.
export const MAX_PATH_RADIUS = 0.4;
// Extra room a smoothed segment keeps from walls, so axis-by-axis steps and waypoint corner cuts stay clear.
export const PATH_CLEARANCE = 0.14;
// Spacing of footprint samples along a segment.
export const SEGMENT_STEP = 0.05;
// Largest goal radius findPathNear accepts.
export const MAX_NEAR_RANGE = 8;

// Checked half-width never reaches half a tile, so one-tile corridors stay passable on their centre line.
const MAX_SEGMENT_HALF = 0.44;
const STRAIGHT = 10;
const DIAGONAL = 14;
const SAME_POINT = 1e-9;
// N, E, S, W, then the diagonals; fixed so results never depend on anything else.
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

export interface PathOptions {
  // Extra blocked tiles on top of the map, e.g. closed doors; called with integer tile coordinates.
  readonly blocked?: (col: number, row: number) => boolean;
  // Half-width of the walker's square footprint, in tiles.
  readonly radius?: number;
  // Most tiles the search may expand before giving up.
  readonly maxExpansions?: number;
  // String-pull the tile path into straight segments.
  readonly smooth?: boolean;
}

export type PathError = 'invalidInput' | 'startBlocked' | 'goalBlocked' | 'noPath' | 'searchLimit';
export type PathResult = Result<Vec2[], PathError>;

interface Settings {
  readonly radius: number;
  // Half-width used for segment checks: footprint, clearance and the sampling allowance.
  readonly segmentHalf: number;
  readonly maxExpansions: number;
  readonly smooth: boolean;
}

function validMap(map: CitadelMap): boolean {
  const { width, height } = map;
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width * height <= MAX_PATH_TILES &&
    map.rows.length === height
  );
}

function settings(map: CitadelMap, options: PathOptions): Settings | null {
  const radius = options.radius ?? PLAYER_RADIUS;
  if (!Number.isFinite(radius) || radius < 0 || radius > MAX_PATH_RADIUS) return null;
  const tiles = map.width * map.height;
  const maxExpansions = options.maxExpansions ?? tiles;
  if (!Number.isSafeInteger(maxExpansions) || maxExpansions < 1) return null;
  return {
    radius,
    segmentHalf: Math.min(radius + PATH_CLEARANCE, MAX_SEGMENT_HALF) + SEGMENT_STEP / 2,
    maxExpansions: Math.min(maxExpansions, tiles),
    smooth: options.smooth ?? true,
  };
}

function finitePoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function insideGrid(map: CitadelMap, p: Vec2): boolean {
  return finitePoint(p) && p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
}

function center(col: number, row: number): Vec2 {
  return { x: col + 0.5, y: row + 0.5 };
}

function octile(dc: number, dr: number): number {
  const a = Math.abs(dc);
  const b = Math.abs(dr);
  return STRAIGHT * Math.max(a, b) + (DIAGONAL - STRAIGHT) * Math.min(a, b);
}

// Walkable tiles per map (1 open, 2 blocked), worked out once: maps are frozen, so the object is a safe key.
const WALKABLE = new WeakMap<CitadelMap, Uint8Array>();

function walkable(map: CitadelMap): Uint8Array {
  let cells = WALKABLE.get(map);
  if (cells === undefined) {
    cells = new Uint8Array(map.width * map.height);
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) cells[row * map.width + col] = isWalkableTile(map, col, row) ? 1 : 2;
    }
    WALKABLE.set(map, cells);
  }
  return cells;
}

// Per-search view of the map: walkability plus the extra predicate, each extra-predicate tile asked at most once.
class Grid {
  readonly width: number;
  readonly height: number;
  readonly #walk: Uint8Array;
  // Extra-predicate answers: 0 unknown, 1 open, 2 blocked; only kept when there is a predicate.
  readonly #known: Uint8Array | null;

  constructor(
    readonly map: CitadelMap,
    readonly blocked: ((col: number, row: number) => boolean) | undefined,
    // Tile index exempt from the extra predicate (the walker's own tile), or -1.
    readonly exempt = -1,
  ) {
    this.width = map.width;
    this.height = map.height;
    this.#walk = walkable(map);
    this.#known = blocked === undefined ? null : new Uint8Array(map.width * map.height);
  }

  index(col: number, row: number): number {
    return row * this.width + col;
  }

  open(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.width || row >= this.height) return false;
    const i = this.index(col, row);
    if (this.#walk[i] !== 1) return false;
    const known = this.#known;
    if (known === null || this.blocked === undefined || i === this.exempt) return true;
    const seen = known[i] ?? 0;
    if (seen !== 0) return seen === 1;
    const free = !this.blocked(col, row);
    known[i] = free ? 1 : 2;
    return free;
  }

  #box(minCol: number, maxCol: number, minRow: number, maxRow: number): boolean {
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (!this.open(col, row)) return false;
      }
    }
    return true;
  }

  // Square footprint of half-width `half` at `pos` overlaps only open tiles.
  clear(pos: Vec2, half: number): boolean {
    return this.#box(Math.floor(pos.x - half), Math.floor(pos.x + half), Math.floor(pos.y - half), Math.floor(pos.y + half));
  }

  // Samples a ray until the footprint leaves the map or hits a blocked tile, re-testing only when the covered tiles
  // change. Sample s sits at a + d·(s / steps), or a + d·s when `perStep`; returns the last clear sample (first - 1
  // if none is clear).
  clearRun(ax: number, ay: number, dx: number, dy: number, steps: number, half: number, first: number, perStep: boolean): number {
    let c0 = Number.NaN;
    let c1 = Number.NaN;
    let r0 = Number.NaN;
    let r1 = Number.NaN;
    for (let s = first; s <= steps; s++) {
      const t = perStep ? s : s / steps;
      const x = ax + dx * t;
      const y = ay + dy * t;
      if (!(x >= 0 && y >= 0 && x < this.width && y < this.height)) return s - 1;
      const n0 = Math.floor(x - half);
      const n1 = Math.floor(x + half);
      const m0 = Math.floor(y - half);
      const m1 = Math.floor(y + half);
      if (n0 === c0 && n1 === c1 && m0 === r0 && m1 === r1) continue;
      c0 = n0;
      c1 = n1;
      r0 = m0;
      r1 = m1;
      if (!this.#box(n0, n1, m0, m1)) return s - 1;
    }
    return steps;
  }

  // Every sample is at most half a step from any point of the segment; segmentHalf already allows for that.
  clearSegment(a: Vec2, b: Vec2, half: number): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SEGMENT_STEP));
    return this.clearRun(a.x, a.y, dx, dy, steps, half, 0, false) === steps;
  }
}

interface OpenEntry {
  readonly f: number;
  readonly h: number;
  readonly seq: number;
  readonly tile: number;
}

// Min-heap of open tiles by f, then h, then insertion order, so ties resolve the same way every time.
class OpenHeap {
  readonly #items: OpenEntry[] = [];

  get size(): number {
    return this.#items.length;
  }

  push(entry: OpenEntry): void {
    const items = this.#items;
    items.push(entry);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = items[parent];
      if (p === undefined || !before(entry, p)) break;
      items[i] = p;
      i = parent;
    }
    items[i] = entry;
  }

  pop(): OpenEntry | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined || items.length === 0) return top;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      let bestItem = last;
      const l = items[left];
      const r = items[right];
      if (l !== undefined && before(l, bestItem)) {
        best = left;
        bestItem = l;
      }
      if (r !== undefined && before(r, bestItem)) {
        best = right;
        bestItem = r;
      }
      if (best === i) break;
      items[i] = bestItem;
      i = best;
    }
    items[i] = last;
    return top;
  }
}

function before(a: OpenEntry, b: OpenEntry): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.seq < b.seq;
}

// Search buffers reused across calls of one map size; a tile's cost and parent count only when its stamp is this
// search's generation, so nothing is cleared between searches. Searches never nest, so one set per size is enough.
interface Scratch {
  gen: number;
  readonly stamp: Uint32Array;
  readonly closed: Uint32Array;
  readonly cost: Int32Array;
  readonly parent: Int32Array;
}
const SCRATCH = new Map<number, Scratch>();

function scratch(size: number): Scratch {
  let s = SCRATCH.get(size);
  if (s === undefined) {
    s = { gen: 0, stamp: new Uint32Array(size), closed: new Uint32Array(size), cost: new Int32Array(size), parent: new Int32Array(size) };
    SCRATCH.set(size, s);
  }
  if (s.gen === 0xffffffff) {
    s.stamp.fill(0);
    s.closed.fill(0);
    s.gen = 0;
  }
  s.gen += 1;
  return s;
}

// A* from `start` to any tile `isGoal` accepts; returns tile indexes from start to goal.
function search(
  grid: Grid,
  start: number,
  isGoal: (tile: number) => boolean,
  heuristic: (col: number, row: number) => number,
  maxExpansions: number,
): Result<number[], PathError> {
  const { gen, stamp, closed, cost, parent } = scratch(grid.width * grid.height);
  const heap = new OpenHeap();
  let seq = 0;
  let expanded = 0;
  const startCol = start % grid.width;
  const startRow = Math.floor(start / grid.width);
  const h0 = heuristic(startCol, startRow);
  stamp[start] = gen;
  cost[start] = 0;
  parent[start] = -1;
  heap.push({ f: h0, h: h0, seq: seq++, tile: start });

  for (let entry = heap.pop(); entry !== undefined; entry = heap.pop()) {
    const tile = entry.tile;
    if (closed[tile] === gen) continue;
    if (isGoal(tile)) return ok(trace(parent, tile));
    if (expanded >= maxExpansions) return err('searchLimit');
    expanded += 1;
    closed[tile] = gen;
    const col = tile % grid.width;
    const row = Math.floor(tile / grid.width);
    const g = cost[tile] ?? 0;
    for (const [dc, dr] of DIRECTIONS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!grid.open(nc, nr)) continue;
      const diagonal = dc !== 0 && dr !== 0;
      // No corner cutting: a diagonal step sweeps the footprint across both side tiles.
      if (diagonal && (!grid.open(col + dc, row) || !grid.open(col, row + dr))) continue;
      const next = grid.index(nc, nr);
      if (closed[next] === gen) continue;
      const g2 = g + (diagonal ? DIAGONAL : STRAIGHT);
      const known = stamp[next] === gen ? (cost[next] ?? -1) : -1;
      if (known !== -1 && known <= g2) continue;
      stamp[next] = gen;
      cost[next] = g2;
      parent[next] = tile;
      const h = heuristic(nc, nr);
      heap.push({ f: g2 + h, h, seq: seq++, tile: next });
    }
  }
  return err('noPath');
}

function trace(parent: Int32Array, goal: number): number[] {
  const tiles = [goal];
  for (let at = parent[goal] ?? -1; at !== -1; at = parent[at] ?? -1) tiles.push(at);
  return tiles.reverse();
}

// Greedy string pulling from the walker's real position; a waypoint is skipped only over a clear segment.
function pull(grid: Grid, from: Vec2, points: readonly Vec2[], half: number): Vec2[] {
  const out: Vec2[] = [];
  let anchor = from;
  let i = 0;
  while (i < points.length) {
    const first = points[i];
    if (first === undefined) break;
    if (Math.hypot(first.x - anchor.x, first.y - anchor.y) <= SAME_POINT) {
      i += 1;
      continue;
    }
    let j = i;
    if (grid.clearSegment(anchor, first, half)) {
      for (let k = i + 1; k < points.length; k++) {
        const candidate = points[k];
        if (candidate === undefined || !grid.clearSegment(anchor, candidate, half)) break;
        j = k;
      }
    }
    // A step to the next tile centre is always safe, even when the margin check is too strict for it.
    const chosen = points[j] ?? first;
    out.push(chosen);
    anchor = chosen;
    i = j + 1;
  }
  return out;
}

function raw(from: Vec2, points: readonly Vec2[]): Vec2[] {
  return points.filter((p, i) => i > 0 || Math.hypot(p.x - from.x, p.y - from.y) > SAME_POINT);
}

function startTile(map: CitadelMap, from: Vec2): { col: number; row: number } | null {
  const col = Math.floor(from.x);
  const row = Math.floor(from.y);
  return isWalkableTile(map, col, row) ? { col, row } : null;
}

// Waypoints from `from` to the point `to`; empty when already there.
export function findPath(map: CitadelMap, from: Vec2, to: Vec2, options: PathOptions = {}): PathResult {
  const set = validMap(map) ? settings(map, options) : null;
  if (set === null || !insideGrid(map, from) || !insideGrid(map, to)) return err('invalidInput');
  const start = startTile(map, from);
  if (start === null) return err('startBlocked');
  const grid = new Grid(map, options.blocked, start.row * map.width + start.col);
  if (!grid.clear(to, set.radius)) return err('goalBlocked');
  const goalCol = Math.floor(to.x);
  const goalRow = Math.floor(to.y);
  const goal = grid.index(goalCol, goalRow);
  const found = search(
    grid,
    grid.index(start.col, start.row),
    (tile) => tile === goal,
    (col, row) => octile(goalCol - col, goalRow - row),
    set.maxExpansions,
  );
  if (!found.ok) return found;
  const points = found.value.map((tile) => center(tile % map.width, Math.floor(tile / map.width)));
  // The goal point replaces the goal tile's centre when they coincide.
  const last = points[points.length - 1];
  if (last !== undefined && Math.hypot(last.x - to.x, last.y - to.y) <= SAME_POINT) points.pop();
  points.push({ x: to.x, y: to.y });
  return ok(set.smooth ? pull(grid, from, points, set.segmentHalf) : raw(from, points));
}

// Waypoints from `from` to the nearest open tile whose centre is within `range` of `target`
// (e.g. a station, which itself blocks); empty when `from` is already within range.
export function findPathNear(
  map: CitadelMap,
  from: Vec2,
  target: Vec2,
  range: number,
  options: PathOptions = {},
): PathResult {
  const set = validMap(map) ? settings(map, options) : null;
  if (set === null || !insideGrid(map, from) || !finitePoint(target)) return err('invalidInput');
  if (!Number.isFinite(range) || range <= 0 || range > MAX_NEAR_RANGE) return err('invalidInput');
  const start = startTile(map, from);
  if (start === null) return err('startBlocked');
  if (Math.hypot(from.x - target.x, from.y - target.y) <= range) return ok([]);
  const grid = new Grid(map, options.blocked, start.row * map.width + start.col);
  const targetCol = Math.floor(target.x);
  const targetRow = Math.floor(target.y);
  const goals = new Set<number>();
  let spread = 0;
  for (let row = Math.floor(target.y - range); row <= Math.floor(target.y + range); row++) {
    for (let col = Math.floor(target.x - range); col <= Math.floor(target.x + range); col++) {
      const c = center(col, row);
      if (Math.hypot(c.x - target.x, c.y - target.y) > range || !grid.open(col, row)) continue;
      goals.add(grid.index(col, row));
      spread = Math.max(spread, octile(col - targetCol, row - targetRow));
    }
  }
  if (goals.size === 0) return err('goalBlocked');
  const found = search(
    grid,
    grid.index(start.col, start.row),
    (tile) => goals.has(tile),
    // Admissible and consistent: every goal lies within `spread` of the target tile.
    (col, row) => Math.max(0, octile(targetCol - col, targetRow - row) - spread),
    set.maxExpansions,
  );
  if (!found.ok) return found;
  const points = found.value.map((tile) => center(tile % map.width, Math.floor(tile / map.width)));
  return ok(set.smooth ? pull(grid, from, points, set.segmentHalf) : raw(from, points));
}

// The walker's footprint fits at `pos` (walkable, not extra-blocked).
export function canStand(map: CitadelMap, pos: Vec2, options: PathOptions = {}): boolean {
  const set = validMap(map) ? settings(map, options) : null;
  if (set === null || !insideGrid(map, pos)) return false;
  return new Grid(map, options.blocked).clear(pos, set.radius);
}

// A straight walk from `a` to `b` keeps the footprint plus PATH_CLEARANCE off every blocked tile.
export function isClearSegment(map: CitadelMap, a: Vec2, b: Vec2, options: PathOptions = {}): boolean {
  const set = validMap(map) ? settings(map, options) : null;
  if (set === null || !insideGrid(map, a) || !insideGrid(map, b)) return false;
  return new Grid(map, options.blocked).clearSegment(a, b, set.segmentHalf);
}

/** How far each ray from `eye` (one per angle, radians) stays an `isClearSegment` walk, up to `max` tiles. */
export function clearReaches(map: CitadelMap, eye: Vec2, angles: readonly number[], max: number, options: PathOptions = {}): number[] {
  const set = validMap(map) ? settings(map, options) : null;
  if (set === null || !insideGrid(map, eye) || !Number.isFinite(max) || max <= 0) return angles.map(() => 0);
  const grid = new Grid(map, options.blocked);
  if (!grid.clear(eye, set.segmentHalf)) return angles.map(() => 0);
  const steps = Math.ceil(max / SEGMENT_STEP);
  return angles.map((angle) => {
    const last = grid.clearRun(eye.x, eye.y, (Math.cos(angle) * max) / steps, (Math.sin(angle) * max) / steps, steps, set.segmentHalf, 1, true);
    return last === steps ? max : (last * max) / steps;
  });
}

// One tick's move input straight at `target`, shortened on the last step so the walker stops on it.
export function steerInput(pos: Vec2, target: Vec2): Vec2 {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist <= SAME_POINT) return { x: 0, y: 0 };
  const factor = Math.min(1, dist / (PLAYER_SPEED * TICK_SECONDS));
  return { x: clampUnit((dx / dist) * factor), y: clampUnit((dy / dist) * factor) };
}

// Move payloads must stay within [-1, 1] even after rounding.
function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

// Path length in tiles from `from` through each waypoint.
export function pathLength(from: Vec2, path: readonly Vec2[]): number {
  let total = 0;
  let at = from;
  for (const p of path) {
    total += Math.hypot(p.x - at.x, p.y - at.y);
    at = p;
  }
  return total;
}
