import { describe, expect, it } from 'vitest';
import { STICK_DEADZONE, STICK_RADIUS, keysVector, stickVector } from '../src/game/stick.js';

describe('stickVector', () => {
  it('ignores tiny pushes inside the deadzone', () => {
    const v = stickVector(100, 100, 100 + STICK_RADIUS * STICK_DEADZONE * 0.9, 100);
    expect([v.dx, v.dy]).toStrictEqual([0, 0]);
  });

  it('reaches full speed at the rim and clamps the knob there', () => {
    const v = stickVector(100, 100, 100 + STICK_RADIUS * 3, 100);
    expect(v.dx).toBeCloseTo(1, 12);
    expect(v.kx).toBeCloseTo(STICK_RADIUS, 12);
  });

  it('scales between the deadzone and the rim', () => {
    const half = STICK_DEADZONE + (1 - STICK_DEADZONE) / 2;
    const v = stickVector(0, 0, 0, STICK_RADIUS * half);
    expect(v.dy).toBeCloseTo(0.5, 12);
  });
});

describe('keysVector', () => {
  it('gives unit vectors for single keys and diagonals', () => {
    expect(keysVector(true, false, false, false)).toStrictEqual({ dx: 0, dy: -1 });
    const d = keysVector(true, false, false, true);
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1, 12);
  });

  it('cancels opposite keys', () => {
    expect(keysVector(true, true, false, false)).toStrictEqual({ dx: 0, dy: 0 });
    expect(keysVector(false, false, true, true)).toStrictEqual({ dx: 0, dy: 0 });
  });
});
