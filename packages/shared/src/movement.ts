import { CITADEL_MAP, isBlocked, type CitadelMap, type Vec2 } from './map.js';

// Tiles per second and collision half-width in tiles.
export const PLAYER_SPEED = 3.5;
export const PLAYER_RADIUS = 0.3;

// Longer frames are clamped so a stalled tab cannot tunnel through walls.
export const MAX_STEP_SECONDS = 0.1;

// Authoritative server simulation rate; each move input covers exactly one tick.
export const SERVER_TICK_HZ = 20;
export const TICK_SECONDS = 1 / SERVER_TICK_HZ;

const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });
const EPSILON = 1e-6;

function assertFinitePos(pos: Vec2): void {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    throw new RangeError('position must be finite');
  }
}

// Clamps input to the unit disc so diagonals are not faster; junk becomes no input.
export function normalizeInput(input: Vec2): Vec2 {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return ZERO;
  const length = Math.hypot(input.x, input.y);
  if (length === 0) return ZERO;
  return length > 1 ? { x: input.x / length, y: input.y / length } : { x: input.x, y: input.y };
}

type Blocked = (pos: Vec2) => boolean;

// Moves along one axis, stopping flush against the first blocking tile edge.
function moveAxis(blocked: Blocked, pos: Vec2, axis: 'x' | 'y', delta: number): number {
  const from = pos[axis];
  const to = from + delta;
  const at = (v: number): Vec2 => (axis === 'x' ? { x: v, y: pos.y } : { x: pos.x, y: v });
  if (!blocked(at(to))) return to;
  const flush =
    delta > 0
      ? Math.floor(to + PLAYER_RADIUS) - PLAYER_RADIUS - EPSILON
      : Math.ceil(to - PLAYER_RADIUS) + PLAYER_RADIUS + EPSILON;
  const between = delta > 0 ? flush > from && flush < to : flush < from && flush > to;
  return between && !blocked(at(flush)) ? flush : from;
}

// How far sideways a walker heading straight into a corner or post slips to get round it, in tiles.
export const SLIP_REACH = 0.45;
const SLIP_STEP = 0.05;

// Walking straight along one axis into something that ends within SLIP_REACH to one side, step sideways toward the
// gap instead of stopping dead; null when there is no such gap (a flat wall). Nearer gaps win; ties go positive.
function slip(blocked: Blocked, pos: Vec2, axis: 'x' | 'y', delta: number, budget: number): Vec2 | null {
  const side = axis === 'x' ? 'y' : 'x';
  const at = (along: number, across: number): Vec2 => (axis === 'x' ? { x: along, y: across } : { x: across, y: along });
  for (let k = 1; k * SLIP_STEP <= SLIP_REACH + EPSILON; k++) {
    for (const sign of [1, -1]) {
      const across = pos[side] + sign * k * SLIP_STEP;
      if (blocked(at(pos[axis], across))) continue;
      if (blocked(at(pos[axis] + delta, across))) continue;
      const moved = pos[side] + sign * Math.min(k * SLIP_STEP, budget);
      if (blocked(at(pos[axis], moved))) continue;
      return at(pos[axis], moved);
    }
  }
  return null;
}

// One deterministic step shared by server and client prediction; slides along walls. `solid` adds obstacles that are
// not part of the map, such as parked cars.
export function stepMovement(
  pos: Vec2,
  input: Vec2,
  dtSeconds: number,
  map: CitadelMap = CITADEL_MAP,
  solid?: (pos: Vec2) => boolean,
): Vec2 {
  assertFinitePos(pos);
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return pos;
  const dt = Math.min(dtSeconds, MAX_STEP_SECONDS);
  const dir = normalizeInput(input);
  if (dir.x === 0 && dir.y === 0) return pos;

  const blocked: Blocked = solid === undefined ? (p) => isBlocked(map, p, PLAYER_RADIUS) : (p) => isBlocked(map, p, PLAYER_RADIUS) || solid(p);
  const x = dir.x === 0 ? pos.x : moveAxis(blocked, pos, 'x', dir.x * PLAYER_SPEED * dt);
  const y = dir.y === 0 ? pos.y : moveAxis(blocked, { x, y: pos.y }, 'y', dir.y * PLAYER_SPEED * dt);
  // Straight into a corner or a post: slip round it, at walking pace.
  if (dir.y === 0 && x === pos.x) return slip(blocked, pos, 'x', dir.x * PLAYER_SPEED * dt, Math.abs(dir.x) * PLAYER_SPEED * dt) ?? pos;
  if (dir.x === 0 && y === pos.y) return slip(blocked, pos, 'y', dir.y * PLAYER_SPEED * dt, Math.abs(dir.y) * PLAYER_SPEED * dt) ?? pos;
  return x === pos.x && y === pos.y ? pos : { x, y };
}
