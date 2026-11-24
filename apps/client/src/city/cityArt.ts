// Port Concord art: the ground painted one chunk at a time, buildings by kind and district, and street props.
// Everything is drawn from the shared map, so the city looks the same on every screen.
import Phaser from 'phaser';
import { CHUNK, CITY_MAP, ROAD_COLS, ROAD_ROWS, districtAt, type CityBuilding, type DistrictId } from '@byzantine-council/shared/city';
import { tileAt, type Box } from '@byzantine-council/shared';
import { P, fan, prism } from '../beach/beachArt.js';
import { hex, jitter, paintPlanks, rng, type Ctx } from '../game/groundPaint.js';
import { ART_SCALE, TILE_H, TILE_W } from '../game/iso.js';
import { lit, mix, shade } from '../game/palette.js';
import { quality } from '../game/quality.js';

type G = Phaser.GameObjects.Graphics;

const at = (c: number, r: number): string => tileAt(CITY_MAP, c, r);
const isRoadRow = (r: number): boolean => ROAD_ROWS.some((r0) => r === r0 || r === r0 + 1);
const isRoadCol = (c: number): boolean => ROAD_COLS.some((c0) => c === c0 || c === c0 + 1);

const PAVEMENT: Readonly<Record<DistrictId, number>> = {
  gullmoor: 0xa89a86,
  mint: 0xd9cfc0,
  heights: 0xd8cbb4,
  docks: 0xb4b1ab,
  council: 0xd2c8bc,
  signet: 0xc8c4c0,
  saltmarket: 0xe2cfa8,
  lowtide: 0xcfc2ae,
  shallows: 0xead8a8,
};

// Screen rectangle of a chunk's ground, in world pixels.
export function chunkBounds(cx: number, cy: number): { x: number; y: number; w: number; h: number } {
  const c0 = cx * CHUNK;
  const r0 = cy * CHUNK;
  return { x: (c0 - (r0 + CHUNK)) * (TILE_W / 2), y: (c0 + r0) * (TILE_H / 2), w: 2 * CHUNK * (TILE_W / 2), h: 2 * CHUNK * (TILE_H / 2) };
}

// Paints one chunk's ground into a canvas texture and returns its key and placement.
export function paintChunk(scene: Phaser.Scene, cx: number, cy: number): { key: string; x: number; y: number; scale: number } {
  const key = `city-chunk-${String(cx)}-${String(cy)}`;
  const b = chunkBounds(cx, cy);
  const scale = quality.current === 'low' ? 0.3 : 0.5;
  if (scene.textures.exists(key)) return { key, x: b.x, y: b.y, scale };
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(b.w * scale);
  canvas.height = Math.ceil(b.h * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d canvas');
  // Tile space to chunk-canvas space.
  ctx.setTransform((TILE_W / 2) * scale, (TILE_H / 2) * scale, (-TILE_W / 2) * scale, (TILE_H / 2) * scale, -b.x * scale, -b.y * scale);
  for (let r = cy * CHUNK; r < (cy + 1) * CHUNK; r++) {
    for (let c = cx * CHUNK; c < (cx + 1) * CHUNK; c++) paintTile(ctx, c, r);
  }
  scene.textures.addCanvas(key, canvas);
  return { key, x: b.x, y: b.y, scale };
}

function paintTile(ctx: Ctx, c: number, r: number): void {
  const t = at(c, r);
  const rand = rng(c * 7919 + r * 104729);
  const district = districtAt({ x: c + 0.5, y: r + 0.5 })?.id ?? 'saltmarket';
  const tile = (color: number): void => {
    ctx.fillStyle = hex(color);
    ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
  };
  if (t === '#' || t === '~') {
    paintSea(ctx, c, r, rand);
    return;
  }
  if (t === '=') {
    const water = [at(c - 1, r), at(c + 1, r), at(c, r - 1), at(c, r + 1)].includes('~');
    paintPlanks(ctx, c, r, rand, water);
    return;
  }
  if (t === ':') {
    paintRoad(ctx, c, r, rand);
    return;
  }
  if (t === ',' || (t === 'T' && [at(c - 1, r), at(c + 1, r), at(c, r - 1), at(c, r + 1)].includes(','))) {
    tile(jitter(0x8fb86a, rand, 0.06));
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(60,100,50,0.35)' : 'rgba(230,240,200,0.3)';
      ctx.fillRect(c + rand(), r + rand(), 0.02, 0.05);
    }
    if (rand() < 0.15) {
      ctx.fillStyle = ['#ffd27a', '#ff8a9a', '#ffffff'][Math.floor(rand() * 3)] ?? '#fff';
      for (let i = 0; i < 4; i++) ctx.fillRect(c + rand(), r + rand(), 0.04, 0.04);
    }
    return;
  }
  if (t === 'd' || t === 'M') {
    tile(jitter(0x9a8060, rand, 0.07));
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(70,50,35,0.35)' : 'rgba(230,210,170,0.25)';
      ctx.fillRect(c + rand(), r + rand(), 0.04, 0.03);
    }
    // Tyre tracks across the tip.
    if ((c + r) % 5 === 0) {
      ctx.fillStyle = 'rgba(60,45,30,0.18)';
      ctx.fillRect(c, r + 0.3, 1, 0.08);
      ctx.fillRect(c, r + 0.6, 1, 0.08);
    }
    return;
  }
  // Pavement: slabs in a half-tile grid, a kerb where it meets the road.
  const base = PAVEMENT[district];
  tile(jitter(base, rand, 0.03));
  ctx.strokeStyle = hex(shade(base, 0.18), 0.55);
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(c + 0.5, r);
  ctx.lineTo(c + 0.5, r + 1);
  ctx.moveTo(c, r + 0.5);
  ctx.lineTo(c + 1, r + 0.5);
  ctx.stroke();
  if (rand() < 0.2) {
    ctx.fillStyle = hex(shade(base, 0.1), 0.5);
    ctx.fillRect(c + (rand() < 0.5 ? 0 : 0.5) + 0.03, r + (rand() < 0.5 ? 0 : 0.5) + 0.03, 0.44, 0.44);
  }
  ctx.fillStyle = hex(0x8e8790);
  if (at(c + 1, r) === ':') ctx.fillRect(c + 0.9, r, 0.1, 1);
  if (at(c - 1, r) === ':') ctx.fillRect(c, r, 0.1, 1);
  if (at(c, r + 1) === ':') ctx.fillRect(c, r + 0.9, 1, 0.1);
  if (at(c, r - 1) === ':') ctx.fillRect(c, r, 1, 0.1);
  // The water's edge: a stone quay with a dark lip.
  const water = (dc: number, dr: number): boolean => at(c + dc, r + dr) === '~';
  ctx.fillStyle = hex(0x6e6470);
  if (water(1, 0)) ctx.fillRect(c + 0.88, r, 0.12, 1);
  if (water(0, 1)) ctx.fillRect(c, r + 0.88, 1, 0.12);
  if (water(-1, 0)) ctx.fillRect(c, r, 0.12, 1);
  if (water(0, -1)) ctx.fillRect(c, r, 1, 0.12);
}

function paintSea(ctx: Ctx, c: number, r: number, rand: () => number): void {
  // Lighter near the quays, deep blue in open water.
  let near = 3;
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (!['~', '#'].includes(at(c + dc, r + dr))) near = Math.min(near, Math.max(Math.abs(dc), Math.abs(dr)));
  const deep = 0x235d7e;
  const shallow = 0x3f93a8;
  ctx.fillStyle = hex(jitter(mix(shallow, deep, near / 3), rand, 0.025));
  ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
  if (rand() < 0.35) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.025;
    const y = r + 0.2 + rand() * 0.6;
    const x = c + rand() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 0.15, y - 0.06, x + 0.35, y);
    ctx.stroke();
  }
}

function paintRoad(ctx: Ctx, c: number, r: number, rand: () => number): void {
  ctx.fillStyle = hex(jitter(0x55505c, rand, 0.03));
  ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(c + rand(), r + rand(), 0.05, 0.05);
  }
  const rowRoad = isRoadRow(r);
  const colRoad = isRoadCol(c);
  // Crossings: zebra stripes on the tiles just outside each junction.
  if (rowRoad && colRoad) return;
  ctx.fillStyle = 'rgba(255,248,230,0.85)';
  const nearJunctionCol = ROAD_COLS.some((c0) => c === c0 - 1 || c === c0 + 2);
  const nearJunctionRow = ROAD_ROWS.some((r0) => r === r0 - 1 || r === r0 + 2);
  if (rowRoad && nearJunctionCol) {
    for (let i = 0; i < 4; i++) ctx.fillRect(c + 0.1, r + 0.08 + i * 0.25, 0.8, 0.12);
    return;
  }
  if (colRoad && nearJunctionRow) {
    for (let i = 0; i < 4; i++) ctx.fillRect(c + 0.08 + i * 0.25, r + 0.1, 0.12, 0.8);
    return;
  }
  // Dashed centre lines between the two lanes.
  ctx.fillStyle = 'rgba(255,214,120,0.8)';
  if (rowRoad && ROAD_ROWS.includes(r) && c % 2 === 0) ctx.fillRect(c + 0.1, r + 0.95, 0.6, 0.1);
  if (colRoad && ROAD_COLS.includes(c) && r % 2 === 0) ctx.fillRect(c + 0.95, r + 0.1, 0.1, 0.6);
}

// ---------- Buildings ----------

const WALLS: Readonly<Record<DistrictId, readonly number[]>> = {
  gullmoor: [0x8e8070, 0x7a6e62],
  mint: [0xe8dcc6, 0xd9c8a8, 0xcbb8a0],
  heights: [0xf0e4cc, 0xe6d2b0, 0xd8c4c8],
  docks: [0x9a6a52, 0x6f7e88, 0xa88a5a, 0x7a8a6e],
  council: [0xd8ccbc, 0xc0b4aa, 0xb8c0c8],
  signet: [0x9fb0c0, 0x8a98a8, 0xb8c4cc, 0xc8b8a8],
  saltmarket: [0xf2c6a0, 0x9fd6c8, 0xf4e0a8, 0xe8a8a0],
  lowtide: [0xe8c8a8, 0xc8d8c0, 0xd8c0d8, 0xf0dcb8],
  shallows: [0xf4ecdc, 0xd8ecf0],
};
const ROOFS: Readonly<Record<DistrictId, readonly number[]>> = {
  gullmoor: [0x5a5048],
  mint: [0x6a7a8a, 0x5a6a5e],
  heights: [0x8a4e46, 0x5a6a5e, 0x4a5a6e],
  docks: [0x6e6a72, 0x8a6a52],
  council: [0x5a6070, 0x707884],
  signet: [0x4a5868, 0x5a6878],
  saltmarket: [0xc0604a, 0x3fa7b5, 0xd8a040],
  lowtide: [0xb0604a, 0x5a6a8e, 0x6e8a5a],
  shallows: [0x3fa7b5, 0xc0604a],
};
const pick = (list: readonly number[], seed: number): number => list[seed % list.length] ?? list[0] ?? 0xcccccc;

// The front corner a building sorts by, in tile units (c + r).
export const buildingFront = (b: Box): number => b.c1 + 1 + b.r1 + 1;

// Window grid on the two faces you see, lit at random like a city at dusk.
function windows(g: G, b: Box, z0: number, h: number, seed: number, glass: number): void {
  const rand = rng(seed * 31 + 7);
  const floors = Math.max(1, Math.floor((h - 18) / 30));
  const front = b.r1 + 1 + 0.01;
  const side = b.c1 + 1 + 0.01;
  for (let f = 0; f < floors; f++) {
    const z = z0 + 14 + f * 30;
    for (let x = b.c0 + 0.3; x < b.c1 + 0.8; x += 0.55) {
      const on = rand() < 0.35;
      fan(g, on ? 0xffd27a : glass, [P(x, front, z), P(x + 0.28, front, z), P(x + 0.28, front, z + 16), P(x, front, z + 16)], on ? 1 : 0.9);
    }
    for (let y = b.r0 + 0.3; y < b.r1 + 0.8; y += 0.55) {
      const on = rand() < 0.3;
      fan(g, on ? lit(0xffd27a, 0.1) : shade(glass, 0.15), [P(side, y, z), P(side, y + 0.28, z), P(side, y + 0.28, z + 16), P(side, y, z + 16)], on ? 1 : 0.9);
    }
  }
}

function flatRoof(g: G, b: Box, z: number, roof: number, seed: number): void {
  const x0 = b.c0 + 0.05;
  const y0 = b.r0 + 0.05;
  const x1 = b.c1 + 0.95;
  const y1 = b.r1 + 0.95;
  // Parapet, then plant boxes and a water tank on bigger roofs.
  prism(g, x0, y0, x1, y1, z, 6, shade(roof, 0.1), roof);
  const rand = rng(seed * 13 + 1);
  if (x1 - x0 > 2 && y1 - y0 > 2) {
    prism(g, x0 + 0.5, y0 + 0.5, x0 + 1.1, y0 + 1.0, z + 6, 12, 0x9a9aa0, 0xb8b8c0);
    if (rand() < 0.5) {
      prism(g, x1 - 1.2, y0 + 0.6, x1 - 0.6, y0 + 1.2, z + 6, 22, 0x8a5a3a, 0xa86a40);
    }
  }
}

function hipRoof(g: G, b: Box, z: number, roof: number, rise: number): void {
  const o = 0.12;
  const x0 = b.c0 - o;
  const y0 = b.r0 - o;
  const x1 = b.c1 + 1 + o;
  const y1 = b.r1 + 1 + o;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const ridge = Math.max(0, (x1 - x0 - (y1 - y0)) / 2);
  const a = P(cx - ridge, cy, z + rise);
  const bb = P(cx + ridge, cy, z + rise);
  fan(g, shade(roof, 0.25), [P(x0, y0, z), P(x1, y0, z), bb, a]);
  fan(g, shade(roof, 0.1), [P(x0, y0, z), P(x0, y1, z), a]);
  fan(g, lit(roof, 0.12), [P(x0, y1, z), P(x1, y1, z), bb, a]);
  fan(g, roof, [P(x1, y0, z), P(x1, y1, z), bb]);
}

export function drawBuilding(g: G, b: CityBuilding): void {
  const box = b.box;
  const wall = pick(WALLS[b.district], b.seed);
  const roof = pick(ROOFS[b.district], b.seed + 1);
  const [x0, y0, x1, y1] = [box.c0 + 0.05, box.r0 + 0.05, box.c1 + 0.95, box.r1 + 0.95];
  switch (b.kind) {
    case 'gateTower': {
      // The dead exchange: a dark glass tower, its sign still glowing.
      prism(g, x0, y0, x1, y1, 0, 20, 0x5a5662, 0x7a7682);
      prism(g, x0 + 0.6, y0 + 0.6, x1 - 0.6, y1 - 0.6, 20, b.height, 0x2e3a4e, 0x4a5a72);
      windows(g, { c0: box.c0 + 0.6, r0: box.r0 + 0.6, c1: box.c1 - 0.6, r1: box.r1 - 0.6 }, 20, b.height, b.seed, 0x3e5068);
      const sign = P(x1 - 0.59, (y0 + y1) / 2, b.height - 30);
      g.fillStyle(0xe0574b, 0.25);
      g.fillCircle(sign.x, sign.y, 50 * ART_SCALE);
      fan(g, 0xe0574b, [P(x1 - 0.58, y0 + 1.6, b.height - 40), P(x1 - 0.58, y1 - 1.6, b.height - 40), P(x1 - 0.58, y1 - 1.6, b.height - 18), P(x1 - 0.58, y0 + 1.6, b.height - 18)]);
      prism(g, (x0 + x1) / 2 - 0.08, (y0 + y1) / 2 - 0.08, (x0 + x1) / 2 + 0.08, (y0 + y1) / 2 + 0.08, b.height + 20, 90, 0x9a9aa0);
      return;
    }
    case 'mintHall': {
      // A stone hall with a colonnade, steps and a green copper dome.
      prism(g, x0, y0, x1, y1, 0, 14, 0xc8bca8, 0xddd0bc);
      prism(g, x0 + 0.5, y0 + 0.5, x1 - 0.5, y1 - 0.5, 14, b.height - 60, 0xeadfcc);
      for (let x = x0 + 0.7; x < x1 - 0.5; x += 0.6) prism(g, x - 0.08, y1 - 0.45, x + 0.08, y1 - 0.3, 14, b.height - 70, 0xfff8ee);
      fan(g, shade(0xd9cbb6, 0.1), [P(x0 + 0.4, y1 - 0.3, b.height - 56), P(x1 - 0.4, y1 - 0.3, b.height - 56), P((x0 + x1) / 2, y1 - 0.3, b.height - 10)]);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const at = P(cx, cy, b.height - 46 + 70 * Math.sin((t * Math.PI) / 2));
        g.fillStyle(mix(0x4f8a78, 0x9fd6c0, t * 0.7), 1);
        const rad = Math.cos((t * Math.PI) / 2) * 1.8;
        g.fillEllipse(at.x, at.y, rad * TILE_W * 0.9, rad * TILE_H * 0.9);
      }
      return;
    }
    case 'cityHall':
    case 'hospital':
    case 'chapel': {
      prism(g, x0, y0, x1, y1, 0, b.height, b.kind === 'hospital' ? 0xf2f0ec : wall);
      windows(g, box, 0, b.height, b.seed, 0x6a7e94);
      if (b.kind === 'hospital') {
        // A red cross on the front and an ambulance bay canopy.
        const m = P((x0 + x1) / 2, y1 + 0.01, b.height - 40);
        g.fillStyle(0xe0574b, 1);
        g.fillRect(m.x - 18 * ART_SCALE, m.y - 6 * ART_SCALE, 36 * ART_SCALE, 12 * ART_SCALE);
        g.fillRect(m.x - 6 * ART_SCALE, m.y - 18 * ART_SCALE, 12 * ART_SCALE, 36 * ART_SCALE);
        flatRoof(g, box, b.height, 0x9aa0a8, b.seed);
        return;
      }
      hipRoof(g, box, b.height, roof, 60);
      // A clock tower or a steeple over the middle.
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      prism(g, cx - 0.6, cy - 0.6, cx + 0.6, cy + 0.6, b.height, b.kind === 'chapel' ? 120 : 80, lit(wall, 0.05));
      const top = b.height + (b.kind === 'chapel' ? 120 : 80);
      const face = P(cx, cy + 0.61, top - 40);
      g.fillStyle(0xfff4dc, 1);
      g.fillCircle(face.x, face.y, 14 * ART_SCALE);
      g.lineStyle(2 * ART_SCALE, 0x2a1a33, 1);
      g.lineBetween(face.x, face.y, face.x, face.y - 10 * ART_SCALE);
      g.lineBetween(face.x, face.y, face.x + 7 * ART_SCALE, face.y);
      const apex = P(cx, cy, top + (b.kind === 'chapel' ? 110 : 50));
      fan(g, shade(roof, 0.2), [P(cx - 0.7, cy - 0.7, top), P(cx + 0.7, cy - 0.7, top), apex]);
      fan(g, lit(roof, 0.1), [P(cx - 0.7, cy + 0.7, top), P(cx + 0.7, cy + 0.7, top), apex]);
      fan(g, roof, [P(cx + 0.7, cy - 0.7, top), P(cx + 0.7, cy + 0.7, top), apex]);
      return;
    }
    case 'lighthouse': {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      prism(g, x0, y0, x1, y1, 0, 16, 0x8a7e78, 0xa89a90);
      for (let i = 0; i < 7; i++) {
        const half = 0.9 - i * 0.07;
        prism(g, cx - half, cy - half, cx + half, cy + half, 16 + i * 32, 32, i % 2 === 0 ? 0xf4ece0 : 0xe0525a);
      }
      const z = 16 + 7 * 32;
      prism(g, cx - 0.4, cy - 0.4, cx + 0.4, cy + 0.4, z, 30, 0xffe9a8, 0xfff4d0);
      const lamp = P(cx, cy, z + 15);
      g.fillStyle(0xfff1c9, 0.35);
      g.fillCircle(lamp.x, lamp.y, 46 * ART_SCALE);
      const peak = P(cx, cy, z + 70);
      fan(g, 0x9a3a44, [P(cx - 0.5, cy + 0.5, z + 30), P(cx + 0.5, cy + 0.5, z + 30), peak]);
      fan(g, 0x7a2a34, [P(cx + 0.5, cy + 0.5, z + 30), P(cx + 0.5, cy - 0.5, z + 30), peak]);
      return;
    }
    case 'radioMast': {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      prism(g, x0, y0, x1, y1, 0, 20, 0x8a8e96, 0xa8acb4);
      const base = P(cx, cy, 20);
      const top = P(cx, cy, b.height);
      g.lineStyle(3 * ART_SCALE, 0xb8bcc4, 1);
      g.lineBetween(base.x - 30 * ART_SCALE, base.y, top.x, top.y);
      g.lineBetween(base.x + 30 * ART_SCALE, base.y, top.x, top.y);
      g.lineStyle(1.5 * ART_SCALE, 0xb8bcc4, 0.9);
      for (let i = 1; i < 12; i++) {
        const t = i / 12;
        const y = base.y + (top.y - base.y) * t;
        const half = 30 * ART_SCALE * (1 - t);
        g.lineBetween(base.x - half, y, base.x + half, y + (top.y - base.y) / 12);
      }
      g.fillStyle(0xe0574b, 1);
      g.fillCircle(top.x, top.y, 5 * ART_SCALE);
      g.fillStyle(0xe0574b, 0.3);
      g.fillCircle(top.x, top.y, 14 * ART_SCALE);
      return;
    }
    case 'fishMarket':
    case 'warehouse': {
      prism(g, x0, y0, x1, y1, 0, b.height, wall);
      // Corrugated lines and a big roller door.
      g.lineStyle(1 * ART_SCALE, shade(wall, 0.25), 0.6);
      for (let x = x0 + 0.2; x < x1; x += 0.25) {
        const a = P(x, y1, 0);
        const z = P(x, y1, b.height);
        g.lineBetween(a.x, a.y, z.x, z.y);
      }
      const mid = (x0 + x1) / 2;
      fan(g, shade(wall, 0.35), [P(mid - 0.8, y1 + 0.01, 0), P(mid + 0.8, y1 + 0.01, 0), P(mid + 0.8, y1 + 0.01, b.height * 0.6), P(mid - 0.8, y1 + 0.01, b.height * 0.6)]);
      // A shallow gable roof along the long side.
      const cy = (y0 + y1) / 2;
      const rise = 34;
      fan(g, shade(roof, 0.2), [P(x0 - 0.1, y0 - 0.1, b.height), P(x1 + 0.1, y0 - 0.1, b.height), P(x1 + 0.1, cy, b.height + rise), P(x0 - 0.1, cy, b.height + rise)]);
      fan(g, shade(wall, 0.1), [P(x1, y0, b.height), P(x1, y1, b.height), P(x1, cy, b.height + rise)]);
      fan(g, lit(roof, 0.08), [P(x0 - 0.1, y1 + 0.1, b.height), P(x1 + 0.1, y1 + 0.1, b.height), P(x1 + 0.1, cy, b.height + rise), P(x0 - 0.1, cy, b.height + rise)]);
      if (b.kind === 'fishMarket') {
        // A hand-painted sign: FISH.
        const s = P(mid, y1 + 0.02, b.height * 0.8);
        g.fillStyle(0x3fa7b5, 1);
        g.fillRect(s.x - 40 * ART_SCALE, s.y - 10 * ART_SCALE, 80 * ART_SCALE, 20 * ART_SCALE);
        g.fillStyle(0xfff4dc, 1);
        g.fillTriangle(s.x - 20 * ART_SCALE, s.y, s.x + 14 * ART_SCALE, s.y - 6 * ART_SCALE, s.x + 14 * ART_SCALE, s.y + 6 * ART_SCALE);
      }
      return;
    }
    case 'arcade': {
      prism(g, x0, y0, x1, y1, 0, b.height, 0x3a2a52);
      // Neon stripes along the front.
      for (const [z, col] of [[30, 0xff5fa2], [60, 0x5fd3ff], [90, 0xffd27a]] as const) {
        g.lineStyle(4 * ART_SCALE, col, 1);
        const a = P(x0, y1 + 0.02, z);
        const e = P(x1, y1 + 0.02, z);
        g.lineBetween(a.x, a.y, e.x, e.y);
      }
      flatRoof(g, box, b.height, 0x2a1a3a, b.seed);
      return;
    }
    case 'stall': {
      for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const) prism(g, x - 0.04, y - 0.04, x + 0.04, y + 0.04, 0, 70, 0x7a4e3e);
      prism(g, x0 + 0.1, y0 + 0.2, x1 - 0.1, y1 - 0.1, 0, 28, 0xb8784e, 0xd69a68);
      const stripes = Math.round((x1 - x0) * 4);
      for (let i = 0; i < stripes; i++) {
        const a = x0 + (i * (x1 - x0)) / stripes;
        const e = x0 + ((i + 1) * (x1 - x0)) / stripes;
        fan(g, i % 2 === 0 ? 0xf4ece0 : pick([0xe0525a, 0x3fa7b5, 0xffa45c], b.seed), [P(a, y0 - 0.05, 82), P(e, y0 - 0.05, 82), P(e, y1 + 0.15, 66), P(a, y1 + 0.15, 66)]);
      }
      return;
    }
    case 'house':
    case 'mansion': {
      prism(g, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, 0, b.height, wall);
      windows(g, { c0: box.c0 + 0.1, r0: box.r0 + 0.1, c1: box.c1 - 0.1, r1: box.r1 - 0.1 }, 0, b.height, b.seed, 0x6a7e94);
      // A front door and a step.
      const mid = (x0 + x1) / 2;
      fan(g, shade(roof, 0.3), [P(mid - 0.18, y1 - 0.09, 0), P(mid + 0.18, y1 - 0.09, 0), P(mid + 0.18, y1 - 0.09, 34), P(mid - 0.18, y1 - 0.09, 34)]);
      hipRoof(g, box, b.height, roof, b.kind === 'mansion' ? 70 : 50);
      if (b.kind === 'mansion') {
        // Columns at the entrance.
        for (const dx of [-0.5, 0.5]) prism(g, mid + dx - 0.06, y1 - 0.12, mid + dx + 0.06, y1, 0, b.height - 6, 0xfff8ee);
      }
      return;
    }
    case 'gatehouse': {
      prism(g, x0 + 1, y0 + 1, x0 + 3, y0 + 3, 0, b.height, 0x8a8070);
      windows(g, { c0: x0 + 1, r0: y0 + 1, c1: x0 + 2, r1: y0 + 2 }, 0, b.height, b.seed, 0x6a7e94);
      flatRoof(g, { c0: x0 + 1, r0: y0 + 1, c1: x0 + 2, r1: y0 + 2 }, b.height, 0x5a5048, b.seed);
      // A sign over the yard: GULLMOOR.
      const s = P(x1, (y0 + y1) / 2, 70);
      g.fillStyle(0xe0b84a, 1);
      g.fillRect(s.x - 46 * ART_SCALE, s.y - 10 * ART_SCALE, 92 * ART_SCALE, 18 * ART_SCALE);
      return;
    }
    default: {
      // Offices, towers and shops: walls, windows, a roof with plant.
      prism(g, x0, y0, x1, y1, 0, b.height, wall);
      windows(g, box, 0, b.height, b.seed, b.kind === 'tower' ? 0x5a7a9a : 0x6a7e94);
      if (b.kind === 'shop') {
        // A coloured awning over the shopfront.
        fan(g, pick([0xe0525a, 0x3fa7b5, 0xffa45c, 0x7fc86a], b.seed), [P(x0, y1 + 0.02, 40), P(x1, y1 + 0.02, 40), P(x1, y1 + 0.35, 28), P(x0, y1 + 0.35, 28)]);
      }
      flatRoof(g, box, b.height, roof, b.seed);
    }
  }
}

// ---------- Props ----------

export function drawStreetTree(g: G, seed: number): void {
  const s = ART_SCALE;
  const rand = rng(seed);
  g.fillStyle(0x6e4636, 1);
  g.fillRect(-3 * s, -26 * s, 6 * s, 26 * s);
  const greens = [0x5aa05a, 0x4b8a4e, 0x6eb060];
  for (let i = 0; i < 5; i++) {
    g.fillStyle(greens[i % greens.length] ?? 0x5aa05a, 1);
    g.fillCircle((rand() - 0.5) * 22 * s, -40 * s - rand() * 22 * s, (14 + rand() * 8) * s);
  }
  g.fillStyle(0xffffff, 0.12);
  g.fillCircle(-8 * s, -52 * s, 9 * s);
}

export function drawStreetLamp(g: G, c: number, r: number): void {
  const foot = P(c + 0.5, r + 0.5);
  const top = P(c + 0.5, r + 0.5, 110);
  g.lineStyle(3 * ART_SCALE, 0x3a3440, 1);
  g.lineBetween(foot.x, foot.y, top.x, top.y);
  g.lineBetween(top.x, top.y, top.x + 16 * ART_SCALE, top.y + 4 * ART_SCALE);
  g.fillStyle(0xfff1c9, 0.3);
  g.fillCircle(top.x + 16 * ART_SCALE, top.y + 8 * ART_SCALE, 18 * ART_SCALE);
  g.fillStyle(0xffe6a0, 1);
  g.fillCircle(top.x + 16 * ART_SCALE, top.y + 8 * ART_SCALE, 4 * ART_SCALE);
}

export function drawContainer(g: G, c: number, r: number, seed: number): void {
  const colors = [0xc0503a, 0x3a7ac0, 0x4a9a5a, 0xd8a040, 0x8a5ac0];
  const col = colors[seed % colors.length] ?? 0xc0503a;
  prism(g, c + 0.05, r + 0.1, c + 0.95, r + 0.9, 0, 36, col);
  if (seed % 3 === 0) prism(g, c + 0.05, r + 0.1, c + 0.95, r + 0.9, 36, 36, colors[(seed + 2) % colors.length] ?? col);
  g.lineStyle(1 * ART_SCALE, shade(col, 0.35), 0.7);
  for (let i = 1; i < 6; i++) {
    const a = P(c + 0.05 + i * 0.15, r + 0.9, 2);
    const e = P(c + 0.05 + i * 0.15, r + 0.9, 34);
    g.lineBetween(a.x, a.y, e.x, e.y);
  }
}

// A heap of rubbish bags and scrap at the tip.
export function drawMound(g: G, c: number, r: number, seed: number): void {
  const rand = rng(seed);
  const foot = P(c + 0.5, r + 0.6);
  const blobs = [0x3a3a40, 0x5a4a3a, 0x2e4a3a, 0x6a6058, 0x4a3a52];
  for (let i = 0; i < 9; i++) {
    g.fillStyle(blobs[Math.floor(rand() * blobs.length)] ?? 0x3a3a40, 1);
    g.fillEllipse(foot.x + (rand() - 0.5) * 50 * ART_SCALE, foot.y - rand() * 30 * ART_SCALE, (16 + rand() * 14) * ART_SCALE, (11 + rand() * 8) * ART_SCALE);
  }
  // A white bag and a seagull.
  g.fillStyle(0xf4f0e8, 1);
  g.fillEllipse(foot.x + 8 * ART_SCALE, foot.y - 24 * ART_SCALE, 14 * ART_SCALE, 9 * ART_SCALE);
  if (seed % 3 === 0) {
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(foot.x - 6 * ART_SCALE, foot.y - 40 * ART_SCALE, 10 * ART_SCALE, 6 * ART_SCALE);
    g.fillStyle(0xffa45c, 1);
    g.fillTriangle(foot.x - 12 * ART_SCALE, foot.y - 40 * ART_SCALE, foot.x - 17 * ART_SCALE, foot.y - 39 * ART_SCALE, foot.x - 12 * ART_SCALE, foot.y - 38 * ART_SCALE);
  }
}
