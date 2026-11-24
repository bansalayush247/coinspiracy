// Who sees whom in the open city: players near you are synced, the rest of the city is not sent at all.
import type { Vec2 } from '../map.js';

// Tiles: start showing a player inside SHOW, stop beyond HIDE. The gap stops flicker at the edge.
export const INTEREST_SHOW = 30;
export const INTEREST_HIDE = 36;

const reach = (a: Vec2, b: Vec2): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Whether a viewer should see another player next, given whether it sees them now.
export function keepsInView(viewer: Vec2, other: Vec2, visibleNow: boolean): boolean {
  return reach(viewer, other) <= (visibleNow ? INTEREST_HIDE : INTEREST_SHOW);
}

// Map chunks, the unit the client paints and streams.
export const CHUNK = 16;

export function chunkOf(pos: Vec2): { cx: number; cy: number } {
  return { cx: Math.floor(pos.x / CHUNK), cy: Math.floor(pos.y / CHUNK) };
}

// Chunk keys within `radius` chunks of a position, nearest first.
export function chunksAround(pos: Vec2, radius: number, cols: number, rows: number): string[] {
  const { cx, cy } = chunkOf(pos);
  const out: { key: string; d: number }[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x * CHUNK >= cols || y * CHUNK >= rows) continue;
      out.push({ key: `${String(x)},${String(y)}`, d: Math.max(Math.abs(x - cx), Math.abs(y - cy)) });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.key);
}
