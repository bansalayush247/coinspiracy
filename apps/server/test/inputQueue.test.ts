import { describe, expect, it } from 'vitest';
import { InputQueue, type MoveInput } from '../src/inputQueue.js';

const TICK_MS = 50;

function input(seq: number): MoveInput {
  return { seq, dx: 1, dy: 0 };
}

function drained(queue: InputQueue, nowMs: number): number[] {
  const seqs: number[] = [];
  queue.drain(nowMs, (i) => seqs.push(i.seq));
  return seqs;
}

describe('InputQueue', () => {
  it('applies one input per tick in order', () => {
    const q = new InputQueue();
    for (const seq of [1, 2, 3]) q.push(input(seq));
    expect(drained(q, 0)).toStrictEqual([1]);
    expect(drained(q, TICK_MS)).toStrictEqual([2]);
    expect(drained(q, 2 * TICK_MS)).toStrictEqual([3]);
    expect(drained(q, 3 * TICK_MS)).toStrictEqual([]);
  });

  it('ignores duplicate and out-of-order sequence numbers', () => {
    const q = new InputQueue();
    expect(q.push(input(5))).toBe('queued');
    expect(q.push(input(5))).toBe('stale');
    expect(q.push(input(4))).toBe('stale');
    expect(q.push(input(6))).toBe('queued');
    expect(q.size).toBe(2);
  });

  it('refuses inputs beyond the queue cap without losing the ones already queued', () => {
    const q = new InputQueue(3);
    expect([1, 2, 3, 4].map((seq) => q.push(input(seq)))).toStrictEqual(['queued', 'queued', 'queued', 'refused']);
    // A later input is accepted once there is room again.
    q.drain(0, () => undefined);
    expect(q.push(input(5))).toBe('queued');
  });

  it('acks applied inputs in order', () => {
    const q = new InputQueue();
    for (const seq of [1, 2]) q.push(input(seq));
    expect(q.ack).toBe(0);
    q.drain(0, () => undefined);
    expect(q.ack).toBe(1);
    q.drain(TICK_MS, () => undefined);
    expect(q.ack).toBe(2);
  });

  it('acks refused inputs once everything before them is applied, so prediction can drop them', () => {
    const q = new InputQueue(2, 1);
    for (const seq of [1, 2, 3, 4, 5]) q.push(input(seq));
    q.push(input(6));
    expect(q.size).toBe(2);
    const applied: number[] = [];
    q.drain(0, (i) => applied.push(i.seq));
    // 3-6 were refused; the ack must not pass input 2 while it is still queued.
    expect(q.ack).toBe(1);
    q.drain(TICK_MS, (i) => applied.push(i.seq));
    expect(applied).toStrictEqual([1, 2]);
    expect(q.ack).toBe(6);
  });

  it('keeps refused runs in order with later queued inputs', () => {
    const q = new InputQueue(1, 1);
    q.push(input(1));
    q.push(input(2)); // refused: queue full
    q.drain(0, () => undefined); // applies 1, then acks the refused 2
    expect(q.ack).toBe(2);
    q.push(input(3));
    q.push(input(4)); // refused
    q.push(input(5)); // refused, merged into the same run
    q.drain(TICK_MS, () => undefined);
    expect(q.ack).toBe(5);
  });

  it('bounds memory under a flood: refusals merge into one marker per gap', () => {
    const q = new InputQueue(8, 1);
    for (let seq = 1; seq <= 10_000; seq++) q.push(input(seq));
    expect(q.size).toBe(8);
    for (let t = 0; t < 20; t++) q.drain(t * TICK_MS, () => undefined);
    expect(q.ack).toBe(10_000);
  });

  it('catches up after a late server tick, but only by the burst cap', () => {
    const q = new InputQueue(16, 4);
    for (let seq = 1; seq <= 10; seq++) q.push(input(seq));
    expect(drained(q, 0)).toStrictEqual([1]);
    // 500 ms stall: ten ticks of budget earned, capped at four.
    expect(drained(q, 500)).toStrictEqual([2, 3, 4, 5]);
    expect(drained(q, 550)).toStrictEqual([6]);
  });

  it('never applies more inputs than real time allows, however fast they arrive', () => {
    const q = new InputQueue(8, 4);
    let seq = 0;
    let applied = 0;
    // A cheating client sends 10 inputs every tick for 10 seconds.
    for (let tick = 0; tick < 200; tick++) {
      for (let k = 0; k < 10; k++) q.push(input(++seq));
      q.drain(tick * TICK_MS, () => {
        applied += 1;
      });
    }
    // 200 ticks of real time plus the initial tick and the burst allowance.
    expect(applied).toBeLessThanOrEqual(200 + 1 + 4);
    expect(applied).toBeGreaterThanOrEqual(199);
  });

  it('keeps up with an honest client whose packets arrive in bunches', () => {
    const q = new InputQueue();
    let seq = 0;
    const appliedSeqs: number[] = [];
    // Packets arrive two at a time every other tick, as with a jittery network.
    for (let tick = 0; tick < 100; tick++) {
      if (tick % 2 === 0) {
        q.push(input(++seq));
        q.push(input(++seq));
      }
      q.drain(tick * TICK_MS, (i) => appliedSeqs.push(i.seq));
    }
    expect(appliedSeqs).toStrictEqual(Array.from({ length: appliedSeqs.length }, (_, i) => i + 1));
    expect(q.size).toBeLessThanOrEqual(2);
  });

  it('forgets queued inputs and accepts a new sequence after reset', () => {
    const q = new InputQueue();
    for (const seq of [100, 101, 102]) q.push(input(seq));
    q.drain(0, () => undefined);
    q.reset();
    expect(q.size).toBe(0);
    expect(q.ack).toBe(0);
    expect(q.push(input(1))).toBe('queued');
    expect(drained(q, 10_000)).toStrictEqual([1]);
  });

  it('does not bank budget while the clock goes backwards', () => {
    const q = new InputQueue();
    for (let seq = 1; seq <= 5; seq++) q.push(input(seq));
    expect(drained(q, 1000)).toStrictEqual([1]);
    expect(drained(q, 0)).toStrictEqual([]);
  });
});
