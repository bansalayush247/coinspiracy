// Building name signs painted once to a canvas and sheared flat onto the facade, so they sit on the wall.
import Phaser from 'phaser';
import { buildingName, shopTradeOf, type BUILDING_DOORS, type ShopTrade } from '@byzantine-council/shared/city';
import { P } from '../beach/beachArt.js';
import { sceneDpr } from '../game/hidpi.js';
import { TILE_H, TILE_W } from '../game/iso.js';
import { buildingFront } from './cityArt.js';

type Door = (typeof BUILDING_DOORS)[number];
type Ctx = CanvasRenderingContext2D;
type Paint = (ctx: Ctx, w: number, h: number) => void;

const FONTS = {
  painted: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  engraved: 'Copperplate, "Copperplate Gothic Bold", "Trajan Pro", Optima, "Palatino Linotype", Georgia, serif',
  sans: '"Avenir Next", Avenir, "Segoe UI", "Helvetica Neue", system-ui, sans-serif',
  neon: '"Avenir Next Condensed", "Futura", "Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  slab: 'Rockwell, "Roboto Slab", "American Typewriter", "Courier New", Georgia, serif',
} as const;

interface Trade {
  readonly field: string;
  readonly fieldTop: string;
  readonly trim: string;
  readonly frame: string;
  readonly ink: string;
  readonly under: string;
  readonly gilt: boolean;
  readonly font: keyof typeof FONTS;
  readonly italic: boolean;
}

/** Every colour, size and font the signs use, in one place. */
export const SIGN_STYLE = {
  res: { perDpr: 1.3, min: 2, max: 3 },
  cache: 16,
  pad: 10,
  depthLift: 0.5,
  fonts: FONTS,
  shadow: 'rgba(28, 16, 36, 0.32)',
  iron: '#2a2530',
  ironLit: '#5a5262',
  gold: ['#fff2bf', '#f0c860', '#b98226'],
  surfStripe: '#e0574b',
  trades: {
    tailor: { field: '#5a2742', fieldTop: '#74345a', trim: '#e7c16a', frame: '#32162a', ink: '#f7dc96', under: '#2a1020', gilt: true, font: 'painted', italic: false },
    barber: { field: '#1d3a63', fieldTop: '#2a4f82', trim: '#d8463e', frame: '#122440', ink: '#fbf3e2', under: '#0c1a30', gilt: false, font: 'painted', italic: false },
    hats: { field: '#285a44', fieldTop: '#357259', trim: '#e7c16a', frame: '#173828', ink: '#f7dc96', under: '#10281c', gilt: true, font: 'painted', italic: false },
    surf: { field: '#2b93a0', fieldTop: '#3fb0bb', trim: '#f4e3b6', frame: '#1b5e68', ink: '#fffaf0', under: '#1b5e68', gilt: false, font: 'sans', italic: false },
    cafe: { field: '#f2e1bf', fieldTop: '#fbf0d8', trim: '#b4533a', frame: '#6a3a26', ink: '#4a2818', under: 'rgba(255, 250, 235, 0.95)', gilt: false, font: 'painted', italic: true },
  } satisfies Record<ShopTrade, Trade>,
  stone: { face: '#e6dcc7', faceTop: '#f2eadb', edge: '#c9bca4', top: '#f6efe2', ink: '#5d4c3a', glint: 'rgba(255, 250, 238, 0.9)' },
  brass: { light: '#f6dc8e', mid: '#d6aa4c', dark: '#9c7224', ink: '#3a2810', edge: '#7a561a' },
  hospital: { field: '#17607a', fieldTop: '#1f7893', trim: '#e8f4f6', ink: '#ffffff', edge: '#0e4254' },
  oak: { field: '#5a3822', fieldTop: '#76502f', groove: '#3a2214', lip: '#9a7048', ink: '#f6dea0', edge: '#3e2616' },
  lacquer: { field: '#1d2240', fieldTop: '#2b3158', frame: '#8a5234', frameLit: '#a86a44', ink: '#f2cf72', cord: '#d9a440' },
  mandir: { field: '#f39a2e', fieldTop: '#f8b850', border: '#b83a2e', gold: '#e8b84a', ink: '#6a1410', edge: '#8a2a20', marigold: ['#f08a1e', '#f8b828'], leaf: '#4a8a3a' },
  neon: { back: '#170d2c', backTop: '#24163e', pink: '#ff5fa2', cyan: '#5fd3ff', gold: '#ffd27a', core: '#fff4fb', edge: '#0d0619' },
  fish: { field: '#2f7f9a', fieldTop: '#3c97b2', plank: 'rgba(15, 50, 66, 0.45)', rope: '#c8a46a', ropeDark: '#7a5a32', ink: '#fffaf0', edge: '#1d5568' },
  enamel: { field: '#1e3f73', fieldTop: '#2a5390', ring: '#f4f1e8', ink: '#ffffff', edge: '#14294c' },
} as const;

interface Pt3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Face {
  readonly kind: 'south' | 'blade';
  readonly at: Pt3;
  readonly w: number;
  readonly h: number;
  readonly t: number;
  readonly edgeH?: number;
  readonly edge: string;
  readonly shadow: boolean;
  readonly paint: Paint;
}

interface Plan {
  readonly faces: readonly Face[];
  readonly extra?: (ctx: Ctx, pt: (x: number, y: number, z: number) => { x: number; y: number }) => void;
  readonly extraPts?: readonly Pt3[];
}

const PX_X = TILE_W / 2;
const PX_Z = TILE_H / 32;

const live = new Map<string, number>();
const idle: string[] = [];

/** A building's name sign as an image on its facade, depth-sorted with the building; destroy it to let it go. */
export function makeSign(scene: Phaser.Scene, door: Door): Phaser.GameObjects.Image {
  const b = door.building;
  const res = Math.min(SIGN_STYLE.res.max, Math.max(SIGN_STYLE.res.min, Math.ceil(sceneDpr(scene) * SIGN_STYLE.res.perDpr)));
  const key = `bc-sign-${String(b.seed)}@${String(res)}`;
  const plan = planFor(door);
  const bounds = planBounds(plan);
  if (!scene.textures.exists(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((bounds.x1 - bounds.x0) * res);
    canvas.height = Math.ceil((bounds.y1 - bounds.y0) * res);
    const ctx = canvas.getContext('2d');
    if (ctx !== null) paintPlan(ctx, plan, bounds, res);
    scene.textures.addCanvas(key, canvas);
  }
  const at = idle.indexOf(key);
  if (at >= 0) idle.splice(at, 1);
  live.set(key, (live.get(key) ?? 0) + 1);
  const img = scene.add.image(bounds.x0, bounds.y0, key).setOrigin(0).setScale(1 / res).setDepth(buildingFront(b.box) * (TILE_H / 2) + SIGN_STYLE.depthLift);
  img.once(Phaser.GameObjects.Events.DESTROY, () => {
    const n = (live.get(key) ?? 1) - 1;
    if (n > 0) {
      live.set(key, n);
      return;
    }
    live.delete(key);
    idle.push(key);
    while (idle.length > SIGN_STYLE.cache) {
      const old = idle.shift();
      if (old !== undefined && scene.textures.exists(old)) scene.textures.remove(old);
    }
  });
  return img;
}

// The boards, iron and cords that make up one building's sign, placed on its front face.
function planFor(door: Door): Plan {
  const b = door.building;
  const name = buildingName(b.seed);
  const x0 = b.box.c0 + 0.05;
  const x1 = b.box.c1 + 0.95;
  const y0 = b.box.r0 + 0.05;
  const y1 = b.box.r1 + 0.95;
  const mid = (x0 + x1) / 2;
  const S = SIGN_STYLE;
  switch (door.room) {
    case 'shop':
      return shopPlan(name, shopTradeOf(b.seed), x0, x1, y1, b.height);
    case 'cityHall':
      return { faces: [south(mid - 2.6, y1, 91, 5.2, 22, 0.08, S.stone.edge, true, stoneLintel(name, false))] };
    case 'mintHall':
      return { faces: [south(x0 + 0.45, y1 - 0.3, b.height - 55, x1 - x0 - 0.9, 19, 0.05, S.stone.edge, false, stoneLintel(name, true))] };
    case 'hospital':
      return { faces: [south(mid - 2.2, y1, 76, 4.4, 18, 0.06, S.hospital.edge, true, hospitalPanel(name))] };
    case 'chapel':
      return { faces: [south(mid - 1.8, y1, 100, 3.6, 24, 0.06, S.oak.edge, true, carvedBoard(name))] };
    case 'temple': {
      const beam = y1 - 0.8 + 0.045;
      const a = mid - 0.95;
      return {
        faces: [south(a, beam, 93, 1.9, 17, 0.05, S.lacquer.frame, true, templeBoard(name))],
        extra: (ctx, pt) => {
          for (const cx of [a + 0.3, a + 1.6]) line(ctx, pt(cx, beam + 0.02, 97), pt(cx, beam + 0.02, 92), S.lacquer.cord, 1.6);
        },
        extraPts: [{ x: a, y: beam, z: 98 }],
      };
    }
    case 'mandir': {
      const grand = x1 - x0 > 6;
      const porchFront = grand ? y1 - 1.1 : y0 + 0.35 + 0.9 + 0.9 * 1.16 + 0.5;
      const top = grand ? 67 : 56;
      const w = grand ? 2.1 : 1.7;
      return { faces: [{ ...south(mid - w / 2, porchFront - 0.03, top + 17, w, 23, 0.06, S.mandir.edge, false, mandirBoard(name)), edgeH: 17 }] };
    }
    case 'arcade':
      return { faces: [south(mid - 2.5, y1 + 0.02, 86, 5, 24, 0.04, S.neon.edge, true, neonBoard(name))] };
    case 'fishMarket':
      return { faces: [south(mid - 1.3, y1 + 0.02, 86, 2.6, 30, 0.05, S.fish.edge, true, fishBoard(name))] };
    case 'office':
      return { faces: [south(mid - 1.45, y1, 69, 2.9, 20, 0.03, S.brass.edge, true, brassPlate(name, 16))] };
    case 'flat':
      return homePlan(name, b.kind === 'mansion', mid, x1, y1);
  }
}

function south(x: number, y: number, top: number, w: number, h: number, t: number, edge: string, shadow: boolean, paint: Paint): Face {
  return { kind: 'south', at: { x, y, z: top }, w, h, t, edge, shadow, paint };
}

// A painted fascia over the awning, and a blade sign on an iron bracket at the west end, both in the trade's colours.
function shopPlan(name: string, trade: ShopTrade, x0: number, x1: number, y1: number, height: number): Plan {
  const T = SIGN_STYLE.trades[trade];
  const narrow = x1 - x0 < 2.5;
  const fascia = south(x0 + 0.1, y1, Math.min(height - 1, narrow ? 81 : 79), x1 - x0 - 0.2, narrow ? 22 : 19, 0.05, T.frame, true, shopFascia(name, trade));
  const arm = Math.min(height - 8, 94);
  const bx = x0 + 0.12;
  const out0 = y1 + 0.14;
  const blade: Face = { kind: 'blade', at: { x: bx, y: out0, z: arm - 5 }, w: 0.62, h: 22, t: 0.04, edge: T.frame, shadow: false, paint: bladeSign(trade) };
  return {
    faces: [fascia, blade],
    extra: (ctx, pt) => {
      const S = SIGN_STYLE;
      const wall = pt(bx + 0.02, y1, arm);
      const tip = pt(bx + 0.02, y1 + 0.86, arm);
      const brace = pt(bx + 0.02, y1, arm - 13);
      const knee = pt(bx + 0.02, y1 + 0.5, arm);
      plate(ctx, pt(bx + 0.02, y1 + 0.01, arm + 3), pt(bx + 0.02, y1 + 0.01, arm - 16));
      line(ctx, wall, tip, S.iron, 2.6);
      line(ctx, { x: wall.x, y: wall.y - 1 }, { x: tip.x, y: tip.y - 1 }, S.ironLit, 0.8);
      line(ctx, brace, knee, S.iron, 1.8);
      ctx.strokeStyle = S.iron;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(tip.x - 3.2, tip.y + 1.4, 3.2, -0.4, Math.PI * 1.35);
      ctx.stroke();
      for (const u of [out0 + 0.08, out0 + 0.54]) {
        const a = pt(bx + 0.02, u, arm);
        const z = pt(bx + 0.02, u, arm - 5);
        line(ctx, a, z, S.iron, 1.1);
        ring(ctx, a.x, a.y + 1, 1.3);
      }
    },
    extraPts: [
      { x: bx, y: y1, z: arm + 4 },
      { x: bx, y: y1 + 0.92, z: arm },
    ],
  };
}

// A neat plate beside a flat's door: an enamel house number, or a brass name plate on a named house.
function homePlan(name: string, mansion: boolean, mid: number, x1: number, y1: number): Plan {
  const S = SIGN_STYLE;
  const front = y1 - 0.1;
  const num = /^(\d+)\s+(.+)$/.exec(name);
  const start = mansion ? mid + 0.62 : mid + 0.36;
  const room = x1 - 0.18 - start;
  const paint = num !== null ? enamelPlate(num[1] ?? '', num[2] ?? '') : brassPlate(name);
  const edge = num !== null ? S.enamel.edge : S.brass.edge;
  if (room >= 0.95) return { faces: [south(start, front, mansion ? 34 : 32, Math.min(1.35, room), 16, 0.02, edge, true, paint)] };
  return { faces: [south(mid - 0.42, front, 52, 0.84, 13, 0.02, edge, true, paint)] };
}

interface Bounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function faceCorners(f: Face): Pt3[] {
  const { x, y, z } = f.at;
  const lo = z - f.h;
  if (f.kind === 'south') return [{ x, y, z }, { x: x + f.w, y, z }, { x, y, z: lo }, { x: x + f.w, y, z: lo }, { x, y: y + f.t, z: lo }, { x: x + f.w, y: y + f.t, z }];
  return [{ x, y, z }, { x, y: y + f.w, z }, { x, y, z: lo }, { x, y: y + f.w, z: lo }, { x: x + f.t, y: y + f.w, z: lo }, { x: x + f.t, y, z }];
}

function planBounds(plan: Plan): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const pts = [...plan.faces.flatMap(faceCorners), ...(plan.extraPts ?? [])];
  for (const p of pts) {
    const s = P(p.x, p.y, p.z);
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x);
    y1 = Math.max(y1, s.y);
  }
  const pad = SIGN_STYLE.pad;
  return { x0: Math.floor(x0 - pad), y0: Math.floor(y0 - pad), x1: Math.ceil(x1 + pad), y1: Math.ceil(y1 + pad) };
}

function paintPlan(ctx: Ctx, plan: Plan, b: Bounds, res: number): void {
  const pt = (x: number, y: number, z: number): { x: number; y: number } => {
    const s = P(x, y, z);
    return { x: s.x - b.x0, y: s.y - b.y0 };
  };
  const flat = (): void => {
    ctx.setTransform(res, 0, 0, res, 0, 0);
  };
  flat();
  if (plan.extra !== undefined) plan.extra(ctx, pt);
  for (const f of plan.faces) {
    const { x, y, z } = f.at;
    const W = f.w * PX_X;
    const H = f.h * PX_Z;
    const lo = z - (f.edgeH ?? f.h);
    const southFace = f.kind === 'south';
    const k = southFace ? 0.5 : -0.5;
    if (f.shadow && southFace) {
      const o = pt(x, y, z);
      ctx.save();
      ctx.setTransform(res, res * k, 0, res, (o.x + 2.5) * res, (o.y + 3.5) * res);
      ctx.filter = `blur(${String(1.6 * res)}px)`;
      ctx.fillStyle = SIGN_STYLE.shadow;
      ctx.fillRect(0, 0, W, (f.edgeH ?? f.h) * PX_Z);
      ctx.restore();
    }
    flat();
    if (southFace) {
      poly(ctx, [pt(x, y, z), pt(x + f.w, y, z), pt(x + f.w, y + f.t, z), pt(x, y + f.t, z)], tint(f.edge, 0.28));
      poly(ctx, [pt(x + f.w, y, z), pt(x + f.w, y + f.t, z), pt(x + f.w, y + f.t, lo), pt(x + f.w, y, lo)], tint(f.edge, -0.15));
    } else {
      poly(ctx, [pt(x, y, z), pt(x + f.t, y, z), pt(x + f.t, y + f.w, z), pt(x, y + f.w, z)], tint(f.edge, 0.28));
      poly(ctx, [pt(x, y + f.w, z), pt(x + f.t, y + f.w, z), pt(x + f.t, y + f.w, lo), pt(x, y + f.w, lo)], tint(f.edge, 0.1));
    }
    const o = southFace ? pt(x, y + f.t, z) : pt(x + f.t, y + f.w, z);
    ctx.save();
    ctx.setTransform(res, res * k, 0, res, o.x * res, o.y * res);
    f.paint(ctx, W, H);
    if (!southFace) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(24, 12, 34, 0.14)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
}

function shopFascia(name: string, trade: ShopTrade): Paint {
  const T = SIGN_STYLE.trades[trade];
  return (ctx, w, h) => {
    board(ctx, w, h, 3, T.frame, T.field, T.fieldTop);
    ctx.strokeStyle = T.trim;
    ctx.lineWidth = 1.4;
    roundRect(ctx, 4.5, 4.5, w - 9, h - 9, 2);
    ctx.stroke();
    if (trade === 'barber') stripes(ctx, w, h);
    const icon = w >= 190 ? h - 14 : 0;
    for (const cx of icon > 0 ? [9 + icon / 2, w - 9 - icon / 2] : []) tradeIcon(ctx, trade, cx, h / 2, icon, T.ink, T.trim);
    if (icon === 0) for (const cx of [7.5, w - 7.5]) dot(ctx, cx, h / 2, 1.4, T.trim);
    const room = w - (icon > 0 ? 2 * icon + 26 : 20);
    lettering(ctx, name, w / 2, h / 2, room, h - 12, { family: SIGN_STYLE.fonts[T.font], weight: T.font === 'sans' ? 800 : 700, italic: T.italic, max: 21, min: 10, spacing: T.font === 'sans' ? 0.04 : 0.02, style: T.gilt ? 'gilt' : 'paint', ink: T.ink, under: T.under });
  };
}

function bladeSign(trade: ShopTrade): Paint {
  const T = SIGN_STYLE.trades[trade];
  return (ctx, w, h) => {
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(w, 2);
    ctx.lineTo(w, h - 6);
    ctx.quadraticCurveTo(w / 2, h + 3, 0, h - 6);
    ctx.closePath();
    ctx.fillStyle = T.frame;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(2.5, 4.5);
    ctx.lineTo(w - 2.5, 4.5);
    ctx.lineTo(w - 2.5, h - 7.5);
    ctx.quadraticCurveTo(w / 2, h - 0.5, 2.5, h - 7.5);
    ctx.closePath();
    ctx.fillStyle = grad(ctx, h, T.fieldTop, T.field);
    ctx.fill();
    ctx.strokeStyle = T.trim;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    tradeIcon(ctx, trade, w / 2, h / 2, Math.min(w, h) * 0.66, T.ink, T.trim);
  };
}

function stoneLintel(name: string, gilt: boolean): Paint {
  const S = SIGN_STYLE.stone;
  return (ctx, w, h) => {
    ctx.fillStyle = grad(ctx, h, S.faceTop, S.face);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 252, 244, 0.7)';
    ctx.fillRect(0, 0, w, 1.6);
    ctx.fillStyle = 'rgba(90, 70, 50, 0.28)';
    ctx.fillRect(0, h - 2, w, 2);
    ctx.strokeStyle = 'rgba(110, 90, 66, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(5.5, 4.5, w - 11, h - 9);
    ctx.strokeStyle = 'rgba(255, 252, 244, 0.7)';
    ctx.strokeRect(6.5, 5.5, w - 11, h - 9);
    const r = (h - 12) / 2;
    for (const cx of [10 + r, w - 10 - r]) {
      if (gilt) coin(ctx, cx, h / 2, r);
      else rosette(ctx, cx, h / 2, r);
    }
    lettering(ctx, name.toUpperCase(), w / 2, h / 2 + 0.5, w - 4 * r - 34, h - 13, { family: SIGN_STYLE.fonts.engraved, weight: 700, italic: false, max: 22, min: 10, spacing: 0.09, style: gilt ? 'gilt' : 'engraved', ink: S.ink, under: gilt ? '#6a5636' : S.glint });
  };
}

function hospitalPanel(name: string): Paint {
  const S = SIGN_STYLE.hospital;
  return (ctx, w, h) => {
    board(ctx, w, h, 5, S.edge, S.field, S.fieldTop);
    ctx.strokeStyle = 'rgba(232, 244, 246, 0.55)';
    ctx.lineWidth = 1;
    roundRect(ctx, 3.5, 3.5, w - 7, h - 7, 3.5);
    ctx.stroke();
    const e = h - 12;
    ctx.fillStyle = S.trim;
    roundRect(ctx, 8, 6, e, e, 4);
    ctx.fill();
    ctx.fillStyle = S.field;
    ctx.font = `800 ${String(e * 0.78)}px ${SIGN_STYLE.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', 8 + e / 2, 6 + e / 2 + 1);
    lettering(ctx, name, (w + e + 8) / 2, h / 2, w - e - 30, h - 12, { family: SIGN_STYLE.fonts.sans, weight: 700, italic: false, max: 19, min: 10, spacing: 0.03, style: 'paint', ink: S.ink, under: S.edge });
  };
}

function carvedBoard(name: string): Paint {
  const S = SIGN_STYLE.oak;
  return (ctx, w, h) => {
    const arch = (inset: number): void => {
      const top = 9 + inset;
      ctx.beginPath();
      ctx.moveTo(inset, h - inset);
      ctx.lineTo(inset, top);
      ctx.quadraticCurveTo(w * 0.25, top - 1, w / 2, inset);
      ctx.quadraticCurveTo(w * 0.75, top - 1, w - inset, top);
      ctx.lineTo(w - inset, h - inset);
      ctx.closePath();
    };
    arch(0);
    ctx.fillStyle = S.edge;
    ctx.fill();
    arch(2.5);
    ctx.fillStyle = grad(ctx, h, S.fieldTop, S.field);
    ctx.fill();
    grain(ctx, w, h, 'rgba(40, 22, 12, 0.22)');
    arch(5.5);
    ctx.strokeStyle = S.groove;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.save();
    ctx.translate(0.8, 0.8);
    arch(5.5);
    ctx.strokeStyle = 'rgba(200, 160, 110, 0.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
    for (const cx of [13, w - 13]) diamond(ctx, cx, h / 2 + 4, 3.4, S.ink);
    lettering(ctx, name, w / 2, h / 2 + 4, w - 46, h - 18, { family: SIGN_STYLE.fonts.painted, weight: 700, italic: true, max: 20, min: 10, spacing: 0.02, style: 'gilt', ink: S.ink, under: S.groove });
  };
}

function templeBoard(name: string): Paint {
  const S = SIGN_STYLE.lacquer;
  return (ctx, w, h) => {
    ctx.fillStyle = S.frame;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = S.frameLit;
    ctx.fillRect(0, 0, w, 1.5);
    ctx.fillRect(0, 0, 1.5, h);
    ctx.fillStyle = grad(ctx, h, S.fieldTop, S.field);
    ctx.fillRect(4, 4, w - 8, h - 8);
    ctx.strokeStyle = S.ink;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    for (const [cx, cy] of [[2, 2], [w - 2, 2], [2, h - 2], [w - 2, h - 2]] as const) dot(ctx, cx, cy, 1.6, S.cord);
    lettering(ctx, name, w / 2, h / 2 + 0.5, w - 18, h - 13, { family: SIGN_STYLE.fonts.painted, weight: 700, italic: false, max: 16, min: 9, spacing: 0.06, style: 'gilt', ink: S.ink, under: '#0c0e20' });
  };
}

function mandirBoard(name: string): Paint {
  const S = SIGN_STYLE.mandir;
  return (ctx, w, hAll) => {
    const h = hAll - 12;
    ctx.fillStyle = S.border;
    roundRect(ctx, 0, 0, w, h, 3);
    ctx.fill();
    ctx.fillStyle = grad(ctx, h, S.fieldTop, S.field);
    roundRect(ctx, 3.5, 3.5, w - 7, h - 7, 2);
    ctx.fill();
    ctx.strokeStyle = S.gold;
    ctx.lineWidth = 1.1;
    roundRect(ctx, 5.5, 5.5, w - 11, h - 11, 1.5);
    ctx.stroke();
    for (const cx of [11, w - 11]) {
      dot(ctx, cx, h / 2, 2.6, S.border);
      dot(ctx, cx, h / 2, 1.4, S.gold);
    }
    lettering(ctx, name, w / 2, h / 2 + 0.5, w - 34, h - 13, { family: SIGN_STYLE.fonts.painted, weight: 700, italic: false, max: 17, min: 9, spacing: 0.05, style: 'paint', ink: S.ink, under: 'rgba(255, 230, 170, 0.8)' });
    const swags = Math.max(2, Math.round(w / 34));
    for (let i = 0; i < swags; i++) {
      const a = (w * i) / swags;
      const e = (w * (i + 1)) / swags;
      const beads = Math.round((e - a) / 3.1);
      for (let j = 0; j <= beads; j++) {
        const t = j / beads;
        const x = a + (e - a) * t;
        const y = h - 1 + Math.sin(Math.PI * t) * 7;
        dot(ctx, x, y, 2.1, S.marigold[(i + j) % 2] ?? S.field);
      }
      const leafAt = { x: e, y: h - 0.5 };
      ctx.fillStyle = S.leaf;
      ctx.beginPath();
      ctx.ellipse(leafAt.x - 1.8, leafAt.y + 2.5, 1.4, 3, 0.5, 0, Math.PI * 2);
      ctx.ellipse(leafAt.x + 1.8, leafAt.y + 2.5, 1.4, 3, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const x of [2, w - 2]) {
      line(ctx, { x, y: h - 1 }, { x, y: h + 7 }, S.marigold[0], 2.2);
      dot(ctx, x, h + 8.5, 2.2, S.border);
    }
  };
}

function neonBoard(name: string): Paint {
  const S = SIGN_STYLE.neon;
  return (ctx, w, h) => {
    board(ctx, w, h, 5, S.edge, S.back, S.backTop);
    ctx.save();
    ctx.shadowColor = S.cyan;
    ctx.shadowBlur = 6;
    ctx.strokeStyle = S.cyan;
    ctx.lineWidth = 1.6;
    roundRect(ctx, 4, 4, w - 8, h - 8, 4);
    ctx.stroke();
    ctx.restore();
    const icon = h - 22;
    for (const [cx, col] of [[13 + icon / 2, S.gold], [w - 13 - icon / 2, S.pink]] as const) invader(ctx, cx, h / 2, icon, col);
    const words = name.toUpperCase();
    const split = /^(.*)\s(ARCADE)$/.exec(words);
    const room = w - 2 * icon - 40;
    if (split !== null) {
      neonText(ctx, split[1] ?? words, w / 2, h * 0.4, room, h * 0.6, 26, S.pink);
      neonText(ctx, split[2] ?? '', w / 2, h * 0.79, room * 0.55, h * 0.3, 11, S.cyan, 0.6);
    } else {
      neonText(ctx, words, w / 2, h / 2, room, h - 16, 17, S.pink);
    }
  };
}

function fishBoard(name: string): Paint {
  const S = SIGN_STYLE.fish;
  return (ctx, w, h) => {
    ctx.fillStyle = grad(ctx, h, S.fieldTop, S.field);
    ctx.fillRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = S.plank;
    for (const y of [h / 3, (2 * h) / 3]) ctx.fillRect(3, y, w - 6, 1);
    grain(ctx, w, h, 'rgba(255, 255, 255, 0.07)');
    ctx.setLineDash([2.6, 1.6]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = S.ropeDark;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = S.rope;
    ctx.lineDashOffset = 1.4;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    ctx.setLineDash([]);
    const f = Math.min(w * 0.42, h * 0.22);
    fish(ctx, w / 2 + f * 0.12, 7 + f * 0.3, f, S.ink, false);
    lettering(ctx, name, w / 2, (h + 7 + f * 0.6) / 2, w - 12, h - f * 0.6 - 16, { family: SIGN_STYLE.fonts.slab, weight: 700, italic: false, max: 18, min: 9, spacing: 0.03, style: 'paint', ink: S.ink, under: S.edge });
  };
}

function brassPlate(name: string, max = 13): Paint {
  const S = SIGN_STYLE.brass;
  return (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w * 0.4, h * 1.6);
    g.addColorStop(0, S.light);
    g.addColorStop(0.45, S.mid);
    g.addColorStop(0.55, S.light);
    g.addColorStop(1, S.dark);
    ctx.fillStyle = S.edge;
    roundRect(ctx, 0, 0, w, h, 2);
    ctx.fill();
    ctx.fillStyle = g;
    roundRect(ctx, 1.2, 1.2, w - 2.4, h - 2.4, 1.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 52, 14, 0.55)';
    ctx.lineWidth = 0.7;
    roundRect(ctx, 3.5, 3.5, w - 7, h - 7, 1);
    ctx.stroke();
    const screws = w > 70 ? [[5.5, h / 2], [w - 5.5, h / 2]] : [];
    for (const [sx, sy] of screws) {
      dot(ctx, sx ?? 0, sy ?? 0, 1.5, S.dark);
      dot(ctx, (sx ?? 0) - 0.4, (sy ?? 0) - 0.4, 0.6, S.light);
    }
    lettering(ctx, name, w / 2, h / 2 + 0.3, w - (screws.length > 0 ? 18 : 8), h - 7, { family: SIGN_STYLE.fonts.painted, weight: 700, italic: false, max, min: 6.5, spacing: 0.03, style: 'engraved', ink: S.ink, under: 'rgba(255, 240, 190, 0.7)' });
  };
}

function enamelPlate(number: string, street: string): Paint {
  const S = SIGN_STYLE.enamel;
  return (ctx, w, h) => {
    board(ctx, w, h, h / 2.6, S.edge, S.field, S.fieldTop);
    ctx.strokeStyle = S.ring;
    ctx.lineWidth = 1;
    roundRect(ctx, 2.2, 2.2, w - 4.4, h - 4.4, h / 3.2);
    ctx.stroke();
    ctx.fillStyle = S.ink;
    ctx.font = `800 ${String(h * 0.62)}px ${SIGN_STYLE.fonts.painted}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nw = Math.max(h * 0.75, ctx.measureText(number).width + 4);
    ctx.fillText(number, 5 + nw / 2, h / 2 + 0.5);
    line(ctx, { x: 7 + nw, y: 5 }, { x: 7 + nw, y: h - 5 }, 'rgba(244, 241, 232, 0.6)', 0.8);
    lettering(ctx, street, (11 + nw + w - 5) / 2, h / 2 + 0.3, w - nw - 18, h - 8, { family: SIGN_STYLE.fonts.painted, weight: 700, italic: false, max: 11, min: 6.5, spacing: 0.02, style: 'paint', ink: S.ink, under: S.edge });
  };
}

interface Letters {
  readonly family: string;
  readonly weight: number;
  readonly italic: boolean;
  readonly max: number;
  readonly min: number;
  readonly spacing: number;
  readonly style: 'gilt' | 'paint' | 'engraved';
  readonly ink: string;
  readonly under: string;
}

function setFont(ctx: Ctx, l: Pick<Letters, 'family' | 'weight' | 'italic' | 'spacing'>, px: number): void {
  ctx.font = `${l.italic ? 'italic ' : ''}${String(l.weight)} ${px.toFixed(1)}px ${l.family}`;
  ctx.letterSpacing = `${(px * l.spacing).toFixed(2)}px`;
}

// The lines and size that read largest in the box, squeezed a little only when the smallest size still overflows.
function fitLines(ctx: Ctx, text: string, maxW: number, maxH: number, l: Pick<Letters, 'family' | 'weight' | 'italic' | 'spacing' | 'max' | 'min'>): { lines: string[]; px: number } {
  const widest = (lines: readonly string[], px: number): number => {
    setFont(ctx, l, px);
    return Math.max(...lines.map((s) => ctx.measureText(s).width));
  };
  const words = text.split(' ');
  const splits: string[][] = [[text]];
  for (let i = 1; i < words.length; i++) {
    splits.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
    for (let j = i + 1; j < words.length; j++) splits.push([words.slice(0, i).join(' '), words.slice(i, j).join(' '), words.slice(j).join(' ')]);
  }
  let best = { lines: [text], px: l.min, score: -1 };
  for (const lines of splits) {
    let px = Math.min(l.max, (maxH * 0.8) / (1 + (lines.length - 1) * 1.1));
    if (px < l.min * 0.85) continue;
    while (px > l.min && widest(lines, px) > maxW) px -= 0.5;
    const squeeze = Math.min(1, maxW / widest(lines, px));
    const score = px * Math.sqrt(squeeze) * (1 - (lines.length - 1) * 0.06);
    if (score > best.score) best = { lines, px, score };
  }
  return { lines: best.lines, px: best.px };
}

function lettering(ctx: Ctx, text: string, cx: number, cy: number, maxW: number, maxH: number, l: Letters): void {
  const { lines, px } = fitLines(ctx, text, maxW, maxH, l);
  setFont(ctx, l, px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const gap = px * 1.05;
  const nudge = (px * l.spacing) / 2;
  lines.forEach((s, i) => {
    const x = cx + nudge;
    const y = cy + (i - (lines.length - 1) / 2) * gap + px * 0.04;
    if (l.style === 'engraved') {
      ctx.fillStyle = l.under;
      ctx.fillText(s, x + 0.5, y + 0.7, maxW);
      ctx.fillStyle = l.ink;
      ctx.fillText(s, x, y, maxW);
      return;
    }
    ctx.fillStyle = l.under;
    ctx.fillText(s, x + 0.7, y + 1.1, maxW);
    if (l.style === 'gilt') {
      ctx.strokeStyle = l.under;
      ctx.lineWidth = Math.max(0.8, px * 0.08);
      ctx.lineJoin = 'round';
      ctx.strokeText(s, x, y, maxW);
      const g = ctx.createLinearGradient(0, y - px / 2, 0, y + px / 2);
      const [hi, midTone, low] = SIGN_STYLE.gold;
      g.addColorStop(0, hi);
      g.addColorStop(0.5, midTone);
      g.addColorStop(1, low);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = l.ink;
    }
    ctx.fillText(s, x, y, maxW);
  });
  ctx.letterSpacing = '0px';
}

function neonText(ctx: Ctx, text: string, cx: number, cy: number, maxW: number, maxH: number, max: number, col: string, spacing = 0.08): void {
  const l = { family: SIGN_STYLE.fonts.neon, weight: 700, italic: false, spacing, max, min: 7 };
  const { lines, px } = fitLines(ctx, text, maxW, maxH, l);
  setFont(ctx, l, px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const gap = px * 1.05;
  lines.forEach((s, i) => {
    const x = cx + (px * spacing) / 2;
    const y = cy + (i - (lines.length - 1) / 2) * gap;
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = px * 0.7;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.6, px * 0.16);
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y, maxW);
    ctx.strokeText(s, x, y, maxW);
    ctx.restore();
    ctx.strokeStyle = SIGN_STYLE.neon.core;
    ctx.lineWidth = Math.max(0.5, px * 0.05);
    ctx.strokeText(s, x, y, maxW);
  });
  ctx.letterSpacing = '0px';
}

function tradeIcon(ctx: Ctx, trade: ShopTrade, cx: number, cy: number, s: number, ink: string, trim: string): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (trade) {
    case 'barber': {
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = s * 0.085;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + dir * s * 0.2, cy + s * 0.27, s * 0.12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + dir * s * 0.13, cy + s * 0.16);
        ctx.lineTo(cx - dir * s * 0.2, cy - s * 0.42);
        ctx.lineTo(cx - dir * s * 0.06, cy - s * 0.38);
        ctx.lineTo(cx + dir * s * 0.06, cy + s * 0.12);
        ctx.closePath();
        ctx.fill();
      }
      dot(ctx, cx, cy - 0.02 * s, s * 0.05, trim);
      break;
    }
    case 'tailor': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = s * 0.08;
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.3, s * 0.1, Math.PI, Math.PI * 2.35);
      ctx.lineTo(cx, cy - s * 0.1);
      ctx.moveTo(cx, cy - s * 0.1);
      ctx.lineTo(cx + s * 0.44, cy + s * 0.22);
      ctx.quadraticCurveTo(cx + s * 0.48, cy + s * 0.3, cx + s * 0.38, cy + s * 0.3);
      ctx.lineTo(cx - s * 0.38, cy + s * 0.3);
      ctx.quadraticCurveTo(cx - s * 0.48, cy + s * 0.3, cx - s * 0.44, cy + s * 0.22);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = trim;
      ctx.lineWidth = s * 0.04;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.32, cy + s * 0.42);
      ctx.bezierCurveTo(cx - s * 0.1, cy + s * 0.32, cx + s * 0.1, cy + s * 0.5, cx + s * 0.34, cy + s * 0.4);
      ctx.stroke();
      break;
    }
    case 'hats': {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.22, cy - s * 0.38);
      ctx.lineTo(cx + s * 0.22, cy - s * 0.38);
      ctx.lineTo(cx + s * 0.25, cy + s * 0.18);
      ctx.lineTo(cx - s * 0.25, cy + s * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy + s * 0.2, s * 0.46, s * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = trim === ink ? '#7a2a3a' : '#a8323c';
      ctx.fillRect(cx - s * 0.245, cy + s * 0.02, s * 0.49, s * 0.1);
      break;
    }
    case 'surf': {
      ctx.save();
      ctx.translate(cx + s * 0.06, cy - s * 0.04);
      ctx.rotate(0.55);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.47);
      ctx.bezierCurveTo(s * 0.2, -s * 0.3, s * 0.17, s * 0.3, 0, s * 0.42);
      ctx.bezierCurveTo(-s * 0.17, s * 0.3, -s * 0.2, -s * 0.3, 0, -s * 0.47);
      ctx.fill();
      ctx.fillStyle = SIGN_STYLE.surfStripe;
      ctx.fillRect(-s * 0.035, -s * 0.36, s * 0.07, s * 0.7);
      ctx.restore();
      ctx.strokeStyle = trim;
      ctx.lineWidth = s * 0.07;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.46, cy + s * 0.36);
      ctx.quadraticCurveTo(cx - s * 0.24, cy + s * 0.2, cx - s * 0.02, cy + s * 0.36);
      ctx.quadraticCurveTo(cx + s * 0.2, cy + s * 0.5, cx + s * 0.44, cy + s * 0.32);
      ctx.stroke();
      break;
    }
    case 'cafe': {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.3, cy - s * 0.06);
      ctx.lineTo(cx + s * 0.22, cy - s * 0.06);
      ctx.quadraticCurveTo(cx + s * 0.2, cy + s * 0.3, cx - s * 0.04, cy + s * 0.3);
      ctx.quadraticCurveTo(cx - s * 0.28, cy + s * 0.3, cx - s * 0.3, cy - s * 0.06);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = s * 0.07;
      ctx.beginPath();
      ctx.arc(cx + s * 0.25, cy + s * 0.06, s * 0.09, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx - s * 0.04, cy + s * 0.36, s * 0.4, s * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = trim;
      ctx.lineWidth = s * 0.055;
      for (const dx of [-0.14, 0.04]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * s, cy - s * 0.13);
        ctx.bezierCurveTo(cx + (dx - 0.1) * s, cy - s * 0.24, cx + (dx + 0.1) * s, cy - s * 0.32, cx + dx * s, cy - s * 0.45);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

function stripes(ctx: Ctx, w: number, h: number): void {
  const S = SIGN_STYLE.trades.barber;
  for (const x0 of [6, w - 6 - 4]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 6, 4, h - 12);
    ctx.clip();
    ctx.fillStyle = '#fbf3e2';
    ctx.fillRect(x0, 6, 4, h - 12);
    ctx.fillStyle = S.trim;
    for (let y = 2; y < h; y += 5) {
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + 4, y - 3);
      ctx.lineTo(x0 + 4, y - 1.2);
      ctx.lineTo(x0, y + 1.8);
      ctx.fill();
    }
    ctx.restore();
  }
}

function invader(ctx: Ctx, cx: number, cy: number, s: number, col: string): void {
  const rows = ['00100000100', '00010001000', '00111111100', '01101110110', '11111111111', '10111111101', '10100000101', '00011011000'];
  const px = s / 11;
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = 5;
  ctx.fillStyle = col;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '1') ctx.fillRect(cx - s / 2 + c * px, cy - (rows.length * px) / 2 + r * px, px + 0.15, px + 0.15);
  });
  ctx.restore();
}

function fish(ctx: Ctx, cx: number, cy: number, s: number, col: string, flip: boolean): void {
  const d = flip ? -1 : 1;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.48, s * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - d * s * 0.4, cy);
  ctx.lineTo(cx - d * s * 0.72, cy - s * 0.24);
  ctx.lineTo(cx - d * s * 0.72, cy + s * 0.24);
  ctx.closePath();
  ctx.fill();
  dot(ctx, cx + d * s * 0.26, cy - s * 0.05, s * 0.06, SIGN_STYLE.fish.field);
}

function coin(ctx: Ctx, cx: number, cy: number, r: number): void {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  const [hi, midTone, low] = SIGN_STYLE.gold;
  g.addColorStop(0, hi);
  g.addColorStop(0.6, midTone);
  g.addColorStop(1, low);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 80, 20, 0.7)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
  ctx.stroke();
}

function rosette(ctx: Ctx, cx: number, cy: number, r: number): void {
  coin(ctx, cx, cy, r);
  ctx.fillStyle = 'rgba(120, 80, 20, 0.55)';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r * 0.36, cy + Math.sin(a) * r * 0.36, r * 0.22, r * 0.12, a, 0, Math.PI * 2);
    ctx.fill();
  }
}

function board(ctx: Ctx, w: number, h: number, r: number, frame: string, field: string, fieldTop: string): void {
  ctx.fillStyle = frame;
  roundRect(ctx, 0, 0, w, h, r);
  ctx.fill();
  ctx.fillStyle = grad(ctx, h, fieldTop, field);
  roundRect(ctx, 2.5, 2.5, w - 5, h - 5, Math.max(0.5, r - 1.5));
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fillRect(r, 0.6, w - 2 * r, 1);
}

function grain(ctx: Ctx, w: number, h: number, col: string): void {
  ctx.strokeStyle = col;
  ctx.lineWidth = 0.6;
  for (let y = 5; y < h - 3; y += 3.3) {
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.bezierCurveTo(w * 0.3, y + 0.9, w * 0.6, y - 0.9, w - 4, y + 0.4);
    ctx.stroke();
  }
}

function grad(ctx: Ctx, h: number, top: string, bottom: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function dot(ctx: Ctx, x: number, y: number, r: number, col: string): void {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function diamond(ctx: Ctx, x: number, y: number, r: number, col: string): void {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.7, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.7, y);
  ctx.closePath();
  ctx.fill();
}

function ring(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.strokeStyle = SIGN_STYLE.iron;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function plate(ctx: Ctx, top: { x: number; y: number }, bottom: { x: number; y: number }): void {
  line(ctx, top, bottom, SIGN_STYLE.iron, 3.2);
  for (const p of [top, bottom]) dot(ctx, p.x, p.y + (p === top ? 2 : -2), 0.9, SIGN_STYLE.ironLit);
}

function line(ctx: Ctx, a: { x: number; y: number }, b: { x: number; y: number }, col: string, width: number): void {
  ctx.strokeStyle = col;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function poly(ctx: Ctx, pts: readonly { x: number; y: number }[], col: string): void {
  const [a, ...rest] = pts;
  if (a === undefined) return;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  for (const p of rest) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();
}

// A hex colour lightened (amount > 0) or darkened (amount < 0).
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)));
  return `rgb(${ch.join(', ')})`;
}
