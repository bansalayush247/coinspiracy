import { describe, expect, it } from 'vitest';
import { InterpBuffer, lerpFactor } from '../src/game/interpolation.js';

describe('InterpBuffer', () => {
  it('blends between the two snapshots around the render time', () => {
    const b = new InterpBuffer();
    b.push(0, 0, 0);
    b.push(100, 10, 20);
    const out = { x: 0, y: 0 };
    expect(b.sample(50, out)).toBe(true);
    expect(out).toStrictEqual({ x: 5, y: 10 });
  });

  it('holds the newest position instead of extrapolating', () => {
    const b = new InterpBuffer();
    b.push(0, 0, 0);
    b.push(100, 10, 0);
    const out = { x: 0, y: 0 };
    b.sample(500, out);
    expect(out).toStrictEqual({ x: 10, y: 0 });
  });

  it('holds the oldest position before the first snapshot', () => {
    const b = new InterpBuffer();
    b.push(100, 3, 4);
    b.push(200, 5, 6);
    const out = { x: 0, y: 0 };
    b.sample(50, out);
    expect(out).toStrictEqual({ x: 3, y: 4 });
  });

  it('drops out-of-order snapshots and replaces same-time ones', () => {
    const b = new InterpBuffer();
    b.push(100, 1, 1);
    b.push(50, 9, 9);
    b.push(100, 2, 2);
    const out = { x: 0, y: 0 };
    b.sample(100, out);
    expect(out).toStrictEqual({ x: 2, y: 2 });
    expect(b.size).toBe(1);
  });

  it('stays bounded', () => {
    const b = new InterpBuffer(8);
    for (let t = 0; t < 100; t++) b.push(t, t, t);
    expect(b.size).toBe(8);
  });

  it('reports nothing to draw when empty', () => {
    expect(new InterpBuffer().sample(0, { x: 0, y: 0 })).toBe(false);
  });
});

describe('lerpFactor', () => {
  it('matches the per-frame factor at 60 fps and compounds over longer frames', () => {
    expect(lerpFactor(0.15, 1000 / 60)).toBeCloseTo(0.15, 12);
    expect(lerpFactor(0.15, 2000 / 60)).toBeCloseTo(1 - 0.85 ** 2, 12);
    expect(lerpFactor(0.15, 0)).toBe(0);
  });
});
