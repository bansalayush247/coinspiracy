// Virtual joystick maths, kept pure for tests; the DOM wiring lives in input.ts.
export const STICK_RADIUS = 56;
export const STICK_DEADZONE = 0.15;

export interface StickVector {
  // Screen-space direction, length 0..1.
  readonly dx: number;
  readonly dy: number;
  // Knob offset in CSS px, clamped to the radius.
  readonly kx: number;
  readonly ky: number;
}

export function stickVector(originX: number, originY: number, x: number, y: number): StickVector {
  const ox = x - originX;
  const oy = y - originY;
  const len = Math.hypot(ox, oy);
  if (len === 0 || !Number.isFinite(len)) return { dx: 0, dy: 0, kx: 0, ky: 0 };
  const reach = Math.min(len, STICK_RADIUS);
  const kx = (ox / len) * reach;
  const ky = (oy / len) * reach;
  const magnitude = reach / STICK_RADIUS;
  if (magnitude < STICK_DEADZONE) return { dx: 0, dy: 0, kx, ky };
  // Rescale past the deadzone so small pushes still give slow movement.
  const scaled = (magnitude - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return { dx: (ox / len) * scaled, dy: (oy / len) * scaled, kx, ky };
}

// Held keys as a screen direction of length 0 or 1.
export function keysVector(up: boolean, down: boolean, left: boolean, right: boolean): { dx: number; dy: number } {
  const dx = (right ? 1 : 0) - (left ? 1 : 0);
  const dy = (down ? 1 : 0) - (up ? 1 : 0);
  const len = Math.hypot(dx, dy);
  return len === 0 ? { dx: 0, dy: 0 } : { dx: dx / len, dy: dy / len };
}
