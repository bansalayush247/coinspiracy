// Port Concord's cars in the city's low-poly style: sedans, hatchbacks, SUVs, vans, pickups, taxis and buses. Parked
// and driven cars stay inside the body the server collides with; only ambient buses are longer.
import type Phaser from 'phaser';
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '@byzantine-council/shared/city';
import { P, fan } from '../beach/beachArt.js';
import { ART_SCALE } from '../game/iso.js';
import { lit, mix, shade } from '../game/palette.js';

type G = Phaser.GameObjects.Graphics;
type UV = readonly [number, number];

export type CarStyle = 'sedan' | 'hatch' | 'suv' | 'van' | 'pickup' | 'taxi' | 'bus';

/** Paints for ambient traffic: everyday metallics, a few brights and some dark tones. */
export const CAR_PAINTS = [
  0xd9534f, 0x4f8fd9, 0xe9e2d6, 0x3b3f4a, 0x5fb87a, 0x8a5fd9, 0xf08a4b, 0xa7b3c6,
  0x2c4f7a, 0x8e3a30, 0x6f8a6a, 0xd8c8a8, 0x2f7a7a, 0xc84a7a, 0x5a5a62, 0xf2efe8,
] as const;

const GLASS = 0x22323f;
const GLASS_LIT = 0x5d7c92;
const TYRE = 0x16141b;
const RIM = 0xc9ccd4;
const TRIM = 0x2a2830;
const LED = 0xfff6da;
const TAIL = 0xff3b4a;
const PLATE = 0xf4f0e2;
const TAXI_YELLOW = 0xf2c230;
const TAXI_SIGN = 0xfff3c4;
const BED = 0x2e2a30;
const SHADOW = 0x1e1426;
const SHADOW_SHIFT = 0.14;
const BUS_HALF_LENGTH = 1.45;
const BUS_HALF_WIDTH = 0.42;
const HATCH_HALF_LENGTH = 0.66;

// The eight server car colours, each with the body it is always built as, so every screen agrees.
const BY_COLOR: ReadonlyMap<number, CarStyle> = new Map([
  [0xd9534f, 'hatch'], [0x4f8fd9, 'sedan'], [0xf0c05a, 'taxi'], [0x5fb87a, 'suv'],
  [0xe9e2d6, 'van'], [0x8a5fd9, 'sedan'], [0x3b3f4a, 'pickup'], [0xf08a4b, 'hatch'],
]);
const FALLBACK: readonly CarStyle[] = ['sedan', 'hatch', 'suv', 'van', 'pickup'];

interface Cabin {
  readonly base: UV;
  readonly top: UV;
  readonly inset: number;
  readonly topInset: number;
  readonly z1: number;
  readonly kind: 'glass' | 'body' | 'bed';
}
interface Shape {
  readonly hl: number;
  readonly hw: number;
  readonly cut: number;
  readonly body: number;
  readonly wheel: number;
  readonly cabins: readonly Cabin[];
}

const glass = (base: UV, top: UV, z1: number): Cabin => ({ base, top, inset: 0.07, topInset: 0.12, z1, kind: 'glass' });

function shapeOf(style: CarStyle): Shape {
  const hl = CAR_HALF_LENGTH;
  const hw = CAR_HALF_WIDTH;
  switch (style) {
    case 'hatch':
      return { hl: HATCH_HALF_LENGTH, hw: hw - 0.02, cut: 0.2, body: 10.5, wheel: 0.95, cabins: [glass([-0.6, 0.22], [-0.54, 0.02], 17)] };
    case 'suv':
      return { hl, hw, cut: 0.16, body: 12, wheel: 1.15, cabins: [glass([-0.7, 0.26], [-0.66, 0.06], 20)] };
    case 'van':
      return { hl, hw, cut: 0.14, body: 12, wheel: 1.05, cabins: [
        { base: [-0.73, -0.02], top: [-0.73, -0.02], inset: 0.03, topInset: 0.05, z1: 21.5, kind: 'body' },
        { base: [-0.02, 0.42], top: [-0.02, 0.22], inset: 0.03, topInset: 0.05, z1: 21.5, kind: 'glass' },
      ] };
    case 'pickup':
      return { hl, hw, cut: 0.16, body: 11, wheel: 1.15, cabins: [
        { base: [-0.72, -0.17], top: [-0.72, -0.17], inset: 0.03, topInset: 0.03, z1: 14, kind: 'bed' },
        glass([-0.15, 0.3], [-0.11, 0.12], 18.5),
      ] };
    case 'bus':
      return { hl: BUS_HALF_LENGTH, hw: BUS_HALF_WIDTH, cut: 0.1, body: 25, wheel: 1.25, cabins: [] };
    default:
      return { hl, hw, cut: 0.2, body: 10.5, wheel: 1, cabins: [glass([-0.46, 0.3], [-0.3, 0.08], 17)] };
  }
}

/** The body a parked or driven car in `color` is built as. */
export function styleForColor(color: number): CarStyle {
  return BY_COLOR.get(color) ?? FALLBACK[(color >>> 4) % FALLBACK.length] ?? 'sedan';
}

/** Half the length of a car of `style`, for spacing ambient traffic. */
export function carHalfLength(style: CarStyle): number {
  return shapeOf(style).hl;
}

/** Half the width of a car of `style`, for keeping ambient traffic out of player cars. */
export function carHalfWidth(style: CarStyle): number {
  return shapeOf(style).hw;
}

// A filled outline that may be concave, such as a curved sail or a hull's plan.
function fillPoly(g: G, pts: readonly { readonly x: number; readonly y: number }[]): void {
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

/**
 * Draws a car facing `heading` (radians, world space) around its middle; `occupied` darkens the glass as if someone
 * is in. `style` picks the body; left out, the colour decides it, as for the server's parked cars.
 */
export function drawModernCar(g: G, heading: number, color: number, occupied = false, style: CarStyle = styleForColor(color)): void {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const at = (u: number, v: number, z: number) => P(u * c - v * s, u * s + v * c, z);
  const shape = shapeOf(style);
  const { hl, hw, cut } = shape;
  const paint = style === 'taxi' ? TAXI_YELLOW : color;
  const glassCol = occupied ? mix(GLASS, 0x000000, 0.35) : GLASS;
  // Sides facing the camera, lit from the left; `top` closes the solid. Base and top rings share a vertex order.
  const solid = (base: readonly UV[], top: readonly UV[], z0: number, z1: number, side: number, roof: number | null): void => {
    const cu = base.reduce((a, p) => a + p[0], 0) / base.length;
    const cv = base.reduce((a, p) => a + p[1], 0) / base.length;
    for (let i = 0; i < base.length; i++) {
      const a = base[i];
      const b = base[(i + 1) % base.length];
      const ta = top[i];
      const tb = top[(i + 1) % top.length];
      if (a === undefined || b === undefined || ta === undefined || tb === undefined) continue;
      const mu = (a[0] + b[0]) / 2 - cu;
      const mv = (a[1] + b[1]) / 2 - cv;
      const nx = mu * c - mv * s;
      const ny = mu * s + mv * c;
      if (nx + ny <= 1e-6) continue;
      const light = (nx - ny) / Math.hypot(nx, ny);
      const col = light > 0.35 ? shade(side, 0.28) : light < -0.35 ? lit(side, 0.06) : shade(side, 0.1);
      fan(g, col, [at(a[0], a[1], z0), at(b[0], b[1], z0), at(tb[0], tb[1], z1), at(ta[0], ta[1], z1)]);
    }
    if (roof !== null) fan(g, roof, top.map(([u, v]) => at(u, v, z1)));
  };
  const quad = (pts: readonly [number, number, number][], col: number, alpha = 1): void => {
    g.fillStyle(col, alpha);
    fillPoly(g, pts.map(([u, v, z]) => at(u, v, z)));
  };
  const line = (a: readonly [number, number, number], b: readonly [number, number, number], width: number, col: number, alpha = 1): void => {
    const p = at(...a);
    const q = at(...b);
    g.lineStyle(width * ART_SCALE, col, alpha);
    g.lineBetween(p.x, p.y, q.x, q.y);
  };
  const nearSide = c - s > 0 ? 1 : -1;
  const frontShows = c + s > 0;
  g.clear();

  const shadowShift = SHADOW_SHIFT * (shape.body / 10.5);
  g.fillStyle(SHADOW, 0.24);
  fillPoly(g, rounded(-hl - 0.02, -hw - 0.02, hl + 0.02, hw + 0.02, cut).map(([u, v]) => P(u * c - v * s + shadowShift, u * s + v * c, 0)));

  const wheels = (side: number): void => {
    const r = shape.wheel;
    const axles = style === 'bus' ? [-hl + 0.38, hl - 0.42] : [-hl + 0.28, hl - 0.27];
    for (const u of axles) {
      const w = at(u, side * (hw - 0.02), 3.4 * r);
      g.fillStyle(TYRE, 1);
      g.fillEllipse(w.x, w.y, 10 * r * ART_SCALE, 9 * r * ART_SCALE);
      g.fillStyle(RIM, 1);
      g.fillEllipse(w.x, w.y, 5.4 * r * ART_SCALE, 4.8 * r * ART_SCALE);
      g.fillStyle(lit(RIM, 0.5), 1);
      g.fillEllipse(w.x - 0.8 * r * ART_SCALE, w.y - 0.8 * r * ART_SCALE, 2.4 * r * ART_SCALE, 1.6 * r * ART_SCALE);
      g.fillStyle(mix(RIM, TYRE, 0.55), 1);
      g.fillEllipse(w.x, w.y, 1.8 * r * ART_SCALE, 1.6 * r * ART_SCALE);
    }
  };
  wheels(-nearSide);
  const sill = rounded(-hl + 0.04, -hw + 0.04, hl - 0.04, hw - 0.04, cut * 0.7);
  solid(sill, sill, 2.2, 4, TRIM, null);
  wheels(nearSide);

  const body = rounded(-hl, -hw, hl, hw, cut);
  const shoulder = rounded(-hl + 0.03, -hw + 0.03, hl - 0.05, hw - 0.03, cut + 0.02);
  solid(body, shoulder, 4, shape.body, paint, lit(paint, 0.22));
  if (style !== 'bus' && style !== 'van') {
    quad([[hl - 0.36, -0.08, shape.body], [hl - 0.1, -0.06, shape.body], [hl - 0.1, 0.06, shape.body], [hl - 0.36, 0.08, shape.body]], lit(paint, 0.45), 0.6);
  }

  const cabins = [...shape.cabins].sort((a, b) => (frontShows ? 1 : -1) * (a.base[0] + a.base[1] - (b.base[0] + b.base[1])));
  for (const cab of cabins) {
    const base: UV[] = [[cab.base[0], -hw + cab.inset], [cab.base[1], -hw + cab.inset], [cab.base[1], hw - cab.inset], [cab.base[0], hw - cab.inset]];
    const top: UV[] = [[cab.top[0], -hw + cab.topInset], [cab.top[1], -hw + cab.topInset], [cab.top[1], hw - cab.topInset], [cab.top[0], hw - cab.topInset]];
    if (cab.kind === 'bed') {
      solid(base, top, shape.body, cab.z1, paint, lit(paint, 0.3));
      quad([[cab.base[0] + 0.05, -hw + 0.09, cab.z1], [cab.base[1] - 0.03, -hw + 0.09, cab.z1], [cab.base[1] - 0.03, hw - 0.09, cab.z1], [cab.base[0] + 0.05, hw - 0.09, cab.z1]], BED);
      continue;
    }
    const roof = shade(paint, 0.04);
    solid(base, top, shape.body, cab.z1, cab.kind === 'glass' ? glassCol : paint, cab.kind === 'glass' ? roof : lit(paint, 0.22));
    if (cab.kind !== 'glass') continue;
    const [t0, t1] = cab.top;
    quad([[t0 + 0.04, -0.12, cab.z1], [t1 - 0.06, -0.12, cab.z1], [t1 - 0.06, 0.12, cab.z1], [t0 + 0.04, 0.12, cab.z1]], lit(paint, 0.35), 0.5);
    const [b0, b1] = cab.base;
    const v0 = nearSide * (hw - cab.inset);
    const v1 = nearSide * (hw - cab.topInset);
    const z0 = shape.body + 1;
    const z1 = cab.z1 - 1.5;
    quad([[b0 + (b1 - b0) * 0.3, v0, z0], [b0 + (b1 - b0) * 0.62, v0, z0], [t0 + (t1 - t0) * 0.55, v1, z1], [t0 + (t1 - t0) * 0.2, v1, z1]], GLASS_LIT, 0.55);
    const k = (t0 + t1) / 2 - (b0 + b1) / 2;
    const midBase = (b0 + b1) / 2 + 0.02;
    if (b1 - b0 > 0.5) line([midBase, v0, shape.body], [midBase + k, v1, cab.z1], 1.6, roof, 1);
  }

  if (style === 'suv') {
    for (const v of [-hw + 0.15, hw - 0.15]) line([-0.62, v, 21], [0.02, v, 21], 1, TRIM, 0.9);
  }
  if (style === 'van') {
    line([-0.12, nearSide * hw, 5], [-0.12, nearSide * (hw - 0.03), 20], 0.7, shade(paint, 0.45), 0.8);
    quad([[-hl + 0.05, nearSide * (hw - 0.03), 14], [-0.04, nearSide * (hw - 0.03), 14], [-0.04, nearSide * (hw - 0.03), 15.6], [-hl + 0.05, nearSide * (hw - 0.03), 15.6]], lit(paint, 0.35), 0.9);
  }
  if (style === 'bus') {
    const v = nearSide * hw;
    quad([[-hl + 0.12, v, 13], [hl - 0.3, v, 13], [hl - 0.3, v, 21.5], [-hl + 0.12, v, 21.5]], glassCol);
    for (let u = -hl + 0.42; u < hl - 0.32; u += 0.32) line([u, v, 13], [u, v, 21.5], 1.4, paint, 1);
    quad([[-hl + 0.12, v, 20.2], [hl - 0.3, v, 20.2], [hl - 0.3, v, 21.5], [-hl + 0.12, v, 21.5]], GLASS_LIT, 0.5);
    quad([[hl - 0.28, v, 5], [hl - 0.08, v, 5], [hl - 0.08, v, 21.5], [hl - 0.28, v, 21.5]], mix(glassCol, paint, 0.15));
    quad([[-hl + 0.1, v, 10.5], [hl - 0.3, v, 10.5], [hl - 0.3, v, 11.8], [-hl + 0.1, v, 11.8]], lit(paint, 0.4));
    for (const u of [-0.7, 0.35]) solid(rounded(u - 0.2, -0.16, u + 0.2, 0.16, 0.04), rounded(u - 0.2, -0.16, u + 0.2, 0.16, 0.04), shape.body, shape.body + 2.4, 0xd8dade, lit(0xd8dade, 0.3));
  }
  if (style === 'taxi') {
    const v = nearSide * hw;
    for (let i = 0, u = -hl + 0.22; u < hl - 0.24; i++, u += 0.08) {
      if (i % 2 === 0) quad([[u, v, 7.8], [u + 0.08, v, 7.8], [u + 0.08, v, 9], [u, v, 9]], TRIM, 0.85);
    }
    const sign = rounded(-0.2, -0.11, -0.04, 0.11, 0.03);
    solid(sign, sign, 17, 19.8, TAXI_SIGN, lit(TAXI_SIGN, 0.3));
    line([-0.17, nearSide * 0.11, 18.4], [-0.07, nearSide * 0.11, 18.4], 0.9, TRIM, 0.9);
  }

  if (style !== 'bus') {
    const beltZ = shape.body - 0.9;
    line([-hl + 0.22, nearSide * hw, beltZ], [hl - 0.24, nearSide * hw, beltZ], 0.9, TRIM, 0.6);
    const mirrorU = shape.cabins.find((cab) => cab.kind === 'glass')?.base[1] ?? 0.3;
    for (const v of [-hw, hw]) {
      const m = at(mirrorU, v * 1.04, shape.body + 0.7);
      g.fillStyle(shade(paint, 0.2), 1);
      g.fillEllipse(m.x, m.y, 3 * ART_SCALE, 2 * ART_SCALE);
    }
  }

  const end = frontShows ? hl : -hl;
  const lampZ = style === 'bus' ? 7 : shape.body - 3;
  const flat = hw - cut;
  for (const side of [-1, 1]) {
    const va = side * (flat - 0.005);
    const vb = side * Math.max(0.05, flat - 0.13);
    quad([[end, va, lampZ], [end, vb, lampZ], [end, vb, lampZ + 1.8], [end, va, lampZ + 1.8]], frontShows ? LED : TAIL);
    const glow = at(end, (va + vb) / 2, lampZ + 0.9);
    g.fillStyle(frontShows ? LED : TAIL, 0.28);
    g.fillCircle(glow.x, glow.y, 3.2 * ART_SCALE);
  }
  if (frontShows) {
    const grille = flat * 0.8;
    quad([[hl, -grille, lampZ - 2.8], [hl, grille, lampZ - 2.8], [hl, grille, lampZ - 0.8], [hl, -grille, lampZ - 0.8]], TRIM);
  } else {
    line([-hl, -flat, lampZ + 0.9], [-hl, flat, lampZ + 0.9], 0.8, TAIL, 0.8);
    quad([[-hl, -0.09, lampZ - 2.8], [-hl, 0.09, lampZ - 2.8], [-hl, 0.09, lampZ - 1.2], [-hl, -0.09, lampZ - 1.2]], PLATE);
  }
  if (style === 'bus') {
    const u = end;
    quad([[u, -hw + 0.06, 12], [u, hw - 0.06, 12], [u, hw - 0.06, frontShows ? 22 : 21], [u, -hw + 0.06, frontShows ? 22 : 21]], glassCol);
    quad([[u, -hw + 0.1, 20.4], [u, hw - 0.1, 20.4], [u, hw - 0.1, 21.6], [u, -hw + 0.1, 21.6]], frontShows ? 0xffb347 : GLASS_LIT, frontShows ? 1 : 0.5);
  }
}
