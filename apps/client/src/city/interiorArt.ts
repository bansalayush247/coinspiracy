// Walk-in rooms of Port Concord: floors, back walls with windows and decor, knee-high front walls and furniture,
// drawn in room-local tile coordinates and lit from the west like the street outside. The room sits cut open in the
// corner of its building: the back walls rise out of sight and the building's own front runs on round it.
import type Phaser from 'phaser';
import { doorColumn, shopTradeOf, shrineOf, type Deity, type Furniture, type Piece, type RoomKind, type RoomLayout, type Shrine, type ShopTrade } from '@byzantine-council/shared/city';
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
const WALL_H: Readonly<Record<RoomKind, number>> = { shop: 120, mintHall: 136, hospital: 120, flat: 112, cityHall: 140, chapel: 148, arcade: 112, fishMarket: 116, office: 112, temple: 136, mandir: 140 };
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
const HARBOUR = 0x2f5a8a;
const NEON = [0xff4fa8, 0x3ff0e0, 0xffd83a, 0x8a6aff, 0x6aff7a] as const;
const CABINETS = [0xe0574b, 0x2f7ad0, 0xffb830, 0x8a4ad8, 0x2fa87a, 0xff7a3a, 0xd83a8a, 0x1e2a44] as const;
const GLASS = [0x9fc8e8, 0xf2b8c8, 0xf6d88a, 0xb8d8a8, 0xc8b8e8] as const;
const FISH = [0x9aaabb, 0x8a9aae, 0xd88a7a, 0xc8505a, 0xb8c4c8, 0x7a8aa0] as const;
const ICE = 0xe8f2f6;
const FLAME = 0xffc860;

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
const CABINET_H = 98;
const ALTAR_H = 30;
const TILE_Z = 64;

const WALL_TOP = 470;
const FADE_FROM = 10;
const DROP = 160;
const REACH = 6;
const BANDS = 18;

const TALL: ReadonlySet<Piece> = new Set(['shelf', 'bookcase', 'vaultDoor', 'noticeBoard', 'rack', 'mirror', 'hatStand', 'boardRack', 'kitchen', 'wardrobe', 'tv', 'cabinet', 'bell', 'sanctum', 'sideShrine']);

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

function floorMarble(g: G, x1: number, y1: number, rand: () => number, edge: { field: number; joint: number; line: number } = { field: 0x4a5e58, joint: 0x3e504b, line: GOLD }): void {
  const B = MARBLE_BORDER;
  fan(g, edge.field, quad(1, 1, x1, y1));
  for (let x = 1; x < x1 - 0.01; x += 1) fan(g, edge.joint, quad(x, 1, x + 0.02, 1 + B));
  fan(g, edge.line, quad(1 + B - 0.06, 1 + B - 0.06, x1 - B + 0.06, y1 - B + 0.06));
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

// Arcade carpet: deep blue with neon confetti, squiggles and rings scattered over it.
function floorArcade(g: G, x1: number, y1: number, rand: () => number): void {
  const base = 0x1e1a3a;
  fan(g, base, quad(1, 1, x1, y1));
  const area = (x1 - 1) * (y1 - 1);
  for (let i = 0; i < area * 1.2; i++) floorEllipse(g, 1.3 + rand() * (x1 - 2.6), 1.3 + rand() * (y1 - 2.6), 0.3 + rand() * 0.4, rand() > 0.5 ? 0x3a2a6a : 0x141028, 0.35);
  for (let i = 0; i < area * 7; i++) {
    const x = 1.08 + rand() * (x1 - 1.16);
    const y = 1.08 + rand() * (y1 - 1.16);
    const col = pick(NEON, rand);
    const k = rand();
    if (k < 0.35) {
      const a = rand() * Math.PI * 2;
      const r = 0.06 + rand() * 0.04;
      fan(g, col, [0, 1, 2].map((i2) => P(x + Math.cos(a + (i2 * Math.PI * 2) / 3) * r, y + Math.sin(a + (i2 * Math.PI * 2) / 3) * r)), 0.85);
    } else if (k < 0.65) {
      const a = rand() * Math.PI;
      g.lineStyle(1.6 * S, col, 0.8);
      g.beginPath();
      for (let j = 0; j <= 6; j++) {
        const t = j / 6 - 0.5;
        const q = P(x + Math.cos(a) * t * 0.3 - Math.sin(a) * Math.sin(j * 1.6) * 0.03, y + Math.sin(a) * t * 0.3 + Math.cos(a) * Math.sin(j * 1.6) * 0.03);
        if (j === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      }
      g.strokePath();
    } else if (k < 0.85) {
      const c = P(x, y);
      g.lineStyle(1.4 * S, col, 0.8);
      g.strokeEllipse(c.x, c.y, 0.09 * 2 * RX, 0.09 * 2 * RY, 12);
    } else {
      fan(g, col, quad(x - 0.025, y - 0.025, x + 0.025, y + 0.025), 0.9);
    }
  }
  fan(g, WHITE, quad(1, 1, x1, y1), 0.02);
}

// Office carpet tiles, each laid at right angles to its neighbours so the pile reads as a soft chequer.
function floorCarpetTiles(g: G, x1: number, y1: number, base: number, rand: () => number): void {
  fan(g, shade(base, 0.25), quad(1, 1, x1, y1));
  for (let y = 1; y < y1 - 0.01; y += 0.5) {
    for (let x = 1; x < x1 - 0.01; x += 0.5) {
      const xe = Math.min(x1, x + 0.5) - 0.008;
      const ye = Math.min(y1, y + 0.5) - 0.008;
      const odd = (Math.round((x - 1) * 2) + Math.round((y - 1) * 2)) % 2 === 1;
      const col = jitter(odd ? shade(base, 0.06) : lit(base, 0.04), rand, 0.03);
      fan(g, col, quad(x + 0.008, y + 0.008, xe, ye));
      for (let k = 0.08; k < 0.46; k += 0.09) {
        if (odd) line(g, P(x + k, y + 0.03), P(x + k, ye - 0.03), 1, shade(col, 0.12), 0.35);
        else line(g, P(x + 0.03, y + k), P(xe - 0.03, y + k), 1, shade(col, 0.12), 0.35);
      }
    }
  }
}

// A slatted cast-iron drain in the tiled floor, with the wet sheen spread round it.
function floorDrain(g: G, x: number, y: number, rand: () => number): void {
  for (let i = 0; i < 5; i++) floorEllipse(g, x + (rand() - 0.5) * 1.6, y + (rand() - 0.5) * 1.2, 0.25 + rand() * 0.45, WHITE, 0.08);
  floorEllipse(g, x, y, 0.55, 0x6a8a9a, 0.12);
  fan(g, 0x5a6670, quad(x - 0.2, y - 0.2, x + 0.2, y + 0.2));
  fan(g, 0x2a3036, quad(x - 0.16, y - 0.16, x + 0.16, y + 0.16));
  for (let k = -0.12; k < 0.13; k += 0.06) fan(g, 0x7a868e, quad(x - 0.15, y + k - 0.012, x + 0.15, y + k + 0.012));
}

// A worn runner up the middle of the chapel, from the doorway to where the candles stand.
function aisleRunner(g: G, layout: RoomLayout, x: number, y0: number, y1: number): void {
  const z = 0.4;
  fan(g, SHADOW, quad(x - 0.36, y0 + 0.04, x + 0.42, y1 + 0.03), 0.12);
  fan(g, 0x6a2a3a, quad(x - 0.38, y0, x + 0.38, y1, z));
  fan(g, 0xe8c070, quad(x - 0.3, y0, x + 0.3, y1, z));
  fan(g, 0x8a3a4a, quad(x - 0.27, y0, x + 0.27, y1, z));
  for (let y = y0 + 0.5; y < y1 - 0.3; y += 1) fan(g, 0xe8c070, [P(x - 0.12, y, z), P(x, y - 0.14, z), P(x + 0.12, y, z), P(x, y + 0.14, z)], 0.8);
  fan(g, WHITE, quad(x - 0.38, y0, x - 0.2, y1, z), 0.06);
  if (y1 >= layout.d - 1.01) fan(g, 0xb8a890, quad(x - 0.38, y1 - 0.02, x + 0.38, y1, z));
}

// ---------- Walls ----------

interface WallLook {
  readonly upper: number;
  readonly lower: number;
  readonly trim: number;
  readonly skirt: number;
  readonly frame: number;
}

// The finishes of the civic and trade rooms, by their wall; null leaves the room to the plain finishes below.
function roomWallLook(layout: RoomLayout, room: RoomKind): WallLook | null {
  const stone = layout.wall === 'stone';
  const brick = layout.wall === 'brick';
  switch (room) {
    case 'cityHall':
      return layout.wall === 'panel'
        ? { upper: 0xe2e6ea, lower: 0x5e3c28, trim: 0x7a5034, skirt: 0x3e2a1e, frame: 0xf2f0ea }
        : { upper: 0xe6e2da, lower: 0xc8c2b6, trim: 0xf6f4ee, skirt: 0x8a8a90, frame: 0xf4f2ec };
    case 'chapel':
      return stone
        ? { upper: 0xece2cc, lower: 0xd8ccb4, trim: 0xf6f0e2, skirt: 0xb4a68e, frame: 0xf4ecdc }
        : { upper: 0xf6f0e4, lower: 0xe0d4be, trim: 0xfbf8f0, skirt: 0xc8b89a, frame: 0xece2cc };
    case 'arcade':
      return brick
        ? { upper: 0x4a2e48, lower: 0x1e1a2e, trim: 0x2e2640, skirt: 0x120f1e, frame: 0x2e2640 }
        : { upper: 0x2c2448, lower: 0x1c1832, trim: 0x3a3060, skirt: 0x120f1e, frame: 0x3a3060 };
    case 'fishMarket':
      return brick
        ? { upper: 0xa85a3e, lower: 0xf2f4f2, trim: 0xf4f6f6, skirt: 0x3f6f8e, frame: 0xf4f6f6 }
        : { upper: 0xdbe8e6, lower: 0xf2f4f2, trim: 0xfafcfc, skirt: 0x3f6f8e, frame: 0xf4f6f6 };
    case 'office':
      return layout.wall === 'panel'
        ? { upper: 0xe6e2d8, lower: 0xb08a62, trim: 0xc89a6a, skirt: 0x5e4a3a, frame: 0xf4f4f0 }
        : { upper: 0xeeebe4, lower: 0x8a9cae, trim: 0xfaf8f4, skirt: 0x4a4e58, frame: 0xf4f4f0 };
    case 'temple':
      return stone
        ? { upper: 0xd6d4c6, lower: 0xaaac9e, trim: 0xe8e4d4, skirt: 0x8a8c80, frame: 0x6a4630 }
        : layout.wall === 'panel'
          ? { upper: 0xf0e4c8, lower: 0x7a4e32, trim: 0x8e6040, skirt: 0x4a3022, frame: 0x6a4430 }
          : { upper: 0xf2e8d4, lower: 0x3f7472, trim: 0xe6d6b4, skirt: 0x4e3626, frame: 0x6e4830 };
    case 'mandir':
      return stone
        ? { upper: 0xe6cfa0, lower: 0xc89a66, trim: 0xf4e6c6, skirt: 0xa87a4e, frame: 0xc8955a }
        : { upper: 0xf7efde, lower: 0xb8483a, trim: 0xf2c46a, skirt: 0x8a3428, frame: 0xb8483a };
    default:
      return null;
  }
}

function wallLook(layout: RoomLayout, room: RoomKind, rand: () => number): WallLook {
  const special = roomWallLook(layout, room);
  if (special !== null) return special;
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

// The fishmonger's wall: white glazed tiles from the floor to shoulder height, with a band of harbour blue near the top.
function tiledWainscot(g: G, side: Side, u1: number, look: WallLook, rand: () => number): void {
  const pl = 1 + FACE * 0.4;
  const TW = 0.25;
  const TH = 9;
  plate(g, side, pl, 1, u1, 0, TILE_Z, onWall(side, 0xb8c8cc));
  for (let k = 0; k * TH < TILE_Z - 1; k++) {
    const z0 = k * TH + 0.6;
    const z1 = Math.min(TILE_Z, (k + 1) * TH) - 0.6;
    const band = k === Math.floor(TILE_Z / TH) - 2;
    for (let u = 1; u < u1; u += TW) {
      const b = Math.min(u1, u + TW) - 0.012;
      const col = band ? jitter(0x3f7fae, rand, 0.06) : jitter(look.lower, rand, 0.025);
      plate(g, side, pl, u + 0.012, b, z0, z1, onWall(side, col));
      plate(g, side, pl, u + 0.03, u + 0.08, z1 - 3, z1 - 1, onWall(side, WHITE), 0.5);
    }
  }
  plate(g, side, pl, 1, u1, TILE_Z, TILE_Z + 3, onWall(side, 0x3f6f8e));
  plate(g, side, pl, 1, u1, TILE_Z + 3, TILE_Z + 4, SHADOW, 0.15);
}

// A neon tube run along a wall at height z, its colour bleeding onto the wall round it.
function neonStrip(g: G, side: Side, u1: number, z: number, col: number): void {
  const pl = 1 + FACE * 0.8;
  for (const [k, alpha] of [[14, 0.06], [9, 0.08], [5, 0.12]] as const) plate(g, side, pl, 1, u1, z - k, z + k, col, alpha);
  plate(g, side, pl + 0.001, 1, u1, z - 1.6, z + 1.6, lit(col, 0.2));
  plate(g, side, pl + 0.002, 1, u1, z - 0.5, z + 0.5, WHITE, 0.85);
}

function skirting(g: G, side: Side, u1: number, look: WallLook): void {
  const pl = 1 + FACE * 0.5;
  plate(g, side, pl, 1, u1, 0, SKIRT_H, onWall(side, look.skirt));
  plate(g, side, pl, 1, u1, SKIRT_H - 1.6, SKIRT_H, onWall(side, lit(look.skirt, 0.35)));
}

// ---------- Wall decor ----------

type DecorKind = 'window' | 'arch' | 'curtains' | 'picture' | 'cross' | 'clock' | 'lancet' | 'rose' | 'crest' | 'neon' | 'poster' | 'chart' | 'slate' | 'buoy' | 'lattice' | 'hanging' | 'jali' | 'niche';
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
  if (room === 'cityHall') {
    const centre = north.reduce<number | null>((best, u) => (best === null || Math.abs(u + 0.5 - layout.w / 2) < Math.abs(best + 0.5 - layout.w / 2) ? u : best), null);
    if (centre !== null) {
      out.push({ kind: 'crest', side: 'n', u: centre });
      claim(north, centre);
    }
    put('clock', 'w', west);
  }
  if (room === 'chapel') {
    const altar = layout.furniture.find((f) => f.piece === 'candles');
    const side: Side = altar !== undefined && altar.c === 1 && altar.r > 1 ? 'w' : 'n';
    const list = side === 'w' ? west : north;
    const want = altar === undefined ? Math.floor(layout.w / 2) : side === 'w' ? altar.r : altar.r === 1 ? altar.c : Math.floor(layout.w / 2);
    const u = list.includes(want) ? want : list.reduce<number | null>((best, v) => (best === null || Math.abs(v - want) < Math.abs(best - want) ? v : best), null);
    if (u !== null) {
      out.push({ kind: 'rose', side, u });
      claim(list, u);
    }
  }
  if (room === 'arcade') {
    put('neon', 'n', north);
    put('poster', 'w', west);
    put('neon', 'w', west);
    put('poster', 'n', north);
    if (rand() < 0.6) put('poster', 'n', north);
    if (rand() < 0.6) put('neon', 'w', west);
    return out;
  }
  if (room === 'fishMarket') {
    put('slate', 'n', north);
    put('buoy', west.length > 0 ? 'w' : 'n', west.length > 0 ? west : north);
  }
  if (room === 'office') {
    put('chart', 'n', north);
    put('clock', 'n', north);
    put('chart', 'w', west);
  }
  if (room === 'temple') {
    put('hanging', 'n', north);
    put('hanging', 'n', north);
    put('hanging', west.length > 0 ? 'w' : 'n', west.length > 0 ? west : north);
  }
  if (room === 'mandir') {
    put('niche', 'n', north);
    put('niche', west.length > 0 ? 'w' : 'n', west.length > 0 ? west : north);
  }
  const kind: DecorKind = room === 'mintHall' || room === 'cityHall' ? 'arch' : room === 'chapel' ? 'lancet' : room === 'temple' ? 'lattice' : room === 'mandir' ? 'jali' : 'window';
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
  spaced('w', west, room === 'flat' ? 1 : room === 'office' || room === 'fishMarket' || room === 'temple' || room === 'mandir' ? 2 : 3);
  spaced('n', north, room === 'mintHall' ? 4 : room === 'flat' ? 0 : room === 'chapel' ? 3 : 2);
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

function drawWindow(g: G, d: Decor, h: number, look: WallLook, rand: () => number, blinds = false): void {
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
  if (blinds) {
    const low = z1 - (z1 - z0) * (0.3 + rand() * 0.25);
    for (let z = z1 - 1; z > low; z -= 3.2) {
      plate(g, side, pl + 0.002, u0 + 0.01, u1 - 0.01, z - 2.4, z, onWall(side, 0xf2f0ea));
      plate(g, side, pl + 0.002, u0 + 0.01, u1 - 0.01, z - 2.4, z - 1.8, SHADOW, 0.2);
    }
    plate(g, side, pl + 0.003, u0, u1, low - 1.5, low + 0.6, onWall(side, 0xd8d4cc));
    plate(g, side, pl + 0.003, u1 - 0.08, u1 - 0.07, low - 14, low, onWall(side, 0x8a8a90));
  }
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

function banner(g: G, u0: number, u1: number, h: number, cloth = 0x8a2a32): void {
  const pl = 1 + FACE * 3;
  const z0 = 34;
  const z1 = h - 24;
  const uc = (u0 + u1) / 2;
  const shape = (i: number): [number, number][] => [[u0 + i, z1], [u1 - i, z1], [u1 - i, z0 + i * 20], [uc, z0 + 9 + i * 20], [u0 + i, z0 + i * 20]];
  poly(g, 'n', pl, shape(0), onWall('n', GOLD));
  poly(g, 'n', pl, shape(0.03), onWall('n', cloth));
  plate(g, 'n', pl, u0 + 0.03, uc - 0.04, z0 + 6, z1, lit(cloth, 0.12), 0.5);
  fan(g, GOLD, ring('n', pl, uc, z1 - 22, 0.12, 16));
  fan(g, cloth, ring('n', pl, uc, z1 - 22, 0.07, 12));
  if (cloth === HARBOUR) for (const dz of [-34, -40]) plate(g, 'n', pl + 0.001, u0 + 0.06, u1 - 0.06, z1 + dz, z1 + dz + 2, onWall('n', 0xf4f2ec), 0.85);
  plate(g, 'n', pl + 0.002, u0 - 0.06, u1 + 0.06, z1, z1 + 2.5, 0x4a3426);
}

function lancetOutline(u0: number, u1: number, z0: number, z1: number): [number, number][] {
  const w = u1 - u0;
  const rz = w * ROUND;
  const zs = z1 - rz * Math.sin(Math.PI / 3);
  const pts: [number, number][] = [[u0, z0], [u1, z0], [u1, zs]];
  for (let i = 1; i <= 8; i++) {
    const t = ((Math.PI / 3) * i) / 8;
    pts.push([u0 + w * Math.cos(t), zs + rz * Math.sin(t)]);
  }
  for (let i = 1; i <= 8; i++) {
    const t = (2 * Math.PI) / 3 + ((Math.PI / 3) * i) / 8;
    pts.push([u1 + w * Math.cos(t), zs + rz * Math.sin(t)]);
  }
  return pts;
}

// A tall pointed chapel window of soft coloured quarries in lead, two lights wide.
function drawLancet(g: G, d: Decor, h: number, look: WallLook, rand: () => number): void {
  const { side } = d;
  const pl = 1 + FACE;
  const u0 = d.u + 0.27;
  const u1 = d.u + 0.73;
  const z0 = 34;
  const z1 = h - 20;
  const zs = z1 - (u1 - u0) * ROUND * Math.sin(Math.PI / 3);
  const lead = onWall(side, 0x4a4450);
  poly(g, side, pl, lancetOutline(u0 - 0.06, u1 + 0.06, z0 - 5, z1 + 6), onWall(side, shade(look.frame, 0.06)));
  poly(g, side, pl, lancetOutline(u0 - 0.03, u1 + 0.03, z0 - 2, z1 + 3), onWall(side, lit(look.frame, 0.2)));
  poly(g, side, pl, lancetOutline(u0, u1, z0, z1), lead);
  const mid = (u0 + u1) / 2;
  const rowH = 8;
  for (let z = z0 + 1; z < zs - 1; z += rowH) {
    for (const [a, b] of [[u0 + 0.012, mid - 0.012], [mid + 0.012, u1 - 0.012]] as const) {
      const col = mix(pick(GLASS, rand), WHITE, 0.25 + rand() * 0.15);
      plate(g, side, pl, a, b, z + 0.6, Math.min(zs - 1, z + rowH) - 0.6, onWall(side, col));
      plate(g, side, pl, a, b, Math.min(zs - 1, z + rowH) - 2.2, Math.min(zs - 1, z + rowH) - 0.6, WHITE, 0.25);
    }
  }
  poly(g, side, pl, lancetOutline(u0 + 0.02, u1 - 0.02, zs + 0.5, z1 - 2).slice(2), onWall(side, mix(0xf6d88a, WHITE, 0.2)));
  const head = fp(side, mid, pl, zs + (z1 - zs) * 0.45);
  for (const [r, col] of [[3.6, 0x4a4450], [2.6, mix(0xf2b8c8, WHITE, 0.1)], [1, WHITE]] as const) {
    g.fillStyle(onWall(side, col), 1);
    g.fillCircle(head.x, head.y, r * S);
  }
  plate(g, side, pl + 0.0005, mid - 0.012, mid + 0.012, z0, zs + 2, lead);
  poly(g, side, pl + 0.001, [[u0 + 0.04, z0 + 8], [u0 + 0.1, z0 + 8], [u0 + 0.16, zs - 10], [u0 + 0.1, zs - 10]], WHITE, 0.18);
  plate(g, side, 1 + 0.08, u0 - 0.1, u1 + 0.1, z0 - 9, z0 - 5, onWall(side, look.trim));
  fan(g, lit(look.trim, 0.15), [fp(side, u0 - 0.1, pl, z0 - 5), fp(side, u1 + 0.1, pl, z0 - 5), fp(side, u1 + 0.1, 1.08, z0 - 5), fp(side, u0 - 0.1, 1.08, z0 - 5)]);
}

// A round window of coloured petals set high over the candles: a plain flower of glass, no emblem.
function drawRose(g: G, d: Decor, h: number, look: WallLook): void {
  const { side } = d;
  const pl = 1 + FACE * 2;
  const uc = d.u + 0.5;
  const zc = h - 38;
  const r = 0.44;
  fan(g, onWall(side, shade(look.frame, 0.08)), ring(side, pl, uc, zc, r + 0.07, 32));
  fan(g, onWall(side, lit(look.frame, 0.2)), ring(side, pl, uc, zc, r + 0.04, 32));
  fan(g, onWall(side, 0x4a4450), ring(side, pl, uc, zc, r, 32));
  fan(g, onWall(side, mix(0x9fc8e8, WHITE, 0.3)), ring(side, pl, uc, zc, r - 0.02, 32));
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    const col = mix(GLASS[i % GLASS.length] ?? WHITE, WHITE, 0.15);
    fan(g, onWall(side, 0x4a4450), ring(side, pl, uc + Math.cos(t) * 0.25, zc + Math.sin(t) * 0.25 * ROUND, 0.135, 16));
    fan(g, onWall(side, col), ring(side, pl, uc + Math.cos(t) * 0.25, zc + Math.sin(t) * 0.25 * ROUND, 0.115, 16));
  }
  fan(g, onWall(side, 0x4a4450), ring(side, pl, uc, zc, 0.13, 18));
  fan(g, onWall(side, 0xf6d88a), ring(side, pl, uc, zc, 0.11, 18));
  fan(g, WHITE, ring(side, pl, uc, zc, 0.05, 12), 0.7);
  for (const [k, alpha] of [[0.75, 0.06], [0.6, 0.06]] as const) fan(g, WARM, ring(side, pl, uc, zc, r * k + 0.2, 24), alpha);
}

// The city's crest over the council: a harbour-blue shield with a ship on the waves, a walled crown and a ribbon.
function cityCrest(g: G, uc: number, h: number): void {
  const pl = 1 + FACE * 4;
  const zc = h - 44;
  const shield = (k: number): [number, number][] => [[uc - 0.36 * k, zc + 15 * k], [uc + 0.36 * k, zc + 15 * k], [uc + 0.36 * k, zc - 3 * k], [uc + 0.2 * k, zc - 13 * k], [uc, zc - 17 * k], [uc - 0.2 * k, zc - 13 * k], [uc - 0.36 * k, zc - 3 * k]];
  poly(g, 'n', pl - FACE, shield(1.16).map(([u, z]) => [u + 0.05, z - 3] as [number, number]), SHADOW, 0.18);
  poly(g, 'n', pl, shield(1.16), 0x8a6a2a);
  poly(g, 'n', pl, shield(1.08), GOLD);
  poly(g, 'n', pl, shield(0.94), HARBOUR);
  plate(g, 'n', pl, uc - 0.3, uc + 0.3, zc + 6, zc + 13, lit(HARBOUR, 0.12));
  for (const dz of [-9, -5]) {
    for (let u = uc - 0.26; u < uc + 0.24; u += 0.13) poly(g, 'n', pl + 0.001, [[u, zc + dz], [u + 0.065, zc + dz + 2.4], [u + 0.13, zc + dz], [u + 0.13, zc + dz + 1.4], [u + 0.065, zc + dz + 3.8], [u, zc + dz + 1.4]], onWall('n', 0xf4f2ec));
  }
  poly(g, 'n', pl + 0.001, [[uc - 0.2, zc - 2], [uc + 0.22, zc - 2], [uc + 0.15, zc - 7], [uc - 0.14, zc - 7]], 0x6e4430);
  plate(g, 'n', pl + 0.001, uc - 0.012, uc + 0.012, zc - 2, zc + 12, 0x4a3426);
  poly(g, 'n', pl + 0.002, [[uc + 0.02, zc + 11], [uc + 0.17, zc - 0.5], [uc + 0.02, zc - 0.5]], 0xf6f4ee);
  poly(g, 'n', pl + 0.002, [[uc - 0.02, zc + 8], [uc - 0.13, zc], [uc - 0.02, zc]], 0xe8e2d4);
  plate(g, 'n', pl, uc - 0.3, uc + 0.3, zc + 17, zc + 22, GOLD);
  for (const du of [-0.26, -0.1, 0.06, 0.22]) plate(g, 'n', pl, uc + du - 0.02, uc + du + 0.06, zc + 22, zc + 27, GOLD);
  plate(g, 'n', pl, uc - 0.3, uc + 0.3, zc + 17, zc + 18.5, lit(GOLD, 0.3));
  for (const s of [-1, 1] as const) {
    poly(g, 'n', pl + 0.001, [[uc + s * 0.62, zc - 18], [uc + s * 0.42, zc - 16], [uc + s * 0.42, zc - 22], [uc + s * 0.62, zc - 24], [uc + s * 0.54, zc - 21]], onWall('n', 0xd8d0c0));
  }
  poly(g, 'n', pl + 0.002, [[uc - 0.46, zc - 17], [uc + 0.46, zc - 17], [uc + 0.46, zc - 23], [uc - 0.46, zc - 23]], onWall('n', 0xf6f2e8));
  plate(g, 'n', pl + 0.003, uc - 0.36, uc + 0.36, zc - 20.6, zc - 19.4, HARBOUR, 0.7);
}

// The glow a run of neon tube throws, then the tube, along a path drawn on the wall in (u, z).
function neonPath(g: G, side: Side, pl: number, pts: readonly (readonly [number, number])[], col: number, closed = false): void {
  const screen = pts.map(([u, z]) => fp(side, u, pl, z));
  if (closed && screen[0] !== undefined) screen.push(screen[0]);
  for (const [w, c, alpha] of [[9, col, 0.08], [5, col, 0.18], [2.4, lit(col, 0.25), 1], [0.9, WHITE, 0.9]] as const) {
    g.lineStyle(w * S, c, alpha);
    g.beginPath();
    screen.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.strokePath();
  }
}

// A neon sign on the arcade wall: a star, a bolt, a heart or a joystick in glowing tube.
function drawNeon(g: G, d: Decor, h: number, rand: () => number): void {
  const { side } = d;
  const pl = 1 + FACE * 3;
  const uc = d.u + 0.5;
  const zc = h - 46;
  const col = pick(NEON, rand);
  const kind = Math.floor(rand() * 4);
  plate(g, side, pl - FACE, uc - 0.4, uc + 0.4, zc - 18, zc + 18, 0x0b0814, 0.35);
  for (const [k, alpha] of [[1.4, 0.05], [1, 0.06]] as const) fan(g, col, ring(side, pl - FACE, uc, zc, 0.42 * k, 20), alpha);
  if (kind === 0) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const t = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const r = i % 2 === 0 ? 0.3 : 0.13;
      pts.push([uc + Math.cos(t) * r, zc - Math.sin(t) * r * ROUND]);
    }
    neonPath(g, side, pl, pts, col, true);
  } else if (kind === 1) {
    neonPath(g, side, pl, [[uc + 0.08, zc + 15], [uc - 0.14, zc - 1], [uc + 0.03, zc - 1], [uc - 0.1, zc - 16], [uc + 0.16, zc + 3], [uc - 0.01, zc + 3], [uc + 0.08, zc + 15]], col);
  } else if (kind === 2) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      pts.push([uc + 0.17 * Math.pow(Math.sin(t), 3) * 1.6, zc + (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 0.9]);
    }
    neonPath(g, side, pl, pts, col, true);
  } else {
    neonPath(g, side, pl, [[uc - 0.3, zc - 14], [uc + 0.3, zc - 14], [uc + 0.24, zc - 4], [uc - 0.24, zc - 4]], col, true);
    neonPath(g, side, pl, [[uc - 0.06, zc - 4], [uc - 0.02, zc + 9]], col);
    neonPath(g, side, pl, Array.from({ length: 12 }, (_, i) => [uc - 0.01 + Math.cos((i / 12) * Math.PI * 2) * 0.07, zc + 12 + Math.sin((i / 12) * Math.PI * 2) * 0.07 * ROUND] as const), pick(NEON, rand), true);
    neonPath(g, side, pl, [[uc + 0.12, zc - 9], [uc + 0.14, zc - 9]], pick(NEON, rand));
  }
}

// A framed game poster: a bright field with a rocket, planets and stars, and a title bar.
function drawPoster(g: G, d: Decor, rand: () => number): void {
  const { side } = d;
  const pl = 1 + FACE * 2;
  const u0 = d.u + 0.22;
  const u1 = d.u + 0.78;
  const z0 = 50 + rand() * 6;
  const z1 = z0 + 40;
  const field = pick([0x2a2a6a, 0x5a1a4a, 0x1a4a5a, 0x3a1a6a], rand);
  plate(g, side, pl - FACE, u0 + 0.04, u1 + 0.05, z0 - 3, z1 - 3, SHADOW, 0.3);
  plate(g, side, pl, u0, u1, z0, z1, onWall(side, 0x14101e));
  plate(g, side, pl, u0 + 0.03, u1 - 0.03, z0 + 2, z1 - 2, onWall(side, field));
  plate(g, side, pl, u0 + 0.03, u1 - 0.03, z0 + 2, z0 + 12, onWall(side, lit(field, 0.15)));
  for (let i = 0; i < 9; i++) {
    const p = fp(side, u0 + 0.06 + rand() * (u1 - u0 - 0.12), pl, z0 + 14 + rand() * 18);
    g.fillStyle(WHITE, 0.8);
    g.fillCircle(p.x, p.y, (0.6 + rand() * 0.6) * S);
  }
  const planet = pick(NEON, rand);
  fan(g, onWall(side, planet), ring(side, pl, u0 + (u1 - u0) * 0.7, z0 + 24, 0.09, 16));
  fan(g, onWall(side, lit(planet, 0.4)), ring(side, pl, u0 + (u1 - u0) * 0.68, z0 + 25, 0.04, 10));
  const rc = u0 + (u1 - u0) * 0.35;
  poly(g, side, pl, [[rc - 0.05, z0 + 14], [rc + 0.05, z0 + 14], [rc + 0.05, z0 + 26], [rc, z0 + 33], [rc - 0.05, z0 + 26]], onWall(side, 0xf2ece0));
  poly(g, side, pl, [[rc - 0.05, z0 + 14], [rc - 0.1, z0 + 12], [rc - 0.05, z0 + 20]], onWall(side, 0xe0574b));
  poly(g, side, pl, [[rc + 0.05, z0 + 14], [rc + 0.1, z0 + 12], [rc + 0.05, z0 + 20]], onWall(side, 0xe0574b));
  poly(g, side, pl, [[rc - 0.03, z0 + 14], [rc + 0.03, z0 + 14], [rc, z0 + 7]], onWall(side, 0xffc860));
  plate(g, side, pl, u0 + 0.06, u1 - 0.06, z1 - 9, z1 - 4, onWall(side, pick([0xffd83a, 0xff4fa8, 0x3ff0e0], rand)));
  plate(g, side, pl, u0 + 0.1, u1 - 0.1, z0 + 4, z0 + 6, onWall(side, WHITE), 0.6);
}

// A framed chart on the office wall: bars or a rising line on white paper.
function drawChart(g: G, d: Decor, rand: () => number): void {
  const { side } = d;
  const pl = 1 + FACE * 2;
  const u0 = d.u + 0.16;
  const u1 = d.u + 0.84;
  const z0 = 56 + rand() * 4;
  const z1 = z0 + 30;
  const frame = rand() < 0.5 ? 0x2a2a30 : 0xb8bcc4;
  plate(g, side, pl - FACE, u0 + 0.04, u1 + 0.05, z0 - 3, z1 - 3, SHADOW, 0.16);
  plate(g, side, pl, u0, u1, z0, z1, onWall(side, frame));
  plate(g, side, pl, u0 + 0.025, u1 - 0.025, z0 + 1.5, z1 - 1.5, onWall(side, 0xfbfaf6));
  plate(g, side, pl, u0 + 0.06, u0 + 0.32, z1 - 6, z1 - 4.5, onWall(side, 0x3a3e46));
  const a = u0 + 0.08;
  const b = u1 - 0.06;
  const base = z0 + 5;
  plate(g, side, pl, a - 0.01, b, base - 0.6, base + 0.4, onWall(side, 0x6a6e78));
  plate(g, side, pl, a - 0.01, a + 0.004, base, z1 - 9, onWall(side, 0x6a6e78));
  if (rand() < 0.55) {
    const n = 5;
    const w = (b - a) / n;
    for (let i = 0; i < n; i++) {
      const top = base + 3 + (i + 1) * 2.6 + rand() * 4;
      plate(g, side, pl, a + i * w + 0.02, a + (i + 1) * w - 0.02, base + 0.5, Math.min(z1 - 9, top), onWall(side, i === n - 1 ? 0xe0574b : pick([0x3f7fae, 0x3fa7a0], rand)));
    }
    return;
  }
  const pts: [number, number][] = [];
  for (let i = 0; i <= 6; i++) pts.push([a + ((b - a - 0.02) * i) / 6, base + 2 + i * 2.2 + (rand() - 0.4) * 3]);
  g.lineStyle(1.6 * S, onWall(side, 0x3f7fae), 1);
  g.beginPath();
  pts.forEach(([u, z], i) => {
    const q = fp(side, u, pl, z);
    if (i === 0) g.moveTo(q.x, q.y);
    else g.lineTo(q.x, q.y);
  });
  g.strokePath();
  for (const [u, z] of pts) {
    const q = fp(side, u, pl, z);
    g.fillStyle(onWall(side, 0xe0574b), 1);
    g.fillCircle(q.x, q.y, 1.1 * S);
  }
}

// The fishmonger's chalk slate: a fish drawn at the top and the day's prices under it.
function drawSlate(g: G, d: Decor, rand: () => number): void {
  const { side } = d;
  const pl = 1 + FACE * 2;
  const u0 = d.u + 0.12;
  const u1 = d.u + 0.88;
  const z0 = 70;
  const z1 = 104;
  const chalk = onWall(side, 0xeef2ee);
  plate(g, side, pl - FACE, u0 + 0.04, u1 + 0.05, z0 - 3, z1 - 3, SHADOW, 0.2);
  plate(g, side, pl, u0, u1, z0, z1, onWall(side, 0x8a5a3a));
  plate(g, side, pl, u0 + 0.04, u1 - 0.04, z0 + 2.5, z1 - 2.5, onWall(side, 0x2a3230));
  for (let i = 0; i < 4; i++) plate(g, side, pl, u0 + 0.06 + rand() * 0.4, u0 + 0.3 + rand() * 0.4, z0 + 4 + rand() * 24, z0 + 7 + rand() * 24, WHITE, 0.04);
  const fc = (u0 + u1) / 2;
  const fz = z1 - 9;
  const body: [number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const t = (i / 14) * Math.PI * 2;
    body.push([fc + Math.cos(t) * 0.16, fz + Math.sin(t) * 3.6]);
  }
  g.lineStyle(1.1 * S, chalk, 0.9);
  g.beginPath();
  body.forEach(([u, z], i) => {
    const q = fp(side, u, pl + 0.001, z);
    if (i === 0) g.moveTo(q.x, q.y);
    else g.lineTo(q.x, q.y);
  });
  for (const [u, z] of [[fc - 0.16, fz], [fc - 0.26, fz + 4], [fc - 0.26, fz - 4], [fc - 0.16, fz]] as const) {
    const q = fp(side, u, pl + 0.001, z);
    g.lineTo(q.x, q.y);
  }
  g.strokePath();
  const eye = fp(side, fc + 0.09, pl + 0.001, fz + 1);
  g.fillStyle(chalk, 1);
  g.fillCircle(eye.x, eye.y, 0.7 * S);
  for (let k = 0; k < 3; k++) {
    const z = fz - 8 - k * 6;
    plate(g, side, pl + 0.001, u0 + 0.08, u0 + 0.08 + 0.18 + rand() * 0.14, z, z + 1.2, chalk, 0.8);
    plate(g, side, pl + 0.001, u1 - 0.2, u1 - 0.08, z, z + 1.2, onWall(side, pick([0xffe27a, 0xf2b8c8, 0xeef2ee], rand)), 0.85);
  }
}

// A red and white life ring hung on a peg, with its rope looped round it.
function drawBuoy(g: G, d: Decor): void {
  const { side } = d;
  const pl = 1 + FACE * 2;
  const uc = d.u + 0.5;
  const zc = 90;
  const ro = 0.36;
  const ri = 0.2;
  fan(g, SHADOW, ring(side, pl - FACE, uc + 0.04, zc - 3, ro, 24), 0.18);
  const n = 32;
  for (let j = 0; j < n; j++) {
    const t0 = (j / n) * Math.PI * 2;
    const t1 = ((j + 1) / n) * Math.PI * 2;
    const at = (t: number, r: number): [number, number] => [uc + Math.cos(t) * r, zc + Math.sin(t) * r * ROUND];
    const col = Math.floor((j * 4) / n) % 2 === 0 ? 0xe0473b : 0xf6f2ea;
    const shadeK = 0.12 * (1 - Math.cos(t0 + Math.PI * 0.75));
    poly(g, side, pl, [at(t0, ro), at(t1, ro), at(t1, ri), at(t0, ri)], onWall(side, shade(col, shadeK)));
  }
  strokeRing(g, ring(side, pl + 0.001, uc, zc, (ro + ri) / 2, 32), 1 * S, onWall(side, 0xc8a070), 0.9);
  const peg = fp(side, uc, pl + 0.002, zc + ro * ROUND - 1);
  g.fillStyle(onWall(side, 0x4a3426), 1);
  g.fillCircle(peg.x, peg.y, 1.8 * S);
}

function wallPath(g: G, side: Side, pl: number, pts: readonly (readonly [number, number])[], width: number, col: number, alpha = 1): void {
  g.lineStyle(width, col, alpha);
  g.beginPath();
  pts.forEach(([u, z], i) => {
    const q = fp(side, u, pl, z);
    if (i === 0) g.moveTo(q.x, q.y);
    else g.lineTo(q.x, q.y);
  });
  g.strokePath();
}

// A temple window of plain square timber lattice over a view of the harbour: sky, a far headland and the sea.
function drawLattice(g: G, d: Decor, h: number, look: WallLook): void {
  const { side } = d;
  const pl = 1 + FACE;
  const u0 = d.u + 0.16;
  const u1 = d.u + 0.84;
  const z0 = 42;
  const z1 = h - 34;
  const zh = z0 + (z1 - z0) * 0.34;
  const glass = (col: number): number => (side === 'n' ? mix(col, 0x6a6a9a, 0.12) : mix(col, SUN, 0.12));
  const frame = onWall(side, look.frame);
  plate(g, side, pl, u0 - 0.06, u1 + 0.06, z0 - 5, z1 + 5, frame);
  plate(g, side, pl, u0 - 0.06, u1 + 0.06, z1 + 3, z1 + 5, onWall(side, lit(look.frame, 0.3)));
  plate(g, side, pl, u0, u1, zh, z1, glass(SKY.top));
  plate(g, side, pl, u0, u1, zh, zh + (z1 - zh) * 0.55, glass(SKY.mid));
  plate(g, side, pl, u0, u1, zh, zh + (z1 - zh) * 0.22, glass(SKY.low));
  poly(g, side, pl, [[u0, zh], [u0 + 0.22, zh], [u0 + 0.14, zh + 4], [u0 + 0.06, zh + 5.5], [u0, zh + 4]], glass(SKY.roofs), 0.8);
  plate(g, side, pl, u0, u1, z0, zh, glass(0x3f7f9c));
  plate(g, side, pl, u0, u1, zh - 5, zh, glass(0x6aaac0));
  for (let k = 0; k < 4; k++) plate(g, side, pl, u0 + 0.3 + k * 0.03, u0 + 0.38 + k * 0.025, zh - 3 - k * 4, zh - 2.2 - k * 4, WHITE, 0.5 - k * 0.1);
  poly(g, side, pl, [[u0 + 0.05, z0 + 6], [u0 + 0.17, z0 + 6], [u0 + 0.34, z1 - 8], [u0 + 0.22, z1 - 8]], WHITE, 0.12);
  const cols = 3;
  for (let i = 1; i < cols; i++) {
    const u = u0 + ((u1 - u0) * i) / cols;
    plate(g, side, pl, u - 0.012, u + 0.012, z0, z1, frame);
  }
  for (let z = z0 + 12; z < z1 - 4; z += 12) {
    plate(g, side, pl, u0, u1, z - 1, z + 1, frame);
    plate(g, side, pl, u0, u1, z + 1, z + 1.6, onWall(side, lit(look.frame, 0.25)), 0.7);
  }
  const out = 1 + 0.09;
  fan(g, lit(look.frame, 0.2), [fp(side, u0 - 0.09, pl, z0 - 4), fp(side, u1 + 0.09, pl, z0 - 4), fp(side, u1 + 0.09, out, z0 - 4), fp(side, u0 - 0.09, out, z0 - 4)]);
  plate(g, side, out, u0 - 0.09, u1 + 0.09, z0 - 8, z0 - 4, tone(side, look.frame, 0.3));
}

const HANGINGS = [
  { cloth: 0x2f4a7a, ink: 0xf0e6cc },
  { cloth: 0x2f7470, ink: 0xf2e8d0 },
  { cloth: 0xd89a3a, ink: 0x7a2e24 },
  { cloth: 0xa8503a, ink: 0xf4e4c4 },
] as const;

// A long cloth hanging on a timber rod: waves, chevrons or a column of diamonds in a plain second colour, fringed below.
function drawHanging(g: G, d: Decor, h: number, rand: () => number): void {
  const { side } = d;
  const pl = 1 + FACE * 3;
  const u0 = d.u + 0.29;
  const u1 = d.u + 0.71;
  const uc = (u0 + u1) / 2;
  const zt = h - 32;
  const zb = 34 + rand() * 6;
  const { cloth, ink } = HANGINGS[Math.floor(rand() * HANGINGS.length)] ?? HANGINGS[0];
  const c = onWall(side, cloth);
  const k = onWall(side, ink);
  plate(g, side, pl - FACE, u0 + 0.04, u1 + 0.05, zb - 3, zt - 2, SHADOW, 0.16);
  plate(g, side, pl, u0, u1, zb, zt, c);
  plate(g, side, pl, u0, u0 + 0.06, zb, zt, onWall(side, lit(cloth, 0.12)), 0.6);
  plate(g, side, pl, u1 - 0.05, u1, zb, zt, onWall(side, shade(cloth, 0.14)), 0.6);
  for (const u of [u0 + 0.025, u1 - 0.035]) plate(g, side, pl + 0.001, u, u + 0.01, zb + 4, zt - 4, k, 0.8);
  const kind = Math.floor(rand() * 3);
  const a = u0 + 0.06;
  const b = u1 - 0.06;
  if (kind === 2) {
    for (let z = zb + 12; z < zt - 10; z += 15) {
      poly(g, side, pl + 0.001, [[uc - 0.09, z], [uc, z - 6], [uc + 0.09, z], [uc, z + 6]], k);
      poly(g, side, pl + 0.002, [[uc - 0.045, z], [uc, z - 3], [uc + 0.045, z], [uc, z + 3]], c);
    }
  } else {
    for (let z = zb + 9; z < zt - 6; z += 9) {
      const pts: [number, number][] = [];
      if (kind === 0) for (let u = a; u <= b + 0.001; u += 0.02) pts.push([u, z + 2 * Math.sin(((u - a) / 0.14) * Math.PI * 2)]);
      else for (let i = 0; i <= 6; i++) pts.push([a + ((b - a) * i) / 6, z + (i % 2 === 0 ? -2.4 : 2.4)]);
      wallPath(g, side, pl + 0.001, pts, 1.3 * S, k, 0.9);
    }
  }
  for (let u = u0 + 0.02; u < u1 - 0.01; u += 0.045) line(g, fp(side, u, pl + 0.001, zb), fp(side, u, pl + 0.001, zb - 5), 1.4, k, 0.9);
  plate(g, side, pl + 0.002, u0 - 0.02, u1 + 0.02, zb - 0.5, zb + 2, onWall(side, 0x4a3426));
  wallPath(g, side, pl + 0.001, [[u0 - 0.02, zt + 2], [uc, zt + 13], [u1 + 0.02, zt + 2]], 1.1, onWall(side, 0xc8a070));
  plate(g, side, pl + 0.003, u0 - 0.08, u1 + 0.08, zt - 0.5, zt + 3, onWall(side, 0x4a3426));
  for (const u of [u0 - 0.08, u1 + 0.08]) {
    const p = fp(side, u, pl + 0.004, zt + 1.2);
    g.fillStyle(onWall(side, BRASS), 1);
    g.fillCircle(p.x, p.y, 2.2 * S);
  }
  const peg = fp(side, uc, pl + 0.004, zt + 13);
  g.fillStyle(onWall(side, 0x4a3426), 1);
  g.fillCircle(peg.x, peg.y, 1.6 * S);
}

// A teal band under the temple's cornice with a single running wave painted along it.
function waveFrieze(g: G, side: Side, u1: number, h: number, look: WallLook): void {
  const pl = 1 + FACE * 0.7;
  const z0 = h - CORNICE_H - 12;
  const z1 = h - CORNICE_H - 2;
  const band = look.lower === 0x3f7472 ? shade(look.lower, 0.25) : 0x3f7472;
  plate(g, side, pl, 1, u1, z0, z1, onWall(side, band));
  plate(g, side, pl, 1, u1, z0, z0 + 1, onWall(side, GOLD), 0.7);
  plate(g, side, pl, 1, u1, z1 - 1, z1, onWall(side, GOLD), 0.7);
  const pts: [number, number][] = [];
  for (let u = 1; u <= u1; u += 0.02) pts.push([u, (z0 + z1) / 2 + 2.4 * Math.sin(((u - 1) / 0.32) * Math.PI * 2)]);
  wallPath(g, side, pl + 0.001, pts, 1.3 * S, onWall(side, 0xf2e8d0), 0.85);
}

// A string of round paper lanterns sagging along the top of a temple wall, each glowing warm.
function lanternGarland(g: G, side: Side, u1: number, h: number, rand: () => number): void {
  const pl = 1 + 0.06;
  const top = h - CORNICE_H - 16;
  const span = 2;
  const papers = [0xfff0cc, 0xf6c46a, 0xf2a07a] as const;
  for (let u = 1.15; u < u1 - 0.4; u += span) {
    const e = Math.min(u1, u + span);
    const sag = 9 * ((e - u) / span);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push([u + (e - u) * t, top - sag * 4 * t * (1 - t)]);
    }
    wallPath(g, side, pl, pts, 1, onWall(side, 0x4a3426), 0.8);
    for (const p of [u, e]) {
      const q = fp(side, p, pl, top);
      g.fillStyle(onWall(side, 0x4a3426), 1);
      g.fillCircle(q.x, q.y, 1.4 * S);
    }
    const mu = (u + e) / 2;
    const mz = top - sag - 3;
    line(g, fp(side, mu, pl, top - sag), fp(side, mu, pl, mz), 1, onWall(side, 0x4a3426));
    const c = fp(side, mu, pl, mz - 6);
    for (const [r, alpha] of [[22, 0.04], [14, 0.06], [9, 0.09]] as const) {
      g.fillStyle(WARM, alpha);
      g.fillCircle(c.x, c.y, r * S);
    }
    const paper = pick(papers, rand);
    g.fillStyle(0x4a3426, 1);
    g.fillRect(c.x - 2.4 * S, c.y - 7.4 * S, 4.8 * S, 2 * S);
    g.fillRect(c.x - 2.4 * S, c.y + 5.4 * S, 4.8 * S, 2 * S);
    g.fillStyle(paper, 1);
    g.fillEllipse(c.x, c.y, 10 * S, 11.5 * S, 16);
    g.fillStyle(WHITE, 0.4);
    g.fillEllipse(c.x - 1.2 * S, c.y - 0.6 * S, 5 * S, 7.5 * S, 12);
    g.lineStyle(0.9, shade(paper, 0.3), 0.55);
    for (const dy of [-2.8, 0, 2.8]) g.strokeEllipse(c.x, c.y + dy * S, (dy === 0 ? 10 : 8.6) * S, 1.6 * S, 12);
  }
}

// ---------- Mandir walls ----------

const SANDSTONE = 0xe4c792;
const SAFFRON = 0xf08a24;
const KUMKUM = 0xb8282e;
const CLAY = 0xa8522e;
const MARBLE_WHITE = 0xf4eee2;
const MANGO = { light: 0x6aa846, dark: 0x3a7030 } as const;
const MARIGOLDS = [0xf08a1e, 0xf8b828] as const;
const LOTUS = 0xe8708a;

function blossom(g: G, x: number, y: number, r: number, col: number): void {
  g.fillStyle(shade(col, 0.35), 1);
  g.fillCircle(x + 0.3 * r * S, y + 0.45 * r * S, r * S);
  g.fillStyle(col, 1);
  g.fillCircle(x, y, r * 0.88 * S);
  g.fillStyle(lit(col, 0.45), 0.9);
  g.fillCircle(x - 0.3 * r * S, y - 0.3 * r * S, r * 0.38 * S);
}

// A strand of marigolds along a screen path: blossoms of radius r in runs of orange and yellow.
function marigolds(g: G, pts: readonly Pt[], r: number, tint: (col: number) => number = (c) => c, phase = 0): void {
  const step = r * 1.45 * S;
  let carry = 0;
  let n = phase;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let d = carry;
    for (; d <= len; d += step) {
      const t = len === 0 ? 0 : d / len;
      blossom(g, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r, tint(MARIGOLDS[Math.floor(n / 3) % 2] ?? SAFFRON));
      n++;
    }
    carry = d - len;
  }
}

// A sag between two screen points, `sag` art px deep at its middle.
function swag(a: Pt, b: Pt, sag: number, n = 14): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + sag * S * 4 * t * (1 - t) });
  }
  return out;
}

// A short drop of marigolds ending in a red bud, with mango leaves fanned at its hook: one knot of a toran.
function garlandDrop(g: G, at: Pt, len: number, k = 1, tint: (col: number) => number = (c) => c): void {
  for (const ang of [0.9, 1.25, 1.9, 2.25]) leaf(g, at, ang, 11 * k, 3 * k, tint(MANGO.light), tint(MANGO.dark));
  marigolds(g, [at, { x: at.x, y: at.y + len * S * k }], 2.1 * k, tint);
  g.fillStyle(tint(KUMKUM), 1);
  g.fillCircle(at.x, at.y + (len + 2.6) * S * k, 1.9 * S * k);
}

function flameAt(g: G, p: Pt, k = 1): void {
  const s = S * k;
  for (const [r, alpha] of [[13, 0.07], [8, 0.12], [4.5, 0.18]] as const) {
    g.fillStyle(WARM, alpha);
    g.fillCircle(p.x, p.y - 3 * s, r * s);
  }
  g.fillStyle(FLAME, 0.95);
  g.fillEllipse(p.x, p.y - 3 * s, 2.8 * s, 6.4 * s, 10);
  g.fillStyle(0xfff6d8, 1);
  g.fillEllipse(p.x, p.y - 2.2 * s, 1.3 * s, 3 * s, 8);
}

// A clay diya standing at a screen point, its wick burning at the spout.
function diyaAt(g: G, p: Pt, k = 1): void {
  const s = S * k;
  g.fillStyle(shade(CLAY, 0.4), 1);
  g.fillEllipse(p.x + 0.6 * s, p.y - 1.2 * s, 11 * s, 4.6 * s, 14);
  g.fillStyle(CLAY, 1);
  g.fillTriangle(p.x + 2.5 * s, p.y - 4.6 * s, p.x + 2.5 * s, p.y - 1.4 * s, p.x + 7.2 * s, p.y - 4 * s);
  g.fillEllipse(p.x, p.y - 2.4 * s, 10 * s, 4.4 * s, 14);
  g.fillStyle(0x4a2410, 1);
  g.fillEllipse(p.x - 0.3 * s, p.y - 3.1 * s, 7 * s, 2.3 * s, 12);
  g.fillStyle(lit(CLAY, 0.35), 0.8);
  g.fillEllipse(p.x - 3 * s, p.y - 2.4 * s, 3 * s, 1.6 * s, 8);
  flameAt(g, { x: p.x + 6.2 * s, y: p.y - 4.2 * s }, k * 0.85);
}

// A lotus seen from the front at a screen point: five petals over a low bowl, opening upward.
function lotusAt(g: G, p: Pt, r: number, col: number, tint: (col: number) => number = (c) => c): void {
  const s = S * r;
  for (const [ang, len, k] of [[-2.85, 0.78, 0.22], [-0.29, 0.78, 0.32], [-2.2, 0.98, 0.06], [-0.94, 0.98, 0.16], [-Math.PI / 2, 1.12, -0.15]] as const) {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const w = 0.44;
    const tip = { x: p.x + dx * len * s, y: p.y + dy * len * s };
    const side = (d: number): Pt => ({ x: p.x + (dx * 0.5 - dy * w * d) * s, y: p.y + (dy * 0.5 + dx * w * d) * s });
    fan(g, tint(k < 0 ? lit(col, -k) : shade(col, k)), [p, side(1), tip, side(-1)]);
  }
  g.fillStyle(tint(MANGO.dark), 1);
  g.fillEllipse(p.x, p.y + 0.2 * s, 1.7 * s, 0.5 * s, 14);
  g.fillStyle(tint(lit(col, 0.5)), 1);
  g.fillCircle(p.x, p.y - 0.12 * s, 0.16 * s);
}

// A full kalash seen from the front: a round pot with a neck, mango leaves fanned out of its mouth and a coconut on top.
function kalashAt(g: G, p: Pt, r: number, metal: number, tint: (col: number) => number = (c) => c): void {
  const s = S * r;
  const mouth = { x: p.x, y: p.y - 1.75 * s };
  for (const ang of [-2.6, -2.15, -1.0, -0.55]) leaf(g, mouth, ang, 1.15 * r, 0.32 * r, tint(MANGO.light), tint(MANGO.dark));
  g.fillStyle(tint(shade(metal, 0.2)), 1);
  g.fillEllipse(p.x, p.y - 0.8 * s, 2 * s, 1.75 * s, 18);
  g.fillStyle(tint(metal), 1);
  g.fillEllipse(p.x - 0.08 * s, p.y - 0.86 * s, 1.8 * s, 1.6 * s, 18);
  g.fillStyle(tint(lit(metal, 0.5)), 0.85);
  g.fillEllipse(p.x - 0.4 * s, p.y - 1.1 * s, 0.5 * s, 0.7 * s, 10);
  g.fillStyle(tint(KUMKUM), 1);
  g.fillRect(p.x - 0.5 * s, p.y - 1.72 * s, 1 * s, 0.22 * s);
  g.fillStyle(tint(metal), 1);
  g.fillRect(p.x - 0.62 * s, p.y - 1.92 * s, 1.24 * s, 0.22 * s);
  g.fillStyle(tint(0x7a4a2a), 1);
  g.fillEllipse(p.x, p.y - 2.35 * s, 1.1 * s, 0.95 * s, 14);
  g.fillStyle(tint(0xa8743e), 1);
  g.fillEllipse(p.x - 0.12 * s, p.y - 2.45 * s, 0.6 * s, 0.5 * s, 10);
}

// A carved stone jali under a round arch: a pierced diamond lattice glowing with daylight, a lotus cut in the arch.
function drawJali(g: G, d: Decor, h: number, look: WallLook): void {
  const { side } = d;
  const pl = 1 + FACE;
  const u0 = d.u + 0.24;
  const u1 = d.u + 0.76;
  const z0 = 44;
  const z1 = h - 38;
  const uc = (u0 + u1) / 2;
  const rz = ((u1 - u0) / 2) * ROUND;
  const zs = z1 - rz;
  const stone = onWall(side, shade(mix(look.trim, look.lower, 0.35), 0.06));
  const light = side === 'n' ? 0xffd27a : mix(0xffd27a, 0xd88a50, 0.2);
  poly(g, side, pl, windowOutline(u0 - 0.08, u1 + 0.08, z0 - 7, z1 + 7, true), onWall(side, look.frame));
  poly(g, side, pl, windowOutline(u0 - 0.05, u1 + 0.05, z0 - 4, z1 + 4, true), onWall(side, lit(look.frame, 0.25)));
  poly(g, side, pl, windowOutline(u0, u1, z0, z1, true), light);
  plate(g, side, pl, u0, u1, zs - 16, zs, WHITE, 0.25);
  const m = 1 / ROUND;
  const clip = (c: number, dir: 1 | -1): [Pt, Pt] | null => {
    const za = z0 + (u0 - c) / (dir * m);
    const zb = z0 + (u1 - c) / (dir * m);
    const a = Math.max(z0, Math.min(za, zb));
    const b = Math.min(zs, Math.max(za, zb));
    if (b <= a) return null;
    return [fp(side, c + dir * (a - z0) * m, pl + 0.001, a), fp(side, c + dir * (b - z0) * m, pl + 0.001, b)];
  };
  const reach = (zs - z0) * m + 0.1;
  for (let c = u0 - reach; c < u1 + reach; c += 0.13) {
    for (const dir of [1, -1] as const) {
      const seg = clip(c, dir);
      if (seg !== null) line(g, seg[0], seg[1], 1.5 * S, stone);
    }
  }
  poly(g, side, pl + 0.002, windowOutline(u0, u1, zs - 0.5, z1, true).slice(1), stone);
  plate(g, side, pl + 0.002, u0, u1, zs - 2.5, zs, onWall(side, shade(look.trim, 0.1)));
  const petal = (du: number, top: number, w: number): void => {
    poly(g, side, pl + 0.003, [[uc + du, zs + 2], [uc + du - w, zs + 8], [uc + du * 1.6, top], [uc + du + w, zs + 8]], light);
  };
  petal(0, z1 - 5, 0.04);
  petal(-0.1, z1 - 10, 0.035);
  petal(0.1, z1 - 10, 0.035);
  wallPath(g, side, pl + 0.003, windowOutline(u0, u1, z0, z1, true).slice(1), 1.8 * S, stone);
  plate(g, side, pl + 0.003, u0, u0 + 0.012, z0, zs, stone);
  plate(g, side, pl + 0.003, u1 - 0.012, u1, z0, zs, stone);
  const out = 1 + 0.09;
  fan(g, lit(look.trim, 0.2), [fp(side, u0 - 0.11, pl, z0 - 6), fp(side, u1 + 0.11, pl, z0 - 6), fp(side, u1 + 0.11, out, z0 - 6), fp(side, u0 - 0.11, out, z0 - 6)]);
  plate(g, side, out, u0 - 0.11, u1 + 0.11, z0 - 10, z0 - 6, tone(side, look.trim, 0.3));
  plate(g, side, out + 0.001, u0 - 0.11, u1 + 0.11, z0 - 10, z0 - 9, onWall(side, KUMKUM), 0.7);
}

// A small arched niche in the wall with a clay diya burning on its sill, its glow warming the wall round it.
function drawNiche(g: G, d: Decor, look: WallLook): void {
  const { side } = d;
  const pl = 1 + FACE;
  const u0 = d.u + 0.35;
  const u1 = d.u + 0.65;
  const uc = (u0 + u1) / 2;
  const z0 = 58;
  const z1 = 92;
  const c = fp(side, uc, pl, z0 + 12);
  for (const [r, alpha] of [[38, 0.05], [26, 0.07], [16, 0.09]] as const) {
    g.fillStyle(WARM, alpha);
    g.fillEllipse(c.x, c.y, r * 2 * S, r * 2.3 * S, 24);
  }
  poly(g, side, pl, windowOutline(u0 - 0.06, u1 + 0.06, z0 - 4, z1 + 5, true), onWall(side, look.frame));
  poly(g, side, pl, windowOutline(u0 - 0.035, u1 + 0.035, z0 - 2, z1 + 3, true), onWall(side, lit(look.trim, 0.15)));
  poly(g, side, pl, windowOutline(u0, u1, z0, z1, true), onWall(side, mix(shade(look.upper, 0.42), 0x8a3a1a, 0.45)));
  poly(g, side, pl, windowOutline(u0 + 0.03, u1 - 0.03, z0, z1 - 8, true), WARM, 0.22);
  plate(g, side, pl, u0, u1, z0, z0 + 8, WARM, 0.25);
  const sill = 1 + 0.05;
  fan(g, lit(look.trim, 0.25), [fp(side, u0 - 0.08, pl, z0), fp(side, u1 + 0.08, pl, z0), fp(side, u1 + 0.08, sill, z0), fp(side, u0 - 0.08, sill, z0)]);
  plate(g, side, sill, u0 - 0.08, u1 + 0.08, z0 - 4, z0, tone(side, look.trim, 0.3));
  for (const u of [u0 - 0.045, u1 + 0.045]) {
    const p = fp(side, u, pl + 0.002, z1 + 3);
    g.fillStyle(onWall(side, KUMKUM), 1);
    g.fillCircle(p.x, p.y, 1.6 * S);
  }
  diyaAt(g, fp(side, uc - 0.02, 1 + 0.025, z0), 1);
}

// A saffron band under the cornice edged in kumkum red, set with a running row of little cream lotus rosettes.
function lotusFrieze(g: G, side: Side, u1: number, h: number): void {
  const pl = 1 + FACE * 0.7;
  const z0 = h - CORNICE_H - 14;
  const z1 = h - CORNICE_H - 2;
  plate(g, side, pl, 1, u1, z0, z1, onWall(side, SAFFRON));
  plate(g, side, pl, 1, u1, z0, z0 + 1.8, onWall(side, KUMKUM));
  plate(g, side, pl, 1, u1, z1 - 1.8, z1, onWall(side, KUMKUM));
  for (let u = 1.06; u < u1; u += 0.12) poly(g, side, pl + 0.001, [[u, z0], [u + 0.1, z0], [u + 0.05, z0 - 4]], onWall(side, KUMKUM));
  const zc = (z0 + z1) / 2;
  for (let u = 1.18; u < u1 - 0.05; u += 0.36) {
    const c = fp(side, u, pl + 0.002, zc);
    g.fillStyle(onWall(side, 0xfff2d8), 1);
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2;
      g.fillCircle(c.x + Math.cos(t) * 2.2 * S, c.y + Math.sin(t) * 2.2 * S, 1.6 * S);
    }
    g.fillStyle(onWall(side, KUMKUM), 1);
    g.fillCircle(c.x, c.y, 1.4 * S);
  }
}

// Marigold garlands swagged along the top of a mandir wall, with a hanging drop and mango leaves at every hook.
function marigoldFestoon(g: G, side: Side, u1: number, h: number): void {
  const pl = 1 + 0.05;
  const top = h - CORNICE_H - 20;
  const span = 1.4;
  const tint = (col: number): number => onWall(side, col);
  let u = 1.12;
  for (let i = 0; u < u1 - 0.3; i++, u += span) {
    const e = Math.min(u1, u + span);
    marigolds(g, swag(fp(side, u, pl, top), fp(side, e, pl, top), 15 * ((e - u) / span)), 2.3, tint, i);
  }
  for (let v = 1.12; v < u1 + 0.01; v += span) garlandDrop(g, fp(side, v, pl, top), 14, 1, tint);
}

// ---------- Room shell ----------

// Tile pairs and grout by room, for the rooms whose tiled floors are their own.
const FLOOR_TILES: Partial<Record<RoomKind, readonly [number, number, number]>> = {
  hospital: [0xeef2ee, 0xcfe3dc, 0xb4c2be],
  cityHall: [0xeeeae2, 0x3a3e4a, 0x8a8a90],
  chapel: [0xe8d8bc, 0xd2b48c, 0xb49a78],
  arcade: [0x2a2448, 0x161226, 0x0e0b18],
  fishMarket: [0xf0f4f4, 0xcfe2ea, 0x9fb4bc],
  temple: [0xccd2c6, 0xa2b6ac, 0x7a867e],
  mandir: [0xf2e8d2, 0xb45a40, 0x8a6a52],
};
const MARBLE_EDGES: Partial<Record<RoomKind, { field: number; joint: number; line: number }>> = {
  cityHall: { field: 0x2f4a6a, joint: 0x243a56, line: 0xdcd8cc },
  chapel: { field: 0xb4a68e, joint: 0x9a8a72, line: 0xe8dcc4 },
  temple: { field: 0x3f6a62, joint: 0x335850, line: 0xd8c08a },
  mandir: { field: 0x9a4032, joint: 0x7e3228, line: 0xe8b84a },
};

function drawDecor(g: G, d: Decor, room: RoomKind, h: number, look: WallLook, rand: () => number): void {
  switch (d.kind) {
    case 'picture':
      drawPicture(g, d, rand);
      return;
    case 'cross':
      drawCross(g, d, h);
      return;
    case 'clock':
      drawClock(g, d, h, rand);
      return;
    case 'lancet':
      drawLancet(g, d, h, look, rand);
      return;
    case 'rose':
      drawRose(g, d, h, look);
      return;
    case 'crest': {
      const uc = d.u + 0.5;
      banner(g, uc - 1.14, uc - 0.7, h, HARBOUR);
      banner(g, uc + 0.7, uc + 1.14, h, HARBOUR);
      cityCrest(g, uc, h);
      return;
    }
    case 'neon':
      drawNeon(g, d, h, rand);
      return;
    case 'poster':
      drawPoster(g, d, rand);
      return;
    case 'chart':
      drawChart(g, d, rand);
      return;
    case 'slate':
      drawSlate(g, d, rand);
      return;
    case 'buoy':
      drawBuoy(g, d);
      return;
    case 'lattice':
      drawLattice(g, d, h, look);
      return;
    case 'hanging':
      drawHanging(g, d, h, rand);
      return;
    case 'jali':
      drawJali(g, d, h, look);
      return;
    case 'niche':
      drawNiche(g, d, look);
      return;
    default:
      drawWindow(g, d, h, look, rand, room === 'office');
  }
}

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
      floorPlanks(floor, x1, y1, room === 'shop' ? 0xb07a4e : room === 'chapel' ? 0xc8a070 : room === 'temple' ? 0xa8744a : pick([0xb98552, 0x9a6a44, 0xc89a68], rand), rand);
      break;
    case 'tile': {
      const [a, b, grout] = FLOOR_TILES[room] ?? [0xd99a6e, 0xf0e2c8, 0x9a7a60];
      floorTiles(floor, x1, y1, [a, b], grout, rand);
      if (room === 'cityHall') for (let i = 0; i < 4; i++) fan(floor, WHITE, [P(1.5 + i * 2, 1), P(1.8 + i * 2, 1), P(3.4 + i * 2, y1), P(3.1 + i * 2, y1)], 0.05);
      break;
    }
    case 'marble':
      floorMarble(floor, x1, y1, rand, MARBLE_EDGES[room]);
      break;
    case 'carpet':
      if (room === 'arcade') floorArcade(floor, x1, y1, rand);
      else if (room === 'office') floorCarpetTiles(floor, x1, y1, pick([0x5a6474, 0x6a6670, 0x4e5e6e], rand), rand);
      else floorCarpet(floor, x1, y1, pick([0x7a5a7e, 0x5f7f6a, 0x6a7fa0, 0xa0605a], rand), rand);
      break;
  }
  if (room === 'fishMarket') floorDrain(floor, layout.w / 2 + 0.5, (1 + y1) / 2 + 0.5, rand);
  if (room === 'chapel') aisleRunner(floor, layout, door + 0.5, 2.15, y1);
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
  decor.forEach((d, i) => {
    if (d.kind !== 'window' && d.kind !== 'arch' && d.kind !== 'curtains' && d.kind !== 'lancet' && d.kind !== 'lattice' && d.kind !== 'jali') return;
    const lancet = d.kind === 'lancet';
    const a = d.u + (lancet ? 0.27 : d.kind === 'lattice' ? 0.16 : d.kind === 'jali' ? 0.24 : 0.2);
    const b = d.u + (lancet ? 0.73 : d.kind === 'lattice' ? 0.84 : d.kind === 'jali' ? 0.76 : 0.8);
    const m = (a + b) / 2;
    for (const [k, alpha] of [[1, 0.09], [0.7, 0.08]] as const) {
      for (const [j, [p, q]] of ([[a, m - 0.03], [m + 0.03, b]] as const).entries()) {
        const light = lancet ? mix(GLASS[(i * 2 + j) % GLASS.length] ?? SUN, SUN, 0.3) : SUN;
        const glow = lancet ? alpha * 1.3 : alpha;
        if (d.side === 'w') {
          const far = Math.min(x1 - 0.1, 1 + 2.4 * k);
          fan(floor, light, [P(1.15, p + 0.15), P(1.15, q + 0.15), P(far, Math.min(y1, q + 0.15 + 0.5 * k)), P(far, Math.min(y1, p + 0.15 + 0.5 * k))], glow);
        } else {
          const far = Math.min(y1 - 0.1, 1 + 1.8 * k);
          fan(floor, light, [P(p + 0.25, 1.15), P(q + 0.25, 1.15), P(Math.min(x1, q + 0.25 + 0.9 * k), far), P(Math.min(x1, p + 0.25 + 0.9 * k), far)], glow * 0.7);
        }
      }
    }
  });
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
    if (room === 'fishMarket') tiledWainscot(backWalls, side, u1, look, rand);
    if (layout.wall !== 'stone') skirting(backWalls, side, u1, look);
    if (room === 'arcade') {
      neonStrip(backWalls, side, u1, h - 12, NEON[0]);
      neonStrip(backWalls, side, u1, 58, NEON[1]);
    }
    if (room === 'temple') waveFrieze(backWalls, side, u1, h, look);
    if (room === 'mandir') lotusFrieze(backWalls, side, u1, h);
    plate(backWalls, side, 1 + FACE * 0.6, 1, 1.12, 0, WALL_TOP, SHADOW, 0.1);
    for (const d of decor) {
      if (d.side !== side) continue;
      drawDecor(backWalls, d, room, h, look, rand);
    }
  }
  if (room === 'shop') shopSign(backWalls, layout, h, rand);
  if (room === 'temple') for (const side of ['w', 'n'] as const) lanternGarland(backWalls, side, wallU[side] - 0.3, h, rand);
  if (room === 'mandir') for (const side of ['w', 'n'] as const) marigoldFestoon(backWalls, side, wallU[side] - 0.2, h);
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
  const special = roomWallLook(layout, room);
  const plain = layout.wall === 'brick' ? 0xb0603f : layout.wall === 'panel' ? 0x8a5a3a : layout.wall === 'stone' ? 0xb4a68e : room === 'hospital' ? 0x8fc7bd : room === 'flat' ? 0xa89488 : 0xc77f5a;
  const wall = special === null ? plain : room === 'fishMarket' ? special.upper : special.lower;
  const carpet = room === 'arcade' ? 0x1e1a3a : room === 'office' ? 0x5a6474 : 0x6f6070;
  const floor = layout.floor === 'planks' ? 0xb07a4e : layout.floor === 'tile' ? (FLOOR_TILES[room]?.[1] ?? 0xd99a6e) : layout.floor === 'marble' ? 0x8a8a80 : carpet;
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
  if (room === 'fishMarket') {
    fishCounter(g, f, layout, rand);
    return;
  }
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
  const carcass = room === 'mintHall' ? 0x5a3326 : room === 'fishMarket' ? 0xa8b0b8 : 0x9a6a44;
  shelving(g, f, layout, SHELF_H, 4, carcass, (fr, a0, a1, b0, b1, z, gap) => {
    let a = a0 + 0.04 + rand() * 0.05;
    while (a < a1 - 0.12) {
      if (room === 'fishMarket') {
        a += fishStock(g, fr, a, a1, b0, b1, z, gap, rand);
        continue;
      }
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

// Books by room: the council keeps tall bound ledgers, an office keeps lever-arch binders, everyone else a mix.
function bookcase(g: G, f: Furniture, layout: RoomLayout, room: RoomKind, rand: () => number): void {
  const carcass = room === 'cityHall' ? 0x4a2e22 : room === 'office' ? 0xd8d4cc : 0x6e4430;
  shelving(g, f, layout, BOOKCASE_H, 5, carcass, (fr, a0, a1, b0, b1, z, gap) => {
    let a = a0 + 0.02;
    while (a < a1 - 0.05) {
      if (room === 'office') {
        const w = Math.min(a1 - a, 0.075 + rand() * 0.02);
        const hh = gap * 0.86;
        const col = pick([0x2f5a8a, 0xe0574b, 0x3fa7a0, 0xffc860, 0x2a2a30, 0x2f5a8a], rand);
        box(g, fr, a, b0 + 0.08, a + w, b1 - 0.03, z, hh, col, lit(col, 0.25));
        plate(g, fr, b1 - 0.03 + 0.002, a + 0.012, a + w - 0.012, z + hh * 0.5, z + hh * 0.72, tone(fr, 0xfaf8f2), 0.95);
        const hole = fp(fr, a + w / 2, b1 - 0.028, z + hh * 0.25);
        if (fr !== 'e') {
          g.fillStyle(shade(col, 0.5), 1);
          g.fillCircle(hole.x, hole.y, 1.2 * S);
        }
        a += w + 0.008 + (rand() < 0.1 ? 0.1 : 0);
        continue;
      }
      if (room === 'cityHall') {
        const w = 0.05 + rand() * 0.015;
        const hh = gap * (0.82 + rand() * 0.1);
        const col = pick([0x6a1f2a, 0x2f4a6a, 0x2f5a3a, 0x5a3a2a, 0x6a1f2a], rand);
        box(g, fr, a, b0 + 0.08, Math.min(a1, a + w), b1 - 0.03, z, hh, col, lit(col, 0.2));
        for (const k of [0.18, 0.78]) plate(g, fr, b1 - 0.03 + 0.002, a + 0.006, Math.min(a1, a + w) - 0.006, z + hh * k, z + hh * k + 1.4, tone(fr, GOLD), 0.9);
        a += w + 0.004;
        continue;
      }
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
  if (room === 'fishMarket') {
    fan(g, SHADOW, quad(x0 + 0.03, y0 + 0.04, x1 + 0.05, y1 + 0.04), 0.18);
    fan(g, 0x2a2e34, quad(x0, y0, x1, y1, z));
    for (let y = y0 + 0.08; y < y1 - 0.04; y += 0.12) for (let x = x0 + 0.08; x < x1 - 0.04; x += 0.12) fan(g, 0x14161a, quad(x - 0.03, y - 0.03, x + 0.03, y + 0.03, z));
    fan(g, WHITE, quad(x0, y0, x1, y0 + 0.04, z), 0.12);
    return;
  }
  const pal = room === 'mintHall'
    ? { border: 0x5a1a24, field: 0x8a2a32, line: GOLD, motif: 0xe8c070 }
    : room === 'cityHall'
      ? { border: 0x1e3450, field: HARBOUR, line: GOLD, motif: 0xe8d8b0 }
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

const POTS: Partial<Record<RoomKind, number>> = { mintHall: 0xd8ccb4, hospital: 0xf2f2ee, cityHall: 0xd8d4cc, chapel: 0xd8ccb4, arcade: 0x2a2438, fishMarket: 0x3f6f8e, office: 0xf2f2ee, temple: 0x5f8f80 };

function plant(g: G, f: Furniture, room: RoomKind, rand: () => number): void {
  if (room === 'mandir') {
    tulsi(g, f, rand);
    return;
  }
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const pot = POTS[room] ?? 0xc0704a;
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
  if (room === 'temple') {
    paperLantern(g, f, layout);
    return;
  }
  if (room === 'mandir') {
    deepastambha(g, f, layout);
    return;
  }
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const metal = room === 'mintHall' || room === 'cityHall' || room === 'chapel' ? BRASS : room === 'arcade' ? 0x2a2438 : 0x4a4450;
  const cloth = room === 'hospital' || room === 'office' ? 0xf4f0e4 : room === 'arcade' ? 0xffb8e0 : 0xf3dcae;
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
  if (room === 'temple') {
    timberColumn(g, f);
    return;
  }
  if (room === 'mandir') {
    stonePillar(g, f);
    return;
  }
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const h = WALL_H[room];
  const stone = room === 'cityHall' ? 0xeeebe4 : 0xf1e8d8;
  const band = room === 'cityHall' ? HARBOUR : GOLD;
  const r = COLUMN_R * Math.min(f.w, f.d);
  fan(g, SHADOW, [P(x - 0.3, y - 0.3), P(x + 0.9, y - 0.2), P(x + 1, y + 0.3), P(x - 0.3, y + 0.42)], 0.12);
  prism(g, x - 0.42, y - 0.42, x + 0.42, y + 0.42, 0, 8, shade(stone, 0.08), lit(stone, 0.2));
  tube(g, x, y, 0.36, 0.33, 8, 5, stone, null, 10);
  tube(g, x, y, r + 0.02, r, 13, h - 31, stone, null, 14, true);
  tube(g, x, y, r, r + 0.1, h - 18, 7, stone, null, 10);
  prism(g, x - 0.42, y - 0.42, x + 0.42, y + 0.42, h - 11, 9, stone, lit(stone, 0.25));
  fan(g, band, [P(x - 0.42, y + 0.42, h - 8), P(x + 0.42, y + 0.42, h - 8), P(x + 0.42, y + 0.42, h - 6), P(x - 0.42, y + 0.42, h - 6)], 0.8);
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
  const frame = room === 'hospital' || room === 'office' ? 0xd8dce0 : room === 'cityHall' ? 0x4a2e22 : 0x6e4430;
  const z0 = 30;
  const z1 = 88;
  if (side === 'n') contact(g, f.c + 0.04, f.r + 0.06, f.c + f.w, f.r + 0.4, 0.16);
  else if (side === 'w') contact(g, f.c + 0.04, f.r + 0.06, f.c + 0.4, f.r + f.d, 0.16);
  else contact(g, f.c + f.w - 0.4, f.r + 0.06, f.c + f.w, f.r + f.d, 0.16);
  for (const a of [a0 + 0.1, a1 - 0.16]) box(g, side, a, b0 + 0.1, a + 0.06, b0 + 0.18, 0, z0, shade(frame, 0.1));
  box(g, side, a0, b0 + 0.08, a1, b0 + 0.18, z0, z1 - z0, frame, lit(frame, 0.3));
  if (side === 'e') return;
  const pl = b0 + 0.182;
  if (room === 'office') {
    whiteboard(g, side, pl, a0, a1, z0, z1, rand);
    return;
  }
  if (room === 'cityHall') {
    plate(g, side, pl, a0 + 0.2, a1 - 0.2, z1 + 1, z1 + 9, tone(side, HARBOUR, 0.25));
    plate(g, side, pl + 0.001, a0 + 0.22, a1 - 0.22, z1 + 2, z1 + 3, tone(side, GOLD, 0.25));
    plate(g, side, pl + 0.001, a0 + 0.22, a1 - 0.22, z1 + 7, z1 + 8, tone(side, GOLD, 0.25));
  }
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
  if (room === 'chapel') {
    pew(g, f, layout);
    return;
  }
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.06;
  const a1 = s.a1 - 0.06;
  const b0 = s.b0 + 0.22;
  const b1 = s.b1 - 0.22;
  const wood = room === 'mintHall' || room === 'cityHall' ? 0x6a3e2a : room === 'hospital' ? 0xc8a070 : room === 'arcade' ? 0xd83a8a : room === 'office' ? 0x6a6e78 : 0xa8714a;
  const iron = room === 'hospital' ? 0x9aa4ae : room === 'arcade' ? CHROME : 0x3a3640;
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
  if (room === 'cityHall') {
    councilDesk(g, f, layout, rand);
    return;
  }
  const fr = frameOf(f, layout);
  const { a0, a1, b0, b1 } = span(f, fr);
  const hospital = room === 'hospital';
  const office = room === 'office';
  const body = hospital ? 0xf2f2ee : office ? pick([0xe4e2dc, 0x6a6e78, 0xb08a62], rand) : 0x8a5a3a;
  const top = hospital ? 0xc8d8d4 : office ? pick([0xf2f0ea, 0xd8b88a, 0xe8e4dc], rand) : 0xb88a5a;
  contact(g, f.c + 0.06, f.r + 0.08, f.c + f.w - 0.06, f.r + f.d - 0.04, 0.2);
  box(g, fr, a0 + 0.06, b0 + 0.14, a1 - 0.06, b1 - 0.06, 0, DESK_H, body);
  const front = b1 - 0.06 + 0.002;
  if (hospital) {
    plate(g, fr, front, a0 + 0.06, a1 - 0.06, 8, 13, tone(fr, 0x3fa7a0));
    const m = (a0 + a1) / 2;
    plate(g, fr, front + 0.001, m - 6.5 / ROUND, m + 6.5 / ROUND, 17.5, 22.5, tone(fr, 0xe0574b));
    plate(g, fr, front + 0.001, m - 2.5 / ROUND, m + 2.5 / ROUND, 13.5, 26.5, tone(fr, 0xe0574b));
  } else if (office) {
    plate(g, fr, front, a0 + 0.56, a1 - 0.06, 6, DESK_H - 4, tone(fr, shade(body, 0.22)));
    for (let k = 0; k < 3; k++) {
      plate(g, fr, front + 0.001, a0 + 0.1, a0 + 0.5, 3 + k * 9, 10.5 + k * 9, tone(fr, lit(body, 0.06)));
      plate(g, fr, front + 0.002, a0 + 0.24, a0 + 0.36, 8 + k * 9, 9 + k * 9, tone(fr, CHROME));
    }
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
  if (office && rand() < 0.6) {
    plate(g, fr, bm + 0.033, am - 0.22, am + 0.22, zt + 12, zt + 26, tone(fr, 0xf4f8fa, 0.1));
    for (let k = 0; k < 4; k++) plate(g, fr, bm + 0.034, am - 0.22, am + 0.22, zt + 15 + k * 3, zt + 15.4 + k * 3, tone(fr, 0xa8c8d8, 0.1));
    for (let i = 0; i < 4; i++) plate(g, fr, bm + 0.035, am - 0.16 + i * 0.09, am - 0.1 + i * 0.09, zt + 13, zt + 15 + (i + 1) * 2.2 + rand() * 2, tone(fr, i === 3 ? 0x3fa7a0 : 0x3f7fae, 0.1));
  } else for (let k = 0; k < 3; k++) plate(g, fr, bm + 0.033, am - 0.2, am - 0.2 + 0.18 + rand() * 0.2, zt + 23 - k * 4, zt + 24.5 - k * 4, tone(fr, 0xd8f0ff, 0.1), 0.8);
  box(g, fr, am - 0.2, bm + 0.14, am + 0.2, bm + 0.28, zt, 1.5, 0xd9dde2, 0xeef0f2);
  for (let i = 0; i < 3; i++) {
    const pa = a0 + 0.2 + i * 0.16 + rand() * 0.06;
    const pb = b0 + 0.3 + rand() * 0.2;
    const sk = (rand() - 0.5) * 0.1;
    fan(g, i === 2 ? 0xfff4c8 : 0xfafaf6, [fp(fr, pa, pb, zt + 0.3 + i * 0.3), fp(fr, pa + 0.26, pb + sk, zt + 0.3 + i * 0.3), fp(fr, pa + 0.26 - sk, pb + 0.32 + sk, zt + 0.3 + i * 0.3), fp(fr, pa - sk, pb + 0.32, zt + 0.3 + i * 0.3)]);
  }
  const [cx, cy] = xy(fr, a1 - 0.25, b0 + 0.4);
  if (office) {
    const mug = pick([0xe0574b, 0xf2ece0, 0x3f7fae, 0xffc860], rand);
    tube(g, cx, cy + 0.04, 0.055, 0.055, zt, 7, mug, 0x4a2e20, 8);
    line(g, P(cx + 0.055, cy + 0.04, zt + 5.5), P(cx + 0.09, cy + 0.05, zt + 3), 1.6 * S, mug);
    if (a1 - a0 > 1.6) box(g, fr, a0 + 0.1, b0 + 0.2, a0 + 0.36, b0 + 0.5, zt, 6, pick([0x2f5a8a, 0x3a3640], rand), lit(0xf2f0ea, 0.1));
    return;
  }
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

function displayCase(g: G, f: Furniture, layout: RoomLayout, room: RoomKind, trade: Trade, rand: () => number): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.08;
  const a1 = s.a1 - 0.08;
  const b0 = s.b0 + 0.12;
  const b1 = s.b1 - 0.1;
  const fishy = room === 'fishMarket';
  const body = fishy ? 0xe8ecee : trade === 'cafe' ? 0xf2ece0 : trade === 'surf' ? 0x3f8a8a : trade === 'barber' ? 0x2a2a30 : trade === null ? 0xa8714a : 0x6e4430;
  const lining = fishy ? ICE : trade === 'cafe' ? 0xfaf6ee : trade === 'tailor' ? 0x2f5a4a : trade === 'hats' ? 0x6a1f2a : trade === 'surf' ? 0xe8d8b0 : trade === 'barber' ? 0x1e2228 : 0xd8c8a8;
  const trim = fishy || trade === 'barber' || trade === 'surf' ? CHROME : BRASS;
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
  if (fishy) plate(g, fr, b1 + 0.004, a0, a1, 3, 6, tone(fr, 0x3f7fae));
  const r = rectOf(fr, a0, b0, a1, b1);
  fan(g, lining, quad(r.x0 + 0.02, r.y0 + 0.02, r.x1 - 0.02, r.y1 - 0.02, CASE_BASE));
  const post = (x: number, y: number): void => { prism(g, x - 0.015, y - 0.015, x + 0.015, y + 0.015, CASE_BASE, CASE_H - CASE_BASE, trim, lit(trim, 0.3)); };
  post(r.x0 + 0.015, r.y0 + 0.015);
  if (fishy) iceBed(g, r.x0 + 0.02, r.y0 + 0.02, r.x1 - 0.02, r.y1 - 0.02, CASE_BASE, rand);
  const goods = fishy ? seafood(g, fr, a0, a1, b0, b1, CASE_BASE + 1.5, rand) : caseGoods(g, fr, trade, a0, a1, b0, b1, CASE_BASE, rand);
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

// ---------- Civic, chapel, arcade, market and office pieces ----------

// A whiteboard on the notice board's stand: marker notes, a bar chart, an arrow and a few sticky notes.
function whiteboard(g: G, side: Fr, pl: number, a0: number, a1: number, z0: number, z1: number, rand: () => number): void {
  plate(g, side, pl, a0 + 0.04, a1 - 0.04, z0 + 2, z1 - 2, tone(side, 0xf8f8f6, 0.2));
  poly(g, side, pl + 0.0005, [[a0 + 0.1, z0 + 4], [a0 + 0.22, z0 + 4], [a0 + 0.42, z1 - 4], [a0 + 0.3, z1 - 4]], WHITE, 0.5);
  const ink = [0x2a3a8a, 0x2a2a30, 0xc8323a, 0x2f8a5a] as const;
  const left = a0 + 0.1;
  for (let k = 0; k < 5; k++) {
    const z = z1 - 9 - k * 6;
    plate(g, side, pl + 0.001, left, left + 0.2 + rand() * 0.3, z, z + 1.2, tone(side, k === 0 ? ink[2] : pick(ink, rand), 0.2), 0.85);
  }
  const cx = a1 - 0.5;
  if (cx > left + 0.4) {
    plate(g, side, pl + 0.001, cx, cx + 0.38, z0 + 8, z0 + 8.8, tone(side, ink[1], 0.2));
    plate(g, side, pl + 0.001, cx, cx + 0.008, z0 + 8, z0 + 40, tone(side, ink[1], 0.2));
    for (let i = 0; i < 4; i++) {
      const top = z0 + 12 + i * 6 + rand() * 4;
      const u = cx + 0.04 + i * 0.085;
      for (const [p0, p1, q0, q1] of [[u, u + 0.06, top - 0.8, top], [u, u + 0.008, z0 + 8.8, top], [u + 0.052, u + 0.06, z0 + 8.8, top]] as const) plate(g, side, pl + 0.001, p0, p1, q0, q1, tone(side, ink[0], 0.2));
    }
    line(g, fp(side, cx + 0.04, pl + 0.002, z0 + 30), fp(side, cx + 0.3, pl + 0.002, z0 + 42), 1.4 * S, tone(side, ink[2], 0.2));
    poly(g, side, pl + 0.002, [[cx + 0.33, z0 + 44], [cx + 0.24, z0 + 42], [cx + 0.3, z0 + 37]], tone(side, ink[2], 0.2));
  }
  for (let i = 0; i < 2; i++) {
    const u = left + 0.05 + i * 0.22 + rand() * 0.05;
    const z = z0 + 6 + rand() * 6;
    plate(g, side, pl + 0.001, u + 0.01, u + 0.17, z - 1, z + 11, SHADOW, 0.15);
    plate(g, side, pl + 0.002, u, u + 0.16, z, z + 12, tone(side, pick(NOTES, rand), 0.2));
  }
  plate(g, side, pl + 0.003, a0 + 0.1, a1 - 0.1, z0 - 1, z0 + 2, tone(side, 0xb8bcc4, 0.2));
  for (const [u, col] of [[a0 + 0.2, ink[0]], [a0 + 0.3, ink[2]], [a0 + 0.36, ink[1]]] as const) plate(g, side, pl + 0.004, u, u + 0.08, z0 + 2, z0 + 3.6, tone(side, col, 0.2));
}

// A chapel pew: a seat and a high back between two shaped ends, turned to face the candles.
function pew(g: G, f: Furniture, layout: RoomLayout): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const altar = layout.furniture.find((p) => p.piece === 'candles');
  const backFront = fr === 'n' && f.r > 1 && (altar === undefined || altar.r < f.r);
  const a0 = s.a0 + 0.06;
  const a1 = s.a1 - 0.06;
  const b0 = s.b0 + 0.16;
  const b1 = s.b1 - 0.14;
  const wood = 0x8a5a3a;
  const flip = (b: number): number => (backFront ? b : b0 + b1 - b);
  const end = ([[b0, 0], [b1, 0], [b1, 46], [b1 - 0.07, 49], [b1 - 0.13, 45], [b1 - 0.13, 22], [b0 + 0.05, 20], [b0, 17]] as const).map(([b, z]) => [flip(b), z] as [number, number]);
  const ends = (a: number): void => {
    across(g, fr, a, end, shade(wood, 0.3));
    across(g, fr, a + 0.05, end, acrossTone(fr, wood));
    across(g, fr, a + 0.051, end.map(([b, z]) => [b, z > 40 ? z - 2 : z] as [number, number]).filter((_, i) => i >= 2 && i <= 4), lit(wood, 0.25), 0.6);
  };
  const [backB0, backB1] = backFront ? [b1 - 0.12, b1 - 0.05] : [b0 + 0.05, b0 + 0.12];
  const [seatB0, seatB1] = backFront ? [b0 + 0.02, b1 - 0.12] : [b0 + 0.12, b1 - 0.02];
  const seat = (): void => {
    box(g, fr, a0 + 0.05, seatB0, a1 - 0.05, seatB1, 15, 3, wood, lit(wood, 0.22));
    box(g, fr, a0 + 0.05, (seatB0 + seatB1) / 2 - 0.02, a1 - 0.05, (seatB0 + seatB1) / 2 + 0.02, 0, 15, shade(wood, 0.25));
  };
  const back = (): void => {
    box(g, fr, a0 + 0.05, backB0, a1 - 0.05, backB1, 18, 26, wood, lit(wood, 0.2));
    box(g, fr, a0 + 0.04, backB0 - 0.01, a1 - 0.04, backB1 + 0.01, 44, 3, lit(wood, 0.06), lit(wood, 0.3));
    if (backFront) for (let a = a0 + 0.2; a < a1 - 0.1; a += 0.4) plate(g, fr, backB1 + 0.002, a, a + 0.28, 22, 40, tone(fr, shade(wood, 0.12)));
  };
  contact(g, f.c + 0.06, f.r + 0.14, f.c + f.w - 0.06, f.r + f.d - 0.12, 0.2);
  ends(a0);
  const backNear = fr === 'e' ? !backFront : backFront;
  if (backNear) {
    seat();
    back();
  } else {
    back();
    seat();
  }
  ends(a1 - 0.05);
}

// The council's presiding desk: dark carved wood, a green leather top, a banker's lamp, an open ledger and an inkwell.
function councilDesk(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const { a0, a1, b0, b1 } = span(f, fr);
  const body = 0x5a3326;
  contact(g, f.c + 0.04, f.r + 0.06, f.c + f.w - 0.04, f.r + f.d - 0.02, 0.24);
  box(g, fr, a0 + 0.03, b0 + 0.1, a1 - 0.03, b1 - 0.03, 0, 5, shade(body, 0.3));
  box(g, fr, a0 + 0.06, b0 + 0.14, a1 - 0.06, b1 - 0.07, 5, DESK_H - 5, body);
  const front = b1 - 0.07 + 0.002;
  const panels = Math.max(2, Math.round((a1 - a0) / 0.6));
  const pw = (a1 - a0 - 0.12) / panels;
  for (let i = 0; i < panels; i++) {
    const u = a0 + 0.06 + i * pw;
    plate(g, fr, front, u + 0.06, u + pw - 0.06, 9, DESK_H - 5, tone(fr, shade(body, 0.16)));
    plate(g, fr, front + 0.001, u + 0.06, u + pw - 0.06, DESK_H - 6.5, DESK_H - 5, tone(fr, BRASS), 0.8);
  }
  const am = (a0 + a1) / 2;
  poly(g, fr, front + 0.002, [[am - 0.09, DESK_H - 9], [am + 0.09, DESK_H - 9], [am + 0.09, 15], [am, 11], [am - 0.09, 15]], tone(fr, GOLD));
  poly(g, fr, front + 0.003, [[am - 0.065, DESK_H - 10.5], [am + 0.065, DESK_H - 10.5], [am + 0.065, 16], [am, 13], [am - 0.065, 16]], tone(fr, HARBOUR));
  box(g, fr, a0, b0 + 0.08, a1, b1, DESK_H, 3, shade(body, 0.2), lit(body, 0.12));
  const zt = DESK_H + 3;
  const pad = rectOf(fr, a0 + 0.14, b0 + 0.2, a1 - 0.14, b1 - 0.12);
  fan(g, 0x2f5a3a, quad(pad.x0, pad.y0, pad.x1, pad.y1, zt));
  fan(g, GOLD, quad(pad.x0, pad.y1 - 0.02, pad.x1, pad.y1, zt), 0.6);
  const pg = rectOf(fr, am - 0.24, b0 + 0.34, am + 0.24, b1 - 0.2);
  fan(g, 0x6a1f2a, quad(pg.x0 - 0.02, pg.y0 - 0.02, pg.x1 + 0.02, pg.y1 + 0.02, zt + 0.5));
  fan(g, 0xfaf6ea, quad(pg.x0, pg.y0, (pg.x0 + pg.x1) / 2 - 0.01, pg.y1, zt + 1.4));
  fan(g, 0xf2ecdc, quad((pg.x0 + pg.x1) / 2 + 0.01, pg.y0, pg.x1, pg.y1, zt + 1.4));
  for (let k = 0; k < 4; k++) {
    const t = 0.2 + k * 0.17;
    const yy = pg.y0 + (pg.y1 - pg.y0) * t;
    const xx = pg.x0 + (pg.x1 - pg.x0) * t;
    if (fr === 'n') line(g, P(pg.x0 + 0.04, yy, zt + 1.5), P(pg.x1 - 0.04, yy, zt + 1.5), 1, 0x8a8a9a, 0.5);
    else line(g, P(xx, pg.y0 + 0.04, zt + 1.5), P(xx, pg.y1 - 0.04, zt + 1.5), 1, 0x8a8a9a, 0.5);
  }
  const [lx, ly] = xy(fr, a0 + 0.26, b0 + 0.34);
  const lampTop = P(lx, ly, zt + 16);
  for (const [r, alpha] of [[24, 0.05], [16, 0.07]] as const) {
    g.fillStyle(WARM, alpha);
    g.fillCircle(lampTop.x, lampTop.y + 4 * S, r * S);
  }
  tube(g, lx, ly, 0.1, 0.08, zt, 2, BRASS, lit(BRASS, 0.3), 10);
  tube(g, lx, ly, 0.015, 0.015, zt + 2, 12, BRASS, null, 4);
  tube(g, lx, ly, 0.16, 0.12, zt + 12, 6, 0x2f7a4a, lit(0x2f7a4a, 0.35), 12);
  g.fillStyle(0xfff1c9, 0.9);
  g.fillEllipse(lampTop.x, lampTop.y + 6 * S, 0.24 * 2 * RX * 0.9, 0.06 * RY, 12);
  const [ix, iy] = xy(fr, a1 - 0.28, b0 + 0.36);
  tube(g, ix, iy, 0.05, 0.04, zt, 5, 0x1e2230, 0x0e1018, 8);
  line(g, P(ix, iy, zt + 4), P(ix + 0.08, iy - 0.08, zt + 22), 1.4 * S, 0xf6f2ea);
  line(g, P(ix + 0.03, iy - 0.03, zt + 10), P(ix + 0.08, iy - 0.08, zt + 22), 3 * S, 0xf6f2ea, 0.7);
  if (a1 - a0 > 1.4 && rand() < 0.7) {
    for (let i = 0; i < 3; i++) box(g, fr, a1 - 0.62 + i * 0.01, b0 + 0.26, a1 - 0.36 + i * 0.01, b0 + 0.6, zt + i * 0.8, 0.8, 0xfafaf6, 0xfafaf6);
  }
}

// A fish lying on its side at (x, y, z), nose along `ang` on the floor plane, `len` tiles long.
function fish(g: G, x: number, y: number, z: number, ang: number, len: number, col: number): void {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const at = (t: number, s: number, dz = 1.2): Pt => P(x + (dx * t - dy * s) * len, y + (dy * t + dx * s) * len, z + dz);
  const half = (t: number): number => 0.17 * Math.pow(Math.max(0, Math.sin((Math.PI * (t + 0.38)) / 0.9)), 0.75);
  const ts = Array.from({ length: 11 }, (_, i) => -0.38 + (0.9 * i) / 10);
  fan(g, SHADOW, ts.map((t) => at(t + 0.02, half(t) + 0.03, 0)), 0.18);
  fan(g, shade(col, 0.12), [at(-0.34, 0), at(-0.56, 0.17, 1), at(-0.49, 0, 1), at(-0.56, -0.17, 1)]);
  fan(g, col, [...ts.map((t) => at(t, half(t))), ...[...ts].reverse().map((t) => at(t, -half(t)))]);
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i] ?? 0;
    const t1 = ts[i + 1] ?? 0;
    fan(g, shade(col, 0.28), [at(t0, half(t0)), at(t1, half(t1)), at(t1, half(t1) * 0.35), at(t0, half(t0) * 0.35)]);
    fan(g, lit(col, 0.45), [at(t0, -half(t0) * 0.25), at(t1, -half(t1) * 0.25), at(t1, -half(t1) * 0.8), at(t0, -half(t0) * 0.8)], 0.6);
  }
  line(g, at(0.26, half(0.26) * 0.9), at(0.29, -half(0.29) * 0.9), 1, shade(col, 0.45), 0.7);
  line(g, at(-0.2, half(-0.2) * 0.1), at(0.2, half(0.2) * 0.1), 1, WHITE, 0.45);
  const eye = at(0.39, half(0.39) * 0.25);
  g.fillStyle(WHITE, 1);
  g.fillCircle(eye.x, eye.y, 1.3 * S);
  g.fillStyle(0x1e1e26, 1);
  g.fillCircle(eye.x, eye.y, 0.7 * S);
}

// A bed of crushed ice, white with blue shadow flecks and wet glints.
function iceBed(g: G, x0: number, y0: number, x1: number, y1: number, z: number, rand: () => number): void {
  fan(g, ICE, quad(x0, y0, x1, y1, z));
  const n = Math.round((x1 - x0) * (y1 - y0) * 260);
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.01 + rand() * (x1 - x0 - 0.04);
    const y = y0 + 0.01 + rand() * (y1 - y0 - 0.04);
    const k = rand();
    fan(g, k < 0.5 ? 0xb8d0dc : WHITE, quad(x, y, x + 0.025, y + 0.025, z + 0.4), k < 0.5 ? 0.6 : 0.9);
  }
}

// One thing on a fishmonger's shelf, starting at `a`: a crate of fish on ice, a stack of tins or a jar; how far along it took.
function fishStock(g: G, fr: Fr, a: number, a1: number, b0: number, b1: number, z: number, gap: number, rand: () => number): number {
  const k = rand();
  const [ux, uy] = xy(fr, 1, 0);
  const along = Math.atan2(uy, ux);
  if (k < 0.5 && a1 - a > 0.42) {
    const w = 0.38;
    const hh = Math.min(gap - 7, 10);
    const wood = pick([0xc8a070, 0xb08a5a, 0x8aa0a8], rand);
    box(g, fr, a, b0 + 0.08, a + w, b1 - 0.02, z, hh, wood, lit(wood, 0.2));
    plate(g, fr, b1 - 0.02 + 0.002, a + 0.01, a + w - 0.01, z + hh * 0.48, z + hh * 0.56, tone(fr, shade(wood, 0.3)));
    const r = rectOf(fr, a + 0.03, b0 + 0.11, a + w - 0.03, b1 - 0.05);
    iceBed(g, r.x0, r.y0, r.x1, r.y1, z + hh, rand);
    for (const [ta, tb, dir] of [[0.3, 0.35, 1], [0.7, 0.65, -1]] as const) {
      const [fx, fy] = xy(fr, a + w * ta, b0 + 0.08 + (b1 - b0 - 0.1) * tb);
      fish(g, fx, fy, z + hh, along + (dir < 0 ? Math.PI : 0), 0.3, pick(FISH, rand));
    }
    return w + 0.04;
  }
  const [cx, cy] = xy(fr, a + 0.07, b1 - 0.2);
  if (k < 0.8) {
    const label = pick([0xe0574b, 0x3f7fae, 0xffc860, 0x3fa7a0], rand);
    for (let i = 0; i < 2 + Math.floor(rand() * 2) && 2 + (i + 1) * 5 < gap; i++) {
      tube(g, cx, cy, 0.06, 0.06, z + i * 5, 4.6, CHROME, lit(CHROME, 0.3), 8);
      tube(g, cx, cy, 0.061, 0.061, z + i * 5 + 1, 2.6, label, null, 8);
    }
    return 0.16;
  }
  const hh = Math.min(gap - 4, 10);
  tube(g, cx, cy, 0.06, 0.06, z, hh, 0xd8e8e0, null, 6);
  tube(g, cx, cy, 0.05, 0.05, z + 1, hh * 0.6, pick([0xc8504a, 0xe8c070, 0x8a9aae], rand), null, 6);
  tube(g, cx, cy, 0.063, 0.063, z + hh, 2.5, 0xd9a440, 0xe8c070, 6);
  return 0.16;
}

// What lies on the ice in a fishmonger's case: whole fish, a heap of prawns, a crab or mussels, with lemon between.
function seafood(g: G, fr: Fr, a0: number, a1: number, b0: number, b1: number, z: number, rand: () => number): { x: number; y: number; draw: () => void }[] {
  const out: { x: number; y: number; draw: () => void }[] = [];
  const [ux, uy] = xy(fr, 0, 1);
  const across0 = Math.atan2(uy, ux);
  const bm = (b0 + b1) / 2;
  let a = a0 + 0.16;
  let i = 0;
  while (a < a1 - 0.12) {
    const [x, y] = xy(fr, a, bm);
    const k = rand();
    const col = pick(FISH, rand);
    const flip = i % 2 === 0 ? 0 : Math.PI;
    let step = 0.2;
    let draw: () => void;
    if (k < 0.55) draw = () => { fish(g, x, y, z, across0 + flip + (rand() - 0.5) * 0.5, Math.min(0.5, (b1 - b0) * 0.82), col); };
    else if (k < 0.75) {
      step = 0.26;
      draw = () => {
        for (let j = 0; j < 7; j++) {
          const c = P(x + (rand() - 0.5) * 0.18, y + (rand() - 0.5) * 0.18, z + 1 + rand() * 2);
          g.lineStyle(2.4 * S, j % 2 === 0 ? 0xf2907a : 0xe87a64, 1);
          g.beginPath();
          g.arc(c.x, c.y, 3 * S, rand() * Math.PI, rand() * Math.PI + Math.PI * 1.3);
          g.strokePath();
        }
      };
    } else if (k < 0.88) {
      step = 0.3;
      draw = () => {
        for (let j = 0; j < 6; j++) {
          const t = (j / 6) * Math.PI * 2;
          line(g, P(x, y, z + 2), P(x + Math.cos(t) * 0.17, y + Math.sin(t) * 0.17, z + 1), 1.4 * S, 0xc84a2a);
        }
        floorEllipse(g, x, y, 0.12, 0xd8603a, 1, z + 3);
        floorEllipse(g, x - 0.02, y - 0.02, 0.06, 0xf08a5a, 1, z + 3.5);
      };
    } else {
      step = 0.26;
      draw = () => {
        for (let j = 0; j < 8; j++) {
          const c = P(x + (rand() - 0.5) * 0.2, y + (rand() - 0.5) * 0.2, z + 1 + rand() * 2);
          g.fillStyle(0x1e2436, 1);
          g.fillEllipse(c.x, c.y, 5 * S, 3 * S, 8);
          g.fillStyle(0x4a5a7a, 1);
          g.fillEllipse(c.x - 0.8 * S, c.y - 0.6 * S, 2.4 * S, 1.2 * S, 6);
        }
      };
    }
    out.push({ x, y, draw });
    if (rand() < 0.5) {
      const [lx, ly] = xy(fr, a + step / 2, b1 - 0.08);
      out.push({ x: lx, y: ly, draw: () => {
        floorEllipse(g, lx, ly, 0.045, 0xffd83a, 1, z + 1.5);
        floorEllipse(g, lx, ly, 0.03, 0xfff4b0, 1, z + 1.8);
        g.fillStyle(0x4b8a4e, 1);
        const q = P(lx + 0.05, ly - 0.03, z + 1);
        g.fillCircle(q.x, q.y, 2 * S);
      } });
    }
    a += step + rand() * 0.04;
    i++;
  }
  return out;
}

// The fishmonger's counter: blue and white tiles below, a steel top heaped with crushed ice and fish, a scale at one end.
function fishCounter(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const { a0, a1, b0, b1 } = span(f, fr);
  const white = 0xf2f4f4;
  contact(g, f.c + 0.05, f.r + 0.05, f.c + f.w - 0.05, f.r + f.d - 0.05, 0.22);
  box(g, fr, a0 + 0.1, b0 + 0.12, a1 - 0.1, b1 - 0.06, 0, 4, 0x4a5660);
  box(g, fr, a0 + 0.08, b0 + 0.1, a1 - 0.08, b1 - 0.1, 4, COUNTER_H - 4, white);
  const front = b1 - 0.1 + 0.002;
  for (let k = 0; k < 3; k++) {
    for (let u = a0 + 0.08; u < a1 - 0.1; u += 0.2) plate(g, fr, front, u + 0.01, Math.min(a1 - 0.08, u + 0.2) - 0.01, 5 + k * 8, 12 + k * 8, tone(fr, k === 1 ? 0x3f7fae : jitter(white, rand, 0.02)));
  }
  box(g, fr, a0 + 0.03, b0 + 0.05, a1 - 0.03, b1 - 0.04, COUNTER_H, 3, CHROME, lit(CHROME, 0.25));
  const zt = COUNTER_H + 3;
  const scaleW = a1 - a0 > 1.6 ? 0.44 : 0;
  const ia1 = a1 - 0.08 - scaleW;
  const ice = rectOf(fr, a0 + 0.08, b0 + 0.1, ia1, b1 - 0.1);
  iceBed(g, ice.x0, ice.y0, ice.x1, ice.y1, zt + 0.5, rand);
  const items = seafood(g, fr, a0 + 0.06, ia1, b0 + 0.08, b1 - 0.1, zt + 1.5, rand);
  items.sort((p, q) => p.x + p.y - (q.x + q.y));
  for (const item of items) item.draw();
  for (let a = a0 + 0.3; a < ia1 - 0.1; a += 0.62) {
    const [px, py] = xy(fr, a, b1 - 0.13);
    line(g, P(px, py, zt + 1), P(px, py, zt + 8), 1, 0x8a8e96);
    box(g, fr, a - 0.06, b1 - 0.135, a + 0.06, b1 - 0.125, zt + 6, 5, 0xfafaf6, WHITE);
    plate(g, fr, b1 - 0.125 + 0.001, a - 0.04, a + 0.03, zt + 8, zt + 9, tone(fr, 0xc8323a));
  }
  fan(g, 0xd8eef4, [fp(fr, a0 + 0.05, b1 - 0.05, zt + 2), fp(fr, ia1, b1 - 0.05, zt + 2), fp(fr, ia1, b1 - 0.26, zt + 20), fp(fr, a0 + 0.05, b1 - 0.26, zt + 20)], 0.13);
  line(g, fp(fr, a0 + 0.05, b1 - 0.26, zt + 20), fp(fr, ia1, b1 - 0.26, zt + 20), 1.6 * S, CHROME);
  line(g, fp(fr, a0 + 0.12, b1 - 0.08, zt + 4), fp(fr, a0 + 0.3, b1 - 0.22, zt + 18), 1, WHITE, 0.35);
  if (scaleW > 0) {
    const sa = ia1 + 0.06 + scaleW / 2 - 0.03;
    const sb = (b0 + b1) / 2;
    box(g, fr, sa - 0.16, sb - 0.12, sa + 0.16, sb + 0.14, zt, 8, 0xf2f2ee, lit(0xf2f2ee, 0.2));
    if (fr !== 'e') {
      fan(g, tone(fr, 0x2a2a30), ring(fr, sb + 0.142, sa, zt + 4.5, 0.09, 16));
      fan(g, tone(fr, 0xfaf6ea), ring(fr, sb + 0.143, sa, zt + 4.5, 0.075, 16));
      line(g, fp(fr, sa, sb + 0.144, zt + 4.5), fp(fr, sa + 0.05, sb + 0.144, zt + 6.5), 1, 0xc8323a);
    }
    const [dx, dy] = xy(fr, sa, sb - 0.02);
    const [ux, uy] = xy(fr, 1, 0);
    tube(g, dx, dy, 0.02, 0.02, zt + 8, 3, CHROME, null, 4);
    tube(g, dx, dy, 0.2, 0.16, zt + 11, 2, CHROME, lit(CHROME, 0.35), 14);
    fish(g, dx, dy, zt + 12.5, Math.atan2(uy, ux), 0.26, pick(FISH, rand));
  }
}

// An arcade cabinet against a wall: painted sides with a stripe and lit edging, a glowing screen tilted back under a
// lit marquee, a stick and buttons on the control deck and a coin door; seen from behind it shows its vented back.
function cabinet(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.15;
  const a1 = s.a1 - 0.15;
  const bB = s.b0 + 0.08;
  const bF = s.b1 - 0.2;
  const H = CABINET_H;
  const body = pick(CABINETS, rand);
  const art = pick(NEON, rand);
  const glow = pick([0x3ff0e0, 0xff4fa8, 0xffd83a, 0x6aff7a, 0x8a9aff], rand);
  const am = (a0 + a1) / 2;
  const bounds = { x1: layout.w - 1, y1: layout.d - 1 };
  const prof: [number, number][] = [[bB, 0], [bF, 0], [bF, 38], [bF + 0.07, 44], [bF - 0.13, 50], [bF - 0.19, 52], [bF - 0.3, 80], [bF - 0.1, 84], [bF - 0.08, H], [bB, H]];
  const quadAt = (p: readonly [number, number], q: readonly [number, number], u0 = a0, u1 = a1): Pt[] => [fp(fr, u0, p[0], p[1]), fp(fr, u1, p[0], p[1]), fp(fr, u1, q[0], q[1]), fp(fr, u0, q[0], q[1])];
  const pt = (i: number): readonly [number, number] => prof[i] ?? [bB, 0];
  const [gx, gy] = xy(fr, am, s.b1 + 0.3);
  for (const [r, alpha] of [[1.2, 0.05], [0.8, 0.07], [0.45, 0.08]] as const) floorPool(g, gx, gy, r, glow, alpha, bounds);
  contact(g, f.c + 0.12, f.r + 0.1, f.c + f.w - 0.12, f.r + f.d - 0.12, 0.26);
  if (fr === 'e') {
    fan(g, shade(body, 0.45), [fp(fr, a0, bB, 0), fp(fr, a1, bB, 0), fp(fr, a1, bB, H), fp(fr, a0, bB, H)]);
    for (let z = 58; z < 80; z += 4) line(g, fp(fr, a0 + 0.12, bB, z), fp(fr, a1 - 0.12, bB, z), 1.4 * S, shade(body, 0.7), 0.8);
    fan(g, 0xf2ece0, [fp(fr, am - 0.12, bB, 20), fp(fr, am + 0.12, bB, 20), fp(fr, am + 0.12, bB, 34), fp(fr, am - 0.12, bB, 34)], 0.8);
    fan(g, lit(body, 0.2), quadAt([bB, H], [bF - 0.08, H]));
    for (const [r, alpha] of [[30, 0.05], [20, 0.07]] as const) {
      const c = fp(fr, am, bF - 0.25, 66);
      g.fillStyle(glow, alpha);
      g.fillCircle(c.x, c.y, r * S);
    }
  } else {
    fan(g, tone(fr, body), quadAt(pt(1), pt(2)));
    const door = (u0: number, u1: number, z0: number, z1: number, col: number, alpha = 1): void => { fan(g, col, [fp(fr, u0, bF + 0.002, z0), fp(fr, u1, bF + 0.002, z0), fp(fr, u1, bF + 0.002, z1), fp(fr, u0, bF + 0.002, z1)], alpha); };
    door(am - 0.13, am + 0.13, 8, 30, tone(fr, 0x24222c));
    for (const u of [am - 0.07, am + 0.03]) {
      door(u, u + 0.04, 21, 26, 0xff8a3a);
      door(u - 0.01, u + 0.05, 19, 28, 0xff8a3a, 0.25);
    }
    door(am - 0.1, am + 0.1, 11, 13, tone(fr, 0x6a6a78));
    fan(g, tone(fr, shade(body, 0.2)), quadAt(pt(2), pt(3)));
    fan(g, 0x22202c, quadAt(pt(3), pt(4)));
    const deck = (t: number): readonly [number, number] => [pt(3)[0] + (pt(4)[0] - pt(3)[0]) * t, pt(3)[1] + (pt(4)[1] - pt(3)[1]) * t];
    const decal = [deck(0.15), deck(0.85)] as const;
    fan(g, art, [fp(fr, a0 + 0.02, decal[0][0], decal[0][1] + 0.2), fp(fr, a0 + 0.12, decal[0][0], decal[0][1] + 0.2), fp(fr, a0 + 0.12, decal[1][0], decal[1][1] + 0.2), fp(fr, a0 + 0.02, decal[1][0], decal[1][1] + 0.2)], 0.7);
    fan(g, 0x14121c, quadAt(pt(4), pt(5)));
    fan(g, 0x14121c, quadAt(pt(5), pt(6)));
    const scr = (u: number, t: number): Pt => fp(fr, u, bF - 0.205 - 0.09 * t, 54 + 24 * t);
    const su0 = a0 + 0.07;
    const su1 = a1 - 0.07;
    const cell = (u: number, t: number, du: number, dt: number, col: number, alpha = 1): void => { fan(g, col, [scr(u, t), scr(u + du, t), scr(u + du, t + dt), scr(u, t + dt)], alpha); };
    cell(su0, 0, su1 - su0, 1, 0x0c1024);
    cell(su0, 0, su1 - su0, 1, glow, 0.12);
    const kind = Math.floor(rand() * 3);
    const sw = su1 - su0;
    if (kind === 0) {
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) cell(su0 + 0.02 + c * (sw - 0.04) / 6 + 0.004, 0.62 + r * 0.075, (sw - 0.04) / 6 - 0.008, 0.06, pick(NEON, rand));
      cell(su0 + sw * 0.4, 0.1, sw * 0.2, 0.04, WHITE);
      cell(su0 + sw * 0.55, 0.3, 0.025, 0.06, WHITE);
    } else if (kind === 1) {
      for (let i = 0; i < 14; i++) cell(su0 + rand() * (sw - 0.02), rand() * 0.96, 0.012, 0.03, WHITE, 0.8);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) cell(su0 + 0.06 + c * 0.1, 0.66 + r * 0.13, 0.06, 0.08, r === 0 ? 0x6aff7a : 0xff4fa8);
      fan(g, 0x3ff0e0, [scr(am - 0.05, 0.06), scr(am + 0.05, 0.06), scr(am, 0.2)]);
    } else {
      fan(g, 0x2a6a3a, [scr(su0, 0), scr(su1, 0), scr(su1, 0.55), scr(su0, 0.55)]);
      fan(g, 0x4a4a5a, [scr(su0 + sw * 0.12, 0), scr(su1 - sw * 0.12, 0), scr(am + 0.02, 0.55), scr(am - 0.02, 0.55)]);
      for (let t = 0.04; t < 0.5; t += 0.14) cell(am - 0.006, t, 0.012, 0.06, WHITE);
      cell(am - 0.05, 0.08, 0.1, 0.1, 0xe0574b);
      fan(g, 0xff8a3a, [scr(su0, 0.55), scr(su1, 0.55), scr(su1, 0.75), scr(su0 + sw * 0.6, 0.6), scr(su0 + sw * 0.3, 0.72), scr(su0, 0.6)]);
    }
    for (let t = 0.08; t < 1; t += 0.12) cell(su0, t, sw, 0.015, WHITE, 0.07);
    fan(g, WHITE, [scr(su0 + 0.02, 0.15), scr(su0 + 0.08, 0.15), scr(su0 + 0.2, 0.95), scr(su0 + 0.14, 0.95)], 0.12);
    const [jp, jz] = deck(0.35);
    const [jx, jy] = xy(fr, a0 + 0.2, jp);
    tube(g, jx, jy, 0.04, 0.04, jz, 1, 0x2a2a30, 0x3a3a44, 8);
    line(g, P(jx, jy, jz), P(jx, jy, jz + 8), 1.6 * S, 0x2a2a30);
    const knob = P(jx, jy, jz + 9);
    g.fillStyle(0xe0473b, 1);
    g.fillCircle(knob.x, knob.y, 3 * S);
    g.fillStyle(WHITE, 0.6);
    g.fillCircle(knob.x - 1 * S, knob.y - 1 * S, 1 * S);
    [0xffd83a, 0x3ff0e0, 0xff4fa8].forEach((col, i) => {
      const [bp, bz] = deck(0.42 + (i % 2) * 0.14);
      const [bx, by] = xy(fr, a0 + 0.38 + i * 0.075, bp);
      floorEllipse(g, bx, by, 0.035, shade(col, 0.3), 1, bz + 0.5);
      floorEllipse(g, bx - 0.005, by - 0.005, 0.03, col, 1, bz + 1.4);
    });
    fan(g, 0x1a1824, quadAt(pt(6), pt(7)));
    fan(g, lit(art, 0.35), quadAt(pt(7), pt(8)));
    const mq = (t: number): readonly [number, number] => [pt(7)[0] + (pt(8)[0] - pt(7)[0]) * t, pt(7)[1] + (pt(8)[1] - pt(7)[1]) * t];
    fan(g, WHITE, quadAt(mq(0.35), mq(0.65), a0 + 0.08, a1 - 0.08), 0.55);
    for (let u = a0 + 0.06; u < a1 - 0.08; u += 0.1) fan(g, shade(art, 0.25), [fp(fr, u, ...mq(0.12)), fp(fr, u + 0.05, ...mq(0.12)), fp(fr, u + 0.03, ...mq(0.3)), fp(fr, u - 0.02, ...mq(0.3))]);
    fan(g, lit(body, 0.25), quadAt([bB, H], [bF - 0.08, H]));
    for (const [r, alpha] of [[34, 0.05], [24, 0.06], [15, 0.07]] as const) {
      const c = fp(fr, am, bF - 0.25, 66);
      g.fillStyle(glow, alpha);
      g.fillCircle(c.x, c.y, r * S);
    }
    const m = fp(fr, am, bF - 0.09, 91);
    g.fillStyle(art, 0.08);
    g.fillEllipse(m.x, m.y, 40 * S, 18 * S, 16);
  }
  across(g, fr, a1, prof, acrossTone(fr, body));
  across(g, fr, a1 + 0.001, [[bB + 0.06, 8], [bB + 0.06, 22], [bF - 0.32, 78], [bF - 0.32, 62]], acrossTone(fr, art));
  across(g, fr, a1 + 0.001, [[bB + 0.06, 28], [bB + 0.06, 33], [bF - 0.36, 82], [bF - 0.36, 77]], acrossTone(fr, lit(art, 0.4)));
  const edge = prof.map(([b, z]) => fp(fr, a1 + 0.002, b, z));
  for (const [w, alpha] of [[4, 0.15], [1.6, 1]] as const) {
    g.lineStyle(w * S, w > 2 ? art : lit(art, 0.2), alpha);
    g.beginPath();
    edge.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.strokePath();
  }
}

// A small altar table under a white cloth with a coloured runner, crowded with lit pillar candles and glass votives.
function candles(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const a0 = s.a0 + 0.12;
  const a1 = s.a1 - 0.12;
  const b0 = s.b0 + 0.1;
  const b1 = s.b0 + 0.64;
  const am = (a0 + a1) / 2;
  const bounds = { x1: layout.w - 1, y1: layout.d - 1 };
  const [gx, gy] = xy(fr, am, s.b1 - 0.1);
  for (const [r, alpha] of [[2.4, 0.035], [1.8, 0.045], [1.2, 0.06], [0.7, 0.07]] as const) floorPool(g, gx, gy, r, WARM, alpha, bounds);
  if (fr !== 'e') {
    const c = fp(fr, am, s.b0, 58);
    for (const [r, alpha] of [[62, 0.04], [46, 0.05], [30, 0.07]] as const) {
      g.fillStyle(WARM, alpha);
      g.fillEllipse(c.x, c.y, r * 2 * S, r * 2.2 * S, 24);
    }
  }
  contact(g, f.c + 0.1, f.r + 0.06, f.c + f.w - 0.1, f.r + f.d - 0.24, 0.2);
  const wood = 0x7a4a32;
  const cloth = 0xf6f2ea;
  const runner = pick([0x6a2a3a, 0x2f4a7a, 0x3f6a4a, 0x8a5a2a], rand);
  box(g, fr, a0 + 0.04, b0 + 0.04, a1 - 0.04, b1 - 0.04, 0, 4, shade(wood, 0.3));
  box(g, fr, a0 + 0.06, b0 + 0.06, a1 - 0.06, b1 - 0.06, 4, ALTAR_H - 4, wood);
  const front = b1 - 0.06 + 0.002;
  plate(g, fr, front, a0 + 0.12, a1 - 0.12, 8, ALTAR_H - 12, tone(fr, shade(wood, 0.16)));
  box(g, fr, a0 - 0.01, b0, a1 + 0.01, b1 + 0.01, ALTAR_H, 2, cloth, lit(cloth, 0.3));
  plate(g, fr, b1 + 0.012, a0 - 0.01, a1 + 0.01, ALTAR_H - 11, ALTAR_H + 2, tone(fr, cloth));
  for (let u = a0; u < a1 - 0.02; u += 0.06) poly(g, fr, b1 + 0.013, [[u, ALTAR_H - 11], [u + 0.06, ALTAR_H - 11], [u + 0.03, ALTAR_H - 13.5]], tone(fr, cloth));
  plate(g, fr, b1 + 0.014, am - 0.1, am + 0.1, ALTAR_H - 16, ALTAR_H + 2, tone(fr, runner));
  plate(g, fr, b1 + 0.015, am - 0.1, am + 0.1, ALTAR_H - 16, ALTAR_H - 14.5, tone(fr, GOLD));
  const rr = rectOf(fr, am - 0.1, b0, am + 0.1, b1 + 0.01);
  fan(g, runner, quad(rr.x0, rr.y0, rr.x1, rr.y1, ALTAR_H + 2.1));
  const zt = ALTAR_H + 2;
  const ivory = 0xf6eed8;
  const spots = [[0.18, 0.22, 1.3], [0.5, 0.16, 1.6], [0.82, 0.22, 1.2], [0.34, 0.46, 0.9], [0.66, 0.44, 1], [0.5, 0.58, 0.6], [0.14, 0.62, 0.55], [0.86, 0.6, 0.5]] as const;
  const lights = spots.map(([ta, tb, k]) => {
    const [x, y] = xy(fr, a0 + 0.06 + ta * (a1 - a0 - 0.12), b0 + 0.06 + tb * (b1 - b0 - 0.1));
    return { x, y, h: 6 + k * 12 + rand() * 4, r: 0.03 + k * 0.016, votive: false };
  });
  for (const t of [0.22, 0.5, 0.78]) {
    const [x, y] = xy(fr, a0 + t * (a1 - a0), b1 - 0.04);
    lights.push({ x, y, h: 4, r: 0.035, votive: true });
  }
  lights.sort((p, q) => p.x + p.y - (q.x + q.y));
  const flames: Pt[] = [];
  for (const c of lights) {
    if (c.votive) {
      const glass = pick([0xc8404a, 0xe89a3a, 0xd8b84a], rand);
      tube(g, c.x, c.y, c.r, c.r * 1.1, zt, c.h, mix(glass, WARM, 0.3), lit(glass, 0.5), 6);
      flames.push(P(c.x, c.y, zt + c.h + 1));
      continue;
    }
    tube(g, c.x, c.y, c.r, c.r, zt, c.h, ivory, lit(ivory, 0.35), 8);
    const lip = P(c.x, c.y, zt + c.h);
    g.fillStyle(0xfff8e8, 0.9);
    g.fillEllipse(lip.x - c.r * RX * 0.3, lip.y, c.r * RX, c.r * RY * 0.8, 10);
    if (rand() < 0.5) fan(g, WHITE, [P(c.x - c.r * 0.7, c.y + c.r * 0.7, zt + c.h), P(c.x - c.r * 0.3, c.y + c.r, zt + c.h), P(c.x - c.r * 0.4, c.y + c.r * 0.9, zt + c.h - 4 - rand() * 4)], 0.8);
    line(g, lip, P(c.x, c.y, zt + c.h + 2), 1, 0x2a2238);
    flames.push(P(c.x, c.y, zt + c.h + 2));
  }
  for (const p of flames) {
    for (const [r, alpha] of [[11, 0.08], [6, 0.16]] as const) {
      g.fillStyle(WARM, alpha);
      g.fillCircle(p.x, p.y - 3 * S, r * S);
    }
    g.fillStyle(FLAME, 0.95);
    g.fillEllipse(p.x, p.y - 3 * S, 2.8 * S, 6 * S, 10);
    g.fillStyle(0xfff6d8, 1);
    g.fillEllipse(p.x, p.y - 2.2 * S, 1.3 * S, 3 * S, 8);
  }
}

// ---------- Temple pieces ----------

const BRONZE = 0xb4823e;
const PATINA = 0x5f9a86;
const TEAK = 0x8a5234;
const BELL_POST = 100;
const BELL_PROFILE = [[0, 0.3], [3, 0.29], [7, 0.25], [13, 0.215], [21, 0.195], [28, 0.18], [32, 0.14], [34, 0.06]] as const;

// The near half of a level circle at height z, as a screen path: the arc that faces the eye.
function nearArc(x: number, y: number, r: number, z: number, n = 14): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 4 + (Math.PI * i) / n;
    out.push(P(x + Math.cos(t) * r, y + Math.sin(t) * r, z));
  }
  return out;
}

function strokePath(g: G, pts: readonly Pt[], width: number, col: number, alpha = 1): void {
  g.lineStyle(width, col, alpha);
  g.beginPath();
  pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
  g.strokePath();
}

// A plain bronze bell hung in a timber frame on stone footings, its clapper showing and a pull rope hanging to hand height.
function bell(g: G, f: Furniture, layout: RoomLayout): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const am = (s.a0 + s.a1) / 2;
  const bm = s.b0 + 0.46;
  const [x, y] = xy(fr, am, bm);
  const stone = 0xb8b4a4;
  const lip = BELL_POST - 6 - (BELL_PROFILE[BELL_PROFILE.length - 1]?.[0] ?? 34);
  contact(g, f.c + 0.06, f.r + 0.2, f.c + f.w - 0.06, f.r + f.d - 0.24, 0.16);
  floorEllipse(g, x + 0.08, y + 0.03, 0.3, SHADOW, 0.16);
  const post = (a: number): void => {
    box(g, fr, a - 0.11, bm - 0.11, a + 0.11, bm + 0.11, 0, 7, stone, lit(stone, 0.25));
    box(g, fr, a - 0.06, bm - 0.06, a + 0.06, bm + 0.06, 7, BELL_POST - 7, TEAK, lit(TEAK, 0.2));
    box(g, fr, a - 0.075, bm - 0.075, a + 0.075, bm + 0.075, 20, 3, PATINA, lit(PATINA, 0.3));
  };
  const pa0 = s.a0 + 0.13;
  const pa1 = s.a1 - 0.13;
  post(pa0);
  box(g, fr, pa0, bm - 0.04, pa1, bm + 0.04, 14, 4, shade(TEAK, 0.1), lit(TEAK, 0.15));
  const hook = P(x, y, BELL_POST);
  line(g, hook, P(x, y, BELL_POST - 7), 2 * S, 0x3a3036);
  for (let i = 0; i < BELL_PROFILE.length - 1; i++) {
    const [z0, r0] = BELL_PROFILE[i] ?? [0, 0.3];
    const [z1, r1] = BELL_PROFILE[i + 1] ?? [34, 0.06];
    const top = z1 - z0;
    const col = mix(BRONZE, PATINA, Math.max(0, (z0 - 18) / 22));
    if (i === 0) {
      const ball = P(x, y, lip - 4);
      line(g, P(x, y, lip + 6), ball, 1.6 * S, shade(BRONZE, 0.5));
      g.fillStyle(shade(BRONZE, 0.45), 1);
      g.fillCircle(ball.x, ball.y, 3.4 * S);
      g.fillStyle(lit(BRONZE, 0.2), 1);
      g.fillCircle(ball.x - 1 * S, ball.y - 1 * S, 1.3 * S);
    }
    tube(g, x, y, r0, r1, lip + z0, top, col, null, 16);
  }
  tube(g, x, y, 0.05, 0.04, lip + 34, 4, shade(BRONZE, 0.2), lit(BRONZE, 0.2), 8);
  strokePath(g, nearArc(x, y, 0.296, lip + 1.4), 2.4 * S, lit(BRONZE, 0.45), 0.9);
  for (const [z, r] of [[9, 0.236], [24, 0.19]] as const) {
    strokePath(g, nearArc(x, y, r + 0.004, lip + z), 1.6 * S, lit(BRONZE, 0.3), 0.75);
    strokePath(g, nearArc(x, y, r + 0.004, lip + z - 1.6), 1, shade(BRONZE, 0.35), 0.6);
  }
  fan(g, WHITE, [P(x - 0.2, y + 0.13, lip + 6), P(x - 0.15, y + 0.15, lip + 6), P(x - 0.1, y + 0.08, lip + 27), P(x - 0.13, y + 0.06, lip + 27)], 0.22);
  const rope0 = P(x, y, lip - 7);
  const rope1 = P(x, y, 24);
  line(g, rope0, rope1, 2.6 * S, 0xd8c49a);
  for (let t = 0.05; t < 0.98; t += 0.07) {
    const p = { x: rope0.x + (rope1.x - rope0.x) * t, y: rope0.y + (rope1.y - rope0.y) * t };
    line(g, { x: p.x - 1.2 * S, y: p.y - 1 * S }, { x: p.x + 1.2 * S, y: p.y + 1 * S }, 1, 0x9a8460, 0.8);
  }
  g.fillStyle(0x8a3a2a, 1);
  g.fillRect(rope1.x - 2.2 * S, rope1.y - 1 * S, 4.4 * S, 3 * S);
  fan(g, 0xb8503a, [{ x: rope1.x - 2 * S, y: rope1.y + 2 * S }, { x: rope1.x + 2 * S, y: rope1.y + 2 * S }, { x: rope1.x + 3.6 * S, y: rope1.y + 11 * S }, { x: rope1.x - 3.6 * S, y: rope1.y + 11 * S }]);
  for (const dx of [-2, 0, 2]) line(g, { x: rope1.x + dx * S, y: rope1.y + 3 * S }, { x: rope1.x + dx * 1.6 * S, y: rope1.y + 10.5 * S }, 1, 0x7a2e22, 0.7);
  post(pa1);
  box(g, fr, s.a0 + 0.02, bm - 0.08, s.a1 - 0.02, bm + 0.08, BELL_POST, 7, TEAK, lit(TEAK, 0.22));
  for (const a of [s.a0 + 0.02, s.a1 - 0.1]) box(g, fr, a, bm - 0.08, a + 0.08, bm + 0.08, BELL_POST + 7, 3, TEAK, lit(TEAK, 0.25));
  box(g, fr, am - 0.18, bm - 0.085, am + 0.18, bm + 0.085, BELL_POST + 2, 3, PATINA, lit(PATINA, 0.3));
}

const CUSHIONS = [
  { base: 0xe8d2a0, round: 0x2f4a7a },
  { base: 0xe2c48a, round: 0x2f7470 },
  { base: 0xead8b4, round: 0x7a3a4a },
  { base: 0xd8b878, round: 0xa8503a },
] as const;

// A plump round cushion with a buttoned, gathered top on a flat linen one, on a reed mat: the place to sit and breathe.
function cushion(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const am = (s.a0 + s.a1) / 2;
  const bm = s.b0 + 0.54;
  const [x, y] = xy(fr, am, bm);
  const { base, round } = CUSHIONS[Math.floor(rand() * CUSHIONS.length)] ?? CUSHIONS[0];
  const reed = 0xd8c08a;
  const mat = rectOf(fr, s.a0 + 0.06, s.b0 + 0.1, s.a1 - 0.06, s.b1 - 0.02);
  fan(g, SHADOW, quad(mat.x0 + 0.03, mat.y0 + 0.04, mat.x1 + 0.05, mat.y1 + 0.03), 0.16);
  fan(g, 0x3a4a5a, quad(mat.x0, mat.y0, mat.x1, mat.y1, 0.6));
  fan(g, reed, quad(mat.x0 + 0.05, mat.y0 + 0.05, mat.x1 - 0.05, mat.y1 - 0.05, 0.6));
  for (let k = mat.y0 + 0.09; k < mat.y1 - 0.06; k += 0.05) line(g, P(mat.x0 + 0.06, k, 0.6), P(mat.x1 - 0.06, k, 0.6), 1, shade(reed, 0.25), 0.45);
  fan(g, WHITE, quad(mat.x0 + 0.05, mat.y0 + 0.05, mat.x1 - 0.05, mat.y0 + 0.12, 0.6), 0.12);
  const sq = 0.36;
  prism(g, x - sq, y - sq, x + sq, y + sq, 0.6, 2.4, shade(base, 0.1), base);
  prism(g, x - sq + 0.03, y - sq + 0.03, x + sq - 0.03, y + sq - 0.03, 3, 2, base, lit(base, 0.2));
  strokePath(g, [P(x - sq, y + sq, 3), P(x + sq, y + sq, 3), P(x + sq, y - sq, 3)], 1, shade(base, 0.2), 0.35);
  floorEllipse(g, x + 0.05, y + 0.04, 0.3, SHADOW, 0.3, 5);
  tube(g, x, y, 0.26, 0.3, 5, 3, shade(round, 0.06), null, 20);
  tube(g, x, y, 0.3, 0.29, 8, 2, round, null, 20);
  strokePath(g, nearArc(x, y, 0.3, 8), 1.2, lit(round, 0.35), 0.7);
  const dome = [[0.29, 10, 0], [0.26, 11.6, 0.08], [0.21, 12.8, 0.16], [0.14, 13.6, 0.26]] as const;
  for (const [r, z, k] of dome) floorEllipse(g, x - (0.29 - r) * 0.25, y - (0.29 - r) * 0.25, r, lit(round, k), 1, z);
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2 + 0.3;
    const a = P(x + Math.cos(t) * 0.05, y + Math.sin(t) * 0.05, 13.8);
    const b = P(x + Math.cos(t + 0.25) * 0.25, y + Math.sin(t + 0.25) * 0.25, 11);
    line(g, a, b, 1, shade(round, 0.3), 0.45);
  }
  const btn = P(x, y, 13.9);
  g.fillStyle(shade(round, 0.45), 1);
  g.fillEllipse(btn.x, btn.y, 5 * S, 2.8 * S, 12);
  g.fillStyle(base, 1);
  g.fillEllipse(btn.x - 0.4 * S, btn.y - 0.4 * S, 2.6 * S, 1.4 * S, 10);
}

// A koi seen from above just under the surface, nose along `ang`: an orange, white or gold body with patches.
function koi(g: G, x: number, y: number, z: number, ang: number, len: number, body: number, patch: number): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const at = (along: number, across: number, dz = 0): Pt => P(x + ux * along - uy * across, y + uy * along + ux * across, z + dz);
  const w = len * 0.2;
  const outline = [at(len * 0.5, 0), at(len * 0.36, w * 0.8), at(len * 0.1, w), at(-len * 0.2, w * 0.55), at(-len * 0.36, w * 0.2), at(-len * 0.36, -w * 0.2), at(-len * 0.2, -w * 0.55), at(len * 0.1, -w), at(len * 0.36, -w * 0.8)];
  fan(g, 0x0e2a30, outline.map((p) => ({ x: p.x + 3 * S, y: p.y + 4 * S })), 0.25);
  fan(g, body, [at(-len * 0.34, 0), at(-len * 0.56, w * 0.9), at(-len * 0.5, 0), at(-len * 0.56, -w * 0.9)], 0.85);
  for (const s of [1, -1]) fan(g, body, [at(len * 0.18, s * w * 0.8), at(len * 0.02, s * w * 1.9), at(len * 0.04, s * w * 0.7)], 0.7);
  fan(g, body, outline, 0.92);
  fan(g, patch, [at(len * 0.2, w * 0.5), at(len * 0.02, w * 0.7), at(-len * 0.12, 0), at(len * 0.06, -w * 0.6), at(len * 0.28, -w * 0.3)], 0.9);
  fan(g, patch, [at(-len * 0.16, w * 0.3), at(-len * 0.3, w * 0.12), at(-len * 0.28, -w * 0.25)], 0.85);
  fan(g, WHITE, [at(len * 0.44, 0), at(len * 0.2, -w * 0.5), at(-len * 0.1, -w * 0.4)], 0.18);
}

// A round stone-rimmed reflecting pool: still dark water with the sky in it, lily pads, a koi or two and a ripple.
function pool(g: G, f: Furniture, layout: RoomLayout, rand: () => number): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const R = Math.min(f.w, f.d) / 2 - 0.08;
  const ri = R - 0.15;
  const rim = 7;
  const zw = 3;
  const stone = 0xc8c4b4;
  const bounds = { x1: layout.w - 1, y1: layout.d - 1 };
  for (let i = 0; i < 7; i++) {
    const t = rand() * Math.PI * 2;
    const d = R + 0.15 + rand() * 0.45;
    floorPool(g, x + Math.cos(t) * d, y + Math.sin(t) * d, 0.12 + rand() * 0.16, 0xd8f4f0, 0.07, bounds);
  }
  floorEllipse(g, x + 0.12, y + 0.05, R + 0.06, SHADOW, 0.2);
  tube(g, x, y, R, R, 0, rim, stone, null, 28);
  for (let i = 0; i < 9; i++) {
    const t = -Math.PI / 4 + (Math.PI * (i + 0.5)) / 9;
    line(g, P(x + Math.cos(t) * R, y + Math.sin(t) * R, 0.5), P(x + Math.cos(t) * R, y + Math.sin(t) * R, rim), 1, shade(stone, 0.4), 0.45);
  }
  floorEllipse(g, x, y, R, lit(stone, 0.22), 1, rim);
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2 + 0.2;
    line(g, P(x + Math.cos(t) * ri, y + Math.sin(t) * ri, rim), P(x + Math.cos(t) * R, y + Math.sin(t) * R, rim), 1, shade(stone, 0.25), 0.5);
  }
  floorEllipse(g, x, y, ri, shade(stone, 0.42), 1, rim);
  const water: Pt[] = [];
  for (let i = 0; i <= 18; i++) {
    const t = (3 * Math.PI) / 4 + (Math.PI * i) / 18;
    water.push(P(x + Math.cos(t) * ri, y + Math.sin(t) * ri, zw));
  }
  for (let i = 0; i <= 18; i++) {
    const t = -Math.PI / 4 + (Math.PI * i) / 18;
    water.push(P(x + Math.cos(t) * ri, y + Math.sin(t) * ri, rim));
  }
  fan(g, 0x2f6a6c, water);
  floorEllipse(g, x + 0.04, y + 0.04, ri * 0.62, 0x1f4c52, 0.55, zw);
  floorEllipse(g, x + 0.06, y + 0.06, ri * 0.36, 0x173e44, 0.5, zw);
  const fish = 1 + (rand() < 0.6 ? 1 : 0);
  const coats = [[0xf08a3a, 0xf6f0e6], [0xf6f0e6, 0xd8483a], [0xf2c05a, 0xf6f0e6]] as const;
  for (let i = 0; i < fish; i++) {
    const t = rand() * Math.PI * 2;
    const d = ri * (0.2 + rand() * 0.25);
    const [body, patch] = coats[Math.floor(rand() * coats.length)] ?? coats[0];
    koi(g, x + Math.cos(t) * d, y + Math.sin(t) * d, zw - 0.4, t + Math.PI / 2 + (rand() - 0.5) * 0.8, 0.42, body, patch);
  }
  fan(g, 0xc8e4ee, [P(x - ri * 0.55, y - ri * 0.2, zw + 0.1), P(x - ri * 0.38, y - ri * 0.5, zw + 0.1), P(x + ri * 0.3, y + ri * 0.12, zw + 0.1), P(x + ri * 0.12, y + ri * 0.4, zw + 0.1)], 0.12);
  fan(g, WARM, [P(x - ri * 0.1, y - ri * 0.42, zw + 0.1), P(x + ri * 0.05, y - ri * 0.48, zw + 0.1), P(x + ri * 0.4, y - ri * 0.02, zw + 0.1), P(x + ri * 0.28, y + ri * 0.04, zw + 0.1)], 0.1);
  const pads = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < pads; i++) {
    const t = (i / pads) * Math.PI * 2 + rand() * 0.8;
    const d = ri * (0.42 + rand() * 0.14);
    const px = x + Math.cos(t) * d;
    const py = y + Math.sin(t) * d;
    const r = 0.08 + rand() * 0.05;
    const leafs = LEAVES[i % LEAVES.length] ?? LEAVES[0];
    floorEllipse(g, px + 0.02, py + 0.02, r, 0x0e2a30, 0.3, zw + 0.2);
    floorEllipse(g, px, py, r, leafs.mid, 1, zw + 0.3);
    floorEllipse(g, px - r * 0.2, py - r * 0.2, r * 0.6, leafs.light, 0.7, zw + 0.35);
    const notch = rand() * Math.PI * 2;
    fan(g, 0x2f6a6c, [P(px, py, zw + 0.4), P(px + Math.cos(notch - 0.3) * r * 1.05, py + Math.sin(notch - 0.3) * r * 1.05, zw + 0.4), P(px + Math.cos(notch + 0.3) * r * 1.05, py + Math.sin(notch + 0.3) * r * 1.05, zw + 0.4)]);
  }
  const rx = x - ri * 0.25 + rand() * ri * 0.3;
  const ry = y + ri * 0.15;
  for (const [k, alpha] of [[0.07, 0.5], [0.14, 0.32], [0.22, 0.18]] as const) {
    const c = P(rx, ry, zw + 0.5);
    g.lineStyle(1.2, WHITE, alpha);
    g.strokeEllipse(c.x, c.y, k * 2 * RX, k * 2 * RY, 18);
  }
  for (let i = 0; i < 5; i++) {
    const t = rand() * Math.PI * 2;
    const d = ri * (0.25 + rand() * 0.5);
    const p = P(x + Math.cos(t) * d, y + Math.sin(t) * d, zw + 0.5);
    line(g, { x: p.x - 3 * S, y: p.y }, { x: p.x + 3 * S, y: p.y }, 1.2, WHITE, 0.45);
  }
  strokePath(g, nearArc(x, y, ri, rim), 1.2, WHITE, 0.3);
}

// A round paper lantern glowing on a slim timber post, throwing a warm pool round its stone foot.
function paperLantern(g: G, f: Furniture, layout: RoomLayout): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const bounds = { x1: layout.w - 1, y1: layout.d - 1 };
  for (const [r, alpha] of [[2, 0.045], [1.5, 0.05], [1, 0.06], [0.55, 0.08]] as const) floorPool(g, x, y, r, WARM, alpha, bounds);
  const zc = LAMP_H + 4;
  const c = P(x, y, zc);
  for (const [r, alpha] of [[44, 0.04], [34, 0.05], [24, 0.07], [16, 0.09]] as const) {
    g.fillStyle(WARM, alpha);
    g.fillCircle(c.x, c.y, r * S);
  }
  const stone = 0xb8b4a4;
  floorEllipse(g, x + 0.08, y + 0.03, 0.22, SHADOW, 0.25);
  prism(g, x - 0.16, y - 0.16, x + 0.16, y + 0.16, 0, 6, stone, lit(stone, 0.25));
  tube(g, x, y, 0.035, 0.03, 6, zc - 14, TEAK, null, 4);
  tube(g, x, y, 0.07, 0.07, zc - 13, 2.5, shade(TEAK, 0.2), lit(TEAK, 0.2), 8);
  const paper = 0xffe6b0;
  const w = 0.25 * 2 * RX;
  const hgt = 26 * S;
  g.fillStyle(lit(paper, 0.3), 1);
  g.fillEllipse(c.x, c.y, w, hgt, 24);
  g.fillStyle(0xf2b060, 0.55);
  g.fillEllipse(c.x + w * 0.16, c.y + hgt * 0.04, w * 0.7, hgt * 0.92, 20);
  g.fillStyle(0xfff8e4, 0.85);
  g.fillEllipse(c.x - w * 0.12, c.y - hgt * 0.06, w * 0.46, hgt * 0.62, 18);
  g.lineStyle(1, 0xb87a3a, 0.45);
  for (let k = -3; k <= 3; k++) {
    const t = k / 4;
    const half = Math.sqrt(1 - t * t);
    g.strokeEllipse(c.x, c.y + t * hgt * 0.5, w * half, w * half * 0.18, 16);
  }
  tube(g, x, y, 0.09, 0.08, zc - 15, 3, 0x3a2a24, 0x5a4434, 10);
  tube(g, x, y, 0.08, 0.09, zc + 12, 3, 0x3a2a24, 0x5a4434, 10);
  line(g, P(x, y, zc + 15), P(x, y, zc + 19), 1.4 * S, 0x3a2a24);
  for (const [dx, col] of [[-0.4, 0x8a3a2a], [0.4, 0x8a3a2a]] as const) {
    const t0 = P(x, y, zc - 16);
    line(g, t0, { x: t0.x + dx * 6 * S, y: t0.y + 10 * S }, 1.2, col, 0.85);
  }
}

// A temple column: a round teak shaft on a stone drum, ringed in green copper, under a stepped timber capital.
function timberColumn(g: G, f: Furniture): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const h = WALL_H.temple;
  const stone = 0xbab6a6;
  const r = 0.2 * Math.min(f.w, f.d);
  fan(g, SHADOW, [P(x - 0.3, y - 0.3), P(x + 0.9, y - 0.2), P(x + 1, y + 0.3), P(x - 0.3, y + 0.42)], 0.12);
  prism(g, x - 0.38, y - 0.38, x + 0.38, y + 0.38, 0, 7, shade(stone, 0.06), lit(stone, 0.2));
  tube(g, x, y, 0.32, 0.29, 7, 7, stone, lit(stone, 0.25), 14);
  tube(g, x, y, r + 0.01, r, 14, h - 40, TEAK, null, 16);
  for (let k = 0; k < 3; k++) fan(g, WHITE, [P(x - r * 0.62, y + r * 0.62, 18 + k * 30), P(x - r * 0.5, y + r * 0.72, 18 + k * 30), P(x - r * 0.5, y + r * 0.72, 40 + k * 30), P(x - r * 0.62, y + r * 0.62, 40 + k * 30)], 0.05);
  for (const z of [22, h - 44]) {
    tube(g, x, y, r + 0.025, r + 0.025, z, 4, PATINA, null, 16);
    strokePath(g, nearArc(x, y, r + 0.026, z + 4), 1.2, lit(PATINA, 0.4), 0.8);
  }
  prism(g, x - 0.27, y - 0.27, x + 0.27, y + 0.27, h - 26, 8, shade(TEAK, 0.08), lit(TEAK, 0.18));
  prism(g, x - 0.36, y - 0.36, x + 0.36, y + 0.36, h - 18, 8, TEAK, lit(TEAK, 0.22));
  fan(g, PATINA, [P(x - 0.36, y + 0.36, h - 13), P(x + 0.36, y + 0.36, h - 13), P(x + 0.36, y + 0.36, h - 11), P(x - 0.36, y + 0.36, h - 11)], 0.85);
}

// ---------- Mandir pieces ----------

const GHANTA = [[0, 0.2], [1.6, 0.194], [3.6, 0.165], [7, 0.138], [12, 0.128], [17, 0.124], [21, 0.116], [24.5, 0.098], [27.5, 0.07], [29.5, 0.035]] as const;
const RANGOLI = [
  { ring: 0x2f6ad8, petal: 0xe8307a, inner: 0xf6c42a, scallop: 0xf08a1e, leaf: 0x2fa860, centre: 0xd83a32 },
  { ring: 0x2fa860, petal: 0xf08a1e, inner: 0xe8307a, scallop: 0xf6c42a, leaf: 0x7a3ab8, centre: 0x2f6ad8 },
  { ring: 0x7a3ab8, petal: 0xf6c42a, inner: 0xd83a32, scallop: 0x2fb8c8, leaf: 0x2fa860, centre: 0xf08a1e },
] as const;

// A brass plate seen from above at a floor point, rimmed and lit on its west side.
function brassPlate(g: G, x: number, y: number, z: number, r: number): void {
  floorEllipse(g, x + 0.03, y + 0.02, r + 0.02, SHADOW, 0.3, z);
  floorEllipse(g, x, y, r, shade(BRASS, 0.2), 1, z + 0.6);
  floorEllipse(g, x - 0.01, y - 0.01, r * 0.86, BRASS, 1, z + 0.8);
  floorEllipse(g, x - 0.03, y - 0.03, r * 0.5, lit(BRASS, 0.3), 0.6, z + 0.9);
}

// The garbhagriha: a sandstone shrine front under a ribbed nagara tower, its doorway veiled by a half-drawn curtain,
// or with a shrine, the curtain tied back on the lamplit murti; a kalash, fruit and an aarti plate wait on the steps.
function sanctum(g: G, f: Furniture, layout: RoomLayout, rand: () => number, shrine: Shrine | null): void {
  const fr = frameOf(f, layout);
  const deity = fr === 'e' ? null : (shrine?.main ?? null);
  const s = span(f, fr);
  const am = (s.a0 + s.a1) / 2;
  const b0 = s.b0;
  const bounds = { x1: layout.w - 1, y1: layout.d - 1 };
  const [gx, gy] = xy(fr, am, s.b1 - 0.1);
  for (const [r, alpha] of [[2.6, 0.04], [1.9, 0.05], [1.3, 0.06], [0.8, 0.08]] as const) floorPool(g, gx, gy, r, WARM, alpha, bounds);
  const glow = fp(fr, am, b0, 64);
  for (const [r, alpha] of [[92, 0.04], [70, 0.05], [48, 0.06]] as const) {
    g.fillStyle(WARM, alpha);
    g.fillEllipse(glow.x, glow.y, r * 2 * S, r * 2.4 * S, 28);
  }
  contact(g, f.c + 0.02, f.r + 0.02, f.c + f.w - 0.02, f.r + f.d - 0.04, 0.22);
  const pb = b0 + 0.7;
  box(g, fr, s.a0 + 0.05, b0, s.a1 - 0.05, pb, 0, 9, shade(MARBLE_WHITE, 0.05), lit(MARBLE_WHITE, 0.3));
  plate(g, fr, pb + 0.002, s.a0 + 0.05, s.a1 - 0.05, 3, 5, tone(fr, KUMKUM));
  plate(g, fr, pb + 0.002, s.a0 + 0.05, s.a1 - 0.05, 7.4, 9, tone(fr, GOLD), 0.8);
  box(g, fr, am - 0.62, pb, am + 0.62, b0 + 0.95, 0, 4.5, shade(MARBLE_WHITE, 0.03), lit(MARBLE_WHITE, 0.32));
  plate(g, fr, b0 + 0.952, am - 0.62, am + 0.62, 1.4, 2.6, tone(fr, SAFFRON), 0.8);

  const fb = b0 + 0.4;
  const sa0 = s.a0 + 0.14;
  const sa1 = s.a1 - 0.14;
  const face = (u0: number, u1: number, z0: number, z1: number, col: number, alpha = 1, d = 0.002): void => {
    plate(g, fr, fb + d, u0, u1, z0, z1, tone(fr, col), alpha);
  };
  const at = (u: number, z: number, d = 0.004): Pt => fp(fr, u, fb + d, z);
  const tint = (col: number): number => tone(fr, col);
  box(g, fr, sa0, b0, sa1, fb, 9, 88, SANDSTONE, lit(SANDSTONE, 0.25));
  face(sa0, sa1, 9, 13, lit(SANDSTONE, 0.25));
  face(sa0, sa1, 13, 15, shade(SANDSTONE, 0.2));
  face(sa0, sa1, 18, 19.6, KUMKUM, 0.85);
  for (const u of [sa0 + 0.04, sa1 - 0.18]) {
    face(u, u + 0.14, 20, 96, lit(SANDSTONE, 0.14));
    face(u + 0.05, u + 0.09, 24, 92, shade(SANDSTONE, 0.16));
  }
  for (const su of [(sa0 + 0.18 + am - 0.52) / 2, (sa1 - 0.18 + am + 0.52) / 2]) {
    const n0 = 34;
    const n1 = 64;
    poly(g, fr, fb + 0.002, windowOutline(su - 0.14, su + 0.14, n0 - 3, n1 + 4, true), tint(shade(SANDSTONE, 0.2)));
    poly(g, fr, fb + 0.003, windowOutline(su - 0.1, su + 0.1, n0, n1, true), tint(0x5a2a16));
    poly(g, fr, fb + 0.004, windowOutline(su - 0.07, su + 0.07, n0, n1 - 6, true), WARM, 0.3);
    diyaAt(g, at(su - 0.02, n0, 0.03), 0.9);
    lotusAt(g, at(su, 76), 7, LOTUS, tint);
  }
  face(am - 0.54, am + 0.54, 12, 88, shade(SANDSTONE, 0.18));
  face(am - 0.5, am + 0.5, 12, 86, lit(SANDSTONE, 0.18));
  face(am - 0.43, am + 0.43, 12, 82, 0xb8483a);
  face(am - 0.38, am + 0.38, 12, 78, GOLD);
  face(am - 0.36, am + 0.36, 12, 77, 0x3a1a10);
  if (deity === null) {
    face(am - 0.3, am + 0.3, 13, 72, 0xe07a2a, 0.5);
    face(am - 0.2, am + 0.2, 13, 62, 0xffc860, 0.6);
    face(am - 0.1, am + 0.1, 13, 50, 0xfff0c0, 0.65);
  } else {
    face(am - 0.32, am + 0.32, 13, 74, 0x6a2a12, 0.7);
    face(am - 0.22, am + 0.22, 13, 62, 0xe07a2a, 0.3);
  }
  for (let z = 17; z < 80; z += 6) {
    for (const u of [am - 0.465, am + 0.465, am - 0.405, am + 0.405]) {
      const p = at(u, z);
      g.fillStyle(tint(Math.abs(u - am) > 0.44 ? shade(SANDSTONE, 0.22) : GOLD), 1);
      g.fillCircle(p.x, p.y, 1.3 * S);
    }
  }
  if (deity !== null) {
    const k = deity === 'shivling' ? 1 : 0.92;
    murti({ g, o: at(am, deity === 'shivling' ? 15 : 13 + 6.5 * k), k, t: tint }, deity);
  }
  const red = 0xb8282e;
  const open = deity !== null;
  for (const dir of [-1, 1] as const) {
    const u = (k: number): number => am + dir * k;
    const pts: [number, number][] = open
      ? [[u(0.45), 78], [u(0.3), 78], [u(0.315), 58], [u(0.36), 34], [u(0.33), 12], [u(0.45), 12]]
      : [[u(0.36), 76], [u(0.02), 76], [u(0.05), 56], [u(0.18), 30], [u(0.14), 12], [u(0.36), 12]];
    poly(g, fr, fb + 0.005, pts, tint(red));
    for (const k of open ? [0.41, 0.375] : [0.3, 0.24]) plate(g, fr, fb + 0.006, Math.min(u(k), u(k + 0.012)), Math.max(u(k), u(k + 0.012)), 13, 74, tint(shade(red, 0.25)), 0.7);
    plate(g, fr, fb + 0.006, Math.min(u(open ? 0.43 : 0.35), u(open ? 0.45 : 0.37)), Math.max(u(open ? 0.43 : 0.35), u(open ? 0.45 : 0.37)), 13, 74, tint(lit(red, 0.15)), 0.7);
    if (fr !== 'e') wallPath(g, fr, fb + 0.007, pts.slice(1, 5), 2.2 * S, tint(SAFFRON));
    plate(g, fr, fb + 0.007, Math.min(u(open ? 0.33 : 0.14), u(open ? 0.45 : 0.36)), Math.max(u(open ? 0.33 : 0.14), u(open ? 0.45 : 0.36)), 12, 15, tint(SAFFRON));
    const tie = at(u(open ? 0.39 : 0.185), open ? 34 : 30, 0.008);
    g.fillStyle(tint(GOLD), 1);
    g.fillCircle(tie.x, tie.y, 2.4 * S);
    g.fillStyle(tint(lit(GOLD, 0.4)), 1);
    g.fillCircle(tie.x - 0.6 * S, tie.y - 0.6 * S, 1 * S);
  }
  face(am - 0.38, am + 0.38, 70, 78, SAFFRON, 1, 0.008);
  face(am - 0.38, am + 0.38, 76.5, 78, GOLD, 1, 0.009);
  for (let u = am - 0.38; u < am + 0.37; u += 0.076) poly(g, fr, fb + 0.009, [[u, 70], [u + 0.076, 70], [u + 0.038, 66]], tint(SAFFRON));
  face(am - 0.46, am + 0.46, 9, 13, lit(SANDSTONE, 0.3), 1, 0.009);
  if (open) {
    diyaAt(g, at(am + 0.16, 13, 0.03), 0.6);
    for (const du of [-0.24, -0.16, 0.06, 0.26]) {
      const p = at(am + du, 13, 0.03);
      blossom(g, p.x, p.y - 1.2 * S, 1.2, du < 0 ? MARIGOLDS[du < -0.2 ? 0 : 1] : du > 0.1 ? KUMKUM : 0xfaf8f0);
    }
  }
  face(am - 0.58, am + 0.58, 86, 97, lit(SANDSTONE, 0.1));
  face(am - 0.58, am + 0.58, 86, 87.6, shade(SANDSTONE, 0.25));
  face(am - 0.13, am + 0.13, 87, 96.5, GOLD, 1, 0.003);
  lotusAt(g, at(am, 88.6), 6.4, LOTUS, tint);
  for (const dir of [-1, 1]) kalashAt(g, at(am + dir * 0.36, 87.4), 3.6, GOLD, tint);
  const lintel = (u: number): Pt => at(u, 84, 0.012);
  marigolds(g, swag(lintel(am - 0.5), lintel(am + 0.5), 9), 2.2, tint);
  for (let u = am - 0.42; u < am + 0.43; u += 0.14) leaf(g, { x: lintel(u).x, y: lintel(u).y + 3 * S }, Math.PI / 2 + (u - am) * 0.4, 8, 2.6, tint(MANGO.light), tint(MANGO.dark));
  for (const u of [am - 0.5, am + 0.5]) garlandDrop(g, lintel(u), 16, 1, tint);
  box(g, fr, sa0 - 0.05, b0, sa1 + 0.05, fb + 0.06, 97, 7, SANDSTONE, lit(SANDSTONE, 0.3));
  plate(g, fr, fb + 0.062, sa0 - 0.05, sa1 + 0.05, 99, 101, tone(fr, KUMKUM));

  const levels = 20;
  const band = 3.6;
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1);
    const storey = i % 5 === 4;
    const hw = 1 * (1 - 0.7 * Math.pow(t, 2.2)) + (storey ? 0.04 : 0);
    const bd = 0.4 - 0.12 * t + (storey ? 0.03 : 0);
    const z = 104 + i * band;
    const col = storey ? shade(SANDSTONE, 0.1) : i % 2 === 0 ? SANDSTONE : shade(SANDSTONE, 0.04);
    box(g, fr, am - hw, b0, am + hw, b0 + bd, z, band, col, lit(col, 0.35));
    box(g, fr, am - hw * 0.68, b0, am + hw * 0.68, b0 + bd + 0.025, z, band, lit(col, 0.03), lit(col, 0.38));
    box(g, fr, am - hw * 0.34, b0, am + hw * 0.34, b0 + bd + 0.05, z, band, lit(col, 0.08), lit(col, 0.42));
    if (i === 0) plate(g, fr, b0 + bd + 0.052, am - hw * 0.34, am + hw * 0.34, z + 1, z + 2.6, tone(fr, KUMKUM));
  }
  const crown = 104 + levels * band;
  box(g, fr, am - 0.2, b0, am + 0.2, b0 + 0.3, crown, 3, shade(SANDSTONE, 0.1), lit(SANDSTONE, 0.2));
  const [kx, ky] = xy(fr, am, b0 + 0.2);
  tube(g, kx, ky, 0.18, 0.24, crown + 3, 3, SANDSTONE, null, 16);
  tube(g, kx, ky, 0.24, 0.24, crown + 6, 6, SANDSTONE, null, 16, true);
  tube(g, kx, ky, 0.24, 0.15, crown + 12, 3, SANDSTONE, lit(SANDSTONE, 0.3), 16);
  tube(g, kx, ky, 0.06, 0.11, crown + 15, 4, GOLD, null, 10);
  tube(g, kx, ky, 0.11, 0.07, crown + 19, 4, GOLD, null, 10);
  tube(g, kx, ky, 0.035, 0.035, crown + 23, 3, GOLD, lit(GOLD, 0.3), 8);
  tube(g, kx, ky, 0.03, 0, crown + 26, 9, GOLD, null, 6);

  const kz = 9;
  const [px, py] = xy(fr, am - 0.95, b0 + 0.54);
  floorEllipse(g, px + 0.05, py + 0.03, 0.14, SHADOW, 0.3, kz);
  tube(g, px, py, 0.07, 0.13, kz, 4, BRASS, null, 14);
  tube(g, px, py, 0.13, 0.12, kz + 4, 5, BRASS, null, 14);
  tube(g, px, py, 0.12, 0.06, kz + 9, 4, BRASS, null, 14);
  strokePath(g, nearArc(px, py, 0.128, kz + 6), 1.4 * S, KUMKUM);
  tube(g, px, py, 0.05, 0.075, kz + 13, 3, BRASS, lit(BRASS, 0.3), 10);
  const mouth = P(px, py, kz + 16);
  for (const ang of [-2.7, -2.2, -1.75, -1.35, -0.9, -0.45]) leaf(g, mouth, ang, 13, 3.2, MANGO.light, MANGO.dark);
  g.fillStyle(0x6a4026, 1);
  g.fillEllipse(mouth.x, mouth.y - 4 * S, 10 * S, 9 * S, 14);
  g.fillStyle(0x9a6a3e, 1);
  g.fillEllipse(mouth.x - 1.4 * S, mouth.y - 5 * S, 5 * S, 4.4 * S, 12);
  line(g, { x: mouth.x, y: mouth.y - 8 * S }, { x: mouth.x + 1.5 * S, y: mouth.y - 12 * S }, 1.4 * S, 0xc8a070);

  const [fx, fy] = xy(fr, am + 0.95, b0 + 0.52);
  brassPlate(g, fx, fy, kz, 0.2);
  const fruitAt = P(fx, fy, kz + 1);
  for (const [dx, dy, ang] of [[-6, -2, -2.4], [-4, -1, -2.1], [-2, 0, -1.8]] as const) leaf(g, { x: fruitAt.x + dx * S, y: fruitAt.y + dy * S }, ang, 14, 3, 0xf6d84a, 0xd8a82a);
  for (const [dx, dy, col] of [[4, -2, 0xc8302a], [7, 1, 0xd84a2a], [2, 2, 0x8ab83a]] as const) {
    g.fillStyle(shade(col, 0.3), 1);
    g.fillCircle(fruitAt.x + (dx + 0.6) * S, fruitAt.y + (dy - 2.4) * S, 3.6 * S);
    g.fillStyle(col, 1);
    g.fillCircle(fruitAt.x + dx * S, fruitAt.y + (dy - 3) * S, 3.2 * S);
    g.fillStyle(WHITE, 0.45);
    g.fillCircle(fruitAt.x + (dx - 1) * S, fruitAt.y + (dy - 4) * S, 1 * S);
  }
  for (const [ta, tb] of [[0.22, 0.6], [s.a1 - s.a0 - 0.22, 0.6]] as const) diyaAt(g, fp(fr, s.a0 + ta, b0 + tb, kz), 0.95);
  for (let i = 0; i < 7; i++) {
    const p = fp(fr, am + (rand() - 0.5) * 1.1, b0 + 0.5 + rand() * 0.15, kz);
    blossom(g, p.x, p.y - 1.5 * S, 1.8, i % 3 === 0 ? KUMKUM : MARIGOLDS[i % 2] ?? SAFFRON);
  }

  const tz = 4.5;
  const [tx, ty] = xy(fr, am, b0 + 0.82);
  if (deity === 'shivling') {
    const [nx, ny] = xy(fr, am - 0.3, b0 + 0.84);
    nandi(g, nx, ny, tz);
    return;
  }
  brassPlate(g, tx, ty, tz, 0.17);
  for (let i = 0; i < 9; i++) {
    const p = P(tx + 0.05 + rand() * 0.06, ty - 0.08 + rand() * 0.06, tz + 1);
    g.fillStyle(0xfaf6ea, 1);
    g.fillCircle(p.x, p.y, 0.8 * S);
  }
  const kum = P(tx + 0.08, ty + 0.04, tz + 1);
  g.fillStyle(shade(KUMKUM, 0.2), 1);
  g.fillEllipse(kum.x, kum.y, 6 * S, 3 * S, 10);
  g.fillStyle(KUMKUM, 1);
  g.fillEllipse(kum.x - 0.4 * S, kum.y - 0.8 * S, 4.4 * S, 2.4 * S, 10);
  for (const [dx, dy] of [[-0.1, 0.06], [0.02, 0.1], [-0.08, -0.06]] as const) {
    const p = P(tx + dx, ty + dy, tz + 1);
    blossom(g, p.x, p.y - 1.6 * S, 2, MARIGOLDS[dx > 0 ? 1 : 0]);
  }
  diyaAt(g, P(tx - 0.03, ty - 0.02, tz + 1.2), 0.9);
  const bx = tx + 0.1;
  const by = ty - 0.06;
  tube(g, bx, by, 0.045, 0.028, tz + 1.2, 6, BRASS, null, 8);
  line(g, P(bx, by, tz + 7), P(bx, by, tz + 14), 1.6 * S, shade(BRASS, 0.15));
  const knob = P(bx, by, tz + 15);
  g.fillStyle(BRASS, 1);
  g.fillCircle(knob.x, knob.y, 1.8 * S);
}

// ---------- Murtis ----------

type Pts = readonly (readonly [number, number])[];
type Murti = { readonly g: G; readonly o: Pt; readonly k: number; readonly t: (col: number) => number; readonly lean?: number };

const WAIST = 22;
const PITAMBAR = 0xf2c12e;
const HAIR = 0x1c1626;
const LIPS = 0xb83a4a;
const EYE_WHITE = 0xf6f0e4;
const SANDAL = 0xf6f0e4;
const VIBHUTI = 0xf6f2ea;
const COPPER = 0xc8703a;
const BILVA = { light: 0x5a9a3a, dark: 0x2f6a2a } as const;
const MURTI_LOOK = {
  ram: { skin: 0x3f7a92, sash: 0xd8582a },
  vishnu: { skin: 0x4f80cc, sash: 0xc8323a },
  krishna: { skin: 0x3c66b8, sash: 0xd8405a },
} as const;

// A point in a murti's upright frame: x across and z up from its feet in art px, leaning about the waist.
function mAt(m: Murti, x: number, z: number): Pt {
  const a = m.lean ?? 0;
  const dz = z - WAIST;
  const rx = z > WAIST ? x * Math.cos(a) + dz * Math.sin(a) : x;
  const rz = z > WAIST ? WAIST + dz * Math.cos(a) - x * Math.sin(a) : z;
  return { x: m.o.x + rx * S * m.k, y: m.o.y - rz * S * m.k };
}

function mPath(m: Murti, pts: Pts): void {
  m.g.beginPath();
  pts.forEach(([x, z], i) => {
    const p = mAt(m, x, z);
    if (i === 0) m.g.moveTo(p.x, p.y);
    else m.g.lineTo(p.x, p.y);
  });
}

function mFill(m: Murti, pts: Pts, col: number, alpha = 1): void {
  m.g.fillStyle(m.t(col), alpha);
  mPath(m, pts);
  m.g.closePath();
  m.g.fillPath();
}

function mLine(m: Murti, pts: Pts, w: number, col: number, alpha = 1): void {
  m.g.lineStyle(w * S * m.k, m.t(col), alpha);
  mPath(m, pts);
  m.g.strokePath();
}

function mOval(m: Murti, x: number, z: number, w: number, h: number, col: number, alpha = 1): void {
  const p = mAt(m, x, z);
  m.g.fillStyle(m.t(col), alpha);
  m.g.fillEllipse(p.x, p.y, w * S * m.k, h * S * m.k, 18);
}

function bez(a: readonly [number, number], c: readonly [number, number], b: readonly [number, number], n = 8): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

// A limb through its joints, tapering from w0 to w1, rounded at each joint and shaded along its east edge.
function mLimb(m: Murti, pts: Pts, w0: number, w1: number, col: number): void {
  const n = pts.length - 1;
  const width = (i: number): number => w0 + ((w1 - w0) * i) / n;
  for (const [dx, tint] of [[0, shade(col, 0.22)], [-0.28, col]] as const) {
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a === undefined || b === undefined) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len;
      const nz = (b[0] - a[0]) / len;
      const wa = (width(i) / 2) * (dx === 0 ? 1 : 0.7);
      const wb = (width(i + 1) / 2) * (dx === 0 ? 1 : 0.7);
      mFill(m, [[a[0] + dx + nx * wa, a[1] + nz * wa], [b[0] + dx + nx * wb, b[1] + nz * wb], [b[0] + dx - nx * wb, b[1] - nz * wb], [a[0] + dx - nx * wa, a[1] - nz * wa]], tint);
    }
    pts.forEach(([x, z], i) => {
      const w = width(i) * (dx === 0 ? 1 : 0.7);
      mOval(m, x + dx, z, w, w, tint);
    });
  }
}

function mBand(m: Murti, pts: Pts, t: number, w: number): void {
  const a = pts[Math.floor(t)];
  const b = pts[Math.floor(t) + 1] ?? a;
  if (a === undefined || b === undefined) return;
  const f = t - Math.floor(t);
  mOval(m, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, w, w * 0.5, GOLD);
}

function mGarland(m: Murti, pts: Pts, r: number): void {
  marigolds(m.g, pts.map(([x, z]) => mAt(m, x, z)), r * m.k, m.t);
}

function mPetal(m: Murti, x: number, z: number, w: number, h: number, col: number): void {
  mFill(m, [...bez([x, z], [x - w, z + h * 0.45], [x, z + h], 6), ...bez([x, z + h], [x + w, z + h * 0.45], [x, z], 6)], col);
  mFill(m, [...bez([x, z + h], [x + w, z + h * 0.45], [x, z], 6), [x + w * 0.15, z + h * 0.5]], shade(col, 0.14));
}

// A lotus pitha under a murti's feet: a gilt drum, a ring of pink petals and a gold seat rim.
function lotusSeat(m: Murti, hw: number): void {
  mFill(m, [[-hw * 0.75, -6.5], [hw * 0.75, -6.5], [hw * 0.82, -4.4], [-hw * 0.82, -4.4]], shade(GOLD, 0.15));
  mFill(m, [[-hw * 0.75, -6.5], [-hw * 0.3, -6.5], [-hw * 0.34, -4.4], [-hw * 0.82, -4.4]], lit(GOLD, 0.2));
  mOval(m, 0, -6.5, hw * 1.5, 1.6, shade(GOLD, 0.35));
  for (let i = -3; i <= 3; i++) mPetal(m, i * hw * 0.28, -3.6, hw * 0.2, 4.2, lit(LOTUS, 0.25));
  for (let i = -2.5; i <= 2.5; i++) mPetal(m, i * hw * 0.34, -5.2, hw * 0.22, 5, i < 0 ? LOTUS : shade(LOTUS, 0.08));
  mOval(m, 0, 0, hw * 1.7, 2.2, shade(GOLD, 0.1));
  mOval(m, -0.3, 0.2, hw * 1.5, 1.5, lit(GOLD, 0.15));
}

// A gold halo behind a murti's head: a ring of little flames round a deep red disc.
function prabha(m: Murti, x: number, z: number, r: number): void {
  for (let i = 0; i <= 12; i++) {
    const a = -0.35 + ((Math.PI + 0.7) * i) / 12;
    const c = Math.cos(a);
    const s = Math.sin(a);
    mFill(m, [[x + c * (r - 0.6) - s * 0.9, z + s * (r - 0.6) + c * 0.9], [x + c * (r + 1.5), z + s * (r + 1.5)], [x + c * (r - 0.6) + s * 0.9, z + s * (r - 0.6) - c * 0.9]], GOLD);
  }
  mOval(m, x, z, r * 2, r * 2, GOLD);
  mOval(m, x, z, r * 2 - 1.4, r * 2 - 1.4, 0x8a2a1a);
  mOval(m, x, z, r * 2 - 3, r * 2 - 3, 0xa83a1e);
}

function hairBack(m: Murti, x: number, z: number): void {
  mFill(m, [[x - 3, z + 2], [x - 3.6, z - 1.5], [x - 4.6, z - 5.6], [x - 3.8, z - 7.4], [x - 2.2, z - 5.6], [x + 2.2, z - 5.6], [x + 3.8, z - 7.4], [x + 4.6, z - 5.6], [x + 3.6, z - 1.5], [x + 3, z + 2]], HAIR);
}

// A serene face: almond eyes under fine brows, a gentle smile, a Vaishnava tilak and gold kundalas.
function murtiFace(m: Murti, x: number, z: number, skin: number): void {
  mFill(m, [[x - 1, z - 4.6], [x + 1, z - 4.6], [x + 1.1, z - 2], [x - 1.1, z - 2]], shade(skin, 0.12));
  mOval(m, x, z, 5.8, 7, shade(skin, 0.2));
  mOval(m, x - 0.4, z + 0.1, 5, 6.7, skin);
  mOval(m, x - 1.3, z - 0.6, 1.4, 1.2, lit(skin, 0.12), 0.7);
  for (const d of [-1, 1]) {
    const ex = x + d * 1.25;
    mFill(m, [[ex - 1, z + 0.36], [ex, z + 0.7], [ex + 1, z + 0.36], [ex, z]], EYE_WHITE);
    mOval(m, ex, z + 0.28, 0.6, 0.56, HAIR);
    mFill(m, [[ex - 1.05, z + 0.38], [ex, z + 0.82], [ex + 1.05, z + 0.38], [ex, z + 0.62]], shade(skin, 0.18));
    mLine(m, [[ex - 1.05, z + 0.38], [ex, z + 0.62], [ex + 1.05, z + 0.38]], 0.3, HAIR);
    mLine(m, [[ex + d * 1, z + 1.25], [ex + d * 0.15, z + 1.75], [ex - d * 0.85, z + 1.6]], 0.24, shade(skin, 0.5));
  }
  mLine(m, [[x + 0.15, z + 0.4], [x + 0.35, z - 0.9], [x - 0.1, z - 1.05]], 0.3, shade(skin, 0.3));
  mLine(m, [[x - 0.75, z - 1.8], [x, z - 2.1], [x + 0.75, z - 1.8]], 0.42, LIPS);
  mOval(m, x, z - 2.35, 0.8, 0.3, lit(LIPS, 0.15), 0.8);
  mLine(m, [[x - 0.55, z + 1.7], [x - 0.6, z + 3.2]], 0.36, SANDAL);
  mLine(m, [[x + 0.55, z + 1.7], [x + 0.6, z + 3.2]], 0.36, SANDAL);
  mLine(m, [[x - 0.6, z + 1.7], [x, z + 1.35], [x + 0.6, z + 1.7]], 0.36, SANDAL);
  mLine(m, [[x, z + 1.6], [x, z + 3.2]], 0.36, KUMKUM);
  for (const d of [-1, 1]) {
    mOval(m, x + d * 2.95, z - 1.8, 1.3, 1.9, shade(GOLD, 0.1));
    mOval(m, x + d * 2.95 - 0.2, z - 1.6, 0.6, 0.8, lit(GOLD, 0.4));
  }
}

// A gold crown rising from a jewelled band: Ram's pointed mukut, Vishnu's tall tiered kirita, Krishna's low crown and feather.
function mukut(m: Murti, x: number, z: number, kind: Exclude<Deity, 'shivling'>): void {
  const base = z + 2.6;
  if (kind === 'vishnu') {
    for (const d of [-1, 1]) mFill(m, [[x + d * 2.6, base + 0.4], [x + d * 4.6, base + 2.2], [x + d * 4.2, base + 4.2], [x + d * 2.6, base + 3.4]], shade(GOLD, 0.06));
    mFill(m, [[x - 3.1, base], [x + 3.1, base], [x + 2.5, base + 9], [x + 1.4, base + 10.6], [x, base + 11.4], [x - 1.4, base + 10.6], [x - 2.5, base + 9]], GOLD);
    mFill(m, [[x + 1, base], [x + 3.1, base], [x + 2.5, base + 9], [x + 1.4, base + 10.6], [x + 0.7, base + 10.9]], shade(GOLD, 0.2));
    for (let t = 1; t < 9; t += 2) mLine(m, [[x - 3.05 + t * 0.065, base + t], [x + 3.05 - t * 0.065, base + t]], 0.45, lit(GOLD, 0.35));
    mOval(m, x, base + 4.2, 1.6, 2.2, KUMKUM);
    mOval(m, x - 0.3, base + 4.5, 0.6, 0.7, lit(KUMKUM, 0.5));
    mFill(m, [[x - 0.5, base + 11], [x + 0.5, base + 11], [x, base + 13.4]], lit(GOLD, 0.2));
  } else if (kind === 'ram') {
    for (const d of [-1, 1]) mFill(m, [[x + d * 2.7, base + 0.6], [x + d * 4.2, base + 2.6], [x + d * 3.4, base + 4.2], [x + d * 2.5, base + 3]], shade(GOLD, 0.06));
    mFill(m, [[x - 3.1, base], [x + 3.1, base], [x + 2.6, base + 4.8], [x + 1.2, base + 7.4], [x, base + 9], [x - 1.2, base + 7.4], [x - 2.6, base + 4.8]], GOLD);
    mFill(m, [[x + 1, base], [x + 3.1, base], [x + 2.6, base + 4.8], [x + 1.2, base + 7.4], [x + 0.6, base + 8.2]], shade(GOLD, 0.2));
    mLine(m, [[x - 2.9, base + 1.6], [x + 2.9, base + 1.6]], 0.45, lit(GOLD, 0.35));
    mLine(m, [[x - 2.5, base + 4.6], [x + 2.5, base + 4.6]], 0.45, lit(GOLD, 0.35));
    mOval(m, x, base + 3.2, 1.5, 1.9, KUMKUM);
    mOval(m, x - 0.3, base + 3.5, 0.6, 0.6, lit(KUMKUM, 0.5));
    mOval(m, x, base + 9.4, 1, 1.2, lit(GOLD, 0.3));
  } else {
    const fx = x + 1.6;
    mLine(m, [[x + 0.6, base + 2.4], [fx + 0.8, base + 9]], 0.4, 0x8a9a3a);
    for (let i = -4; i <= 4; i++) mLine(m, [[fx + 0.9, base + 9.6], [fx + 0.9 + i * 0.55, base + 12.4 - Math.abs(i) * 0.35]], 0.3, 0x2f7a4a);
    mOval(m, fx + 0.9, base + 9.6, 4.2, 5.4, 0x2f8a4a);
    mOval(m, fx + 0.9, base + 9.4, 3, 4, 0xd8b030);
    mOval(m, fx + 0.9, base + 9.3, 2.2, 3, 0x2f9aa8);
    mOval(m, fx + 0.9, base + 9.1, 1.3, 1.8, 0x1a3a90);
    mFill(m, [[x - 3, base], [x + 3, base], [x + 2.6, base + 3.2], [x + 1.2, base + 4.6], [x - 1.2, base + 4.6], [x - 2.6, base + 3.2]], GOLD);
    mFill(m, [[x + 1, base], [x + 3, base], [x + 2.6, base + 3.2], [x + 1.2, base + 4.6], [x + 0.6, base + 4.6]], shade(GOLD, 0.2));
    mOval(m, x, base + 2.2, 1.3, 1.6, KUMKUM);
  }
  mFill(m, [[x - 3.2, z + 2.3], [x + 3.2, z + 2.3], [x + 3.1, z + 3.4], [x - 3.1, z + 3.4]], shade(GOLD, 0.15));
  for (let i = -2; i <= 2; i++) mOval(m, x + i * 1.2, z + 2.85, 0.5, 0.5, i === 0 ? 0x2fa860 : lit(GOLD, 0.4));
}

function torso(m: Murti, skin: number): void {
  const pts: Pts = [[-2.9, 21.5], [-3.3, 25], [-3.9, 28.5], [-4.4, 31], [-3.7, 32.6], [-1.3, 33.3], [1.3, 33.3], [3.7, 32.6], [4.4, 31], [3.9, 28.5], [3.3, 25], [2.9, 21.5]];
  mFill(m, [[-1.1, 32.6], [-1.1, 35.2], [1.1, 35.2], [1.1, 32.6]], shade(skin, 0.15));
  mFill(m, pts, shade(skin, 0.22));
  mFill(m, pts.map(([x, z]) => [x * 0.84 - 0.6, z] as const), skin);
  mLine(m, [[-2.6, 29.6], [-0.4, 29], [-0.1, 28.2]], 0.3, shade(skin, 0.2));
  mLine(m, [[2.2, 29.6], [0.4, 29], [0.1, 28.2]], 0.3, shade(skin, 0.25));
  mOval(m, 0, 24.4, 0.5, 0.5, shade(skin, 0.3));
  mLine(m, [[3.7, 32.6], [-0.6, 26.4], [-2.8, 21.8]], 0.32, SANDAL, 0.9);
}

// Pitambara dhoti from waist to ankle: a pleated front fall, a bordered hem and bare feet with anklets.
function dhoti(m: Murti, skin: number, cloth: number): void {
  for (const d of [-1, 1]) {
    mOval(m, d * 1.8, 0.55, 2.6, 1.4, shade(skin, 0.1));
    mLine(m, [[d * 1.8 - 1, 1.5], [d * 1.8 + 1, 1.5]], 0.5, GOLD);
  }
  const pts: Pts = [[-3.3, 22.8], [-3.8, 16], [-4.1, 8], [-4.3, 2.2], [-0.4, 2], [0, 4], [0.4, 2], [4.3, 2.2], [4.1, 8], [3.8, 16], [3.3, 22.8]];
  mFill(m, pts, shade(cloth, 0.16));
  mFill(m, pts.map(([x, z]) => [x * 0.86 - 0.5, z] as const), cloth);
  for (const x of [-2.6, 2]) mLine(m, [[x * 0.9, 20], [x, 6]], 0.3, shade(cloth, 0.22), 0.7);
  mFill(m, [[-1, 22], [1, 22], [1.5, 3.2], [-1.5, 3.2]], lit(cloth, 0.12));
  for (const x of [-0.6, 0.4]) mLine(m, [[x * 0.6, 21.5], [x * 1.4, 3.6]], 0.3, shade(cloth, 0.2));
  mLine(m, [[-1.5, 3.4], [1.5, 3.4]], 0.7, KUMKUM);
  for (const d of [-1, 1]) mLine(m, [[d * 4.25, 2.6], [d * 0.6, 2.4]], 0.7, KUMKUM);
}

function waistband(m: Murti, sash: number): void {
  mLine(m, [[-3.2, 22.6], [0, 22.2], [3.2, 22.6]], 1.2, GOLD);
  mOval(m, 0, 22.3, 1.3, 1.3, KUMKUM);
  mLine(m, bez([-3.4, 22], [0, 12], [3.4, 22], 10), 1.2, sash);
  mLine(m, bez([-3.4, 22.2], [0, 12.6], [3.4, 22.2], 10), 0.3, GOLD);
}

function sashEnds(m: Murti, sash: number): void {
  for (const d of [-1, 1]) mLimb(m, bez([d * 4.3, 23], [d * 5.4, 14], [d * 5, 5], 6), 1.3, 1, sash);
}

function necklaces(m: Murti, kaustubha = false): void {
  mLine(m, bez([-2.7, 32.6], [0, 29.4], [2.7, 32.6], 8), 0.9, GOLD);
  mLine(m, bez([-3.2, 32.2], [0, 25.4], [3.2, 32.2], 10), 0.35, lit(GOLD, 0.2));
  mOval(m, 0, 30.4, kaustubha ? 1.4 : 1, kaustubha ? 1.6 : 1.1, KUMKUM);
  mOval(m, 0, 27, 0.8, 0.9, 0x2fa860);
}

function garland(m: Murti, low: number): void {
  mGarland(m, [...bez([-3.5, 32], [-4.2, low + 4], [0, low], 8), ...bez([0, low], [4.2, low + 4], [3.5, 32], 8).slice(1)], 1.05);
}

function hand(m: Murti, x: number, z: number, skin: number): void {
  mOval(m, x, z, 1.9, 2.1, shade(skin, 0.1));
  mOval(m, x - 0.25, z + 0.15, 1.3, 1.6, skin);
}

function arm(m: Murti, pts: Pts, skin: number): void {
  mLimb(m, pts, 2.3, 1.6, skin);
  mBand(m, pts, 0.5, 2.5);
  mBand(m, pts, pts.length - 1.25, 2);
}

// Shri Ram: blue-green, crowned, in yellow pitambara and a saffron uttariya, the kodanda bow upright in his left hand.
function ramMurti(m: Murti): void {
  const { skin, sash } = MURTI_LOOK.ram;
  prabha(m, 0, 38.6, 6.8);
  mLimb(m, [[-2.2, 24], [-5.3, 37]], 2.6, 2.8, 0x8a4a22);
  mOval(m, -5.3, 37, 2.8, 1.4, shade(0x8a4a22, 0.3));
  for (const [dx, col] of [[-0.8, 0xf4ece0], [0, KUMKUM], [0.8, 0xf4ece0]] as const) mFill(m, [[-5.3 + dx - 0.4, 37.2], [-5.3 + dx + 0.4, 37.2], [-5.6 + dx * 1.3, 40.3]], col);
  hairBack(m, 0, 38.4);
  dhoti(m, skin, PITAMBAR);
  sashEnds(m, sash);
  torso(m, skin);
  waistband(m, sash);
  necklaces(m);
  garland(m, 11.5);
  const bow = 0xa8601e;
  const limb = [...bez([6.4, 0.8], [9.6, 10], [8, 22.4], 10), ...bez([8, 22.4], [9.6, 35], [6.4, 44], 10).slice(1)];
  mLine(m, [[6.4, 0.8], [6.4, 44]], 0.3, 0xf4ece0);
  mLine(m, limb, 1.7, shade(bow, 0.2));
  mLine(m, limb.map(([x, z]) => [x - 0.3, z] as const), 0.8, bow);
  mLine(m, limb.map(([x, z]) => [x - 0.6, z] as const), 0.35, lit(GOLD, 0.2));
  for (const z of [10, 35]) mLine(m, [[8.6, z - 0.8], [8.6, z + 0.8]], 1.6, GOLD);
  mLine(m, [[6.4, 0.8], [6, -0.3]], 0.9, GOLD);
  mLine(m, [[6.4, 44], [6, 45.1]], 0.9, GOLD);
  arm(m, [[4.3, 31], [6, 26], [7.3, 23.2]], skin);
  hand(m, 7.9, 22.6, skin);
  mLine(m, [[-6.6, 3.8], [-6.6, 31]], 0.45, 0xc89a5a);
  mFill(m, [[-7.4, 5.8], [-5.8, 5.8], [-6.6, 2.8]], 0xd8dce4);
  for (const dx of [-0.8, 0.8]) mFill(m, [[-6.6, 27.6], [-6.6 + dx, 28.4], [-6.6 + dx, 31.4], [-6.6, 30.6]], dx < 0 ? 0xf4ece0 : KUMKUM);
  arm(m, [[-4.3, 31], [-6.1, 25.6], [-6.5, 20.8]], skin);
  hand(m, -6.5, 20, skin);
  murtiFace(m, 0, 38.4, skin);
  mukut(m, 0, 38.4, 'ram');
}

function chakra(m: Murti, x: number, z: number, r: number): void {
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    mFill(m, [[x + c * r - s * 0.6, z + s * r + c * 0.6], [x + c * (r + 0.9), z + s * (r + 0.9)], [x + c * r + s * 0.6, z + s * r - c * 0.6]], lit(GOLD, 0.2));
  }
  mOval(m, x, z, r * 2, r * 2, GOLD);
  mOval(m, x, z, r * 1.45, r * 1.45, 0xc8641e);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    mLine(m, [[x, z], [x + Math.cos(a) * r * 0.75, z + Math.sin(a) * r * 0.75]], 0.3, lit(GOLD, 0.3));
  }
  mOval(m, x, z, r * 0.55, r * 0.55, GOLD);
  mOval(m, x, z, r * 0.25, r * 0.25, KUMKUM);
}

function shankha(m: Murti, x: number, z: number): void {
  const shell = 0xf6f0e4;
  const body: Pts = [[x - 1.5, z + 1.2], [x - 0.6, z + 2.4], [x + 0.9, z + 2.2], [x + 1.7, z + 0.9], [x + 1.4, z - 0.9], [x + 0.4, z - 2.2], [x - 0.2, z - 3], [x - 0.6, z - 1.8], [x - 1.4, z - 0.4]];
  mFill(m, body, shade(shell, 0.18));
  mFill(m, body.map(([px, pz]) => [x + (px - x) * 0.82 - 0.25, z + (pz - z) * 0.9] as const), shell);
  mFill(m, [[x + 0.3, z + 1.4], [x + 1.3, z + 0.6], [x + 1, z - 0.9], [x + 0.2, z - 1.8]], 0xe8b0a0);
  for (const [a, b] of [[[x - 1.3, z + 1], [x + 0.7, z + 2]], [[x - 1.2, z + 0.1], [x + 0.2, z + 1.3]]] as const) mLine(m, [a, b], 0.25, shade(shell, 0.3));
  mLine(m, [[x - 1.5, z + 1.4], [x - 0.4, z + 2.5]], 0.5, GOLD);
}

function gada(m: Murti, x: number, z: number): void {
  mLine(m, [[x, 0.2], [x, z - 1.6]], 0.9, shade(GOLD, 0.25));
  mLine(m, [[x - 0.15, 0.2], [x - 0.15, z - 1.6]], 0.3, lit(GOLD, 0.2));
  mOval(m, x, z, 5, 5.4, shade(GOLD, 0.22));
  mOval(m, x - 0.4, z + 0.3, 4.1, 4.5, GOLD);
  mOval(m, x - 0.9, z + 0.9, 1.1, 1.2, lit(GOLD, 0.5));
  mLine(m, [[x - 2, z - 0.4], [x + 2, z - 0.4]], 0.4, KUMKUM);
  mOval(m, x, z + 2.6, 1, 1, GOLD);
}

// Shri Vishnu: blue, under a tall kirita, four arms bearing the chakra, shankha, gada and padma.
function vishnuMurti(m: Murti): void {
  const { skin, sash } = MURTI_LOOK.vishnu;
  prabha(m, 0, 39.4, 6.6);
  for (const d of [-1, 1]) {
    arm(m, [[d * 3.3, 31.4], [d * 6.6, 29.6], [d * 7, 35]], skin);
    hand(m, d * 7, 35.9, skin);
  }
  chakra(m, -7.1, 39.6, 2.3);
  shankha(m, 7.3, 38.6);
  hairBack(m, 0, 38.4);
  dhoti(m, skin, PITAMBAR);
  sashEnds(m, sash);
  torso(m, skin);
  waistband(m, sash);
  necklaces(m, true);
  garland(m, 9);
  gada(m, 7.2, 22.6);
  arm(m, [[4.3, 31], [5.8, 25.5], [6.6, 21.6]], skin);
  hand(m, 6.8, 20.8, skin);
  arm(m, [[-4.3, 31], [-5.7, 25.6], [-5.5, 21.2]], skin);
  hand(m, -5.5, 20.4, skin);
  lotusAt(m.g, mAt(m, -5.5, 21.6), 2.6 * m.k, LOTUS, m.t);
  murtiFace(m, 0, 38.4, skin);
  mukut(m, 0, 38.4, 'vishnu');
}

// Shri Krishna: blue, in the easy cross-legged stance, a peacock feather in his crown, the bansuri at his lips.
function krishnaMurti(m: Murti): void {
  const { skin, sash } = MURTI_LOOK.krishna;
  const up: Murti = { ...m, lean: -0.07 };
  prabha(up, -0.3, 38.6, 6.6);
  hairBack(up, -0.3, 38.4);
  mOval(m, 1, 0.6, 2.6, 1.4, shade(skin, 0.1));
  mFill(m, [[3, 0.4], [4.4, 0.6], [4.2, 2.4], [3.2, 2.2]], shade(skin, 0.1));
  mLine(m, [[0, 1.5], [2, 1.5]], 0.5, GOLD);
  mLine(m, [[3, 2.4], [4.4, 2.6]], 0.5, GOLD);
  const pts: Pts = [[-2.6, 22.8], [-3.4, 16], [-2.4, 9], [-0.6, 2.4], [2.4, 2.2], [3.4, 3], [4.8, 3.4], [4.6, 9], [4.6, 16], [4, 22.8]];
  mFill(m, pts, shade(PITAMBAR, 0.16));
  mFill(m, pts.map(([x, z]) => [x * 0.86 - 0.2, z] as const), PITAMBAR);
  mFill(m, [...bez([-3.2, 15], [0.8, 10], [4.6, 3.3], 8), [2.6, 2.6], ...bez([1.8, 4], [-0.6, 10], [-3, 12.4], 6)], shade(PITAMBAR, 0.1));
  mLine(m, bez([-3.2, 15], [0.8, 10], [4.6, 3.3], 8), 0.35, shade(PITAMBAR, 0.3));
  mFill(m, [[-0.2, 22], [1.8, 22], [1.4, 13.5], [0.2, 13]], lit(PITAMBAR, 0.12));
  mLine(m, [[-0.6, 2.5], [2.4, 2.3], [4.8, 3.5]], 0.7, KUMKUM);
  for (const d of [-1, 1]) mLimb(m, bez([0.7 + d * 3.8, 23], [0.7 + d * 4.8, 14], [0.7 + d * 4.4, 6], 6), 1.3, 1, sash);
  torso(up, skin);
  mLine(up, [[-2.6, 22.6], [0.3, 22.2], [3.2, 22.6]], 1.2, GOLD);
  mLine(up, bez([-3.2, 22], [0.6, 13], [4, 22], 10), 1.2, sash);
  necklaces(up);
  garland(up, 10);
  arm(up, [[-4.3, 31], [-7.4, 29], [-8, 34.6]], skin);
  arm(up, [[4.3, 31], [4.4, 26.4], [-1.6, 35.1]], skin);
  murtiFace(up, -0.3, 38.4, skin);
  mukut(up, -0.3, 38.4, 'krishna');
  mLine(up, [[0.4, 36.3], [-11.6, 35.6]], 1, 0x9a5a28);
  mLine(up, [[0.4, 36.55], [-11.6, 35.85]], 0.3, lit(0xc8904a, 0.2));
  for (const x of [-0.2, -10.8]) mLine(up, [[x, 35.6], [x, 37]], 0.6, GOLD);
  for (let x = -5; x > -10; x -= 1.4) mOval(up, x, 35.95, 0.4, 0.4, 0x3a1a0a);
  mLine(up, [[-10.4, 35.6], [-10.6, 32.6], [-10.2, 31.4]], 0.4, KUMKUM);
  hand(up, -8.2, 35.6, skin);
  hand(up, -3.4, 35.7, skin);
}

// A black Shivling on a yoni spouting west, tripundra and bilva on it, under a copper kalash dripping water.
function shivlingMurti(m: Murti): void {
  const stone = 0x2a2a32;
  const rim = 0x4a4a58;
  const drum = (z0: number, z1: number, rx: number, ry: number, top: number): void => {
    mOval(m, 0, z0, rx * 2, ry * 2, shade(stone, 0.1));
    mFill(m, [[-rx, z0], [rx, z0], [rx, z1], [-rx, z1]], shade(stone, 0.1));
    mFill(m, [[-rx, z0], [-rx * 0.35, z0 - ry * 0.9], [-rx * 0.35, z1 - ry * 0.9], [-rx, z1]], lit(stone, 0.14));
    mOval(m, 0, z1, rx * 2, ry * 2, top);
  };
  for (const dx of [-2.4, 0, 2.4]) mLine(m, [[dx, 45.6], [0, 60]], 0.3, shade(COPPER, 0.3));
  mOval(m, 0, 41.4, 7.2, 6.4, shade(COPPER, 0.2));
  mOval(m, -0.4, 41.7, 6.2, 5.6, COPPER);
  mOval(m, -1.6, 42.6, 1.6, 1.8, lit(COPPER, 0.5), 0.8);
  mFill(m, [[-1.6, 44], [1.6, 44], [1.3, 45.4], [-1.3, 45.4]], shade(COPPER, 0.1));
  mOval(m, 0, 45.4, 3.4, 1.2, lit(COPPER, 0.2));
  mLine(m, [[-3.4, 41.2], [3.4, 41.2]], 0.4, KUMKUM);
  mFill(m, [[-0.5, 38.4], [0.5, 38.4], [0.2, 37], [-0.2, 37]], shade(COPPER, 0.25));
  for (let z = 35.6; z > 24; z -= 2.6) mOval(m, 0, z, 0.55, 1.3, 0xb8e0f4, 0.85);
  drum(0, 2.4, 5.4, 2.4, rim);
  mOval(m, 0, 2.4, 9, 3.6, shade(stone, 0.05));
  drum(2.4, 5, 7, 3, rim);
  const spout: Pts = [[-4.6, 6.6], [-9.6, 9.2], [-10, 8.2], [-6.2, 5.2]];
  mFill(m, spout.map(([x, z]) => [x, z - 1.8] as const), shade(stone, 0.05));
  mFill(m, [[-6.2, 3.4], [-10, 6.4], [-10, 8.2], [-6.2, 5.2]], lit(stone, 0.1));
  mFill(m, spout, rim);
  mLine(m, [[-5.2, 6.4], [-9.5, 8.6]], 0.45, 0x9ad0ec, 0.8);
  mOval(m, 0, 5.1, 11.6, 4.6, stone);
  mOval(m, 0, 5.2, 9.6, 3.8, 0x3a3a46);
  mFill(m, [[-4, 5.6], [-4, 16], [4, 16], [4, 5.6]], stone);
  mOval(m, 0, 5.6, 8, 3, stone);
  mOval(m, 0, 16, 8, 8.4, stone);
  mFill(m, [[-3.6, 6], [-3.6, 16], [-1.8, 16], [-1.8, 6]], lit(stone, 0.1));
  mOval(m, -1.8, 17, 3.4, 4.6, lit(stone, 0.1));
  mLine(m, [[-2.3, 7.6], [-2.3, 16.8]], 0.55, 0x8a8a9e, 0.75);
  mOval(m, -1.8, 18.6, 1.4, 0.9, 0xa0a0b4, 0.7);
  mLine(m, [[0.8, 19.8], [0.9, 13], [0.7, 7]], 0.35, 0x9ad0ec, 0.55);
  for (const dz of [-1.4, 0, 1.4]) mLine(m, bez([-3.7, 12.6 + dz], [0, 11.5 + dz], [3.7, 12.6 + dz], 8), 0.66, VIBHUTI);
  mOval(m, 0, 12, 1.4, 1.4, KUMKUM);
  const bilva = (x: number, z: number, a: number, r: number): void => {
    for (const da of [-0.8, 0, 0.8]) leaf(m.g, mAt(m, x, z), a + da, (da === 0 ? 4 : 3.2) * r * m.k, 1.3 * r * m.k, m.t(BILVA.light), m.t(BILVA.dark));
  };
  bilva(-1, 19.6, -0.6, 0.9);
  bilva(-5.6, 5.6, -2.6, 0.8);
  bilva(5.2, 4.6, -0.3, 0.8);
  mGarland(m, bez([-4.4, 6.2], [0, 2.2], [4.4, 6.2], 10), 0.8);
  for (const [x, z, r] of [[1.6, 20.2, 1.2], [-4.6, 3.6, 1], [3.4, 3.2, 1], [6.2, 5.6, 0.9]] as const) {
    const p = mAt(m, x, z);
    blossom(m.g, p.x, p.y, r * m.k, m.t(0xfaf8f0));
  }
}

function murti(m: Murti, deity: Deity): void {
  if (deity !== 'shivling') lotusSeat(m, 7);
  if (deity === 'ram') ramMurti(m);
  else if (deity === 'vishnu') vishnuMurti(m);
  else if (deity === 'krishna') krishnaMurti(m);
  else shivlingMurti(m);
}

// A black stone Nandi lying on the sanctum step in profile, west of the door, gazing at the lingam.
function nandi(g: G, x: number, y: number, z: number): void {
  const base = P(x, y, z);
  const k = 0.72 * S;
  const at = (a: number, h: number, s = 0): Pt => ({ x: base.x + (a - s * 0.5) * k, y: base.y - (h - s * 0.4) * k });
  const shape = (pts: Pts, col: number, s = 0): void => {
    g.fillStyle(col, 1);
    g.beginPath();
    pts.forEach(([a, h], i) => {
      const p = at(a, h, s);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    });
    g.closePath();
    g.fillPath();
  };
  const stroke = (pts: Pts, w: number, col: number): void => {
    g.lineStyle(w * k, col, 1);
    g.beginPath();
    pts.forEach(([a, h], i) => {
      const p = at(a, h);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    });
    g.strokePath();
  };
  const stone = 0x4a4a56;
  const body: Pts = [[-6.5, 0], [-7.2, 2.6], [-6.8, 5.2], [-5, 6.4], [-1, 6.4], [1, 7.2], [2.4, 9.8], [4, 9.4], [5.4, 9.4], [6.4, 11], [7.6, 11.2], [8.6, 9.6], [10, 7.6], [9.8, 6.2], [8.2, 5.8], [6.4, 4.6], [5.4, 2.4], [6, 0.4]];
  floorEllipse(g, x + 0.02, y, 0.16, SHADOW, 0.3, z);
  shape(body, shade(stone, 0.3), 2);
  for (const [a, h, col] of [[6.2, 10.8, shade(stone, 0.3)], [7.2, 10.9, 0x9a9aa6]] as const) stroke([[a, h - 0.4], [a - 0.8, h + 1.8], [a - 0.2, h + 3.2], [a + 0.6, h + 3.6]], 1.1, col);
  shape(body, stone);
  shape([[-5, 6.4], [-1, 6.4], [1, 7.2], [2.4, 9.8], [4, 9.4], [3.4, 7.8], [-1, 5.5], [-5, 5.4]], lit(stone, 0.16));
  shape([[8.6, 9.6], [10, 7.6], [9.8, 6.2], [8.6, 6.2], [8.2, 8.2]], lit(stone, 0.22));
  shape([[-6.2, 0.4], [-6.6, 3], [-5.4, 4.8], [-3, 4.6], [-2, 2.6], [-3, 0.4]], lit(stone, 0.08));
  shape([[2.2, 0.2], [2.8, 1.8], [6.2, 2], [6.4, 0.4]], lit(stone, 0.1));
  stroke([[-6.9, 4], [-7.6, 1.6], [-6.2, 0.3], [-4.4, 0.4]], 0.7, shade(stone, 0.2));
  shape([[-3.4, 6.4], [1.2, 7], [1.8, 2.8], [-3.2, 2.6]], KUMKUM);
  stroke([[-3.2, 2.6], [1.8, 2.8]], 0.9, GOLD);
  stroke([[1.2, 7], [1.8, 2.8]], 0.6, GOLD);
  shape([[6.6, 9.8], [4.2, 10], [3.8, 9.4], [6.2, 9]], shade(stone, 0.25));
  shape([[6.2, 9.7], [4.6, 9.8], [6, 9.3]], 0x8a5a5a);
  const eye = at(7.8, 9.4);
  g.fillStyle(0x1a1a20, 1);
  g.fillCircle(eye.x, eye.y, 0.6 * k);
  marigolds(g, [at(4.6, 8.8), at(5.2, 6.8), at(5.8, 4.8)], 1.1 * 0.72);
}

// A small carved shrine beside the sanctum: a murti in an arched, lamplit niche under a little ribbed shikhara.
function sideShrine(g: G, f: Furniture, layout: RoomLayout, rand: () => number, deity: Deity | null): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const am = (s.a0 + s.a1) / 2;
  const b0 = s.b0;
  const [gx, gy] = xy(fr, am, s.b1 - 0.1);
  for (const [r, alpha] of [[1.3, 0.04], [0.8, 0.06], [0.45, 0.08]] as const) floorPool(g, gx, gy, r, WARM, alpha, { x1: layout.w - 1, y1: layout.d - 1 });
  contact(g, f.c + 0.04, f.r + 0.02, f.c + f.w - 0.04, f.r + f.d - 0.3, 0.22);
  const pb = b0 + 0.6;
  box(g, fr, s.a0 + 0.06, b0, s.a1 - 0.06, pb, 0, 7, shade(MARBLE_WHITE, 0.05), lit(MARBLE_WHITE, 0.3));
  plate(g, fr, pb + 0.002, s.a0 + 0.06, s.a1 - 0.06, 2.4, 3.8, tone(fr, KUMKUM));
  plate(g, fr, pb + 0.002, s.a0 + 0.06, s.a1 - 0.06, 5.8, 7, tone(fr, GOLD), 0.8);
  const fb = b0 + 0.34;
  const tint = (col: number): number => tone(fr, col);
  const face = (u0: number, u1: number, z0: number, z1: number, col: number, alpha = 1, d = 0.002): void => {
    plate(g, fr, fb + d, u0, u1, z0, z1, tint(col), alpha);
  };
  const arch = (hw: number, z0: number, z1: number, col: number, alpha = 1, d = 0.002): void => {
    poly(g, fr, fb + d, windowOutline(am - hw, am + hw, z0, z1, true), tint(col), alpha);
  };
  const at = (u: number, z: number, d = 0.004): Pt => fp(fr, u, fb + d, z);
  const top = 84;
  box(g, fr, am - 0.42, b0, am + 0.42, fb, 7, top - 7, SANDSTONE, lit(SANDSTONE, 0.25));
  face(am - 0.42, am + 0.42, 7, 10, lit(SANDSTONE, 0.25));
  face(am - 0.42, am + 0.42, 12, 13.4, KUMKUM, 0.85);
  for (const u of [am - 0.4, am + 0.32]) {
    face(u, u + 0.08, 14, top - 6, lit(SANDSTONE, 0.14));
    face(u + 0.03, u + 0.05, 17, top - 9, shade(SANDSTONE, 0.16));
  }
  arch(0.33, 11, 73, shade(SANDSTONE, 0.18));
  arch(0.3, 11, 70, GOLD);
  arch(0.28, 11, 68, 0x3a1a10);
  arch(0.24, 12, 64, 0x6a2a12, 0.7);
  arch(0.16, 12, 54, 0xe07a2a, 0.35);
  for (let z = 15; z < 60; z += 5) {
    for (const u of [am - 0.315, am + 0.315]) {
      const p = at(u, z);
      g.fillStyle(tint(GOLD), 1);
      g.fillCircle(p.x, p.y, 1.1 * S);
    }
  }
  if (deity !== null) {
    const k = 0.74;
    murti({ g, o: at(am, 12 + 6.5 * k), k, t: tint }, deity);
  } else {
    arch(0.28, 11, 68, 0xb8282e, 1, 0.005);
    for (const du of [-0.14, 0, 0.14]) face(am + du - 0.01, am + du + 0.01, 12, 60, shade(0xb8282e, 0.25), 0.7, 0.006);
  }
  diyaAt(g, at(am + 0.05, 11.4, 0.04), 0.6);
  face(am - 0.36, am + 0.36, 9, 12, lit(SANDSTONE, 0.3), 1, 0.009);
  marigolds(g, swag(at(am - 0.3, 74, 0.012), at(am + 0.3, 74, 0.012), 6), 1.8, tint);
  for (const u of [am - 0.3, am + 0.3]) garlandDrop(g, at(u, 74, 0.012), 12, 0.8, tint);
  box(g, fr, am - 0.46, b0, am + 0.46, fb + 0.04, top, 5, SANDSTONE, lit(SANDSTONE, 0.3));
  plate(g, fr, fb + 0.042, am - 0.46, am + 0.46, top + 1.5, top + 3, tone(fr, KUMKUM));
  const levels = 11;
  const band = 3.4;
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1);
    const storey = i % 4 === 3;
    const hw = 0.4 * (1 - 0.62 * Math.pow(t, 1.8)) + (storey ? 0.02 : 0);
    const bd = 0.3 - 0.1 * t;
    const z = top + 5 + i * band;
    const col = storey ? shade(SANDSTONE, 0.1) : i % 2 === 0 ? SANDSTONE : shade(SANDSTONE, 0.04);
    box(g, fr, am - hw, b0, am + hw, b0 + bd, z, band, col, lit(col, 0.35));
    box(g, fr, am - hw * 0.5, b0, am + hw * 0.5, b0 + bd + 0.02, z, band, lit(col, 0.06), lit(col, 0.4));
  }
  const crown = top + 5 + levels * band;
  const [kx, ky] = xy(fr, am, b0 + 0.14);
  tube(g, kx, ky, 0.1, 0.13, crown, 2, SANDSTONE, null, 12);
  tube(g, kx, ky, 0.13, 0.13, crown + 2, 3, SANDSTONE, null, 12, true);
  tube(g, kx, ky, 0.13, 0.08, crown + 5, 2, SANDSTONE, lit(SANDSTONE, 0.3), 12);
  tube(g, kx, ky, 0.04, 0.06, crown + 7, 3, GOLD, null, 8);
  tube(g, kx, ky, 0.02, 0, crown + 10, 6, GOLD, null, 6);
  for (const ta of [0.15, 0.85]) diyaAt(g, fp(fr, s.a0 + ta, b0 + 0.48, 7), 0.75);
  for (let i = 0; i < 4; i++) {
    const p = fp(fr, am + (rand() - 0.5) * 0.5, b0 + 0.44 + rand() * 0.12, 7);
    blossom(g, p.x, p.y - 1.2 * S, 1.5, i % 2 === 0 ? KUMKUM : MARIGOLDS[i % 2] ?? SAFFRON);
  }
}

// Which side murti a side shrine holds: the first stands left of the sanctum, the second right of it.
function sideDeity(f: Furniture, layout: RoomLayout, seed: number): Deity | null {
  const main = layout.furniture.find((o) => o.piece === 'sanctum');
  const sides = shrineOf(seed)?.sides ?? [];
  return (main === undefined ? null : sides[f.c < main.c ? 0 : 1]) ?? null;
}

// A rangoli in bright powder colours on the floor: a lotus of pointed petals in rings of scallops and white dots.
function rangoli(g: G, f: Furniture, rand: () => number): void {
  const cx = f.c + f.w / 2;
  const cy = f.r + f.d / 2;
  const R = Math.min(f.w, f.d) / 2 - 0.1;
  const z = 0.4;
  const pal = RANGOLI[Math.floor(rand() * RANGOLI.length)] ?? RANGOLI[0];
  const chalk = 0xfaf6ec;
  const at = (r: number, t: number, ox = cx, oy = cy, rr = R): Pt => P(ox + Math.cos(t) * r * rr, oy + Math.sin(t) * r * rr, z);
  const disc = (r: number, col: number, ox = cx, oy = cy, rr = R): void => {
    const pts: Pt[] = [];
    for (let i = 0; i < 40; i++) pts.push(at(r, (i / 40) * Math.PI * 2, ox, oy, rr));
    fan(g, col, pts);
  };
  const petal = (r0: number, r1: number, t: number, w: number, col: number, ox = cx, oy = cy, rr = R): void => {
    const m = r0 + (r1 - r0) * 0.45;
    fan(g, col, [at(r0, t, ox, oy, rr), at(m, t - w, ox, oy, rr), at(r1, t, ox, oy, rr), at(m, t + w, ox, oy, rr)]);
  };
  fan(g, SHADOW, quad(cx - R * 0.98, cy - R * 0.98, cx + R * 0.98, cy + R * 0.98), 0.04);
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const ox = cx + dx * R * 0.86;
    const oy = cy + dy * R * 0.86;
    for (let i = 0; i < 4; i++) petal(0.1, 1, (i / 4) * Math.PI * 2 + Math.PI / 4, 0.5, chalk, ox, oy, 0.16);
    for (let i = 0; i < 4; i++) petal(0.15, 0.85, (i / 4) * Math.PI * 2 + Math.PI / 4, 0.4, pal.scallop, ox, oy, 0.16);
    disc(0.3, pal.centre, ox, oy, 0.16);
  }
  disc(1, chalk);
  disc(0.965, pal.ring);
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    fan(g, chalk, [at(0.66, t - 0.2), at(0.9, t - 0.15), at(0.97, t), at(0.9, t + 0.15), at(0.66, t + 0.2)]);
    fan(g, pal.scallop, [at(0.69, t - 0.16), at(0.88, t - 0.11), at(0.935, t), at(0.88, t + 0.11), at(0.69, t + 0.16)]);
  }
  disc(0.7, chalk);
  disc(0.67, pal.leaf);
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    petal(0.18, 0.56, t, 0.24, chalk);
    petal(0.21, 0.51, t, 0.17, pal.inner);
  }
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2 + Math.PI / 8;
    petal(0.16, 0.7, t, 0.3, chalk);
    petal(0.2, 0.64, t, 0.24, pal.petal);
    petal(0.28, 0.54, t, 0.1, lit(pal.petal, 0.45));
  }
  disc(0.24, chalk);
  disc(0.21, pal.inner);
  disc(0.13, pal.centre);
  disc(0.05, chalk);
  for (let i = 0; i < 32; i++) {
    const p = at(1.06, (i / 32) * Math.PI * 2);
    g.fillStyle(chalk, 1);
    g.fillEllipse(p.x, p.y, 2.6 * S, 1.5 * S, 8);
  }
  for (let i = 0; i < 16; i++) {
    const p = at(0.8, (i / 16) * Math.PI * 2 + Math.PI / 16);
    g.fillStyle(chalk, 1);
    g.fillEllipse(p.x, p.y, 2 * S, 1.2 * S, 8);
  }
  for (let i = 0; i < 40; i++) {
    const p = at(rand() * 1.05, rand() * Math.PI * 2);
    g.fillStyle(WHITE, 0.18);
    g.fillCircle(p.x, p.y, 0.8 * S);
  }
}

// A brass ghanta on a short chain from a carved teak post with a curling brass bracket, its clapper and red tassel at hand height.
function ghanta(g: G, f: Furniture, layout: RoomLayout): void {
  const fr = frameOf(f, layout);
  const s = span(f, fr);
  const am = (s.a0 + s.a1) / 2;
  const bp = s.b0 + 0.2;
  const bb = s.b0 + 0.64;
  const [px, py] = xy(fr, am, bp);
  const [x, y] = xy(fr, am, bb);
  const top = 118;
  const lip = 62;
  floorEllipse(g, px + 0.08, py + 0.03, 0.2, SHADOW, 0.22);
  floorEllipse(g, x + 0.1, y + 0.04, 0.16, SHADOW, 0.1);
  box(g, fr, am - 0.15, bp - 0.15, am + 0.15, bp + 0.15, 0, 6, SANDSTONE, lit(SANDSTONE, 0.25));
  box(g, fr, am - 0.1, bp - 0.1, am + 0.1, bp + 0.1, 6, 5, shade(TEAK, 0.1), lit(TEAK, 0.2));
  box(g, fr, am - 0.055, bp - 0.055, am + 0.055, bp + 0.055, 11, top - 11, TEAK, lit(TEAK, 0.2));
  for (const z of [26, 60, top - 16]) box(g, fr, am - 0.07, bp - 0.07, am + 0.07, bp + 0.07, z, 3, BRASS, lit(BRASS, 0.3));
  box(g, fr, am - 0.08, bp - 0.08, am + 0.08, bp + 0.08, top, 4, TEAK, lit(TEAK, 0.25));
  tube(g, px, py, 0.04, 0.0, top + 4, 8, BRASS, null, 6);
  const arm: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    arm.push(fp(fr, am, bp + (bb + 0.04 - bp) * t, top - 6 + 5 * Math.sin(t * Math.PI * 0.8)));
  }
  const curl: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = -Math.PI / 2 + (i / 10) * Math.PI * 1.6;
    curl.push(fp(fr, am, bb + 0.04 + Math.cos(t) * 0.05, top - 4 + 1.6 + Math.sin(t) * 3.4));
  }
  line(g, fp(fr, am, bp + 0.03, top - 28), fp(fr, am, bp + 0.22, top - 6), 1.8 * S, shade(BRASS, 0.2));
  strokePath(g, [...arm, ...curl], 3.2 * S, shade(BRASS, 0.25));
  strokePath(g, [...arm, ...curl], 1.4 * S, lit(BRASS, 0.35));
  const tint = (c: number): number => c;
  marigolds(g, swag(fp(fr, am, bp + 0.03, top - 9), fp(fr, am, bp + 0.3, top - 4), 10, 10), 1.9, tint);
  garlandDrop(g, fp(fr, am, bp + 0.03, top - 9), 10, 0.8);
  for (let z = top - 6; z > lip + 31; z -= 3.6) {
    const p = P(x, y, z);
    g.lineStyle(1.2 * S, shade(BRASS, 0.2), 1);
    if (Math.round((top - z) / 3.6) % 2 === 0) g.strokeEllipse(p.x, p.y, 2.6 * S, 4 * S, 8);
    else line(g, { x: p.x, y: p.y - 2 * S }, { x: p.x, y: p.y + 2 * S }, 1.4 * S, lit(BRASS, 0.1));
  }
  const ball = P(x, y, lip - 6);
  line(g, P(x, y, lip + 10), ball, 1.6 * S, shade(BRASS, 0.45));
  const cord = P(x, y, 38);
  line(g, ball, cord, 1.6 * S, KUMKUM);
  g.fillStyle(shade(BRASS, 0.4), 1);
  g.fillCircle(ball.x, ball.y, 3 * S);
  g.fillStyle(lit(BRASS, 0.2), 1);
  g.fillCircle(ball.x - 0.9 * S, ball.y - 0.9 * S, 1.2 * S);
  g.fillStyle(SAFFRON, 1);
  g.fillCircle(cord.x, cord.y, 2.2 * S);
  fan(g, KUMKUM, [{ x: cord.x - 1.8 * S, y: cord.y + 1 * S }, { x: cord.x + 1.8 * S, y: cord.y + 1 * S }, { x: cord.x + 3.2 * S, y: cord.y + 10 * S }, { x: cord.x - 3.2 * S, y: cord.y + 10 * S }]);
  for (const dx of [-1.8, 0, 1.8]) line(g, { x: cord.x + dx * 0.6 * S, y: cord.y + 2 * S }, { x: cord.x + dx * S, y: cord.y + 9.5 * S }, 1, shade(KUMKUM, 0.3), 0.7);
  for (let i = 0; i < GHANTA.length - 1; i++) {
    const [z0, r0] = GHANTA[i] ?? [0, 0.17];
    const [z1, r1] = GHANTA[i + 1] ?? [29, 0.03];
    tube(g, x, y, r0, r1, lip + z0, z1 - z0, i === 0 ? lit(BRASS, 0.1) : BRASS, null, 16);
  }
  floorEllipse(g, x, y, 0.035, shade(BRASS, 0.1), 1, lip + 29);
  const loop = P(x, y, lip + 32);
  g.lineStyle(1.4 * S, shade(BRASS, 0.15), 1);
  g.strokeEllipse(loop.x, loop.y, 3 * S, 4.4 * S, 10);
  strokePath(g, nearArc(x, y, 0.198, lip + 1), 2.2 * S, lit(BRASS, 0.5), 0.95);
  strokePath(g, nearArc(x, y, 0.16, lip + 4.4), 1.2 * S, shade(BRASS, 0.3), 0.7);
  for (const z of [12, 20]) strokePath(g, nearArc(x, y, 0.128, lip + z), 1.4 * S, lit(BRASS, 0.35), 0.8);
  fan(g, WHITE, [P(x - 0.12, y + 0.08, lip + 4), P(x - 0.08, y + 0.1, lip + 4), P(x - 0.06, y + 0.06, lip + 22), P(x - 0.08, y + 0.04, lip + 22)], 0.35);
}

// A carved sandstone pillar: a moulded base, a square shaft with lotus panels, an octagonal drum wound with marigolds,
// a pot-and-foliage neck and a cross-bracket capital carrying the beam.
function stonePillar(g: G, f: Furniture): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const st = SANDSTONE;
  const tint = (c: number): number => c;
  fan(g, SHADOW, [P(x - 0.3, y - 0.3), P(x + 0.9, y - 0.2), P(x + 1, y + 0.3), P(x - 0.3, y + 0.42)], 0.12);
  prism(g, x - 0.4, y - 0.4, x + 0.4, y + 0.4, 0, 6, shade(st, 0.08), lit(st, 0.2));
  prism(g, x - 0.34, y - 0.34, x + 0.34, y + 0.34, 6, 5, st, lit(st, 0.25));
  fan(g, KUMKUM, [P(x - 0.34, y + 0.341, 8.2), P(x + 0.34, y + 0.341, 8.2), P(x + 0.34, y + 0.341, 9.6), P(x - 0.34, y + 0.341, 9.6)], 0.85);
  fan(g, shade(KUMKUM, 0.3), [P(x + 0.341, y + 0.34, 8.2), P(x + 0.341, y - 0.34, 8.2), P(x + 0.341, y - 0.34, 9.6), P(x + 0.341, y + 0.34, 9.6)], 0.85);
  prism(g, x - 0.3, y - 0.3, x + 0.3, y + 0.3, 11, 4, shade(st, 0.05), lit(st, 0.25));
  const sq = 0.23;
  prism(g, x - sq, y - sq, x + sq, y + sq, 15, 35, st, lit(st, 0.25));
  fan(g, shade(st, 0.12), [P(x - 0.16, y + sq + 0.001, 19), P(x + 0.16, y + sq + 0.001, 19), P(x + 0.16, y + sq + 0.001, 46), P(x - 0.16, y + sq + 0.001, 46)]);
  fan(g, shade(st, 0.48), [P(x + sq + 0.001, y + 0.16, 19), P(x + sq + 0.001, y - 0.16, 19), P(x + sq + 0.001, y - 0.16, 46), P(x + sq + 0.001, y + 0.16, 46)]);
  lotusAt(g, P(x, y + sq + 0.002, 30), 6, LOTUS, tint);
  fan(g, shade(st, 0.3), [P(x + sq + 0.002, y, 26), P(x + sq + 0.002, y - 0.1, 32), P(x + sq + 0.002, y, 40), P(x + sq + 0.002, y + 0.1, 32)]);
  fan(g, KUMKUM, [P(x - sq, y + sq + 0.002, 42), P(x + sq, y + sq + 0.002, 42), P(x + sq, y + sq + 0.002, 43.4), P(x - sq, y + sq + 0.002, 43.4)]);
  fan(g, shade(KUMKUM, 0.3), [P(x + sq + 0.002, y + sq, 42), P(x + sq + 0.002, y - sq, 42), P(x + sq + 0.002, y - sq, 43.4), P(x + sq + 0.002, y + sq, 43.4)]);
  prism(g, x - 0.27, y - 0.27, x + 0.27, y + 0.27, 50, 4, lit(st, 0.08), lit(st, 0.3));
  tube(g, x, y, 0.22, 0.22, 54, 26, st, null, 8, true);
  tube(g, x, y, 0.25, 0.25, 80, 4, st, lit(st, 0.3), 16);
  tube(g, x, y, 0.18, 0.18, 84, 12, st, null, 14);
  tube(g, x, y, 0.18, 0.27, 96, 6, st, null, 16);
  tube(g, x, y, 0.27, 0.2, 102, 5, st, lit(st, 0.25), 16);
  for (let i = 0; i <= 4; i++) {
    const t = -Math.PI / 4 + (Math.PI * (i + 0.5)) / 5;
    const p = P(x + Math.cos(t) * 0.27, y + Math.sin(t) * 0.27, 101);
    fan(g, i < 2 ? lit(st, 0.08) : shade(st, 0.12), [{ x: p.x - 4 * S, y: p.y }, { x: p.x + 4 * S, y: p.y }, { x: p.x + 2.6 * S, y: p.y + 6 * S }, { x: p.x, y: p.y + 9 * S }, { x: p.x - 2.6 * S, y: p.y + 6 * S }]);
    line(g, { x: p.x, y: p.y + 1 * S }, { x: p.x, y: p.y + 7.5 * S }, 1, shade(st, 0.3), 0.6);
  }
  tube(g, x, y, 0.16, 0.16, 107, 3, shade(st, 0.05), null, 12);
  prism(g, x - 0.26, y - 0.26, x + 0.26, y + 0.26, 110, 4, st, lit(st, 0.3));
  const arm = 0.6;
  const w = 0.13;
  const bz = 114;
  const bh = 9;
  prism(g, x - arm, y - w, x - w, y + w, bz, bh, st, lit(st, 0.3));
  prism(g, x - w, y - arm, x + w, y - w, bz, bh, st, lit(st, 0.3));
  prism(g, x - w, y - w, x + w, y + w, bz, bh, st, lit(st, 0.3));
  prism(g, x + w, y - w, x + arm, y + w, bz, bh, st, lit(st, 0.3));
  prism(g, x - w, y + w, x + w, y + arm, bz, bh, st, lit(st, 0.3));
  prism(g, x + arm - 0.12, y - 0.07, x + arm - 0.02, y + 0.07, bz - 5, 5, shade(st, 0.05));
  prism(g, x - 0.07, y + arm - 0.12, x + 0.07, y + arm - 0.02, bz - 5, 5, shade(st, 0.05));
  fan(g, shade(st, 0.25), [P(x - w, y + arm + 0.001, bz + 3), P(x + w, y + arm + 0.001, bz + 3), P(x + w, y + arm + 0.001, bz + 4.5), P(x - w, y + arm + 0.001, bz + 4.5)]);
  prism(g, x - 0.3, y - 0.3, x + 0.3, y + 0.3, bz + bh, 6, lit(st, 0.04), lit(st, 0.3));
  fan(g, KUMKUM, [P(x - 0.3, y + 0.301, bz + bh + 2), P(x + 0.3, y + 0.301, bz + bh + 2), P(x + 0.3, y + 0.301, bz + bh + 3.4), P(x - 0.3, y + 0.301, bz + bh + 3.4)], 0.85);
  marigolds(g, nearArc(x, y, 0.235, 74, 16), 2);
  const loop: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = -Math.PI / 4 + (Math.PI * i) / 16;
    loop.push(P(x + Math.cos(t) * 0.24, y + Math.sin(t) * 0.24, 74 - 12 * Math.sin((t + Math.PI / 4))));
  }
  marigolds(g, loop, 2, tint, 1);
}

// A tulsi vrindavan: a whitewashed square planter edged in red ochre with a diya niche and corner horns, holding a bushy tulsi.
function tulsi(g: G, f: Furniture, rand: () => number): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const white = 0xf6eee0;
  const ochre = 0xb8483a;
  contact(g, x - 0.42, y - 0.42, x + 0.42, y + 0.42, 0.22);
  prism(g, x - 0.4, y - 0.4, x + 0.4, y + 0.4, 0, 5, SANDSTONE, lit(SANDSTONE, 0.25));
  prism(g, x - 0.34, y - 0.34, x + 0.34, y + 0.34, 5, 4, shade(white, 0.04), white);
  const r = 0.3;
  prism(g, x - r, y - r, x + r, y + r, 9, 30, white);
  const band = (z0: number, z1: number): void => {
    fan(g, ochre, [P(x - r, y + r + 0.001, z0), P(x + r, y + r + 0.001, z0), P(x + r, y + r + 0.001, z1), P(x - r, y + r + 0.001, z1)]);
    fan(g, shade(ochre, 0.3), [P(x + r + 0.001, y + r, z0), P(x + r + 0.001, y - r, z0), P(x + r + 0.001, y - r, z1), P(x + r + 0.001, y + r, z1)]);
  };
  band(9, 12);
  band(35, 39);
  const arch = (pl: (u: number, z: number) => Pt, z0: number, z1: number, hw: number, col: number): void => {
    fan(g, col, windowOutline(-hw, hw, z0, z1, true).map(([u, z]) => pl(u, z)));
  };
  const south = (u: number, z: number): Pt => P(x + u, y + r + 0.002, z);
  const east = (u: number, z: number): Pt => P(x + r + 0.002, y - u, z);
  arch(south, 14, 32, 0.12, ochre);
  arch(south, 15, 30, 0.095, 0x4a2010);
  arch(south, 15, 26, 0.07, WARM);
  fan(g, WARM, windowOutline(-0.095, 0.095, 15, 30, true).map(([u, z]) => south(u, z)), 0.25);
  diyaAt(g, P(x - 0.01, y + r + 0.02, 15), 0.7);
  arch(east, 16, 30, 0.1, shade(ochre, 0.3));
  arch(east, 17.5, 28.5, 0.075, shade(white, 0.38));
  lotusAt(g, east(0, 21), 4.5, shade(LOTUS, 0.3));
  prism(g, x - 0.35, y - 0.35, x + 0.35, y + 0.35, 39, 4, white, lit(white, 0.3));
  fan(g, 0x5a3a26, quad(x - 0.27, y - 0.27, x + 0.27, y + 0.27, 43.1));
  const horn = (hx: number, hy: number): void => {
    prism(g, hx - 0.05, hy - 0.05, hx + 0.05, hy + 0.05, 43, 4, white, lit(white, 0.3));
    const apex = P(hx, hy, 55);
    fan(g, lit(white, 0.05), [P(hx - 0.05, hy + 0.05, 47), P(hx + 0.05, hy + 0.05, 47), apex]);
    fan(g, shade(white, 0.3), [P(hx + 0.05, hy + 0.05, 47), P(hx + 0.05, hy - 0.05, 47), apex]);
    const tip = P(hx, hy, 55);
    g.fillStyle(ochre, 1);
    g.fillCircle(tip.x, tip.y, 1.3 * S);
  };
  horn(x - 0.29, y - 0.29);
  horn(x + 0.29, y - 0.29);
  horn(x - 0.29, y + 0.29);
  const soil = P(x, y, 43);
  for (const [dx, h] of [[-3, 24], [1, 30], [4, 22]] as const) line(g, soil, { x: soil.x + dx * S, y: soil.y - h * S }, 1.6 * S, 0x6a3a4a);
  const leaves: { x: number; y: number; k: number }[] = [];
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand());
    leaves.push({ x: Math.cos(a) * d * 14, y: -20 + Math.sin(a) * d * 13, k: rand() });
  }
  leaves.sort((p, q) => p.y - q.y);
  for (const p of leaves) {
    const side = Math.max(0, Math.min(1, (p.x + 14) / 28));
    const base = p.k < 0.25 ? 0x5a6a3a : mix(0x7ab84e, 0x3a6a30, side * 0.8);
    g.fillStyle(shade(base, 0.25), 1);
    g.fillEllipse(soil.x + (p.x + 0.6) * S, soil.y + (p.y + 0.8) * S, 4.4 * S, 2.8 * S, 8);
    g.fillStyle(base, 1);
    g.fillEllipse(soil.x + p.x * S, soil.y + p.y * S, 4 * S, 2.5 * S, 8);
  }
  for (let i = 0; i < 7; i++) {
    const sx = soil.x + (rand() - 0.5) * 20 * S;
    const sy = soil.y - (24 + rand() * 6) * S;
    const len = (7 + rand() * 5) * S;
    line(g, { x: sx, y: sy }, { x: sx, y: sy - len }, 1.2 * S, 0x6a3a5a);
    for (let k = 0; k < 4; k++) {
      g.fillStyle(0x9a5a9a, 1);
      g.fillCircle(sx, sy - len * (0.3 + k * 0.22), 1 * S);
    }
  }
  horn(x + 0.29, y + 0.29);
}

// A tall brass deepastambha: a domed foot, a ringed stem and tiers of oil cups each ringed with little flames, under a lotus bud.
function deepastambha(g: G, f: Furniture, layout: RoomLayout): void {
  const x = f.c + f.w / 2;
  const y = f.r + f.d / 2;
  const bounds = { x1: layout.w - 1, y1: layout.d - 1 };
  for (const [r, alpha] of [[2.2, 0.045], [1.6, 0.05], [1.05, 0.06], [0.6, 0.08]] as const) floorPool(g, x, y, r, WARM, alpha, bounds);
  for (const [z, r] of [[40, 40], [62, 34], [80, 28]] as const) {
    const c = P(x, y, z);
    g.fillStyle(WARM, 0.07);
    g.fillCircle(c.x, c.y - 4 * S, r * S);
  }
  floorEllipse(g, x + 0.08, y + 0.03, 0.28, SHADOW, 0.25);
  tube(g, x, y, 0.28, 0.26, 0, 3, shade(BRASS, 0.1), lit(BRASS, 0.2), 18);
  tube(g, x, y, 0.23, 0.09, 3, 10, BRASS, null, 16);
  tube(g, x, y, 0.1, 0.1, 13, 2, lit(BRASS, 0.1), lit(BRASS, 0.3), 12);
  const tiers = [[38, 0.25, 7], [60, 0.19, 6], [78, 0.13, 5]] as const;
  let from = 15;
  for (const [z, r, n] of tiers) {
    tube(g, x, y, 0.035, 0.035, from, z - from - 4, BRASS, null, 4);
    for (let k = from + 10; k < z - 8; k += 12) tube(g, x, y, 0.06, 0.06, k, 3, lit(BRASS, 0.05), lit(BRASS, 0.3), 10);
    tube(g, x, y, r * 0.3, r, z - 4, 4, BRASS, null, 16);
    floorEllipse(g, x, y, r, lit(BRASS, 0.25), 1, z);
    floorEllipse(g, x, y, r * 0.82, 0x6a3a10, 1, z + 0.1);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + 0.3;
      flameAt(g, P(x + Math.cos(t) * r * 0.86, y + Math.sin(t) * r * 0.86, z + 0.5), 0.85);
    }
    from = z;
  }
  tube(g, x, y, 0.035, 0.035, from, 10, BRASS, null, 4);
  tube(g, x, y, 0.05, 0.09, from + 10, 4, BRASS, null, 10);
  tube(g, x, y, 0.09, 0, from + 14, 12, BRASS, null, 10);
  const tip = P(x, y, from + 26);
  g.fillStyle(lit(BRASS, 0.3), 1);
  g.fillCircle(tip.x, tip.y, 1.4 * S);
  line(g, P(x - 0.02, y + 0.02, 18), P(x - 0.02, y + 0.02, 76), 1, lit(BRASS, 0.5), 0.5);
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
      bookcase(g, f, layout, room, rand);
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
      displayCase(g, f, layout, room, trade, rand);
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
    case 'cabinet':
      cabinet(g, f, layout, rand);
      return;
    case 'candles':
      candles(g, f, layout, rand);
      return;
    case 'bell':
      if (room === 'mandir') ghanta(g, f, layout);
      else bell(g, f, layout);
      return;
    case 'cushion':
      cushion(g, f, layout, rand);
      return;
    case 'pool':
      pool(g, f, layout, rand);
      return;
    case 'sanctum':
      sanctum(g, f, layout, rand, shrineOf(seed));
      return;
    case 'sideShrine':
      sideShrine(g, f, layout, rand, sideDeity(f, layout, seed));
      return;
    case 'rangoli':
      rangoli(g, f, rand);
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
  if (f.piece === 'rangoli') return { x: f.c - 0.5, y: f.r - 0.5 };
  if (f.piece === 'pool') return { x: f.c + f.w / 2, y: f.r + f.d / 2 };
  if (layout !== undefined && frameOf(f, layout) === 'e') return { x: f.c, y: f.r + f.d };
  return f.w >= f.d ? { x: f.c, y: f.r + f.d } : { x: f.c + f.w, y: f.r };
}
