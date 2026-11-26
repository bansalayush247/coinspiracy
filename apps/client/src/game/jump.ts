// Hops and jumps under real gravity: the body rises and falls, its ground shadow shrinks while it is up, and a
// jump reports the frame it lands so the scene can kick up a puff of dust.

/** Upward speed of a jump, in hop units per second (the body rises half a pixel per hop unit). */
export const JUMP_SPEED = 380;
const GRAVITY = 980;

/** A body that can leave the ground. */
export interface Hopper {
  hop: number;
  hopV: number;
}

/** Starts a jump from the ground; false while already in the air. */
export function startJump(h: Hopper): boolean {
  if (h.hop > 0 || h.hopV > 0) return false;
  h.hopV = JUMP_SPEED;
  return true;
}

/** Advances a hop by `dt` seconds; true on the frame a jump (not a small hop) touches down. */
export function stepHop(h: Hopper, dt: number): boolean {
  if (h.hop <= 0 && h.hopV <= 0) return false;
  h.hopV -= GRAVITY * dt;
  h.hop = Math.max(0, h.hop + h.hopV * dt);
  if (h.hop > 0) return false;
  const hard = h.hopV < -JUMP_SPEED * 0.8;
  h.hopV = 0;
  return hard;
}

/** How big the ground shadow is at a height: smaller and lighter the higher the body. */
export function shadowScale(hop: number): number {
  return Math.max(0.55, 1 - hop / 160);
}
