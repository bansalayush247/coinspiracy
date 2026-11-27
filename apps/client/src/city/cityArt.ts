// Port Concord art: the ground painted one chunk at a time, buildings by kind and district, and street props.
// Everything is drawn from the shared map, so the city looks the same on every screen.
import Phaser from 'phaser';
import { CHUNK, CITY_BUILDINGS, CITY_MAP, ROAD_COLS, ROAD_ROWS, districtAt, type CityBuilding, type DistrictId } from '@byzantine-council/shared/city';
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
  const inner = chunkBounds(cx, cy);
  // A margin round the chunk's own diamond, so its corners overlap the neighbours' instead of ending on a point.
  const pad = TILE_H;
  const b = { x: inner.x - pad, y: inner.y - pad, w: inner.w + 2 * pad, h: inner.h + 2 * pad };
  const scale = quality.current === 'low' ? 0.3 : 0.5;
  if (scene.textures.exists(key)) return { key, x: b.x, y: b.y, scale };
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(b.w * scale);
  canvas.height = Math.ceil(b.h * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d canvas');
  // Tile space to chunk-canvas space.
  ctx.setTransform((TILE_W / 2) * scale, (TILE_H / 2) * scale, (-TILE_W / 2) * scale, (TILE_H / 2) * scale, -b.x * scale, -b.y * scale);
  const c0 = cx * CHUNK;
  const r0 = cy * CHUNK;
  const sea = seaLayer(c0, r0);
  // Neighbouring chunks' textures overlap at the corners: each also paints a ring of the next one's tiles, exactly as
  // that one paints them, so their shared edge is solid wherever the two meet.
  seaUnderWater(ctx, sea, c0, r0);
  for (let r = r0 - 1; r <= r0 + CHUNK; r++) {
    for (let c = c0 - 1; c <= c0 + CHUNK; c++) paintTile(ctx, c, r);
  }
  for (let r = r0 - 1; r <= r0 + CHUNK; r++) {
    for (let c = c0 - 1; c <= c0 + CHUNK; c++) smoothCoast(ctx, sea, c0, r0, c, r);
  }
  if (quality.current !== 'low') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(c0 - SHADOW_RING, r0 - SHADOW_RING, CHUNK + 2 * SHADOW_RING, CHUNK + 2 * SHADOW_RING);
    ctx.clip();
    paintShadows(ctx, c0, r0);
    ctx.restore();
  }
  scene.textures.addCanvas(key, canvas);
  return { key, x: b.x, y: b.y, scale };
}

const isWater = (t: string): boolean => t === '~' || t === '#';
// Shadows stop inside the ring of neighbouring tiles a chunk paints, where its ground is solid, so a shadow's cut
// edge never lies over another chunk's ground.
const SHADOW_RING = 0.5;
const SEA = { shallow: 0x55a9b4, mid: 0x2f7f9c, deep: 0x1c4d72 };
// How far from land, in tiles, the sea reaches its deepest blue.
const SEA_DEPTH_TILES = 4;

// One pixel per tile of sea colour around a chunk, deeper away from land; drawn scaled up, the browser blends it.
function seaLayer(c0: number, r0: number): HTMLCanvasElement {
  const n = CHUNK + 2;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d canvas');
  const reach = SEA_DEPTH_TILES;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = c0 - 1 + i;
      const r = r0 - 1 + j;
      let near = reach;
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) if (!isWater(at(c + dc, r + dr))) near = Math.min(near, Math.hypot(dc, dr) - 0.5);
      }
      const d = Math.max(0, near) / reach;
      ctx.fillStyle = hex(d < 0.5 ? mix(SEA.shallow, SEA.mid, d * 2) : mix(SEA.mid, SEA.deep, (d - 0.5) * 2));
      ctx.fillRect(i, j, 1, 1);
    }
  }
  return canvas;
}

// The sea under the chunk's water tiles and its ring's, and nowhere else, so it never shows past a land tile's edge.
function seaUnderWater(ctx: Ctx, sea: HTMLCanvasElement, c0: number, r0: number): void {
  ctx.save();
  ctx.beginPath();
  for (let r = r0 - 1; r <= r0 + CHUNK; r++) {
    for (let c = c0 - 1; c <= c0 + CHUNK; c++) if (isWater(at(c, r))) ctx.rect(c - 0.01, r - 0.01, 1.02, 1.02);
  }
  ctx.clip();
  drawSea(ctx, sea, c0, r0);
  ctx.restore();
}

function drawSea(ctx: Ctx, sea: HTMLCanvasElement, c0: number, r0: number): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sea, c0 - 1, r0 - 1, CHUNK + 2, CHUNK + 2);
}

function paintTile(ctx: Ctx, c: number, r: number): void {
  paintSurface(ctx, at(c, r), c, r);
}

// Paints one kind of ground over a tile; the coast pass also uses it to fill half a tile with its neighbour's ground.
function paintSurface(ctx: Ctx, t: string, c: number, r: number): void {
  const rand = rng(c * 7919 + r * 104729);
  const district = districtAt({ x: c + 0.5, y: r + 0.5 })?.id ?? 'saltmarket';
  const tile = (color: number): void => {
    ctx.fillStyle = hex(color);
    ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
  };
  if (isWater(t)) {
    paintWaves(ctx, c, r, rand);
    return;
  }
  if (t === '=') {
    const water = [at(c - 1, r), at(c + 1, r), at(c, r - 1), at(c, r + 1)].includes('~');
    tile(0x5a3c30);
    paintPlanks(ctx, c, r, rand, water);
    // A dark edge beam wherever the deck ends over water.
    ctx.fillStyle = hex(0x4a3026);
    if (isWater(at(c + 1, r))) ctx.fillRect(c + 0.94, r, 0.06, 1);
    if (isWater(at(c - 1, r))) ctx.fillRect(c, r, 0.06, 1);
    if (isWater(at(c, r + 1))) ctx.fillRect(c, r + 0.94, 1, 0.06);
    if (isWater(at(c, r - 1))) ctx.fillRect(c, r, 1, 0.06);
    return;
  }
  if (t === ':') {
    paintRoad(ctx, c, r, rand);
    return;
  }
  if (t === ',' || (t === 'T' && [at(c - 1, r), at(c + 1, r), at(c, r - 1), at(c, r + 1)].includes(','))) {
    paintGrass(ctx, c, r, rand);
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
  paintPavement(ctx, c, r, rand, PAVEMENT[district]);
}

// Pavement: slabs in a half-tile grid with worn joints, and a raised kerb where it meets the road.
function paintPavement(ctx: Ctx, c: number, r: number, rand: () => number, base: number): void {
  ctx.fillStyle = hex(base);
  ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = hex(jitter(base, rand, 0.05));
      ctx.fillRect(c + i * 0.5 - 0.005, r + j * 0.5 - 0.005, 0.51, 0.51);
    }
  }
  ctx.strokeStyle = hex(shade(base, 0.22), 0.6);
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  ctx.moveTo(c + 0.5, r);
  ctx.lineTo(c + 0.5, r + 1);
  ctx.moveTo(c, r + 0.5);
  ctx.lineTo(c + 1, r + 0.5);
  ctx.stroke();
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(40,30,40,0.08)';
    ctx.fillRect(c + rand(), r + rand(), 0.02, 0.02);
  }
  if (rand() < 0.06) {
    ctx.fillStyle = 'rgba(60,50,60,0.08)';
    ctx.beginPath();
    ctx.ellipse(c + 0.3 + rand() * 0.4, r + 0.3 + rand() * 0.4, 0.14, 0.09, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const road = (dc: number, dr: number): boolean => at(c + dc, r + dr) === ':';
  const kerb = (x: number, y: number, w: number, h: number, lip: [number, number, number, number]): void => {
    ctx.fillStyle = hex(0xcfc8bc);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = hex(0x6c6470);
    ctx.fillRect(...lip);
  };
  if (road(1, 0)) kerb(c + 0.88, r, 0.12, 1, [c + 0.97, r, 0.03, 1]);
  if (road(-1, 0)) kerb(c, r, 0.12, 1, [c, r, 0.03, 1]);
  if (road(0, 1)) kerb(c, r + 0.88, 1, 0.12, [c, r + 0.97, 1, 0.03]);
  if (road(0, -1)) kerb(c, r, 1, 0.12, [c, r, 1, 0.03]);
  // The water's edge: a stone quay with a dark lip.
  const water = (dc: number, dr: number): boolean => at(c + dc, r + dr) === '~';
  ctx.fillStyle = hex(0x7a7080);
  if (water(1, 0)) ctx.fillRect(c + 0.88, r, 0.12, 1);
  if (water(0, 1)) ctx.fillRect(c, r + 0.88, 1, 0.12);
  if (water(-1, 0)) ctx.fillRect(c, r, 0.12, 1);
  if (water(0, -1)) ctx.fillRect(c, r, 1, 0.12);
}

// A lawn mown in stripes, with clumps, blades and the odd flower.
function paintGrass(ctx: Ctx, c: number, r: number, rand: () => number): void {
  const base = (c + r) % 2 === 0 ? 0x8cb868 : 0x86b062;
  ctx.fillStyle = hex(jitter(base, rand, 0.04));
  ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(70,110,50,0.18)' : 'rgba(200,225,150,0.18)';
    ctx.beginPath();
    ctx.ellipse(c + rand(), r + rand(), 0.06 + rand() * 0.1, 0.04 + rand() * 0.06, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(50,90,40,0.35)' : 'rgba(225,240,190,0.3)';
    ctx.fillRect(c + rand(), r + rand(), 0.015, 0.045);
  }
  if (rand() < 0.15) {
    ctx.fillStyle = ['#ffd27a', '#ff8a9a', '#ffffff'][Math.floor(rand() * 3)] ?? '#fff';
    for (let i = 0; i < 4; i++) ctx.fillRect(c + rand(), r + rand(), 0.04, 0.04);
  }
}

// Ripples, glints and foam on top of the smooth sea; the sea's colour is already down.
function paintWaves(ctx: Ctx, c: number, r: number, rand: () => number): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    if (rand() > 0.55) continue;
    const light = rand() > 0.35;
    ctx.strokeStyle = light ? `rgba(220,245,255,${String(0.12 + rand() * 0.14)})` : 'rgba(10,40,70,0.16)';
    ctx.lineWidth = 0.02 + rand() * 0.015;
    const y = r + 0.15 + rand() * 0.7;
    const x = c + rand() * 0.5;
    const len = 0.25 + rand() * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len / 2, y - 0.07, x + len, y);
    ctx.stroke();
  }
  if (rand() < 0.18) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(c + rand(), r + rand(), 0.03, 0.015);
  }
  const shore = (dc: number, dr: number): boolean => !isWater(at(c + dc, r + dr));
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (!shore(dc, dr)) continue;
    if (at(c + dc, r + dr) === '=') deckShadow(ctx, c, r, dc, dr);
    else foamAlong(ctx, c, r, dc, dr, rand, 1);
  }
}

// The shade a deck throws on the water beside it, fading out from under its edge.
function deckShadow(ctx: Ctx, c: number, r: number, dc: number, dr: number): void {
  const w = 0.3;
  const x0 = dc > 0 ? c + 1 : c;
  const y0 = dr > 0 ? r + 1 : r;
  const g = dc !== 0 ? ctx.createLinearGradient(x0, r, x0 - dc * w, r) : ctx.createLinearGradient(c, y0, c, y0 - dr * w);
  g.addColorStop(0, 'rgba(8,28,48,0.42)');
  g.addColorStop(1, 'rgba(8,28,48,0)');
  ctx.fillStyle = g;
  if (dc !== 0) ctx.fillRect(dc > 0 ? x0 - w : x0, r, w, 1);
  else ctx.fillRect(c, dr > 0 ? y0 - w : y0, 1, w);
}

// Two soft lines of foam just off one edge of a water tile, where it laps against the land.
function foamAlong(ctx: Ctx, c: number, r: number, dc: number, dr: number, rand: () => number, strength: number): void {
  for (const [off, alpha, width] of [[0.07, 0.55, 0.05], [0.2, 0.22, 0.03]] as const) {
    ctx.strokeStyle = `rgba(240,252,255,${String(alpha * strength)})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    const wob = (): number => (rand() - 0.5) * 0.06;
    if (dc !== 0) {
      const x = dc > 0 ? c + 1 - off : c + off;
      ctx.moveTo(x + wob(), r);
      ctx.bezierCurveTo(x + wob(), r + 0.33, x + wob(), r + 0.66, x + wob(), r + 1);
    } else {
      const y = dr > 0 ? r + 1 - off : r + off;
      ctx.moveTo(c, y + wob());
      ctx.bezierCurveTo(c + 0.33, y + wob(), c + 0.66, y + wob(), c + 1, y + wob());
    }
    ctx.stroke();
  }
}

// The four corners of a tile a coast can be cut across: the two sides it faces, and the triangle on that side.
const CORNERS = [
  { sides: [[1, 0], [0, 1]], tri: [[1, 0], [1, 1], [0, 1]] },
  { sides: [[-1, 0], [0, 1]], tri: [[0, 0], [0, 1], [1, 1]] },
  { sides: [[1, 0], [0, -1]], tri: [[0, 0], [1, 0], [1, 1]] },
  { sides: [[-1, 0], [0, -1]], tri: [[1, 0], [0, 0], [0, 1]] },
] as const;

// Cuts the coastline's tile steps into diagonals: a land corner sticking into the sea is cut back to water, and a
// water corner tucked into the land is filled with the land beside it, so the shore runs smooth.
function smoothCoast(ctx: Ctx, sea: HTMLCanvasElement, c0: number, r0: number, c: number, r: number): void {
  const t = at(c, r);
  const wet = isWater(t);
  if (!wet && !COAST_LAND.has(t)) return;
  const other = (dc: number, dr: number): boolean => isWater(at(c + dc, r + dr)) !== wet;
  for (const corner of CORNERS) {
    const [a, b] = corner.sides;
    if (!other(a[0], a[1]) || !other(b[0], b[1])) continue;
    if (other(-a[0], -a[1]) || other(-b[0], -b[1])) continue;
    // Only a step in a sloping shore, not the square end of a pier or a lone rock.
    if (other(a[0] - b[0], a[1] - b[1]) && other(b[0] - a[0], b[1] - a[1])) continue;
    if (wet && !other(a[0] + b[0], a[1] + b[1])) continue;
    // A boardwalk is built square: its steps stay, so a deck is never cut or grown.
    if (wet && [at(c + a[0], r + a[1]), at(c + b[0], r + b[1])].includes('=')) continue;
    const pts = corner.tri.map(([x, y]) => [c + x, r + y] as const);
    ctx.save();
    ctx.beginPath();
    for (const [i, [x, y]] of pts.entries()) {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();
    if (wet) {
      const land = at(c + a[0], r + a[1]);
      paintSurface(ctx, isWater(land) ? at(c + b[0], r + b[1]) : land, c, r);
    } else {
      drawSea(ctx, sea, c0, r0);
      paintWaves(ctx, c, r, rng(c * 31 + r * 17));
    }
    ctx.restore();
    const [p, , q] = pts;
    if (p === undefined || q === undefined) continue;
    const pier = (wet ? at(c + a[0], r + a[1]) : t) === '=';
    ctx.strokeStyle = pier ? 'rgba(70,45,40,0.9)' : hex(0x7a7080);
    ctx.lineWidth = pier ? 0.05 : 0.12;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,252,255,0.45)';
    ctx.lineWidth = 0.05;
    const nx = (a[0] + b[0]) * (wet ? -0.09 : 0.09);
    const ny = (a[1] + b[1]) * (wet ? -0.09 : 0.09);
    ctx.beginPath();
    ctx.moveTo(p[0] + nx, p[1] + ny);
    ctx.lineTo(q[0] + nx, q[1] + ny);
    ctx.stroke();
  }
}

// Open ground a coast corner may be cut out of: pavement, lawns, roads, boardwalks and the tip.
const COAST_LAND: ReadonlySet<string> = new Set(['.', 'T', 'L', ',', ':', 'd']);

// Asphalt with grain, darker tyre lanes, white edge lines, the odd crack, drain and manhole, and zebra crossings.
function paintRoad(ctx: Ctx, c: number, r: number, rand: () => number): void {
  ctx.fillStyle = hex(jitter(0x524d5a, rand, 0.025));
  ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(c + rand(), r + rand(), 0.018, 0.018);
  }
  const rowRoad = isRoadRow(r);
  const colRoad = isRoadCol(c);
  if (rowRoad && colRoad) {
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.ellipse(c + 0.5, r + 0.5, 0.45, 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Tyres wear two darker strips down each lane.
  ctx.fillStyle = 'rgba(20,15,25,0.1)';
  for (const k of [0.28, 0.72]) {
    if (rowRoad) ctx.fillRect(c, r + k - 0.06, 1, 0.12);
    else ctx.fillRect(c + k - 0.06, r, 0.12, 1);
  }
  if (rand() < 0.08) {
    ctx.strokeStyle = 'rgba(20,15,25,0.35)';
    ctx.lineWidth = 0.012;
    let x = c + 0.2 + rand() * 0.6;
    let y = r + 0.2 + rand() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < 4; i++) {
      x += (rand() - 0.5) * 0.18;
      y += (rand() - 0.5) * 0.18;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  if (rand() < 0.035) {
    const mx = c + 0.5;
    const my = r + 0.5;
    ctx.fillStyle = hex(0x3a3640);
    ctx.beginPath();
    ctx.arc(mx, my, 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,150,160,0.5)';
    ctx.lineWidth = 0.015;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }
  const nearJunctionCol = ROAD_COLS.some((c0) => c === c0 - 1 || c === c0 + 2);
  const nearJunctionRow = ROAD_ROWS.some((r0) => r === r0 - 1 || r === r0 + 2);
  ctx.fillStyle = 'rgba(255,248,230,0.88)';
  if (rowRoad && nearJunctionCol) {
    for (let i = 0; i < 4; i++) ctx.fillRect(c + 0.1, r + 0.08 + i * 0.25, 0.8, 0.12);
    return;
  }
  if (colRoad && nearJunctionRow) {
    for (let i = 0; i < 4; i++) ctx.fillRect(c + 0.08 + i * 0.25, r + 0.1, 0.12, 0.8);
    return;
  }
  // A solid white line along each kerb, with a drain grate now and then.
  ctx.fillStyle = 'rgba(245,240,230,0.55)';
  const outer = rowRoad ? (ROAD_ROWS.includes(r) ? r + 0.08 : r + 0.9) : ROAD_COLS.includes(c) ? c + 0.08 : c + 0.9;
  if (rowRoad) ctx.fillRect(c, outer, 1, 0.025);
  else ctx.fillRect(outer, r, 0.025, 1);
  if (rand() < 0.06) {
    ctx.fillStyle = hex(0x2e2a33);
    const g0 = rowRoad ? [c + 0.35, ROAD_ROWS.includes(r) ? r + 0.01 : r + 0.93, 0.3, 0.06] : [ROAD_COLS.includes(c) ? c + 0.01 : c + 0.93, r + 0.35, 0.06, 0.3];
    ctx.fillRect(g0[0] ?? c, g0[1] ?? r, g0[2] ?? 0, g0[3] ?? 0);
  }
  // Dashed centre lines between the two lanes.
  ctx.fillStyle = 'rgba(255,214,120,0.85)';
  if (rowRoad && ROAD_ROWS.includes(r) && c % 2 === 0) ctx.fillRect(c + 0.1, r + 0.95, 0.6, 0.1);
  if (colRoad && ROAD_COLS.includes(c) && r % 2 === 0) ctx.fillRect(c + 0.95, r + 0.1, 0.1, 0.6);
}

// Sun from the west, as on the citadel, so buildings throw their shadows east across the ground.
const SHADOW = { dirX: 1, dirY: 0.18, perHeight: 1 / 110, maxTiles: 5, color: 'rgba(36,24,64,0.26)', occlusion: 'rgba(36,24,64,0.2)' };

// Each building's shadow on the ground, and a dark seam where its walls meet it.
function paintShadows(ctx: Ctx, c0: number, r0: number): void {
  const reach = SHADOW.maxTiles + 1;
  for (const bld of CITY_BUILDINGS) {
    const { box } = bld;
    if (box.c1 < c0 - reach || box.c0 > c0 + CHUNK || box.r1 < r0 - reach || box.r0 > r0 + CHUNK) continue;
    const len = Math.min(SHADOW.maxTiles, bld.height * SHADOW.perHeight);
    const dx = SHADOW.dirX * len;
    const dy = SHADOW.dirY * len;
    const [x0, y0, x1, y1] = [box.c0 + 0.05, box.r0 + 0.05, box.c1 + 0.95, box.r1 + 0.95];
    ctx.fillStyle = SHADOW.color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1 + dx, y0 + dy);
    ctx.lineTo(x1 + dx, y1 + dy);
    ctx.lineTo(x0 + dx, y1 + dy);
    ctx.lineTo(x0, y1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = SHADOW.occlusion;
    ctx.lineWidth = 0.18;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
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

const LEAVES = [
  { dark: 0x2f6a3e, mid: 0x4b8a4e, light: 0x79b866, glint: 0xb8dc8a },
  { dark: 0x3a6a32, mid: 0x5a9442, light: 0x8cc05a, glint: 0xc8e290 },
  { dark: 0x2a5e48, mid: 0x3f8060, light: 0x6aaa7a, glint: 0xa8d4a0 },
] as const;

// A street tree lit from the west: its shadow on the ground, a shaded trunk, and a canopy built up from clusters,
// darkest underneath and on the east side, with leaf flecks on top. Each seed picks a broadleaf, a poplar or a pine.
export function drawStreetTree(g: G, seed: number): void {
  const s = ART_SCALE;
  const rand = rng(seed);
  const leaf = LEAVES[seed % LEAVES.length] ?? LEAVES[0];
  const kind = seed % 7 === 0 ? 'pine' : seed % 5 === 0 ? 'poplar' : 'broad';
  g.fillStyle(0x24183c, 0.22);
  g.fillEllipse(14 * s, 2 * s, (kind === 'poplar' ? 30 : 46) * s, 14 * s);
  const trunkTop = kind === 'pine' ? -18 : -30;
  g.fillStyle(0x5a3a2c, 1);
  g.fillTriangle(-4 * s, 0, 4 * s, 0, 0, trunkTop * s);
  g.fillRect(-2.6 * s, trunkTop * s, 5.2 * s, -trunkTop * s);
  g.fillStyle(0x86594a, 1);
  g.fillRect(-2.6 * s, trunkTop * s, 1.8 * s, -trunkTop * s);
  if (kind === 'pine') {
    for (let i = 0; i < 4; i++) {
      const y = -18 - i * 15;
      const w = 26 - i * 5;
      g.fillStyle(leaf.dark, 1);
      g.fillTriangle(-w * s, y * s, w * s, y * s, 0, (y - 26) * s);
      g.fillStyle(leaf.mid, 1);
      g.fillTriangle(-w * s, y * s, 0, (y + 2) * s, 0, (y - 26) * s);
      g.fillStyle(leaf.light, 0.8);
      g.fillTriangle(-w * 0.8 * s, (y - 3) * s, -w * 0.15 * s, (y - 2) * s, 0, (y - 24) * s);
    }
    return;
  }
  if (kind === 'broad') {
    g.lineStyle(2 * s, 0x5a3a2c, 1);
    g.lineBetween(0, -24 * s, -8 * s, -38 * s);
    g.lineBetween(0, -26 * s, 9 * s, -40 * s);
  }
  const tall = kind === 'poplar';
  const blobs: { x: number; y: number; r: number }[] = [];
  const count = tall ? 7 : 9;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    blobs.push(tall
      ? { x: (rand() - 0.5) * 12, y: -36 - t * 46 - rand() * 4, r: 9 + rand() * 4 - t * 2 }
      : { x: (rand() - 0.5) * 30, y: -44 - rand() * 22, r: 11 + rand() * 7 });
  }
  for (const b of blobs) {
    g.fillStyle(leaf.dark, 1);
    g.fillCircle((b.x + 2) * s, (b.y + 3) * s, b.r * s);
  }
  for (const b of blobs) {
    g.fillStyle(leaf.mid, 1);
    g.fillCircle(b.x * s, b.y * s, b.r * 0.88 * s);
  }
  for (const b of blobs) {
    g.fillStyle(leaf.light, 0.9);
    g.fillCircle((b.x - b.r * 0.3) * s, (b.y - b.r * 0.32) * s, b.r * 0.5 * s);
  }
  for (let i = 0; i < 18; i++) {
    const b = blobs[Math.floor(rand() * blobs.length)] ?? { x: 0, y: -50, r: 10 };
    const a = rand() * Math.PI * 2;
    const d = rand() * b.r * 0.8;
    g.fillStyle(rand() > 0.4 ? leaf.glint : leaf.dark, rand() > 0.4 ? 0.7 : 0.45);
    g.fillCircle((b.x + Math.cos(a) * d) * s, (b.y + Math.sin(a) * d) * s, (1 + rand() * 1.4) * s);
  }
}

// A modern street light: a slim two-tone pole on a small base plate, a thin arm out over the road and a flat LED
// head that glows warm underneath. Its only glow is a small halo under the head, so nobody walking by is washed out.
export function drawStreetLamp(g: G, c: number, r: number): void {
  const x = c + 0.5;
  const y = r + 0.5;
  const s = ART_SCALE;
  fan(g, 0x3c3a44, [P(x - 0.1, y, 0), P(x, y - 0.1, 0), P(x + 0.1, y, 0), P(x, y + 0.1, 0)]);
  fan(g, 0x2b2a32, [P(x - 0.1, y, 0), P(x, y + 0.1, 0), P(x, y + 0.1, 2), P(x - 0.1, y, 2)]);
  fan(g, 0x22212a, [P(x, y + 0.1, 0), P(x + 0.1, y, 0), P(x + 0.1, y, 2), P(x, y + 0.1, 2)]);
  const foot = P(x, y, 2);
  const top = P(x, y, 104);
  g.lineStyle(2.2 * s, 0x4a4854, 1);
  g.lineBetween(foot.x - 0.5 * s, foot.y, top.x - 0.5 * s, top.y);
  g.lineStyle(1.2 * s, 0x2a2930, 1);
  g.lineBetween(foot.x + 0.7 * s, foot.y, top.x + 0.7 * s, top.y);
  // The arm rises a touch as it reaches out, then the head: a slim dark housing with a lit strip below.
  const end = { x: top.x + 22 * s, y: top.y - 3 * s };
  g.lineStyle(1.6 * s, 0x44424e, 1);
  g.lineBetween(top.x, top.y, end.x, end.y);
  fan(g, 0x2e2c36, [{ x: end.x - 8 * s, y: end.y - 1.5 * s }, { x: end.x + 6 * s, y: end.y - 3.5 * s }, { x: end.x + 7 * s, y: end.y - 0.5 * s }, { x: end.x - 7 * s, y: end.y + 1.5 * s }]);
  fan(g, 0xfff3d2, [{ x: end.x - 6.5 * s, y: end.y + 1.2 * s }, { x: end.x + 6.5 * s, y: end.y - 0.8 * s }, { x: end.x + 6 * s, y: end.y + 0.4 * s }, { x: end.x - 6 * s, y: end.y + 2.4 * s }]);
  g.fillStyle(0xffe3a8, 0.16);
  g.fillEllipse(end.x, end.y + 5 * s, 22 * s, 10 * s);
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

// The ₿ mark as strokes on a 120-unit coin, so it never depends on the font having the glyph.
function traceBitcoinMark(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-14, -26);
  ctx.lineTo(-14, 26);
  ctx.moveTo(-14, -26);
  ctx.lineTo(4, -26);
  ctx.arc(4, -13, 13, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-14, 0);
  ctx.moveTo(-14, 0);
  ctx.lineTo(6, 0);
  ctx.arc(6, 13, 13, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-14, 26);
  for (const x of [-8, 2]) {
    ctx.moveTo(x, -26);
    ctx.lineTo(x, -38);
    ctx.moveTo(x, 26);
    ctx.lineTo(x, 38);
  }
}

// A gold play-sats coin with the ₿ mark, tilted like the logo, made once per scene.
export function makeCoinTexture(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const mid = size / 2;
  ctx.fillStyle = '#2a1a33';
  ctx.beginPath();
  ctx.arc(mid, mid, 63, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b8862f';
  ctx.beginPath();
  ctx.arc(mid, mid, 59, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd27a';
  ctx.beginPath();
  ctx.arc(mid, mid - 2, 51, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e0a63f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(mid, mid - 2, 44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(mid - 3, mid - 2);
  ctx.rotate((14 * Math.PI) / 180);
  ctx.strokeStyle = '#8a5a14';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  traceBitcoinMark(ctx);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 246, 230, 0.75)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(mid, mid - 2, 38, Math.PI * 1.1, Math.PI * 1.4);
  ctx.stroke();
  scene.textures.addCanvas(key, canvas);
}
