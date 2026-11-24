// Watchtower Peaks: mountain tops floating over the clouds, joined by rope bridges. During a network
// partition the three bridges between the west and east ranges hang broken until the link is repaired.
import Phaser from 'phaser';
import { PEAKS, PEAKS_BRIDGES, PEAKS_BUILDINGS, PEAKS_TOPS, TASK_KINDS, tileAt, type Box, type TaskKind } from '@byzantine-council/shared';
import { P, drawTorch, fan, prism } from '../beach/beachArt.js';
import { hex, jitter, paintCliffs, paintPlanks, rng, softPatch, type Ctx } from './groundPaint.js';
import { islandPaths } from './islandPaths.js';
import { ART_SCALE, TILE_H, TILE_W, mapScreenBounds } from './iso.js';
import { drawStation, type Swaying } from './mapArt.js';
import { lit, mix, shade } from './palette.js';
import { quality } from './quality.js';

type G = Phaser.GameObjects.Graphics;

const PEAKS_GROUND = 'peaks-ground';
const PAD_TOP = 40;
const PAD_BOTTOM = 320;
const MEADOW = 0x9fbe7a;
const ROCK = 0xb8aab0;
const SNOW = 0xf4f6ff;

// Chasms read as void for the cliff painter, so every mountain top gets its rock face.
function atVoid(c: number, r: number): string {
  const t = tileAt(PEAKS.map, c, r);
  return t === '^' ? '#' : t;
}

// Tiles from the nearest chasm edge, capped at 3.
function edgeDistance(c: number, r: number): number {
  let best = 3;
  for (let dr = -3; dr <= 3; dr++) {
    for (let dc = -3; dc <= 3; dc++) {
      const t = tileAt(PEAKS.map, c + dc, r + dr);
      if (t === '^' || t === '#') best = Math.min(best, Math.max(Math.abs(dc), Math.abs(dr)));
    }
  }
  return best;
}

export function paintPeaks(scene: Phaser.Scene): { key: string; x: number; y: number; scale: number } {
  const map = PEAKS.map;
  const bounds = mapScreenBounds(map.width, map.height);
  const w = bounds.width;
  const h = bounds.height + PAD_TOP + PAD_BOTTOM;
  const scale = Math.min(quality.current === 'low' ? 0.5 : 1, 4096 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d canvas');
  const ox = -bounds.x;
  // Tall rock faces under the mountain tops; only a thin edge under the bridges.
  ctx.setTransform(scale, 0, 0, scale, ox * scale, PAD_TOP * scale);
  paintCliffs(ctx, map, atVoid, (t) => (t === '=' ? 8 : 110));
  ctx.setTransform((TILE_W / 2) * scale, (TILE_H / 2) * scale, (-TILE_W / 2) * scale, (TILE_H / 2) * scale, ox * scale, PAD_TOP * scale);
  paintTops(ctx);
  if (scene.textures.exists(PEAKS_GROUND)) scene.textures.remove(PEAKS_GROUND);
  scene.textures.addCanvas(PEAKS_GROUND, canvas);
  return { key: PEAKS_GROUND, x: bounds.x, y: -PAD_TOP, scale };
}

// Alpine meadow in the middle of each top, weathered rock and old snow toward the edges.
function paintTops(ctx: Ctx): void {
  const map = PEAKS.map;
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = tileAt(map, c, r);
      if (t === '^' || t === '#') continue;
      const rand = rng(c * 733 + r * 419);
      if (t === '=') {
        paintPlanks(ctx, c, r, rand, false);
        continue;
      }
      const edge = edgeDistance(c, r);
      if (PEAKS_PATHS.has(`${String(c)},${String(r)}`)) {
        paintFlagstones(ctx, c, r, rand);
        continue;
      }
      const base = edge <= 1 ? mix(ROCK, MEADOW, 0.35) : edge === 2 ? mix(ROCK, MEADOW, 0.75) : MEADOW;
      ctx.fillStyle = hex(jitter(base, rand, 0.05));
      ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
      // Grass blades and small stones.
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = rand() > 0.6 ? 'rgba(70,110,60,0.35)' : 'rgba(250,250,240,0.25)';
        ctx.fillRect(c + rand(), r + rand(), 0.018, 0.03);
      }
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = 'rgba(120,110,125,0.45)';
        ctx.beginPath();
        ctx.ellipse(c + rand(), r + rand(), 0.04 + rand() * 0.04, 0.03, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Old snow lingers on the rock near the drop.
      if (edge <= 1 && rand() < 0.55) softPatch(ctx, c + rand(), r + rand(), 0.35 + rand() * 0.3, SNOW, 0.55);
      // Mountain flowers in the meadows.
      if (edge >= 3 && rand() < 0.2) {
        ctx.fillStyle = ['#ffd27a', '#c98bff', '#ffffff'][Math.floor(rand() * 3)] ?? '#fff';
        for (let i = 0; i < 4; i++) ctx.fillRect(c + rand(), r + rand(), 0.03, 0.03);
      }
    }
  }
  paintCouncilRing(ctx);
  // Soft shade under pines and buildings.
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = tileAt(map, c, r);
      if (t === 'T') softPatch(ctx, c + 0.9, r + 0.7, 0.9, 0x3b5a3a, 0.35);
      if (t === 'B') softPatch(ctx, c + 1, r + 0.6, 0.9, 0x463a52, 0.25);
      if (t === 'A' || t === 'W' || t === 'R') softPatch(ctx, c + 0.8, r + 0.7, 0.6, 0x463a52, 0.2);
    }
  }
}

// A pine: stacked tiers of needles with snow on the tips.
function drawPine(g: G, seed: number): void {
  const s = ART_SCALE;
  const rand = rng(seed);
  const tall = 1 + rand() * 0.35;
  g.fillStyle(0x6e4636, 1);
  g.fillRect(-3 * s, -16 * s, 6 * s, 16 * s);
  for (let i = 0; i < 4; i++) {
    const y = -16 * s - i * 26 * s * tall;
    const half = (34 - i * 7) * s;
    g.fillStyle(i % 2 === 0 ? 0x3f7a4e : 0x4b8a58, 1);
    g.fillTriangle(-half, y, half, y, 0, y - 40 * s * tall);
    g.fillStyle(0x2f5e3c, 1);
    g.fillTriangle(0, y, half, y, 0, y - 40 * s * tall);
    g.fillStyle(SNOW, 0.9);
    g.fillTriangle(-half * 0.45, y - 22 * s * tall, half * 0.45, y - 22 * s * tall, 0, y - 40 * s * tall);
  }
}

const sizeOf = (b: Box): { w: number; d: number; k: number } => {
  const w = b.c1 + 1 - b.c0;
  const d = b.r1 + 1 - b.r0;
  return { w, d, k: Math.min(w, d) / 2 };
};

// The Ice Vault: a squat stone keep with buttresses, a studded door and a pale crystal roof.
function drawIceVault(g: G, b: Box): void {
  const { k } = sizeOf(b);
  const [c0, r0, c1, r1] = [b.c0, b.r0, b.c1 + 1, b.r1 + 1];
  const wall = 60 * k;
  prism(g, c0 + 0.1, r0 + 0.1, c1 - 0.1, r1 - 0.1, 0, 14, 0x9a8e9c, 0xb0a4b2);
  prism(g, c0 + 0.25, r0 + 0.25, c1 - 0.25, r1 - 0.25, 14, wall, 0xc8c0d4);
  // Stone courses on the visible faces.
  g.lineStyle(1 * ART_SCALE, 0x8e8498, 0.6);
  for (let z = 26; z < wall + 14; z += 14) {
    const a = P(c0 + 0.25, r1 - 0.25, z);
    const m = P(c1 - 0.25, r1 - 0.25, z);
    const e = P(c1 - 0.25, r0 + 0.25, z);
    g.lineBetween(a.x, a.y, m.x, m.y);
    g.lineBetween(m.x, m.y, e.x, e.y);
  }
  for (const t of [0.2, 0.8]) {
    const x = c0 + (c1 - c0) * t;
    prism(g, x - 0.15, r1 - 0.35, x + 0.15, r1 - 0.05, 0, wall * 0.8, 0xb0a4b8, 0xd4cce0);
  }
  const mid = (c0 + c1) / 2;
  fan(g, 0x4a3a52, [P(mid - 0.4, r1 - 0.24, 14), P(mid + 0.4, r1 - 0.24, 14), P(mid + 0.4, r1 - 0.24, 14 + 38 * k), P(mid, r1 - 0.24, 14 + 48 * k), P(mid - 0.4, r1 - 0.24, 14 + 38 * k)]);
  g.fillStyle(0xbfe8ff, 1);
  for (const dx of [-0.2, 0, 0.2]) {
    const at = P(mid + dx, r1 - 0.23, 14 + 24 * k);
    g.fillCircle(at.x, at.y, 2 * ART_SCALE);
  }
  const roof = 14 + wall;
  const apex = P(mid, (r0 + r1) / 2, roof + 90 * k);
  const crystal = 0xbfe8ff;
  const e = 0.15;
  fan(g, shade(crystal, 0.2), [P(c0 + e, r0 + e, roof), P(c1 - e, r0 + e, roof), apex]);
  fan(g, shade(crystal, 0.05), [P(c1 - e, r0 + e, roof), P(c1 - e, r1 - e, roof), apex]);
  fan(g, lit(crystal, 0.2), [P(c0 + e, r1 - e, roof), P(c1 - e, r1 - e, roof), apex]);
  g.lineStyle(1.5 * ART_SCALE, 0xffffff, 0.6);
  const front = P(mid, r1 - e, roof);
  g.lineBetween(front.x, front.y, apex.x, apex.y);
  g.fillStyle(0xffffff, 0.55);
  g.fillCircle(apex.x - 5 * ART_SCALE, apex.y + 18 * ART_SCALE, 6 * ART_SCALE);
}

// The watchtower: a tall stone tower with arrow-slit windows, a balcony and a lantern room.
function drawStoneTower(g: G, b: Box): void {
  const { w, k } = sizeOf(b);
  const cx = b.c0 + w / 2;
  const cy = b.r0 + (b.r1 + 1 - b.r0) / 2;
  const hw = 0.8 * k;
  const h = 150 * k;
  prism(g, cx - hw - 0.15, cy - hw - 0.15, cx + hw + 0.15, cy + hw + 0.15, 0, 18, 0x9a8e9c, 0xb0a4b2);
  prism(g, cx - hw, cy - hw, cx + hw, cy + hw, 18, h, 0xb8aab0, 0xd6cad0);
  g.lineStyle(1 * ART_SCALE, 0x968a96, 0.55);
  for (let z = 34; z < h + 18; z += 16) {
    const a = P(cx - hw, cy + hw, z);
    const m = P(cx + hw, cy + hw, z);
    const e = P(cx + hw, cy - hw, z);
    g.lineBetween(a.x, a.y, m.x, m.y);
    g.lineBetween(m.x, m.y, e.x, e.y);
  }
  for (const z of [0.3, 0.55, 0.8].map((t) => 18 + h * t)) {
    fan(g, 0x4a3a52, [P(cx + hw + 0.01, cy - 0.12, z), P(cx + hw + 0.01, cy + 0.12, z), P(cx + hw + 0.01, cy + 0.12, z + 20), P(cx + hw + 0.01, cy - 0.12, z + 20)]);
    fan(g, 0xffd27a, [P(cx - 0.1, cy + hw + 0.01, z + 4), P(cx + 0.1, cy + hw + 0.01, z + 4), P(cx + 0.1, cy + hw + 0.01, z + 20), P(cx - 0.1, cy + hw + 0.01, z + 20)]);
  }
  fan(g, 0x4a3a52, [P(cx - 0.2, cy + hw + 0.01, 18), P(cx + 0.2, cy + hw + 0.01, 18), P(cx + 0.2, cy + hw + 0.01, 60), P(cx - 0.2, cy + hw + 0.01, 60)]);
  const top = 18 + h;
  prism(g, cx - hw - 0.18, cy - hw - 0.18, cx + hw + 0.18, cy + hw + 0.18, top, 10, 0x8e7e88, 0xa89aa2);
  // Crenellations.
  for (let i = 0; i < 5; i++) {
    const x = cx - hw - 0.1 + ((2 * hw + 0.2) * (i + 0.5)) / 5;
    prism(g, x - 0.08, cy + hw + 0.05, x + 0.08, cy + hw + 0.18, top + 10, 12, 0x9a8a94, 0xb0a2aa);
    prism(g, cx + hw + 0.05, x - 0.08 - cx + cy, cx + hw + 0.18, x + 0.08 - cx + cy, top + 10, 12, 0x9a8a94, 0xb0a2aa);
  }
  prism(g, cx - 0.5 * k, cy - 0.5 * k, cx + 0.5 * k, cy + 0.5 * k, top + 10, 34 * k, 0xffe9a8, 0xfff4d0);
  const lamp = P(cx, cy, top + 26 * k);
  g.fillStyle(0xfff1c9, 0.32);
  g.fillCircle(lamp.x, lamp.y, 38 * ART_SCALE * k);
  const peak = P(cx, cy, top + 100 * k);
  const z = top + 44 * k;
  fan(g, 0x5a4466, [P(cx - 0.65 * k, cy + 0.65 * k, z), P(cx + 0.65 * k, cy + 0.65 * k, z), peak]);
  fan(g, 0x433256, [P(cx + 0.65 * k, cy + 0.65 * k, z), P(cx + 0.65 * k, cy - 0.65 * k, z), peak]);
  fan(g, SNOW, [P(cx - 0.3 * k, cy + 0.65 * k, z + 30 * k), P(cx + 0.3 * k, cy + 0.65 * k, z + 30 * k), peak], 0.85);
}

// An alpine chalet: a stone plinth, log walls with lit windows and flower boxes, and a steep snowy roof.
function drawChalet(g: G, b: Box, wood: number, roofCol: number): void {
  const { k } = sizeOf(b);
  const [c0, r0, c1, r1] = [b.c0 + 0.12, b.r0 + 0.12, b.c1 + 0.88, b.r1 + 0.88];
  const base = 16 * k;
  const wall = 54 * k;
  prism(g, c0, r0, c1, r1, 0, base, 0x9a8e9c, 0xb0a4b2);
  prism(g, c0 + 0.08, r0 + 0.08, c1 - 0.08, r1 - 0.08, base, wall, wood);
  // Log seams on the two faces you see.
  g.lineStyle(1.2 * ART_SCALE, shade(wood, 0.35), 0.7);
  for (let z = base + 9; z < base + wall; z += 9) {
    const a = P(c0 + 0.08, r1 - 0.08, z);
    const m = P(c1 - 0.08, r1 - 0.08, z);
    const e = P(c1 - 0.08, r0 + 0.08, z);
    g.lineBetween(a.x, a.y, m.x, m.y);
    g.lineBetween(m.x, m.y, e.x, e.y);
  }
  const front = r1 - 0.07;
  const side = c1 - 0.07;
  const mid = (c0 + c1) / 2;
  fan(g, 0x4a2e2a, [P(mid - 0.22, front, base), P(mid + 0.22, front, base), P(mid + 0.22, front, base + 40 * k), P(mid - 0.22, front, base + 40 * k)]);
  const windows = (along: (t: number) => readonly [number, number], n: number): void => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const [x, y] = along(t);
      const wz = base + 18 * k;
      const lit2 = [P(x - 0.14, y, wz), P(x + 0.14, y, wz), P(x + 0.14, y, wz + 18 * k), P(x - 0.14, y, wz + 18 * k)];
      fan(g, 0xffd27a, lit2);
      // A flower box under each window.
      g.fillStyle(0xe0525a, 1);
      const box = P(x, y, wz - 2);
      g.fillRect(box.x - 9 * ART_SCALE, box.y - 2 * ART_SCALE, 18 * ART_SCALE, 4 * ART_SCALE);
    }
  };
  windows((t) => [c0 + (c1 - c0) * (t < 0.5 ? t * 0.6 : 0.4 + t * 0.6), front], 2);
  // Side windows run along the row axis: shift x into y.
  for (let i = 0; i < 2; i++) {
    const t = (i + 0.5) / 2;
    const y = r0 + (r1 - r0) * t;
    const wz = base + 18 * k;
    fan(g, 0xffd27a, [P(side, y - 0.14, wz), P(side, y + 0.14, wz), P(side, y + 0.14, wz + 18 * k), P(side, y - 0.14, wz + 18 * k)]);
  }
  // Gable roof with its ridge along the columns, overhanging the walls.
  const zw = base + wall;
  const zr = zw + 62 * k;
  const cy = (r0 + r1) / 2;
  const o = 0.22;
  fan(g, shade(roofCol, 0.25), [P(c0 - o, r0 - o, zw - 6), P(c1 + o, r0 - o, zw - 6), P(c1 + o, cy, zr), P(c0 - o, cy, zr)]);
  fan(g, shade(wood, 0.1), [P(c1 - 0.08, r0 + 0.08, zw), P(c1 - 0.08, r1 - 0.08, zw), P(c1 - 0.08, cy, zr - 4)]);
  // A chimney on the back slope.
  prism(g, c0 + 0.35, cy - 0.45, c0 + 0.65, cy - 0.15, zw + 20 * k, 52 * k, 0x9a8e9c, 0xb0a4b2);
  fan(g, roofCol, [P(c0 - o, r1 + o, zw - 6), P(c1 + o, r1 + o, zw - 6), P(c1 + o, cy, zr), P(c0 - o, cy, zr)]);
  // Snow on the front slope, thick at the ridge.
  fan(g, SNOW, [P(c0 - o, cy, zr), P(c1 + o, cy, zr), P(c1 + o, cy + (r1 + o - cy) * 0.55, zr - (zr - zw + 6) * 0.55), P(c0 - o, cy + (r1 + o - cy) * 0.62, zr - (zr - zw + 6) * 0.62)], 0.95);
  g.lineStyle(2 * ART_SCALE, lit(roofCol, 0.2), 1);
  const ra = P(c0 - o, r1 + o, zw - 6);
  const rb = P(c1 + o, r1 + o, zw - 6);
  g.lineBetween(ra.x, ra.y, rb.x, rb.y);
}

// The lodge's signing table, under a shingle roof on carved posts, with benches and a banner.
function drawSigningTable(g: G, b: Box): void {
  const { w, d } = sizeOf(b);
  const [c, r] = [b.c0, b.r0];
  const h = 70 + 10 * w;
  prism(g, c + 0.05, r + 0.05, c + w - 0.05, r + d - 0.05, 0, 6, 0x9a8e9c, 0xb0a4b2);
  prism(g, c + 0.4, r + 0.35, c + w - 0.4, r + 0.6, 6, 18, 0x7a5030, 0x9a6a3e);
  prism(g, c + 0.4, r + d - 0.6, c + w - 0.4, r + d - 0.35, 6, 18, 0x7a5030, 0x9a6a3e);
  prism(g, c + 0.8, r + 0.9, c + w - 0.8, r + d - 0.9, 6, 30, 0x9a6a3e, 0xb8844e);
  const scroll = P(c + w / 2, r + d / 2, 38);
  g.fillStyle(0xfff4dc, 1);
  g.fillEllipse(scroll.x, scroll.y, 32 * ART_SCALE, 10 * ART_SCALE);
  g.fillStyle(0xb8353f, 1);
  g.fillCircle(scroll.x + 6 * ART_SCALE, scroll.y, 4 * ART_SCALE);
  for (const [x, y] of [[0.1, 0.1], [w - 0.1, 0.1], [w - 0.1, d - 0.1], [0.1, d - 0.1]] as const) prism(g, c + x - 0.07, r + y - 0.07, c + x + 0.07, r + y + 0.07, 6, h, 0x6e4636);
  const roof = 0x8a4e46;
  const apex = P(c + w / 2, r + d / 2, h + 30);
  fan(g, shade(roof, 0.15), [P(c - 0.1, r - 0.1, h), P(c + w + 0.1, r - 0.1, h), apex]);
  fan(g, shade(roof, 0.25), [P(c + w + 0.1, r - 0.1, h), P(c + w + 0.1, r + d + 0.1, h), apex]);
  fan(g, lit(roof, 0.2), [P(c - 0.1, r - 0.1, h), P(c - 0.1, r + d + 0.1, h), apex]);
  fan(g, lit(roof, 0.1), [P(c - 0.1, r + d + 0.1, h), P(c + w + 0.1, r + d + 0.1, h), apex]);
  fan(g, SNOW, [P(c + w * 0.3, r + d * 0.7, h + 18), P(c + w * 0.7, r + d * 0.7, h + 18), apex], 0.85);
}

// A cairn of stacked flat stones, the trail marker of the high paths.
function drawCairn(g: G, c: number, r: number): void {
  const foot = P(c + 0.5, r + 0.55);
  const stones = [[22, 9, 0x9a8a92], [18, 8, 0xa89aa2], [14, 7, 0x8e7e88], [10, 6, 0xb0a4aa], [6, 5, 0x9a8a92]] as const;
  let y = foot.y;
  for (const [rx, ry, col] of stones) {
    g.fillStyle(shade(col, 0.2), 1);
    g.fillEllipse(foot.x, y + 2 * ART_SCALE, rx * 2 * ART_SCALE, ry * 2 * ART_SCALE);
    g.fillStyle(col, 1);
    g.fillEllipse(foot.x, y, rx * 2 * ART_SCALE, ry * 1.6 * ART_SCALE);
    y -= ry * 1.5 * ART_SCALE;
  }
  g.fillStyle(SNOW, 0.9);
  g.fillEllipse(foot.x, y + 4 * ART_SCALE, 10 * ART_SCALE, 4 * ART_SCALE);
}

// A woodpile of split logs under a lean-to roof.
function drawWoodpile(g: G, c: number, r: number): void {
  prism(g, c + 0.12, r + 0.25, c + 0.88, r + 0.75, 0, 30, 0x8a5a3a, 0xa86a40);
  g.fillStyle(0xd9a86a, 1);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4; i++) {
      const at = P(c + 0.2 + i * 0.18 + (row % 2) * 0.09, r + 0.76, 5 + row * 9);
      g.fillCircle(at.x, at.y, 3.6 * ART_SCALE);
    }
  }
  fan(g, 0x6e4636, [P(c + 0.05, r + 0.2, 44), P(c + 0.95, r + 0.2, 44), P(c + 0.95, r + 0.85, 32), P(c + 0.05, r + 0.85, 32)]);
  fan(g, SNOW, [P(c + 0.05, r + 0.2, 45), P(c + 0.95, r + 0.2, 45), P(c + 0.95, r + 0.5, 39), P(c + 0.05, r + 0.5, 39)], 0.9);
}

function drawBoulder(g: G, c: number, r: number): void {
  fan(g, 0x9a8a92, [P(c + 0.1, r + 0.85), P(c + 0.9, r + 0.85), P(c + 0.8, r + 0.25, 30), P(c + 0.25, r + 0.3, 26)]);
  fan(g, 0x7a6a78, [P(c + 0.9, r + 0.85), P(c + 0.85, r + 0.2), P(c + 0.8, r + 0.25, 30)]);
  fan(g, SNOW, [P(c + 0.3, r + 0.3, 26), P(c + 0.8, r + 0.25, 30), P(c + 0.55, r + 0.45, 33)], 0.9);
}

// Rope railings and posts along both sides of a bridge.
function drawRopes(g: G, b: Box): void {
  const horizontal = b.c1 - b.c0 >= b.r1 - b.r0;
  const sides = horizontal ? [b.r0 + 0.04, b.r1 + 0.96] : [b.c0 + 0.04, b.c1 + 0.96];
  for (const side of sides) {
    const a = horizontal ? P(b.c0, side, 0) : P(side, b.r0, 0);
    const z = horizontal ? P(b.c1 + 1, side, 0) : P(side, b.r1 + 1, 0);
    const lift = 22 * ART_SCALE;
    g.lineStyle(3 * ART_SCALE, 0x6e4636, 1);
    g.lineBetween(a.x, a.y, a.x, a.y - lift);
    g.lineBetween(z.x, z.y, z.x, z.y - lift);
    // The rope sags between the posts.
    g.lineStyle(2 * ART_SCALE, 0xc9a25a, 1);
    const steps = 10;
    let prev = { x: a.x, y: a.y - lift };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sag = Math.sin(t * Math.PI) * 8 * ART_SCALE;
      const p = { x: a.x + (z.x - a.x) * t, y: a.y - lift + (z.y - a.y) * t + sag };
      g.lineBetween(prev.x, prev.y, p.x, p.y);
      prev = p;
    }
  }
}

function stationAt(c: number, r: number): TaskKind | undefined {
  return TASK_KINDS.find((k) => PEAKS.stations[k].col === c && PEAKS.stations[k].row === r);
}

export interface PeaksProps {
  readonly swaying: Swaying[];
  // The railings of the bridges a partition cuts, hidden while they are down.
  readonly cutRopes: Phaser.GameObjects.Graphics[];
}

export function createPeaksProps(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer): PeaksProps {
  const swaying: Swaying[] = [];
  const cutRopes: Phaser.GameObjects.Graphics[] = [];
  const add = (depthSum: number, draw: (g: G) => void): G => {
    const g = new Phaser.GameObjects.Graphics(scene);
    draw(g);
    g.setDepth(depthSum * (TILE_H / 2));
    layer.add(g);
    return g;
  };
  for (const b of PEAKS_BUILDINGS) {
    add(b.box.c1 + b.box.r1 + 1, (g) => {
      if (b.kind === 'iceVault') drawIceVault(g, b.box);
      else if (b.kind === 'stoneTower') drawStoneTower(g, b.box);
      else if (b.kind === 'signingTable') drawSigningTable(g, b.box);
      else if (b.kind === 'cabin') drawChalet(g, b.box, 0x8a5a3a, 0x5a4466);
      else drawChalet(g, b.box, 0xa86a40, 0x7a3a44);
    });
  }
  for (const b of PEAKS_BRIDGES) {
    const ropes = add(b.c1 + b.r1 + 1.5, (g) => {
      drawRopes(g, b);
    });
    if (PEAKS.cutBridges.includes(b)) cutRopes.push(ropes);
  }
  for (let r = 0; r < PEAKS.map.height; r++) {
    for (let c = 0; c < PEAKS.map.width; c++) {
      const t = tileAt(PEAKS.map, c, r);
      if (t === 'T') {
        const foot = P(c + 0.5, r + 0.5);
        const g = new Phaser.GameObjects.Graphics(scene);
        drawPine(g, c * 31 + r * 17);
        g.setPosition(foot.x, foot.y).setDepth((c + r + 1) * (TILE_H / 2));
        layer.add(g);
        swaying.push({ g, phase: (c * 0.9 + r) % 6.28, amount: 0.8 });
      } else if (t === 'L') {
        add(c + r + 1, (g) => {
          drawTorch(g, c, r);
        });
      } else if (t === 'R') {
        add(c + r + 1, (g) => {
          drawBoulder(g, c, r);
        });
      } else if (t === 'A') {
        add(c + r + 1, (g) => {
          drawCairn(g, c, r);
        });
      } else if (t === 'W') {
        add(c + r + 1, (g) => {
          drawWoodpile(g, c, r);
        });
      } else if (t === 'S') {
        const kind = stationAt(c, r);
        if (kind !== undefined) {
          add(c + r + 1, (g) => {
            drawStation(g, kind, c, r);
          });
        }
      }
    }
  }
  return { swaying, cutRopes };
}

export function peaksLabels(): { text: string; x: number; y: number }[] {
  return Object.entries(PEAKS_TOPS).map(([room, b]) => ({
    text: PEAKS.roomNames[room as keyof typeof PEAKS.roomNames].replace(/^the /, '').toUpperCase(),
    x: (b.c0 + b.c1 + 1) / 2,
    y: b.r1 + 0.6,
  }));
}

// Mist drifting through the chasms, and the cut bridges: whole most of the time, broken in a partition.
export class PeaksLife {
  readonly #mist: Phaser.GameObjects.Graphics;
  readonly #broken: Phaser.GameObjects.Graphics;
  readonly #wisps: { x: number; y: number; speed: number; size: number }[];

  readonly #cutRopes: readonly Phaser.GameObjects.Graphics[];

  constructor(scene: Phaser.Scene, groundDepth: number, mistDepth: number, cutRopes: readonly Phaser.GameObjects.Graphics[]) {
    this.#cutRopes = cutRopes;
    this.#broken = scene.add.graphics().setDepth(groundDepth).setVisible(false);
    drawBrokenBridges(this.#broken);
    this.#mist = scene.add.graphics().setDepth(mistDepth);
    const rand = rng(7);
    const { width, height } = PEAKS.map;
    this.#wisps = Array.from({ length: 16 }, () => ({ x: rand() * (width + 2) - 2, y: 3 + rand() * (height - 6), speed: 0.15 + rand() * 0.2, size: 1.6 + rand() * 2 }));
  }

  setPartitioned(on: boolean): void {
    this.#broken.setVisible(on);
    for (const ropes of this.#cutRopes) ropes.setVisible(!on);
  }

  update(time: number, reducedMotion: boolean): void {
    const g = this.#mist;
    g.clear();
    const t = time / 1000;
    for (const w of this.#wisps) {
      const x = reducedMotion ? w.x : ((w.x + t * w.speed + 2) % (PEAKS.map.width + 4)) - 2;
      const at = P(x, w.y, -30);
      g.fillStyle(0xffffff, 0.08);
      g.fillEllipse(at.x, at.y, w.size * TILE_W, w.size * TILE_H * 0.6);
      g.fillStyle(0xffffff, 0.06);
      g.fillEllipse(at.x + 20 * ART_SCALE, at.y - 6 * ART_SCALE, w.size * TILE_W * 0.7, w.size * TILE_H * 0.4);
    }
  }
}

// Over each cut bridge: the whole span open to the sky, with frayed ropes and a plank dangling at each end.
function drawBrokenBridges(g: G): void {
  for (const b of PEAKS.cutBridges) {
    const span = [P(b.c0, b.r0), P(b.c1 + 1, b.r0), P(b.c1 + 1, b.r1 + 1), P(b.c0, b.r1 + 1)];
    fan(g, 0x3b2752, span, 0.78);
    fan(g, 0xffffff, span, 0.14);
    const horizontal = b.c1 - b.c0 >= b.r1 - b.r0;
    const midR = (b.r0 + b.r1 + 1) / 2;
    const midC = (b.c0 + b.c1 + 1) / 2;
    // Dangling ends, in partition red so the cut reads at a glance.
    const ends = horizontal ? [P(b.c0, midR), P(b.c1 + 1, midR)] : [P(midC, b.r0), P(midC, b.r1 + 1)];
    for (const e of ends) {
      g.lineStyle(2 * ART_SCALE, 0xff6b7a, 1);
      g.lineBetween(e.x - 8 * ART_SCALE, e.y, e.x - 4 * ART_SCALE, e.y + 26 * ART_SCALE);
      g.lineBetween(e.x + 8 * ART_SCALE, e.y, e.x + 5 * ART_SCALE, e.y + 30 * ART_SCALE);
      g.fillStyle(0x9a6a3e, 1);
      g.fillRect(e.x - 9 * ART_SCALE, e.y + 24 * ART_SCALE, 14 * ART_SCALE, 4 * ART_SCALE);
    }
  }
}

const PEAKS_PATHS = islandPaths(PEAKS.map, PEAKS_TOPS, PEAKS_BRIDGES, { plaza: PEAKS.seal });

// Worn flagstones: irregular grey slabs with grass in the joints.
function paintFlagstones(ctx: Ctx, c: number, r: number, rand: () => number): void {
  ctx.fillStyle = hex(mix(MEADOW, 0x6f8a5a, 0.4));
  ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const x0 = c + x * 0.5 + 0.03 + rand() * 0.03;
      const y0 = r + y * 0.5 + 0.03 + rand() * 0.03;
      ctx.fillStyle = hex(jitter(0xc8bcc4, rand, 0.06));
      ctx.beginPath();
      ctx.moveTo(x0, y0 + rand() * 0.05);
      ctx.lineTo(x0 + 0.44, y0 + rand() * 0.04);
      ctx.lineTo(x0 + 0.42 + rand() * 0.03, y0 + 0.43);
      ctx.lineTo(x0 + rand() * 0.04, y0 + 0.44);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x0 + 0.04, y0 + 0.04, 0.2, 0.05);
    }
  }
}

// The council ring on Summit Square: a paved circle with a carved stone border and a compass star.
function paintCouncilRing(ctx: Ctx): void {
  const { x, y } = PEAKS.seal;
  const ring = (radius: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  ring(3.3, 'rgba(120,110,125,0.55)');
  ring(3.0, '#d6cad0');
  ring(2.75, '#c2b6be');
  const rand = rng(91);
  // Concentric slabs.
  ctx.strokeStyle = 'rgba(120,110,125,0.45)';
  ctx.lineWidth = 0.03;
  for (const radius of [1.2, 2.0, 2.75]) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rand() * 0.05;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 1.2, y + Math.sin(a) * 1.2);
    ctx.lineTo(x + Math.cos(a) * 2.75, y + Math.sin(a) * 2.75);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(122,58,68,0.55)';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = i % 2 === 0 ? 1.1 : 0.7;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a + Math.PI / 2) * 0.14, y + Math.sin(a + Math.PI / 2) * 0.14);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.lineTo(x - Math.cos(a + Math.PI / 2) * 0.14, y - Math.sin(a + Math.PI / 2) * 0.14);
    ctx.fill();
  }
  ring(0.25, '#ffd27a');
}
