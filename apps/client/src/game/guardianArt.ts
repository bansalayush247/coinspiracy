// Low-poly guardian from the concept art, drawn with triangles at the foot point (0, 0).
import type { Pen } from './pen.js';
import { ART_SCALE } from './iso.js';
import { colorNumber, getItem } from '@byzantine-council/shared/economy';
import type { Face } from '@byzantine-council/shared/city';
import { COLORS, mix, type GuardianColors } from './palette.js';

/** Worn cosmetics as catalogue ids, '' for none; an unset hair, dye, beard or board is the default look (hood up, natural dark, none). */
export interface Wear {
  readonly hat: string;
  readonly shades: string;
  readonly outfit: string;
  readonly hair?: string;
  readonly dye?: string;
  readonly beard?: string;
  readonly board?: string;
}
export const NO_WEAR: Wear = { hat: '', shades: '', outfit: '' };

function palette(id: string): number[] {
  const item = id === '' ? undefined : getItem(id);
  return item === undefined ? [] : item.hints.colors.map((c) => colorNumber(c));
}

// The id when it names a catalogue item of that category, else ''.
function worn(id: string | undefined, category: string): string {
  return id !== undefined && getItem(id)?.category === category ? id : '';
}

const HAIR_STYLES = ['short', 'buzz', 'curls', 'long', 'braids', 'mohawk'] as const;
type HairStyle = (typeof HAIR_STYLES)[number];

// The worn hair style with the hood down, or undefined for the hood up.
function hairStyle(id: string | undefined): HairStyle | undefined {
  const value = getItem(worn(id, 'hair'))?.value;
  return HAIR_STYLES.find((s) => s === value);
}

interface HairTones {
  readonly base: number;
  readonly light: number;
  readonly deep: number;
}

function hairTones(dye: string | undefined): HairTones {
  const base = palette(worn(dye, 'dye'))[0] ?? palette('dye:dark')[0] ?? 0x2b2028;
  return { base, light: mix(base, 0xffffff, 0.4), deep: mix(base, 0x000000, 0.32) };
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
// Hood down: the hood lies bunched round the shoulders and the head shows.
const SHOULDERS: Poly = [[-13, 0], [-12, -32], [-10.6, -35.4], [-5.6, -34.6], [0, -33.2], [5.6, -34.6], [10.6, -35.4], [12, -32], [13, 0], [0, 3]];
const COWL_LIT: Poly = [[-12.6, -31.4], [-10.6, -35.4], [-5.6, -34.6], [0, -33.2], [0, -28.4], [-7, -29.4]];
const COWL_SHADOW: Poly = [[12.6, -31.4], [10.6, -35.4], [5.6, -34.6], [0, -33.2], [0, -28.4], [7, -29.4]];
const COWL_FOLD: Poly = [[-10.6, -35.4], [-5.6, -34.6], [0, -33.2], [-0.4, -32], [-5.8, -33.2], [-10.4, -33.8]];
const COWL_EDGE: Poly = [[-10.6, -35.4], [-5.6, -34.6], [0, -33.2], [5.6, -34.6], [10.6, -35.4]];
const DRAPE_LIT: Poly = [[-12.4, -31.6], [-10.6, -35.2], [0, -33.8], [0, -21.6], [-6.6, -26.4]];
const DRAPE_SHADOW: Poly = [[12.4, -31.6], [10.6, -35.2], [0, -33.8], [0, -21.6], [6.6, -26.4]];
const HEAD: Poly = [[-7, -33.6], [-7.6, -40], [-6.8, -45.4], [-3.8, -48.6], [0, -49.4], [3.8, -48.6], [6.8, -45.4], [7.6, -40], [7, -33.6], [0, -30.6]];
const HEAD_SHADE: Poly = [[0, -30.6], [0, -49.4], [3.8, -48.6], [6.8, -45.4], [7.6, -40], [7, -33.6]];
// Hair outlines are drawn for a guardian facing right and mirrored for one facing left.
const BUZZ_CAP: Poly = [[-7.9, -40.6], [-7.2, -45.8], [-4, -49.4], [0, -50.2], [4, -49.4], [7.2, -45.8], [7.9, -40.6], [7, -42.4], [6, -45.4], [0, -46.6], [-6, -45.4], [-7, -42.4]];
const SHORT_CROP: Poly = [[-8.4, -39.4], [-8.8, -45.2], [-6.6, -50.2], [-2.4, -52.6], [2.8, -52.4], [6.8, -50], [8.8, -45.4], [8.4, -39.4], [7.2, -40.6], [6.8, -43.4], [4.6, -42.4], [3.2, -44.8], [0, -45.6], [-3.2, -46], [-5.8, -45.4], [-6.8, -43], [-7.2, -40.6]];
const SHORT_SHADE: Poly = [[4, -52], [6.8, -50], [8.8, -45.4], [8.4, -39.4], [7.2, -40.6], [6.8, -43.4], [6.4, -47.4]];
const CURL_RING: readonly (readonly [number, number, number])[] = [[-8.4, -39.8, 6], [-9, -44.2, 6.6], [-7.8, -48.8, 6.8], [-4.6, -52, 7], [-0.2, -53.4, 7.2], [4.2, -52.4, 7], [7.6, -49, 6.8], [9, -44.4, 6.6], [8.4, -39.8, 6]];
const CURL_FRINGE: readonly (readonly [number, number])[] = [[-5, -45.6], [-1.8, -46.6], [1.6, -46.6], [4.8, -45.6]];
const CURL_FILL: Poly = [[-8, -41], [-7, -48], [-2, -51.6], [2, -51.6], [7, -48], [8, -41], [5, -45.2], [0, -46.2], [-5, -45.2]];
const LONG_MANE: Poly = [[-9, -44], [-9.8, -38], [-9.4, -33], [-10.4, -31.8], [-8, -31.2], [8, -31.2], [10.4, -31.8], [9.4, -33], [9.8, -38], [9, -44], [7, -50.2], [2.4, -52.6], [-2, -52.8], [-6.8, -50.6]];
const LONG_CROWN: Poly = [[-8.8, -41.6], [-8.4, -47], [-5.4, -51.4], [-1, -53], [3.6, -52.4], [7.4, -49.2], [8.8, -43.6], [8.8, -41.6], [6.8, -43], [4.6, -45.4], [1.6, -46.6], [-1.4, -47.8], [-2.6, -46.4], [-5, -45], [-7, -43.4]];
const LONG_LOCK: Poly = [[-6.8, -44], [-6.2, -40], [-6.6, -36], [-5.8, -32], [-7, -28], [-6.4, -24], [-8.2, -21.4], [-10.2, -23.6], [-9.4, -27.6], [-10.6, -31.6], [-9.6, -35.6], [-10, -40], [-9.4, -44]];
const BRAID_CROWN: Poly = [[-8.2, -40.6], [-8.2, -45.8], [-5.6, -50.2], [-1.6, -51.8], [1.6, -51.8], [5.6, -50.2], [8.2, -45.8], [8.2, -40.6], [6.8, -41.8], [6.2, -44.6], [3, -46], [0, -46.6], [-3, -46], [-6.2, -44.6], [-6.8, -41.8]];
const MOHAWK_CREST: Poly = [[-2.8, -45.8], [-7.4, -54], [-2.4, -51.4], [-4.6, -59.4], [-0.4, -54], [-1.2, -62.6], [1.8, -55.2], [2.4, -60.6], [3.8, -53.6], [5.8, -56.4], [3.2, -45.8]];
const BACK_CAP: Poly = [[-7.4, -36], [-7.6, -40], [-6.8, -45.6], [-3.8, -49.6], [0, -50.4], [3.8, -49.6], [6.8, -45.6], [7.6, -40], [7.4, -36], [3.6, -34.2], [0, -33.8], [-3.6, -34.2]];
const BACK_SHORT: Poly = [[-8.4, -36], [-8.8, -45.2], [-6.6, -50.2], [-2.4, -52.6], [2.8, -52.4], [6.8, -50], [8.8, -45.4], [8.4, -36], [6, -33.4], [4.6, -35], [2.4, -32.8], [0, -34.6], [-2.4, -32.8], [-4.6, -35], [-6, -33.4]];
const BACK_LONG: Poly = [[-9, -44], [-6.8, -50.6], [-2, -52.8], [2.4, -52.6], [7, -50.2], [9, -44], [9.8, -38], [9.4, -33], [10.4, -28.4], [9.6, -23.6], [6, -20.6], [3, -22.6], [0, -20.2], [-3, -22.6], [-6, -20.6], [-9.6, -23.6], [-10.4, -28.4], [-9.4, -33], [-9.8, -38]];
const BACK_CREST: Poly = [[-2.2, -34.6], [-2.6, -50], [-4.6, -58], [-1, -54.4], [0, -62], [1, -54.4], [4.6, -58], [2.6, -50], [2.2, -34.6]];
const CURL_BACK: readonly (readonly [number, number])[] = [[0, -52.4], [-3.4, -49.4], [3.4, -49.4], [-6.6, -45.6], [-2.2, -45.8], [2.2, -45.8], [6.6, -45.6], [-7.2, -41.4], [-3.6, -41.8], [0, -42], [3.6, -41.8], [7.2, -41.4], [-5.6, -37.6], [-1.8, -37.2], [1.8, -37.2], [5.6, -37.6]];
const BEARD: Poly = [[-7.5, -38.8], [-7.4, -34.4], [-4.6, -30.4], [0, -28.4], [4.6, -30.4], [7.4, -34.4], [7.5, -38.8], [6.5, -38.8], [6.2, -35.4], [3.8, -32.4], [1.8, -32], [0, -32.6], [-1.8, -32], [-3.8, -32.4], [-6.2, -35.4], [-6.5, -38.8]];
const BEARD_SHADE: Poly = [[0, -28.4], [4.6, -30.4], [7.4, -34.4], [7.5, -38.8], [6.5, -38.8], [6.2, -35.4], [3.8, -32.4], [1.8, -32], [0, -32.6]];
// A surfboard's half-width along its length, nose (0) to tail (1).
const BOARD_PROFILE: readonly (readonly [number, number])[] = [[0, 0], [0.04, 0.42], [0.12, 0.72], [0.25, 0.92], [0.42, 1], [0.6, 0.97], [0.78, 0.86], [0.92, 0.68], [1, 0.5]];
const STRAP = 0x6b4a3a;
const HAIR_RIM = 1.2;

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
  const hair = hairStyle(wear.hair);
  const board = palette(worn(wear.board, 'board'));
  const beard = worn(wear.beard, 'beard') !== '';
  const tones = hair !== undefined || beard ? hairTones(wear.dye) : undefined;
  if (board.length > 0 && !back) drawBoard(g, board, facing);
  // Warm rim light: the silhouette drawn slightly larger behind the body.
  g.lineStyle(1.6 * ART_SCALE, COLORS.rim, 0.85);
  g.beginPath();
  (hair === undefined ? SILHOUETTE : SHOULDERS).forEach(([x, y], i) => {
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
  if (board.length > 0) {
    if (back) drawBoard(g, board, facing);
    else polyline(g, STRAP, 1.5, [[-7.6 * facing, -31.4], [10 * facing, -15.6]], 0.95);
  }
  if (hair !== undefined && tones !== undefined) {
    if (back) {
      drawHairBack(g, hair, tones, colors, trim);
      drawHat(g, wear.hat, facing);
      return;
    }
    drawHairFront(g, hair, tones, facing, colors, trim);
  } else {
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
  }
  if (beard && tones !== undefined) drawBeard(g, tones);
  if (face === undefined) for (const ex of [-3.2, 3.2]) diamond(g, COLORS.eye, ex + facing, -38, 1.6, 2);
  else drawExpression(g, face, facing);
  diamond(g, COLORS.amulet, 0, -17.2, 3, 3);
  diamond(g, 0xfff1c9, -0.6, -18, 1, 1);
  if (trim !== undefined && hair === undefined) {
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

function trace(g: G, pts: Poly, f: 1 | -1): void {
  g.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) g.moveTo(x * f * ART_SCALE, y * ART_SCALE);
    else g.lineTo(x * f * ART_SCALE, y * ART_SCALE);
  });
  g.closePath();
}

// A filled outline mirrored by f, concave allowed; a rim width rings it first in the body's warm rim light.
function blob(g: G, color: number, pts: Poly, f: 1 | -1 = 1, alpha = 1, rim = 0): void {
  if (rim > 0) {
    g.lineStyle(rim * ART_SCALE, COLORS.rim, 0.85);
    trace(g, pts, f);
    g.strokePath();
  }
  g.fillStyle(color, alpha);
  trace(g, pts, f);
  g.fillPath();
}

function oval(g: G, color: number, x: number, y: number, w: number, h: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillEllipse(x * ART_SCALE, y * ART_SCALE, w * ART_SCALE, h * ART_SCALE);
}

function ovalRim(g: G, x: number, y: number, w: number, h: number): void {
  g.lineStyle(HAIR_RIM * ART_SCALE, COLORS.rim, 0.85);
  g.strokeEllipse(x * ART_SCALE, y * ART_SCALE, w * ART_SCALE, h * ART_SCALE);
}

const flip = (pts: Poly, f: 1 | -1): Poly => pts.map(([x, y]) => [x * f, y] as const);

// A surfboard slung across the back, nose up behind the far shoulder and tail out past the near hip.
function drawBoard(g: G, c: readonly number[], f: 1 | -1): void {
  const deck = c[0] ?? 0xb8e45c;
  const rail = c[1] ?? 0xfff1de;
  const [nx, ny, tx, ty] = [-16 * f, -62, 19 * f, -6];
  const len = Math.hypot(tx - nx, ty - ny);
  const [ux, uy] = [(tx - nx) / len, (ty - ny) / len];
  const width = (t: number): number => {
    const i = BOARD_PROFILE.findIndex(([at]) => at >= t);
    const [t1, w1] = BOARD_PROFILE[Math.max(i, 1)] ?? [1, 0.5];
    const [t0, w0] = BOARD_PROFILE[Math.max(i, 1) - 1] ?? [0, 0];
    return w0 + ((w1 - w0) * (t - t0)) / (t1 - t0);
  };
  const point = (t: number, offset: number): readonly [number, number] => [nx + ux * len * t - uy * offset, ny + uy * len * t + ux * offset];
  const edge = (half: number, side: number, from = 0, to = 1): (readonly [number, number])[] => {
    const ts = [from, ...BOARD_PROFILE.map(([at]) => at).filter((at) => at > from && at < to), to];
    return ts.map((at) => point(at, width(at) * half * side));
  };
  const band = (half: number, from: number, to: number): Poly => [...edge(half, 1, from, to), ...edge(half, -1, from, to).reverse()];
  blob(g, rail, band(6.4, 0, 1), 1, 1, 1.6);
  blob(g, deck, band(5.2, 0, 1));
  blob(g, mix(deck, 0x000000, 0.2), [...edge(5.2, -f), point(1, 0), point(0, 0)]);
  polyline(g, rail, 0.9, [point(0.05, 0), point(0.97, 0)], 0.9);
  blob(g, rail, band(5.4, 0.13, 0.24), 1, 0.9);
  blob(g, deck, band(5.4, 0.165, 0.205));
}

// Hood down, from the front: the hood bunched at the shoulders, then the head and the hair over it.
function drawHairFront(g: G, style: HairStyle, t: HairTones, f: 1 | -1, colors: GuardianColors, trim: number | undefined): void {
  if (style === 'long') blob(g, t.deep, LONG_MANE, 1, 1, HAIR_RIM);
  fan(g, colors.lit, COWL_LIT);
  fan(g, colors.shadow, COWL_SHADOW);
  fan(g, colors.highlight, COWL_FOLD, 0, 0.8);
  if (trim !== undefined) polyline(g, trim, 1.2, COWL_EDGE, 0.9);
  blob(g, COLORS.face, HEAD, 1, 1, HAIR_RIM);
  blob(g, mix(COLORS.face, 0x000000, 0.22), HEAD_SHADE, 1, 0.6);
  const shaded = mix(t.base, t.deep, 0.6);
  switch (style) {
    case 'buzz':
      blob(g, mix(t.base, COLORS.face, 0.25), BUZZ_CAP, f, 1, HAIR_RIM);
      polyline(g, t.light, 0.9, flip([[-5.4, -47.6], [-2.4, -49.2], [0.8, -49.4]], f), 0.75);
      return;
    case 'short':
      blob(g, t.base, SHORT_CROP, f, 1, HAIR_RIM);
      blob(g, t.deep, SHORT_SHADE, 1, 0.6);
      polyline(g, t.deep, 0.8, flip([[-3, -50.6], [1.4, -47.4], [4.6, -43.2]], f), 0.7);
      polyline(g, t.light, 0.9, flip([[-6, -48], [-2.6, -51], [1.6, -51.4]], f), 0.8);
      return;
    case 'curls':
      for (const [x, y, w] of CURL_RING) ovalRim(g, x, y, w, w * 0.94);
      blob(g, t.base, CURL_FILL);
      for (const [x, y, w] of CURL_RING) oval(g, x > 3 ? shaded : t.base, x, y, w, w * 0.94);
      for (const [x, y] of CURL_FRINGE) oval(g, x > 3 ? shaded : t.base, x, y, 4.4, 4);
      for (const [x, y, w] of CURL_RING) if (x < 3) oval(g, t.light, x - 1, y - 1.2, w * 0.32, w * 0.24, 0.75);
      return;
    case 'long':
      blob(g, t.base, LONG_LOCK, 1, 1, HAIR_RIM);
      blob(g, shaded, LONG_LOCK, -1, 1, HAIR_RIM);
      for (const s of [1, -1] as const) polyline(g, t.light, 0.7, flip([[-8.2, -42], [-7.6, -37], [-8.4, -32], [-7.8, -27]], s), 0.55);
      blob(g, t.base, LONG_CROWN, f, 1, HAIR_RIM);
      blob(g, t.deep, SHORT_SHADE, 1, 0.5);
      polyline(g, t.light, 0.9, flip([[-6.4, -48.4], [-3.4, -51], [0, -51.8]], f), 0.8);
      return;
    case 'braids':
      for (const s of [-1, 1] as const) drawBraid(g, s * 8.7, -41, -21, s < 0 ? t.base : shaded, t);
      blob(g, t.base, BRAID_CROWN, 1, 1, HAIR_RIM);
      blob(g, t.deep, SHORT_SHADE, 1, 0.45);
      for (const [a, b] of [[[-5.6, -45], [-4.2, -50]], [[-2.4, -46.2], [-1.6, -51.4]], [[2.4, -46.2], [1.6, -51.4]], [[5.6, -45], [4.2, -50]]] as const) polyline(g, t.deep, 0.6, [a, b], 0.75);
      polyline(g, t.light, 0.8, [[-6.4, -47.2], [-3.4, -50.2]], 0.7);
      return;
    case 'mohawk':
      blob(g, mix(t.base, COLORS.face, 0.45), BUZZ_CAP, f, 1, HAIR_RIM);
      blob(g, t.base, MOHAWK_CREST, f, 1, HAIR_RIM);
      blob(g, t.deep, flip([[0.8, -46], [3.2, -45.8], [3.8, -53.6], [5.8, -56.4], [1.8, -55.2]], f), 1, 0.55);
      polyline(g, t.light, 0.8, flip([[0, -47], [-1, -53], [-1.2, -59.6]], f), 0.8);
      return;
  }
}

// A braid as plaits slanting alternately from the ear down, tied off with a gold bead and a tuft.
function drawBraid(g: G, x: number, top: number, bottom: number, color: number, t: HairTones): void {
  const n = 6;
  const step = (bottom - top) / n;
  blob(g, color, [[x - 1.2, top], [x + 1.2, top], [x + 2, top + 3], [x + 1.7, bottom], [x - 1.7, bottom], [x - 2, top + 3]], 1, 1, HAIR_RIM);
  blob(g, color, [[x - 1.2, bottom], [x + 1.2, bottom], [x + 0.5, bottom + 3.4], [x - 0.7, bottom + 3]], 1, 1, HAIR_RIM);
  for (let i = 0; i < n; i++) {
    const y = top + step * i;
    const d = i % 2 === 0 ? 0.9 : -0.9;
    polyline(g, t.deep, 0.7, [[x - 1.9, y + step + d], [x + 1.9, y + step - d]], 0.9);
    polyline(g, t.light, 0.6, [[x - 1.2, y + 0.9 + d * 0.6], [x + 1, y + 0.9 - d * 0.6]], 0.55);
  }
  oval(g, COLORS.amulet, x, bottom + 0.2, 3, 2.2);
}

// Hood down, from behind: the hood hangs down the back and the hair covers the back of the head.
function drawDrape(g: G, colors: GuardianColors, trim: number | undefined): void {
  fan(g, colors.lit, DRAPE_LIT);
  fan(g, colors.shadow, DRAPE_SHADOW);
  g.lineStyle(1 * ART_SCALE, mix(colors.shadow, 0x000000, 0.3), 0.8);
  g.lineBetween(0, -33.6 * ART_SCALE, 0, -22 * ART_SCALE);
  if (trim !== undefined) polyline(g, trim, 1.2, [[-10.6, -35.2], [0, -33.8], [10.6, -35.2]], 0.9);
}

function drawHairBack(g: G, style: HairStyle, t: HairTones, colors: GuardianColors, trim: number | undefined): void {
  blob(g, COLORS.face, HEAD, 1, 1, HAIR_RIM);
  drawDrape(g, colors, trim);
  const shaded = mix(t.base, t.deep, 0.6);
  switch (style) {
    case 'buzz':
      blob(g, mix(t.base, COLORS.face, 0.25), BACK_CAP, 1, 1, HAIR_RIM);
      polyline(g, t.light, 0.9, [[-5.4, -47.6], [-2.4, -49.6], [0.8, -50]], 0.75);
      return;
    case 'short':
      blob(g, t.base, BACK_SHORT, 1, 1, HAIR_RIM);
      blob(g, t.deep, [[0, -34.6], [0, -52.5], [2.8, -52.4], [6.8, -50], [8.8, -45.4], [8.4, -36], [6, -33.4], [4.6, -35], [2.4, -32.8]], 1, 0.5);
      polyline(g, t.deep, 0.8, [[-1.4, -46.6], [1, -47.8], [0.6, -49.8], [-1.8, -49.6]], 0.8);
      polyline(g, t.light, 0.9, [[-6, -48], [-2.6, -51], [1.6, -51.4]], 0.8);
      return;
    case 'curls':
      for (const [x, y] of CURL_BACK) ovalRim(g, x, y, 6.4, 6);
      blob(g, t.base, BACK_CAP);
      for (const [x, y] of CURL_BACK) oval(g, x > 2 ? shaded : t.base, x, y, 6.4, 6);
      for (const [x, y] of CURL_BACK) if (x <= 2) oval(g, t.light, x - 1, y - 1.2, 2, 1.5, 0.75);
      return;
    case 'long':
      blob(g, t.base, BACK_LONG, 1, 1, HAIR_RIM);
      blob(g, shaded, [[0, -52.7], [2.4, -52.6], [7, -50.2], [9, -44], [9.8, -38], [9.4, -33], [10.4, -28.4], [9.6, -23.6], [6, -20.6], [3, -22.6], [0, -20.2]], 1, 0.7);
      for (const x of [-5, -1.6, 2, 5.4]) polyline(g, t.light, 0.7, [[x, -48], [x - 0.8, -40], [x + 0.4, -32], [x - 0.6, -24]], 0.45);
      return;
    case 'braids':
      for (const s of [-1, 1] as const) drawBraid(g, s * 3, -36, -16, s < 0 ? t.base : shaded, t);
      blob(g, t.base, BACK_CAP, 1, 1, HAIR_RIM);
      polyline(g, t.deep, 0.7, [[0, -50.2], [0, -36]], 0.8);
      polyline(g, t.light, 0.8, [[-6, -46], [-3.4, -49.2]], 0.7);
      return;
    case 'mohawk':
      blob(g, mix(t.base, COLORS.face, 0.45), BACK_CAP, 1, 1, HAIR_RIM);
      blob(g, t.base, BACK_CREST, 1, 1, HAIR_RIM);
      polyline(g, t.light, 0.8, [[-0.6, -36], [-0.8, -50], [-0.4, -58]], 0.75);
      return;
  }
}

// A trimmed beard along the jaw to a short chin tuft, in the dye colour, leaving room for the mouth drawn over it.
function drawBeard(g: G, t: HairTones): void {
  blob(g, t.base, BEARD, 1, 1, HAIR_RIM);
  blob(g, t.deep, BEARD_SHADE, 1, 0.55);
  polyline(g, t.light, 0.7, [[-3.4, -30.8], [0, -29.6], [3.4, -30.8]], 0.6);
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
