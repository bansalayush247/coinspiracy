import { describe, expect, it } from 'vitest';
import { SPAWN_POINTS, TICK_SECONDS, stepMovement, type Vec2 } from '@byzantine-council/shared';
import { CorrectionSmoother, MAX_PENDING, Predictor } from '../src/game/prediction.js';

const START: Vec2 = SPAWN_POINTS[0] ?? { x: 15, y: 12.8 };

// What the server does with the same inputs: one shared step per input.
function serverReplay(from: Vec2, inputs: readonly { dx: number; dy: number }[]): Vec2 {
  return inputs.reduce<Vec2>((pos, i) => stepMovement(pos, { x: i.dx, y: i.dy }, TICK_SECONDS), from);
}

describe('Predictor', () => {
  it('numbers inputs from 1 and moves immediately', () => {
    const p = new Predictor(START);
    const a = p.apply(1, 0);
    const b = p.apply(0, 1);
    expect([a.seq, b.seq]).toStrictEqual([1, 2]);
    expect(p.position).toStrictEqual(serverReplay(START, [a, b]));
    expect(p.pendingCount).toBe(2);
  });

  it('lands exactly where the server does once everything is acknowledged', () => {
    const p = new Predictor(START);
    const inputs = [p.apply(1, 0), p.apply(1, 0), p.apply(0.6, -0.8), p.apply(0, -1)];
    const server = serverReplay(START, inputs);
    const before = p.position;
    p.reconcile(server, 4);
    expect(p.position).toStrictEqual(server);
    expect(p.position).toStrictEqual(before);
    expect(p.pendingCount).toBe(0);
  });

  it('replays unacknowledged inputs on top of an older server state', () => {
    const p = new Predictor(START);
    const inputs = [p.apply(1, 0), p.apply(1, 0), p.apply(0, 1), p.apply(0, 1)];
    const predicted = p.position;
    // The server has applied only the first two so far.
    p.reconcile(serverReplay(START, inputs.slice(0, 2)), 2);
    expect(p.pendingCount).toBe(2);
    expect(p.position).toStrictEqual(predicted);
  });

  it('corrects toward the server when the server disagrees', () => {
    const p = new Predictor(START);
    p.apply(1, 0);
    p.apply(1, 0);
    // The server dropped input 2 (for example, its queue was full) and applied only 1.
    const server = serverReplay(START, [{ dx: 1, dy: 0 }]);
    p.reconcile(server, 2);
    expect(p.position).toStrictEqual(server);
  });

  it('ignores stale acknowledgements', () => {
    const p = new Predictor(START);
    const inputs = [p.apply(1, 0), p.apply(1, 0), p.apply(1, 0)];
    p.reconcile(serverReplay(START, inputs.slice(0, 2)), 2);
    p.reconcile(serverReplay(START, inputs.slice(0, 1)), 1);
    expect(p.pendingCount).toBe(1);
  });

  it('reports a stall after too many unacknowledged inputs', () => {
    const p = new Predictor(START);
    for (let i = 0; i < MAX_PENDING - 1; i++) p.apply(0, 0.5);
    expect(p.stalled).toBe(false);
    p.apply(0, 0.5);
    expect(p.stalled).toBe(true);
  });

  it('starts over from the server position after a reset, keeping the sequence moving', () => {
    const p = new Predictor(START);
    p.apply(1, 0);
    p.reset({ x: 10, y: 10 });
    expect(p.position).toStrictEqual({ x: 10, y: 10 });
    expect(p.pendingCount).toBe(0);
    expect(p.apply(1, 0).seq).toBe(2);
  });
});

describe('CorrectionSmoother', () => {
  it('turns a small correction into an offset that fades out', () => {
    const s = new CorrectionSmoother(1.5, 60);
    s.correct({ x: 10.2, y: 5 }, { x: 10, y: 5 });
    expect(s.offset.x).toBeCloseTo(0.2, 12);
    s.decay(60);
    expect(s.offset.x).toBeCloseTo(0.1, 12);
    s.decay(10_000);
    expect(s.offset).toStrictEqual({ x: 0, y: 0 });
  });

  it('snaps instead of sliding across the map after a large correction', () => {
    const s = new CorrectionSmoother(1.5, 60);
    s.correct({ x: 20, y: 5 }, { x: 10, y: 5 });
    expect(s.offset).toStrictEqual({ x: 0, y: 0 });
  });

  it('accumulates consecutive corrections', () => {
    const s = new CorrectionSmoother(1.5, 60);
    s.correct({ x: 1.1, y: 0 }, { x: 1, y: 0 });
    s.correct({ x: 1.1, y: 0 }, { x: 1, y: 0 });
    expect(s.offset.x).toBeCloseTo(0.2, 12);
  });
});
