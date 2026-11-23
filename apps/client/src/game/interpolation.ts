// Snapshot interpolation for other players: draw them slightly in the past so there are
// always two server snapshots to blend between.
export interface Snapshot {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

// Two 20 Hz server ticks.
export const INTERP_DELAY_MS = 100;

export class InterpBuffer {
  readonly #buf: Snapshot[] = [];

  constructor(readonly maxLen = 32) {}

  // t is the receive time in ms; snapshots that arrive out of order are dropped.
  push(t: number, x: number, y: number): void {
    const last = this.#buf[this.#buf.length - 1];
    if (last !== undefined && t <= last.t) {
      if (t === last.t) this.#buf[this.#buf.length - 1] = { t, x, y };
      return;
    }
    this.#buf.push({ t, x, y });
    if (this.#buf.length > this.maxLen) this.#buf.shift();
  }

  // Position at renderTime, clamped to the newest snapshot (no extrapolation).
  sample(renderTime: number, out: { x: number; y: number }): boolean {
    const b = this.#buf;
    while (b.length >= 2 && (b[1]?.t ?? Infinity) <= renderTime) b.shift();
    const a = b[0];
    if (a === undefined) return false;
    const c = b[1];
    if (c === undefined || renderTime <= a.t) {
      out.x = a.x;
      out.y = a.y;
      return true;
    }
    const k = (renderTime - a.t) / (c.t - a.t);
    out.x = a.x + (c.x - a.x) * k;
    out.y = a.y + (c.y - a.y) * k;
    return true;
  }

  get size(): number {
    return this.#buf.length;
  }
}

// Frame-rate independent smoothing factor for a per-frame lerp tuned at 60 fps.
export function lerpFactor(perFrameAt60: number, deltaMs: number): number {
  return 1 - Math.pow(1 - perFrameAt60, deltaMs / (1000 / 60));
}
