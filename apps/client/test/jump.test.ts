import { describe, expect, it } from 'vitest';
import { JUMP_SPEED, shadowScale, startJump, stepHop, type Hopper } from '../src/game/jump.js';

const fly = (h: Hopper): { peak: number; frames: number; landed: boolean } => {
  let peak = 0;
  let frames = 0;
  let landed = false;
  while (frames < 200 && !landed) {
    landed = stepHop(h, 1 / 60);
    peak = Math.max(peak, h.hop);
    frames++;
  }
  return { peak, frames, landed };
};

describe('jumping', () => {
  it('rises and falls under gravity, lands once, and reports the landing', () => {
    const h: Hopper = { hop: 0, hopV: 0 };
    expect(startJump(h)).toBe(true);
    const { peak, frames, landed } = fly(h);
    expect(landed).toBe(true);
    expect(peak).toBeGreaterThan(60);
    expect(peak).toBeLessThan(80);
    expect(frames).toBeGreaterThan(40);
    expect(frames).toBeLessThan(50);
    expect(h).toStrictEqual({ hop: 0, hopV: 0 });
    expect(stepHop(h, 1 / 60)).toBe(false);
  });

  it('cannot jump again in mid-air', () => {
    const h: Hopper = { hop: 0, hopV: 0 };
    startJump(h);
    stepHop(h, 0.1);
    expect(startJump(h)).toBe(false);
  });

  it('lands a small emote hop without a dust puff', () => {
    const h: Hopper = { hop: 0, hopV: JUMP_SPEED * 0.6 };
    expect(fly(h).landed).toBe(false);
    expect(h.hop).toBe(0);
  });

  it('shrinks the shadow the higher the body, never below half', () => {
    expect(shadowScale(0)).toBe(1);
    expect(shadowScale(40)).toBeLessThan(1);
    expect(shadowScale(1000)).toBe(0.55);
  });
});
