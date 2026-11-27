import { describe, expect, it } from 'vitest';
import { EMOTES } from '@byzantine-council/shared/hub';
import { ACTION_MS, poseAt } from '../src/game/emotePoses.js';

describe('emotes acted out', () => {
  it('gives every emote a pose while it lasts, and none before or after', () => {
    for (const emote of EMOTES) {
      expect(poseAt(emote, ACTION_MS[emote] / 2, 1)).not.toBeNull();
      expect(poseAt(emote, -1, 1)).toBeNull();
      expect(poseAt(emote, ACTION_MS[emote], 1)).toBeNull();
    }
  });

  it('starts and ends standing still, so an emote never snaps into place', () => {
    for (const emote of EMOTES) {
      for (const ms of [0, ACTION_MS[emote] - 1]) {
        const pose = poseAt(emote, ms, 1);
        expect(Math.abs(pose?.rot ?? 1)).toBeLessThan(0.02);
        expect(Math.abs(pose?.dy ?? 1)).toBeLessThan(0.5);
      }
    }
  });

  it('waves and shakas with one hand on the side the guardian faces, and cheers with both', () => {
    expect(Math.sign(poseAt('wave', 500, 1)?.hand?.x ?? 0)).toBe(1);
    expect(Math.sign(poseAt('wave', 500, -1)?.hand?.x ?? 0)).toBe(-1);
    expect(poseAt('shaka', 500, 1)?.hand?.sign).toBe('shaka');
    expect(poseAt('cheer', 500, 1)?.hand?.both).toBe(true);
    expect(poseAt('heart', 500, 1)?.hand).toBeNull();
  });

  it('dances from foot to foot and laughs hard enough to shake', () => {
    const sides = new Set([0, 700].map((ms) => poseAt('dance', ms, 1)?.sx));
    expect(sides).toEqual(new Set([1, -1]));
    const laughs = [100, 150, 200, 250].map((ms) => poseAt('laugh', ms, 1)?.rot ?? 0);
    expect(Math.max(...laughs) - Math.min(...laughs)).toBeGreaterThan(0.05);
  });
});
