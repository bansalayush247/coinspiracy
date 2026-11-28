// Port Concord's cars as illustrated models: each body is lofted from stations along its length (bonnet, windscreen,
// roof, rear glass, boot), lit from the upper left, and dressed with lamps, grilles, glass, trim and wheels. Parked
// and driven cars stay inside the body the server collides with; only ambient buses are longer.
import type Phaser from 'phaser';
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '@byzantine-council/shared/city';
import { P, fan } from '../beach/beachArt.js';
import { ART_SCALE, TILE_W } from '../game/iso.js';
import { lit, mix, shade } from '../game/palette.js';

type G = Phaser.GameObjects.Graphics;
type UV = readonly [number, number];
type Q = readonly [number, number];
type V3 = readonly [number, number, number];
interface Pt {
  readonly x: number;
  readonly y: number;
}

export type CarStyle = 'sedan' | 'hatch' | 'suv' | 'van' | 'pickup' | 'taxi' | 'bus';

/** Paints for ambient traffic: everyday metallics, a few brights and some dark tones. */
export const CAR_PAINTS = [
  0xd9534f, 0x4f8fd9, 0xe9e2d6, 0x3b3f4a, 0x5fb87a, 0x8a5fd9, 0xf08a4b, 0xa7b3c6,
  0x2c4f7a, 0x8e3a30, 0x6f8a6a, 0xd8c8a8, 0x2f7a7a, 0xc84a7a, 0x5a5a62, 0xf2efe8,
] as const;

const GLASS = 0x1a2631;
const SKY = 0xb4d2e2;
const GLASS_LIT = 0x5d7c92;
const TYRE = 0x16141b;
const TYRE_LIT = 0x3a3742;
const WELL = 0x0e0c12;
const RIM = 0xc9ccd4;
const TRIM = 0x232129;
const PLASTIC = 0x34333b;
const CHROME = 0xe4e8ee;
const LENS = 0x2b3341;
const LED = 0xfff6da;
const PROJECTOR = 0xdce9ff;
const TAIL = 0xff3b4a;
const TAIL_DEEP = 0x8a1826;
const AMBER = 0xffa53a;
const PLATE = 0xf4f0e2;
const PLATE_TAXI = 0xf6d23a;
const TAXI_YELLOW = 0xf2c230;
const TAXI_SIGN = 0xfff3c4;
const BED = 0x3a3640;
const SHADOW = 0x1e1426;
const SPEC = 0xfffaf0;
const BUS_HALF_LENGTH = 1.45;
const BUS_HALF_WIDTH = 0.42;
const HATCH_HALF_LENGTH = 0.66;
const Z_PER_TILE = ((TILE_W / 2) * Math.SQRT2 * Math.cos(Math.PI / 6)) / ART_SCALE;
const CAM = [0.612, 0.612, 0.5] as const;
const SUN = [-0.5, 0.5, 0.71] as const;
const HALFWAY = ((): V3 => {
  const x = SUN[0] + CAM[0];
  const y = SUN[1] + CAM[1];
  const z = SUN[2] + CAM[2];
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
})();
const RING = 20;
const CIRCLE = Array.from({ length: RING }, (_, k) => [Math.cos((k * 2 * Math.PI) / RING), Math.sin((k * 2 * Math.PI) / RING)] as const);

// The eight server car colours, each with the body it is always built as, so every screen agrees.
const BY_COLOR: ReadonlyMap<number, CarStyle> = new Map([
  [0xd9534f, 'hatch'], [0x4f8fd9, 'sedan'], [0xf0c05a, 'taxi'], [0x5fb87a, 'suv'],
  [0xe9e2d6, 'van'], [0x8a5fd9, 'sedan'], [0x3b3f4a, 'pickup'], [0xf08a4b, 'hatch'],
]);
const FALLBACK: readonly CarStyle[] = ['sedan', 'hatch', 'suv', 'van', 'pickup'];

// What the surface from one station to the next is: painted body, windscreen, roof over side glass, roof over a
// painted side, rear glass, a painted rear door, or a pickup's load bed.
type Seg = 'body' | 'screen' | 'cabin' | 'panel' | 'rear' | 'door' | 'bed';
type Key = readonly [u: number, ze: number, zc: number, zr: number, seg: Seg];

interface Spec {
  readonly hl: number;
  readonly hw: number;
  readonly w: number;
  readonly ru: Q;
  readonly rv: number;
  readonly lean: Q;
  readonly z0: number;
  readonly si: number;
  readonly sz: number;
  readonly gi: number;
  readonly nose: Q;
  readonly tail: Q;
  readonly keys: readonly Key[];
  readonly R: number;
  readonly axles: Q;
  readonly bumpF: Q;
  readonly bumpR: Q;
  readonly bumpOff: number;
  readonly pillarB: number;
}
interface Station {
  readonly u: number;
  readonly ut: number;
  readonly w: number;
  readonly ze: number;
  readonly zr: number;
  readonly zc: number;
  readonly seg: Seg;
  readonly tub: boolean;
}
type RimKind = 'alloy' | 'steel' | 'hubcap';
interface Rim {
  readonly kind: RimKind;
  readonly metal: number;
  readonly spokes: number;
}

function nth<T>(a: readonly T[], i: number): T {
  const x = a[i];
  if (x === undefined) throw new RangeError(`car art: no item ${i}`);
  return x;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// Real-world proportions per body: stations run nose to tail as [u, belt height, crown height, roof edge (0 = none), surface to the next].
function specOf(style: CarStyle): Spec {
  const hl = CAR_HALF_LENGTH;
  const hw = CAR_HALF_WIDTH;
  switch (style) {
    case 'hatch': {
      const h = HATCH_HALF_LENGTH;
      return {
        hl: h, hw: hw - 0.02, w: 0.33, ru: [0.09, 0.07], rv: 0.1, lean: [0.03, 0.012], z0: 3.6, si: 0.02, sz: 0.45, gi: 0.08,
        nose: [10.3, 10.9], tail: [12.4, 12.9], R: 3.9, axles: [0.42, -0.43], bumpF: [2.9, 7.6], bumpR: [2.9, 7.9], bumpOff: 0.014, pillarB: -0.1,
        keys: [
          [h - 0.09, 10.9, 11.5, 0, 'body'], [0.42, 11.2, 11.8, 0, 'body'], [0.31, 11.6, 12.1, 0, 'screen'],
          [0.19, 11.7, 17.4, 16.6, 'screen'], [0.07, 11.8, 19.9, 19.1, 'cabin'], [-0.43, 12.3, 19.4, 18.6, 'rear'],
          [-0.52, 12.5, 16.0, 15.3, 'rear'], [-(h - 0.07), 12.7, 13.3, 0, 'body'],
        ],
      };
    }
    case 'suv':
      return {
        hl, hw, w: 0.37, ru: [0.09, 0.09], rv: 0.09, lean: [0.025, 0.01], z0: 4.6, si: 0.02, sz: 0.5, gi: 0.07,
        nose: [12.8, 13.4], tail: [15.0, 15.5], R: 4.6, axles: [0.47, -0.47], bumpF: [3.6, 9.0], bumpR: [3.6, 9.0], bumpOff: 0.016, pillarB: -0.06,
        keys: [
          [hl - 0.09, 13.5, 14.0, 0, 'body'], [0.47, 13.9, 14.4, 0, 'body'], [0.33, 14.2, 14.7, 0, 'screen'],
          [0.22, 14.3, 20.6, 19.9, 'screen'], [0.12, 14.4, 23.1, 22.4, 'cabin'], [-0.62, 15.0, 23.0, 22.3, 'rear'],
          [-0.645, 15.1, 18.9, 18.3, 'rear'], [-(hl - 0.09), 15.2, 15.8, 0, 'body'],
        ],
      };
    case 'van':
      return {
        hl, hw, w: 0.37, ru: [0.1, 0.07], rv: 0.08, lean: [0.04, 0.004], z0: 3.8, si: 0.015, sz: 0.4, gi: 0.022,
        nose: [11.6, 12.2], tail: [13.6, 14.0], R: 4.1, axles: [0.5, -0.47], bumpF: [3.0, 7.6], bumpR: [3.0, 7.0], bumpOff: 0.016, pillarB: 0.06,
        keys: [
          [hl - 0.1, 12.5, 13.0, 0, 'body'], [0.55, 13.0, 13.5, 0, 'screen'], [0.45, 13.2, 19.6, 18.8, 'screen'],
          [0.3, 13.4, 24.9, 24.1, 'cabin'], [0.06, 13.5, 25.5, 24.7, 'panel'], [-0.66, 13.8, 25.5, 24.7, 'door'],
          [-(hl - 0.07), 13.9, 14.4, 0, 'body'],
        ],
      };
    case 'pickup':
      return {
        hl, hw, w: 0.37, ru: [0.08, 0.05], rv: 0.07, lean: [0.02, 0], z0: 4.6, si: 0.02, sz: 0.5, gi: 0.07,
        nose: [13.2, 13.7], tail: [15.0, 15.5], R: 4.6, axles: [0.47, -0.42], bumpF: [3.6, 9.2], bumpR: [3.8, 7.4], bumpOff: 0.02, pillarB: -0.04,
        keys: [
          [hl - 0.08, 13.7, 14.1, 0, 'body'], [0.47, 14.1, 14.6, 0, 'body'], [0.34, 14.4, 14.8, 0, 'screen'],
          [0.24, 14.5, 20.4, 19.7, 'screen'], [0.15, 14.6, 22.3, 21.7, 'cabin'], [-0.2, 14.8, 22.3, 21.7, 'rear'],
          [-0.23, 14.9, 15.4, 0, 'bed'], [-(hl - 0.05), 15.0, 15.5, 0, 'body'],
        ],
      };
    case 'taxi':
      return {
        hl, hw, w: 0.34, ru: [0.13, 0.12], rv: 0.12, lean: [0.02, 0.01], z0: 3.6, si: 0.02, sz: 0.5, gi: 0.08,
        nose: [10.4, 11.2], tail: [11.8, 12.4], R: 3.8, axles: [0.47, -0.44], bumpF: [3.2, 6.6], bumpR: [3.2, 6.6], bumpOff: 0.03, pillarB: -0.1,
        keys: [
          [hl - 0.13, 10.9, 11.7, 0, 'body'], [0.47, 11.2, 12.0, 0, 'body'], [0.3, 11.5, 12.1, 0, 'screen'],
          [0.2, 11.6, 17.6, 16.8, 'screen'], [0.1, 11.7, 19.7, 18.7, 'cabin'], [-0.3, 11.9, 19.6, 18.6, 'rear'],
          [-0.4, 12.0, 16.4, 15.7, 'rear'], [-0.48, 12.1, 12.9, 0, 'body'], [-(hl - 0.12), 12.2, 12.8, 0, 'body'],
        ],
      };
    case 'bus': {
      const h = BUS_HALF_LENGTH;
      return {
        hl: h, hw: BUS_HALF_WIDTH, w: BUS_HALF_WIDTH, ru: [0.07, 0.07], rv: 0.07, lean: [0.012, 0.006], z0: 3.4, si: 0.012, sz: 0.3, gi: 0.025,
        nose: [12.4, 12.8], tail: [12.4, 12.8], R: 5, axles: [h - 0.58, -h + 0.66], bumpF: [2.8, 6.0], bumpR: [2.8, 6.0], bumpOff: 0.014, pillarB: 0,
        keys: [
          [h - 0.07, 12.5, 12.9, 0, 'screen'], [h - 0.085, 12.6, 25.9, 25.4, 'screen'], [h - 0.12, 12.6, 29.2, 28.4, 'cabin'],
          [-h + 0.1, 12.6, 29.2, 28.4, 'door'], [-(h - 0.07), 12.6, 13.0, 0, 'body'],
        ],
      };
    }
    default:
      return {
        hl, hw, w: 0.34, ru: [0.11, 0.09], rv: 0.1, lean: [0.035, 0.018], z0: 3.6, si: 0.02, sz: 0.45, gi: 0.085,
        nose: [10.0, 10.6], tail: [12.0, 12.5], R: 4, axles: [0.46, -0.44], bumpF: [2.9, 7.4], bumpR: [2.9, 7.7], bumpOff: 0.014, pillarB: -0.08,
        keys: [
          [hl - 0.11, 10.6, 11.1, 0, 'body'], [0.46, 11.0, 11.5, 0, 'body'], [0.32, 11.4, 11.9, 0, 'screen'],
          [0.19, 11.5, 16.6, 15.8, 'screen'], [0.08, 11.6, 18.7, 17.9, 'cabin'], [-0.32, 11.9, 18.5, 17.7, 'rear'],
          [-0.44, 12.1, 15.3, 14.6, 'rear'], [-0.53, 12.2, 12.9, 0, 'body'], [-(hl - 0.09), 12.3, 12.8, 0, 'body'],
        ],
      };
  }
}

const reachOf = (sp: Spec): number => (sp.R * (1 + 0.8 / 3.9)) / Z_PER_TILE;

// Stations nose to tail: rounded plan corners at both ends, then the profile; stations over a wheel arch ride the body's straight top edge.
function stationsOf(sp: Spec): Station[] {
  const first = nth(sp.keys, 0);
  const last = nth(sp.keys, sp.keys.length - 1);
  const reach = reachOf(sp) + 0.012;
  const out: Station[] = [];
  for (const k of [0, 1, 2]) {
    const f = (k * Math.PI) / 6;
    const u = sp.hl - sp.ru[0] + sp.ru[0] * Math.cos(f);
    out.push({ u, ut: u - sp.lean[0] * Math.cos(f), w: sp.w - sp.rv + sp.rv * Math.sin(f), ze: lerp(sp.nose[0], first[1], k / 3), zr: 0, zc: lerp(sp.nose[1], first[2], k / 3), seg: 'body', tub: true });
  }
  sp.keys.forEach(([u0, ze, zc, zr, seg], i) => {
    const end = i === 0 || i === sp.keys.length - 1;
    const u = i === 0 ? sp.hl - sp.ru[0] : i === sp.keys.length - 1 ? -sp.hl + sp.ru[1] : u0;
    out.push({ u, ut: u, w: sp.w, ze, zr, zc, seg, tub: end || sp.axles.every((a) => Math.abs(u - a) > reach) });
  });
  for (const k of [2, 1, 0]) {
    const f = (k * Math.PI) / 6;
    const u = -sp.hl + sp.ru[1] - sp.ru[1] * Math.cos(f);
    out.push({ u, ut: u + sp.lean[1] * Math.cos(f), w: sp.w - sp.rv + sp.rv * Math.sin(f), ze: lerp(sp.tail[0], last[1], k / 3), zr: 0, zc: lerp(sp.tail[1], last[2], k / 3), seg: 'body', tub: true });
  }
  return out.map((st, i) => {
    if (st.tub) return st;
    let a = i - 1;
    let b = i + 1;
    while (!nth(out, a).tub) a--;
    while (!nth(out, b).tub) b++;
    const sa = nth(out, a);
    const sb = nth(out, b);
    return { ...st, ze: lerp(sa.ze, sb.ze, (sa.u - st.u) / (sa.u - sb.u)) };
  });
}

function rimOf(style: CarStyle): Rim {
  switch (style) {
    case 'van':
      return { kind: 'steel', metal: 0xb4b8c0, spokes: 5 };
    case 'bus':
      return { kind: 'steel', metal: 0xd2d5da, spokes: 8 };
    case 'taxi':
      return { kind: 'hubcap', metal: 0xdadde3, spokes: 10 };
    case 'suv':
      return { kind: 'alloy', metal: 0x8b9099, spokes: 6 };
    case 'pickup':
      return { kind: 'alloy', metal: 0xaeb2ba, spokes: 6 };
    default:
      return { kind: 'alloy', metal: RIM, spokes: 5 };
  }
}

/** The body a parked or driven car in `color` is built as. */
export function styleForColor(color: number): CarStyle {
  return BY_COLOR.get(color) ?? FALLBACK[(color >>> 4) % FALLBACK.length] ?? 'sedan';
}

/** Half the length of a car of `style`, for spacing ambient traffic. */
export function carHalfLength(style: CarStyle): number {
  return specOf(style).hl;
}

/** Half the width of a car of `style`, for keeping ambient traffic out of player cars. */
export function carHalfWidth(style: CarStyle): number {
  return specOf(style).hw;
}

// A filled outline that may be concave, such as a curved sail or a hull's plan.
function fillPoly(g: G, pts: readonly Pt[]): void {
  const [first, ...rest] = pts;
  if (first === undefined) return;
  g.beginPath();
  g.moveTo(first.x, first.y);
  for (const p of rest) g.lineTo(p.x, p.y);
  g.closePath();
  g.fillPath();
}

// A footprint with its corners cut, so the body reads round rather than boxy.
function rounded(u0: number, v0: number, u1: number, v1: number, cut: number): UV[] {
  return [
    [u0 + cut, v0], [u1 - cut, v0], [u1, v0 + cut], [u1, v1 - cut],
    [u1 - cut, v1], [u0 + cut, v1], [u0, v1 - cut], [u0, v0 + cut],
  ];
}

// Sutherland–Hodgman against one axis-aligned edge; works for concave outlines such as a side with its wheel-arch notch.
function clip(poly: readonly Q[], axis: 0 | 1, bound: number, below: boolean): Q[] {
  const out: Q[] = [];
  const inside = (p: Q): boolean => (below ? p[axis] <= bound : p[axis] >= bound);
  for (let i = 0; i < poly.length; i++) {
    const a = nth(poly, i);
    const b = nth(poly, (i + 1) % poly.length);
    const ia = inside(a);
    if (ia) out.push(a);
    if (ia !== inside(b)) {
      const t = (bound - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

const clipBox = (poly: readonly Q[], x0: number, x1: number, y0: number, y1: number): Q[] =>
  clip(clip(clip(clip(poly, 0, x0, false), 0, x1, true), 1, y0, false), 1, y1, true);

const rect = (x0: number, y0: number, x1: number, y1: number): Q[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 12): Q[] =>
  Array.from({ length: n }, (_, k) => [cx + rx * Math.cos((k * 2 * Math.PI) / n), cy + ry * Math.sin((k * 2 * Math.PI) / n)] as const);

// Newell's normal of a polygon in the car's frame (u, v, z in art units), as a unit vector with z in tile units.
function normalOf(pts: readonly V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = nth(pts, i);
    const b = nth(pts, (i + 1) % pts.length);
    const az = a[2] / Z_PER_TILE;
    const bz = b[2] / Z_PER_TILE;
    x += (a[1] - b[1]) * (az + bz);
    y += (az - bz) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return l < 1e-9 ? [0, 0, 0] : [x / l, y / l, z / l];
}

const dot = (a: V3, b: readonly [number, number, number]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface RingV {
  readonly u: number;
  readonly ut: number;
  readonly v: number;
  readonly ze: number;
}
interface Half {
  readonly vs: readonly RingV[];
  readonly sig: readonly number[];
  readonly n: readonly V3[];
  readonly pn: readonly Q[];
  readonly pv: readonly Q[];
  readonly facing: readonly number[];
}
interface Cell {
  readonly i: number;
  readonly j: number;
  readonly pts: readonly V3[];
  readonly n: V3;
  readonly facing: number;
  readonly depth: number;
}

/**
 * Draws a car facing `heading` (radians, world space) around its middle; `occupied` darkens the glass as if someone
 * is in. `style` picks the body; left out, the colour decides it, as for the server's parked cars.
 */
export function drawModernCar(g: G, heading: number, color: number, occupied = false, style: CarStyle = styleForColor(color)): void {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const at = (u: number, v: number, z: number): Pt => P(u * c - v * s, u * s + v * c, z);
  const at3 = (p: V3): Pt => at(p[0], p[1], p[2]);
  const world = (n: V3): V3 => [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]];
  const depthOf = (p: V3): number => 0.612 * (p[0] * (c + s) + p[1] * (c - s)) + (0.5 * p[2]) / Z_PER_TILE;
  const sp = specOf(style);
  const st = stationsOf(sp);
  const { hl, w, z0 } = sp;
  const paint = style === 'taxi' ? TAXI_YELLOW : color;
  const glassBase = occupied ? mix(GLASS, 0x000000, 0.4) : GLASS;
  const R = sp.R;
  const wheelScale = R / 3.9;
  const archR = R + 0.8 * wheelScale;
  const reach = archR / Z_PER_TILE;
  const axles = [...sp.axles];
  const nearSide = c - s > 0 ? 1 : -1;
  const frontShows = c + s > 0;
  const sideShows = Math.abs(c - s) / Math.SQRT2;
  const fill = (pts: readonly Pt[], col: number, alpha = 1): void => {
    g.fillStyle(col, alpha);
    fillPoly(g, pts);
  };
  const quad = (pts: readonly V3[], col: number, alpha = 1): void => {
    fill(pts.map(at3), col, alpha);
  };
  const line = (a: V3, b: V3, width: number, col: number, alpha = 1): void => {
    const p = at3(a);
    const q = at3(b);
    g.lineStyle(width * ART_SCALE, col, alpha);
    g.lineBetween(p.x, p.y, q.x, q.y);
  };
  const stroke = (pts: readonly Pt[], width: number, col: number, alpha: number, closed: boolean): void => {
    const [first, ...rest] = pts;
    if (first === undefined) return;
    g.lineStyle(width * ART_SCALE, col, alpha);
    g.beginPath();
    g.moveTo(first.x, first.y);
    for (const p of rest) g.lineTo(p.x, p.y);
    if (closed) g.closePath();
    g.strokePath();
  };
  // Flat illustrative shading: warm where the sun reaches, violet in shade, with a specular kiss on curved panels.
  const tone = (col: number, local: V3, gloss = 0.55): number => {
    const n = world(local);
    const l = dot(n, SUN) - 0.35;
    const base = l > 0 ? lit(col, l * 0.5) : shade(col, -l * 0.42);
    return mix(base, SPEC, Math.max(0, dot(n, HALFWAY)) ** 14 * gloss);
  };
  const glassTone = (local: V3): number => {
    const n = world(local);
    const up = Math.max(0, n[2]);
    const base = mix(glassBase, SKY, 0.07 + 0.16 * up * up * up + 0.06 * Math.max(0, dot(n, SUN)));
    return mix(base, 0xffffff, Math.max(0, dot(n, HALFWAY)) ** 30 * 0.4);
  };
  const facingOf = (local: V3): number => dot(world(local), CAM);
  g.clear();

  const roofTop = Math.max(...st.map((t) => t.zc));
  const shift = 0.12 * (roofTop / 18);
  const ground = (u: number, v: number, k = 1): Pt => P(u * c - v * s + shift * k, u * s + v * c, 0);
  g.fillStyle(SHADOW, 0.1);
  fillPoly(g, rounded(-hl - 0.05, -w - 0.06, hl + 0.05, w + 0.06, 0.14).map(([u, v]) => ground(u, v, 1.15)));
  g.fillStyle(SHADOW, 0.13);
  fillPoly(g, rounded(-hl - 0.015, -w - 0.025, hl + 0.015, w + 0.025, 0.1).map(([u, v]) => ground(u, v)));
  g.fillStyle(SHADOW, 0.26);
  fillPoly(g, rounded(-hl + 0.07, -w + 0.05, hl - 0.07, w - 0.05, 0.08).map(([u, v]) => ground(u, v, 0.5)));

  // A wheel-arch outline above `floor` on a side face sloping from `v0` at `z0` to `v1` at `z1`, walked along +u or -u.
  const arch = (uc: number, v0: number, v1: number, za: number, zb: number, forward: boolean, floor = za): [number, number, number][] => {
    const t0 = Math.asin(Math.max(-1, Math.min(1, (floor - R) / archR)));
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const t = forward ? Math.PI - t0 - (i * (Math.PI - 2 * t0)) / 12 : t0 + (i * (Math.PI - 2 * t0)) / 12;
      const z = R + archR * Math.sin(t);
      pts.push([uc + reach * Math.cos(t), v0 + ((v1 - v0) * (z - za)) / (zb - za), z]);
    }
    return pts;
  };
  // A box-like part: sides facing the camera, lit from the left, then `roof` closes it. Base and top rings share a vertex order.
  const block = (base: readonly UV[], top: readonly UV[], za: number, zb: number, side: number, roof: number | null): void => {
    const cu = base.reduce((a, p) => a + p[0], 0) / base.length;
    const cv = base.reduce((a, p) => a + p[1], 0) / base.length;
    for (let i = 0; i < base.length; i++) {
      const a = nth(base, i);
      const b = nth(base, (i + 1) % base.length);
      const ta = nth(top, i);
      const tb = nth(top, (i + 1) % top.length);
      const mu = (a[0] + b[0]) / 2 - cu;
      const mv = (a[1] + b[1]) / 2 - cv;
      const nx = mu * c - mv * s;
      const ny = mu * s + mv * c;
      if (nx + ny <= 1e-6) continue;
      const l = Math.hypot(mu, mv);
      fan(g, tone(side, [mu / l, mv / l, 0], 0.3), [at(a[0], a[1], za), at(b[0], b[1], za), at(tb[0], tb[1], zb), at(ta[0], ta[1], zb)]);
    }
    if (roof !== null) fan(g, roof, top.map(([u, v]) => at(u, v, zb)));
  };

  const tread = style === 'bus' ? 0.11 : 0.085;
  const rim = rimOf(style);
  const sunOf = (nx: number, ny: number, nz: number): number => clamp01((nx * SUN[0] + ny * SUN[1] + nz * SUN[2]) * 0.6 + 0.4);
  const contact = (u: number, v: number): Pt => P(u * c - v * s + shift * 0.3, u * s + v * c, 0);
  // A tyre as a short cylinder across the car's v axis: contact shadow, the tread band that faces the camera, then the face toward it.
  const wheel = (u0: number, side: number): void => {
    const vOut = side * (w + 0.008);
    const vIn = side * (w + 0.008 - tread);
    const outward = side * (c - s) > 0;
    const vFront = outward ? vOut : vIn;
    const vBack = outward ? vIn : vOut;
    const vMid = (vOut + vIn) / 2;
    const ru = R / Z_PER_TILE;
    const pw = (r: number, a: number, v = vFront): Pt => at(u0 + (r * Math.cos(a)) / Z_PER_TILE, v, R + r * Math.sin(a));
    const disc = (r: number, v = vFront): Pt[] => CIRCLE.map(([cs, sn]) => at(u0 + (r * cs) / Z_PER_TILE, v, R + r * sn));
    g.fillStyle(SHADOW, 0.2);
    fillPoly(g, CIRCLE.map(([cs, sn]) => contact(u0 + 1.4 * ru * cs, vMid + (tread * 0.5 + 0.04) * sn)));
    g.fillStyle(SHADOW, 0.45);
    fillPoly(g, CIRCLE.map(([cs, sn]) => contact(u0 + 0.75 * ru * cs, vMid + tread * 0.5 * sn)));
    const front = disc(R);
    const back = disc(R, vBack);
    for (let k = 0; k < RING; k++) {
      const p0 = nth(front, k);
      const p1 = nth(front, (k + 1) % RING);
      const q0 = nth(back, k);
      const q1 = nth(back, (k + 1) % RING);
      const t = ((k + 0.5) * 2 * Math.PI) / RING;
      const nx = c * Math.cos(t);
      const ny = s * Math.cos(t);
      const nz = Math.sin(t);
      if (nx * CAM[0] + ny * CAM[1] + nz * CAM[2] <= 0) continue;
      fan(g, mix(TYRE, TYRE_LIT, sunOf(nx, ny, nz) * (k % 2 === 0 ? 0.95 : 0.7)), [p0, p1, q1, q0]);
    }
    const flip = outward ? side : -side;
    const faceSun = sunOf(-s * flip, c * flip, 0);
    g.fillStyle(mix(TYRE, TYRE_LIT, 0.25 + 0.4 * faceSun), 1);
    fillPoly(g, front);
    if (!outward) {
      g.fillStyle(WELL, 1);
      fillPoly(g, disc(R * 0.62));
      return;
    }
    stroke(disc(R * 0.84), 0.45, mix(TYRE, TYRE_LIT, 0.9), 0.8, true);
    const ctr = at(u0, vFront, R);
    const upperLeft = (p: Pt): number => {
      const dx = p.x - ctr.x;
      const dy = p.y - ctr.y;
      return (-0.55 * dx - 0.83 * dy) / (Math.hypot(dx, dy) || 1);
    };
    const glint = (pts: readonly Pt[], width: number, col: number, alpha: number): void => {
      g.lineStyle(width * ART_SCALE, col, alpha);
      pts.forEach((p, k) => {
        const q = pts[(k + 1) % pts.length];
        if (q !== undefined && upperLeft(p) > 0.45 && upperLeft(q) > 0.45) g.lineBetween(p.x, p.y, q.x, q.y);
      });
    };
    glint(disc(R * 0.94), 0.5, 0xffffff, 0.16);
    const metal = rim.metal;
    const face = mix(shade(metal, 0.25), lit(metal, 0.2), faceSun);
    const spin = 0.6 + u0 * 4.3;
    const spokesAt = (n: number): number[] => Array.from({ length: n }, (_, i) => spin + (i * 2 * Math.PI) / n);
    if (rim.kind === 'alloy') {
      g.fillStyle(shade(metal, 0.45), 1);
      fillPoly(g, disc(R * 0.66));
      g.fillStyle(face, 1);
      fillPoly(g, disc(R * 0.6));
      g.fillStyle(mix(metal, WELL, 0.82), 1);
      fillPoly(g, disc(R * 0.51));
      const w0 = rim.spokes === 5 ? 0.36 : 0.27;
      const w1 = rim.spokes === 5 ? 0.21 : 0.15;
      g.fillStyle(face, 1);
      for (const a of spokesAt(rim.spokes)) fillPoly(g, [pw(R * 0.14, a - w0), pw(R * 0.53, a - w1), pw(R * 0.53, a + w1), pw(R * 0.14, a + w0)]);
      g.fillStyle(lit(face, 0.15), 1);
      fillPoly(g, disc(R * 0.19));
      g.fillStyle(shade(metal, 0.5), 1);
      fillPoly(g, disc(R * 0.08));
    } else if (rim.kind === 'steel') {
      g.fillStyle(shade(metal, 0.45), 1);
      fillPoly(g, disc(R * 0.64));
      g.fillStyle(face, 1);
      fillPoly(g, disc(R * 0.58));
      stroke(disc(R * 0.42), 0.45, shade(metal, 0.4), 0.9, true);
      g.fillStyle(WELL, 0.9);
      for (const a of spokesAt(rim.spokes === 8 ? 8 : 6)) {
        const h = pw(R * 0.5, a);
        g.fillCircle(h.x, h.y, R * 0.075 * ART_SCALE);
      }
      g.fillStyle(lit(face, 0.12), 1);
      fillPoly(g, disc(R * 0.27));
      g.fillStyle(shade(metal, 0.55), 1);
      for (const a of spokesAt(rim.spokes)) {
        const n = pw(R * 0.18, a + 0.3);
        g.fillCircle(n.x, n.y, R * 0.045 * ART_SCALE);
      }
      g.fillStyle(shade(metal, 0.3), 1);
      fillPoly(g, disc(R * 0.09));
    } else {
      g.fillStyle(shade(metal, 0.4), 1);
      fillPoly(g, disc(R * 0.7));
      g.fillStyle(face, 1);
      fillPoly(g, disc(R * 0.64));
      stroke(disc(R * 0.47), 0.4, shade(metal, 0.3), 0.85, true);
      g.lineStyle(0.45 * ART_SCALE, shade(metal, 0.5), 0.9);
      for (const a of spokesAt(rim.spokes)) {
        const p = pw(R * 0.25, a);
        const q = pw(R * 0.42, a);
        g.lineBetween(p.x, p.y, q.x, q.y);
      }
      g.fillStyle(shade(metal, 0.2), 1);
      fillPoly(g, disc(R * 0.17));
      g.fillStyle(lit(metal, 0.4), 1);
      fillPoly(g, disc(R * 0.07));
    }
    glint(disc(R * 0.6), 0.6, 0xffffff, 0.55);
  };
  const archWell = (side: number, floor: number, col: number, alpha: number): void => {
    const v = side * (w - 0.02);
    for (const u of axles) quad(arch(u, v, v, z0, roofTop, true, floor), col, alpha);
  };

  // The lower body as two half rings (left and right) from the nose centre to the tail centre, each face a vertical-ish panel.
  const tubSt = st.filter((t) => t.tub);
  const halfOf = (side: number): Half => {
    const f = nth(tubSt, 0);
    const l = nth(tubSt, tubSt.length - 1);
    const vs: RingV[] = [{ u: f.u, ut: f.ut, v: 0, ze: f.ze }, ...tubSt.map((t) => ({ u: t.u, ut: t.ut, v: side * t.w, ze: t.ze })), { u: l.u, ut: l.ut, v: 0, ze: l.ze }];
    const sig = [0];
    const n: V3[] = [];
    const pn: Q[] = [];
    const facing: number[] = [];
    for (let k = 0; k < vs.length - 1; k++) {
      const a = nth(vs, k);
      const b = nth(vs, k + 1);
      sig.push(nth(sig, k) + Math.hypot(b.u - a.u, b.v - a.v));
      let nn = normalOf([[a.u, a.v, z0], [b.u, b.v, z0], [b.ut, b.v, b.ze], [a.ut, a.v, a.ze]]);
      if (nn[0] * (a.u + b.u) + nn[1] * (a.v + b.v) < 0) nn = [-nn[0], -nn[1], -nn[2]];
      const pl = Math.hypot(nn[0], nn[1]) || 1;
      n.push(nn);
      pn.push([nn[0] / pl, nn[1] / pl]);
      facing.push(facingOf(nn));
    }
    const pv = vs.map((_, k): Q => {
      const a = pn[Math.max(0, k - 1)] ?? [0, 0];
      const b = pn[Math.min(pn.length - 1, k)] ?? [0, 0];
      const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
      return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
    });
    return { vs, sig, n, pn, pv, facing };
  };
  const halves = [halfOf(-1), halfOf(1)];
  const left = nth(halves, 0);
  const total = nth(left.sig, left.sig.length - 1);
  const sigF = nth(left.sig, 4);
  const sigR = total - nth(left.sig, left.sig.length - 5);
  const w0 = w - sp.rv;
  const cornerF = sigF - w0;
  const cornerR = sigR - w0;
  const segOf = (h: Half, sg: number): number => {
    for (let k = 0; k < h.vs.length - 1; k++) if (sg <= nth(h.sig, k + 1)) return k;
    return h.vs.length - 2;
  };
  const tubPt = (h: Half, k: number, sg: number, z: number, off = 0): Pt => {
    const a = nth(h.vs, k);
    const b = nth(h.vs, k + 1);
    const s0 = nth(h.sig, k);
    const t = (sg - s0) / (nth(h.sig, k + 1) - s0 || 1);
    const ze = lerp(a.ze, b.ze, t);
    const f = (z - z0) / (ze - z0);
    const u = lerp(a.u, b.u, t);
    const na = nth(h.pv, k);
    const nb = nth(h.pv, k + 1);
    return at(u + (lerp(a.ut, b.ut, t) - u) * f + lerp(na[0], nb[0], t) * off, lerp(a.v, b.v, t) + lerp(na[1], nb[1], t) * off, z);
  };
  const zeAt = (sg: number): number => {
    const k = segOf(left, sg);
    const a = nth(left.vs, k);
    const b = nth(left.vs, k + 1);
    const s0 = nth(left.sig, k);
    return lerp(a.ze, b.ze, (sg - s0) / (nth(left.sig, k + 1) - s0 || 1));
  };
  const sigU = (u: number): number => {
    for (let k = 0; k < left.vs.length - 1; k++) {
      const a = nth(left.vs, k);
      const b = nth(left.vs, k + 1);
      if (a.u === b.u || (a.u - u) * (b.u - u) > 0) continue;
      return lerp(nth(left.sig, k), nth(left.sig, k + 1), (a.u - u) / (a.u - b.u));
    }
    return u > 0 ? 0 : total;
  };
  // A flat decal on the lower body in (distance round from the nose centre, height), split across the panels it wraps.
  const onTub = (h: Half, poly: readonly Q[], col: number, alpha = 1, off = 0, shaded = false): void => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of poly) {
      lo = Math.min(lo, p[0]);
      hi = Math.max(hi, p[0]);
    }
    for (let k = 0; k < h.vs.length - 1; k++) {
      const fa = nth(h.facing, k);
      const s0 = nth(h.sig, k);
      const s1 = nth(h.sig, k + 1);
      if (fa <= 0.02 || s1 < lo || s0 > hi) continue;
      const part = clip(clip(poly, 0, s0, false), 0, s1, true);
      if (part.length < 3) continue;
      fill(part.map(([sg, z]) => tubPt(h, k, sg, z, off)), shaded ? tone(col, nth(h.n, k)) : col, alpha * clamp01(fa * 5));
    }
  };
  const nose = (poly: readonly Q[], col: number, alpha = 1, off = 0, shaded = false): void => {
    for (const h of halves) onTub(h, poly, col, alpha, off, shaded);
  };
  const rear = (poly: readonly Q[], col: number, alpha = 1, off = 0, shaded = false): void => {
    for (const h of halves) onTub(h, poly.map(([sg, z]) => [total - sg, z] as const), col, alpha, off, shaded);
  };
  const flank = (poly: readonly Q[], col: number, alpha = 1, shaded = false, only = 0): void => {
    halves.forEach((h, k) => {
      if (only === 0 || only === (k === 0 ? -1 : 1)) onTub(h, poly.map(([u, z]) => [sigU(u), z] as const), col, alpha, 0.001, shaded);
    });
  };

  // The upper body: a grid of stations by nine points across (belt, shoulder, roof edge, crown, centre and back down).
  const section = (t: Station): V3[] => {
    const gh = t.zr > 0;
    const w1 = t.w - sp.si;
    const z1 = t.ze + sp.sz;
    const w2 = gh ? t.w - sp.gi : w1 - 0.004;
    const z2 = gh ? t.zr : z1 + 0.04;
    const zc = Math.max(t.zc, z2);
    const z3 = z2 + (zc - z2) * 0.8;
    const w3 = w2 * 0.55;
    return [[t.ut, -t.w, t.ze], [t.ut, -w1, z1], [t.ut, -w2, z2], [t.ut, -w3, z3], [t.ut, 0, zc], [t.ut, w3, z3], [t.ut, w2, z2], [t.ut, w1, z1], [t.ut, t.w, t.ze]];
  };
  const grid = st.map(section);
  const gp = (i: number, j: number): V3 => nth(nth(grid, i), j);
  const cells: (Cell | undefined)[][] = [];
  for (let i = 0; i < st.length - 1; i++) {
    const row: (Cell | undefined)[] = [];
    for (let j = 0; j < 8; j++) {
      const pts = [gp(i, j), gp(i, j + 1), gp(i + 1, j + 1), gp(i + 1, j)];
      const n = normalOf(pts);
      if (n[0] === 0 && n[1] === 0 && n[2] === 0) {
        row.push(undefined);
        continue;
      }
      const mid: V3 = [pts.reduce((a, p) => a + p[0], 0) / 4, pts.reduce((a, p) => a + p[1], 0) / 4, pts.reduce((a, p) => a + p[2], 0) / 4];
      row.push({ i, j, pts, n, facing: facingOf(n), depth: depthOf(mid) });
    }
    cells.push(row);
  }
  const segAt = (i: number): Seg => nth(st, i).seg;
  const isGlass = (cell: Cell): boolean => {
    const seg = segAt(cell.i);
    const sideBand = cell.j === 1 || cell.j === 6;
    if (cell.j === 0 || cell.j === 7) return false;
    if (sideBand) return seg === 'screen' || seg === 'cabin';
    return seg === 'screen' || seg === 'rear';
  };
  const bilerp = (cell: Cell, ti: number, tj: number): V3 => {
    const [p00, p01, p11, p10] = [nth(cell.pts, 0), nth(cell.pts, 1), nth(cell.pts, 2), nth(cell.pts, 3)];
    const a = [lerp(p00[0], p01[0], tj), lerp(p00[1], p01[1], tj), lerp(p00[2], p01[2], tj)] as const;
    const b = [lerp(p10[0], p11[0], tj), lerp(p10[1], p11[1], tj), lerp(p10[2], p11[2], tj)] as const;
    return [lerp(a[0], b[0], ti), lerp(a[1], b[1], ti), lerp(a[2], b[2], ti)];
  };
  const cellAt = (i: number, j: number): Cell | undefined => cells[i]?.[j];
  const upAt = (fi: number, fj: number): V3 => {
    const i = Math.min(st.length - 2, Math.max(0, Math.floor(fi)));
    const j = Math.min(7, Math.max(0, Math.floor(fj)));
    const cell = cellAt(i, j);
    if (cell !== undefined) return bilerp(cell, fi - i, fj - j);
    const a = gp(i, j);
    return a;
  };
  // A decal on the upper body in (station, column) coordinates, shaded and hidden with whichever cell it lands on.
  const onUpper = (poly: readonly Q[], col: number | ((n: V3) => number), alpha = 1): void => {
    let i0 = Infinity;
    let i1 = -Infinity;
    let j0 = Infinity;
    let j1 = -Infinity;
    for (const p of poly) {
      i0 = Math.min(i0, p[0]);
      i1 = Math.max(i1, p[0]);
      j0 = Math.min(j0, p[1]);
      j1 = Math.max(j1, p[1]);
    }
    for (let i = Math.max(0, Math.floor(i0)); i <= Math.min(st.length - 2, Math.ceil(i1) - 1); i++) {
      for (let j = Math.max(0, Math.floor(j0)); j <= Math.min(7, Math.ceil(j1) - 1); j++) {
        const cell = cellAt(i, j);
        if (cell === undefined || cell.facing <= 0.01) continue;
        const part = clipBox(poly, i, i + 1, j, j + 1);
        if (part.length < 3) continue;
        fill(part.map(([fi, fj]) => at3(bilerp(cell, fi - i, fj - j))), typeof col === 'function' ? col(cell.n) : col, alpha * clamp01(cell.facing * 6));
      }
    }
  };
  const fiAt = (u: number): number => {
    for (let i = 0; i < st.length - 1; i++) {
      const a = nth(st, i).ut;
      const b = nth(st, i + 1).ut;
      if (u <= a && u >= b) return i + (a === b ? 0 : (a - u) / (a - b));
    }
    return u > 0 ? 0 : st.length - 1;
  };
  const firstOf = (pred: (seg: Seg) => boolean, from = 0): number => {
    for (let i = from; i < st.length; i++) if (pred(segAt(i))) return i;
    return st.length - 1;
  };
  const iCowl = firstOf((x) => x === 'screen');
  const iRoofF = firstOf((x) => x === 'cabin' || x === 'panel', iCowl);
  const iRoofR = firstOf((x) => x !== 'cabin' && x !== 'panel', iRoofF);
  const iBack = firstOf((x) => x === 'body' || x === 'bed', iRoofR);
  const iGlassEnd = firstOf((x) => x !== 'screen' && x !== 'cabin', iCowl);
  const bandOf = (side: number, f: number): number => (side < 0 ? 1 + f : 7 - f);
  const bothSides = (poly: (side: number) => Q[], col: number | ((n: V3) => number), alpha = 1): void => {
    for (const side of [-1, 1]) onUpper(poly(side), col, alpha);
  };
  const paintTone = (n: V3): number => tone(paint, n);

  // Chassis: far wheels, the dark underbody, wheel wells, then the near wheels the body's arches frame.
  for (const u of axles) wheel(u, -nearSide);
  const under = rounded(-hl + 0.05, -w + 0.04, hl - 0.05, w - 0.04, 0.08);
  block(under, under, R * 0.55, z0 + 0.4, TRIM, null);
  archWell(nearSide, z0, WELL, 1);
  for (const u of axles) wheel(u, nearSide);
  archWell(nearSide, R + archR * 0.1, 0x000000, 0.35);
  archWell(nearSide, R + archR * 0.55, 0x000000, 0.3);

  // Lower body panels, notched for the wheels, darkening toward the ground.
  for (const h of halves) {
    for (let k = 0; k < h.vs.length - 1; k++) {
      const fa = nth(h.facing, k);
      if (fa <= 0) continue;
      const a = nth(h.vs, k);
      const b = nth(h.vs, k + 1);
      const sa = nth(h.sig, k);
      const sb = nth(h.sig, k + 1);
      const poly: Q[] = [[sa, z0]];
      if (a.v === b.v && a.v !== 0) {
        for (const ax of axles) {
          if (ax >= a.u || ax <= b.u) continue;
          const sc = sa + (a.u - ax);
          const t0 = Math.asin(Math.max(-1, Math.min(1, (z0 - R) / archR)));
          for (let i = 0; i <= 12; i++) {
            const t = Math.PI - t0 - (i * (Math.PI - 2 * t0)) / 12;
            poly.push([sc + reach * Math.cos(t), R + archR * Math.sin(t)]);
          }
        }
      }
      poly.push([sb, z0], [sb, b.ze], [sa, a.ze]);
      const toPts = (p: readonly Q[]): Pt[] => p.map(([sg, z]) => tubPt(h, k, sg, z));
      const n = nth(h.n, k);
      fill(toPts(poly), tone(paint, n));
      fill(toPts(clip(poly, 1, Math.min(a.ze, b.ze) - 2.4, false)), SPEC, 0.07);
      fill(toPts(clip(poly, 1, z0 + 3.6, true)), SHADOW, 0.07);
      fill(toPts(clip(poly, 1, z0 + 1.9, true)), SHADOW, 0.1);
      fill(toPts(clip(poly, 1, z0 + 0.8, true)), SHADOW, 0.14);
    }
  }

  // Arch lips: a thin rolled edge, or chunky black cladding on the off-roaders.
  const clad = style === 'suv' || style === 'pickup';
  for (const u of axles) {
    const lip = arch(u, nearSide * (w + 0.002), nearSide * (w + 0.002), z0, roofTop, true).map((p) => at(...p));
    if (clad) stroke(lip, 2.6, PLASTIC, sideShows, false);
    stroke(lip, clad ? 0.7 : 0.9, clad ? 0x16151a : shade(paint, 0.45), 0.9 * sideShows, false);
  }

  // Body-side detail: character line, sill, doors, handles, fuel flap and livery.
  const crease = (za: number, zb: number): void => {
    const a0 = sigF + 0.02;
    const a1 = total - sigR - 0.02;
    const zA = zeAt(a0);
    const zB = zeAt(a1);
    for (const h of halves) {
      onTub(h, [[a0, zA - za - 0.45], [a1, zB - zb - 0.45], [a1, zB - zb], [a0, zA - za]], lit(paint, 0.35), 0.55, 0.001);
      onTub(h, [[a0, zA - za - 0.85], [a1, zB - zb - 0.85], [a1, zB - zb - 0.45], [a0, zA - za - 0.45]], shade(paint, 0.35), 0.35, 0.001);
    }
  };
  const archEdgeF = axles[0] === undefined ? 0 : axles[0] - reach - 0.01;
  const archEdgeR = axles[1] === undefined ? 0 : axles[1] + reach + 0.01;
  const doorLine = (u: number, zTop: number, zBot = z0 + 0.7): void => {
    flank(rect(u - 0.003, zBot, u + 0.003, zTop), shade(paint, 0.55), 0.75);
  };
  const handle = (u: number, z: number, chrome: boolean): void => {
    flank(rect(u - 0.032, z - 0.75, u + 0.032, z - 0.35), shade(paint, 0.5), 0.6);
    flank(rect(u - 0.03, z - 0.4, u + 0.03, z + 0.1), chrome ? CHROME : lit(paint, 0.3), 0.95);
  };
  const beltAt = (u: number): number => zeAt(sigU(u));
  if (style !== 'bus') {
    if (clad) flank([[archEdgeF, z0], [archEdgeR, z0], [archEdgeR, z0 + 2.3], [archEdgeF, z0 + 2.3]], PLASTIC, 1, true);
    else flank([[archEdgeF, z0], [archEdgeR, z0], [archEdgeR, z0 + 0.9], [archEdgeF, z0 + 0.9]], shade(paint, 0.5), 0.55);
    if (style !== 'taxi') crease(1.3, 1.3);
    const front = Math.min(archEdgeF - 0.015, nth(st, iCowl).u - 0.01);
    const bPillar = sp.pillarB;
    if (style === 'van') {
      doorLine(front, beltAt(front));
      doorLine(bPillar + 0.01, beltAt(bPillar));
      handle(bPillar + 0.07, beltAt(bPillar) - 1.3, false);
      doorLine(-0.42, beltAt(-0.42));
      handle(-0.38, beltAt(-0.38) - 1.6, false);
      flank(rect(-0.66, beltAt(-0.6) - 0.2, -0.42, beltAt(-0.6) + 0.1), shade(paint, 0.55), 0.7, false, 1);
    } else {
      const rearEdge = style === 'pickup' ? -0.19 : archEdgeR + 0.012;
      doorLine(front, beltAt(front));
      doorLine(bPillar, beltAt(bPillar));
      doorLine(rearEdge, beltAt(rearEdge));
      flank(rect(rearEdge, z0 + 0.66, front, z0 + 0.72), shade(paint, 0.55), 0.6);
      const chrome = style === 'taxi';
      handle(bPillar + 0.065, beltAt(bPillar) - 1.25, chrome);
      handle(rearEdge + 0.065, beltAt(rearEdge) - 1.25, chrome);
      if (style !== 'pickup') {
        const fu = (axles[1] ?? 0) + 0.005;
        const fz = beltAt(fu) - 1.7;
        flank(ellipse(fu, fz, 0.03, 0.75, 10), shade(paint, 0.5), 0.7, false, -1);
        flank(ellipse(fu, fz, 0.025, 0.6, 10), lit(paint, 0.08), 1, false, -1);
      }
    }
    if (style === 'taxi') {
      const a0 = sigF + 0.03;
      const a1 = total - sigR - 0.03;
      const n = Math.round((a1 - a0) / 0.03);
      const step = (a1 - a0) / n;
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < 2; r++) {
          const sg = a0 + i * step;
          const z = beltAt(0) - 2.9 + r * 0.85;
          for (const h of halves) onTub(h, rect(sg, z, sg + step, z + 0.85), (i + r) % 2 === 0 ? TRIM : 0xfafafa, 0.95, 0.001);
        }
      }
    }
  }

  // Bumpers: separate wrap-round volumes standing proud of the body, with a lit top ledge.
  const bumperCol = style === 'taxi' ? CHROME : style === 'van' || style === 'bus' ? PLASTIC : paint;
  const bumper = (lo: number, hi: number, za: number, zb: number): void => {
    for (const h of halves) {
      for (let k = 0; k < h.vs.length - 1; k++) {
        const fa = nth(h.facing, k);
        const a = Math.max(lo, nth(h.sig, k));
        const b = Math.min(hi, nth(h.sig, k + 1));
        if (fa <= 0 || b <= a) continue;
        const n = nth(h.n, k);
        const off = sp.bumpOff;
        fill([tubPt(h, k, a, za, off), tubPt(h, k, b, za, off), tubPt(h, k, b, zb, off), tubPt(h, k, a, zb, off)], tone(bumperCol, n, style === 'taxi' ? 1 : 0.55));
        fill([tubPt(h, k, a, za, off), tubPt(h, k, b, za, off), tubPt(h, k, b, za + 1.1, off), tubPt(h, k, a, za + 1.1, off)], SHADOW, 0.16);
        fill([tubPt(h, k, a, zb, off), tubPt(h, k, b, zb, off), tubPt(h, k, b, zb, 0), tubPt(h, k, a, zb, 0)], tone(bumperCol, [n[0] * 0.3, n[1] * 0.3, 0.95], 0.8));
        if (style === 'taxi') fill([tubPt(h, k, a, zb - 1.9, off + 0.001), tubPt(h, k, b, zb - 1.9, off + 0.001), tubPt(h, k, b, zb - 1.2, off + 0.001), tubPt(h, k, a, zb - 1.2, off + 0.001)], TRIM, 0.85);
      }
    }
  };
  const bumpEndF = sigU((axles[0] ?? hl) + reach + 0.012);
  const bumpEndR = sigU((axles[1] ?? -hl) - reach - 0.012);
  const offB = sp.bumpOff + 0.002;
  const [fz0, fz1] = sp.bumpF;
  const [rz0, rz1] = sp.bumpR;
  const zt = sp.nose[0];
  const zT = sp.tail[0];
  const plate = (front: boolean, zc: number, col: number): void => {
    const put = front ? nose : rear;
    put(rect(0, zc - 0.7, 0.078, zc + 0.7), shade(col, 0.5), 1, offB);
    put(rect(0, zc - 0.58, 0.07, zc + 0.58), col, 1, offB);
    put(rect(0.012, zc - 0.22, 0.05, zc + 0.22), TRIM, 0.55, offB);
  };

  // Front end: grille, headlamp units with lens, projector and LED signature, then the bumper's intakes and plate.
  const frontEnd = (): void => {
    switch (style) {
      case 'suv':
      case 'pickup': {
        const gTop = zt - 0.5;
        const gBot = fz1 + 0.3;
        const gw = w0 - 0.1;
        nose(rect(0, gBot - 0.3, gw + 0.02, gTop + 0.3), CHROME, 1, 0, true);
        nose(rect(0, gBot, gw, gTop), 0x141318);
        for (let z = gBot + 0.7; z < gTop - 0.3; z += style === 'pickup' ? 1.1 : 1.4) nose(rect(0, z, gw - 0.01, z + 0.4), style === 'pickup' ? CHROME : 0x5a5a64, 1, 0, true);
        nose([[gw + 0.03, zt - 0.4], [w0 + 0.55 * cornerF, zt - 0.3], [w0 + 0.55 * cornerF, zt - 2.6], [gw + 0.03, zt - 2.4]], LENS);
        nose([[gw + 0.035, zt - 0.6], [w0 + 0.5 * cornerF, zt - 0.5], [w0 + 0.5 * cornerF, zt - 0.9], [gw + 0.035, zt - 1.0]], LED);
        nose(ellipse(gw + 0.07, zt - 1.6, 0.022, 0.55), PROJECTOR);
        nose(ellipse(w0 + 0.03, zt - 1.6, 0.02, 0.5), PROJECTOR, 0.85);
        nose(rect(w0 + 0.42 * cornerF, zt - 2.4, w0 + 0.5 * cornerF, zt - 0.9), AMBER, 0.9);
        bumper(0, bumpEndF, fz0, fz1);
        nose(rect(0, fz0, w0 + 0.4 * cornerF, fz0 + 2.0), PLASTIC, 1, offB, true);
        nose(rect(0, fz0 + 0.2, 0.12, fz0 + 1.0), 0xa8adb6, 1, offB + 0.001, true);
        nose(rect(0, fz0 + 2.4, w0 - 0.04, fz0 + 3.6), 0x141318, 1, offB);
        nose(ellipse(w0 + 0.02, fz0 + 3.0, 0.025, 0.5), 0xfff3c0, 0.9, offB);
        plate(true, fz1 - 1.2, PLATE);
        break;
      }
      case 'taxi': {
        const gw = w0 - 0.09;
        nose(rect(0, fz1 + 0.4, gw + 0.015, zt - 0.6), CHROME, 1, 0, true);
        nose(rect(0, fz1 + 0.65, gw, zt - 0.85), 0x1a191f);
        for (let sg = 0.012; sg < gw; sg += 0.026) nose(rect(sg, fz1 + 0.65, sg + 0.008, zt - 0.85), CHROME, 0.9, 0, true);
        for (const [cx, r] of [[w0 - 0.035, 0.052], [w0 + 0.3 * cornerF, 0.04]] as const) {
          nose(ellipse(cx, zt - 1.7, r, r * 22, 14), CHROME, 1, 0, true);
          nose(ellipse(cx, zt - 1.7, r * 0.8, r * 18, 14), 0xfff4d6);
          nose(ellipse(cx - r * 0.2, zt - 1.4, r * 0.3, r * 6, 10), 0xffffff, 0.9);
        }
        nose(rect(w0 + 0.55 * cornerF, fz1 + 0.5, w0 + 0.8 * cornerF, fz1 + 1.3), AMBER, 0.9);
        bumper(0, bumpEndF, fz0, fz1);
        plate(true, fz0 + 1.75, PLATE_TAXI);
        break;
      }
      case 'van': {
        const gw = w0 - 0.07;
        nose([[0, fz1 + 0.3], [gw, fz1 + 0.3], [gw + 0.02, zt - 0.6], [0, zt - 0.6]], 0x16151a);
        for (const z of [fz1 + 1.2, fz1 + 2.3]) nose(rect(0, z, gw, z + 0.35), 0x4a4a52, 1, 0, true);
        nose([[gw + 0.03, zt - 0.4], [w0 + 0.7 * cornerF, zt - 0.2], [w0 + 0.7 * cornerF, zt - 2.6], [gw + 0.03, zt - 2.9]], LENS);
        nose([[gw + 0.035, zt - 0.6], [w0 + 0.66 * cornerF, zt - 0.45], [w0 + 0.66 * cornerF, zt - 0.85], [gw + 0.035, zt - 1.0]], LED);
        nose(ellipse(gw + 0.07, zt - 1.8, 0.024, 0.6), PROJECTOR);
        nose(rect(w0 + 0.45 * cornerF, zt - 2.5, w0 + 0.66 * cornerF, zt - 1.6), AMBER, 0.85);
        bumper(0, bumpEndF, fz0, fz1);
        nose(rect(0, fz0 + 0.6, w0 - 0.05, fz0 + 1.8), 0x141318, 1, offB);
        plate(true, fz0 + 3.2, PLATE);
        break;
      }
      case 'bus': {
        nose(rect(0, fz1 + 0.6, w0 - 0.04, fz1 + 2.6), 0x16151a);
        for (let sg = 0.01; sg < w0 - 0.06; sg += 0.04) nose(rect(sg, fz1 + 0.9, sg + 0.022, fz1 + 2.3), 0x3a3a44);
        nose([[w0 - 0.02, fz1 + 0.6], [w0 + 0.8 * cornerF, fz1 + 0.6], [w0 + 0.8 * cornerF, fz1 + 2.6], [w0 - 0.02, fz1 + 2.6]], LENS);
        nose(rect(w0 - 0.01, fz1 + 1.6, w0 + 0.75 * cornerF, fz1 + 2.3), LED);
        nose(rect(w0 + 0.05, fz1 + 0.8, w0 + 0.75 * cornerF, fz1 + 1.3), AMBER, 0.9);
        bumper(0, bumpEndF, fz0, fz1);
        plate(true, fz0 + 1.6, PLATE);
        break;
      }
      default: {
        const hatch = style === 'hatch';
        const gw = w0 - (hatch ? 0.1 : 0.11);
        nose([[0, fz1 + 0.45], [gw, fz1 + 0.45], [gw - 0.02, zt - 0.85], [0, zt - 0.85]], 0x15141a);
        for (let z = fz1 + 0.85; z < zt - 1.0; z += 0.55) nose(rect(0, z, gw - 0.03, z + 0.18), 0x4b4a55);
        nose(rect(0, zt - 1.05, gw - 0.01, zt - 0.8), CHROME, 0.9, 0, true);
        const tip = w0 + (hatch ? 0.7 : 0.6) * cornerF;
        nose([[gw + 0.01, zt - 0.3], [tip, zt - 0.2], [tip, zt - 1.3], [w0 + 0.03, zt - 1.9], [gw + 0.01, zt - 1.5]], LENS);
        nose([[gw + 0.015, zt - 0.45], [tip - 0.01, zt - 0.35], [tip - 0.01, zt - 0.7], [gw + 0.015, zt - 0.8]], LED);
        nose(ellipse(gw + 0.055, zt - 1.15, 0.02, 0.36), PROJECTOR);
        nose(ellipse(gw + 0.05, zt - 1.05, 0.008, 0.14), 0xffffff);
        bumper(0, bumpEndF, fz0, fz1);
        nose([[0, fz0 + 0.5], [w0 - 0.03, fz0 + 0.5], [w0 - 0.08, fz0 + 2.0], [0, fz0 + 2.0]], 0x16151b, 1, offB);
        for (let sg = 0.01; sg < w0 - 0.07; sg += 0.024) nose(rect(sg, fz0 + 0.8, sg + 0.012, fz0 + 1.7), 0x34333c, 1, offB);
        nose([[w0 + 0.15 * cornerF, fz0 + 1.3], [w0 + 0.55 * cornerF, fz0 + 1.35], [w0 + 0.55 * cornerF, fz0 + 2.3], [w0 + 0.15 * cornerF, fz0 + 2.45]], 0x1e1d24, 0.85, offB);
        plate(true, fz0 + 3.0, PLATE);
      }
    }
  };

  // Rear end: tail-lamp units, boot or tailgate shut lines, plate, reflectors and the exhaust.
  const rearEnd = (): void => {
    const exhaust = (): void => {
      for (const h of halves.slice(0, 1)) {
        onTub(h, ellipse(total - (w0 - 0.07), rz0 + 0.5, 0.03, 0.5, 12), CHROME, 1, offB + 0.002, true);
        onTub(h, ellipse(total - (w0 - 0.07), rz0 + 0.5, 0.02, 0.33, 12), 0x0d0c10, 1, offB + 0.003);
      }
    };
    switch (style) {
      case 'pickup': {
        rear(rect(0, zT - 0.4, w0 - 0.05, zT - 0.3), shade(paint, 0.5), 0.7);
        rear(rect(0, rz1 + 0.6, w0 - 0.05, rz1 + 0.7), shade(paint, 0.5), 0.7);
        rear(rect(0, zT - 2.4, 0.05, zT - 1.6), TRIM, 0.9);
        rear([[w0 - 0.03, rz1 + 0.6], [w0 + 0.45 * cornerR, rz1 + 0.6], [w0 + 0.45 * cornerR, zT - 0.5], [w0 - 0.03, zT - 0.5]], TAIL_DEEP);
        rear(rect(w0 - 0.025, zT - 2.6, w0 + 0.42 * cornerR, zT - 0.8), TAIL);
        rear(rect(w0 - 0.025, rz1 + 1.4, w0 + 0.42 * cornerR, rz1 + 2.4), 0xf4f1ea);
        bumper(bumpEndR, total, rz0, rz1);
        plate(false, rz0 + 1.8, PLATE);
        break;
      }
      case 'van': {
        rear(rect(0, z0 + 0.5, 0.003, zT), TRIM, 0.8);
        rear([[w0 - 0.01, rz1 + 0.5], [w0 + 0.6 * cornerR, rz1 + 0.5], [w0 + 0.6 * cornerR, zT - 0.4], [w0 - 0.01, zT - 0.4]], TAIL_DEEP);
        rear(rect(w0, zT - 2.6, w0 + 0.55 * cornerR, zT - 0.7), TAIL);
        rear(rect(w0, rz1 + 1.3, w0 + 0.55 * cornerR, rz1 + 2.2), AMBER, 0.9);
        rear(rect(0.03, zT - 2.2, 0.07, zT - 1.8), TRIM, 0.9);
        bumper(bumpEndR, total, rz0, rz1);
        plate(false, rz1 + 1.8, PLATE);
        break;
      }
      case 'bus': {
        rear(rect(0, z0 + 2.4, w0 - 0.06, zT - 1.6), 0x18171d);
        for (let z = z0 + 2.9; z < zT - 2.0; z += 0.9) rear(rect(0, z, w0 - 0.08, z + 0.4), 0x3a3944);
        rear(rect(w0 - 0.03, z0 + 2.4, w0 + 0.7 * cornerR, zT - 1.6), TAIL_DEEP);
        rear(rect(w0 - 0.02, zT - 4.2, w0 + 0.66 * cornerR, zT - 2.2), TAIL);
        rear(rect(w0 - 0.02, z0 + 3.2, w0 + 0.66 * cornerR, z0 + 4.4), AMBER, 0.9);
        bumper(bumpEndR, total, rz0, rz1);
        plate(false, rz0 + 1.6, PLATE);
        break;
      }
      case 'taxi': {
        rear(rect(0, zT - 2.8, w0 + 0.3 * cornerR, zT - 2.7), shade(paint, 0.5), 0.7);
        for (const cx of [w0 - 0.02, w0 + 0.35 * cornerR]) {
          rear(ellipse(cx, zT - 1.45, 0.045, 0.95, 14), CHROME, 1, 0, true);
          rear(ellipse(cx, zT - 1.45, 0.036, 0.75, 14), TAIL);
        }
        rear(ellipse(w0 - 0.09, zT - 1.45, 0.022, 0.5, 10), 0xf4f1ea);
        bumper(bumpEndR, total, rz0, rz1);
        plate(false, zT - 3.8, PLATE_TAXI);
        exhaust();
        break;
      }
      default: {
        const hatch = style === 'hatch' || style === 'suv';
        const z1 = zT - 0.45;
        const z2 = zT - (style === 'suv' ? 2.4 : 1.9);
        const inner = w0 - (hatch ? 0.09 : 0.13);
        const tip = w0 + 0.6 * cornerR;
        rear(rect(0, rz1 + 0.5, inner + 0.01, rz1 + 0.6), shade(paint, 0.5), 0.6);
        rear([[inner, z1], [tip, z1 + 0.1], [tip, z2 - 0.4], [inner + 0.06, z2], [inner, z2 + 0.3]], TAIL_DEEP);
        rear([[inner + 0.005, z1 - 0.2], [tip - 0.01, z1 - 0.1], [tip - 0.01, z1 - 0.55], [inner + 0.005, z1 - 0.6]], TAIL);
        rear(rect(inner + 0.01, z2 + 0.35, inner + 0.06, z1 - 0.75), 0xf4f1ea, 0.9);
        if (!hatch) rear(rect(0, z1 - 0.55, inner, z1 - 0.25), TAIL, 0.85);
        if (style === 'suv') rear(rect(0, z0 + 6.5, 0.035, z0 + 7.2), CHROME, 0.9, 0, true);
        bumper(bumpEndR, total, rz0, rz1);
        rear(rect(0, rz0, w0 - 0.02, rz0 + 1.3), style === 'suv' ? 0xa8adb6 : 0x18171d, 1, offB, style === 'suv');
        rear(rect(w0 + 0.1 * cornerR, rz0 + 1.8, w0 + 0.5 * cornerR, rz0 + 2.3), TAIL_DEEP, 0.9, offB);
        plate(false, style === 'suv' || hatch ? rz1 + 1.4 : rz1 - 1.3, PLATE);
        exhaust();
      }
    }
  };
  if (frontShows) {
    rearEnd();
    frontEnd();
  } else {
    frontEnd();
    rearEnd();
  }

  const mirrorU = nth(st, iCowl).ut - 0.05;
  const belt = nth(st, iCowl).ze + sp.sz;
  // A door mirror at the foot of the windscreen pillar: a painted housing jutting from the side, its glass facing back.
  const mirror = (side: number): void => {
    const lo = Math.min(side * (w - 0.03), side * (w + 0.07));
    const hi = Math.max(side * (w - 0.03), side * (w + 0.07));
    const za = belt - 0.1;
    const zb = belt + 1.5;
    const housing = rounded(mirrorU - 0.05, lo, mirrorU, hi, 0.015);
    const capTop = rounded(mirrorU - 0.045, lo + 0.005, mirrorU - 0.005, hi - 0.005, 0.013);
    block(housing, capTop, za, zb, clad ? PLASTIC : paint, tone(clad ? PLASTIC : paint, [0, 0, 1]));
    const back = mirrorU - 0.05;
    if (-c - s > 0.05) quad([[back, lo + 0.015, za + 0.25], [back, hi - 0.015, za + 0.25], [back, hi - 0.015, zb - 0.25], [back, lo + 0.015, zb - 0.25]], mix(GLASS_LIT, glassBase, 0.4), 0.9);
  };
  if (style !== 'bus' && sideShows < 0.9) mirror(-nearSide);

  // The upper body painted far to near, with a pickup's open bed sunk in before the cab around it.
  const order = cells.flat().filter((x): x is Cell => x !== undefined && x.facing > 0);
  const bedLow = (x: Cell): boolean => segAt(x.i) === 'bed' || (style === 'pickup' && x.i >= iBack);
  order.sort((a, b) => (bedLow(a) ? -1e6 : a.depth) - (bedLow(b) ? -1e6 : b.depth));
  let bedDone = style !== 'pickup';
  const drawBed = (): void => {
    const zb = nth(st, iBack).ze + sp.sz + 0.04;
    const zf = zb - 5.2;
    const ua = nth(st, iBack).ut - 0.025;
    const ub = -hl + 0.035;
    const vv = w - 0.045;
    quad([[ua, -vv, zb], [ub, -vv, zb], [ub, vv, zb], [ua, vv, zb]], shade(BED, 0.3));
    const walls: [V3[], V3][] = [
      [[[ua, -vv, zb], [ua, vv, zb], [ua, vv, zf], [ua, -vv, zf]], [-1, 0, 0]],
      [[[ub, -vv, zb], [ub, vv, zb], [ub, vv, zf], [ub, -vv, zf]], [1, 0, 0]],
      [[[ua, -vv, zb], [ub, -vv, zb], [ub, -vv, zf], [ua, -vv, zf]], [0, 1, 0]],
      [[[ua, vv, zb], [ub, vv, zb], [ub, vv, zf], [ua, vv, zf]], [0, -1, 0]],
    ];
    const lift = (2 * (zb - zf)) / Z_PER_TILE;
    const du = 0.612 * lift * (c + s);
    const dv = 0.612 * lift * (c - s);
    const fu0 = Math.max(ub, ub - du);
    const fu1 = Math.min(ua, ua - du);
    const fv0 = Math.max(-vv, -vv - dv);
    const fv1 = Math.min(vv, vv - dv);
    if (fu1 > fu0 && fv1 > fv0) {
      quad([[fu1, fv0, zf], [fu0, fv0, zf], [fu0, fv1, zf], [fu1, fv1, zf]], tone(mix(BED, 0x6a6672, 0.25), [0, 0, 1], 0.2));
      for (let k = 1; k < 7; k++) {
        const v = -vv + (k * 2 * vv) / 7;
        if (v > fv0 + 0.005 && v < fv1 - 0.005) line([fu1, v, zf], [fu0, v, zf], 0.5, 0x24212a, 0.4);
      }
    }
    for (const [pts, n] of walls) if (facingOf(n) > 0) quad(pts, tone(mix(BED, paint, 0.15), n, 0.2));
  };
  for (const cell of order) {
    if (!bedDone && !bedLow(cell)) {
      drawBed();
      bedDone = true;
    }
    fill(cell.pts.map(at3), isGlass(cell) ? glassTone(cell.n) : tone(paint, cell.n));
  }
  if (!bedDone) drawBed();

  // Glasshouse dressing: pillars, window trim, sky reflections and highlight streaks, wipers.
  const trimCol = style === 'taxi' || style === 'sedan' ? CHROME : TRIM;
  const glassFrom = iCowl;
  const glassTo = iGlassEnd;
  bothSides((side) => rect(glassFrom, Math.min(bandOf(side, 0), bandOf(side, 0.09)), glassTo, Math.max(bandOf(side, 0), bandOf(side, 0.09))), (n) => tone(trimCol, n, 0.9));
  bothSides((side) => rect(glassFrom, Math.min(bandOf(side, 0.91), bandOf(side, 1)), glassTo, Math.max(bandOf(side, 0.91), bandOf(side, 1))), (n) => tone(TRIM, n, 0.6), 0.85);
  bothSides((side) => rect(iCowl, side < 0 ? 2 : 5.76, iRoofF, side < 0 ? 2.24 : 6), paintTone);
  bothSides((side) => rect(iCowl, Math.min(bandOf(side, 0.8), bandOf(side, 1)), iRoofF, Math.max(bandOf(side, 0.8), bandOf(side, 1))), paintTone);
  const pillar = (u: number, half: number, col: (n: V3) => number): void => {
    const a = fiAt(u + half);
    const b = fiAt(u - half);
    bothSides((side) => rect(a, Math.min(bandOf(side, 0), bandOf(side, 1)), b, Math.max(bandOf(side, 0), bandOf(side, 1))), col);
  };
  if (style !== 'bus') pillar(sp.pillarB, 0.022, (n) => tone(TRIM, n, 0.7));
  if (style === 'hatch') pillar(-0.37, 0.03, paintTone);
  if (style === 'suv') pillar(-0.44, 0.02, (n) => tone(TRIM, n, 0.7));
  if (style === 'bus') {
    for (let u = nth(st, iRoofF).ut - 0.3; u > -hl + 0.2; u -= 0.33) pillar(u, 0.016, (n) => tone(TRIM, n, 0.7));
    bothSides((side) => rect(iRoofF - 0.2, Math.min(bandOf(side, 0.76), bandOf(side, 1)), iRoofR, Math.max(bandOf(side, 0.76), bandOf(side, 1))), paintTone);
    bothSides((side) => rect(iRoofF - 0.2, Math.min(bandOf(side, 0.73), bandOf(side, 0.76)), iRoofR, Math.max(bandOf(side, 0.73), bandOf(side, 0.76))), (n) => tone(TRIM, n));
  }
  const glassSpan = glassTo - glassFrom;
  bothSides((side) => {
    const a = bandOf(side, 0.55);
    const b = bandOf(side, 0.95);
    return rect(glassFrom + 0.3, Math.min(a, b), glassTo, Math.max(a, b));
  }, SKY, 0.13);
  for (const [t0, wd, al] of [[0.3, 0.12, 0.2], [0.47, 0.04, 0.28], [0.75, 0.06, 0.14]] as const) {
    bothSides((side) => {
      const lo = glassFrom + glassSpan * t0;
      const sk = glassSpan * 0.12;
      return [[lo, bandOf(side, 0.08)], [lo + glassSpan * wd, bandOf(side, 0.08)], [lo + glassSpan * wd - sk, bandOf(side, 0.9)], [lo - sk, bandOf(side, 0.9)]];
    }, 0xffffff, al);
  }
  onUpper([[iCowl + 0.25, 2.5], [iCowl + 0.4, 2.5], [iRoofF - 0.15, 3.6], [iRoofF - 0.3, 3.6]], 0xffffff, 0.16);
  onUpper([[iCowl + 0.2, 4.4], [iCowl + 0.32, 4.4], [iRoofF - 0.22, 5.4], [iRoofF - 0.34, 5.4]], 0xffffff, 0.1);
  onUpper(rect(iRoofF - 0.28, 2.15, iRoofF, 5.85), glassBase, 0.4);
  if (style !== 'bus') {
    onUpper([[iCowl + 0.07, 2.45], [iCowl + 0.12, 2.45], [iCowl + 0.2, 3.85], [iCowl + 0.15, 3.85]], TRIM, 0.95);
    onUpper([[iCowl + 0.07, 4.15], [iCowl + 0.12, 4.15], [iCowl + 0.2, 5.55], [iCowl + 0.15, 5.55]], TRIM, 0.95);
  }
  const rearSpan = iBack - iRoofR;
  if (rearSpan > 0 && style !== 'van' && style !== 'bus') {
    onUpper([[iRoofR + rearSpan * 0.15, 2.7], [iRoofR + rearSpan * 0.3, 2.7], [iRoofR + rearSpan * 0.8, 3.5], [iRoofR + rearSpan * 0.65, 3.5]], 0xffffff, 0.12);
    onUpper(rect(iRoofR + 0.04, 3.65, iRoofR + 0.12, 4.35), TAIL, 0.9);
    if (style === 'hatch' || style === 'suv') onUpper([[iBack - 0.12, 3.9], [iBack - 0.06, 3.9], [iRoofR + rearSpan * 0.35, 5.2], [iRoofR + rearSpan * 0.35 - 0.05, 5.2]], TRIM, 0.9);
  }
  if (style === 'van') {
    const a = iRoofR + 0.12;
    const b = iRoofR + 0.6;
    onUpper(rect(a, 2.3, b, 3.88), glassTone([-1, 0, 0.3]));
    onUpper(rect(a, 4.12, b, 5.7), glassTone([-1, 0, 0.3]));
    onUpper(rect(iRoofR, 3.97, iBack, 4.03), shade(paint, 0.55), 0.8);
    onUpper(rect(iRoofR + 0.65, 2.2, iRoofR + 0.7, 2.8), TAIL, 0.9);
    onUpper(rect(iRoofR + 0.65, 5.2, iRoofR + 0.7, 5.8), TAIL, 0.9);
  }
  if (style === 'bus') {
    onUpper(rect(iRoofR + 0.1, 2.4, iRoofR + 0.42, 5.6), glassTone([-1, 0, 0.2]));
    const a = iCowl + 1.1;
    onUpper(rect(a, 2.3, a + 0.55, 5.7), 0x121116);
    for (let fj = 2.5; fj < 5.4; fj += 0.32) onUpper(rect(a + 0.18, fj, a + 0.36, fj + 0.18), AMBER, 0.95);
    onUpper([[iCowl + 0.3, 2.6], [iCowl + 0.5, 2.6], [iCowl + 0.95, 3.6], [iCowl + 0.75, 3.6]], 0xffffff, 0.14);
  }
  if (style === 'sedan') {
    const a = iRoofF + 0.12;
    const b = iRoofF + 0.55;
    onUpper(rect(a - 0.04, 3.05, b + 0.04, 4.95), TRIM, 0.9);
    onUpper(rect(a, 3.2, b, 4.8), glassTone([0, 0, 1]));
    onUpper([[a + 0.1, 3.3], [a + 0.18, 3.3], [a + 0.08, 4.7], [a, 4.7]], 0xffffff, 0.2);
  }
  // Highlights along the shoulder crease and the roof edge, where the curved panels catch the sun.
  bothSides((side) => rect(0, side < 0 ? 0.9 : 7, st.length - 1, side < 0 ? 1 : 7.1), (n) => mix(tone(paint, n), SPEC, 0.35), 0.5);
  bothSides((side) => rect(iRoofF, side < 0 ? 2 : 5.92, iRoofR, side < 0 ? 2.08 : 6), (n) => mix(tone(paint, n), SPEC, 0.4), 0.6);

  // Roof furniture: rails, sign, antenna, spoiler, air-conditioning pods.
  const roofU = (u: number, fj: number, dz: number): V3 => {
    const p = upAt(fiAt(u), fj);
    return [p[0], p[1], p[2] + dz];
  };
  if (style === 'suv') {
    const sides = nearSide < 0 ? [5.6, 2.4] : [2.4, 5.6];
    for (const fj of sides) {
      const a = roofU(0.06, fj, 0);
      const b = roofU(-0.58, fj, 0);
      for (const u of [0.04, -0.27, -0.56]) line(roofU(u, fj, 0), roofU(u, fj, 1.3), 1.1, TRIM, 1);
      line([a[0], a[1], a[2] + 1.2], [b[0], b[1], b[2] + 1.2], 1.2, TRIM, 1);
      line([a[0], a[1], a[2] + 1.5], [b[0], b[1], b[2] + 1.5], 0.5, 0x8a8a96, 0.9);
    }
  }
  if (style === 'taxi') {
    const top = nth(st, iRoofF).zc;
    const sign = rounded(-0.18, -0.12, -0.03, 0.12, 0.03);
    const signTop = rounded(-0.17, -0.11, -0.04, 0.11, 0.03);
    block(sign, signTop, top - 0.4, top + 2.9, TAXI_SIGN, lit(TAXI_SIGN, 0.3));
    const face = frontShows ? -0.03 : -0.18;
    for (let k = 0; k < 4; k++) {
      const v = -0.075 + k * 0.05;
      quad([[face, v - 0.016, top + 0.6], [face, v + 0.016, top + 0.6], [face, v + 0.016, top + 2.2], [face, v - 0.016, top + 2.2]], TRIM, 0.85 * clamp01((frontShows ? c + s : -c - s) * 2));
    }
    line([-0.17, nearSide * 0.12, top + 1.4], [-0.04, nearSide * 0.12, top + 1.4], 1.2, TRIM, 0.9 * sideShows);
  }
  if (style === 'sedan' || style === 'hatch' || style === 'suv') {
    const fin = roofU(nth(st, iRoofR).ut + 0.08, 4, -0.1);
    const base = rounded(fin[0] - 0.06, -0.018, fin[0] + 0.02, 0.018, 0.012);
    const tip = rounded(fin[0] - 0.05, -0.01, fin[0] - 0.02, 0.01, 0.008);
    block(base, tip, fin[2], fin[2] + 1.9, TRIM, tone(TRIM, [0, 0, 1]));
  }
  if (style === 'hatch') {
    const u = nth(st, iRoofR).ut;
    const z = nth(st, iRoofR).zr;
    const sp0 = rounded(u - 0.045, -(w - sp.gi - 0.01), u + 0.01, w - sp.gi - 0.01, 0.02);
    const sp1 = rounded(u - 0.04, -(w - sp.gi - 0.015), u + 0.015, w - sp.gi - 0.015, 0.02);
    block(sp0, sp1, z - 0.6, z + 0.5, paint, tone(paint, [0, 0, 1]));
  }
  if (style === 'pickup') {
    const z = nth(st, iRoofF).zr;
    line(roofU(nth(st, iCowl).ut - 0.08, nearSide < 0 ? 2.1 : 5.9, -2), [nth(st, iCowl).ut - 0.12, nearSide * (w - 0.08), z + 7], 0.4, TRIM, 0.9);
  }
  if (style === 'bus') {
    const top = nth(st, iRoofF).zc;
    for (const u of [-0.75, 0.3]) {
      const pod = rounded(u - 0.22, -0.18, u + 0.22, 0.18, 0.05);
      const podTop = rounded(u - 0.2, -0.16, u + 0.2, 0.16, 0.05);
      block(pod, podTop, top - 0.2, top + 2.6, 0xd8dade, lit(0xd8dade, 0.3));
      for (let k = -1; k <= 1; k++) quad(rounded(u - 0.05 + k * 0.12, -0.08, u + 0.05 + k * 0.12, 0.08, 0.02).map(([a, b]) => [a, b, top + 2.61] as const), 0x9aa0a8, 0.8);
    }
    const v = nearSide * (w + 0.002);
    quad([[hl - 0.1, v, 11.3], [-hl + 0.1, v, 11.3], [-hl + 0.1, v, 12.0], [hl - 0.1, v, 12.0]], 0xf2efe6, 0.9 * sideShows);
    const doorSide = 1;
    if (nearSide === doorSide) {
      for (const [ua, ub] of [[hl - 0.4, hl - 0.16], [0.12, -0.14]] as const) {
        const ztop = 24.6;
        quad([[ua, doorSide * (w + 0.002), z0 + 0.4], [ub, doorSide * (w + 0.002), z0 + 0.4], [ub, doorSide * (w - 0.02), ztop], [ua, doorSide * (w - 0.02), ztop]], TRIM, sideShows);
        for (const [pa, pb] of [[ua - 0.015, (ua + ub) / 2 + 0.004], [(ua + ub) / 2 - 0.004, ub + 0.015]] as const) {
          quad([[pa, doorSide * (w + 0.003), z0 + 1.2], [pb, doorSide * (w + 0.003), z0 + 1.2], [pb, doorSide * (w - 0.018), ztop - 0.8], [pa, doorSide * (w - 0.018), ztop - 0.8]], glassTone([0, doorSide, 0.15]), sideShows);
        }
      }
    }
  }
  if (style !== 'bus') mirror(nearSide);
}
