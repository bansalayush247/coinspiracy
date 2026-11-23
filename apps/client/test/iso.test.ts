import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W, isoDepth, mapScreenBounds, screenDirToWorld, screenToWorld, worldToScreen } from '../src/game/iso.js';

describe('iso projection', () => {
  it('round-trips between world and screen', () => {
    for (const [x, y] of [[0, 0], [15, 12.8], [31.5, 0.25], [3.3, 27]] as const) {
      const s = worldToScreen(x, y);
      const w = screenToWorld(s.x, s.y);
      expect(w.x).toBeCloseTo(x, 9);
      expect(w.y).toBeCloseTo(y, 9);
    }
  });

  it('puts tile corners where a 2:1 diamond expects them', () => {
    expect(worldToScreen(1, 0)).toStrictEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    expect(worldToScreen(0, 1)).toStrictEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
    expect(worldToScreen(1, 1)).toStrictEqual({ x: 0, y: TILE_H });
  });

  it('sorts things further south-east in front', () => {
    expect(isoDepth(5, 5)).toBeGreaterThan(isoDepth(4, 5));
    expect(isoDepth(5, 5)).toBe(isoDepth(6, 4));
  });

  it('bounds the whole map', () => {
    expect(mapScreenBounds(32, 28)).toStrictEqual({ x: -28 * 64, y: 0, width: 60 * 64, height: 60 * 32 });
  });
});

describe('screenDirToWorld', () => {
  it('maps screen up, down, left and right to the world diagonals', () => {
    const r = Math.SQRT1_2;
    const close = (v: { x: number; y: number }, x: number, y: number): void => {
      expect(v.x).toBeCloseTo(x, 12);
      expect(v.y).toBeCloseTo(y, 12);
    };
    close(screenDirToWorld(0, -1), -r, -r);
    close(screenDirToWorld(0, 1), r, r);
    close(screenDirToWorld(-1, 0), -r, r);
    close(screenDirToWorld(1, 0), r, -r);
  });

  it('keeps the input length, capped at 1, so a half-pushed stick walks slowly', () => {
    const half = screenDirToWorld(0.5, 0);
    const over = screenDirToWorld(3, 4);
    expect(Math.hypot(half.x, half.y)).toBeCloseTo(0.5, 12);
    expect(Math.hypot(over.x, over.y)).toBeCloseTo(1, 12);
  });

  it('never produces values outside the unit range the server accepts', () => {
    for (let a = 0; a < 360; a += 7.5) {
      const rad = (a * Math.PI) / 180;
      const v = screenDirToWorld(Math.cos(rad), Math.sin(rad));
      expect(Math.abs(v.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(v.y)).toBeLessThanOrEqual(1);
    }
  });

  it('returns no movement for zero or junk input', () => {
    expect(screenDirToWorld(0, 0)).toStrictEqual({ x: 0, y: 0 });
    expect(screenDirToWorld(Number.NaN, 1)).toStrictEqual({ x: 0, y: 0 });
    expect(screenDirToWorld(Number.POSITIVE_INFINITY, 0)).toStrictEqual({ x: 0, y: 0 });
  });
});
