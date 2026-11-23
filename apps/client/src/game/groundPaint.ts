// Paints the citadel ground once into a canvas texture: textured stone, planks, grass and water,
// soft golden-hour shadows, ambient occlusion and rock cliffs. Drawing goes through the iso
// transform, so world-space patterns land in perspective without any per-pixel maths.
import type Phaser from 'phaser';
import { CITADEL_MAP, SPAWN_POINTS, roomAt, tileAt, type CitadelMap } from '@byzantine-council/shared';
import { ART_SCALE, TILE_H, TILE_W, mapScreenBounds } from './iso.js';
import { quality } from './quality.js';

export type Ctx = CanvasRenderingContext2D;

export const GROUND_TEXTURE = 'citadel-ground';
// Room below the island for the cliffs, and above it for the far edge.
const PAD_TOP = 40;
const PAD_BOTTOM = 260;
// Longest side a texture may have on low-end GPUs.
const MAX_TEXTURE = 4096;

// Deterministic noise, so every client paints the same island.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hex(c: number, a = 1): string {
  return `rgba(${String((c >> 16) & 255)},${String((c >> 8) & 255)},${String(c & 255)},${String(a)})`;
}

export function jitter(c: number, r: () => number, amount: number): number {
  const k = 1 + (r() - 0.5) * amount;
  const ch = (s: number): number => Math.max(0, Math.min(255, Math.round(((c >> s) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// Sun from the west (screen left), so shadows fall toward +x in the world.
const SHADOW_DIR = { x: 1, y: 0.18 };
const SHADOW_COLOR = 0x3b2752;

const PROP_HEIGHT: Readonly<Record<string, number>> = { B: 120, P: 86, L: 58, T: 92, C: 36, G: 80, S: 60, K: 16 };
const PROP_FOOT: Readonly<Record<string, number>> = { B: 0.5, P: 0.22, L: 0.06, T: 0.36, C: 0.4, G: 0.22, S: 0.36, K: 0.45 };

const FLOOR = { plaza: 0xf7e3c2, hall: 0xefd6ae, court: 0xeed2a8, grass: 0x9fbe5c, plank: 0xc08a58, water: 0x3f95c2 };

export interface PaintedGround {
  readonly key: string;
  // World-pixel position of the texture's top-left corner and its scale (texture px per world px).
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export function paintGround(scene: Phaser.Scene, map: CitadelMap = CITADEL_MAP): PaintedGround {
  const bounds = mapScreenBounds(map.width, map.height);
  const worldW = bounds.width;
  const worldH = bounds.height + PAD_TOP + PAD_BOTTOM;
  const scale = Math.min(quality.current === 'low' ? 0.5 : 1, MAX_TEXTURE / Math.max(worldW, worldH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(worldW * scale);
  canvas.height = Math.ceil(worldH * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d canvas');
  const ox = -bounds.x;
  const oy = PAD_TOP;
  // World tiles -> texture pixels through the 2:1 iso projection.
  const toIso = (): void => {
    ctx.setTransform((TILE_W / 2) * scale, (TILE_H / 2) * scale, (-TILE_W / 2) * scale, (TILE_H / 2) * scale, ox * scale, oy * scale);
  };
  // World pixels (screen space before the camera) -> texture pixels.
  const toScreen = (): void => {
    ctx.setTransform(scale, 0, 0, scale, ox * scale, oy * scale);
  };
  const at = (c: number, r: number): string => tileAt(map, c, r);
  const solid = (t: string): boolean => t !== '.' && t !== '=' && t !== '~' && t !== '#';

  toScreen();
  paintCliffs(ctx, map, at);
  toIso();
  paintTiles(ctx, map, at);
  paintSeal(ctx);
  paintShadows(ctx, map, at, scale);
  paintOcclusion(ctx, map, at, solid);
  paintGrit(ctx, map, at);
  paintRim(ctx, map, at);

  const key = GROUND_TEXTURE;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
  return { key, x: bounds.x, y: -PAD_TOP, scale };
}

// Clips to every floor tile of one region and lays stones across it, ignoring tile lines.
function paveRegion(ctx: Ctx, map: CitadelMap, at: (c: number, r: number) => string, region: 'plaza' | 'court'): void {
  ctx.save();
  ctx.beginPath();
  let any = false;
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = at(c, r);
      // Props stand on floor too, so their tiles are paved underneath.
      if (t === '#' || t === '~' || t === '=' || t === 'T' || t === 'B' || regionOf(c, r) !== region) continue;
      ctx.rect(c - 0.001, r - 0.001, 1.002, 1.002);
      any = true;
    }
  }
  if (!any) {
    ctx.restore();
    return;
  }
  ctx.clip();
  const rand = rng(region === 'plaza' ? 7 : 11);
  const base = region === 'plaza' ? FLOOR.plaza : FLOOR.court;
  ctx.fillStyle = hex(shadeOf(base, 0.8));
  ctx.fillRect(0, 0, map.width, map.height);
  if (region === 'plaza') {
    // Rings of stones around the council seal, then a running bond further out.
    for (let ring = 0, radius = 0.6; radius < 8; ring++) {
      const width = 0.55 + rand() * 0.1;
      const segments = Math.max(6, Math.round((2 * Math.PI * (radius + width / 2)) / (0.75 + rand() * 0.3)));
      const offset = rand() * Math.PI;
      for (let k = 0; k < segments; k++) {
        const a0 = offset + (k / segments) * Math.PI * 2;
        const a1 = offset + ((k + 1) / segments) * Math.PI * 2;
        sector(ctx, 15, 15, radius + 0.02, radius + width - 0.02, a0 + 0.02 / radius, a1 - 0.02 / radius, jitter(base, rand, 0.1), rand);
      }
      radius += width;
    }
  } else {
    let y = 0;
    let row = 0;
    while (y < map.height) {
      const h = 0.85 + rand() * 0.4;
      let x = row % 2 === 0 ? 0 : -0.7;
      while (x < map.width) {
        const w = 1.1 + rand() * 1.1;
        stone(ctx, x, y, w, h, jitter(base, rand, 0.12), rand);
        x += w;
      }
      y += h;
      row += 1;
    }
  }
  ctx.restore();
}

function shadeOf(c: number, k: number): number {
  const ch = (s: number): number => Math.round(((c >> s) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// One curved paving stone of a ring.
function sector(ctx: Ctx, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, color: number, rand: () => number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r1, a0, a1);
  ctx.arc(cx, cy, r0, a1, a0, true);
  ctx.closePath();
  const mid = (a0 + a1) / 2;
  const g = ctx.createLinearGradient(cx + Math.cos(mid) * r0, cy + Math.sin(mid) * r0, cx + Math.cos(mid) * r1, cy + Math.sin(mid) * r1);
  g.addColorStop(0, hex(jitter(color, rand, 0.05)));
  g.addColorStop(1, hex(jitter(color, rand, 0.08)));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 0.018;
  ctx.strokeStyle = 'rgba(255,248,230,0.35)';
  ctx.stroke();
}

function regionOf(c: number, r: number): 'plaza' | 'hall' | 'court' {
  const room = roomAt({ x: c + 0.5, y: r + 0.5 });
  return room === 'plaza' ? 'plaza' : room === 'signingHall' ? 'hall' : 'court';
}

function paintTiles(ctx: Ctx, map: CitadelMap, at: (c: number, r: number) => string): void {
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = at(c, r);
      if (t === '#') continue;
      const rand = rng(c * 7919 + r * 104_729 + 17);
      if (t === '~') paintWater(ctx, c, r, rand, at);
      else if (t === '=') paintPlanks(ctx, c, r, rand, at(c, r - 1) === '~' || at(c, r + 1) === '~');
      else if (t === 'T') paintGrass(ctx, c, r, rand);
      else if (regionOf(c, r) === 'hall') paintHallTiles(ctx, c, r, rand);
    }
  }
  paveRegion(ctx, map, at, 'court');
  paveRegion(ctx, map, at, 'plaza');
  // Grass and moss spill softly around trees and the channel.
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      if (at(c, r) === 'T') softPatch(ctx, c + 0.5, r + 0.5, 1.4, FLOOR.grass, 0.55);
      if (at(c, r) === '~') softPatch(ctx, c + 0.5, r + 0.5, 1.1, 0x7f9a52, 0.12);
    }
  }
}

// One stone with bevelled light and shadow edges.
function stone(ctx: Ctx, x: number, y: number, w: number, h: number, color: number, r: () => number): void {
  const g = 0.022;
  const pts: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]] = [
    [x + g + r() * 0.02, y + g + r() * 0.02],
    [x + w - g - r() * 0.02, y + g + r() * 0.02],
    [x + w - g - r() * 0.02, y + h - g - r() * 0.02],
    [x + g + r() * 0.02, y + h - g - r() * 0.02],
  ];
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, hex(jitter(color, r, 0.06)));
  grad.addColorStop(1, hex(jitter(color, r, 0.1)));
  ctx.fillStyle = grad;
  ctx.fill();
  // Sunlit top-left edges, shaded bottom-right edges.
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = 'rgba(255,248,230,0.55)';
  ctx.beginPath();
  ctx.moveTo(pts[3][0], pts[3][1]);
  ctx.lineTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[1][0], pts[1][1]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(110,70,90,0.28)';
  ctx.beginPath();
  ctx.moveTo(pts[1][0], pts[1][1]);
  ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.lineTo(pts[3][0], pts[3][1]);
  ctx.stroke();
  // A few pits and veins.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = r() > 0.5 ? 'rgba(120,80,70,0.12)' : 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(x + 0.1 + r() * (w - 0.2), y + 0.1 + r() * (h - 0.2), 0.012 + r() * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }
}

function mortar(ctx: Ctx, c: number, r: number, color: number): void {
  ctx.fillStyle = hex(color);
  ctx.fillRect(c, r, 1, 1);
}



function paintHallTiles(ctx: Ctx, c: number, r: number, rand: () => number): void {
  mortar(ctx, c, r, 0xd2ad84);
  const dark = (c + r) % 2 === 0;
  stone(ctx, c, r, 1, 1, dark ? 0xe6c79c : FLOOR.hall, rand);
  // A thin inlaid border on alternate tiles, like a hall floor.
  if (dark) {
    ctx.strokeStyle = 'rgba(169,131,255,0.28)';
    ctx.lineWidth = 0.03;
    ctx.strokeRect(c + 0.18, r + 0.18, 0.64, 0.64);
  }
}

function paintGrass(ctx: Ctx, c: number, r: number, rand: () => number): void {
  ctx.fillStyle = hex(FLOOR.grass);
  ctx.fillRect(c - 0.02, r - 0.02, 1.04, 1.04);
  for (let i = 0; i < 90; i++) {
    const x = c + rand();
    const y = r + rand();
    const light = rand();
    ctx.strokeStyle = light > 0.6 ? 'rgba(214,236,140,0.7)' : light > 0.3 ? 'rgba(120,160,70,0.6)' : 'rgba(80,120,60,0.5)';
    ctx.lineWidth = 0.018;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 0.03 - rand() * 0.04, y - 0.05 - rand() * 0.06);
    ctx.stroke();
  }
  // Tiny flowers.
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = ['#fff1c9', '#ffb3c7', '#ffd27a'][i % 3] ?? '#fff';
    ctx.beginPath();
    ctx.arc(c + 0.1 + rand() * 0.8, r + 0.1 + rand() * 0.8, 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function paintPlanks(ctx: Ctx, c: number, r: number, rand: () => number, overWater: boolean): void {
  // Gaps between boards show water or the sky below.
  ctx.fillStyle = overWater ? 'rgba(40,90,120,1)' : 'rgba(90,60,50,1)';
  ctx.fillRect(c, r, 1, 1);
  const boards = 4;
  for (let i = 0; i < boards; i++) {
    const x = c + i / boards + 0.012;
    const w = 1 / boards - 0.024;
    const color = jitter(FLOOR.plank, rand, 0.16);
    const grad = ctx.createLinearGradient(x, r, x + w, r);
    grad.addColorStop(0, hex(color));
    grad.addColorStop(1, hex(jitter(color, rand, 0.12)));
    ctx.fillStyle = grad;
    ctx.fillRect(x, r + 0.01, w, 0.98);
    // Wood grain.
    ctx.strokeStyle = 'rgba(110,64,40,0.35)';
    ctx.lineWidth = 0.008;
    for (let k = 0; k < 3; k++) {
      const gx = x + (0.2 + k * 0.3) * w + (rand() - 0.5) * 0.02;
      ctx.beginPath();
      ctx.moveTo(gx, r + 0.02);
      ctx.bezierCurveTo(gx + 0.02, r + 0.3, gx - 0.02, r + 0.6, gx + 0.01, r + 0.98);
      ctx.stroke();
    }
    // Nails at the ends.
    ctx.fillStyle = 'rgba(70,50,50,0.7)';
    for (const ny of [0.08, 0.92]) {
      ctx.beginPath();
      ctx.arc(x + w / 2, r + ny, 0.012, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function paintWater(ctx: Ctx, c: number, r: number, rand: () => number, at: (c: number, r: number) => string): void {
  // Deeper in the middle of the channel, lighter over the shallows by the banks.
  const edge = at(c - 1, r) !== '~' || at(c + 1, r) !== '~';
  const grad = ctx.createLinearGradient(c, r, c + 1, r);
  const deep = 0x2f7fb0;
  const shallow = 0x5fb6d6;
  grad.addColorStop(0, hex(at(c - 1, r) === '~' ? deep : shallow));
  grad.addColorStop(0.5, hex(deep));
  grad.addColorStop(1, hex(at(c + 1, r) === '~' ? deep : shallow));
  ctx.fillStyle = grad;
  ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
  // Ripples.
  ctx.strokeStyle = 'rgba(210,240,255,0.45)';
  ctx.lineWidth = 0.02;
  for (let i = 0; i < 5; i++) {
    const y = r + 0.1 + rand() * 0.8;
    const x = c + rand() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 0.12, y - 0.04, x + 0.25 + rand() * 0.2, y);
    ctx.stroke();
  }
  if (edge) {
    // Foam along the banks.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 12; i++) {
      const left = at(c - 1, r) !== '~';
      const x = left ? c + rand() * 0.08 : c + 1 - rand() * 0.08;
      ctx.beginPath();
      ctx.arc(x, r + rand(), 0.015 + rand() * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function softPatch(ctx: Ctx, x: number, y: number, radius: number, color: number, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, hex(color, alpha));
  g.addColorStop(1, hex(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// The council seal as a gold inlay with a compass star, drawn in world space so it lies flat.
function paintSeal(ctx: Ctx): void {
  const cx = 15;
  const cy = 15;
  ctx.save();
  softPatch(ctx, cx, cy, 3.4, 0xffe3a0, 0.35);
  for (const [radius, width, alpha] of [
    [3.0, 0.09, 0.85],
    [2.75, 0.03, 0.6],
    [2.2, 0.05, 0.5],
    [1.1, 0.12, 0.9],
  ] as const) {
    ctx.strokeStyle = `rgba(214,160,60,${String(alpha)})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Highlight on the sunlit side of the outer ring.
  ctx.strokeStyle = 'rgba(255,240,190,0.7)';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.03, Math.PI * 0.6, Math.PI * 1.3);
  ctx.stroke();
  // An eight-point star in the centre.
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const long = i % 2 === 0 ? 1.0 : 0.62;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(232,180,80,0.9)' : 'rgba(169,131,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - 0.2) * 0.3, cy + Math.sin(a - 0.2) * 0.3);
    ctx.lineTo(cx + Math.cos(a) * long, cy + Math.sin(a) * long);
    ctx.lineTo(cx + Math.cos(a + 0.2) * 0.3, cy + Math.sin(a + 0.2) * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  // Seat marks: small gold diamonds on the ring.
  for (const s of SPAWN_POINTS) {
    ctx.fillStyle = 'rgba(240,190,90,0.95)';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 0.12);
    ctx.lineTo(s.x + 0.12, s.y);
    ctx.lineTo(s.x, s.y + 0.12);
    ctx.lineTo(s.x - 0.12, s.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Long soft shadows of everything that stands up, swept away from the low sun.
function paintShadows(ctx: Ctx, map: CitadelMap, at: (c: number, r: number) => string, scale: number): void {
  const layer = document.createElement('canvas');
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  const s = layer.getContext('2d');
  if (s === null) return;
  s.setTransform(ctx.getTransform());
  s.fillStyle = hex(SHADOW_COLOR, 1);
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = at(c, r);
      const h = PROP_HEIGHT[t];
      const foot = PROP_FOOT[t];
      if (h === undefined || foot === undefined) continue;
      const len = (h / 64) * 0.75;
      const cx = c + 0.5;
      const cy = r + 0.5;
      const dx = SHADOW_DIR.x * len;
      const dy = SHADOW_DIR.y * len;
      s.beginPath();
      if (t === 'T') {
        // A round canopy shadow, offset along the sun's direction.
        s.ellipse(cx + dx * 0.85, cy + dy * 0.85, 0.75, 0.6, 0, 0, Math.PI * 2);
        s.rect(cx - 0.05, cy - 0.05, dx * 0.7, 0.1);
      } else {
        s.moveTo(cx - foot, cy - foot);
        s.lineTo(cx + foot + dx, cy - foot + dy);
        s.lineTo(cx + foot + dx, cy + foot + dy);
        s.lineTo(cx - foot, cy + foot);
      }
      s.fill();
    }
  }
  // Extra length for the tall crowns: the vault dome and the watchtower spire.
  s.beginPath();
  s.ellipse(10.5, 5.6, 1.8, 2.2, 0, 0, Math.PI * 2);
  s.fill();
  s.beginPath();
  s.moveTo(24, 1);
  s.lineTo(31, 2.4);
  s.lineTo(31, 4.4);
  s.lineTo(24, 5);
  s.fill();
  // Soften: blur where the browser supports canvas filters, otherwise stack offset copies.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.36;
  const blur = Math.max(2, Math.round(10 * scale));
  // Safari before 18 ignores ctx.filter; reading it back tells whether it took.
  ctx.filter = `blur(${String(blur)}px)`;
  if (ctx.filter.startsWith('blur')) {
    ctx.drawImage(layer, 0, 0);
    ctx.filter = 'none';
  } else {
    ctx.globalAlpha = 0.06;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) ctx.drawImage(layer, i * blur * 0.4, j * blur * 0.4);
  }
  ctx.restore();
}

// Contact shadow where floor meets walls, posts and the island edge.
function paintOcclusion(ctx: Ctx, map: CitadelMap, at: (c: number, r: number) => string, solid: (t: string) => boolean): void {
  const strip = (x0: number, y0: number, x1: number, y1: number, w: number, h: number): void => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, hex(SHADOW_COLOR, 0.32));
    g.addColorStop(1, hex(SHADOW_COLOR, 0));
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), w, h);
  };
  const d = 0.32;
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = at(c, r);
      if (t !== '.' && t !== '=') continue;
      if (at(c, r - 1) === 'B') strip(c, r, c, r + d, 1, d);
      if (at(c - 1, r) === 'B') strip(c, r, c + d, r, d, 1);
      if (at(c, r + 1) === 'B') strip(c, r + 1, c, r + 1 - d, 1, d);
      if (at(c + 1, r) === 'B') strip(c + 1, r, c + 1 - d, r, d, 1);
      for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const n = at(c + dc, r + dr);
        if (solid(n) && n !== 'B') softPatch(ctx, c + 0.5 + dc * 0.5, r + 0.5 + dr * 0.5, 0.35, SHADOW_COLOR, 0.22);
      }
    }
  }
}

// Fine grit and a few worn patches, so no surface reads as flat colour.
export function paintGrit(ctx: Ctx, map: CitadelMap, at: (c: number, r: number) => string): void {
  const rand = rng(424242);
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = at(c, r);
      if (t === '#' || t === '~') continue;
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(90,60,70,0.1)';
        ctx.fillRect(c + rand(), r + rand(), 0.012, 0.012);
      }
      if (rand() < 0.08) softPatch(ctx, c + rand(), r + rand(), 0.4 + rand() * 0.5, 0x9a7a5a, 0.1);
      if (rand() < 0.04 && t === '.') softPatch(ctx, c + rand(), r + rand(), 0.3, 0x8aa34e, 0.16);
    }
  }
}

// A thin sunlit lip along the island's top edges.
export function paintRim(ctx: Ctx, map: CitadelMap, at: (c: number, r: number) => string): void {
  ctx.strokeStyle = 'rgba(255,236,196,0.8)';
  ctx.lineWidth = 0.035;
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      if (at(c, r) === '#') continue;
      ctx.beginPath();
      if (at(c, r + 1) === '#') {
        ctx.moveTo(c, r + 1);
        ctx.lineTo(c + 1, r + 1);
      }
      if (at(c + 1, r) === '#') {
        ctx.moveTo(c + 1, r);
        ctx.lineTo(c + 1, r + 1);
      }
      ctx.stroke();
    }
  }
}

// Depth of the hanging rock at screen x: a few octaves of smooth waves, always at least the face depth.
function underside(x: number, dz: number): number {
  const n = 0.55 * Math.sin(x / 61 + 0.7) + 0.35 * Math.sin(x / 23 + 2.1) + 0.18 * Math.sin(x / 9.7 + 4.2);
  return dz * (1.15 + 0.9 * Math.max(0, n));
}

// Rock faces under the open edges: warm strata that fade into violet shadow, in screen space.
export function paintCliffs(ctx: Ctx, map: CitadelMap, at: (c: number, r: number) => string): void {
  const P = (x: number, y: number, z = 0): [number, number] => [(x - y) * (TILE_W / 2), (x + y) * (TILE_H / 2) - z * ART_SCALE];
  const rand = rng(99);
  const face = (a: [number, number], b: [number, number], depth: number, lit: boolean): void => {
    const [ax, ay] = a;
    const [bx, by] = b;
    const dz = depth * ART_SCALE;
    // The underside follows one smooth noise curve along screen x, so neighbouring faces join into hanging rock.
    const steps = 8;
    const grad = ctx.createLinearGradient(0, Math.min(ay, by), 0, Math.max(ay, by) + dz * 2.4);
    grad.addColorStop(0, lit ? '#e0aa82' : '#a87482');
    grad.addColorStop(0.25, lit ? '#bf8470' : '#87587a');
    grad.addColorStop(0.6, lit ? '#8e5e72' : '#634070');
    grad.addColorStop(1, 'rgba(78,52,102,0.15)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      ctx.lineTo(x, y + underside(x, dz));
    }
    ctx.closePath();
    ctx.fill();
    // Strata: thin warm and cool bands following the edge.
    for (let k = 1; k < 6; k++) {
      const off = (k / 6) * dz;
      ctx.strokeStyle = k % 2 === 0 ? (lit ? 'rgba(255,224,190,0.22)' : 'rgba(255,210,230,0.12)') : 'rgba(40,20,50,0.18)';
      ctx.lineWidth = 1 + rand() * 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay + off + (rand() - 0.5) * 3);
      ctx.lineTo(bx, by + off + (rand() - 0.5) * 3);
      ctx.stroke();
    }
    // Cracks.
    ctx.strokeStyle = 'rgba(50,25,55,0.3)';
    ctx.lineWidth = 1.2;
    const cx0 = ax + (bx - ax) * rand();
    const cy0 = ay + (by - ay) * ((cx0 - ax) / (bx - ax || 1)) + 6;
    ctx.beginPath();
    ctx.moveTo(cx0, cy0);
    ctx.lineTo(cx0 + (rand() - 0.5) * 10, cy0 + dz * 0.4);
    ctx.lineTo(cx0 + (rand() - 0.5) * 14, cy0 + dz * 0.75);
    ctx.stroke();
    // Hanging roots and moss along the lip.
    for (let k = 0; k < 3; k++) {
      const t = rand();
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      ctx.strokeStyle = k === 0 ? 'rgba(96,130,64,0.75)' : 'rgba(126,160,80,0.55)';
      ctx.lineWidth = 1.5 + rand() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 4, y + 12, x - 2, y + 16 + rand() * 26);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(126,160,80,0.6)';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx, by + 5);
    ctx.lineTo(ax, ay + 5);
    ctx.fill();
  };
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = at(c, r);
      if (t === '#') continue;
      const depth = t === '=' && c >= 27 ? 14 : 64;
      if (at(c, r + 1) === '#') face(P(c, r + 1), P(c + 1, r + 1), depth, true);
      if (at(c + 1, r) === '#') face(P(c + 1, r + 1), P(c + 1, r), depth, false);
    }
  }
  // Dock posts under the pier.
  for (let r = 0; r < map.height; r++) {
    for (let c = 27; c < map.width; c++) {
      if (at(c, r) !== '=' || at(c, r + 1) === '=') continue;
      for (const x of [c + 0.15, c + 0.85]) {
        const [px, py] = P(x, r + 1);
        ctx.fillStyle = '#7a5040';
        ctx.fillRect(px - 3, py, 6, 46 * ART_SCALE * 0.6);
      }
    }
  }
}
