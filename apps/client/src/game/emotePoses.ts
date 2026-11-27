// The poses a guardian strikes while acting out an emote, as plain numbers over time, so they can be tested apart
// from the drawing.
import type { Emote } from '@byzantine-council/shared/hub';
import { GUARDIAN_HEIGHT } from './guardianArt.js';
import { ART_SCALE } from './iso.js';

/** How long each emote's action lasts. */
export const ACTION_MS: Readonly<Record<Emote, number>> = Object.freeze({ wave: 1_600, cheer: 1_400, dance: 2_400, heart: 1_800, laugh: 1_400, shaka: 1_600 });

/** Action tuning: the ease in and out, the dance's beat, and how far flourishes rise. */
export const ACTION = Object.freeze({ easeInMs: 150, easeOutMs: 220, danceBeatMs: 300, riseHeight: 26 * ART_SCALE, flourishMs: 1_100 });

/** Where a hand is held relative to the guardian's feet, and which sign it makes. */
export interface HandPose {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly sign: 'open' | 'shaka';
  // Both hands, mirrored either side of the body.
  readonly both: boolean;
}

/** How the guardian's body is held at one moment of an action. */
export interface Pose {
  readonly dx: number;
  readonly dy: number;
  readonly rot: number;
  readonly sx: number;
  readonly sy: number;
  readonly hand: HandPose | null;
}

const H = GUARDIAN_HEIGHT;
const S = ART_SCALE;

// Rises from 0 to 1 over the first moments of an action and falls back over its last, so it never snaps.
function envelope(ms: number, total: number): number {
  return Math.max(0, Math.min(1, ms / ACTION.easeInMs, (total - ms) / ACTION.easeOutMs));
}

/** The pose `ms` into an emote's action, for a guardian facing `facing`; null once it is over. */
export function poseAt(emote: Emote, ms: number, facing: 1 | -1): Pose | null {
  const total = ACTION_MS[emote];
  if (ms < 0 || ms >= total) return null;
  const e = envelope(ms, total);
  switch (emote) {
    case 'wave':
      return { dx: 0, dy: 0, rot: Math.sin(ms / 220) * 0.05 * e, sx: 1, sy: 1, hand: { x: facing * 0.5 * H, y: -0.92 * H, rot: Math.sin(ms / 110) * 0.6 * e, sign: 'open', both: false } };
    case 'cheer': {
      const squash = ms < 120 ? 1 - 0.14 * Math.sin((ms / 120) * Math.PI) : 1;
      return { dx: 0, dy: 0, rot: 0, sx: 2 - squash, sy: squash, hand: { x: 0.42 * H, y: -1.0 * H, rot: Math.sin(ms / 80) * 0.3 * e, sign: 'open', both: true } };
    }
    case 'dance': {
      const beat = (ms / ACTION.danceBeatMs) * Math.PI;
      const side = Math.floor(ms / (ACTION.danceBeatMs * 2)) % 2 === 0 ? 1 : -1;
      return { dx: Math.sin(beat) * 3 * S * e, dy: -Math.abs(Math.sin(beat)) * 7 * S * e, rot: Math.sin(beat) * 0.16 * e, sx: side, sy: 1, hand: { x: 0.46 * H, y: -0.62 * H - Math.abs(Math.sin(beat)) * 0.25 * H, rot: Math.sin(beat) * 0.5, sign: 'open', both: true } };
    }
    case 'heart':
      return { dx: 0, dy: 0, rot: Math.sin(ms / 300) * 0.07 * e, sx: 1 + Math.sin(ms / 150) * 0.03 * e, sy: 1 - Math.sin(ms / 150) * 0.03 * e, hand: null };
    case 'laugh':
      return { dx: 0, dy: -Math.abs(Math.sin(ms / 70)) * 3 * S * e, rot: Math.sin(ms / 55) * 0.07 * e, sx: 1, sy: 1 + Math.sin(ms / 70) * 0.04 * e, hand: null };
    case 'shaka':
      return { dx: 0, dy: 0, rot: facing * 0.08 * e, sx: 1, sy: 1, hand: { x: facing * 0.5 * H, y: -0.8 * H, rot: Math.sin(ms / 90) * 0.5 * e, sign: 'shaka', both: false } };
  }
}
