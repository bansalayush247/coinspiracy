// 2:1 dimetric projection. World = tile units (what the server simulates); screen = world pixels.
import type { Vec2 } from '@byzantine-council/shared';

export const TILE_W = 128;
export const TILE_H = 64;
// The concept art was drawn on 64 px tiles; heights scale with the tile size.
export const ART_SCALE = TILE_W / 64;

export function worldToScreen(wx: number, wy: number, out: { x: number; y: number } = { x: 0, y: 0 }): Vec2 {
  out.x = (wx - wy) * (TILE_W / 2);
  out.y = (wx + wy) * (TILE_H / 2);
  return out;
}

export function screenToWorld(sx: number, sy: number): Vec2 {
  return { x: sy / TILE_H + sx / TILE_W, y: sy / TILE_H - sx / TILE_W };
}

// Painter's order: screen y of the foot point, monotonic in wx + wy.
export function isoDepth(wx: number, wy: number): number {
  return (wx + wy) * (TILE_H / 2);
}

// A screen-space direction (keys, joystick) as a world direction with the same length, capped at 1.
export function screenDirToWorld(dx: number, dy: number): Vec2 {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const magnitude = Math.min(1, Math.hypot(dx, dy));
  if (magnitude === 0) return { x: 0, y: 0 };
  const wx = dx / TILE_W + dy / TILE_H;
  const wy = dy / TILE_H - dx / TILE_W;
  const len = Math.hypot(wx, wy);
  return { x: (wx / len) * magnitude, y: (wy / len) * magnitude };
}

// Axis-aligned screen bounds of a cols x rows map.
export function mapScreenBounds(cols: number, rows: number): { x: number; y: number; width: number; height: number } {
  const left = -rows * (TILE_W / 2);
  const right = cols * (TILE_W / 2);
  return { x: left, y: 0, width: right - left, height: (cols + rows) * (TILE_H / 2) };
}
