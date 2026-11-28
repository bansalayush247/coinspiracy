// Guardians on foot are nudged apart softly instead of blocking each other, so nobody can wall off a doorway.
import { z } from 'zod';
import type { Vec2 } from '../map.js';
import raw from './tuning/collision.json' with { type: 'json' };

/** The shape of `tuning/collision.json`: how guardians push apart, and how background traffic yields to player cars. */
export const CollisionTuningSchema = z.strictObject({
  crowd: z.strictObject({
    minDistance: z.number().positive().max(2),
    maxPush: z.number().positive().max(1),
  }),
  traffic: z.strictObject({
    lookAhead: z.number().positive().max(20),
    probeStep: z.number().positive().max(1),
    gap: z.number().min(0).max(5),
    yieldMargin: z.number().min(0).max(2),
    yieldFadeMs: z.int().min(1).max(5_000),
  }),
});
/** Collision tuning, as checked by `CollisionTuningSchema`. */
export type CollisionTuning = z.infer<typeof CollisionTuningSchema>;
/** The crowd half of the tuning: the closest two guardians may stand, and the most one is moved per tick. */
export type CrowdTuning = CollisionTuning['crowd'];

/** Collision tuning, checked once at load so a bad edit fails loudly instead of playing wrong. */
export const COLLISION_TUNING: CollisionTuning = Object.freeze(CollisionTuningSchema.parse(raw));

/** A guardian on foot in a crowd: a stable id (the session id) and where they stand. */
export interface CrowdBody {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Whether a guardian standing at `from` may not be pushed to `to` (a wall, water, furniture or a car). */
export type PushBlocked = (from: Vec2, to: Vec2) => boolean;

const EPSILON = 1e-9;
// Two guardians on exactly the same spot part along the first of these that lets either move; the later id goes this way.
const COINCIDENT: readonly Vec2[] = Object.freeze([{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]);

const byId = (a: CrowdBody, b: CrowdBody): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The push itself if it is clear, else whichever axis of it is (the larger first), else null.
function tryPush(from: Vec2, dx: number, dy: number, blocked: PushBlocked): Vec2 | null {
  const options: Vec2[] = [{ x: from.x + dx, y: from.y + dy }];
  const alongX = { x: from.x + dx, y: from.y };
  const alongY = { x: from.x, y: from.y + dy };
  if (dx !== 0 && dy !== 0) options.push(...(Math.abs(dx) >= Math.abs(dy) ? [alongX, alongY] : [alongY, alongX]));
  return options.find((to) => !blocked(from, to)) ?? null;
}

/**
 * One tick of crowd separation for guardians in one place. Any two closer than `minDistance` are pushed apart along
 * the line between them, half each; if one of them cannot move (a wall, a car, or this tick's push already spent) the
 * other takes the whole push, and if neither can, they stay. Nobody moves more than `maxPush` in total. Exactly
 * coincident guardians part along a fixed direction chosen by id order. Deterministic for any input order; returns
 * the new position of every guardian that moved.
 */
export function resolveCrowd(bodies: readonly CrowdBody[], blocked: PushBlocked, tuning: CrowdTuning = COLLISION_TUNING.crowd): Map<string, Vec2> {
  const moved = new Map<string, Vec2>();
  if (bodies.length < 2) return moved;
  const order = [...bodies].sort(byId);
  const pos = order.map((b) => ({ x: b.x, y: b.y }));
  const budget = order.map(() => tuning.maxPush);
  const reach = tuning.minDistance + 2 * tuning.maxPush;
  const sweep = order.map((_, i) => i).sort((a, b) => (pos[a]?.x ?? 0) - (pos[b]?.x ?? 0) || a - b);

  const shove = (i: number, ux: number, uy: number, want: number): number => {
    const from = pos[i];
    const share = Math.min(want, budget[i] ?? 0);
    if (from === undefined || share <= EPSILON) return 0;
    const to = tryPush(from, ux * share, uy * share, blocked);
    if (to === null) return 0;
    const step = Math.hypot(to.x - from.x, to.y - from.y);
    budget[i] = (budget[i] ?? 0) - step;
    pos[i] = to;
    const id = order[i]?.id;
    if (id !== undefined) moved.set(id, to);
    return step;
  };

  const part = (lo: number, hi: number): void => {
    const a = pos[lo];
    const b = pos[hi];
    if (a === undefined || b === undefined) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d >= tuning.minDistance) return;
    const need = tuning.minDistance - d;
    const dirs = d > EPSILON ? [{ x: dx / d, y: dy / d }] : COINCIDENT;
    for (const u of dirs) {
      const half = need / 2;
      const loMoved = shove(lo, -u.x, -u.y, half);
      const hiMoved = shove(hi, u.x, u.y, loMoved > 0 ? half : need);
      const loExtra = hiMoved > 0 || loMoved === 0 ? 0 : shove(lo, -u.x, -u.y, need - loMoved);
      if (loMoved + hiMoved + loExtra > 0) return;
    }
  };

  for (let k = 0; k < sweep.length; k++) {
    const i = sweep[k] ?? 0;
    for (let m = k + 1; m < sweep.length; m++) {
      const j = sweep[m] ?? 0;
      if ((pos[j]?.x ?? 0) - (pos[i]?.x ?? 0) > reach) break;
      part(Math.min(i, j), Math.max(i, j));
    }
  }
  return moved;
}

/**
 * The client's half of the same rule for its own guardian `me`: nudged out of each other guardian by its half share
 * (the server moves the others), never into anything `blocked`, at most `maxPush` in all. Returns where `me` ends up.
 */
export function pushClear(me: CrowdBody, others: readonly CrowdBody[], blocked: PushBlocked, tuning: CrowdTuning = COLLISION_TUNING.crowd): Vec2 {
  let at: Vec2 = { x: me.x, y: me.y };
  let budget = tuning.maxPush;
  for (const other of [...others].sort(byId)) {
    if (other.id === me.id || budget <= EPSILON) continue;
    const dx = at.x - other.x;
    const dy = at.y - other.y;
    const d = Math.hypot(dx, dy);
    if (d >= tuning.minDistance) continue;
    const away = me.id < other.id ? -1 : 1;
    const dirs = d > EPSILON ? [{ x: dx / d, y: dy / d }] : COINCIDENT.map((u) => ({ x: u.x * away, y: u.y * away }));
    const share = Math.min((tuning.minDistance - d) / 2, budget);
    for (const u of dirs) {
      const to = tryPush(at, u.x * share, u.y * share, blocked);
      if (to === null) continue;
      budget -= Math.hypot(to.x - at.x, to.y - at.y);
      at = to;
      break;
    }
  }
  return at;
}
