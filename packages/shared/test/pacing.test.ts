import { describe, expect, it } from 'vitest';
import { PACING, actAt, blocksElapsed, blocksLeft, type Pacing } from '../src/pacing.js';

const P: Pacing = { blockMs: 1000, totalBlocks: 10, calmBlocks: 2, finalBlocks: 3 };

describe('the block clock', () => {
  it('counts whole blocks and never goes below zero', () => {
    expect(blocksElapsed(-5, P)).toBe(0);
    expect(blocksElapsed(999, P)).toBe(0);
    expect(blocksElapsed(1000, P)).toBe(1);
    expect(blocksLeft(0, P)).toBe(10);
    expect(blocksLeft(9_999, P)).toBe(1);
    expect(blocksLeft(10_000, P)).toBe(0);
    expect(blocksLeft(50_000, P)).toBe(0);
  });

  it('moves through the three acts at exact block boundaries', () => {
    expect(actAt(0, P)).toBe('calm');
    expect(actAt(1_999, P)).toBe('calm');
    expect(actAt(2_000, P)).toBe('proposals');
    expect(actAt(6_999, P)).toBe('proposals');
    expect(actAt(7_000, P)).toBe('final');
    expect(actAt(10_000, P)).toBe('final');
  });

  it('runs about twelve minutes by default, with a one-minute calm and a two-minute finale', () => {
    expect(PACING.totalBlocks * PACING.blockMs).toBe(12 * 60_000);
    expect(PACING.calmBlocks * PACING.blockMs).toBe(60_000);
    expect(PACING.finalBlocks * PACING.blockMs).toBe(120_000);
  });
});
