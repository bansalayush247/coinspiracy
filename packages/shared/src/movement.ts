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

// Moves along one axis, stopping flush against the first blocking tile edge.
function moveAxis(map: CitadelMap, pos: Vec2, axis: 'x' | 'y', delta: number): number {
  const from = pos[axis];
  const to = from + delta;
  const at = (v: number): Vec2 => (axis === 'x' ? { x: v, y: pos.y } : { x: pos.x, y: v });
  if (!isBlocked(map, at(to), PLAYER_RADIUS)) return to;
  const flush =
    delta > 0
      ? Math.floor(to + PLAYER_RADIUS) - PLAYER_RADIUS - EPSILON
      : Math.ceil(to - PLAYER_RADIUS) + PLAYER_RADIUS + EPSILON;
  const between = delta > 0 ? flush > from && flush < to : flush < from && flush > to;
  return between && !isBlocked(map, at(flush), PLAYER_RADIUS) ? flush : from;
}

// One deterministic step shared by server and client prediction; slides along walls.
export function stepMovement(
  pos: Vec2,
  input: Vec2,
  dtSeconds: number,
  map: CitadelMap = CITADEL_MAP,
): Vec2 {
  assertFinitePos(pos);
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return pos;
  const dt = Math.min(dtSeconds, MAX_STEP_SECONDS);
  const dir = normalizeInput(input);
  if (dir.x === 0 && dir.y === 0) return pos;

  const x = dir.x === 0 ? pos.x : moveAxis(map, pos, 'x', dir.x * PLAYER_SPEED * dt);
  const y = dir.y === 0 ? pos.y : moveAxis(map, { x, y: pos.y }, 'y', dir.y * PLAYER_SPEED * dt);
  return x === pos.x && y === pos.y ? pos : { x, y };
}
