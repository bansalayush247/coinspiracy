// What a guardian can see with their own eyes: buildings block sight, everything else (trees, lamps, crates, heaps)
// is low enough to look past. The server uses this to decide who is sent to whom; the client shades the rest.
import type { Vec2 } from '../map.js';
import { CITY_BUILDINGS, CITY_HEIGHT, CITY_WIDTH, type BuildingKind } from './map.js';

// Someone this close is always seen, even round a corner: you would hear them breathing.
export const SIGHT_TOUCH = 1.2;
// How long someone stays visible after stepping out of sight, so a corner doesn't make them flicker.
export const SIGHT_GRACE_MS = 600;
// How far apart the extra rays to someone's shoulders are, so half a body round a corner still counts.
const SHOULDER = 0.35;
const MAX_STEPS = 512;

// Open-sided market stalls are the only buildings you can see past.
const SEE_PAST: ReadonlySet<BuildingKind> = new Set(['stall']);
const WALLS = new Uint8Array(CITY_WIDTH * CITY_HEIGHT);
for (const b of CITY_BUILDINGS) {
  if (SEE_PAST.has(b.kind)) continue;
  for (let r = b.box.r0; r <= b.box.r1; r++) for (let c = b.box.c0; c <= b.box.c1; c++) WALLS[r * CITY_WIDTH + c] = 1;
}

export const blocksSight = (c: number, r: number): boolean => c < 0 || r < 0 || c >= CITY_WIDTH || r >= CITY_HEIGHT || WALLS[r * CITY_WIDTH + c] === 1;

// Walks the grid from a to b tile by tile; false as soon as a building tile is crossed.
export function clearLine(a: Vec2, b: Vec2): boolean {
  let c = Math.floor(a.x);
  let r = Math.floor(a.y);
  const ec = Math.floor(b.x);
  const er = Math.floor(b.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const stepC = dx > 0 ? 1 : -1;
  const stepR = dy > 0 ? 1 : -1;
  const deltaC = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaR = dy === 0 ? Infinity : Math.abs(1 / dy);
  let maxC = dx === 0 ? Infinity : (dx > 0 ? c + 1 - a.x : a.x - c) * deltaC;
  let maxR = dy === 0 ? Infinity : (dy > 0 ? r + 1 - a.y : a.y - r) * deltaR;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (c === ec && r === er) return true;
    if (maxC < maxR) {
      maxC += deltaC;
      c += stepC;
    } else {
      maxR += deltaR;
      r += stepR;
    }
    if (c === ec && r === er) return true;
    if (blocksSight(c, r)) return false;
  }
  return false;
}

// Whether a guardian at `eye` can see something at `at`: to its middle or to either shoulder.
export function inSight(eye: Vec2, at: Vec2): boolean {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= SIGHT_TOUCH) return true;
  if (clearLine(eye, at)) return true;
  const px = (-dy / dist) * SHOULDER;
  const py = (dx / dist) * SHOULDER;
  return clearLine(eye, { x: at.x + px, y: at.y + py }) || clearLine(eye, { x: at.x - px, y: at.y - py });
}

// How far a look in direction `angle` (radians) travels before a building stops it, up to `max` tiles.
export function sightDistance(eye: Vec2, angle: number, max: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let c = Math.floor(eye.x);
  let r = Math.floor(eye.y);
  const stepC = dx > 0 ? 1 : -1;
  const stepR = dy > 0 ? 1 : -1;
  const deltaC = Math.abs(dx) < 1e-9 ? Infinity : Math.abs(1 / dx);
  const deltaR = Math.abs(dy) < 1e-9 ? Infinity : Math.abs(1 / dy);
  let maxC = deltaC === Infinity ? Infinity : (dx > 0 ? c + 1 - eye.x : eye.x - c) * deltaC;
  let maxR = deltaR === Infinity ? Infinity : (dy > 0 ? r + 1 - eye.y : eye.y - r) * deltaR;
  for (let i = 0; i < MAX_STEPS; i++) {
    const t = Math.min(maxC, maxR);
    if (t >= max) return max;
    if (maxC < maxR) {
      maxC += deltaC;
      c += stepC;
    } else {
      maxR += deltaR;
      r += stepR;
    }
    if (blocksSight(c, r)) return t;
  }
  return max;
}
