// Low-poly guardian from the concept art, drawn with triangles at the foot point (0, 0).
import type { Pen } from './pen.js';
import { ART_SCALE } from './iso.js';
import { colorNumber, getItem } from '@byzantine-council/shared/economy';
import type { Face } from '@byzantine-council/shared/city';
import { COLORS, mix, type GuardianColors } from './palette.js';

// Worn cosmetics: catalogue ids, '' for none.
export interface Wear {
  readonly hat: string;
  readonly shades: string;
  readonly outfit: string;
}
export const NO_WEAR: Wear = { hat: '', shades: '', outfit: '' };

function palette(id: string): number[] {
  const item = id === '' ? undefined : getItem(id);
  return item === undefined ? [] : item.hints.colors.map((c) => colorNumber(c));
}

type G = Pen;
type Poly = readonly (readonly [number, number])[];

const ROBE_LIT: Poly = [[-13, 0], [-9, -32], [0, -32], [0, 3]];
const ROBE_SHADOW: Poly = [[0, 3], [0, -32], [9, -32], [13, 0]];
const HOOD_LIT: Poly = [[-12, -32], [-10, -48], [0, -56], [0, -30]];
const HOOD_SHADOW: Poly = [[0, -30], [0, -56], [10, -48], [12, -32]];
const HOOD_HIGHLIGHT: Poly = [[-10, -48], [0, -56], [-3, -45]];
const FACE: Poly = [[-7, -34], [-7, -42], [0, -46], [7, -42], [7, -34], [0, -31]];
const SILHOUETTE: Poly = [[-13, 0], [-12, -32], [-10, -48], [0, -56], [10, -48], [12, -32], [13, 0], [0, 3]];

// Height of the figure in world pixels, for placing name tags.
export const GUARDIAN_HEIGHT = 56 * ART_SCALE;

function fan(g: G, color: number, pts: Poly, dx = 0, alpha = 1): void {
  const [a] = pts;
  if (a === undefined) return;
  g.fillStyle(color, alpha);
  for (let i = 1; i < pts.length - 1; i++) {
    const b = pts[i];
    const c = pts[i + 1];
    if (b === undefined || c === undefined) continue;
    g.fillTriangle(
      (a[0] + dx) * ART_SCALE, a[1] * ART_SCALE,
      (b[0] + dx) * ART_SCALE, b[1] * ART_SCALE,
      (c[0] + dx) * ART_SCALE, c[1] * ART_SCALE,
    );
  }
}

function diamond(g: G, color: number, cx: number, cy: number, rx: number, ry: number): void {
  fan(g, color, [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]]);
}

/** A portrait's face at one moment: the expression, and whether the eyes are mid-blink or the mouth is open on a word. */
export interface FaceFrame {
  readonly face: Face;
  readonly blink: boolean;
  readonly talk: boolean;
}

// facing: 1 looks toward screen right, -1 toward screen left; back shows the guardian from behind, walking away.
export function drawGuardian(g: G, colors: GuardianColors, facing: 1 | -1, wear: Wear = NO_WEAR, back = false, face?: FaceFrame): void {
  g.clear();
  // Warm rim light: the silhouette drawn slightly larger behind the body.
  g.lineStyle(1.6 * ART_SCALE, COLORS.rim, 0.85);
  g.beginPath();
  SILHOUETTE.forEach(([x, y], i) => {
    if (i === 0) g.moveTo(x * ART_SCALE, y * ART_SCALE);
    else g.lineTo(x * ART_SCALE, y * ART_SCALE);
  });
  g.closePath();
  g.strokePath();
  fan(g, colors.lit, ROBE_LIT);
  fan(g, colors.shadow, ROBE_SHADOW);
  // Cloth folds: long darker creases falling from the waist to the hem.
  fan(g, colors.shadow, [[-8, 0], [-7.2, -20], [-6, 0]], 0, 0.55);
  fan(g, colors.shadow, [[-2.5, 2], [-2.8, -18], [-1, 2]], 0, 0.4);
  fan(g, mix(colors.shadow, 0x000000, 0.25), [[5, 1], [4.2, -20], [7, 0]], 0, 0.6);
  // Hem: a darker band where the robe brushes the ground.
  fan(g, mix(colors.lit, colors.shadow, 0.55), [[-13, 0], [-12.4, -3], [0, 0], [0, 3]]);
  fan(g, mix(colors.shadow, 0x000000, 0.2), [[0, 3], [0, 0], [12.4, -3], [13, 0]]);
  // Belt with a gold clasp; a worn outfit lends the belt and hood edge its colour.
  const outfit = palette(wear.outfit);
  const trim = outfit[2] ?? outfit[0];
  fan(g, trim ?? mix(colors.shadow, 0x000000, 0.35), [[-10.6, -19], [10.6, -19], [10.2, -15.5], [-10.2, -15.5]]);
  // Sleeves and hands, the near arm toward the sun.
  fan(g, colors.lit, [[-11, -30], [-14, -14], [-9, -13], [-7, -28]]);
  fan(g, colors.shadow, [[11, -30], [14, -14], [9, -13], [7, -28]]);
  if (!back) {
    fan(g, 0xe8c4a8, [[-13.5, -14], [-9.5, -13.2], [-10.8, -10.5]]);
    fan(g, 0xb8948a, [[13.5, -14], [9.5, -13.2], [10.8, -10.5]]);
  }
  fan(g, colors.lit, HOOD_LIT);
  fan(g, colors.shadow, HOOD_SHADOW);
  fan(g, colors.highlight, HOOD_HIGHLIGHT);
  if (back) {
    drawHoodBack(g, colors, trim);
    drawHat(g, wear.hat, facing);
    return;
  }
  fan(g, COLORS.face, FACE);
  // The hood's inner shadow over the brow.
  fan(g, mix(COLORS.face, 0x000000, 0.35), [[-7, -42], [0, -46], [7, -42], [0, -43.5]]);
  if (face === undefined) for (const ex of [-3.2, 3.2]) diamond(g, COLORS.eye, ex + facing, -38, 1.6, 2);
  else drawExpression(g, face, facing);
  diamond(g, COLORS.amulet, 0, -17.2, 3, 3);
  diamond(g, 0xfff1c9, -0.6, -18, 1, 1);
  if (trim !== undefined) {
    g.lineStyle(1.2 * ART_SCALE, trim, 0.9);
    g.beginPath();
    g.moveTo(-7 * ART_SCALE, -34 * ART_SCALE);
    g.lineTo(-7 * ART_SCALE, -42 * ART_SCALE);
    g.lineTo(0, -46 * ART_SCALE);
    g.lineTo(7 * ART_SCALE, -42 * ART_SCALE);
    g.lineTo(7 * ART_SCALE, -34 * ART_SCALE);
    g.strokePath();
  }
  drawShades(g, wear.shades, facing);
  drawHat(g, wear.hat, facing);
}

type EyeShape = 'open' | 'wide' | 'narrow' | 'arc' | 'lid' | 'side' | 'shut';
type MouthShape = 'line' | 'smile' | 'frown' | 'o' | 'smirk' | 'tight' | 'wobble' | 'hush';
// Brow heights, left outer and inner then right inner and outer; higher on the face is more negative.
type Brows = readonly [number, number, number, number];

const EXPRESSIONS: Readonly<Record<Face, { readonly eyes: EyeShape; readonly brows: Brows; readonly mouth: MouthShape }>> = {
  calm: { eyes: 'open', brows: [-41.6, -41.6, -41.6, -41.6], mouth: 'line' },
  happy: { eyes: 'arc', brows: [-41.8, -42.3, -42.3, -41.8], mouth: 'smile' },
  angry: { eyes: 'narrow', brows: [-42.6, -40.4, -40.4, -42.6], mouth: 'tight' },
  worried: { eyes: 'open', brows: [-41, -42.8, -42.8, -41], mouth: 'wobble' },
  surprised: { eyes: 'wide', brows: [-43.2, -43.4, -43.4, -43.2], mouth: 'o' },
  sad: { eyes: 'lid', brows: [-40.9, -42.6, -42.6, -40.9], mouth: 'frown' },
  smug: { eyes: 'lid', brows: [-41.4, -41.2, -42.6, -43], mouth: 'smirk' },
  whisper: { eyes: 'side', brows: [-41.4, -41.6, -41.6, -41.4], mouth: 'hush' },
  curious: { eyes: 'open', brows: [-41.4, -41.4, -42.9, -43.3], mouth: 'line' },
};

function polyline(g: G, color: number, width: number, pts: Poly, alpha = 1): void {
  g.lineStyle(width * ART_SCALE, color, alpha);
  g.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) g.moveTo(x * ART_SCALE, y * ART_SCALE);
    else g.lineTo(x * ART_SCALE, y * ART_SCALE);
  });
  g.strokePath();
}

function drawEye(g: G, shape: EyeShape, ex: number, facing: 1 | -1): void {
  const ey = -38;
  const c = COLORS.eye;
  if (shape === 'open') diamond(g, c, ex, ey, 1.6, 2);
  else if (shape === 'wide') {
    diamond(g, c, ex, ey, 1.9, 2.6);
    diamond(g, COLORS.face, ex + 0.3 * facing, ey, 0.6, 0.8);
  } else if (shape === 'narrow') diamond(g, c, ex, ey + 0.3, 1.8, 1);
  else if (shape === 'arc') polyline(g, c, 1.1, [[ex - 1.7, ey + 0.7], [ex, ey - 1.1], [ex + 1.7, ey + 0.7]]);
  else if (shape === 'lid') fan(g, c, [[ex - 1.7, ey - 0.1], [ex + 1.7, ey - 0.1], [ex, ey + 1.9]]);
  else if (shape === 'side') diamond(g, c, ex + 0.8 * facing, ey + 0.2, 1.4, 1.5);
  else polyline(g, c, 0.9, [[ex - 1.7, ey + 0.2], [ex, ey + 0.9], [ex + 1.7, ey + 0.2]]);
}

function drawMouth(g: G, shape: MouthShape, talk: boolean, mx: number): void {
  const y = -33.8;
  const c = COLORS.eye;
  if (talk) {
    const [w, h] = shape === 'o' ? [2.2, 2.8] : shape === 'hush' ? [1.4, 1.1] : shape === 'smile' ? [3, 2] : [2.6, 1.6];
    g.fillStyle(c, 0.75);
    g.fillEllipse(mx * ART_SCALE, y * ART_SCALE, w * ART_SCALE, h * ART_SCALE);
    return;
  }
  if (shape === 'o' || shape === 'hush') {
    const [w, h] = shape === 'o' ? [1.8, 2.2] : [1.2, 1];
    g.fillStyle(c, 0.75);
    g.fillEllipse(mx * ART_SCALE, y * ART_SCALE, w * ART_SCALE, h * ART_SCALE);
    return;
  }
  const pts: Record<Exclude<MouthShape, 'o' | 'hush'>, Poly> = {
    line: [[mx - 1.6, y], [mx + 1.6, y]],
    smile: [[mx - 2.3, y - 0.7], [mx, y + 0.9], [mx + 2.3, y - 0.7]],
    frown: [[mx - 2, y + 0.7], [mx, y - 0.6], [mx + 2, y + 0.7]],
    smirk: [[mx - 1.8, y + 0.2], [mx + 0.6, y + 0.2], [mx + 2.2, y - 0.9]],
    tight: [[mx - 2.3, y + 0.6], [mx - 1.6, y], [mx + 1.6, y], [mx + 2.3, y + 0.6]],
    wobble: [[mx - 2, y], [mx - 1, y - 0.5], [mx, y], [mx + 1, y - 0.5], [mx + 2, y]],
  };
  polyline(g, c, 0.9, pts[shape], 0.85);
}

// A portrait's face: eyes, brows and mouth shaped by the expression, looking the way the guardian faces.
function drawExpression(g: G, frame: FaceFrame, facing: 1 | -1): void {
  const e = EXPRESSIONS[frame.face];
  const [lo, li, ri, ro] = e.brows;
  const left = -3.2 + facing;
  const right = 3.2 + facing;
  drawEye(g, frame.blink ? 'shut' : e.eyes, left, facing);
  drawEye(g, frame.blink ? 'shut' : e.eyes, right, facing);
  polyline(g, COLORS.eye, 0.85, [[left - 2, lo], [left + 1.5, li]], 0.8);
  polyline(g, COLORS.eye, 0.85, [[right - 1.5, ri], [right + 2, ro]], 0.8);
  drawMouth(g, e.mouth, frame.talk, 0.5 * facing);
}

// The back of the hood where the face would be: cloth, a seam down the middle and the hood's drape on the shoulders.
function drawHoodBack(g: G, colors: GuardianColors, trim: number | undefined): void {
  fan(g, mix(colors.lit, colors.shadow, 0.45), [[-7, -34], [-7, -42], [0, -46], [0, -31]]);
  fan(g, mix(colors.shadow, 0x000000, 0.12), [[0, -31], [0, -46], [7, -42], [7, -34]]);
  fan(g, mix(colors.shadow, 0x000000, 0.2), [[-12, -32], [0, -29], [12, -32], [0, -33.5]]);
  g.lineStyle(1 * ART_SCALE, mix(colors.shadow, 0x000000, 0.3), 0.8);
  g.lineBetween(0, -55 * ART_SCALE, 0, -31 * ART_SCALE);
  if (trim === undefined) return;
  g.lineStyle(1.2 * ART_SCALE, trim, 0.9);
  g.lineBetween(-12 * ART_SCALE, -32 * ART_SCALE, 12 * ART_SCALE, -32 * ART_SCALE);
}

function drawShades(g: G, id: string, facing: 1 | -1): void {
  const c = palette(id);
  if (c.length === 0) return;
  const left = c[0] ?? 0x1a1020;
  const right = id === 'shades:partition' ? (c[1] ?? left) : left;
  const glint = id === 'shades:partition' ? 0xffffff : (c[1] ?? 0xffffff);
  fan(g, left, [[-6 + facing, -39.8], [-1 + facing, -39.8], [-1.6 + facing, -36.6], [-5.4 + facing, -36.6]]);
  fan(g, right, [[1 + facing, -39.8], [6 + facing, -39.8], [5.4 + facing, -36.6], [1.6 + facing, -36.6]]);
  fan(g, glint, [[-5 + facing, -39.4], [-3.6 + facing, -39.4], [-4.4 + facing, -38]], 0, 0.8);
  g.lineStyle(0.8 * ART_SCALE, 0x1a1020, 1);
  g.lineBetween((-1 + facing) * ART_SCALE, -39 * ART_SCALE, (1 + facing) * ART_SCALE, -39 * ART_SCALE);
}

// Hats sit on the hood's peak at (0, -56); the brim points the way the guardian faces.
function drawHat(g: G, id: string, facing: 1 | -1): void {
  const c = palette(id);
  if (c.length === 0) return;
  const main = c[0] ?? 0xffd27a;
  const second = c[1] ?? mix(main, 0x000000, 0.3);
  const s = ART_SCALE;
  if (id === 'hat:straw') {
    g.fillStyle(mix(main, 0x000000, 0.2), 1);
    g.fillEllipse(0, -49 * s, 34 * s, 9 * s);
    g.fillStyle(main, 1);
    g.fillEllipse(0, -50 * s, 32 * s, 8 * s);
    fan(g, c[2] ?? main, [[-8, -50], [-6, -60], [6, -60], [8, -50]]);
    fan(g, c[3] ?? second, [[-8, -52], [8, -52], [7.8, -54.5], [-7.8, -54.5]]);
  } else if (id === 'hat:bucket') {
    fan(g, second, [[-13, -47], [13, -47], [9, -52], [-9, -52]]);
    fan(g, main, [[-8, -52], [8, -52], [6, -61], [-6, -61]]);
  } else if (id === 'hat:threshold') {
    // A crown of three points with a gem on each: the threshold.
    fan(g, second, [[-9, -50], [9, -50], [9, -54], [-9, -54]]);
    fan(g, main, [[-9, -54], [9, -54], [9, -58], [5, -55], [0, -63], [-5, -55], [-9, -58]]);
    for (const [x, y] of [[-6.5, -57], [0, -60.5], [6.5, -57]] as const) diamond(g, 0x5fd3b0, x, y, 1.4, 1.4);
  } else if (id === 'hat:archon') {
    fan(g, c[3] ?? second, [[-11, -50], [11, -50], [9, -53], [-9, -53]]);
    fan(g, main, [[-7, -53], [7, -53], [2 * facing, -76]]);
    diamond(g, second, 2 * facing, -76, 2, 2);
  } else if (id === 'hat:scholar') {
    fan(g, main, HOOD_LIT);
    fan(g, mix(main, 0x000000, 0.3), HOOD_SHADOW);
    g.lineStyle(1.4 * s, second, 1);
    g.lineBetween(-10 * s, -48 * s, 0, -56 * s);
    g.lineBetween(0, -56 * s, 10 * s, -48 * s);
  } else {
    // Caps: a dome on the hood with a brim toward the facing side.
    fan(g, main, [[-8.5, -50], [8.5, -50], [7, -56.5], [0, -60], [-7, -56.5]]);
    fan(g, second, [[facing * 3, -50], [facing * 15, -48.5], [facing * 14, -51], [facing * 4, -52.5]]);
    fan(g, mix(main, 0xffffff, 0.3), [[-6, -56], [0, -59.4], [-2, -55]], 0, 0.8);
  }
}

// Marks your own guardian with a faint gold glow on the ground and a hairline rim, quiet enough to walk with.
export function drawShadow(g: G, isMe: boolean): void {
  g.clear();
  if (!isMe) return;
  g.fillStyle(COLORS.gold, 0.12);
  g.fillEllipse(0, 0, 30 * ART_SCALE, 13 * ART_SCALE, 32);
  g.lineStyle(1 * ART_SCALE, COLORS.gold, 0.35);
  g.strokeEllipse(0, 0, 30 * ART_SCALE, 13 * ART_SCALE, 32);
}
