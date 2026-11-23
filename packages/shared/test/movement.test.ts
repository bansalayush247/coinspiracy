import { describe, expect, it } from 'vitest';
import { CITADEL_MAP, SPAWN_POINTS, isBlocked, type Vec2 } from '../src/map.js';
import {
  MAX_STEP_SECONDS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  normalizeInput,
  stepMovement,
} from '../src/movement.js';

const START: Vec2 = { x: 15, y: 15 };
const TICK = 0.05;

function walk(pos: Vec2, input: Vec2, steps: number, dt = TICK): Vec2 {
  let current = pos;
  for (let i = 0; i < steps; i++) current = stepMovement(current, input, dt);
  return current;
}

// Deterministic LCG so the random walk never flakes.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('normalizeInput', () => {
  it.each([
    { input: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
    { input: { x: 0.5, y: 0 }, out: { x: 0.5, y: 0 } },
    { input: { x: -1, y: 0 }, out: { x: -1, y: 0 } },
  ])('keeps $input within the unit disc', ({ input, out }) => {
    expect(normalizeInput(input)).toEqual(out);
  });

  it('scales a diagonal down to length 1', () => {
    const d = normalizeInput({ x: 1, y: 1 });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
    expect(d.x).toBeCloseTo(d.y, 12);
  });

  it.each([
    { x: Number.NaN, y: 0 },
    { x: 0, y: Number.POSITIVE_INFINITY },
    { x: Number.NEGATIVE_INFINITY, y: Number.NaN },
  ])('turns junk input $x,$y into no movement', (input) => {
    expect(normalizeInput(input)).toEqual({ x: 0, y: 0 });
  });
});

describe('stepMovement', () => {
  it('moves PLAYER_SPEED * dt along an axis', () => {
    expect(stepMovement(START, { x: 1, y: 0 }, TICK)).toEqual({ x: 15 + PLAYER_SPEED * TICK, y: 15 });
    expect(stepMovement(START, { x: 0, y: -1 }, TICK)).toEqual({ x: 15, y: 15 - PLAYER_SPEED * TICK });
  });

  it('is no faster on a diagonal', () => {
    const next = stepMovement(START, { x: 1, y: 1 }, TICK);
    expect(Math.hypot(next.x - START.x, next.y - START.y)).toBeCloseTo(PLAYER_SPEED * TICK, 12);
  });

  it('clamps long frames to MAX_STEP_SECONDS', () => {
    expect(stepMovement(START, { x: 1, y: 0 }, 10).x).toBeCloseTo(15 + PLAYER_SPEED * MAX_STEP_SECONDS, 12);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns the same position object for dt %s',
    (dt) => {
      expect(stepMovement(START, { x: 1, y: 0 }, dt)).toBe(START);
    },
  );

  it('returns the same position object with no input', () => {
    expect(stepMovement(START, { x: 0, y: 0 }, TICK)).toBe(START);
  });

  it.each([
    { x: Number.NaN, y: 1 },
    { x: 1, y: Number.POSITIVE_INFINITY },
  ])('throws RangeError for a non-finite position', (pos) => {
    expect(() => stepMovement(pos, { x: 1, y: 0 }, TICK)).toThrow(RangeError);
  });

  it('stops flush against the island edge instead of a step short', () => {
    const end = walk({ x: 25.5, y: 9.5 }, { x: 1, y: 0 }, 100);
    expect(end.x).toBeLessThan(27 - PLAYER_RADIUS);
    expect(end.x).toBeGreaterThan(27 - PLAYER_RADIUS - 1e-5);
    expect(isBlocked(CITADEL_MAP, end, PLAYER_RADIUS)).toBe(false);
  });

  it('slides along a wall when only one axis is blocked', () => {
    // Just below the Vault, pushing up and right.
    const start = { x: 5, y: 9.5 };
    const next = walk(start, { x: 1, y: -1 }, 10);
    expect(next.y).toBeGreaterThan(9 + PLAYER_RADIUS);
    expect(next.y).toBeLessThan(9 + PLAYER_RADIUS + 1e-5);
    expect(next.x).toBeGreaterThan(start.x + 0.5);
  });

  it('never passes through a single-tile lamp, even with the longest frame', () => {
    let pos: Vec2 = { x: 8.5, y: 10.5 };
    for (let i = 0; i < 50; i++) {
      pos = stepMovement(pos, { x: 1, y: 0 }, MAX_STEP_SECONDS);
      expect(isBlocked(CITADEL_MAP, pos, PLAYER_RADIUS)).toBe(false);
      expect(pos.x).toBeLessThan(10 - PLAYER_RADIUS);
    }
  });

  it('walks onto the dock and stops at its far end', () => {
    const end = walk({ x: 26, y: 20.5 }, { x: 1, y: 0 }, 200);
    expect(end.x).toBeGreaterThan(31);
    expect(end.x).toBeLessThan(32 - PLAYER_RADIUS);
  });

  it('keeps a long random walk on walkable ground from every spawn point', () => {
    const rand = lcg(42);
    for (const spawn of SPAWN_POINTS) {
      let pos = spawn;
      for (let i = 0; i < 2000; i++) {
        const input = { x: rand() * 2 - 1, y: rand() * 2 - 1 };
        pos = stepMovement(pos, input, rand() * 0.2);
        expect(isBlocked(CITADEL_MAP, pos, PLAYER_RADIUS)).toBe(false);
      }
    }
  });

  it('is deterministic for the same inputs', () => {
    const a = walk(START, { x: 0.3, y: -0.8 }, 40);
    const b = walk(START, { x: 0.3, y: -0.8 }, 40);
    expect(a).toEqual(b);
  });
});
