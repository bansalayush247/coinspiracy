// Walk-in rooms of Port Concord: floors, back walls with windows and decor, knee-high front walls and furniture,
// drawn in room-local tile coordinates and lit from the west like the street outside. The room sits cut open in the
// corner of its building: the back walls rise out of sight and the building's own front runs on round it.
import type Phaser from 'phaser';
import { doorColumn, shopTradeOf, type Furniture, type Piece, type RoomKind, type RoomLayout, type ShopTrade } from '@byzantine-council/shared/city';
import { P, fan, prism } from '../beach/beachArt.js';
import { jitter, rng } from '../game/groundPaint.js';
import { ART_SCALE, TILE_H, TILE_W } from '../game/iso.js';
import { lit, mix, shade } from '../game/palette.js';

type G = Phaser.GameObjects.Graphics;
type Side = 'n' | 'w';
type Fr = Side | 'e';
type Facing = 'n' | 's' | 'e' | 'w';
type Trade = ShopTrade | null;
interface Pt {
  readonly x: number;
  readonly y: number;
}

const S = ART_SCALE;
const WALL_H: Readonly<Record<RoomKind, number>> = { shop: 120, mintHall: 136, hospital: 120, flat: 112 };
const WALL_T = 0.2;
const STUB_H = 18;
const STUB_T = 0.24;
const ROUND = 35;
const RX = (TILE_W / 2) * Math.SQRT2;
const RY = (TILE_H / 2) * Math.SQRT2;
const FACE = 0.004;
const SHADOW = 0x24183c;
const SUN = 0xfff0c8;
const WARM = 0xffd890;
const WHITE = 0xffffff;
const BRASS = 0xd9a440;
const GOLD = 0xe8b84a;
const SKY = { top: 0x8fb4d6, mid: 0xc8d4de, low: 0xffd3a0, roofs: 0x8a7a9a } as const;
const GOODS = [0xe0574b, 0x3fa7b5, 0xffc860, 0x7fc86a, 0xf2e6d0, 0xa983ff, 0xff8a5c, 0x5a8fd6] as const;
const BOOKS = [0x8a2f3a, 0x2f5a7a, 0x3f6a3a, 0xc8a050, 0x5a3a6a, 0xd9cbb0, 0x2a2a3a, 0xa8603a, 0x3f8a8a] as const;
const NOTES = [0xfff4c8, 0xffe27a, 0xffc8c8, 0xc8e4ff, 0xf4f4ec] as const;
const FABRIC = [0x3f7f86, 0xc89a3a, 0xb86a6a, 0x6a6aa8, 0x5f8a5a] as const;
const BLANKETS = [0x5f86b8, 0xc8605a, 0x6aa07a, 0xd9a54a, 0x8a6aa8] as const;
const LEAVES = [
  { dark: 0x2f6a3e, mid: 0x4b8a4e, light: 0x79b866, glint: 0xb8dc8a },
  { dark: 0x2a5e48, mid: 0x3f8060, light: 0x6aaa7a, glint: 0xa8d4a0 },
] as const;
const CHROME = 0xc8ccd4;
const NIGHT = 0x0b0807;
const SUITS = [0x2f3a4a, 0x4a4e5a, 0x6a5040, 0xe8e2d4, 0x8a2f3a, 0x3f5a7a, 0xc8b89a, 0x2a2a30, 0x5f7a5a, 0xd9cbb0] as const;
const SURFWEAR = [0x1e2228, 0xff8a5c, 0x3fa7b5, 0xffc860, 0xe0574b, 0x7fc86a, 0xf2e6d0, 0x5a8fd6, 0x1e2228] as const;
const BOARDS = [0xf2e6d0, 0x3fa7b5, 0xff8a5c, 0xffc860, 0xe0574b, 0x7fc86a, 0x5a8fd6, 0xf4f0e4, 0xa983ff] as const;
const HATS = [0x3a3036, 0x6a4a34, 0xe8d49a, 0x2f3a4a, 0x8a2f3a, 0xc8a070, 0x4a5e48, 0xf2ece0] as const;
const LEATHER = [0xb8323a, 0x2f8a86] as const;
const CLOTH: readonly number[] = [...FABRIC, ...SUITS];

const DADO_Z = 40;
const PANEL_Z = 56;
const SKIRT_H = 8;
const BRICK_L = 0.4;
const BRICK_H = 9;
const STONE_L = 0.8;
const STONE_H = 20;
const PLINTH_H = 14;
const CORNICE_H = 12;
const BOARD = 0.25;
const FLOOR_TILE = 0.5;
const MARBLE_BORDER = 0.42;

const COUNTER_H = 32;
const SHELF_H = 82;
const BOOKCASE_H = 92;
const TABLE_H = 25;
const SEAT_H = 14;
const CHAIR_BACK = 40;
const BED_H = 12;
const HEADBOARD_H = 48;
const SOFA_SEAT = 10;
const SOFA_BACK = 38;
const BENCH_H = 15;
const DESK_H = 30;
const LAMP_H = 62;
const POT_H = 18;
const VAULT_R = 1.12;
const COLUMN_R = 0.27;
const RACK_H = 60;
const MIRROR_H = 84;
const CASE_BASE = 18;
const CASE_H = 35;
const BARBER_SEAT = 16;
const HATSTAND_H = 66;
const KITCHEN_H = 30;
const UPPER_Z = 58;
const UPPER_H = 26;
const FRIDGE_H = 88;
const WARDROBE_H = 94;
const TV_UNIT_H = 15;

const WALL_TOP = 470;
const FADE_FROM = 10;
const DROP = 160;
const REACH = 6;
const BANDS = 18;

const TALL: ReadonlySet<Piece> = new Set(['shelf', 'bookcase', 'vaultDoor', 'noticeBoard', 'rack', 'mirror', 'hatStand', 'boardRack', 'kitchen', 'wardrobe', 'tv']);

const pick = (list: readonly number[], rand: () => number): number => list[Math.floor(rand() * list.length)] ?? list[0] ?? 0;
const quad = (x0: number, y0: number, x1: number, y1: number, z = 0): Pt[] => [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)];
const fp = (fr: Fr, a: number, b: number, z = 0): Pt => (fr === 'n' ? P(a, b, z) : fr === 'w' ? P(b, a, z) : P(-b, a, z));
const xy = (fr: Fr, a: number, b: number): readonly [number, number] => (fr === 'n' ? [a, b] : fr === 'w' ? [b, a] : [-b, a]);
const tone = (side: Fr, col: number, k = 0.38): number => (side === 'n' ? lit(col, 0.05) : shade(col, k));
const onWall = (side: Side, col: number): number => tone(side, col, 0.24);
const acrossTone = (fr: Fr, col: number): number => (fr === 'n' ? shade(col, 0.16) : lit(col, 0.04));

function line(g: G, a: Pt, b: Pt, width: number, col: number, alpha = 1): void {
  g.lineStyle(width, col, alpha);
  g.lineBetween(a.x, a.y, b.x, b.y);
}

// An axis-aligned box in a piece's frame: a runs along the piece, b runs back (wall side) to front.
function box(g: G, fr: Fr, a0: number, b0: number, a1: number, b1: number, z0: number, h: number, col: number, top?: number): void {
  if (fr === 'n') prism(g, a0, b0, a1, b1, z0, h, col, top);
  else if (fr === 'w') prism(g, b0, a0, b1, a1, z0, h, col, top);
  else prism(g, -b1, a0, -b0, a1, z0, h, col, top);
}

// A rectangle on a vertical plane facing a piece's front: +r ('n'), +c ('w'); a front turned from the eye ('e') is hidden.
function plate(g: G, side: Fr, plane: number, u0: number, u1: number, z0: number, z1: number, col: number, alpha = 1): void {
  if (side === 'e') return;
  fan(g, col, [fp(side, u0, plane, z0), fp(side, u1, plane, z0), fp(side, u1, plane, z1), fp(side, u0, plane, z1)], alpha);
}

function poly(g: G, side: Fr, plane: number, pts: readonly (readonly [number, number])[], col: number, alpha = 1): void {
  if (side === 'e') return;
  fan(g, col, pts.map(([u, z]) => fp(side, u, plane, z)), alpha);
}

// A shape on the plane across a piece at `a`, given as (b, z) points; that side faces the eye in every frame.
function across(g: G, fr: Fr, a: number, pts: readonly (readonly [number, number])[], col: number, alpha = 1): void {
  fan(g, col, pts.map(([b, z]) => fp(fr, a, b, z)), alpha);
}

// A circle drawn on a vertical plane, u in tiles and z in art px, round to the eye.
function ring(side: Fr, plane: number, uc: number, zc: number, ru: number, n = 24, from = 0, to = Math.PI * 2, closed = true): Pt[] {
  const rz = ru * ROUND;
  const out: Pt[] = [];
  const steps = closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const t = from + ((to - from) * i) / steps;
    out.push(fp(side, uc + Math.cos(t) * ru, plane, zc + Math.sin(t) * rz));
  }
  return out;
}

function strokeRing(g: G, pts: readonly Pt[], width: number, col: number, alpha = 1): void {
  const [a] = pts;
  if (a === undefined) return;
  g.lineStyle(width, col, alpha);
  g.beginPath();
  g.moveTo(a.x, a.y);
  for (const p of pts) g.lineTo(p.x, p.y);
  g.closePath();
  g.strokePath();
}

// A standing cylinder or cone, shaded strip by strip from the lit west side to the shaded east side.
function tube(g: G, x: number, y: number, r0: number, r1: number, z0: number, h: number, col: number, top: number | null = lit(col, 0.3), strips = 8, flutes = false): void {
  const base = P(x, y, z0);
  const lift = h * S;
  for (let i = 0; i < strips; i++) {
    const u0 = -1 + (2 * i) / strips;
    const u1 = -1 + (2 * (i + 1)) / strips;
    const t = (u0 + u1 + 2) / 4;
    let col_i = t < 0.3 ? mix(lit(col, 0.2), col, t / 0.3) : mix(col, shade(col, 0.45), (t - 0.3) / 0.7);
    if (flutes && i % 2 === 1) col_i = shade(col_i, 0.1);
    const d0 = Math.sqrt(Math.max(0, 1 - u0 * u0));
    const d1 = Math.sqrt(Math.max(0, 1 - u1 * u1));
    fan(g, col_i, [
      { x: base.x + u0 * r0 * RX, y: base.y + d0 * r0 * RY },
      { x: base.x + u1 * r0 * RX, y: base.y + d1 * r0 * RY },
      { x: base.x + u1 * r1 * RX, y: base.y - lift + d1 * r1 * RY },
      { x: base.x + u0 * r1 * RX, y: base.y - lift + d0 * r1 * RY },
    ]);
  }
  if (top !== null) {
    g.fillStyle(top, 1);
    g.fillEllipse(base.x, base.y - lift, 2 * r1 * RX, 2 * r1 * RY, 20);
  }
}

function floorEllipse(g: G, x: number, y: number, r: number, col: number, alpha: number, z = 0): void {
  const c = P(x, y, z);
  g.fillStyle(col, alpha);
  g.fillEllipse(c.x, c.y, 2 * r * RX, 2 * r * RY, 24);
}

// A soft contact shadow under a footprint, leaning toward +c away from the west light.
function contact(g: G, x0: number, y0: number, x1: number, y1: number, alpha = 0.2): void {
  fan(g, SHADOW, [P(x0 + 0.04, y0 + 0.06), P(x1 + 0.2, y0 + 0.06), P(x1 + 0.2, y1), P(x0 + 0.04, y1)], alpha * 0.5);
  fan(g, SHADOW, quad(x0, y0, x1, y1), alpha);
}

// The wall a piece's back is against: 'n' (it faces south), 'w' (faces east) or 'e' (faces west); out on the floor it faces south, or east if it runs north–south.
function frameOf(f: Furniture, layout: RoomLayout): Fr {
  const east = f.c !== 1 && f.c + f.w === layout.w - 1;
  if (f.w > f.d) return 'n';
  if (f.d > f.w) return east ? 'e' : 'w';
  if (f.r === 1) return 'n';
  if (f.c === 1) return 'w';
  return east ? 'e' : 'n';
}
const span = (f: Furniture, fr: Fr): { a0: number; a1: number; b0: number; b1: number } =>
  fr === 'n'
    ? { a0: f.c, a1: f.c + f.w, b0: f.r, b1: f.r + f.d }
    : fr === 'w'
      ? { a0: f.r, a1: f.r + f.d, b0: f.c, b1: f.c + f.w }
      : { a0: f.r, a1: f.r + f.d, b0: -(f.c + f.w), b1: -f.c };
const pieceRand = (f: Furniture, seed: number): (() => number) => rng((seed * 7919 + f.c * 131 + f.r * 977 + f.piece.charCodeAt(0) * 31 + f.piece.length) >>> 0);

// ---------- Floors ----------

function floorPlanks(g: G, x1: number, y1: number, base: number, rand: () => number): void {
  fan(g, shade(base, 0.4), quad(1, 1, x1, y1));
  for (let y = 1; y < y1 - 0.001; y += BOARD) {
    const yb = Math.min(y1, y + BOARD);
    let x = 1 - rand() * 1.6;
    while (x < x1) {
      const len = 1.1 + rand() * 1.9;
      const a = Math.max(1, x);
      const b = Math.min(x1, x + len);
      if (b - a > 0.05) {
        const col = jitter(base, rand, 0.18);
        fan(g, col, quad(a + 0.01, y + 0.012, b - 0.01, yb - 0.012));
        fan(g, lit(col, 0.3), quad(a + 0.01, yb - 0.05, b - 0.01, yb - 0.012), 0.35);
        for (let k = 0; k < 2; k++) {
          const gy = y + BOARD * (0.25 + 0.5 * rand());
          line(g, P(a + 0.08 + rand() * 0.3, gy), P(b - 0.08 - rand() * 0.3, gy + (rand() - 0.5) * 0.04), 1, shade(col, 0.35), 0.28);
        }
        if (rand() < 0.14) {
          const k = P(a + (b - a) * (0.2 + 0.6 * rand()), y + BOARD / 2);
          g.fillStyle(shade(col, 0.4), 0.55);
          g.fillEllipse(k.x, k.y, 9, 4);
        }
      }
      x += len;
    }
  }
}

function floorTiles(g: G, x1: number, y1: number, pal: readonly [number, number], grout: number, rand: () => number): void {
  fan(g, grout, quad(1, 1, x1, y1));
  for (let j = 0; 1 + j * FLOOR_TILE < y1 - 0.01; j++) {
    for (let i = 0; 1 + i * FLOOR_TILE < x1 - 0.01; i++) {
      const x = 1 + i * FLOOR_TILE;
      const y = 1 + j * FLOOR_TILE;
      const col = jitter(pal[(i + j) % 2] ?? pal[0], rand, 0.05);
      const xe = Math.min(x1, x + FLOOR_TILE) - 0.02;
      const ye = Math.min(y1, y + FLOOR_TILE) - 0.02;
      fan(g, col, quad(x + 0.02, y + 0.02, xe, ye));
      fan(g, WHITE, [P(x + 0.04, y + 0.04), P(x + FLOOR_TILE * 0.62, y + 0.04), P(x + 0.04, y + FLOOR_TILE * 0.62)], 0.1);
      fan(g, SHADOW, [P(xe, y + 0.06), P(xe, ye), P(x + 0.06, ye)], 0.05);
    }
  }
}

function floorMarble(g: G, x1: number, y1: number, rand: () => number): void {
  const B = MARBLE_BORDER;
  fan(g, 0x4a5e58, quad(1, 1, x1, y1));
  for (let x = 1; x < x1 - 0.01; x += 1) fan(g, 0x3e504b, quad(x, 1, x + 0.02, 1 + B));
  fan(g, GOLD, quad(1 + B - 0.06, 1 + B - 0.06, x1 - B + 0.06, y1 - B + 0.06));
  fan(g, 0xb8ae9e, quad(1 + B, 1 + B, x1 - B, y1 - B));
  for (let j = 0; 1 + B + j < y1 - B - 0.01; j++) {
    for (let i = 0; 1 + B + i < x1 - B - 0.01; i++) {
      const x = 1 + B + i;
      const y = 1 + B + j;
      const xe = Math.min(x1 - B, x + 1) - 0.012;
      const ye = Math.min(y1 - B, y + 1) - 0.012;
      const col = jitter((i + j) % 2 === 0 ? 0xf2ebdf : 0xdcd4c8, rand, 0.03);
      fan(g, col, quad(x + 0.012, y + 0.012, xe, ye));
      if (rand() < 0.75) {
        let px = x + rand() * (xe - x);
        let py = y + 0.05;
        g.lineStyle(1.3, shade(col, 0.35), 0.3);
        g.beginPath();
        const s0 = P(px, py, 0);
        g.moveTo(s0.x, s0.y);
        for (let k = 0; k < 5; k++) {
          px = Math.min(xe - 0.03, Math.max(x + 0.03, px + (rand() - 0.5) * 0.4));
          py = Math.min(ye - 0.02, py + 0.18 + rand() * 0.06);
          const p = P(px, py, 0);
          g.lineTo(p.x, p.y);
        }
        g.strokePath();
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    const x = 1.5 + rand() * (x1 - 3);
    const w = 0.25 + rand() * 0.3;
    fan(g, WHITE, [P(x, 1 + B), P(x + w, 1 + B), P(x + w + 1.6, y1 - B), P(x + 1.6, y1 - B)], 0.05);
  }
}

function floorCarpet(g: G, x1: number, y1: number, base: number, rand: () => number): void {
  fan(g, shade(base, 0.3), quad(1, 1, x1, y1));
  fan(g, lit(base, 0.45), quad(1.28, 1.28, x1 - 0.28, y1 - 0.28));
  fan(g, base, quad(1.34, 1.34, x1 - 0.34, y1 - 0.34));
  const area = (x1 - 1) * (y1 - 1);
  for (let i = 0; i < area * 1.5; i++) floorEllipse(g, 1.4 + rand() * (x1 - 2.8), 1.4 + rand() * (y1 - 2.8), 0.25 + rand() * 0.35, rand() > 0.5 ? WHITE : SHADOW, 0.04);
  for (let y = 1.84; y < y1 - 0.6; y += 1) {
    for (let x = 1.84; x < x1 - 0.6; x += 1) {
      fan(g, lit(base, 0.25), [P(x - 0.14, y), P(x, y - 0.14), P(x + 0.14, y), P(x, y + 0.14)], 0.5);
      fan(g, shade(base, 0.15), [P(x - 0.05, y), P(x, y - 0.05), P(x + 0.05, y), P(x, y + 0.05)], 0.7);
    }
  }
  for (let i = 0; i < area * 14; i++) {
    const x = 1 + rand() * (x1 - 1.03);
    const y = 1 + rand() * (y1 - 1.03);
    fan(g, rand() > 0.5 ? WHITE : SHADOW, quad(x, y, x + 0.025, y + 0.025), 0.14);
  }
}

// ---------- Walls ----------

interface WallLook {
  readonly upper: number;
  readonly lower: number;
  readonly trim: number;
  readonly skirt: number;
  readonly frame: number;
}

function wallLook(layout: RoomLayout, room: RoomKind, rand: () => number): WallLook {
  switch (layout.wall) {
    case 'brick':
      return { upper: 0xb0603f, lower: 0xd8c2a6, trim: 0xf0e2c8, skirt: 0x5a3a2a, frame: 0xf4ecdc };
    case 'panel':
      return rand() < 0.5
        ? { upper: 0xd9c7a0, lower: 0x8a5a3a, trim: 0x9a6a46, skirt: 0x5e3c28, frame: 0x6e4a34 }
        : { upper: 0xb8c4a2, lower: 0x7a5034, trim: 0x8a5e40, skirt: 0x553624, frame: 0x6e4a34 };
    case 'stone':
      return { upper: 0xdacdb4, lower: 0xb4a68e, trim: 0xece2cc, skirt: 0x9a8a72, frame: 0xe9dfcc };
    default:
      if (room === 'hospital') return { upper: 0xeef3ee, lower: 0x8fc7bd, trim: 0xfafcfa, skirt: 0xf4f6f4, frame: 0xf6f8f6 };
      if (room === 'flat') return rand() < 0.5
        ? { upper: 0xf2e6d4, lower: 0x8ea2bd, trim: 0xfaf4e8, skirt: 0xfaf4e8, frame: 0xf4ecdc }
        : { upper: 0xf0dfd0, lower: 0xb8848a, trim: 0xfaf4e8, skirt: 0xfaf4e8, frame: 0xf4ecdc };
      return rand() < 0.5
        ? { upper: 0xf1e3c8, lower: 0xc77f5a, trim: 0xfaf4e8, skirt: 0x6e4a34, frame: 0xf4ecdc }
        : { upper: 0xf3e9c9, lower: 0x6f9a8a, trim: 0xfaf4e8, skirt: 0x5e4a3a, frame: 0xf4ecdc };
  }
}

function plasterWall(g: G, side: Side, u1: number, h: number, look: WallLook, rand: () => number): void {
  const pl = 1 + FACE * 0.25;
  plate(g, side, pl, 1, u1, 0, WALL_TOP, onWall(side, look.upper));
  for (let i = 0; i < 4; i++) {
    const a = 1 + rand() * Math.max(0.1, u1 - 2);
    const z = h + 14 + rand() * 90;
    plate(g, side, pl, a, a + 0.8 + rand() * 1.2, z, z + 16 + rand() * 24, rand() > 0.5 ? WHITE : 0x8a7060, 0.025);
  }
  for (let i = 0; i < 6; i++) {
    const a = 1 + rand() * Math.max(0.1, u1 - 2);
    const z = DADO_Z + 8 + rand() * (h - DADO_Z - 40);
    plate(g, side, pl, a, a + 0.6 + rand() * 0.9, z, z + 10 + rand() * 18, rand() > 0.5 ? WHITE : 0x8a7060, 0.025);
  }
  plate(g, side, pl, 1, u1, 0, DADO_Z, onWall(side, look.lower));
  plate(g, side, pl, 1, u1, DADO_Z - 3, DADO_Z - 1, SHADOW, 0.12);
  plate(g, side, pl, 1, u1, DADO_Z - 1, DADO_Z + 3, onWall(side, look.trim));
  plate(g, side, pl, 1, u1, h - 9, h - 7, SHADOW, 0.1);
  plate(g, side, pl, 1, u1, h - 7, h, onWall(side, look.trim));
}

function bricks(g: G, side: Side, pl: number, u1: number, from: number, to: number, look: WallLook, rand: () => number): void {
  for (let k = 0; from + k * BRICK_H < to; k++) {
    const z0 = from + k * BRICK_H + 0.9;
    const z1 = Math.min(to, from + (k + 1) * BRICK_H) - 0.9;
    for (let u = 1 - (k % 2) * (BRICK_L / 2); u < u1; u += BRICK_L) {
      const a = Math.max(1, u) + 0.014;
      const b = Math.min(u1, u + BRICK_L) - 0.014;
      if (b > a) plate(g, side, pl, a, b, z0, z1, onWall(side, jitter(look.upper, rand, 0.2)));
    }
  }
}

function brickWall(g: G, side: Side, u1: number, h: number, look: WallLook, rand: () => number): void {
  const pl = 1 + FACE * 0.25;
  const top = h - 14;
  plate(g, side, pl, 1, u1, 0, WALL_TOP, onWall(side, look.lower));
  bricks(g, side, pl, u1, 0, top, look, rand);
  bricks(g, side, pl, u1, h, h + 130, look, rand);
  plate(g, side, pl, 1, u1, h + 130, WALL_TOP, onWall(side, shade(look.upper, 0.12)));
  plate(g, side, pl, 1, u1, top, h, onWall(side, look.trim));
  plate(g, side, pl, 1, u1, top, top + 2, SHADOW, 0.12);
  plate(g, side, pl, 1, u1, h - 4, h, onWall(side, lit(look.trim, 0.2)));
}

function panelWall(g: G, side: Side, u1: number, h: number, look: WallLook): void {
  const pl = 1 + FACE * 0.25;
  plate(g, side, pl, 1, u1, PANEL_Z, WALL_TOP, onWall(side, look.upper));
  for (let u = 1.06; u < u1; u += 0.24) plate(g, side, pl, u, Math.min(u1, u + 0.09), PANEL_Z, WALL_TOP, onWall(side, shade(look.upper, 0.12)), 0.55);
  plate(g, side, pl, 1, u1, 0, PANEL_Z, onWall(side, look.lower));
  for (let u = 1.08; u + 0.66 < u1; u += 0.86) {
    plate(g, side, pl, u, u + 0.7, 12, PANEL_Z - 8, onWall(side, shade(look.lower, 0.14)));
    plate(g, side, pl, u, u + 0.7, 12, 13.6, onWall(side, lit(look.lower, 0.3)));
    plate(g, side, pl, u, u + 0.7, PANEL_Z - 9.6, PANEL_Z - 8, onWall(side, shade(look.lower, 0.4)));
  }
  plate(g, side, pl, 1, u1, PANEL_Z - 2, PANEL_Z + 3, onWall(side, lit(look.trim, 0.2)));
  plate(g, side, pl, 1, u1, h - 6, h, onWall(side, look.trim));
}

function stoneWall(g: G, side: Side, u1: number, h: number, look: WallLook, rand: () => number): void {
  const pl = 1 + FACE * 0.25;
  plate(g, side, pl, 1, u1, 0, WALL_TOP, onWall(side, look.lower));
  const blocks = (from: number, to: number): void => {
    for (let k = 0; from + k * STONE_H < to; k++) {
      const z0 = from + k * STONE_H + 1;
      const z1 = Math.min(to, from + (k + 1) * STONE_H) - 1;
      for (let u = 1 - (k % 2) * (STONE_L / 2); u < u1; u += STONE_L) {
        const a = Math.max(1, u) + 0.016;
        const b = Math.min(u1, u + STONE_L) - 0.016;
        if (b <= a) continue;
        const col = jitter(look.upper, rand, 0.08);
        plate(g, side, pl, a, b, z0, z1, onWall(side, col));
        plate(g, side, pl, a, b, z1 - 2.4, z1, onWall(side, lit(col, 0.35)), 0.7);
      }
    }
  };
  blocks(PLINTH_H, h - CORNICE_H);
  blocks(h, h + 160);
  plate(g, side, pl, 1, u1, 0, PLINTH_H, onWall(side, shade(look.lower, 0.1)));
  plate(g, side, pl, 1, u1, PLINTH_H - 2, PLINTH_H, onWall(side, lit(look.trim, 0.1)));
  plate(g, side, pl, 1, u1, h - CORNICE_H, h, onWall(side, look.trim));
  plate(g, side, pl, 1, u1, h - CORNICE_H - 2, h - CORNICE_H, SHADOW, 0.18);
  plate(g, side, pl, 1, u1, h - 4, h, onWall(side, lit(look.trim, 0.25)));
}

function skirting(g: G, side: Side, u1: number, look: WallLook): void {
  const pl = 1 + FACE * 0.5;
  plate(g, side, pl, 1, u1, 0, SKIRT_H, onWall(side, look.skirt));
  plate(g, side, pl, 1, u1, SKIRT_H - 1.6, SKIRT_H, onWall(side, lit(look.skirt, 0.35)));
}

// ---------- Wall decor ----------

type DecorKind = 'window' | 'arch' | 'curtains' | 'picture' | 'cross' | 'clock';
interface Decor {
  readonly kind: DecorKind;
  readonly side: Side;
  readonly u: number;
}

// The wall tiles with nothing tall standing in front of them.
function freeSlots(layout: RoomLayout, side: Side): number[] {
  const n = side === 'n' ? layout.w - 1 : layout.d - 1;
  const out: number[] = [];
  for (let u = 1; u < n; u++) {
    const c = side === 'n' ? u : 1;
    const r = side === 'n' ? 1 : u;
    if (!layout.furniture.some((f) => TALL.has(f.piece) && c >= f.c && c < f.c + f.w && r >= f.r && r < f.r + f.d)) out.push(u);
  }
  return out;
}

function claim(list: number[], u: number): void {
  for (let i = list.length - 1; i >= 0; i--) if (Math.abs((list[i] ?? 0) - u) <= 1) list.splice(i, 1);
}

function take(list: number[], rand: () => number): number | null {
  if (list.length === 0) return null;
  const u = list[Math.floor(rand() * list.length)] ?? null;
  if (u !== null) claim(list, u);
  return u;
}

// Where each window, picture, plaque and clock goes on the two back walls, picked from the seed.
function planWalls(layout: RoomLayout, room: RoomKind, seed: number): Decor[] {
  const rand = rng((seed * 2654435 + 97) >>> 0);
  const north = freeSlots(layout, 'n');
  const west = freeSlots(layout, 'w');
  const out: Decor[] = [];
  const put = (kind: DecorKind, side: Side, list: number[]): void => {
    const u = take(list, rand);
    if (u !== null) out.push({ kind, side, u });
  };
  const vault = layout.furniture.find((f) => f.piece === 'vaultDoor');
  if (vault !== undefined) for (const u of [vault.c - 1, vault.c + vault.w]) north.splice(north.indexOf(u), north.includes(u) ? 1 : 0);
  if (room === 'hospital') {
    put('cross', 'n', north);
    put('clock', 'n', north);
  }
  if (room === 'flat') {
    put('curtains', west.length > 0 ? 'w' : 'n', west.length > 0 ? west : north);
    put('picture', 'n', north);
    if (rand() < 0.7) put('picture', 'n', north);
  }
  const kind: DecorKind = room === 'mintHall' ? 'arch' : 'window';
  const spaced = (side: Side, list: number[], max: number): void => {
    const phase = rand() < 0.5 ? 0 : 1;
    let placed = 0;
    for (const u of [...list]) {
      if (placed >= max || !list.includes(u) || (u + phase) % 2 !== 0) continue;
      out.push({ kind, side, u });
      claim(list, u);
      placed++;
    }
  };
  spaced('w', west, room === 'flat' ? 1 : 3);
  spaced('n', north, room === 'mintHall' ? 4 : room === 'flat' ? 0 : 2);
  return out;
}

function windowOutline(u0: number, u1: number, z0: number, z1: number, arch: boolean): [number, number][] {
  if (!arch) return [[u0, z0], [u1, z0], [u1, z1], [u0, z1]];
  const ru = (u1 - u0) / 2;
  const rz = ru * ROUND;
  const pts: [number, number][] = [[u0, z0], [u1, z0]];
  for (let i = 0; i <= 10; i++) {
    const t = (Math.PI * i) / 10;
    pts.push([(u0 + u1) / 2 + Math.cos(t) * ru, z1 - rz + Math.sin(t) * rz]);
  }
  return pts;
}

function drawWindow(g: G, d: Decor, h: number, look: WallLook, rand: () => number): void {
  const { side } = d;
  const arch = d.kind === 'arch';
  const pl = 1 + FACE;
  const u0 = d.u + (arch ? 0.18 : 0.2);
  const u1 = d.u + (arch ? 0.82 : 0.8);
  const z0 = arch ? 30 : 42;
  const z1 = h - (arch ? 30 : 26);
  const glass = (col: number): number => (side === 'n' ? mix(col, 0x6a6a9a, 0.12) : mix(col, SUN, 0.12));
  if (d.kind === 'curtains') {
    plate(g, side, pl, u0 - 0.2, u1 + 0.2, z1 + 4, z1 + 12, SHADOW, 0.08);
  }
  poly(g, side, pl, windowOutline(u0 - 0.05, u1 + 0.05, z0 - 4, z1 + 4, arch), onWall(side, look.frame));
  poly(g, side, pl, windowOutline(u0, u1, z0, z1, arch), glass(SKY.top));
  const hgt = z1 - z0;
  const rectTop = arch ? z1 - ((u1 - u0) / 2) * ROUND : z1;
  const bands = [SKY.mid, mix(SKY.mid, SKY.low, 0.5), SKY.low];
  bands.forEach((col, i) => {
    plate(g, side, pl, u0, u1, z0, z0 + (rectTop - z0) * (0.72 - i * 0.22), glass(col));
  });
  let u = u0;
  while (u < u1 - 0.04) {
    const w = 0.08 + rand() * 0.12;
    plate(g, side, pl, u, Math.min(u1, u + w), z0, z0 + 4 + rand() * 9, glass(SKY.roofs), 0.75);
    u += w;
  }
  poly(g, side, pl, [[u0 + 0.06, z0 + hgt * 0.15], [u0 + 0.2, z0 + hgt * 0.15], [u0 + 0.36, z0 + hgt * 0.7], [u0 + 0.22, z0 + hgt * 0.7]], WHITE, 0.16);
  const mid = (u0 + u1) / 2;
  const bar = onWall(side, look.frame);
  plate(g, side, pl, mid - 0.018, mid + 0.018, z0, rectTop, bar);
  plate(g, side, pl, u0, u1, z0 + (rectTop - z0) * 0.58 - 1.2, z0 + (rectTop - z0) * 0.58 + 1.2, bar);
  if (arch) plate(g, side, pl, mid - 0.06, mid + 0.06, z1 + 1, z1 + 8, onWall(side, lit(look.trim, 0.1)));
  const out = 1 + 0.09;
  fan(g, lit(look.frame, 0.2), [fp(side, u0 - 0.08, pl, z0 - 3), fp(side, u1 + 0.08, pl, z0 - 3), fp(side, u1 + 0.08, out, z0 - 3), fp(side, u0 - 0.08, out, z0 - 3)]);
  plate(g, side, out, u0 - 0.08, u1 + 0.08, z0 - 7, z0 - 3, tone(side, look.frame, 0.3));
  if (d.kind === 'curtains') curtains(g, side, u0, u1, z0, z1, rand);
}

function curtains(g: G, side: Side, u0: number, u1: number, z0: number, z1: number, rand: () => number): void {
  const cloth = pick(FABRIC, rand);
  const pl = 1 + FACE * 3;
  const tie = z0 + (z1 - z0) * 0.35;
  for (const s of [-1, 1] as const) {
    const edge = s < 0 ? u0 : u1;
    const outer = edge + s * 0.2;
    const inner = edge - s * 0.1;
    const pinch = edge + s * 0.04;
    const pts: [number, number][][] = [
      [[outer, z1 + 9], [inner, z1 + 9], [pinch, tie], [outer, tie]],
      [[outer, tie], [pinch, tie], [inner + s * 0.06, z0 - 12], [outer, z0 - 12]],
    ];
    for (const p of pts) poly(g, side, pl, p, onWall(side, cloth));
    for (let k = 1; k < 3; k++) {
      const t = k / 3;
      const a = outer + (inner - outer) * t;
      const b = outer + (pinch - outer) * t;
      poly(g, side, pl + 0.001, [[a - 0.015, z1 + 9], [a + 0.015, z1 + 9], [b + 0.01, tie], [b - 0.01, tie]], onWall(side, shade(cloth, 0.3)), 0.8);
    }
    plate(g, side, pl + 0.002, Math.min(outer, pinch) - 0.01, Math.max(outer, pinch) + 0.01, tie - 1.5, tie + 1.5, onWall(side, GOLD));
  }
  plate(g, side, pl + 0.003, u0 - 0.26, u1 + 0.26, z1 + 9, z1 + 11, onWall(side, 0x4a3426));
  for (const e of [u0 - 0.27, u1 + 0.27]) {
    const p = fp(side, e, pl + 0.003, z1 + 10);
    g.fillStyle(onWall(side, BRASS), 1);
    g.fillCircle(p.x, p.y, 2.2 * S);
  }
}

function drawPicture(g: G, d: Decor, rand: () => number): void {
  const { side } = d;
  const pl = 1 + FACE * 2;
  const wide = rand() < 0.5;
  const u0 = d.u + (wide ? 0.14 : 0.26);
  const u1 = d.u + (wide ? 0.86 : 0.74);
  const z0 = 58 + rand() * 6;
  const z1 = z0 + (wide ? 22 : 28);
  const frame = rand() < 0.5 ? 0xc9a24a : 0x5a3a2a;
  plate(g, side, pl - FACE, u0 + 0.04, u1 + 0.05, z0 - 3, z1 - 3, SHADOW, 0.16);
  plate(g, side, pl, u0, u1, z0, z1, onWall(side, frame));
  plate(g, side, pl, u0, u1, z1 - 1.5, z1, onWall(side, lit(frame, 0.4)));
  const [a, b, zb, zt] = [u0 + 0.05, u1 - 0.05, z0 + 2.5, z1 - 2.5];
  const sky = pick([0x9fc4e0, 0xf2c48a, 0xb8a6d8, 0xe8a088], rand);
  plate(g, side, pl, a, b, zb, zt, onWall(side, sky));
  const sun = fp(side, a + (b - a) * (0.25 + rand() * 0.5), pl, zb + (zt - zb) * 0.68);
  g.fillStyle(onWall(side, 0xfff1c9), 1);
  g.fillCircle(sun.x, sun.y, 2.6 * S);
  const hill = pick([0x5f8a5a, 0x4a7aa0, 0x8a6a5a], rand);
  poly(g, side, pl, [[a, zb], [b, zb], [b, zb + (zt - zb) * 0.3], [a + (b - a) * 0.6, zb + (zt - zb) * 0.55], [a, zb + (zt - zb) * 0.35]], onWall(side, hill));
  plate(g, side, pl, a, b, zb, zb + (zt - zb) * 0.18, onWall(side, shade(hill, 0.3)));
}

function drawCross(g: G, d: Decor, h: number): void {
  const { side } = d;
  const pl = 1 + FACE * 2;
  const uc = d.u + 0.5;
  const zc = h - 44;
  const half = 0.3;
  plate(g, side, pl - FACE, uc - half + 0.04, uc + half + 0.04, zc - half * ROUND - 3, zc + half * ROUND - 3, SHADOW, 0.15);
  plate(g, side, pl, uc - half, uc + half, zc - half * ROUND, zc + half * ROUND, onWall(side, 0xf8f8f4));
  plate(g, side, pl, uc - half, uc + half, zc + half * ROUND - 1.5, zc + half * ROUND, onWall(side, WHITE));
  const arm = 7.5;
  const thick = 2.6;
  plate(g, side, pl, uc - arm / ROUND, uc + arm / ROUND, zc - thick, zc + thick, onWall(side, 0xe0574b));
  plate(g, side, pl, uc - thick / ROUND, uc + thick / ROUND, zc - arm, zc + arm, onWall(side, 0xe0574b));
}

function drawClock(g: G, d: Decor, h: number, rand: () => number): void {
  const { side } = d;
  const pl = 1 + FACE * 2;
  const uc = d.u + 0.5;
  const zc = h - 36;
  fan(g, SHADOW, ring(side, pl - FACE, uc + 0.04, zc - 3, 0.27), 0.15);
  fan(g, onWall(side, 0x3a3440), ring(side, pl, uc, zc, 0.27));
  fan(g, onWall(side, 0xfaf6ea), ring(side, pl, uc, zc, 0.22));
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    const r0 = i % 3 === 0 ? 0.15 : 0.18;
    line(g, fp(side, uc + Math.cos(t) * r0, pl, zc + Math.sin(t) * r0 * ROUND), fp(side, uc + Math.cos(t) * 0.2, pl, zc + Math.sin(t) * 0.2 * ROUND), 1.2, onWall(side, 0x3a3440));
  }
  const hour = rand() * Math.PI * 2;
  const minute = rand() * Math.PI * 2;
  const c = fp(side, uc, pl, zc);
  line(g, c, fp(side, uc + Math.cos(hour) * 0.1, pl, zc + Math.sin(hour) * 0.1 * ROUND), 2.2 * S, 0x2a2238);
  line(g, c, fp(side, uc + Math.cos(minute) * 0.16, pl, zc + Math.sin(minute) * 0.16 * ROUND), 1.4 * S, 0x2a2238);
  g.fillStyle(0xe0574b, 1);
  g.fillCircle(c.x, c.y, 1.4 * S);
}

function shopSign(g: G, layout: RoomLayout, h: number, rand: () => number): void {
  const uc = layout.w / 2;
  const half = Math.min(1.3, (layout.w - 2) / 2 - 0.3);
  const pl = 1 + FACE * 4;
  const z0 = h - 38;
  const z1 = h - 15;
  const board = pick([0x2f5d50, 0x7a2f3a, 0x2f4a7a], rand);
  for (const u of [uc - half + 0.25, uc + half - 0.25]) plate(g, 'n', pl, u - 0.015, u + 0.015, z1, h - 7, 0x3a3040);
  plate(g, 'n', pl - FACE, uc - half + 0.05, uc + half + 0.06, z0 - 4, z1 - 4, SHADOW, 0.18);
  plate(g, 'n', pl, uc - half, uc + half, z0, z1, onWall('n', GOLD));
  plate(g, 'n', pl, uc - half + 0.05, uc + half - 0.05, z0 + 2, z1 - 2, onWall('n', board));
  plate(g, 'n', pl, uc - half + 0.05, uc + half - 0.05, z1 - 4, z1 - 2, lit(board, 0.25));
  const zm = (z0 + z1) / 2;
  fan(g, GOLD, ring('n', pl, uc, zm, 0.22, 18));
  fan(g, board, ring('n', pl, uc, zm, 0.15, 18));
  fan(g, lit(GOLD, 0.3), ring('n', pl, uc, zm, 0.07, 12));
  for (const s of [-1, 1] as const) {
    let u = uc + s * 0.36;
    const end = uc + s * (half - 0.16);
    while (s * (end - u) > 0.05) {
      const len = Math.min(s * (end - u), 0.1 + rand() * 0.22);
      plate(g, 'n', pl, Math.min(u, u + s * len), Math.max(u, u + s * len), zm - 2.6, zm + 2.6, GOLD, 0.92);
      u += s * (len + 0.07);
    }
  }
}

function mintCrest(g: G, uc: number, h: number): void {
  const pl = 1 + FACE * 4;
  const zc = h - 24;
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < 6; i++) {
      const t = -Math.PI / 2 + (i / 5) * Math.PI * 0.85;
      const p = fp('n', uc + s * Math.cos(t) * 0.55, pl, zc + Math.sin(t) * 0.42 * ROUND);
      g.fillStyle(i % 2 === 0 ? 0xb89a3a : 0x8a7a2a, 1);
      g.fillEllipse(p.x, p.y, 7 * S, 3.6 * S, 10);
    }
  }
  const shield = (k: number): [number, number][] => [[uc - 0.34 * k, zc + 13 * k], [uc + 0.34 * k, zc + 13 * k], [uc + 0.34 * k, zc - 2 * k], [uc, zc - 15 * k], [uc - 0.34 * k, zc - 2 * k]];
  poly(g, 'n', pl - FACE, shield(1.14).map(([u, z]) => [u + 0.05, z - 3] as [number, number]), SHADOW, 0.18);
  poly(g, 'n', pl, shield(1.14), 0x8a6a2a);
  poly(g, 'n', pl, shield(1), GOLD);
  poly(g, 'n', pl, shield(0.72), 0x2f4a6a);
  for (const du of [-0.12, 0, 0.12]) plate(g, 'n', pl, uc + du - 0.035, uc + du + 0.035, zc - 4, zc + 6, lit(GOLD, 0.2));
  plate(g, 'n', pl, uc - 0.18, uc + 0.18, zc + 6, zc + 8, lit(GOLD, 0.2));
  plate(g, 'n', pl, uc - 0.3, uc + 0.3, zc + 14, zc + 18, GOLD);
  for (const du of [-0.26, 0, 0.26]) poly(g, 'n', pl, [[uc + du - 0.08, zc + 18], [uc + du + 0.08, zc + 18], [uc + du, zc + 25]], GOLD);
}

function banner(g: G, u0: number, u1: number, h: number): void {
  const pl = 1 + FACE * 3;
  const z0 = 34;
  const z1 = h - 24;
  const uc = (u0 + u1) / 2;
  const shape = (i: number): [number, number][] => [[u0 + i, z1], [u1 - i, z1], [u1 - i, z0 + i * 20], [uc, z0 + 9 + i * 20], [u0 + i, z0 + i * 20]];
  poly(g, 'n', pl, shape(0), onWall('n', GOLD));
  poly(g, 'n', pl, shape(0.03), onWall('n', 0x8a2a32));
  plate(g, 'n', pl, u0 + 0.03, uc - 0.04, z0 + 6, z1, lit(0x8a2a32, 0.12), 0.5);
  fan(g, GOLD, ring('n', pl, uc, z1 - 22, 0.12, 16));
  fan(g, 0x8a2a32, ring('n', pl, uc, z1 - 22, 0.07, 12));
  plate(g, 'n', pl + 0.002, u0 - 0.06, u1 + 0.06, z1, z1 + 2.5, 0x4a3426);
}

// ---------- Room shell ----------

/**
 * Floor, back walls with windows/skirting/decor, and the front stub walls with the doorway; drawn in room-local tile
 * coordinates (tile (0,0) at the Graphics' origin). The back walls rise out of sight and the building's own front runs
 * on past the room's sides and below its floor, all fading into `roomBackdrop`, so no empty space shows round the room.
 */
export function drawRoomShell(floor: G, backWalls: G, frontStub: G, layout: RoomLayout, room: RoomKind, seed: number): void {
  const rand = rng((seed * 48271 + 11) >>> 0);
  const h = WALL_H[room];
  const x1 = layout.w - 1;
  const y1 = layout.d - 1;
  const door = doorColumn(layout);
  const look = wallLook(layout, room, rand);
  const decor = planWalls(layout, room, seed);

  exterior(floor, layout, room, h, rng((seed * 69621 + 5) >>> 0));
  switch (layout.floor) {
    case 'planks':
      floorPlanks(floor, x1, y1, room === 'shop' ? 0xb07a4e : pick([0xb98552, 0x9a6a44, 0xc89a68], rand), rand);
      break;
    case 'tile':
      if (room === 'hospital') floorTiles(floor, x1, y1, [0xeef2ee, 0xcfe3dc], 0xb4c2be, rand);
      else floorTiles(floor, x1, y1, [0xd99a6e, 0xf0e2c8], 0x9a7a60, rand);
      break;
    case 'marble':
      floorMarble(floor, x1, y1, rand);
      break;
    case 'carpet':
      floorCarpet(floor, x1, y1, pick([0x7a5a7e, 0x5f7f6a, 0x6a7fa0, 0xa0605a], rand), rand);
      break;
  }
  fan(floor, 0xb8a890, quad(door, y1, door + 1, y1 + STUB_T));
  fan(floor, shade(0xb8a890, 0.3), [P(door, y1 + STUB_T, 0), P(door + 1, y1 + STUB_T, 0), P(door + 1, y1 + STUB_T, -4), P(door, y1 + STUB_T, -4)]);
  fan(floor, lit(0xb8a890, 0.3), quad(door, y1, door + 1, y1 + 0.04));
  for (let i = 1; i <= 4; i++) {
    fan(floor, SHADOW, quad(1, 1, 1 + 0.16 * i, y1), 0.05);
    fan(floor, SHADOW, quad(1, 1, x1, 1 + 0.08 * i), 0.05);
  }
  const mat = { x0: door + 0.12, x1: door + 0.88, y0: y1 - 0.85, y1: y1 - 0.12 };
  fan(floor, SHADOW, quad(mat.x0 + 0.02, mat.y0 + 0.02, mat.x1 + 0.05, mat.y1 + 0.02), 0.2);
  fan(floor, 0x6a4a2e, quad(mat.x0, mat.y0, mat.x1, mat.y1, 0.5));
  fan(floor, 0xa8794a, quad(mat.x0 + 0.06, mat.y0 + 0.06, mat.x1 - 0.06, mat.y1 - 0.06, 0.5));
  for (let x = mat.x0 + 0.1; x < mat.x1 - 0.08; x += 0.06) line(floor, P(x, mat.y0 + 0.08, 0.5), P(x, mat.y1 - 0.08, 0.5), 1, 0x7a5434, 0.45);
  for (const d of decor) {
    if (d.kind !== 'window' && d.kind !== 'arch' && d.kind !== 'curtains') continue;
    const a = d.u + 0.2;
    const b = d.u + 0.8;
    const m = (a + b) / 2;
    for (const [k, alpha] of [[1, 0.09], [0.7, 0.08]] as const) {
      for (const [p, q] of [[a, m - 0.03], [m + 0.03, b]] as const) {
        if (d.side === 'w') {
          const far = Math.min(x1 - 0.1, 1 + 2.4 * k);
          fan(floor, SUN, [P(1.15, p + 0.15), P(1.15, q + 0.15), P(far, Math.min(y1, q + 0.15 + 0.5 * k)), P(far, Math.min(y1, p + 0.15 + 0.5 * k))], alpha);
        } else {
          const far = Math.min(y1 - 0.1, 1 + 1.8 * k);
          fan(floor, SUN, [P(p + 0.25, 1.15), P(q + 0.25, 1.15), P(Math.min(x1, q + 0.25 + 0.9 * k), far), P(Math.min(x1, p + 0.25 + 0.9 * k), far)], alpha * 0.7);
        }
      }
    }
  }
  for (const [k, alpha] of [[1, 0.07], [0.65, 0.08], [0.35, 0.09]] as const) {
    const top = Math.max(1.2, y1 - 2.8 * k);
    fan(floor, WARM, [P(door + 0.04, y1 + STUB_T), P(door + 0.96, y1 + STUB_T), P(door + 1 + 0.6 * k, top), P(door - 0.6 * k, top)], alpha);
  }

  const wallU = { n: x1 + STUB_T, w: y1 + STUB_T } as const;
  for (const side of ['w', 'n'] as const) {
    const u1 = wallU[side];
    switch (layout.wall) {
      case 'plaster':
        plasterWall(backWalls, side, u1, h, look, rand);
        break;
      case 'brick':
        brickWall(backWalls, side, u1, h, look, rand);
        break;
      case 'panel':
        panelWall(backWalls, side, u1, h, look);
        break;
      case 'stone':
        stoneWall(backWalls, side, u1, h, look, rand);
        break;
    }
    if (layout.wall !== 'stone') skirting(backWalls, side, u1, look);
    plate(backWalls, side, 1 + FACE * 0.6, 1, 1.12, 0, WALL_TOP, SHADOW, 0.1);
    for (const d of decor) {
      if (d.side !== side) continue;
      if (d.kind === 'picture') drawPicture(backWalls, d, rand);
      else if (d.kind === 'cross') drawCross(backWalls, d, h);
      else if (d.kind === 'clock') drawClock(backWalls, d, h, rand);
      else drawWindow(backWalls, d, h, look, rand);
    }
  }
  if (room === 'shop') shopSign(backWalls, layout, h, rand);
  const vault = layout.furniture.find((f) => f.piece === 'vaultDoor');
  if (room === 'mintHall' && vault !== undefined) {
    mintCrest(backWalls, vault.c + vault.w / 2, h);
    banner(backWalls, vault.c - 0.72, vault.c - 0.28, h);
    banner(backWalls, vault.c + vault.w + 0.28, vault.c + vault.w + 0.72, h);
  }
  const t = WALL_T;
  const out = outside(layout, room);
  plate(backWalls, 'n', wallU.w, 1 - t, 1, 0, WALL_TOP, lit(look.upper, 0.08));
  plate(backWalls, 'w', wallU.n, 1 - t, 1, 0, WALL_TOP, shade(look.upper, 0.42));
  line(backWalls, P(1, wallU.w, 0), P(1, wallU.w, WALL_TOP), 1.2, lit(look.upper, 0.3), 0.5);
  line(backWalls, P(1 - t, wallU.w, 0), P(1 - t, wallU.w, WALL_TOP), 1.2, shade(look.upper, 0.5), 0.6);
  for (const side of ['w', 'n'] as const) fadeBands(backWalls, side, 1 + FACE * 6, 1, wallU[side], 0, WALL_TOP, 'z', h + FADE_FROM, WALL_TOP, out.night);
  fadeBands(backWalls, 'n', wallU.w, 1 - t, 1, 0, WALL_TOP, 'z', h + FADE_FROM, WALL_TOP, out.night);
  fadeBands(backWalls, 'w', wallU.n, 1 - t, 1, 0, WALL_TOP, 'z', h + FADE_FROM, WALL_TOP, out.night);

  const stub = layout.wall === 'brick' ? look.upper : layout.wall === 'panel' ? look.lower : layout.wall === 'stone' ? look.upper : look.lower;
  const wallPiece = (ax: number, ay: number, bx: number, by: number, south: boolean, east: boolean): void => {
    prism(frontStub, ax, ay, bx, by, 0, STUB_H, stub);
    if (south) outerFace(frontStub, layout, 'n', by, ax, bx, 0, STUB_H, out.south);
    if (east) outerFace(frontStub, layout, 'w', bx, ay, by, 0, STUB_H, out.east);
    prism(frontStub, ax - 0.03, ay - 0.03, bx + 0.03, by + 0.03, STUB_H, 3, look.trim, lit(look.trim, 0.35));
  };
  wallPiece(x1, 1 - t, x1 + STUB_T, y1, false, true);
  if (door > 0) wallPiece(1 - t, y1, door, y1 + STUB_T, true, false);
  wallPiece(door + 1, y1, x1 + STUB_T, y1 + STUB_T, true, true);
  for (const x of [door - 0.06, door + 1 - 0.04]) prism(frontStub, x, y1 - 0.02, x + 0.1, y1 + STUB_T + 0.02, 0, STUB_H + 10, look.frame, lit(look.frame, 0.35));
}

// The building's outside finish, by the room's walls.
function exteriorOf(layout: RoomLayout, room: RoomKind): number {
  switch (layout.wall) {
    case 'brick':
      return 0x9a5236;
    case 'stone':
      return 0xb4a68e;
    case 'panel':
      return 0xb89a78;
    default:
      return room === 'hospital' ? 0xd4dcd6 : 0xd8c4a4;
  }
}

/** The deep tone round a room while you are inside it, from its own walls and floor; the camera's background is set to it so the edges of the view read as more of the building. */
export function roomBackdrop(layout: RoomLayout, room: RoomKind): number {
  const wall = layout.wall === 'brick' ? 0xb0603f : layout.wall === 'panel' ? 0x8a5a3a : layout.wall === 'stone' ? 0xb4a68e : room === 'hospital' ? 0x8fc7bd : room === 'flat' ? 0xa89488 : 0xc77f5a;
  const floor = layout.floor === 'planks' ? 0xb07a4e : layout.floor === 'tile' ? (room === 'hospital' ? 0xcfe3dc : 0xd99a6e) : layout.floor === 'marble' ? 0x8a8a80 : 0x6f6070;
  return mix(mix(wall, floor, 0.35), NIGHT, 0.86);
}

function outside(layout: RoomLayout, room: RoomKind): { south: number; east: number; night: number } {
  const night = roomBackdrop(layout, room);
  const ext = exteriorOf(layout, room);
  return { south: mix(ext, night, 0.58), east: mix(ext, night, 0.74), night };
}

// Washes part of a wall plane into `col`: clear at `from`, solid at `to` and past it, along u or z in soft bands.
function fadeBands(g: G, side: Side, plane: number, u0: number, u1: number, z0: number, z1: number, along: 'u' | 'z', from: number, to: number, col: number): void {
  const lo = along === 'u' ? u0 : z0;
  const hi = along === 'u' ? u1 : z1;
  const put = (p: number, q: number, alpha: number): void => {
    const a = Math.max(lo, Math.min(p, q));
    const b = Math.min(hi, Math.max(p, q));
    if (b <= a) return;
    if (along === 'u') plate(g, side, plane, a, b, z0, z1, col, alpha);
    else plate(g, side, plane, u0, u1, a, b, col, alpha);
  };
  for (let i = 0; i < BANDS; i++) {
    const t = (i + 0.5) / BANDS;
    put(from + ((to - from) * i) / BANDS, from + ((to - from) * (i + 1)) / BANDS, t * t * (3 - 2 * t));
  }
  put(to, to > from ? hi : lo, 1);
}

// The outside face of the building on one plane, with its masonry: brick courses, stone joints or plain render.
function outerFace(g: G, layout: RoomLayout, side: Side, plane: number, u0: number, u1: number, z0: number, z1: number, col: number): void {
  plate(g, side, plane, u0, u1, z0, z1, col);
  const joint = shade(col, 0.3);
  if (layout.wall === 'brick') {
    for (let z = Math.floor(z0 / BRICK_H + 1) * BRICK_H; z < z1; z += BRICK_H) plate(g, side, plane, u0, u1, z, Math.min(z1, z + 1), joint, 0.55);
  } else if (layout.wall === 'stone') {
    for (let k = Math.floor(z0 / STONE_H); k * STONE_H < z1; k++) {
      const z = k * STONE_H;
      if (z > z0) plate(g, side, plane, u0, u1, z, Math.min(z1, z + 1.2), joint, 0.6);
      const shift = (((k % 2) + 2) % 2) * (STONE_L / 2);
      for (let u = Math.ceil((u0 - shift) / STONE_L) * STONE_L + shift; u < u1; u += STONE_L) plate(g, side, plane, u, Math.min(u1, u + 0.012), Math.max(z0, z), Math.min(z1, z + STONE_H), joint, 0.5);
    }
  }
}

// The building's own front round the cut-open room: its south and east faces run on past the room's sides and down
// past its floor, with a plinth, a string course, a dark neighbour's window, and a doorstep, all fading into the dark.
function exterior(g: G, layout: RoomLayout, room: RoomKind, h: number, rand: () => number): void {
  const X = layout.w - 1 + STUB_T;
  const Y = layout.d - 1 + STUB_T;
  const edge = 1 - WALL_T;
  const far = edge - REACH;
  const out = outside(layout, room);
  const faces = [
    { side: 'n', plane: Y, end: X, col: out.south },
    { side: 'w', plane: X, end: Y, col: out.east },
  ] as const;
  for (const f of faces) {
    outerFace(g, layout, f.side, f.plane, far, edge, -DROP, WALL_TOP, f.col);
    outerFace(g, layout, f.side, f.plane, edge, f.end, -DROP, 0, f.col);
    const stone = mix(f.col, 0xe8dcc4, 0.16);
    plate(g, f.side, f.plane, far, f.end, -27, -25, shade(f.col, 0.4), 0.7);
    plate(g, f.side, f.plane, far, f.end, -25, -6, stone);
    for (let u = far + 0.4; u < f.end; u += 0.9) plate(g, f.side, f.plane, u, u + 0.012, -25, -6, shade(stone, 0.3), 0.6);
    plate(g, f.side, f.plane, far, f.end, -8, -6, lit(stone, 0.2));
    plate(g, f.side, f.plane, far, edge, h + 6, h + 8, shade(f.col, 0.4), 0.7);
    plate(g, f.side, f.plane, far, edge, h + 8, h + 15, lit(stone, 0.1));
    plate(g, f.side, f.plane, far, edge, h + 13, h + 15, lit(stone, 0.3));
    const u0 = edge - 2.2;
    const u1 = edge - 1.5;
    const z0 = 46;
    const z1 = h - 24;
    plate(g, f.side, f.plane, u0 - 0.06, u1 + 0.06, z0 - 4, z1 + 4, lit(f.col, 0.16));
    plate(g, f.side, f.plane, u0, u1, z0, z1, mix(0x2a3442, out.night, 0.35));
    if (rand() < 0.5) plate(g, f.side, f.plane, u0, u1, z0, z0 + (z1 - z0) * 0.55, WARM, 0.12);
    plate(g, f.side, f.plane, (u0 + u1) / 2 - 0.015, (u0 + u1) / 2 + 0.015, z0, z1, lit(f.col, 0.16));
    plate(g, f.side, f.plane, u0 - 0.1, u1 + 0.1, z0 - 8, z0 - 4, lit(stone, 0.2));
    fadeBands(g, f.side, f.plane, far, f.end, -DROP, WALL_TOP, 'z', -30, -DROP, out.night);
    fadeBands(g, f.side, f.plane, far, edge, -DROP, WALL_TOP, 'z', h + FADE_FROM, WALL_TOP, out.night);
    fadeBands(g, f.side, f.plane, far, edge, -DROP, WALL_TOP, 'u', edge - 1.2, far, out.night);
  }
  line(g, P(X, Y, 0), P(X, Y, -DROP * 0.7), 1.2, lit(out.south, 0.3), 0.35);
  const door = doorColumn(layout);
  const step = mix(0xb8a890, out.night, 0.3);
  prism(g, door - 0.12, Y, door + 1.12, Y + 0.34, -20, 14, step, lit(step, 0.2));
  fan(g, WARM, quad(door - 0.04, Y, door + 1.04, Y + 0.3, -6), 0.14);
}

// ---------- Furniture ----------

function counter(g: G, f: Furniture, layout: RoomLayout, room: RoomKind, trade: Trade, rand: () => number): void {
  const fr = frameOf(f, layout);
  const { a0, a1, b0, b1 } = span(f, fr);
  const mint = room === 'mintHall';
  const body = mint ? 0x5a3326 : 0xa8714a;
  const top = mint ? 0x3e2219 : 0xd8b07e;
  contact(g, f.c + 0.05, f.r + 0.05, f.c + f.w - 0.05, f.r + f.d - 0.05, 0.22);
  box(g, fr, a0 + 0.1, b0 + 0.12, a1 - 0.1, b1 - 0.06, 0, 4, shade(body, 0.35));
  box(g, fr, a0 + 0.08, b0 + 0.1, a1 - 0.08, b1 - 0.1, 4, COUNTER_H - 4, body);
  const front = b1 - 0.1 + 0.002;
  const panels = Math.max(1, Math.round((a1 - a0) / 0.8));
  const pw = (a1 - a0 - 0.16) / panels;
  for (let i = 0; i < panels; i++) {
    const u = a0 + 0.08 + i * pw;
    plate(g, fr, front, u + 0.07, u + pw - 0.07, 9, COUNTER_H - 5, tone(fr, shade(body, 0.14)));
    plate(g, fr, front, u + 0.07, u + pw - 0.07, 9, 10.5, tone(fr, lit(body, 0.3)));
  }
  if (mint) {
    plate(g, fr, front + 0.001, a0 + 0.08, a1 - 0.08, 4, 6, tone(fr, BRASS));
    plate(g, fr, front + 0.001, a0 + 0.08, a1 - 0.08, COUNTER_H - 3, COUNTER_H - 1, tone(fr, BRASS));
  }
  box(g, fr, a0 + 0.03, b0 + 0.05, a1 - 0.03, b1 - 0.04, COUNTER_H, 4, mint ? top : shade(top, 0.15), lit(top, 0.2));
  fan(g, WHITE, [fp(fr, a0 + 0.1, b1 - 0.14, COUNTER_H + 4), fp(fr, a1 - 0.1, b1 - 0.14, COUNTER_H + 4), fp(fr, a1 - 0.1, b1 - 0.08, COUNTER_H + 4), fp(fr, a0 + 0.1, b1 - 0.08, COUNTER_H + 4)], 0.18);
  const zt = COUNTER_H + 4;
  const bm = (b0 + b1) / 2;
  if (mint) {
    box(g, fr, a0 + 0.2, bm - 0.18, a0 + 0.62, bm + 0.16, zt, 3, 0x6a1f2a, 0xf0e6d0);
    for (let i = 0; i < 3; i++) {
      const [cx, cy] = xy(fr, a1 - 0.7 + i * 0.16, bm + (i % 2) * 0.08);
      tube(g, cx, cy, 0.06, 0.06, zt, 4 + i * 2.5, GOLD, lit(GOLD, 0.4), 6);
    }
  } else {
    const ta = a0 + 0.25;
    box(g, fr, ta, b0 + 0.22, ta + 0.42, b0 + 0.68, zt, 9, 0x4a4e58, 0x5a5e68);
    box(g, fr, ta + 0.04, b0 + 0.24, ta + 0.38, b0 + 0.4, zt + 9, 6, 0x3a3e46, 0x7fc8e8);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        const p = fp(fr, ta + 0.1 + i * 0.11, b0 + 0.47 + j * 0.1, zt + 9);
        floorDot(g, p, 0xd9d4c8);
      }
    }
  }
  if (trade !== null) {
    counterWares(g, fr, trade, a0 + 0.84, a1 - 0.1, b0 + 0.12, b1 - 0.12, zt, rand);
    return;
  }
  const [bx, by] = xy(fr, a1 - 0.3, bm + 0.05);
  tube(g, bx, by, 0.09, 0.09, zt, 1.5, 0x4a3426, null, 6);
  const dome = P(bx, by, zt + 1.5);
  g.fillStyle(BRASS, 1);
  g.fillEllipse(dome.x, dome.y - 2 * S, 16 * S, 10 * S, 16);
  g.fillStyle(lit(BRASS, 0.5), 1);
  g.fillEllipse(dome.x - 2.5 * S, dome.y - 3.5 * S, 5 * S, 3 * S, 10);
  g.fillStyle(shade(BRASS, 0.3), 1);
  g.fillCircle(dome.x, dome.y - 7.5 * S, 1.6 * S);
}

function floorDot(g: G, p: Pt, col: number): void {
  g.fillStyle(col, 1);
  g.fillEllipse(p.x, p.y, 3.4 * S, 1.8 * S, 8);
}

// Open shelving against the back wall: carcass, boards, and whatever stock the room keeps, filled board by board.
function shelving(g: G, f: Furniture, layout: RoomLayout, height: number, boards: number, carcass: number, stock: (fr: Fr, a0: number, a1: number, b0: number, b1: number, z: number, gap: number) => void): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.06;
  const a1 = s.a1 - 0.06;
  const b0 = s.b0 + 0.05;
  const b1 = b0 + 0.62;
  contact(g, f.c + 0.04, f.r + 0.04, f.c + f.w - 0.04, f.r + f.d - 0.3, 0.2);
  box(g, fr, a0, b0, a1, b0 + 0.05, 0, height, shade(carcass, 0.45));
  box(g, fr, a0, b0, a0 + 0.06, b1, 0, height, carcass);
  const step = (height - 8) / boards;
  for (let k = 0; k < boards; k++) {
    const z = 4 + k * step;
    box(g, fr, a0 + 0.06, b0 + 0.05, a1 - 0.06, b1, z, 3, carcass, lit(carcass, 0.2));
    stock(fr, a0 + 0.06, a1 - 0.06, b0 + 0.05, b1, z + 3, step - 4);
  }
  box(g, fr, a1 - 0.06, b0, a1, b1, 0, height, carcass);
  if (fr === 'e') {
    box(g, fr, a0, b0, a1, b0 + 0.05, 0, height, shade(carcass, 0.2));
    for (let k = 1; k < boards; k++) {
      const p = fp(fr, a0 + 0.02, b0, 4 + k * step);
      const q = fp(fr, a1 - 0.02, b0, 4 + k * step);
      line(g, p, q, 1, shade(carcass, 0.5), 0.4);
    }
  }
  box(g, fr, a0 - 0.02, b0, a1 + 0.02, b1 + 0.03, height, 4, carcass, lit(carcass, 0.25));
  box(g, fr, a0 + 0.06, b1 - 0.04, a1 - 0.06, b1, 0, 4, shade(carcass, 0.3));
}

// One thing of a shop's own trade on a shelf board, starting at `a`; how far along it took.
function tradeStock(g: G, fr: Fr, trade: ShopTrade, a: number, a1: number, b0: number, b1: number, z: number, gap: number, rand: () => number): number {
  const kind = rand();
  const bc = (b0 + b1) / 2 + 0.04;
  const [cx, cy] = xy(fr, a + 0.08, bc);
  switch (trade) {
    case 'tailor': {
      const w = Math.min(a1 - a, 0.22 + rand() * 0.06);
      for (let i = 0; i < 2 + Math.floor(rand() * 3) && 2 + i * 3.4 < gap - 2; i++) {
        const col = pick(CLOTH, rand);
        box(g, fr, a + (rand() - 0.5) * 0.02, b0 + 0.14, a + w, b1 - 0.06, z + i * 3.4, 3.2, col, lit(col, 0.25));
      }
      return w + 0.04;
    }
    case 'hats':
      if (kind < 0.5) {
        hatBox(g, cx, cy, z, 0.08, Math.min(gap - 4, 11), pick(HATS, rand), rand);
        return 0.2;
      }
      hat(g, cx, cy, z, Math.floor(rand() * 4), pick(HATS, rand), 0.75, rand);
      return 0.24;
    case 'surf':
      if (kind < 0.5) {
        for (let i = 0; i < 3; i++) {
          const col = pick([0xf2e6d0, 0xc8e4ff, 0xffc8c8, 0xffe27a], rand);
          box(g, fr, a + i * 0.07, b1 - 0.24, a + i * 0.07 + 0.06, b1 - 0.1, z, 5, col, lit(col, 0.3));
        }
        return 0.24;
      }
      tube(g, cx, cy, 0.04, 0.04, z, 10, pick([0xffc860, 0xff8a5c, 0x3fa7b5], rand), null, 4);
      tube(g, cx, cy, 0.025, 0.02, z + 10, 3, WHITE, WHITE, 3);
      return 0.12;
    case 'barber':
      if (kind < 0.35) {
        box(g, fr, a, b0 + 0.16, Math.min(a1, a + 0.22), b1 - 0.06, z, 7, 0xf4f2ec, WHITE);
        plate(g, fr, b1 - 0.06 + 0.002, a + 0.02, Math.min(a1, a + 0.22) - 0.02, z + 3, z + 4, tone(fr, 0x2f8a86));
        return 0.26;
      }
      tube(g, cx, cy, 0.04, 0.035, z, Math.min(gap - 5, 11), pick([0x8a4a1a, 0x3f7a4a, 0x2f5a8a, 0xd9a54a], rand), null, 4);
      tube(g, cx, cy, 0.022, 0.022, z + Math.min(gap - 5, 11), 3, 0x2a2a30, 0x4a4a52, 3);
      return 0.12;
    default: {
      const hh = Math.min(gap - 4, 8 + rand() * 4);
      tube(g, cx, cy, 0.06, 0.06, z, hh, pick([0xf2ece0, 0x8a5a3a, 0x3f7a4a, 0xd9cbb0], rand), null, 6);
      tube(g, cx, cy, 0.063, 0.063, z + hh, 2.5, 0x5a3a2a, 0x8a6a4a, 6);
      return 0.17;
    }
  }
}

function shelf(g: G, f: Furniture, layout: RoomLayout, room: RoomKind, trade: Trade, rand: () => number): void {
  const carcass = room === 'mintHall' ? 0x5a3326 : 0x9a6a44;
  shelving(g, f, layout, SHELF_H, 4, carcass, (fr, a0, a1, b0, b1, z, gap) => {
    let a = a0 + 0.04 + rand() * 0.05;
    while (a < a1 - 0.12) {
      if (trade !== null && rand() < 0.75) {
        a += tradeStock(g, fr, trade, a, a1, b0, b1, z, gap, rand);
        continue;
      }
      const kind = rand();
      const col = pick(GOODS, rand);
      if (kind < 0.45) {
        const w = 0.13 + rand() * 0.12;
        const hh = Math.min(gap - 2, 8 + rand() * 8);
        box(g, fr, a, b0 + 0.12 + rand() * 0.08, Math.min(a1 - 0.02, a + w), b1 - 0.06, z, hh, col, lit(col, 0.3));
        if (rand() < 0.5) plate(g, fr, b1 - 0.06 + 0.002, a + 0.03, Math.min(a1 - 0.02, a + w) - 0.03, z + hh * 0.35, z + hh * 0.65, tone(fr, WHITE), 0.75);
        a += w + 0.03;
      } else if (kind < 0.8) {
        const [cx, cy] = xy(fr, a + 0.07, b1 - 0.2);
        const hh = Math.min(gap - 4, 9 + rand() * 3);
        tube(g, cx, cy, 0.065, 0.065, z, hh, mix(col, 0xe8f4f8, 0.35), null, 4);
        tube(g, cx, cy, 0.068, 0.068, z + hh, 2.5, 0x8a7a6a, 0xb8a890, 4);
        a += 0.17;
      } else {
        const [cx, cy] = xy(fr, a + 0.05, b1 - 0.2);
        const hh = Math.min(gap - 6, 12 + rand() * 3);
        tube(g, cx, cy, 0.045, 0.045, z, hh, col, null, 4);
        tube(g, cx, cy, 0.045, 0.018, z + hh, 5, col, 0xd9cbb0, 2);
        a += 0.12;
      }
    }
  });
}

function bookcase(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  shelving(g, f, layout, BOOKCASE_H, 5, 0x6e4430, (fr, a0, a1, b0, b1, z, gap) => {
    let a = a0 + 0.02;
    while (a < a1 - 0.05) {
      if (rand() < 0.08) {
        a += 0.08 + rand() * 0.08;
        continue;
      }
      const w = 0.035 + rand() * 0.035;
      const hh = Math.min(gap - 1, gap * (0.6 + rand() * 0.35));
      const col = pick(BOOKS, rand);
      box(g, fr, a, b0 + 0.1 + rand() * 0.06, Math.min(a1, a + w), b1 - 0.03, z, hh, col, lit(col, 0.25));
      if (rand() < 0.5) plate(g, fr, b1 - 0.03 + 0.002, a + 0.008, Math.min(a1, a + w) - 0.008, z + hh * 0.7, z + hh * 0.78, tone(fr, GOLD), 0.8);
      a += w + 0.006;
    }
  });
}

function rug(g: G, f: Furniture, room: RoomKind, rand: () => number): void {
  const x0 = f.c + 0.1;
  const y0 = f.r + 0.1;
  const x1 = f.c + f.w - 0.1;
  const y1 = f.r + f.d - 0.1;
  const z = 0.5;
  const pal = room === 'mintHall'
    ? { border: 0x5a1a24, field: 0x8a2a32, line: GOLD, motif: 0xe8c070 }
    : room === 'shop'
      ? { border: 0x2f5068, field: 0x3f6f8a, line: 0xe9d8b0, motif: 0xd98a4a }
      : pick([0, 1, 2], rand) === 0
        ? { border: 0x2a4a5a, field: 0x3f7f86, line: 0xf0e2c0, motif: 0xd9a54a }
        : { border: 0x6a3a2a, field: 0xb86a4a, line: 0xf2e2c4, motif: 0x2f5a7a };
  fan(g, SHADOW, [P(x1, y0 + 0.05), P(x1 + 0.06, y0 + 0.05), P(x1 + 0.06, y1 + 0.03), P(x0 + 0.05, y1 + 0.03), P(x0 + 0.05, y1), P(x1, y1)], 0.16);
  const along = f.w >= f.d;
  g.lineStyle(1.2, 0xf0e6d0, 0.9);
  if (along) {
    for (let y = y0 + 0.03; y < y1 - 0.02; y += 0.06) {
      for (const [x, dx] of [[x0, -0.07], [x1, 0.07]] as const) {
        const a = P(x, y, z);
        const b = P(x + dx, y + 0.01, z);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
  } else {
    for (let x = x0 + 0.03; x < x1 - 0.02; x += 0.06) {
      for (const [y, dy] of [[y0, -0.07], [y1, 0.07]] as const) {
        const a = P(x, y, z);
        const b = P(x + 0.01, y + dy, z);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
  }
  fan(g, pal.border, quad(x0, y0, x1, y1, z));
  fan(g, pal.line, quad(x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, z));
  fan(g, pal.field, quad(x0 + 0.14, y0 + 0.14, x1 - 0.14, y1 - 0.14, z));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (room === 'shop') {
    const n = Math.max(3, Math.round((along ? x1 - x0 : y1 - y0) / 0.35));
    for (let i = 1; i < n; i += 2) {
      const t0 = i / n;
      const t1 = (i + 0.5) / n;
      if (along) fan(g, pal.motif, quad(x0 + 0.14 + (x1 - x0 - 0.28) * t0, y0 + 0.14, x0 + 0.14 + (x1 - x0 - 0.28) * t1, y1 - 0.14, z), 0.85);
      else fan(g, pal.motif, quad(x0 + 0.14, y0 + 0.14 + (y1 - y0 - 0.28) * t0, x1 - 0.14, y0 + 0.14 + (y1 - y0 - 0.28) * t1, z), 0.85);
    }
    return;
  }
  const hw = Math.min(0.9, (x1 - x0) * 0.32);
  const hd = Math.min(0.9, (y1 - y0) * 0.32);
  fan(g, pal.motif, [P(cx - hw, cy, z), P(cx, cy - hd, z), P(cx + hw, cy, z), P(cx, cy + hd, z)]);
  fan(g, pal.border, [P(cx - hw * 0.7, cy, z), P(cx, cy - hd * 0.7, z), P(cx + hw * 0.7, cy, z), P(cx, cy + hd * 0.7, z)]);
  fan(g, pal.line, [P(cx - hw * 0.3, cy, z), P(cx, cy - hd * 0.3, z), P(cx + hw * 0.3, cy, z), P(cx, cy + hd * 0.3, z)]);
  for (const [px, py] of [[x0 + 0.3, y0 + 0.3], [x1 - 0.3, y0 + 0.3], [x0 + 0.3, y1 - 0.3], [x1 - 0.3, y1 - 0.3]] as const) {
    fan(g, pal.motif, [P(px - 0.09, py, z), P(px, py - 0.09, z), P(px + 0.09, py, z), P(px, py + 0.09, z)]);
  }
  if (room === 'mintHall' && f.d > 2) {
    for (let y = y0 + 0.5; y < y1 - 0.4; y += 0.5) {
      if (Math.abs(y - cy) < hd + 0.2) continue;
      fan(g, pal.motif, [P(cx - 0.12, y, z), P(cx, y - 0.12, z), P(cx + 0.12, y, z), P(cx, y + 0.12, z)], 0.8);
    }
  }
}

function leaf(g: G, base: Pt, ang: number, len: number, wid: number, light: number, dark: number): void {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const tip = { x: base.x + dx * len * S, y: base.y + dy * len * S };
  const mid = { x: base.x + dx * len * 0.45 * S, y: base.y + dy * len * 0.45 * S };
  let px = -dy * wid * S;
  let py = dx * wid * S;
  if (px > 0) {
    px = -px;
    py = -py;
  }
  fan(g, light, [base, { x: mid.x + px, y: mid.y + py }, tip]);
  fan(g, dark, [base, tip, { x: mid.x - px, y: mid.y - py }]);
}

function plant(g: G, f: Furniture, room: RoomKind, rand: () => number): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const pot = room === 'mintHall' ? 0xd8ccb4 : room === 'hospital' ? 0xf2f2ee : 0xc0704a;
  const leafs = LEAVES[Math.floor(rand() * LEAVES.length)] ?? LEAVES[0];
  floorEllipse(g, x + 0.12, y + 0.02, 0.3, SHADOW, 0.2);
  tube(g, x, y, 0.15, 0.2, 0, POT_H - 3, pot, null);
  tube(g, x, y, 0.23, 0.23, POT_H - 3, 3, lit(pot, 0.05), lit(pot, 0.2));
  const soil = P(x, y, POT_H);
  g.fillStyle(0x4a3426, 1);
  g.fillEllipse(soil.x, soil.y, 0.2 * 2 * RX, 0.2 * 2 * RY, 16);
  const kind = Math.floor(rand() * 3);
  if (kind === 0) {
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI + 0.35 + ((Math.PI - 0.7) * i) / (n - 1) + (rand() - 0.5) * 0.2;
      leaf(g, soil, a, 26 + rand() * 12, 5.5, leafs.mid, leafs.dark);
    }
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (rand() - 0.5) * 2;
      leaf(g, { x: soil.x, y: soil.y - 2 * S }, a, 18 + rand() * 10, 4.5, leafs.light, leafs.mid);
    }
  } else if (kind === 1) {
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (rand() - 0.5) * 0.9;
      leaf(g, { x: soil.x + (rand() - 0.5) * 12 * S, y: soil.y }, a, 34 + rand() * 18, 3.4, i % 2 === 0 ? leafs.light : leafs.mid, leafs.dark);
    }
  } else {
    const blobs: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < 7; i++) blobs.push({ x: (rand() - 0.5) * 22, y: -14 - rand() * 22, r: 8 + rand() * 5 });
    for (const b of blobs) {
      g.fillStyle(leafs.dark, 1);
      g.fillCircle(soil.x + (b.x + 2) * S, soil.y + (b.y + 2) * S, b.r * S);
    }
    for (const b of blobs) {
      g.fillStyle(leafs.mid, 1);
      g.fillCircle(soil.x + b.x * S, soil.y + b.y * S, b.r * 0.85 * S);
    }
    for (const b of blobs) {
      g.fillStyle(leafs.light, 0.9);
      g.fillCircle(soil.x + (b.x - b.r * 0.3) * S, soil.y + (b.y - b.r * 0.3) * S, b.r * 0.45 * S);
    }
    for (let i = 0; i < 10; i++) {
      const b = blobs[Math.floor(rand() * blobs.length)] ?? { x: 0, y: -20, r: 8 };
      g.fillStyle(leafs.glint, 0.7);
      g.fillCircle(soil.x + (b.x + (rand() - 0.5) * b.r) * S, soil.y + (b.y + (rand() - 0.5) * b.r) * S, 1.3 * S);
    }
  }
}

function lamp(g: G, f: Furniture, layout: RoomLayout, room: RoomKind): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const metal = room === 'mintHall' ? BRASS : 0x4a4450;
  const cloth = room === 'hospital' ? 0xf4f0e4 : 0xf3dcae;
  const bounds = { x1: layout.w - 1, y1: layout.d - 1 };
  for (const [r, alpha] of [[1.5, 0.05], [1.15, 0.05], [0.8, 0.06], [0.45, 0.07]] as const) floorPool(g, x, y, r, WARM, alpha, bounds);
  const head = P(x, y, LAMP_H + 8);
  for (const [r, alpha] of [[34, 0.04], [27, 0.05], [20, 0.06], [13, 0.08]] as const) {
    g.fillStyle(WARM, alpha);
    g.fillCircle(head.x, head.y, r * S);
  }
  floorEllipse(g, x + 0.06, y + 0.02, 0.18, SHADOW, 0.25);
  tube(g, x, y, 0.15, 0.13, 0, 3, metal, lit(metal, 0.3));
  tube(g, x, y, 0.025, 0.025, 3, LAMP_H - 2, metal, null, 2);
  tube(g, x, y, 0.22, 0.13, LAMP_H, 18, cloth, null, 8);
  const top = P(x, y, LAMP_H + 18);
  g.fillStyle(0xfff4d8, 1);
  g.fillEllipse(top.x, top.y, 2 * 0.13 * RX, 2 * 0.13 * RY, 16);
  const rim = P(x, y, LAMP_H);
  g.fillStyle(0xfff1c9, 0.9);
  g.fillEllipse(rim.x, rim.y + 0.12 * RY, 2 * 0.2 * RX, 0.1 * RY, 16);
}

function tableTop(g: G, x: number, y: number, z: number, room: RoomKind, trade: Trade, rand: () => number): void {
  if (trade === 'cafe') {
    for (const [dx, dy] of [[-0.12, -0.08], [0.14, 0.1]] as const) {
      floorEllipse(g, x + dx, y + dy, 0.09, 0xf4f0e8, 1, z);
      tube(g, x + dx, y + dy, 0.05, 0.055, z + 0.5, 5, 0xf8f6f0, 0x5a3420, 8);
    }
    floorEllipse(g, x + 0.12, y - 0.14, 0.11, 0xf4f0e8, 1, z);
    box(g, 'n', x + 0.06, y - 0.2, x + 0.18, y - 0.1, z + 0.5, 5, 0xe8c890, 0xf4e2c0);
    fan(g, 0xc8604a, quad(x + 0.06, y - 0.2, x + 0.18, y - 0.17, z + 5.5));
    return;
  }
  const kind = room === 'shop' ? 3 : Math.floor(rand() * 3);
  if (kind === 0) {
    tube(g, x, y, 0.05, 0.07, z, 12, pick([0x3fa7b5, 0xe8e0d0, 0xc0704a], rand), null, 6);
    const p = P(x, y, z + 12);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      const q = { x: p.x + Math.cos(a) * 9 * S, y: p.y + Math.sin(a) * 9 * S };
      line(g, p, q, 1.2, 0x4b8a4e);
      g.fillStyle(pick([0xe0574b, 0xffc860, 0xf2e6d0, 0xa983ff], rand), 1);
      g.fillCircle(q.x, q.y, 2.6 * S);
    }
  } else if (kind === 1) {
    const p = P(x, y, z);
    g.fillStyle(0xe8e0d0, 1);
    g.fillEllipse(p.x, p.y - 2 * S, 18 * S, 8 * S, 14);
    for (const [dx, col] of [[-4, 0xe0574b], [3, 0xffc860], [0, 0x7fc86a]] as const) {
      g.fillStyle(col, 1);
      g.fillCircle(p.x + dx * S, p.y - (dx === 0 ? 6 : 4) * S, 3.4 * S);
    }
  } else if (kind === 2) {
    tube(g, x - 0.08, y, 0.08, 0.07, z, 8, 0xf2ece0, lit(0xf2ece0, 0.2), 8);
    tube(g, x + 0.14, y + 0.08, 0.04, 0.04, z, 5, 0x3fa7b5, 0x5a3a2a, 6);
  } else {
    for (let i = 0; i < 3; i++) {
      const col = pick(GOODS, rand);
      prism(g, x - 0.18 + i * 0.02, y - 0.14, x + 0.16 + i * 0.02, y + 0.14, z + i * 3, 3, col, lit(col, 0.3));
    }
  }
}

function table(g: G, f: Furniture, room: RoomKind, trade: Trade, rand: () => number): void {
  const x0 = f.c + 0.16;
  const y0 = f.r + 0.16;
  const x1 = f.c + f.w - 0.16;
  const y1 = f.r + f.d - 0.16;
  const wood = room === 'flat' ? pick([0x9a6440, 0x7a4a32, 0xb88a5a], rand) : 0xa8714a;
  contact(g, x0, y0, x1, y1, 0.18);
  for (const [lx, ly] of [[x0 + 0.03, y0 + 0.03], [x1 - 0.09, y0 + 0.03], [x0 + 0.03, y1 - 0.09], [x1 - 0.09, y1 - 0.09]] as const) {
    prism(g, lx, ly, lx + 0.06, ly + 0.06, 0, TABLE_H - 4, shade(wood, 0.1));
  }
  prism(g, x0 + 0.03, y0 + 0.03, x1 - 0.03, y1 - 0.03, TABLE_H - 5, 4, shade(wood, 0.15));
  prism(g, x0 - 0.05, y0 - 0.05, x1 + 0.05, y1 + 0.05, TABLE_H - 1, 3, wood, lit(wood, 0.22));
  fan(g, WHITE, [P(x0, y1 - 0.02, TABLE_H + 2), P(x1, y1 - 0.02, TABLE_H + 2), P(x1, y1 + 0.03, TABLE_H + 2), P(x0, y1 + 0.03, TABLE_H + 2)], 0.15);
  tableTop(g, (x0 + x1) / 2, (y0 + y1) / 2, TABLE_H + 2, room, trade, rand);
}

// A pool of light on the floor, cut to the room's floor so it never spills past the walls.
function floorPool(g: G, x: number, y: number, r: number, col: number, alpha: number, bounds: { x1: number; y1: number }): void {
  const pts: Pt[] = [];
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    pts.push(P(Math.min(bounds.x1, Math.max(1, x + Math.cos(t) * r)), Math.min(bounds.y1, Math.max(1, y + Math.sin(t) * r))));
  }
  fan(g, col, pts, alpha);
}

// Which way a chair faces: toward a table or desk beside it, else away from the nearest wall.
function chairFacing(f: Furniture, layout: RoomLayout): Facing {
  const covers = (o: Furniture, c: number, r: number): boolean => c >= o.c && c < o.c + o.w && r >= o.r && r < o.r + o.d;
  const tableAt = (c: number, r: number): boolean => layout.furniture.some((o) => (o.piece === 'table' || o.piece === 'desk') && covers(o, c, r));
  if (tableAt(f.c, f.r - 1)) return 'n';
  if (tableAt(f.c - 1, f.r)) return 'w';
  if (tableAt(f.c + f.w, f.r)) return 'e';
  if (tableAt(f.c, f.r + f.d)) return 's';
  if (f.c === 1) return 'e';
  if (f.c + f.w === layout.w - 1) return 'w';
  return 's';
}

function chair(g: G, f: Furniture, layout: RoomLayout, room: RoomKind, rand: () => number): void {
  const x0 = f.c + 0.24;
  const y0 = f.r + 0.24;
  const x1 = f.c + f.w - 0.24;
  const y1 = f.r + f.d - 0.24;
  const wood = room === 'flat' ? pick([0x9a6440, 0x7a4a32], rand) : 0x8a5a3a;
  const pad = pick(FABRIC, rand);
  contact(g, x0, y0, x1, y1, 0.16);
  for (const [lx, ly] of [[x0, y0], [x1 - 0.05, y0], [x0, y1 - 0.05], [x1 - 0.05, y1 - 0.05]] as const) prism(g, lx, ly, lx + 0.05, ly + 0.05, 0, SEAT_H, shade(wood, 0.1));
  prism(g, x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, SEAT_H, 3, wood);
  prism(g, x0 + 0.03, y0 + 0.03, x1 - 0.03, y1 - 0.03, SEAT_H + 3, 2, pad, lit(pad, 0.25));
  const t = 0.06;
  const back = {
    s: [x0 - 0.02, y0 - 0.02, x1 + 0.02, y0 - 0.02 + t],
    n: [x0 - 0.02, y1 + 0.02 - t, x1 + 0.02, y1 + 0.02],
    e: [x0 - 0.02, y0 - 0.02, x0 - 0.02 + t, y1 + 0.02],
    w: [x1 + 0.02 - t, y0 - 0.02, x1 + 0.02, y1 + 0.02],
  }[chairFacing(f, layout)];
  const [bx0, by0, bx1, by1] = back;
  if (bx0 === undefined || by0 === undefined || bx1 === undefined || by1 === undefined) return;
  prism(g, bx0, by0, bx1, by1, SEAT_H + 3, CHAIR_BACK - SEAT_H - 3, wood, lit(wood, 0.25));
}

function bed(g: G, f: Furniture, rand: () => number): void {
  const fr: Side = f.d >= f.w ? 'n' : 'w';
  const { a0: s0, a1: s1, b0: h0, b1: h1 } = span(f, fr);
  const a0 = s0 + 0.08;
  const a1 = s1 - 0.08;
  const b0 = h0 + 0.04;
  const b1 = h1 - 0.08;
  const wood = pick([0x8a5a3a, 0x6e4430, 0xb88a5a], rand);
  const blanket = pick(BLANKETS, rand);
  contact(g, f.c + 0.06, f.r + 0.04, f.c + f.w - 0.06, f.r + f.d - 0.06, 0.2);
  box(g, fr, a0, b0, a1, b0 + 0.1, 0, HEADBOARD_H, wood, lit(wood, 0.25));
  plate(g, fr, b0 + 0.102, a0 + 0.1, a1 - 0.1, BED_H + 12, HEADBOARD_H - 8, tone(fr, shade(wood, 0.15)));
  box(g, fr, a0, b0 + 0.1, a1, b1, 0, BED_H, wood);
  box(g, fr, a0 + 0.04, b0 + 0.12, a1 - 0.04, b1 - 0.03, BED_H, 8, 0xf2eee6, 0xfaf8f2);
  const pillows = a1 - a0 > 1.2 ? 2 : 1;
  const pw = (a1 - a0 - 0.14) / pillows;
  for (let i = 0; i < pillows; i++) {
    const pa = a0 + 0.07 + i * pw;
    box(g, fr, pa + 0.03, b0 + 0.16, pa + pw - 0.03, b0 + 0.44, BED_H + 8, 5, 0xe8e4dc, 0xfcfbf8);
  }
  const fold = b0 + (b1 - b0) * 0.42;
  box(g, fr, a0 + 0.02, fold, a1 - 0.02, b1 - 0.01, BED_H - 2, 11.5, blanket, lit(blanket, 0.15));
  const zt = BED_H + 9.5;
  fan(g, 0xfaf8f2, [fp(fr, a0 + 0.02, fold, zt), fp(fr, a1 - 0.02, fold, zt), fp(fr, a1 - 0.02, fold + 0.14, zt), fp(fr, a0 + 0.02, fold + 0.14, zt)]);
  const n = 4;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      if ((i + j) % 2 === 0) continue;
      const qa = a0 + 0.02 + ((a1 - a0 - 0.04) * i) / n;
      const qb = fold + 0.14 + ((b1 - fold - 0.15) * j) / 3;
      fan(g, lit(blanket, 0.3), [fp(fr, qa, qb, zt), fp(fr, qa + (a1 - a0 - 0.04) / n, qb, zt), fp(fr, qa + (a1 - a0 - 0.04) / n, qb + (b1 - fold - 0.15) / 3, zt), fp(fr, qa, qb + (b1 - fold - 0.15) / 3, zt)], 0.5);
    }
  }
}

function sofa(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.06;
  const a1 = s.a1 - 0.06;
  const b0 = s.b0 + 0.06;
  const b1 = s.b1 - 0.1;
  const col = pick(FABRIC, rand);
  const accent = pick(GOODS, rand);
  contact(g, f.c + 0.04, f.r + 0.04, f.c + f.w - 0.06, f.r + f.d - 0.08, 0.22);
  box(g, fr, a0, b0, a1, b0 + 0.24, 0, SOFA_BACK, col, lit(col, 0.2));
  box(g, fr, a0, b0 + 0.24, a0 + 0.16, b1, 0, 26, col, lit(col, 0.2));
  box(g, fr, a0 + 0.16, b0 + 0.24, a1 - 0.16, b1, 0, SOFA_SEAT, shade(col, 0.2));
  const n = Math.max(1, Math.round(a1 - a0));
  const w = (a1 - a0 - 0.32) / n;
  for (let i = 0; i < n; i++) {
    const ca = a0 + 0.16 + i * w;
    box(g, fr, ca + 0.01, b0 + 0.2, ca + w - 0.01, b0 + 0.36, SOFA_SEAT + 8, 18, lit(col, 0.06), lit(col, 0.2));
    box(g, fr, ca + 0.01, b0 + 0.26, ca + w - 0.01, b1 - 0.02, SOFA_SEAT, 8, col, lit(col, 0.18));
  }
  box(g, fr, a0 + 0.22, b0 + 0.36, a0 + 0.42, b0 + 0.44, SOFA_SEAT + 8, 13, accent, lit(accent, 0.3));
  box(g, fr, a1 - 0.16, b0 + 0.24, a1, b1, 0, 26, col, lit(col, 0.2));
  for (const a of [a0 + 0.04, a1 - 0.1]) box(g, fr, a, b1 - 0.06, a + 0.06, b1, 0, 3, 0x3a2a24);
  if (fr === 'e') {
    box(g, fr, a0, b0, a1, b0 + 0.24, 0, SOFA_BACK, col, lit(col, 0.2));
    for (let a = a0 + 0.3; a < a1 - 0.2; a += 0.5) line(g, fp(fr, a, b0, 6), fp(fr, a, b0, SOFA_BACK - 4), 1, shade(col, 0.3), 0.5);
  }
}

function column(g: G, f: Furniture, room: RoomKind): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const h = WALL_H[room];
  const stone = 0xf1e8d8;
  const r = COLUMN_R * Math.min(f.w, f.d);
  fan(g, SHADOW, [P(x - 0.3, y - 0.3), P(x + 0.9, y - 0.2), P(x + 1, y + 0.3), P(x - 0.3, y + 0.42)], 0.12);
  prism(g, x - 0.42, y - 0.42, x + 0.42, y + 0.42, 0, 8, shade(stone, 0.08), lit(stone, 0.2));
  tube(g, x, y, 0.36, 0.33, 8, 5, stone, null, 10);
  tube(g, x, y, r + 0.02, r, 13, h - 31, stone, null, 14, true);
  tube(g, x, y, r, r + 0.1, h - 18, 7, stone, null, 10);
  prism(g, x - 0.42, y - 0.42, x + 0.42, y + 0.42, h - 11, 9, stone, lit(stone, 0.25));
  fan(g, GOLD, [P(x - 0.42, y + 0.42, h - 8), P(x + 0.42, y + 0.42, h - 8), P(x + 0.42, y + 0.42, h - 6), P(x - 0.42, y + 0.42, h - 6)], 0.8);
}

function vaultDoor(g: G, f: Furniture, layout: RoomLayout): void {
  const fr = frameOf(f, layout);
  const { a0, a1, b0, b1 } = span(f, fr);
  const uc = (a0 + a1) / 2;
  const ru = Math.min(VAULT_R, (a1 - a0) / 2 - 0.3);
  const rz = ru * ROUND;
  const zc = rz + 10;
  const steel = 0x9aa0aa;
  const plateCol = 0x5a5e66;
  fan(g, plateCol, [fp(fr, uc - ru - 0.1, b0 + 0.1, 0.5), fp(fr, uc + ru + 0.1, b0 + 0.1, 0.5), fp(fr, uc + ru + 0.1, b1 - 0.15, 0.5), fp(fr, uc - ru - 0.1, b1 - 0.15, 0.5)]);
  for (let a = uc - ru; a < uc + ru; a += 0.14) line(g, fp(fr, a, b0 + 0.15, 0.5), fp(fr, a + 0.06, b1 - 0.2, 0.5), 1, lit(plateCol, 0.25), 0.6);
  box(g, fr, uc - ru - 0.24, b0, uc + ru + 0.24, b0 + 0.08, 0, zc + rz + 14, shade(steel, 0.1), lit(steel, 0.2));
  const pl = b0 + 0.081;
  fan(g, tone(fr, 0x2a2c34), ring(fr, pl, uc, zc, ru + 0.12, 28));
  fan(g, tone(fr, lit(steel, 0.1)), ring(fr, pl + 0.01, uc, zc, ru + 0.07, 28));
  fan(g, tone(fr, 0x2a2c34), ring(fr, pl + 0.012, uc, zc, ru + 0.01, 28));
  fan(g, shade(steel, 0.45), ring(fr, pl + 0.04, uc, zc, ru - 0.02, 28));
  fan(g, tone(fr, steel), ring(fr, pl + 0.08, uc, zc, ru - 0.02, 28));
  fan(g, tone(fr, shade(steel, 0.18)), ring(fr, pl + 0.081, uc, zc, ru * 0.74, 24));
  fan(g, tone(fr, lit(steel, 0.08)), ring(fr, pl + 0.082, uc, zc, ru * 0.69, 24));
  fan(g, WHITE, [...ring(fr, pl + 0.083, uc, zc, ru * 0.95, 8, Math.PI * 0.55, Math.PI * 1.05, false), ...ring(fr, pl + 0.083, uc, zc, ru * 0.82, 8, Math.PI * 1.05, Math.PI * 0.55, false)], 0.25);
  const face = pl + 0.084;
  for (let i = 0; i < 14; i++) {
    const t = (i / 14) * Math.PI * 2;
    const p = fp(fr, uc + Math.cos(t) * ru * 0.86, face, zc + Math.sin(t) * rz * 0.86);
    g.fillStyle(0x4a4e56, 1);
    g.fillCircle(p.x, p.y, 2.6 * S);
    g.fillStyle(0xdfe3ea, 1);
    g.fillCircle(p.x - 0.7 * S, p.y - 0.7 * S, 1.1 * S);
  }
  for (const dz of [rz * 0.5, -rz * 0.5]) {
    plate(g, fr, face, uc + ru * 0.9, uc + ru * 1.12, zc + dz - 7, zc + dz + 7, tone(fr, 0x6a6e78));
    plate(g, fr, face, uc + ru * 0.9, uc + ru * 1.12, zc + dz + 5, zc + dz + 7, tone(fr, lit(steel, 0.3)));
  }
  const c = fp(fr, uc, face, zc);
  const wr = ru * 0.36;
  strokeRing(g, ring(fr, face, uc, zc, wr, 20), 3 * S, 0x5a5e68);
  strokeRing(g, ring(fr, face, uc, zc, wr, 20), 1.2 * S, 0xe4e8ee, 0.7);
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * Math.PI + 0.3;
    const p = fp(fr, uc + Math.cos(t) * wr * 1.25, face, zc + Math.sin(t) * wr * 1.25 * ROUND);
    const q = fp(fr, uc - Math.cos(t) * wr * 1.25, face, zc - Math.sin(t) * wr * 1.25 * ROUND);
    line(g, p, q, 2.6 * S, 0x5a5e68);
    for (const k of [p, q]) {
      g.fillStyle(0x3a3e46, 1);
      g.fillCircle(k.x, k.y, 2.4 * S);
    }
  }
  g.fillStyle(0x5a5e68, 1);
  g.fillCircle(c.x, c.y, 6 * S);
  g.fillStyle(lit(steel, 0.3), 1);
  g.fillCircle(c.x - 1 * S, c.y - 1 * S, 3.4 * S);
  const kp = uc - ru - 0.5;
  plate(g, fr, b0 + 0.01, kp, kp + 0.18, 42, 62, tone(fr, 0x3a3e46));
  plate(g, fr, b0 + 0.012, kp + 0.03, kp + 0.15, 54, 59, tone(fr, 0x7fc8e8));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) plate(g, fr, b0 + 0.012, kp + 0.03 + j * 0.065, kp + 0.08 + j * 0.065, 45 + i * 3, 47 + i * 3, tone(fr, 0xb8bcc4));
  const led = fp(fr, kp + 0.09, b0 + 0.012, 65);
  g.fillStyle(0x7fe07a, 1);
  g.fillCircle(led.x, led.y, 1.4 * S);
}

function noticeBoard(g: G, f: Furniture, layout: RoomLayout, room: RoomKind, rand: () => number): void {
  const side = frameOf(f, layout);
  const { a0: s0, a1: s1, b0 } = span(f, side);
  const a0 = s0 + 0.1;
  const a1 = s1 - 0.1;
  const frame = room === 'hospital' ? 0xd8dce0 : 0x6e4430;
  const z0 = 30;
  const z1 = 88;
  if (side === 'n') contact(g, f.c + 0.04, f.r + 0.06, f.c + f.w, f.r + 0.4, 0.16);
  else if (side === 'w') contact(g, f.c + 0.04, f.r + 0.06, f.c + 0.4, f.r + f.d, 0.16);
  else contact(g, f.c + f.w - 0.4, f.r + 0.06, f.c + f.w, f.r + f.d, 0.16);
  for (const a of [a0 + 0.1, a1 - 0.16]) box(g, side, a, b0 + 0.1, a + 0.06, b0 + 0.18, 0, z0, shade(frame, 0.1));
  box(g, side, a0, b0 + 0.08, a1, b0 + 0.18, z0, z1 - z0, frame, lit(frame, 0.3));
  if (side === 'e') return;
  const pl = b0 + 0.182;
  plate(g, side, pl, a0 + 0.05, a1 - 0.05, z0 + 3, z1 - 3, tone(side, 0xc89a62, 0.3));
  for (let i = 0; i < (a1 - a0) * 30; i++) {
    const u = a0 + 0.06 + rand() * (a1 - a0 - 0.12);
    const z = z0 + 4 + rand() * (z1 - z0 - 8);
    plate(g, side, pl + 0.0005, u, u + 0.02, z, z + 0.8, tone(side, rand() > 0.5 ? 0x9a6a3a : 0xe0b880, 0.3), 0.7);
  }
  const notes = Math.max(3, Math.round((a1 - a0) * 4.2));
  for (let i = 0; i < notes; i++) {
    const hw = 0.08 + rand() * 0.04;
    const hz = 6 + rand() * 3;
    const u = a0 + 0.1 + hw + ((a1 - a0 - 0.2 - 2 * hw) * (i + rand() * 0.6)) / notes;
    const z = z0 + 6 + hz + rand() * (z1 - z0 - 12 - 2 * hz);
    const ang = (rand() - 0.5) * 0.3;
    const corner = (du: number, dz: number): [number, number] => {
      const px = du * ROUND;
      return [u + (px * Math.cos(ang) - dz * Math.sin(ang)) / ROUND, z + px * Math.sin(ang) + dz * Math.cos(ang)];
    };
    const col = pick(NOTES, rand);
    poly(g, side, pl + 0.001, [corner(-hw + 0.01, -hz - 1.2), corner(hw + 0.01, -hz - 1.2), corner(hw + 0.01, hz - 1.2), corner(-hw + 0.01, hz - 1.2)], SHADOW, 0.2);
    poly(g, side, pl + 0.002, [corner(-hw, -hz), corner(hw, -hz), corner(hw, hz), corner(-hw, hz)], tone(side, col, 0.25));
    for (let k = 0; k < 3; k++) {
      const [ua, za] = corner(-hw * 0.7, hz * 0.4 - k * 3.4);
      const [ub, zb] = corner(hw * (0.3 + rand() * 0.4), hz * 0.4 - k * 3.4);
      line(g, fp(side, ua, pl + 0.003, za), fp(side, ub, pl + 0.003, zb), 1, 0x5a5a7a, 0.55);
    }
    const [pu, pz] = corner(0, hz - 2);
    const pin = fp(side, pu, pl + 0.004, pz);
    g.fillStyle(pick([0xe0574b, 0x3fa7b5, 0xffc860], rand), 1);
    g.fillCircle(pin.x, pin.y, 1.8 * S);
  }
}

function bench(g: G, f: Furniture, layout: RoomLayout, room: RoomKind): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.06;
  const a1 = s.a1 - 0.06;
  const b0 = s.b0 + 0.22;
  const b1 = s.b1 - 0.22;
  const wood = room === 'mintHall' ? 0x6a3e2a : room === 'hospital' ? 0xc8a070 : 0xa8714a;
  const iron = room === 'hospital' ? 0x9aa4ae : 0x3a3640;
  contact(g, f.c + 0.06, f.r + 0.2, f.c + f.w - 0.06, f.r + f.d - 0.2, 0.18);
  for (const a of [a0 + 0.12, a1 - 0.2]) {
    box(g, fr, a, b0 + 0.02, a + 0.06, b0 + 0.08, 0, BENCH_H, iron);
    box(g, fr, a, b1 - 0.08, a + 0.06, b1 - 0.02, 0, BENCH_H, iron);
    box(g, fr, a, b0 + 0.02, a + 0.06, b1 - 0.02, BENCH_H - 4, 3, iron);
  }
  const slats = 3;
  const sw = (b1 - b0) / slats;
  for (let i = 0; i < slats; i++) box(g, fr, a0, b0 + i * sw + 0.012, a1, b0 + (i + 1) * sw - 0.012, BENCH_H, 3, wood, lit(wood, 0.22));
}

function desk(g: G, f: Furniture, layout: RoomLayout, room: RoomKind, rand: () => number): void {
  const fr = frameOf(f, layout);
  const { a0, a1, b0, b1 } = span(f, fr);
  const hospital = room === 'hospital';
  const body = hospital ? 0xf2f2ee : 0x8a5a3a;
  const top = hospital ? 0xc8d8d4 : 0xb88a5a;
  contact(g, f.c + 0.06, f.r + 0.08, f.c + f.w - 0.06, f.r + f.d - 0.04, 0.2);
  box(g, fr, a0 + 0.06, b0 + 0.14, a1 - 0.06, b1 - 0.06, 0, DESK_H, body);
  const front = b1 - 0.06 + 0.002;
  if (hospital) {
    plate(g, fr, front, a0 + 0.06, a1 - 0.06, 8, 13, tone(fr, 0x3fa7a0));
    const m = (a0 + a1) / 2;
    plate(g, fr, front + 0.001, m - 6.5 / ROUND, m + 6.5 / ROUND, 17.5, 22.5, tone(fr, 0xe0574b));
    plate(g, fr, front + 0.001, m - 2.5 / ROUND, m + 2.5 / ROUND, 13.5, 26.5, tone(fr, 0xe0574b));
  } else {
    for (const a of [a0 + 0.12, a1 - 0.62]) for (let k = 0; k < 3; k++) plate(g, fr, front, a, a + 0.5, 4 + k * 8.5, 11 + k * 8.5, tone(fr, shade(body, 0.1)));
  }
  box(g, fr, a0, b0 + 0.08, a1, b1, DESK_H, 3, shade(top, 0.15), top);
  const zt = DESK_H + 3;
  const am = a0 + (a1 - a0) * 0.62;
  const bm = b0 + 0.42;
  box(g, fr, am - 0.13, bm - 0.1, am + 0.13, bm + 0.06, zt, 1.5, 0x3a3e46);
  box(g, fr, am - 0.03, bm - 0.04, am + 0.03, bm, zt + 1.5, 7, 0x3a3e46);
  box(g, fr, am - 0.27, bm - 0.02, am + 0.27, bm + 0.03, zt + 8, 22, 0x2e323a, 0x4a4e58);
  plate(g, fr, bm + 0.032, am - 0.24, am + 0.24, zt + 10.5, zt + 27.5, tone(fr, 0x5aa8d0, 0.1));
  for (let k = 0; k < 3; k++) plate(g, fr, bm + 0.033, am - 0.2, am - 0.2 + 0.18 + rand() * 0.2, zt + 23 - k * 4, zt + 24.5 - k * 4, tone(fr, 0xd8f0ff, 0.1), 0.8);
  box(g, fr, am - 0.2, bm + 0.14, am + 0.2, bm + 0.28, zt, 1.5, 0xd9dde2, 0xeef0f2);
  for (let i = 0; i < 3; i++) {
    const pa = a0 + 0.2 + i * 0.16 + rand() * 0.06;
    const pb = b0 + 0.3 + rand() * 0.2;
    const sk = (rand() - 0.5) * 0.1;
    fan(g, i === 2 ? 0xfff4c8 : 0xfafaf6, [fp(fr, pa, pb, zt + 0.3 + i * 0.3), fp(fr, pa + 0.26, pb + sk, zt + 0.3 + i * 0.3), fp(fr, pa + 0.26 - sk, pb + 0.32 + sk, zt + 0.3 + i * 0.3), fp(fr, pa - sk, pb + 0.32, zt + 0.3 + i * 0.3)]);
  }
  const [cx, cy] = xy(fr, a1 - 0.25, b0 + 0.4);
  tube(g, cx, cy, 0.06, 0.06, zt, 8, 0x3fa7b5, 0x2a3040, 6);
  const top0 = P(cx, cy, zt + 8);
  line(g, top0, { x: top0.x - 2 * S, y: top0.y - 7 * S }, 1.4, 0xe0574b);
  line(g, top0, { x: top0.x + 2 * S, y: top0.y - 6 * S }, 1.4, 0x2a2238);
}

function hospitalBed(g: G, f: Furniture): void {
  const fr: Side = f.d >= f.w ? 'n' : 'w';
  const { a0: s0, a1: s1, b0: h0, b1: h1 } = span(f, fr);
  const a0 = s0 + 0.14;
  const a1 = s1 - 0.14;
  const b0 = h0 + 0.06;
  const b1 = h1 - 0.1;
  const metal = 0xc8ccd4;
  const blanket = 0x9cc4e4;
  contact(g, f.c + 0.1, f.r + 0.06, f.c + f.w - 0.1, f.r + f.d - 0.08, 0.18);
  box(g, fr, a0, b0, a1, b0 + 0.06, 0, 44, metal, lit(metal, 0.3));
  plate(g, fr, b0 + 0.062, a0 + 0.06, a1 - 0.06, 24, 40, tone(fr, 0xe8eef4));
  for (const [a, b] of [[a0 + 0.02, b0 + 0.1], [a1 - 0.07, b0 + 0.1], [a0 + 0.02, b1 - 0.07], [a1 - 0.07, b1 - 0.07]] as const) {
    box(g, fr, a, b, a + 0.05, b + 0.05, 3, 13, shade(metal, 0.15));
    const w = fp(fr, a + 0.025, b + 0.025, 2);
    g.fillStyle(0x3a3640, 1);
    g.fillCircle(w.x, w.y, 2.4 * S);
  }
  box(g, fr, a0, b0 + 0.06, a1, b1, 14, 4, metal);
  box(g, fr, a0 + 0.02, b0 + 0.08, a1 - 0.02, b1 - 0.02, 18, 6, 0xf4f6f8, 0xfdfdfd);
  box(g, fr, a0 + 0.06, b0 + 0.12, a1 - 0.06, b0 + 0.42, 24, 5, 0xeceef2, WHITE);
  const fold = b0 + (b1 - b0) * 0.4;
  box(g, fr, a0, fold, a1, b1 - 0.01, 16, 9, blanket, lit(blanket, 0.15));
  fan(g, WHITE, [fp(fr, a0, fold, 25), fp(fr, a1, fold, 25), fp(fr, a1, fold + 0.12, 25), fp(fr, a0, fold + 0.12, 25)]);
  for (const a of [a0 - 0.01, a1 - 0.02]) {
    box(g, fr, a, fold - 0.1, a + 0.03, fold - 0.07, 18, 12, metal);
    box(g, fr, a, b1 - 0.4, a + 0.03, b1 - 0.37, 18, 12, metal);
    box(g, fr, a, fold - 0.1, a + 0.03, b1 - 0.37, 30, 2.5, lit(metal, 0.1));
  }
  box(g, fr, a0, b1 - 0.05, a1, b1, 14, 22, metal, lit(metal, 0.3));
  plate(g, fr, b1 + 0.002, a0 + 0.06, a1 - 0.06, 20, 32, tone(fr, 0xe8eef4));
  const nearWall = fr === 'n' ? f.c === 1 : f.r === 1;
  const sa = nearWall ? s1 - 0.06 : s0 + 0.06;
  const sb = h0 + 0.22;
  const [px, py] = xy(fr, sa, sb);
  const foot = P(px, py, 1);
  for (const [dx, dy] of [[-7, 2], [7, 2], [-3, 4], [3, -2]] as const) line(g, foot, { x: foot.x + dx * S, y: foot.y + dy * S }, 1.6 * S, 0x8a8e96);
  const topP = P(px, py, 88);
  line(g, foot, topP, 1.8 * S, 0xb8bcc4);
  line(g, { x: topP.x - 7 * S, y: topP.y }, { x: topP.x + 7 * S, y: topP.y }, 1.4 * S, 0xb8bcc4);
  const bag = { x: topP.x - 5 * S, y: topP.y + 2 * S };
  g.fillStyle(0xe4f2fa, 0.9);
  g.fillRoundedRect(bag.x - 5 * S, bag.y, 10 * S, 14 * S, 3 * S);
  g.fillStyle(0xb4dcf0, 0.9);
  g.fillRoundedRect(bag.x - 4 * S, bag.y + 5 * S, 8 * S, 8 * S, 2.5 * S);
  const to = fp(fr, (a0 + a1) / 2, b0 + 0.6, 26);
  g.lineStyle(1, 0xd8eef8, 0.9);
  g.beginPath();
  g.moveTo(bag.x, bag.y + 14 * S);
  g.lineTo(bag.x + (to.x - bag.x) * 0.3, bag.y + 14 * S + (to.y - bag.y) * 0.6);
  g.lineTo(to.x, to.y);
  g.strokePath();
}

// ---------- Shop wares ----------

// A hat sitting at (x, y, z), `s` its size: 0 fedora, 1 bowler, 2 boater, 3 sun hat.
function hat(g: G, x: number, y: number, z: number, kind: number, col: number, s: number, rand: () => number): void {
  const pale = col === 0xe8d49a || col === 0xf2ece0 || col === 0xc8a070;
  const band = pale ? pick([0x2f3a4a, 0x8a2f3a, 0x3f6a3a], rand) : shade(col, 0.5);
  const brim = (kind === 3 ? 0.17 : kind === 1 ? 0.1 : 0.13) * s;
  const crown = (kind === 3 ? 0.07 : 0.075) * s;
  const ch = (kind === 2 ? 5 : kind === 3 ? 5.5 : 8) * s;
  floorEllipse(g, x, y, brim, shade(col, 0.3), 1, z);
  floorEllipse(g, x - brim * 0.06, y - brim * 0.06, brim * 0.88, lit(col, 0.1), 1, z + 0.7);
  if (kind === 1) {
    tube(g, x, y, crown, crown * 0.92, z + 0.7, ch * 0.55, col, null, 8);
    const top = P(x, y, z + 0.7 + ch * 0.55);
    g.fillStyle(col, 1);
    g.fillEllipse(top.x, top.y - 1.2 * s * S, 2 * crown * 0.92 * RX, 2 * crown * 0.92 * RY + 4 * s * S, 14);
    g.fillStyle(lit(col, 0.3), 0.8);
    g.fillEllipse(top.x - 1.6 * s * S, top.y - 2.4 * s * S, 4 * s * S, 2.4 * s * S, 8);
  } else {
    tube(g, x, y, crown, crown * 0.9, z + 0.7, ch, col, kind === 0 ? shade(col, 0.15) : lit(col, 0.22), 8);
    if (kind === 0) {
      const top = P(x, y, z + 0.7 + ch);
      g.fillStyle(shade(col, 0.35), 1);
      g.fillEllipse(top.x, top.y, 2 * crown * 0.5 * RX, crown * 0.4 * RY, 8);
    }
  }
  tube(g, x, y, crown * 1.03, crown * 1.01, z + 0.7, 2 * s, band, null, 8);
}

function hatBox(g: G, x: number, y: number, z: number, r: number, h: number, col: number, rand: () => number): void {
  const ribbon = pick([0xe0574b, 0x2f3a4a, 0xf2e6d0, 0xd9a440], rand);
  floorEllipse(g, x + 0.03, y + 0.02, r * 1.1, SHADOW, 0.2, z);
  tube(g, x, y, r, r, z, h - 2.5, col, null, 12, true);
  tube(g, x, y, r * 1.06, r * 1.06, z + h - 3, 3, lit(col, 0.08), lit(col, 0.3), 12);
  line(g, P(x - r * 1.06, y, z + h), P(x + r * 1.06, y, z + h), 1.6 * S, ribbon, 0.9);
  line(g, P(x, y - r * 1.06, z + h), P(x, y + r * 1.06, z + h), 1.6 * S, ribbon, 0.9);
  const knot = P(x, y, z + h);
  g.fillStyle(ribbon, 1);
  g.fillEllipse(knot.x - 2.6 * S, knot.y - 1.2 * S, 5 * S, 3.4 * S, 8);
  g.fillEllipse(knot.x + 2.6 * S, knot.y - 1.2 * S, 5 * S, 3.4 * S, 8);
}

// A bolt of cloth lying along a, its round end turned to the eye.
function bolt(g: G, fr: Fr, a0: number, a1: number, bc: number, z: number, r: number, col: number): void {
  const rz = r * ROUND;
  const n = 5;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const half = r * Math.sqrt(Math.max(0.05, 1 - (2 * t - 1) * (2 * t - 1)));
    const c = k < 2 ? shade(col, 0.2 - k * 0.1) : lit(col, (k - 2) * 0.12);
    box(g, fr, a0, bc - half, a1, bc + half, z + (2 * rz * k) / n, (2 * rz) / n + 0.2, c, c);
  }
  line(g, fp(fr, a0 + 0.02, bc - r * 0.3, z + 2 * rz), fp(fr, a1 - 0.02, bc - r * 0.3, z + 2 * rz), 1, WHITE, 0.35);
  const disc = (k: number): [number, number][] => Array.from({ length: 14 }, (_, i) => [bc + Math.cos((i / 14) * Math.PI * 2) * r * k, z + rz + Math.sin((i / 14) * Math.PI * 2) * rz * k]);
  across(g, fr, a1, disc(1), lit(col, 0.12));
  across(g, fr, a1 + 0.001, disc(0.35), shade(col, 0.35));
}

function glassDome(g: G, x: number, y: number, z: number, r: number, h: number): void {
  const base = P(x, y, z);
  g.fillStyle(0xe8f4f8, 0.16);
  g.fillEllipse(base.x, base.y - (h * S) / 2, 2 * r * RX, h * S + r * RY, 18);
  g.fillStyle(WHITE, 0.4);
  g.fillEllipse(base.x - r * RX * 0.45, base.y - h * S * 0.62, r * RX * 0.3, h * S * 0.4, 10);
  g.lineStyle(1, WHITE, 0.35);
  g.strokeEllipse(base.x, base.y, 2 * r * RX, 2 * r * RY, 18);
  g.fillStyle(0xd8e4ea, 0.9);
  g.fillCircle(base.x, base.y - h * S - r * RY * 0.4, 1.6 * S);
}

function cake(g: G, x: number, y: number, z: number, r: number, rand: () => number): void {
  const sponge = pick([0xd9a86a, 0x8a5a3a, 0xf0d8a8], rand);
  const icing = pick([0xf4b8c8, 0x6a3a2a, 0xfaf6ee, 0xffd27a], rand);
  floorEllipse(g, x, y, r * 1.35, 0xf8f6f0, 1, z);
  tube(g, x, y, r, r, z + 0.5, 3, sponge, null, 10);
  tube(g, x, y, r, r, z + 3.5, 1.2, 0xfaf6ee, null, 10);
  tube(g, x, y, r, r, z + 4.7, 2.6, sponge, icing, 10);
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2 + rand();
    const p = P(x + Math.cos(t) * r * 0.6, y + Math.sin(t) * r * 0.6, z + 7.3);
    g.fillStyle(0xc8323a, 1);
    g.fillCircle(p.x, p.y, 1.3 * S);
  }
}

// What a shop's counter carries beside the till, by its trade, laid out from a0 to a1 along the counter.
function counterWares(g: G, fr: Fr, trade: ShopTrade, a0: number, a1: number, b0: number, b1: number, z: number, rand: () => number): void {
  const bm = (b0 + b1) / 2;
  const room = a1 - a0;
  switch (trade) {
    case 'cafe': {
      const mb0 = b0 + 0.02;
      const mb1 = b0 + 0.36;
      box(g, fr, a0, mb0, a0 + 0.44, mb1, z, 15, CHROME, lit(CHROME, 0.25));
      box(g, fr, a0 - 0.01, mb0 - 0.01, a0 + 0.45, mb1 + 0.01, z + 15, 2, 0x3a3640, 0x4a4650);
      plate(g, fr, mb1 + 0.002, a0 + 0.04, a0 + 0.4, z + 9, z + 13, tone(fr, 0x3a3640));
      plate(g, fr, mb1 + 0.003, a0 + 0.32, a0 + 0.36, z + 10.5, z + 11.5, 0xe0574b);
      if (fr !== 'e') {
        box(g, fr, a0 + 0.04, mb1, a0 + 0.4, mb1 + 0.1, z, 1.5, 0x8a8e96, 0x6a6e76);
        for (const a of [a0 + 0.1, a0 + 0.26]) {
          box(g, fr, a, mb1, a + 0.08, mb1 + 0.06, z + 6, 2.5, 0x2a2a30);
          const [cx, cy] = xy(fr, a + 0.04, mb1 + 0.06);
          tube(g, cx, cy, 0.035, 0.04, z + 1.5, 3.5, 0xf8f6f0, 0x5a3420, 6);
        }
      }
      for (const a of [a0 + 0.12, a0 + 0.3]) {
        const [cx, cy] = xy(fr, a, (mb0 + mb1) / 2);
        tube(g, cx, cy, 0.04, 0.045, z + 17, 3.5, 0xf8f6f0, 0xf0ece4, 6);
      }
      if (room > 0.8) {
        const [cx, cy] = xy(fr, a0 + 0.72, bm + 0.04);
        tube(g, cx, cy, 0.045, 0.025, z, 6, 0xf4f0e8, null, 6);
        cake(g, cx, cy, z + 6, 0.1, rand);
        glassDome(g, cx, cy, z + 6.2, 0.15, 13);
      }
      if (room > 1.4) {
        const [cx, cy] = xy(fr, a0 + 1.1, bm + 0.08);
        floorEllipse(g, cx, cy, 0.16, 0xf8f6f0, 1, z);
        for (let i = 0; i < 3; i++) {
          const p = P(cx - 0.06 + i * 0.06, cy - 0.04 + (i % 2) * 0.07, z + 1.5);
          g.fillStyle(0xc8843a, 1);
          g.fillEllipse(p.x, p.y, 9 * S, 4.4 * S, 10);
          g.fillStyle(0xe8b060, 1);
          g.fillEllipse(p.x - 1 * S, p.y - 1 * S, 6 * S, 2.6 * S, 8);
        }
      }
      return;
    }
    case 'barber': {
      const [jx, jy] = xy(fr, a0 + 0.14, bm - 0.05);
      tube(g, jx, jy, 0.075, 0.075, z, 7, 0x2f9fc0, lit(0x2f9fc0, 0.3), 8);
      for (let i = 0; i < 4; i++) {
        const dx = (i - 1.5) * 0.03;
        const p = P(jx + dx, jy, z + 5);
        const q = P(jx + dx * 2.2, jy - 0.02, z + 17 + (i % 2) * 2);
        line(g, p, q, 2.2 * S, i % 2 === 0 ? 0x2a2a30 : 0x8a4a2a);
      }
      const jb = P(jx, jy, z);
      const jt = P(jx, jy, z + 11);
      g.fillStyle(0xe8f4f8, 0.22);
      g.fillRect(jb.x - 0.08 * RX, jt.y, 0.16 * RX, jb.y - jt.y);
      g.fillEllipse(jb.x, jb.y, 0.16 * RX, 0.16 * RY, 12);
      g.lineStyle(1, WHITE, 0.6);
      g.strokeEllipse(jt.x, jt.y, 0.16 * RX, 0.16 * RY, 12);
      line(g, { x: jb.x - 0.055 * RX, y: jb.y - 1 * S }, { x: jt.x - 0.055 * RX, y: jt.y + 1 * S }, 1.2 * S, WHITE, 0.55);
      const c = fp(fr, a0 + 0.46, bm + 0.08, z + 0.5);
      for (const s of [-1, 1] as const) {
        line(g, c, { x: c.x + 13 * S, y: c.y + s * 2.4 * S }, 1.6 * S, 0xd8dce4);
        g.lineStyle(1.4 * S, 0x2a2a30, 1);
        g.strokeEllipse(c.x - 5 * S, c.y + s * 3 * S, 6 * S, 4 * S, 10);
      }
      if (room > 0.8) {
        const [bx, by] = xy(fr, a0 + 0.74, bm - 0.08);
        tube(g, bx, by, 0.05, 0.05, z, 12, 0xf2f2ee, 0xe0574b, 6);
        tube(g, bx, by, 0.02, 0.02, z + 12, 3, 0x2a2a30, 0x4a4a52, 3);
      }
      return;
    }
    case 'hats': {
      const [hx, hy] = xy(fr, a0 + 0.2, bm);
      hatBox(g, hx, hy, z, 0.16, 11, pick([0xf2e6d0, 0xc8e4ff, 0xffc8c8, 0x2f3a4a], rand), rand);
      if (rand() < 0.7) hat(g, hx, hy, z + 11.5, Math.floor(rand() * 4), pick(HATS, rand), 0.9, rand);
      if (room > 0.8) {
        const [sx, sy] = xy(fr, a0 + 0.62, bm + 0.04);
        hatBox(g, sx, sy, z, 0.12, 8, pick([0xe0574b, 0x3fa7b5, 0xf2ece0], rand), rand);
      }
      return;
    }
    case 'surf': {
      for (let i = 0; i < 3; i++) {
        const col = pick([0xf2e6d0, 0xc8e4ff, 0xffc8c8, 0xffe27a, 0xc8f0c0], rand);
        const a = a0 + i * 0.15;
        const b = bm - 0.16 + (i % 2) * 0.08;
        box(g, fr, a, b, a + 0.13, b + 0.17, z, 6, col, lit(col, 0.3));
        const [cx, cy] = xy(fr, a + 0.065, b + 0.085);
        fan(g, pick([0x3fa7b5, 0xe0574b, 0x2f3a4a], rand), quad(cx - 0.04, cy - 0.035, cx + 0.04, cy + 0.035, z + 6));
      }
      const c = fp(fr, a0 + 0.62, bm + 0.06, z + 0.6);
      g.fillStyle(SHADOW, 0.2);
      g.fillEllipse(c.x + 2 * S, c.y + 1.4 * S, 22 * S, 7 * S, 12);
      for (const s of [-1, 1] as const) {
        g.fillStyle(0x1e2228, 1);
        g.fillEllipse(c.x + s * 5.2 * S, c.y, 9 * S, 5.6 * S, 12);
        g.fillStyle(0x5a8fd6, 0.45);
        g.fillEllipse(c.x + s * 5.2 * S - 1.6 * S, c.y - 1 * S, 3.4 * S, 2 * S, 8);
        line(g, { x: c.x + s * 9.4 * S, y: c.y - 1 * S }, { x: c.x + s * 12 * S, y: c.y - 6 * S }, 1.2 * S, 0x1e2228);
      }
      line(g, { x: c.x - 1 * S, y: c.y - 1 * S }, { x: c.x + 1 * S, y: c.y - 1 * S }, 1.4 * S, 0x1e2228);
      return;
    }
    case 'tailor': {
      const cols = [pick(FABRIC, rand), pick(SUITS, rand), pick(FABRIC, rand)];
      const len = Math.min(0.62, room - 0.25);
      bolt(g, fr, a0, a0 + len, bm - 0.1, z, 0.07, cols[0] ?? 0x3f7f86);
      bolt(g, fr, a0 + 0.04, a0 + len - 0.04, bm + 0.06, z, 0.07, cols[1] ?? 0x2f3a4a);
      bolt(g, fr, a0 + 0.08, a0 + len - 0.1, bm - 0.02, z + 0.14 * ROUND, 0.07, cols[2] ?? 0xc89a3a);
      const ta = a0 + len + 0.12;
      if (ta < a1 - 0.05) {
        const [cx, cy] = xy(fr, ta, bm + 0.1);
        floorEllipse(g, cx, cy, 0.06, 0xf0c040, 1, z + 2);
        tube(g, cx, cy, 0.06, 0.06, z, 2, 0xf0c040, 0xf0c040, 8);
        floorEllipse(g, cx, cy, 0.022, 0x8a6a2a, 1, z + 2.1);
        const p = fp(fr, ta, bm + 0.16, z + 0.5);
        const q = fp(fr, ta - 0.3, bm + 0.24, z + 0.5);
        line(g, p, q, 2.2 * S, 0xf0c040);
        line(g, q, { x: q.x - 4 * S, y: q.y + 6 * S }, 2.2 * S, 0xf0c040);
        if (ta + 0.2 < a1) {
          const [px, py] = xy(fr, ta + 0.2, bm - 0.1);
          tube(g, px, py, 0.05, 0.045, z, 4, 0xc8323a, lit(0xc8323a, 0.2), 8);
          for (let i = 0; i < 4; i++) {
            const pin = P(px + (rand() - 0.5) * 0.06, py + (rand() - 0.5) * 0.06, z + 5 + rand());
            g.fillStyle(pick([0xffc860, WHITE, 0x3fa7b5], rand), 1);
            g.fillCircle(pin.x, pin.y, 1 * S);
          }
        }
      }
      return;
    }
  }
}

// What sits under a display case's glass, one item at a time; each returns its draw so they can be painted far to near.
function caseGoods(g: G, fr: Fr, trade: Trade, a0: number, a1: number, b0: number, b1: number, z: number, rand: () => number): { x: number; y: number; draw: () => void }[] {
  const out: { x: number; y: number; draw: () => void }[] = [];
  const rows = b1 - b0 > 0.5 ? [b0 + 0.18, b1 - 0.18] : [(b0 + b1) / 2];
  rows.forEach((b, row) => {
    let a = a0 + 0.12 + row * 0.08;
    while (a < a1 - 0.12) {
      const [x, y] = xy(fr, a, b);
      const k = rand();
      const col = pick(GOODS, rand);
      let step = 0.3;
      let draw: () => void;
      switch (trade) {
        case 'cafe':
          if (k < 0.35) draw = () => { cake(g, x, y, z, 0.09, rand); };
          else if (k < 0.7) {
            draw = () => {
              for (const d of [-0.05, 0.05]) {
                tube(g, x + d, y - d * 0.4, 0.04, 0.05, z, 4, 0xf2ece0, null, 6, true);
                const top = P(x + d, y - d * 0.4, z + 4);
                g.fillStyle(pick([0xf4b8c8, 0xfaf6ee, 0x6a3a2a, 0xc8e4ff], rand), 1);
                g.fillEllipse(top.x, top.y - 1.6 * S, 0.1 * RX + 2 * S, 0.1 * RY + 4 * S, 10);
                g.fillStyle(0xc8323a, 1);
                g.fillCircle(top.x, top.y - 4.6 * S, 1.1 * S);
              }
            };
          } else {
            draw = () => {
              floorEllipse(g, x, y, 0.11, 0xf8f6f0, 1, z);
              tube(g, x, y, 0.085, 0.085, z + 0.5, 2.2, 0xd9a86a, 0xf0d8a8, 10);
              for (let i = 0; i < 6; i++) {
                const t = (i / 6) * Math.PI * 2;
                const p = P(x + Math.cos(t) * 0.05, y + Math.sin(t) * 0.05, z + 2.7);
                g.fillStyle(pick([0xc8323a, 0x7fc86a, 0xffc860, 0x5a3a8a], rand), 1);
                g.fillCircle(p.x, p.y, 1.5 * S);
              }
            };
          }
          break;
        case 'hats':
          draw = () => {
            tube(g, x, y, 0.02, 0.02, z, 4, 0xd9cbb0, null, 3);
            hat(g, x, y, z + 4, Math.floor(rand() * 4), pick(HATS, rand), 0.72, rand);
          };
          step = 0.34;
          break;
        case 'tailor':
          draw = () => {
            for (let i = 0; i < 1 + Math.floor(rand() * 3); i++) {
              const c = pick(CLOTH, rand);
              const j = (rand() - 0.5) * 0.02;
              prism(g, x - 0.11 + j, y - 0.08, x + 0.11 + j, y + 0.08, z + i * 3, 2.8, c, lit(c, 0.22));
            }
          };
          break;
        case 'surf':
          if (k < 0.5) {
            draw = () => {
              const c = pick([0xf2e6d0, 0xc8e4ff, 0xffc8c8, 0xffe27a], rand);
              prism(g, x - 0.08, y - 0.1, x + 0.08, y + 0.1, z, 6, c, lit(c, 0.3));
              fan(g, pick([0x3fa7b5, 0xe0574b], rand), quad(x - 0.05, y - 0.06, x + 0.05, y + 0.06, z + 6));
            };
            step = 0.26;
          } else {
            draw = () => {
              const c = pick([0x1e2228, 0x3fa7b5, 0xff8a5c, 0xf2e6d0], rand);
              across(g, fr, a, [[b - 0.16, z], [b + 0.14, z], [b + 0.08, z + 3], [b - 0.1, z + 15]], shade(c, 0.35));
              across(g, fr, a + 0.025, [[b - 0.16, z], [b + 0.14, z], [b + 0.08, z + 3], [b - 0.1, z + 15]], acrossTone(fr, c));
            };
            step = 0.2;
          }
          break;
        case 'barber':
          if (k < 0.5) {
            draw = () => {
              const c = pick([0x2a2a30, 0x8a4a2a, 0x3a3640], rand);
              box(g, fr, a - 0.1, b - 0.025, a + 0.1, b + 0.025, z, 1.2, c, lit(c, 0.25));
              for (let i = 0; i < 9; i++) line(g, fp(fr, a - 0.08 + i * 0.02, b + 0.025, z + 1.2), fp(fr, a - 0.08 + i * 0.02, b + 0.05, z + 0.4), 1, c, 0.9);
            };
          } else {
            draw = () => {
              tube(g, x, y, 0.04, 0.035, z, 9, pick([0x8a4a1a, 0x3f7a4a, 0x2f5a8a, 0xd9a54a], rand), null, 6);
              tube(g, x, y, 0.022, 0.022, z + 9, 3, 0x2a2a30, 0x4a4a52, 4);
            };
            step = 0.18;
          }
          break;
        default:
          draw = () => { prism(g, x - 0.1, y - 0.08, x + 0.1, y + 0.08, z, 6, col, lit(col, 0.3)); };
      }
      out.push({ x, y, draw });
      a += step + rand() * 0.06;
    }
  });
  return out;
}

// ---------- Shop and flat pieces ----------

const rectOf = (fr: Fr, a0: number, b0: number, a1: number, b1: number): { x0: number; y0: number; x1: number; y1: number } => {
  const [px, py] = xy(fr, a0, b0);
  const [qx, qy] = xy(fr, a1, b1);
  return { x0: Math.min(px, qx), y0: Math.min(py, qy), x1: Math.max(px, qx), y1: Math.max(py, qy) };
};

// One coat, shirt or dress hanging side-on from a rail at height `top`, its broad side at plane a.
function garment(g: G, fr: Fr, a: number, bm: number, top: number, col: number, rand: () => number): void {
  const kind = rand();
  const w = kind < 0.2 ? 0.17 : 0.2;
  const len = kind < 0.2 ? 22 : kind < 0.55 ? 28 : kind < 0.8 ? 36 : 42;
  const hem = kind > 0.8 ? w * 1.2 : w * 0.95;
  const z1 = top - 4;
  const z0 = z1 - len;
  const shape: [number, number][] = [[bm - 0.04, z1 + 2], [bm - w, z1 - 3], [bm - hem, z0], [bm + hem, z0], [bm + w, z1 - 3], [bm + 0.04, z1 + 2]];
  across(g, fr, a, shape, shade(col, 0.35));
  across(g, fr, a + 0.03, shape, acrossTone(fr, col));
  across(g, fr, a + 0.031, [[bm - w * 0.9, z1 - 3.5], [bm - w * 0.6, z1 - 3.5], [bm - hem * 0.7, z0 + 1], [bm - hem * 0.95, z0 + 1]], shade(col, 0.12), 0.7);
  if (kind >= 0.2 && kind < 0.8) across(g, fr, a + 0.032, [[bm - 0.01, z1], [bm + 0.01, z1], [bm + 0.01, z0 + 2], [bm - 0.01, z0 + 2]], lit(col, 0.25), 0.6);
  line(g, fp(fr, a + 0.032, bm - w * 0.95, z1 - 2.6), fp(fr, a + 0.032, bm, z1 + 1), 1.2, 0x8a6a4a);
  line(g, fp(fr, a + 0.032, bm, z1 + 1), fp(fr, a + 0.032, bm + w * 0.95, z1 - 2.6), 1.2, 0x8a6a4a);
  line(g, fp(fr, a + 0.032, bm, z1 + 1), fp(fr, a + 0.032, bm + 0.02, top + 2.5), 1.2, 0x9a9ea6);
}

function rack(g: G, f: Furniture, layout: RoomLayout, trade: Trade, rand: () => number): void {
  const fr = frameOf(f, layout);
  const { a0, a1, b0, b1 } = span(f, fr);
  const bm = (b0 + b1) / 2 - 0.04;
  const metal = trade === 'tailor' ? 0x3a3036 : CHROME;
  const cloth = trade === 'surf' ? SURFWEAR : SUITS;
  const posts = [a0 + 0.12, a1 - 0.14] as const;
  contact(g, f.c + 0.1, f.r + 0.1, f.c + f.w - 0.1, f.r + f.d - 0.1, 0.14);
  const upright = (a: number): void => {
    box(g, fr, a - 0.03, bm - 0.26, a + 0.03, bm + 0.26, 1.5, 2.5, metal, lit(metal, 0.25));
    for (const b of [bm - 0.24, bm + 0.24]) {
      const w = fp(fr, a, b, 1);
      g.fillStyle(0x2a2a30, 1);
      g.fillCircle(w.x, w.y, 1.8 * S);
    }
    box(g, fr, a - 0.02, bm - 0.02, a + 0.02, bm + 0.02, 4, RACK_H - 4, metal, lit(metal, 0.3));
  };
  upright(posts[0]);
  const hung: number[] = [];
  for (let a = posts[0] + 0.08; a < posts[1] - 0.06; a += 0.08 + rand() * 0.05) {
    garment(g, fr, a, bm, RACK_H, pick(cloth, rand), rand);
    hung.push(a);
  }
  box(g, fr, posts[0], bm - 0.018, posts[1], bm + 0.018, RACK_H - 2, 2.4, metal, lit(metal, 0.35));
  for (const a of hung) {
    const p = fp(fr, a + 0.032, bm + 0.02, RACK_H + 2.5);
    g.lineStyle(1.1, 0x9a9ea6, 1);
    g.beginPath();
    g.arc(p.x - 1.4 * S, p.y, 1.6 * S, -Math.PI, 0.3);
    g.strokePath();
  }
  upright(posts[1]);
}

function mirror(g: G, f: Furniture, layout: RoomLayout, room: RoomKind, trade: Trade, rand: () => number): void {
  const fr = frameOf(f, layout);
  const { a0, a1, b0 } = span(f, fr);
  const am = (a0 + a1) / 2;
  const half = Math.min(0.32, (a1 - a0) / 2 - 0.12);
  const frameCol = trade === 'barber' ? 0x2a2a30 : room === 'flat' ? pick([0x6e4430, 0x9a6a44, 0xf2ece0], rand) : 0xc9a24a;
  const back = b0 + 0.05;
  const face = b0 + 0.13;
  const foot = rectOf(fr, am - half - 0.04, back, am + half + 0.08, face + 0.2);
  contact(g, foot.x0, foot.y0, foot.x1, foot.y1, 0.16);
  box(g, fr, am - half - 0.04, back, am + half + 0.04, face + 0.08, 0, 5, shade(frameCol, 0.25), lit(frameCol, 0.1));
  box(g, fr, am - half, back, am + half, face, 5, MIRROR_H - 5, frameCol, lit(frameCol, 0.3));
  if (fr === 'e') {
    for (const a of [am - half + 0.1, am + half - 0.16]) box(g, fr, a, back - 0.03, a + 0.06, back, 8, MIRROR_H - 20, shade(frameCol, 0.3));
    return;
  }
  const u0 = am - half + 0.06;
  const u1 = am + half - 0.06;
  const z0 = 11;
  const z1 = MIRROR_H - 6;
  const pl = face + 0.002;
  poly(g, fr, pl, windowOutline(u0, u1, z0, z1, true), tone(fr, 0xb4c6d2, 0.2));
  const rect = z1 - ((u1 - u0) / 2) * ROUND;
  plate(g, fr, pl + 0.0005, u0, u1, z0, z0 + 14, tone(fr, mix(0xb4c6d2, 0xb07a4e, 0.4), 0.2));
  plate(g, fr, pl + 0.0006, u0, u1, z0 + 14, z0 + 15.5, tone(fr, mix(0xb4c6d2, 0x5a3a2a, 0.4), 0.2), 0.7);
  plate(g, fr, pl + 0.0007, u0 + (u1 - u0) * 0.62, u0 + (u1 - u0) * 0.78, z0 + 22, rect - 6, tone(fr, mix(0xb4c6d2, 0xfff0c8, 0.5), 0.2), 0.6);
  poly(g, fr, pl + 0.001, [[u0 + 0.03, z0 + 6], [u0 + 0.13, z0 + 6], [u0 + 0.32, rect - 4], [u0 + 0.22, rect - 4]], WHITE, 0.32);
  poly(g, fr, pl + 0.001, [[u0 + 0.17, z0 + 6], [u0 + 0.21, z0 + 6], [u0 + 0.4, rect - 4], [u0 + 0.36, rect - 4]], WHITE, 0.2);
  plate(g, fr, pl + 0.002, am - half, am + half, MIRROR_H - 2, MIRROR_H, tone(fr, lit(frameCol, 0.35)));
  if (trade !== 'barber') {
    const c = fp(fr, am, pl + 0.002, MIRROR_H + 2);
    g.fillStyle(tone(fr, frameCol), 1);
    g.fillEllipse(c.x, c.y, 12 * S, 6 * S, 12);
    g.fillStyle(lit(frameCol, 0.4), 1);
    g.fillEllipse(c.x - 1.5 * S, c.y - 1 * S, 5 * S, 2.4 * S, 8);
  }
}

function displayCase(g: G, f: Furniture, layout: RoomLayout, trade: Trade, rand: () => number): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.08;
  const a1 = s.a1 - 0.08;
  const b0 = s.b0 + 0.12;
  const b1 = s.b1 - 0.1;
  const body = trade === 'cafe' ? 0xf2ece0 : trade === 'surf' ? 0x3f8a8a : trade === 'barber' ? 0x2a2a30 : trade === null ? 0xa8714a : 0x6e4430;
  const lining = trade === 'cafe' ? 0xfaf6ee : trade === 'tailor' ? 0x2f5a4a : trade === 'hats' ? 0x6a1f2a : trade === 'surf' ? 0xe8d8b0 : trade === 'barber' ? 0x1e2228 : 0xd8c8a8;
  const trim = trade === 'barber' || trade === 'surf' ? CHROME : BRASS;
  contact(g, f.c + 0.06, f.r + 0.08, f.c + f.w - 0.06, f.r + f.d - 0.06, 0.2);
  box(g, fr, a0 + 0.03, b0 + 0.03, a1 - 0.03, b1 - 0.03, 0, 3, shade(body, 0.45));
  box(g, fr, a0, b0, a1, b1, 3, CASE_BASE - 3, body, lit(body, 0.2));
  const panels = Math.max(1, Math.round((a1 - a0) / 0.9));
  const pw = (a1 - a0) / panels;
  for (let i = 0; i < panels; i++) {
    plate(g, fr, b1 + 0.002, a0 + i * pw + 0.06, a0 + (i + 1) * pw - 0.06, 6, CASE_BASE - 4, tone(fr, shade(body, 0.12)));
    plate(g, fr, b1 + 0.002, a0 + i * pw + 0.06, a0 + (i + 1) * pw - 0.06, 6, 7, tone(fr, lit(body, 0.3)));
  }
  plate(g, fr, b1 + 0.003, a0, a1, CASE_BASE - 2, CASE_BASE, tone(fr, trim));
  const r = rectOf(fr, a0, b0, a1, b1);
  fan(g, lining, quad(r.x0 + 0.02, r.y0 + 0.02, r.x1 - 0.02, r.y1 - 0.02, CASE_BASE));
  const post = (x: number, y: number): void => { prism(g, x - 0.015, y - 0.015, x + 0.015, y + 0.015, CASE_BASE, CASE_H - CASE_BASE, trim, lit(trim, 0.3)); };
  post(r.x0 + 0.015, r.y0 + 0.015);
  const goods = caseGoods(g, fr, trade, a0, a1, b0, b1, CASE_BASE, rand);
  goods.sort((p, q) => p.x + p.y - (q.x + q.y));
  for (const item of goods) item.draw();
  const GLASS = 0xd8eef4;
  fan(g, GLASS, [P(r.x0, r.y1, CASE_BASE), P(r.x1, r.y1, CASE_BASE), P(r.x1, r.y1, CASE_H), P(r.x0, r.y1, CASE_H)], 0.14);
  fan(g, GLASS, [P(r.x1, r.y1, CASE_BASE), P(r.x1, r.y0, CASE_BASE), P(r.x1, r.y0, CASE_H), P(r.x1, r.y1, CASE_H)], 0.2);
  fan(g, GLASS, quad(r.x0, r.y0, r.x1, r.y1, CASE_H), 0.12);
  for (let x = r.x0 + 0.2; x < r.x1 - 0.1; x += 0.9) {
    fan(g, WHITE, [P(x, r.y1, CASE_BASE + 2), P(x + 0.1, r.y1, CASE_BASE + 2), P(x + 0.26, r.y1, CASE_H - 2), P(x + 0.16, r.y1, CASE_H - 2)], 0.18);
  }
  fan(g, WHITE, [P(r.x0 + 0.1, r.y0 + 0.05, CASE_H), P(r.x0 + 0.3, r.y0 + 0.05, CASE_H), P(r.x0 + 0.5, r.y1 - 0.05, CASE_H), P(r.x0 + 0.3, r.y1 - 0.05, CASE_H)], 0.12);
  post(r.x1 - 0.015, r.y0 + 0.015);
  post(r.x0 + 0.015, r.y1 - 0.015);
  post(r.x1 - 0.015, r.y1 - 0.015);
  for (const [p, q] of [[P(r.x0, r.y0, CASE_H), P(r.x1, r.y0, CASE_H)], [P(r.x0, r.y0, CASE_H), P(r.x0, r.y1, CASE_H)], [P(r.x0, r.y1, CASE_H), P(r.x1, r.y1, CASE_H)], [P(r.x1, r.y0, CASE_H), P(r.x1, r.y1, CASE_H)]] as const) line(g, p, q, 1.4 * S, trim, 0.9);
  line(g, P(r.x0 + 0.02, r.y1, CASE_H - 0.5), P(r.x1 - 0.02, r.y1, CASE_H - 0.5), 1, WHITE, 0.6);
}

function barberChair(g: G, f: Furniture, layout: RoomLayout, seed: number): void {
  const fr = frameOf(f, layout);
  const { a0, a1, b0, b1 } = span(f, fr);
  const am = (a0 + a1) / 2;
  const bm = (b0 + b1) / 2 - 0.04;
  const leather = LEATHER[Math.abs(Math.trunc(seed / LEATHER.length)) % LEATHER.length] ?? LEATHER[0];
  const [cx, cy] = xy(fr, am, bm);
  const zs = BARBER_SEAT;
  floorEllipse(g, cx + 0.08, cy + 0.06, 0.36, SHADOW, 0.2);
  const base = (): void => {
    tube(g, cx, cy, 0.3, 0.28, 0, 2.5, CHROME, lit(CHROME, 0.3), 14);
    tube(g, cx, cy, 0.07, 0.07, 2.5, 8, CHROME, null, 8);
    tube(g, cx, cy, 0.12, 0.1, 9, 3.5, 0x3a3640, null, 10);
    box(g, fr, am - 0.24, bm - 0.22, am + 0.24, bm + 0.22, zs - 3.5, 3, CHROME, lit(CHROME, 0.2));
  };
  const backrest = (): void => {
    box(g, fr, am - 0.22, bm - 0.3, am + 0.22, bm - 0.18, zs, 28, leather, lit(leather, 0.2));
    for (const a of [am - 0.11, am, am + 0.11]) plate(g, fr, bm - 0.18 + 0.002, a - 0.004, a + 0.004, zs + 4, zs + 25, tone(fr, shade(leather, 0.3)));
    box(g, fr, am - 0.02, bm - 0.27, am + 0.02, bm - 0.23, zs + 28, 4, CHROME);
    box(g, fr, am - 0.13, bm - 0.29, am + 0.13, bm - 0.2, zs + 32, 7, leather, lit(leather, 0.25));
  };
  const arm = (a: number): void => {
    box(g, fr, a + 0.015, bm - 0.04, a + 0.045, bm + 0.0, zs, 7, CHROME);
    box(g, fr, a, bm - 0.18, a + 0.06, bm + 0.22, zs + 7, 2.5, shade(leather, 0.1), lit(leather, 0.3));
    box(g, fr, a + 0.005, bm + 0.18, a + 0.055, bm + 0.22, zs + 2, 5, CHROME);
  };
  const seat = (): void => {
    box(g, fr, am - 0.2, bm - 0.18, am + 0.2, bm + 0.22, zs - 0.5, 5, leather, lit(leather, 0.25));
    fan(g, shade(leather, 0.25), [fp(fr, am - 0.17, bm + 0.02, zs + 4.5), fp(fr, am + 0.17, bm + 0.02, zs + 4.5), fp(fr, am + 0.17, bm + 0.035, zs + 4.5), fp(fr, am - 0.17, bm + 0.035, zs + 4.5)], 0.6);
  };
  const footrest = (): void => {
    box(g, fr, am - 0.03, bm + 0.2, am + 0.03, bm + 0.4, 6, 2, CHROME);
    box(g, fr, am - 0.17, bm + 0.38, am + 0.17, bm + 0.48, 3, 2.5, CHROME, lit(CHROME, 0.3));
    for (let a = am - 0.13; a < am + 0.14; a += 0.065) line(g, fp(fr, a, bm + 0.39, 5.5), fp(fr, a, bm + 0.47, 5.5), 1, 0x8a8e96, 0.8);
  };
  if (fr === 'e') {
    footrest();
    base();
    arm(am - 0.26);
    seat();
    arm(am + 0.2);
    backrest();
    return;
  }
  base();
  backrest();
  arm(am - 0.26);
  seat();
  arm(am + 0.2);
  footrest();
}

function hatStand(g: G, f: Furniture, rand: () => number): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const wood = pick([0x5a3a2a, 0x8a5a3a, 0x2a2a30], rand);
  floorEllipse(g, x + 0.1, y + 0.04, 0.3, SHADOW, 0.18);
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * Math.PI * 2 + 0.4;
    line(g, P(x, y, 6), P(x + Math.cos(t) * 0.24, y + Math.sin(t) * 0.24, 0.5), 2.4 * S, wood);
  }
  const off = rand() * Math.PI;
  const pegs = Array.from({ length: 4 }, (_, i) => {
    const t = off + (i / 4) * Math.PI * 2;
    return { dx: Math.cos(t) * 0.15, dy: Math.sin(t) * 0.15, z: 44 + ((i * 5) % 12), hat: i < 3 };
  });
  const peg = (p: (typeof pegs)[number]): void => {
    line(g, P(x, y, p.z - 3), P(x + p.dx, y + p.dy, p.z + 1), 1.8 * S, wood);
    if (p.hat) hat(g, x + p.dx, y + p.dy, p.z - 2, Math.floor(rand() * 4), pick(HATS, rand), 0.95, rand);
  };
  for (const p of pegs) if (p.dx + p.dy < 0) peg(p);
  tube(g, x, y, 0.035, 0.03, 0, HATSTAND_H, wood, null, 4);
  const top = P(x, y, HATSTAND_H);
  g.fillStyle(lit(wood, 0.2), 1);
  g.fillCircle(top.x, top.y - 1.5 * S, 3 * S);
  for (const p of pegs) if (p.dx + p.dy >= 0) peg(p);
  if (rand() < 0.6) hat(g, x, y, HATSTAND_H + 1, Math.floor(rand() * 4), pick(HATS, rand), 1, rand);
}

// One surfboard standing on its tail and leaning back on the rack's rail, its deck turned side-on at plane a.
function surfboard(g: G, fr: Fr, a: number, bc: number, lean: number, h: number, w: number, col: number, rand: () => number): void {
  const n = 10;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const at = (t: number, side: number): [number, number] => {
    const prof = t < 0.38 ? 0.72 + 0.28 * Math.sin((t / 0.38) * (Math.PI / 2)) : Math.pow(Math.cos(((t - 0.38) / 0.62) * (Math.PI / 2)), 0.7);
    return [bc - lean * t + side * (w / 2) * prof, 3 + h * t];
  };
  for (let i = 0; i <= n; i++) {
    left.push(at(i / n, -1));
    right.push(at(i / n, 1));
  }
  const outline = [...left, ...right.reverse()];
  across(g, fr, a, outline, shade(col, 0.4));
  across(g, fr, a + 0.028, outline, acrossTone(fr, col));
  const stripe = pick(GOODS, rand);
  const t0 = 0.48 + rand() * 0.1;
  across(g, fr, a + 0.029, [at(t0, -1), at(t0, 1), at(t0 + 0.06, 1), at(t0 + 0.06, -1)], acrossTone(fr, stripe));
  line(g, fp(fr, a + 0.03, bc, 6), fp(fr, a + 0.03, bc - lean * 0.94, 3 + h * 0.94), 1, shade(col, 0.3), 0.5);
  line(g, fp(fr, a + 0.03, bc - w * 0.34, 10), fp(fr, a + 0.03, bc - lean * 0.6 - w * 0.4, 3 + h * 0.6), 1.2, WHITE, 0.3);
}

function boardRack(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const { a0: s0, a1: s1, b0, b1 } = span(f, fr);
  const a0 = s0 + 0.08;
  const a1 = s1 - 0.08;
  const wood = 0x8a5a3a;
  const pad = 0x3a3640;
  contact(g, f.c + 0.06, f.r + 0.06, f.c + f.w - 0.06, f.r + f.d - 0.08, 0.18);
  const rail = (): void => {
    for (const a of [a0, a1 - 0.06]) box(g, fr, a, b0 + 0.08, a + 0.06, b0 + 0.16, 0, 58, wood, lit(wood, 0.2));
    box(g, fr, a0, b0 + 0.06, a1, b0 + 0.18, 47, 6, pad, lit(pad, 0.25));
  };
  if (fr !== 'e') rail();
  box(g, fr, a0, b0 + 0.16, a1, b1 - 0.12, 0, 5, shade(wood, 0.15), pad);
  box(g, fr, a0 - 0.02, b0 + 0.16, a0 + 0.04, b1 - 0.12, 0, 15, wood, lit(wood, 0.25));
  const bc = (b0 + 0.2 + b1 - 0.2) / 2;
  for (let a = a0 + 0.1; a < a1 - 0.1; a += 0.15 + rand() * 0.05) {
    surfboard(g, fr, a, bc, bc - (b0 + 0.2), 66 + rand() * 24, 0.32 + rand() * 0.1, pick(BOARDS, rand), rand);
  }
  box(g, fr, a0, b1 - 0.26, a1, b1 - 0.12, 0, 12, wood, lit(wood, 0.25));
  plate(g, fr, b1 - 0.12 + 0.002, a0 + 0.05, a1 - 0.05, 4, 9, tone(fr, shade(wood, 0.2)));
  box(g, fr, a1 - 0.04, b0 + 0.16, a1 + 0.02, b1 - 0.12, 0, 15, wood, lit(wood, 0.25));
  if (fr === 'e') rail();
}

function kitchen(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.04;
  const a1 = s.a1 - 0.04;
  const b0 = s.b0 + 0.02;
  const b1 = s.b0 + 0.64;
  const unit = pick([0xeae4d6, 0x7f9a86, 0x3f5a7a, 0xc8a07a, 0xd8d0c4], rand);
  const top = pick([0x3a3640, 0xb88a5a, 0xe8e2d8], rand);
  const tile = pick([0xf2f2ec, 0xc8e0e4, 0xe8d8c0, 0x9fc4b8], rand);
  const steel = 0xb8bcc4;
  const fridge = a1 - a0 > 3.4;
  const r0 = fridge ? a0 + 0.68 : a0;
  const modules = Math.max(2, Math.round((a1 - r0) / 0.5));
  const mw = (a1 - r0) / modules;
  const sinkAt = Math.max(0, Math.floor(modules * 0.28));
  const hobAt = Math.min(modules - 1, Math.max(sinkAt + 2, Math.floor(modules * 0.72)));
  const ma = (i: number): number => r0 + i * mw;
  contact(g, f.c + 0.04, f.r + 0.04, f.c + f.w - 0.04, f.r + f.d - 0.04, 0.2);
  if (fr !== 'e') {
    plate(g, fr, b0 + 0.004, r0, a1, KITCHEN_H + 3, UPPER_Z, tone(fr, tile, 0.25));
    for (let z = KITCHEN_H + 9; z < UPPER_Z; z += 6) plate(g, fr, b0 + 0.005, r0, a1, z, z + 0.8, tone(fr, shade(tile, 0.15), 0.25), 0.8);
    for (let a = r0 + 0.12; a < a1; a += 0.12) plate(g, fr, b0 + 0.005, a, a + 0.008, KITCHEN_H + 3, UPPER_Z, tone(fr, shade(tile, 0.15), 0.25), 0.8);
    for (let i = 0; i < modules; i++) {
      if (i === hobAt) {
        box(g, fr, ma(i) + 0.02, b0, ma(i + 1) - 0.02, b0 + 0.42, UPPER_Z + 2, 6, steel, lit(steel, 0.25));
        box(g, fr, ma(i) + mw * 0.3, b0, ma(i + 1) - mw * 0.3, b0 + 0.22, UPPER_Z + 8, UPPER_H + 10, steel, lit(steel, 0.2));
        continue;
      }
      box(g, fr, ma(i) + 0.004, b0, ma(i + 1) - 0.004, b0 + 0.34, UPPER_Z, UPPER_H, unit, lit(unit, 0.2));
      plate(g, fr, b0 + 0.342, ma(i) + 0.04, ma(i + 1) - 0.04, UPPER_Z + 3, UPPER_Z + UPPER_H - 3, tone(fr, shade(unit, 0.06)));
      const ha = i % 2 === 0 ? ma(i + 1) - 0.09 : ma(i) + 0.06;
      plate(g, fr, b0 + 0.343, ha, ha + 0.03, UPPER_Z + 4, UPPER_Z + 9, tone(fr, steel));
    }
  }
  if (fridge) {
    const fc = pick([0xf2f2ee, 0xc8e4e0, 0xe8c8b0], rand);
    box(g, fr, a0, b0, a0 + 0.64, b1 + 0.02, 0, FRIDGE_H, fc, lit(fc, 0.2));
    plate(g, fr, b1 + 0.022, a0 + 0.04, a0 + 0.6, 4, 52, tone(fr, shade(fc, 0.05)));
    plate(g, fr, b1 + 0.022, a0 + 0.04, a0 + 0.6, 55, FRIDGE_H - 4, tone(fr, shade(fc, 0.05)));
    plate(g, fr, b1 + 0.023, a0 + 0.5, a0 + 0.54, 40, 50, tone(fr, steel));
    plate(g, fr, b1 + 0.023, a0 + 0.5, a0 + 0.54, 57, 70, tone(fr, steel));
  }
  box(g, fr, r0, b0, a1, b1 - 0.05, 0, 4, shade(unit, 0.5));
  box(g, fr, r0, b0, a1, b1, 4, KITCHEN_H - 4, unit);
  const front = b1 + 0.002;
  for (let i = 0; i < modules; i++) {
    const u0 = ma(i) + 0.025;
    const u1 = ma(i + 1) - 0.025;
    if (i === hobAt) {
      plate(g, fr, front, u0, u1, 6, KITCHEN_H - 3, tone(fr, 0x2a2a30));
      plate(g, fr, front + 0.001, u0 + 0.05, u1 - 0.05, 9, KITCHEN_H - 10, tone(fr, 0x5a4a3a));
      plate(g, fr, front + 0.001, u0 + 0.06, u1 - 0.06, KITCHEN_H - 7, KITCHEN_H - 5.5, tone(fr, steel));
    } else if (i === modules - 1 && modules > 2) {
      for (let k = 0; k < 3; k++) {
        plate(g, fr, front, u0, u1, 6 + k * 7.6, 12.6 + k * 7.6, tone(fr, shade(unit, 0.06)));
        plate(g, fr, front + 0.001, (u0 + u1) / 2 - 0.06, (u0 + u1) / 2 + 0.06, 10.4 + k * 7.6, 11.4 + k * 7.6, tone(fr, steel));
      }
    } else {
      plate(g, fr, front, u0, u1, 6, KITCHEN_H - 3, tone(fr, shade(unit, 0.06)));
      plate(g, fr, front + 0.001, u0, u1, KITCHEN_H - 4.5, KITCHEN_H - 3, tone(fr, lit(unit, 0.3)));
      const ha = i % 2 === 0 ? u1 - 0.07 : u0 + 0.04;
      plate(g, fr, front + 0.001, ha, ha + 0.03, KITCHEN_H - 12, KITCHEN_H - 6, tone(fr, steel));
    }
  }
  box(g, fr, r0 - 0.01, b0 - 0.01, a1 + 0.02, b1 + 0.04, KITCHEN_H, 3, shade(top, 0.2), top);
  const zt = KITCHEN_H + 3;
  const sc = ma(sinkAt) + mw;
  const sink = rectOf(fr, sc - 0.28, b0 + 0.12, sc + 0.28, b1 - 0.1);
  fan(g, steel, quad(sink.x0, sink.y0, sink.x1, sink.y1, zt));
  fan(g, shade(steel, 0.3), quad(sink.x0 + 0.04, sink.y0 + 0.04, sink.x1 - 0.04, sink.y1 - 0.04, zt));
  fan(g, shade(steel, 0.12), quad(sink.x0 + 0.04, sink.y0 + 0.04, sink.x1 - 0.04, sink.y0 + 0.1, zt));
  const [tx, ty] = xy(fr, sc, b0 + 0.07);
  tube(g, tx, ty, 0.025, 0.02, zt, 10, CHROME, null, 4);
  line(g, P(tx, ty, zt + 10), fp(fr, sc, b0 + 0.26, zt + 9), 2 * S, CHROME);
  const hob = rectOf(fr, ma(hobAt) + 0.03, b0 + 0.08, ma(hobAt + 1) - 0.03, b1 - 0.06);
  fan(g, 0x1e2026, quad(hob.x0, hob.y0, hob.x1, hob.y1, zt + 0.3));
  fan(g, WHITE, quad(hob.x0 + 0.02, hob.y0 + 0.02, hob.x0 + 0.12, hob.y1 - 0.02, zt + 0.3), 0.08);
  const rings: [number, number][] = [];
  for (const u of [0.28, 0.72]) for (const v of [0.3, 0.72]) rings.push([hob.x0 + (hob.x1 - hob.x0) * u, hob.y0 + (hob.y1 - hob.y0) * v]);
  rings.forEach(([x, y], i) => {
    const c = P(x, y, zt + 0.4);
    g.lineStyle(1.2 * S, i === 1 && rand() < 0.5 ? 0xe0574b : 0x4a4a52, 0.9);
    g.strokeEllipse(c.x, c.y, 0.16 * RX, 0.16 * RY, 14);
  });
  const [px, py] = rings[2] ?? [hob.x0, hob.y0];
  if (rand() < 0.5) {
    const potCol = pick([steel, 0xc8604a, 0x3f5a7a], rand);
    tube(g, px, py, 0.1, 0.1, zt + 0.4, 7, potCol, lit(potCol, 0.15), 10);
    const lid = P(px, py, zt + 8);
    g.fillStyle(shade(potCol, 0.2), 1);
    g.fillCircle(lid.x, lid.y - 1 * S, 1.8 * S);
    for (const s of [-1, 1] as const) line(g, P(px + s * 0.1, py, zt + 6), P(px + s * 0.15, py, zt + 6.5), 1.6 * S, 0x2a2a30);
  } else {
    const ka = hobAt > sinkAt + 2 ? ma(hobAt - 1) + mw / 2 : ma(Math.min(modules - 1, hobAt + 1)) + mw / 2;
    const [kx, ky] = xy(fr, ka, (b0 + b1) / 2);
    const kc = pick([0xe0574b, 0xf2ece0, steel, 0x3fa7b5], rand);
    tube(g, kx, ky, 0.08, 0.06, zt, 9, kc, lit(kc, 0.2), 10);
    line(g, P(kx + 0.07, ky, zt + 3), P(kx + 0.14, ky - 0.02, zt + 8), 1.8 * S, kc);
    const k0 = P(kx - 0.04, ky - 0.04, zt + 9);
    const k1 = P(kx + 0.04, ky + 0.04, zt + 9);
    g.lineStyle(1.6 * S, 0x2a2a30, 1);
    g.beginPath();
    g.moveTo(k0.x, k0.y);
    g.lineTo((k0.x + k1.x) / 2, Math.min(k0.y, k1.y) - 6 * S);
    g.lineTo(k1.x, k1.y);
    g.strokePath();
  }
  if (modules > 3) {
    const ba = ma(modules - 1) + mw / 2;
    const [bx, by] = xy(fr, ba, (b0 + b1) / 2);
    if (rand() < 0.5) {
      tube(g, bx, by, 0.09, 0.12, zt, 4, 0xf2ece0, 0xe8e0d0, 10);
      for (const [dx, dy, col] of [[-0.04, 0, 0xe0574b], [0.04, -0.02, 0xffc860], [0, 0.04, 0x7fc86a]] as const) {
        const p = P(bx + dx, by + dy, zt + 5);
        g.fillStyle(col, 1);
        g.fillCircle(p.x, p.y, 3.2 * S);
      }
    } else {
      box(g, fr, ba - 0.18, b0 + 0.2, ba + 0.18, b0 + 0.46, zt, 1.5, 0xc8a070, lit(0xc8a070, 0.2));
      line(g, fp(fr, ba - 0.12, b0 + 0.3, zt + 2), fp(fr, ba + 0.1, b0 + 0.36, zt + 2), 1.6 * S, 0xd8dce4);
    }
  }
}

function wardrobe(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.08;
  const a1 = s.a1 - 0.08;
  const b0 = s.b0 + 0.04;
  const b1 = s.b0 + 0.66;
  const wood = pick([0x7a4a32, 0x9a6a44, 0xd8c8b0, 0x5a3a2a], rand);
  const am = (a0 + a1) / 2;
  contact(g, f.c + 0.06, f.r + 0.04, f.c + f.w - 0.04, f.r + f.d - 0.04, 0.22);
  for (const [a, b] of [[a0 + 0.04, b0 + 0.04], [a1 - 0.1, b0 + 0.04], [a0 + 0.04, b1 - 0.1], [a1 - 0.1, b1 - 0.1]] as const) box(g, fr, a, b, a + 0.06, b + 0.06, 0, 5, shade(wood, 0.3));
  box(g, fr, a0, b0, a1, b1, 5, WARDROBE_H - 11, wood);
  box(g, fr, a0 - 0.01, b0, a1 + 0.01, b1 + 0.02, 5, 6, shade(wood, 0.18), shade(wood, 0.05));
  box(g, fr, a0 - 0.04, b0, a1 + 0.04, b1 + 0.05, WARDROBE_H - 6, 6, lit(wood, 0.06), lit(wood, 0.3));
  const front = b1 + 0.002;
  const glass = rand() < 0.4;
  for (const [u0, u1] of [[a0 + 0.04, am - 0.012], [am + 0.012, a1 - 0.04]] as const) {
    plate(g, fr, front, u0, u1, 13, WARDROBE_H - 9, tone(fr, lit(wood, 0.04)));
    if (glass && u0 > am) {
      plate(g, fr, front + 0.001, u0 + 0.07, u1 - 0.07, 20, WARDROBE_H - 16, tone(fr, 0xb4c6d2, 0.2));
      poly(g, fr, front + 0.002, [[u0 + 0.1, 24], [u0 + 0.18, 24], [u0 + 0.34, WARDROBE_H - 20], [u0 + 0.26, WARDROBE_H - 20]], WHITE, 0.25);
    } else {
      plate(g, fr, front + 0.001, u0 + 0.07, u1 - 0.07, 20, 46, tone(fr, shade(wood, 0.1)));
      plate(g, fr, front + 0.001, u0 + 0.07, u1 - 0.07, 52, WARDROBE_H - 16, tone(fr, shade(wood, 0.1)));
      plate(g, fr, front + 0.0015, u0 + 0.07, u1 - 0.07, 45, 46, tone(fr, lit(wood, 0.3)));
      plate(g, fr, front + 0.0015, u0 + 0.07, u1 - 0.07, WARDROBE_H - 17, WARDROBE_H - 16, tone(fr, lit(wood, 0.3)));
    }
  }
  if (fr !== 'e') {
    for (const a of [am - 0.04, am + 0.04]) {
      const k = fp(fr, a, front + 0.003, 50);
      g.fillStyle(BRASS, 1);
      g.fillCircle(k.x, k.y, 1.8 * S);
    }
  }
}

function tv(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.1;
  const a1 = s.a1 - 0.1;
  const b0 = s.b0 + 0.06;
  const b1 = s.b0 + 0.52;
  const am = (a0 + a1) / 2;
  const half = Math.min(0.64, (a1 - a0) / 2 - 0.04);
  const unit = pick([0x3a3036, 0x9a6a44, 0xeae4d6, 0x5f7a6a], rand);
  const GLOW = 0x8fc8ff;
  const bounds = { x1: layout.w - 1, y1: layout.d - 1 };
  const [gx, gy] = xy(fr, am, s.b1 + 0.5);
  for (const [r, alpha] of [[1.3, 0.035], [0.95, 0.04], [0.6, 0.05]] as const) floorPool(g, gx, gy, r, GLOW, alpha, bounds);
  contact(g, f.c + 0.06, f.r + 0.06, f.c + f.w - 0.06, f.r + f.d - 0.06, 0.18);
  for (const a of [a0 + 0.04, a1 - 0.1]) for (const b of [b0 + 0.04, b1 - 0.1]) box(g, fr, a, b, a + 0.06, b + 0.06, 0, 3, shade(unit, 0.3));
  box(g, fr, a0, b0, a1, b1, 3, TV_UNIT_H - 3, unit, lit(unit, 0.2));
  const front = b1 + 0.002;
  const n = Math.max(2, Math.round((a1 - a0) / 0.45));
  const dw = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    plate(g, fr, front, a0 + i * dw + 0.025, a0 + (i + 1) * dw - 0.025, 5, TV_UNIT_H - 2, tone(fr, shade(unit, 0.1)));
    plate(g, fr, front + 0.001, a0 + i * dw + dw / 2 - 0.05, a0 + i * dw + dw / 2 + 0.05, TV_UNIT_H - 5, TV_UNIT_H - 4, tone(fr, lit(unit, 0.35)));
  }
  const zs = TV_UNIT_H + 6;
  const sb = b0 + 0.12;
  const centre = fp(fr, am, sb, zs + 17);
  for (const [r, alpha] of [[46, 0.035], [36, 0.045], [26, 0.06]] as const) {
    g.fillStyle(GLOW, alpha);
    g.fillEllipse(centre.x, centre.y, r * 2 * S * 1.3, r * 2 * S * 0.8, 20);
  }
  box(g, fr, am - 0.2, sb - 0.02, am + 0.2, sb + 0.16, TV_UNIT_H, 1.5, 0x2a2c34, 0x3a3c44);
  box(g, fr, am - 0.03, sb, am + 0.03, sb + 0.04, TV_UNIT_H + 1.5, 5, 0x2a2c34);
  box(g, fr, am - half, sb, am + half, sb + 0.05, zs, 34, 0x1c1e24, 0x2a2c34);
  const pl = sb + 0.052;
  plate(g, fr, pl, am - half + 0.035, am + half - 0.035, zs + 2.5, zs + 32, tone(fr, 0x24405e, 0.1));
  const bands = [0x2e5478, 0x3a6a92, 0x4f86ae, 0x6aa2c4];
  bands.forEach((col, i) => { plate(g, fr, pl + 0.0005, am - half + 0.035, am + half - 0.035, zs + 2.5 + i * 4.5, zs + 32 - i * 4.5 - 8, tone(fr, col, 0.1), 0.55); });
  plate(g, fr, pl + 0.0008, am - half + 0.035, am + half - 0.035, zs + 2.5, zs + 9, tone(fr, mix(0x3a7a5a, 0x24405e, 0.3), 0.1), 0.8);
  poly(g, fr, pl + 0.001, [[am - half + 0.08, zs + 4], [am - half + 0.22, zs + 4], [am - half + 0.44, zs + 30], [am - half + 0.3, zs + 30]], WHITE, 0.1);
  const led = fp(fr, am + half - 0.08, pl, zs + 1.2);
  if (fr !== 'e') {
    g.fillStyle(0xe0574b, 0.9);
    g.fillCircle(led.x, led.y, 0.9 * S);
  }
  if (fr === 'e') {
    for (const [p, q] of [[fp(fr, am - half, sb, zs), fp(fr, am - half, sb, zs + 34)], [fp(fr, am + half, sb, zs), fp(fr, am + half, sb, zs + 34)]] as const) line(g, p, q, 1.6, GLOW, 0.35);
  }
}

/** One piece of furniture, drawn in room-local tile coordinates like the shell; `layout` is the room it stands in, so it can face its wall and keep its light on the floor. */
export function drawPiece(g: G, f: Furniture, layout: RoomLayout, room: RoomKind, seed: number): void {
  const rand = pieceRand(f, seed);
  const trade: Trade = room === 'shop' ? shopTradeOf(seed) : null;
  switch (f.piece) {
    case 'counter':
      counter(g, f, layout, room, trade, rand);
      return;
    case 'shelf':
      shelf(g, f, layout, room, trade, rand);
      return;
    case 'rug':
      rug(g, f, room, rand);
      return;
    case 'plant':
      plant(g, f, room, rand);
      return;
    case 'lamp':
      lamp(g, f, layout, room);
      return;
    case 'table':
      table(g, f, room, trade, rand);
      return;
    case 'chair':
      chair(g, f, layout, room, rand);
      return;
    case 'bed':
      bed(g, f, rand);
      return;
    case 'sofa':
      sofa(g, f, layout, rand);
      return;
    case 'bookcase':
      bookcase(g, f, layout, rand);
      return;
    case 'column':
      column(g, f, room);
      return;
    case 'vaultDoor':
      vaultDoor(g, f, layout);
      return;
    case 'noticeBoard':
      noticeBoard(g, f, layout, room, rand);
      return;
    case 'bench':
      bench(g, f, layout, room);
      return;
    case 'desk':
      desk(g, f, layout, room, rand);
      return;
    case 'hospitalBed':
      hospitalBed(g, f);
      return;
    case 'rack':
      rack(g, f, layout, trade, rand);
      return;
    case 'mirror':
      mirror(g, f, layout, room, trade, rand);
      return;
    case 'displayCase':
      displayCase(g, f, layout, trade, rand);
      return;
    case 'barberChair':
      barberChair(g, f, layout, seed);
      return;
    case 'hatStand':
      hatStand(g, f, rand);
      return;
    case 'boardRack':
      boardRack(g, f, layout, rand);
      return;
    case 'kitchen':
      kitchen(g, f, layout, rand);
      return;
    case 'wardrobe':
      wardrobe(g, f, layout, rand);
      return;
    case 'tv':
      tv(g, f, layout, rand);
      return;
  }
}

/**
 * The room-local point whose depth a piece sorts by (its front corner), so guardians walk in front of or behind it
 * correctly. Pass the room's `layout` so a piece against the east wall, which everyone stands west of, sorts by its
 * south-west corner instead.
 */
export function pieceFront(f: Furniture, layout?: RoomLayout): { x: number; y: number } {
  if (f.piece === 'rug') return { x: f.c, y: f.r };
  if (layout !== undefined && frameOf(f, layout) === 'e') return { x: f.c, y: f.r + f.d };
  return f.w >= f.d ? { x: f.c, y: f.r + f.d } : { x: f.c + f.w, y: f.r };
}
