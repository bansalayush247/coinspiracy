// Port Concord's ships in the city's isometric style: tapered hulls lit from the west, cabins, rigging and cargo,
// a soft shadow on the water, a bow wave and a foam wake. Each ship's seed picks its colours and its variant.
import type Phaser from 'phaser';
import type { ShipKind } from '@byzantine-council/shared/city';
import { P, fan, prism } from '../beach/beachArt.js';
import { rng } from '../game/groundPaint.js';
import { ART_SCALE, TILE_W } from '../game/iso.js';
import { lit, mix, shade } from '../game/palette.js';

type G = Phaser.GameObjects.Graphics;
type L3 = readonly [number, number, number];
export type ShipHeading = 'n' | 's' | 'e' | 'w';

interface Pt {
  readonly x: number;
  readonly y: number;
}
interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}
interface Part extends Box {
  readonly z: number;
  readonly draw: () => void;
}
interface HullPt {
  readonly u: number;
  readonly v: number;
  readonly z: number;
}

interface HullSpec {
  readonly length: number;
  readonly beam: number;
  readonly stern: number;
  readonly bowStart: number;
  readonly bowPower: number;
  readonly freeboard: number;
  readonly sheer: number;
  readonly band: number;
  readonly hull: number;
  readonly bottom: number;
  readonly boot: number;
  readonly trim: number;
  readonly deck: number;
  readonly rail: number | null;
  readonly planks: boolean;
  readonly wake: number;
}

interface Design {
  readonly hull: HullSpec;
  readonly build: (d: Draft) => void;
}

const S = ART_SCALE;
const EPS = 1e-3;
const HULL_STEPS = 16;
const AFT_FULL = 0.22;
// Boot and sheer stripes as a share of the freeboard, so small boats still show their hull colour.
const BOOT_SHARE = 0.1;
const TRIM_SHARE = 0.14;
const RAIL_H = 4;
const DECK_INSET_U = 0.965;
const DECK_INSET_V = 0.84;
const SHADOW_SHIFT = 0.16;
const BOW_WAVE = 0.07;
const WAKE_STEPS = 6;
const WAKE_SPREAD = 0.3;

const FOAM = 0xf4fbfb;
const CHURN = 0xbfe8ee;
const WATER = 0x2f86b5;
const WATER_SHADOW = 0x0b2238;
const GLASS = 0x26374d;
const GLASS_LIT = 0x46698c;
const GLINT = 0xc4e4f4;
const SOOT = 0x1d1b22;
const ROPE = 0x3b3530;
const SPAR = 0x5a4636;
const STEEL = 0x9aa1ab;
const WHITE = 0xf4efe6;
const NAVY = 0x2c3e66;
const RED = 0xb04a3c;
const ORANGE = 0xf08a3a;
const TEAK = 0xc49a64;
const WORN_DECK = 0x9a8a72;
const STEEL_DECK = 0xc9ccd0;
const CARGO_DECK = 0x7d8a80;
const CRANE = 0xe8b23a;

// Bow along +u, starboard along +v; each heading turns that frame into world tiles.
const FRAMES: Readonly<Record<ShipHeading, (u: number, v: number) => Pt>> = {
  e: (u, v) => ({ x: u, y: v }),
  w: (u, v) => ({ x: -u, y: -v }),
  s: (u, v) => ({ x: -v, y: u }),
  n: (u, v) => ({ x: v, y: -u }),
};

const FERRY_LIVERIES = [
  { hull: WHITE, bottom: NAVY, boot: 0xd9534f, accent: 0x3d79b8, funnel: WHITE, stripe: 0xe8a03a },
  { hull: WHITE, bottom: 0x1f5d52, boot: 0xf0c05a, accent: 0x2f8f7a, funnel: 0x2f8f7a, stripe: 0xf0c05a },
  { hull: 0x2c4f7a, bottom: 0x8a2f2a, boot: WHITE, accent: 0x2c4f7a, funnel: 0xd9534f, stripe: WHITE },
  { hull: 0xf2e6cc, bottom: 0x8a2f2a, boot: NAVY, accent: 0x9e3b32, funnel: 0x9e3b32, stripe: 0xf2e6cc },
] as const;
const CARGO_HULLS = [
  { hull: 0x2b4a6e, bottom: RED, funnel: 0xc0453a, stripe: WHITE },
  { hull: 0x3a3f47, bottom: RED, funnel: 0xe8a03a, stripe: 0x2b4a6e },
  { hull: 0x8e3a30, bottom: 0x2a2630, funnel: 0x2b4a6e, stripe: WHITE },
  { hull: 0x2f6a52, bottom: RED, funnel: 0xf0c05a, stripe: 0x2f6a52 },
] as const;
const CONTAINER_MIXES = [
  [0xc0453a, 0x3f78b8, 0xe2a23a, 0x4f9a66, 0xd9d2c4, 0xb8562e],
  [0x8e3a30, 0x6b5a48, 0x3a5a7a, 0xa8823a, 0x5a6a5a, 0x9e6a4a],
  [0xe2574c, 0x2f9ad0, 0xf2c94c, 0x5fbf7a, 0xb07ad0, 0xf08a4b],
] as const;
const SAILBOAT_HULLS = [WHITE, 0x2c4f7a, 0x9e3b32, 0x2f6a52, 0xe9d9b8] as const;
const SAILS = [0xfbf6ea, 0xf3e6c8, 0xd98b5a, 0xe6eef6, 0xc85a4a] as const;
const FISHING_HULLS = [0x2f6f9a, 0xc8483a, 0x2f7a5e, 0xe2a23a, 0x3a5a8a] as const;
const FISHING_ROOFS = [0xc8483a, 0x2f6f9a, 0xf0c05a, 0x2f7a5e] as const;
const NET_TONES = [0x5b6b4a, 0x7a7a52, 0x4a5a5a] as const;

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

function pick<T>(rand: () => number, list: readonly T[]): T {
  const item = list[Math.floor(rand() * list.length) % list.length];
  if (item === undefined) throw new Error('empty palette');
  return item;
}

// How a face facing world normal (nx, ny) catches the western sun: 1 full light, -1 full shade.
function sunOn(nx: number, ny: number): number {
  return (ny - nx) / (Math.hypot(nx, ny) * Math.SQRT2);
}
function tone(col: number, light: number): number {
  return light >= 0 ? lit(col, 0.04 + 0.2 * light) : shade(col, 0.12 + 0.3 * -light);
}

// Half the beam at t (0 stern, 1 bow): a softened transom, a straight middle and a curved, pointed bow.
function halfBeam(h: HullSpec, t: number): number {
  const w = h.beam / 2;
  if (t >= h.bowStart) return w * (1 - ((t - h.bowStart) / (1 - h.bowStart)) ** h.bowPower);
  if (t >= AFT_FULL) return w;
  return w * (h.stern + (1 - h.stern) * Math.sin((t / AFT_FULL) * (Math.PI / 2)));
}

// The gunwale as a closed loop, starboard from stern to bow then port back, rising toward the bow.
function outline(h: HullSpec): HullPt[] {
  const side: HullPt[] = [];
  for (let i = 0; i <= HULL_STEPS; i++) {
    const t = 1 - (1 - i / HULL_STEPS) ** 1.4;
    side.push({ u: (t - 0.5) * h.length, v: halfBeam(h, t), z: h.freeboard + h.sheer * Math.max(0, 2 * t - 1) ** 2 });
  }
  return [...side, ...side.slice(0, -1).reverse().map((p) => ({ ...p, v: -p.v }))];
}

function bez(a: L3, c: L3, b: L3, t: number): L3 {
  const k = 1 - t;
  return [k * k * a[0] + 2 * k * t * c[0] + t * t * b[0], k * k * a[1] + 2 * k * t * c[1] + t * t * b[1], k * k * a[2] + 2 * k * t * c[2] + t * t * b[2]];
}
function curve(a: L3, c: L3, b: L3, steps = 8): L3[] {
  return Array.from({ length: steps + 1 }, (_, i) => bez(a, c, b, i / steps));
}

// A part must be painted before another when it lies wholly behind it, or under it where their footprints meet.
function before(a: Part, b: Part): boolean {
  if (a.x1 <= b.x0 + EPS || a.y1 <= b.y0 + EPS) return true;
  if (b.x1 <= a.x0 + EPS || b.y1 <= a.y0 + EPS) return false;
  return a.z < b.z;
}
function paintOrder(parts: readonly Part[]): Part[] {
  const left = [...parts].sort((a, b) => a.x0 + a.y0 + a.x1 + a.y1 - (b.x0 + b.y0 + b.x1 + b.y1) || a.z - b.z);
  const out: Part[] = [];
  while (left.length > 0) {
    const i = left.findIndex((p) => !left.some((q) => q !== p && before(q, p) && !before(p, q)));
    out.push(...left.splice(Math.max(0, i), 1));
  }
  return out;
}

// Glass on the two faces of a box that face the camera: a ribbon with mullions, or a row of single windows.
function windows(g: G, b: Box, z0: number, z1: number, pitch: number, ribbon: boolean): void {
  const faces = [
    { len: b.x1 - b.x0, at: (s: number, z: number) => P(b.x0 + s, b.y1, z), glass: GLASS_LIT },
    { len: b.y1 - b.y0, at: (s: number, z: number) => P(b.x1, b.y0 + s, z), glass: GLASS },
  ];
  for (const f of faces) {
    const n = Math.max(1, Math.round(f.len / pitch));
    const spans: [number, number][] = ribbon ? [[Math.min(0.05, f.len * 0.12), f.len - Math.min(0.05, f.len * 0.12)]] : Array.from({ length: n }, (_, i) => [((i + 0.22) * f.len) / n, ((i + 0.78) * f.len) / n]);
    for (const [s0, s1] of spans) {
      g.fillStyle(f.glass, 1);
      fillPoly(g, [f.at(s0, z0), f.at(s1, z0), f.at(s1, z1), f.at(s0, z1)]);
      const a = f.at(s0, z1 - 0.5);
      const c = f.at(s1, z1 - 0.5);
      g.lineStyle(0.7 * S, GLINT, 0.5);
      g.lineBetween(a.x, a.y, c.x, c.y);
    }
    if (!ribbon) continue;
    g.lineStyle(0.7 * S, shade(WHITE, 0.2), 0.8);
    for (let i = 1; i < n; i++) {
      const a = f.at((i * f.len) / n, z0);
      const c = f.at((i * f.len) / n, z1);
      g.lineBetween(a.x, a.y, c.x, c.y);
    }
  }
}

// A painted band round the two faces of a box that face the camera, shaded like the box itself.
function band(g: G, b: Box, z0: number, z1: number, col: number): void {
  fan(g, lit(col, 0.05), [P(b.x0, b.y1, z0), P(b.x1, b.y1, z0), P(b.x1, b.y1, z1), P(b.x0, b.y1, z1)]);
  fan(g, shade(col), [P(b.x1, b.y1, z0), P(b.x1, b.y0, z0), P(b.x1, b.y0, z1), P(b.x1, b.y1, z1)]);
}

// One ship being drawn: its frame, its hull and the parts on deck still waiting to be painted in order.
class Draft {
  readonly parts: Part[] = [];
  readonly under: (() => void)[] = [];
  readonly over: (() => void)[] = [];
  readonly near: number;

  constructor(
    readonly g: G,
    readonly heading: ShipHeading,
    readonly h: HullSpec,
  ) {
    const n = this.world(0, 1);
    this.near = n.x + n.y > 0 ? 1 : -1;
  }

  get l(): number {
    return this.h.length / 2;
  }

  get w(): number {
    return this.h.beam / 2;
  }

  world(u: number, v: number): Pt {
    return FRAMES[this.heading](u, v);
  }

  at(u: number, v: number, z: number): Pt {
    const p = this.world(u, v);
    return P(p.x, p.y, z);
  }

  pt(p: L3): Pt {
    return this.at(p[0], p[1], p[2]);
  }

  // How a face whose outward normal is (nu, nv) in the ship's frame is lit.
  light(nu: number, nv: number): number {
    const n = this.world(nu, nv);
    return sunOn(n.x, n.y);
  }

  box(u0: number, u1: number, v0: number, v1: number): Box {
    const a = this.world(u0, v0);
    const b = this.world(u1, v1);
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  }

  add(u0: number, u1: number, v0: number, v1: number, z: number, draw: () => void): void {
    this.parts.push({ ...this.box(u0, u1, v0, v1), z, draw });
  }

  block(u0: number, u1: number, v0: number, v1: number, z0: number, h: number, col: number, top?: number, dress?: (b: Box) => void): void {
    const b = this.box(u0, u1, v0, v1);
    this.parts.push({ ...b, z: z0, draw: () => {
      prism(this.g, b.x0, b.y0, b.x1, b.y1, z0, h, col, top);
      dress?.(b);
    } });
  }

  line(a: L3, b: L3, width: number, col: number, alpha = 1): void {
    const p = this.pt(a);
    const q = this.pt(b);
    this.g.lineStyle(width * S, col, alpha);
    this.g.lineBetween(p.x, p.y, q.x, q.y);
  }

  poly(points: readonly L3[], col: number, alpha = 1): void {
    this.g.fillStyle(col, alpha);
    fillPoly(this.g, points.map((p) => this.pt(p)));
  }

  // A stack of body, stripe and sooty top, standing at (u, v).
  funnel(u: number, v: number, hu: number, hv: number, z0: number, h: number, body: number, stripe: number): void {
    this.block(u - hu, u + hu, v - hv, v + hv, z0, h * 0.55, body, lit(body, 0.3), (b) => {
      prism(this.g, b.x0, b.y0, b.x1, b.y1, z0 + h * 0.55, h * 0.22, stripe);
      prism(this.g, b.x0, b.y0, b.x1, b.y1, z0 + h * 0.77, h * 0.23, mix(body, SOOT, 0.82), SOOT);
    });
  }

  // A low rail round the roof of a deckhouse, one part per edge so the near edges are painted in front.
  roofRail(u0: number, u1: number, v0: number, v1: number, z: number, col: number): void {
    const edges: [L3, L3][] = [
      [[u0, v0, z], [u1, v0, z]], [[u1, v0, z], [u1, v1, z]],
      [[u1, v1, z], [u0, v1, z]], [[u0, v1, z], [u0, v0, z]],
    ];
    for (const [a, b] of edges) {
      this.add(Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), z + 0.5, () => {
        this.line([a[0], a[1], z + RAIL_H * 0.8], [b[0], b[1], z + RAIL_H * 0.8], 0.9, col, 0.95);
        const steps = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.12));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const u = a[0] + (b[0] - a[0]) * t;
          const v = a[1] + (b[1] - a[1]) * t;
          this.line([u, v, z], [u, v, z + RAIL_H * 0.8], 0.6, col, 0.85);
        }
      });
    }
  }

  // Shadow and reflection on the water, then the wake and the bow wave.
  water(pts: readonly HullPt[], normals: readonly Pt[]): void {
    const { g, h } = this;
    const shift = SHADOW_SHIFT * (h.freeboard / 10);
    g.fillStyle(WATER_SHADOW, 0.26);
    fillPoly(g, pts.map((p) => {
      const w = this.world(p.u * 1.05, p.v * 1.12);
      return P(w.x + shift, w.y, 0);
    }));
    this.poly(pts.map((p) => [p.u, p.v, -h.freeboard * 0.7] as const), mix(h.hull, WATER, 0.62), 0.24);
    const l = this.l;
    const ws = halfBeam(h, 0);
    const len = h.wake;
    this.poly([[-l, ws, 0], [-l - len, ws + len * WAKE_SPREAD, 0], [-l - len, -(ws + len * WAKE_SPREAD), 0], [-l, -ws, 0]], CHURN, 0.07);
    for (const s of [1, -1]) {
      const arm = (t: number, off: number): L3 => [-l - t * len, s * (ws + t * len * WAKE_SPREAD + off), 0];
      for (let k = 0; k < WAKE_STEPS; k++) {
        const t0 = k / WAKE_STEPS;
        const t1 = (k + 1) / WAKE_STEPS;
        this.poly([arm(t0, -0.015), arm(t1, -0.015), arm(t1, 0.02 + t1 * 0.04), arm(t0, 0.02 + t0 * 0.04)], FOAM, 0.5 * (1 - t0) ** 1.5);
      }
    }
    for (let k = 0; k < WAKE_STEPS; k++) {
      const c = this.at(-l - ((k + 0.5) / WAKE_STEPS) * len * 0.85, 0, 0);
      const size = ws * 2 * (0.55 + k * 0.12) * TILE_W * 0.5;
      g.fillStyle(FOAM, 0.22 * (1 - k / WAKE_STEPS) ** 1.5);
      g.fillEllipse(c.x, c.y, size, size * 0.5);
    }
    const bowFrom = (h.bowStart - 0.5) * h.length - 0.15;
    const vertexNormal = (i: number): Pt => {
      const a = normals[(i - 1 + normals.length) % normals.length] ?? { x: 0, y: 0 };
      const b = normals[i] ?? { x: 0, y: 0 };
      const len2 = Math.hypot(a.x + b.x, a.y + b.y) || 1;
      return { x: (a.x + b.x) / len2, y: (a.y + b.y) / len2 };
    };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a === undefined || b === undefined || a.u < bowFrom || b.u < bowFrom) continue;
      const na = vertexNormal(i);
      const nb = vertexNormal((i + 1) % pts.length);
      const reach = (p: HullPt): number => BOW_WAVE * (0.4 + (0.6 * (p.u - bowFrom)) / (l - bowFrom));
      this.poly([[a.u, a.v, 0], [b.u, b.v, 0], [b.u + nb.x * reach(b), b.v + nb.y * reach(b), 0], [a.u + na.x * reach(a), a.v + na.y * reach(a), 0]], FOAM, 0.75);
    }
    for (const s of [1, -1]) {
      const tip = l - h.length * 0.06;
      this.poly([[tip, s * halfBeam(h, 0.94), 0], [bowFrom - 0.25, s * (h.beam / 2 + 0.16), 0], [bowFrom, s * (h.beam / 2 + 0.01), 0]], FOAM, 0.4);
    }
  }

  // The hull sides facing the camera, in bands: antifouling, boot stripe, topsides and a sheer stripe.
  sides(pts: readonly HullPt[], normals: readonly Pt[]): void {
    const { h } = this;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const n = normals[i];
      if (a === undefined || b === undefined || n === undefined) continue;
      const wn = this.world(n.x, n.y);
      if (wn.x + wn.y <= EPS) continue;
      const light = sunOn(wn.x, wn.y);
      const levels = (p: HullPt): number[] => [0, h.band, h.band + h.freeboard * BOOT_SHARE, p.z - h.freeboard * TRIM_SHARE, p.z];
      const la = levels(a);
      const lb = levels(b);
      [h.bottom, h.boot, h.hull, h.trim].forEach((col, k) => {
        this.poly([[a.u, a.v, la[k] ?? 0], [b.u, b.v, lb[k] ?? 0], [b.u, b.v, lb[k + 1] ?? 0], [a.u, a.v, la[k + 1] ?? 0]], tone(col, light));
      });
      this.line([a.u, a.v, a.z], [b.u, b.v, b.z], 0.9, lit(h.trim, 0.45), 0.9);
      this.line([a.u, a.v, 0], [b.u, b.v, 0], 1.6, FOAM, 0.65);
    }
  }

  deck(pts: readonly HullPt[]): void {
    const { h } = this;
    this.poly(pts.map((p) => [p.u, p.v, p.z] as const), lit(h.trim, 0.35));
    const inner = pts.map((p) => [p.u * DECK_INSET_U, p.v * DECK_INSET_V, p.z] as const);
    this.poly(inner, lit(h.deck, 0.12));
    if (!h.planks) return;
    const half = (this.w - 0.02) * DECK_INSET_V;
    for (let k = -2; k <= 2; k++) {
      const v = (k / 3) * half;
      let end = -this.l;
      for (let t = AFT_FULL; t <= 1; t += 0.02) if (halfBeam(h, t) * DECK_INSET_V > Math.abs(v) + 0.03) end = (t - 0.5) * h.length * DECK_INSET_U;
      this.line([-this.l * DECK_INSET_U + 0.02, v, h.freeboard], [end, v, h.freeboard + h.sheer * 0.2], 0.6, shade(h.deck, 0.22), 0.5);
    }
  }

  rails(pts: readonly HullPt[], normals: readonly Pt[], nearSide: boolean): void {
    const col = this.h.rail;
    if (col === null) return;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const n = normals[i];
      if (a === undefined || b === undefined || n === undefined) continue;
      const wn = this.world(n.x, n.y);
      if (wn.x + wn.y > EPS !== nearSide) continue;
      const [au, av, bu, bv] = [a.u * DECK_INSET_U, a.v * DECK_INSET_V, b.u * DECK_INSET_U, b.v * DECK_INSET_V];
      this.line([au, av, a.z + RAIL_H], [bu, bv, b.z + RAIL_H], 0.9, col, 0.95);
      this.line([au, av, a.z], [au, av, a.z + RAIL_H], 0.6, col, 0.85);
    }
  }

  paint(): void {
    const pts = outline(this.h);
    const normals = pts.map((a, i) => {
      const b = pts[(i + 1) % pts.length] ?? a;
      const len = Math.hypot(b.u - a.u, b.v - a.v) || 1;
      const n = { x: (b.v - a.v) / len, y: -(b.u - a.u) / len };
      return n.x * (a.u + b.u) + n.y * (a.v + b.v) < 0 ? { x: -n.x, y: -n.y } : n;
    });
    this.water(pts, normals);
    for (const f of this.under) f();
    this.sides(pts, normals);
    this.deck(pts);
    this.rails(pts, normals, false);
    for (const p of paintOrder(this.parts)) p.draw();
    this.rails(pts, normals, true);
    for (const f of this.over) f();
  }
}

// A passenger ferry: saloon with ribbon windows, one or two decks, a bridge forward and a striped funnel aft.
function ferry(rand: () => number): Design {
  const livery = pick(rand, FERRY_LIVERIES);
  const decks = rand() < 0.5 ? 1 : 2;
  const hull: HullSpec = {
    length: 2.8, beam: 0.95, stern: 0.86, bowStart: 0.64, bowPower: 2.1, freeboard: 10, sheer: 4, band: 3.5,
    hull: livery.hull, bottom: livery.bottom, boot: livery.boot, trim: livery.accent, deck: STEEL_DECK, rail: 0xf2eee6, planks: false, wake: 1.3,
  };
  return {
    hull,
    build: (d) => {
      const { l, w } = d;
      const fd = hull.freeboard;
      const aft = -l + 0.25;
      const fore = l - 0.8;
      d.block(aft, fore, -w + 0.1, w - 0.1, fd, 12, WHITE, lit(WHITE, 0.3), (b) => {
        windows(d.g, b, fd + 4, fd + 9.5, 0.16, true);
        band(d.g, b, fd + 1, fd + 2.6, livery.accent);
      });
      let top = fd + 12;
      d.roofRail(aft + 0.02, fore - 0.02, -w + 0.12, w - 0.12, top, 0xf2eee6);
      if (decks === 2) {
        d.block(aft + 0.3, fore - 0.35, -w + 0.2, w - 0.2, top, 9, WHITE, lit(WHITE, 0.3), (b) => { windows(d.g, b, top + 3, top + 7, 0.14, true); });
        for (const s of [-1, 1]) d.block(aft + 0.05, aft + 0.27, s > 0 ? w - 0.2 : -w + 0.12, s > 0 ? w - 0.12 : -w + 0.2, top, 3.5, ORANGE, lit(WHITE, 0.25));
        top += 9;
      } else {
        for (const s of [-1, 1]) d.block(aft + 0.5, aft + 0.85, s > 0 ? w - 0.26 : -w + 0.14, s > 0 ? w - 0.14 : -w + 0.26, top, 3.5, ORANGE, lit(WHITE, 0.25));
      }
      const bridgeAft = fore - (decks === 2 ? 0.75 : 0.45);
      d.block(bridgeAft, bridgeAft + 0.32, -w + 0.16, w - 0.16, top, 7, WHITE, lit(WHITE, 0.35), (b) => { windows(d.g, b, top + 2.5, top + 5.8, 0.1, true); });
      d.add(bridgeAft + 0.14, bridgeAft + 0.18, -0.02, 0.02, top + 7, () => {
        d.line([bridgeAft + 0.16, 0, top + 7], [bridgeAft + 0.16, 0, top + 19], 1, STEEL);
        d.poly([[bridgeAft + 0.16, 0, top + 19], [bridgeAft + 0.16, 0, top + 15.5], [bridgeAft - 0.04, 0, top + 17]], livery.accent);
      });
      d.funnel(aft + 0.42, 0, 0.11, 0.13, top, 15, livery.funnel, livery.stripe);
    },
  };
}

// A container ship: a white accommodation block and bridge aft, stacked boxes, deck cranes and a foremast.
function cargo(rand: () => number): Design {
  const scheme = pick(rand, CARGO_HULLS);
  const colours = pick(rand, CONTAINER_MIXES);
  const hull: HullSpec = {
    length: 4.4, beam: 1.2, stern: 0.9, bowStart: 0.74, bowPower: 1.8, freeboard: 14, sheer: 5, band: 5,
    hull: scheme.hull, bottom: scheme.bottom, boot: WHITE, trim: 0xe9e4da, deck: CARGO_DECK, rail: 0xe9e4da, planks: false, wake: 1.7,
  };
  const layouts = [['bay', 'bay', 'crane', 'bay', 'bay'], ['bay', 'crane', 'bay', 'bay', 'crane', 'bay'], ['bay', 'bay', 'bay', 'crane', 'bay']] as const;
  const layout = pick(rand, layouts);
  const stacks = layout.map(() => [0, 1, 2].map(() => 1 + Math.floor(rand() * 3)));
  const tints = layout.map(() => [0, 1, 2].map(() => [0, 1, 2].map(() => pick(rand, colours))));
  return {
    hull,
    build: (d) => {
      const { l, w } = d;
      const fd = hull.freeboard;
      d.block(-l + 0.12, -l + 0.72, -w + 0.12, w - 0.12, fd, 24, WHITE, lit(WHITE, 0.3), (b) => {
        windows(d.g, b, fd + 6, fd + 9.5, 0.13, false);
        windows(d.g, b, fd + 14, fd + 17.5, 0.13, false);
      });
      d.block(-l + 0.48, -l + 0.8, -w + 0.03, w - 0.03, fd + 24, 6, WHITE, lit(WHITE, 0.35), (b) => { windows(d.g, b, fd + 26, fd + 28.8, 0.1, true); });
      d.funnel(-l + 0.28, 0, 0.12, 0.16, fd + 24, 15, scheme.funnel, scheme.stripe);
      d.add(-l + 0.6, -l + 0.64, -0.02, 0.02, fd + 30, () => {
        d.line([-l + 0.62, 0, fd + 30], [-l + 0.62, 0, fd + 42], 1, STEEL);
        d.line([-l + 0.62, -0.12, fd + 39], [-l + 0.62, 0.12, fd + 39], 0.9, STEEL);
      });
      const BAY = 0.58;
      const CRANE_GAP = 0.2;
      const CONT_H = 9;
      const cols: [number, number][] = [[-0.46, -0.165], [-0.15, 0.15], [0.165, 0.46]];
      let u = -l + 0.95;
      layout.forEach((slot, bay) => {
        if (slot === 'crane') {
          const cu = u + CRANE_GAP / 2;
          d.block(cu - 0.06, cu + 0.06, -0.06, 0.06, fd, 20, CRANE, lit(CRANE, 0.3));
          d.block(cu - 0.09, cu + 0.09, -0.09, 0.09, fd + 20, 6, CRANE, lit(CRANE, 0.35), (b) => { windows(d.g, b, fd + 22, fd + 24.5, 0.18, true); });
          d.add(cu + 0.1, cu + 0.85, -0.01, 0.01, fd + 40, () => {
            d.line([cu, 0, fd + 24], [cu + 0.85, 0, fd + 34], 3, shade(CRANE, 0.3));
            d.line([cu, 0, fd + 25], [cu + 0.85, 0, fd + 35], 1.6, lit(CRANE, 0.15));
            d.line([cu, 0, fd + 30], [cu + 0.85, 0, fd + 35], 0.6, ROPE, 0.8);
            d.line([cu + 0.84, 0, fd + 35], [cu + 0.84, 0, fd + 27], 0.6, ROPE, 0.8);
          });
          u += CRANE_GAP;
          return;
        }
        cols.forEach(([v0, v1], col) => {
          const tiers = stacks[bay]?.[col] ?? 1;
          for (let k = 0; k < tiers; k++) {
            const c = tints[bay]?.[col]?.[k] ?? 0xc0453a;
            const z = fd + k * CONT_H;
            d.block(u, u + BAY - 0.03, v0, v1, z, CONT_H - 0.4, c, lit(c, 0.22), (b) => {
              d.g.lineStyle(0.6 * S, shade(c, 0.4), 0.35);
              for (let x = b.x0 + 0.06; x < b.x1 - 0.02; x += 0.07) {
                const p = P(x, b.y1, z + 1);
                const q = P(x, b.y1, z + CONT_H - 1.4);
                d.g.lineBetween(p.x, p.y, q.x, q.y);
              }
              for (let y = b.y0 + 0.06; y < b.y1 - 0.02; y += 0.07) {
                const p = P(b.x1, y, z + 1);
                const q = P(b.x1, y, z + CONT_H - 1.4);
                d.g.lineBetween(p.x, p.y, q.x, q.y);
              }
            });
          }
        });
        u += BAY;
      });
      d.add(l - 0.42, l - 0.38, -0.02, 0.02, fd + 4, () => {
        d.line([l - 0.4, 0, fd + 4], [l - 0.4, 0, fd + 26], 1.2, STEEL);
        d.line([l - 0.4, -0.1, fd + 22], [l - 0.4, 0.1, fd + 22], 0.9, STEEL);
        d.poly([[l - 0.4, 0, fd + 28], [l - 0.4, 0, fd + 25.5], [l - 0.45, 0, fd + 26.7]], 0xffd27a);
      });
    },
  };
}

// A yacht: a teak deck, a low cabin with ports and a cockpit aft, a sloop or a catboat rig with curved sails.
function sailboat(rand: () => number): Design {
  const hullCol = pick(rand, SAILBOAT_HULLS);
  const sail = pick(rand, SAILS);
  const sloop = rand() < 0.6;
  const pennant = pick(rand, [0xd9534f, 0x4f8fd9, 0xf0c05a, 0x5fb87a] as const);
  const hull: HullSpec = {
    length: 1.5, beam: 0.52, stern: 0.78, bowStart: 0.5, bowPower: 1.7, freeboard: 7, sheer: 3, band: 1.6,
    hull: hullCol, bottom: hullCol === WHITE ? NAVY : RED, boot: hullCol === WHITE ? 0xd9534f : WHITE, trim: hullCol === WHITE ? 0x2c5f8a : WHITE,
    deck: TEAK, rail: 0xd8dde4, planks: true, wake: 0.8,
  };
  return {
    hull,
    build: (d) => {
      const { l, w } = d;
      const fd = hull.freeboard;
      const cabin = hullCol === WHITE ? WHITE : 0xf2ede4;
      d.block(-0.28, 0.2, -w + 0.11, w - 0.11, fd, 4.5, cabin, lit(cabin, 0.3), (b) => { windows(d.g, b, fd + 1.6, fd + 3.2, 0.11, false); });
      d.add(-l + 0.08, -0.3, -w + 0.12, w - 0.12, fd, () => { d.poly([[-l + 0.1, -w + 0.14, fd], [-0.3, -w + 0.14, fd], [-0.3, w - 0.14, fd], [-l + 0.1, w - 0.14, fd]], shade(TEAK, 0.35)); });
      const mast = sloop ? 0.14 : 0.42;
      const top = fd + (sloop ? 58 : 50);
      const boomEnd = -l + 0.1;
      const vb = d.near * 0.16;
      const sailTone = tone(sail, d.light(0, d.near));
      d.add(boomEnd, sloop ? l : mast + 0.02, -0.05, 0.05, fd + 4.6, () => {
        const tack: L3 = [mast, 0, fd + 6];
        const head: L3 = [mast, 0, top];
        const clew: L3 = [boomEnd, vb * 0.5, fd + 7];
        const mid = (mast + boomEnd) / 2;
        const leech = curve(head, [mid - 0.14, vb, (top + fd) / 2], clew);
        const foot = curve(clew, [mid, vb * 0.8, fd + 5], tack);
        d.line([mast, 0, fd + 6], [boomEnd, vb * 0.5, fd + 6.5], 1.8, SPAR);
        d.poly([tack, ...leech, ...foot.slice(1, -1)], sailTone);
        const belly = curve(head, [mid + 0.02, vb * 0.6, (top + fd) / 2 - 4], clew);
        d.poly([...leech, ...belly.reverse()], shade(sailTone, 0.25), 0.35);
        d.poly([tack, head, [mast - 0.07, vb * 0.3, (top + fd) / 2]], lit(sailTone, 0.4), 0.45);
        for (let k = 1; k <= 3; k++) {
          const f = k / 4;
          const on = leech[Math.round((1 - f) * (leech.length - 1))] ?? clew;
          d.line([mast, 0, fd + 6 + (top - fd - 6) * f], on, 0.6, shade(sailTone, 0.3), 0.35);
        }
        d.line([mast, 0, fd], [mast, 0, top + 2], 1.8, STEEL);
        d.line([mast, 0, fd], [mast, 0, top + 2], 0.7, lit(STEEL, 0.5));
        if (sloop) {
          const jTack: L3 = [l - 0.05, 0, fd + hull.sheer + 1];
          const jHead: L3 = [mast + 0.02, 0, top - 10];
          const jClew: L3 = [mast - 0.12, vb * 0.9, fd + 7];
          const jLeech = curve(jHead, [mast - 0.02, vb * 1.15, (top + fd) / 2 - 6], jClew);
          const jFoot = curve(jClew, [(l + mast) / 2, vb, fd + 3], jTack);
          d.poly([jTack, ...jLeech, ...jFoot.slice(1, -1)], lit(sailTone, 0.12));
          d.poly([...jLeech, ...curve(jHead, [mast + 0.04, vb * 0.6, (top + fd) / 2 - 8], jClew).reverse()], shade(sailTone, 0.25), 0.3);
          d.poly([jTack, jHead, [(l + mast) / 2, vb * 0.4, (top + fd) / 2 - 8]], lit(sailTone, 0.35), 0.4);
        }
        d.line([mast, 0, top], [l - 0.04, 0, fd + hull.sheer], 0.6, ROPE, 0.75);
        d.line([mast, 0, top], [-l + 0.03, 0, fd], 0.6, ROPE, 0.6);
        d.poly([[mast, 0, top + 2], [mast, 0, top - 1.5], [mast - 0.16, 0, top + 0.5]], pennant);
      });
    },
  };
}

// A fishing boat: a wheelhouse forward, a working deck aft with nets or creels, and outrigger poles on some.
function fishing(rand: () => number): Design {
  const hullCol = pick(rand, FISHING_HULLS);
  const roof = pick(rand, FISHING_ROOFS.filter((c) => c !== hullCol));
  const trawler = rand() < 0.55;
  const hull: HullSpec = {
    length: 1.7, beam: 0.62, stern: 0.88, bowStart: 0.56, bowPower: 2, freeboard: 9, sheer: 5, band: 2,
    hull: hullCol, bottom: hullCol === 0xc8483a ? 0x2a2630 : RED, boot: WHITE, trim: WHITE, deck: WORN_DECK, rail: null, planks: true, wake: 0.9,
  };
  return {
    hull,
    build: (d) => {
      const { l, w } = d;
      const fd = hull.freeboard;
      d.block(0.02, 0.4, -w + 0.1, w - 0.1, fd, 12, WHITE, lit(WHITE, 0.3), (b) => { windows(d.g, b, fd + 6.5, fd + 10, 0.12, false); });
      d.block(-0.01, 0.43, -w + 0.07, w - 0.07, fd + 12, 1.6, roof, lit(roof, 0.25));
      d.add(0.18, 0.22, -0.02, 0.02, fd + 13.6, () => {
        d.line([0.2, 0, fd + 13.6], [0.2, 0, fd + 22], 0.9, STEEL);
        d.line([0.2, -0.1, fd + 22], [0.2, 0.1, fd + 22], 1.4, SOOT);
      });
      const mast = -0.08;
      d.add(mast - 0.02, mast + 0.02, -0.02, 0.02, fd + 1, () => {
        d.line([mast, 0, fd + 28], [-l + 0.22, 0, fd + 15], 1.3, SPAR);
        d.line([mast, 0, fd], [mast, 0, fd + 40], 1.8, SPAR);
        d.line([mast, 0, fd], [mast, 0, fd + 40], 0.6, lit(SPAR, 0.4));
        d.line([mast, 0, fd + 40], [-l + 0.22, 0, fd + 15], 0.5, ROPE, 0.7);
      });
      if (trawler) {
        const pole = (s: number): void => {
          const tip: L3 = [mast - 0.12, s * (w + 0.5), fd + 44];
          d.line([mast, 0, fd + 26], tip, 1.3, SPAR);
          d.line([mast, 0, fd + 40], tip, 0.5, ROPE, 0.6);
          d.line(tip, [mast - 0.35, s * (w + 0.56), 0], 0.5, ROPE, 0.5);
        };
        d.under.push(() => { pole(-d.near); });
        d.over.push(() => { pole(d.near); });
        d.add(-l + 0.06, -l + 0.5, -w + 0.12, w - 0.12, fd, () => {
          const r = rng(7);
          for (let i = 0; i < 9; i++) {
            const p = d.at(-l + 0.12 + r() * 0.34, (r() - 0.5) * (w - 0.1) * 1.6, fd + 2 + r() * 2.5);
            d.g.fillStyle(pick(r, NET_TONES), 1);
            d.g.fillEllipse(p.x, p.y, (9 + r() * 6) * S, (5 + r() * 3) * S);
          }
          for (let i = 0; i < 4; i++) {
            const p = d.at(-l + 0.14 + r() * 0.3, (r() - 0.5) * (w - 0.1) * 1.6, fd + 5);
            d.g.fillStyle(ORANGE, 1);
            d.g.fillCircle(p.x, p.y, 1.5 * S);
          }
        });
      } else {
        const pots = [[-l + 0.1, -0.2], [-l + 0.1, 0.02], [-l + 0.32, -0.2], [-l + 0.32, 0.02]] as const;
        pots.forEach(([u0, v0], i) => {
          const tall = i % 3 === 0 ? 2 : 1;
          for (let k = 0; k < tall; k++) {
            d.block(u0, u0 + 0.19, v0, v0 + 0.19, fd + k * 4.5, 4.2, 0x4a5a52, lit(0x4a5a52, 0.25), (b) => {
              d.g.lineStyle(0.5 * S, 0xb8c4b8, 0.4);
              const p = P(b.x0, b.y1, fd + k * 4.5 + 2);
              const q = P(b.x1, b.y1, fd + k * 4.5 + 2);
              d.g.lineBetween(p.x, p.y, q.x, q.y);
            });
          }
        });
        d.add(-0.3, -0.06, -w + 0.12, w - 0.12, fd, () => {
          for (const v of [-0.12, 0.08]) {
            const p = d.at(-0.18, v, fd + 2.5);
            d.g.fillStyle(ORANGE, 1);
            d.g.fillCircle(p.x, p.y, 2.4 * S);
            d.g.fillStyle(lit(ORANGE, 0.5), 1);
            d.g.fillCircle(p.x - 0.7 * S, p.y - 0.7 * S, 0.9 * S);
          }
        });
      }
      d.over.push(() => {
        for (const u of [-0.45, -0.1, 0.25]) {
          const p = d.at(u, d.near * halfBeam(hull, (u + l) / hull.length) * 1.01, fd * 0.55);
          d.g.fillStyle(SOOT, 1);
          d.g.fillEllipse(p.x, p.y, 4 * S, 4.6 * S);
          d.g.fillStyle(0x4a4650, 1);
          d.g.fillEllipse(p.x - 0.4 * S, p.y - 0.5 * S, 1.8 * S, 2.2 * S);
        }
      });
    },
  };
}

const DESIGNS: Readonly<Record<ShipKind, (rand: () => number) => Design>> = { ferry, cargo, sailboat, fishing };

/**
 * Draws a ship of `kind` around its middle with its bow toward `heading`; `seed` picks its colours and variant,
 * so every screen paints the same ship the same way.
 */
export function drawShip(g: G, kind: ShipKind, heading: ShipHeading, seed: number): void {
  const design = DESIGNS[kind](rng(seed * 7919 + 101));
  const d = new Draft(g, heading, design.hull);
  design.build(d);
  g.clear();
  d.paint();
}
