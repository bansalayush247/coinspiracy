// Story characters' costumes, drawn over the guardian body so each one reads at a glance: a hat or hair on the hood,
// something over the eyes, something at the collar, and a prop in the near hand. Guardians themselves wear none.
import type { Pen } from './pen.js';
import { ART_SCALE } from './iso.js';
import { mix } from './palette.js';

/** What sits on the hood. */
export type HeadPiece = 'bowler' | 'topHat' | 'beret' | 'headscarf' | 'bun' | 'cap' | 'beanie' | 'fedora' | 'chef' | 'headset' | 'flatcap' | 'wideHat' | 'rainHat' | 'captain';
/** What sits over the eyes. */
export type EyePiece = 'glasses' | 'monocle' | 'shades' | 'mask';
/** What sits at the collar or over the robe. */
export type NeckPiece = 'scarf' | 'tie' | 'bowtie' | 'pearls' | 'chain' | 'apron';
/** What the character carries. */
export type PropPiece = 'camera' | 'briefcase' | 'phone' | 'book' | 'satchel' | 'basket' | 'mic' | 'megaphone';

/** A character's costume: each piece with its main colour. */
export interface Costume {
  readonly head?: readonly [HeadPiece, number];
  readonly eyes?: readonly [EyePiece, number];
  readonly neck?: readonly [NeckPiece, number];
  readonly prop?: readonly [PropPiece, number];
}

type G = Pen;
type Pt = readonly [number, number];

const INK = 0x1a1020;

function trace(g: G, pts: readonly Pt[]): void {
  g.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) g.moveTo(x * ART_SCALE, y * ART_SCALE);
    else g.lineTo(x * ART_SCALE, y * ART_SCALE);
  });
}

function shape(g: G, color: number, pts: readonly Pt[], alpha = 1): void {
  g.fillStyle(color, alpha);
  trace(g, pts);
  g.closePath();
  g.fillPath();
}

function oval(g: G, color: number, x: number, y: number, w: number, h: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillEllipse(x * ART_SCALE, y * ART_SCALE, w * ART_SCALE, h * ART_SCALE);
}

function line(g: G, color: number, width: number, pts: readonly Pt[], alpha = 1): void {
  g.lineStyle(width * ART_SCALE, color, alpha);
  trace(g, pts);
  g.strokePath();
}

/** Draws a costume over a guardian body already drawn into `g`; `facing` is 1 for screen right, -1 for left. */
export function drawCostume(g: G, costume: Costume, facing: 1 | -1, back = false): void {
  // From behind only what wraps round shows: a scarf, a carried prop, the hat; glasses, ties, pearls and a camera on
  // the chest are hidden.
  if (costume.neck !== undefined && (!back || costume.neck[0] === 'scarf')) drawNeck(g, costume.neck[0], costume.neck[1], facing);
  if (costume.prop !== undefined && !(back && costume.prop[0] === 'camera')) drawProp(g, costume.prop[0], costume.prop[1], facing);
  if (costume.eyes !== undefined && !back) drawEyes(g, costume.eyes[0], costume.eyes[1], facing);
  if (costume.head !== undefined) drawHead(g, costume.head[0], costume.head[1], facing);
}

// Hats and hair sit on the hood's peak at (0, -56); brims point the way the character faces.
function drawHead(g: G, piece: HeadPiece, m: number, f: 1 | -1): void {
  const d = mix(m, 0x000000, 0.35);
  const l = mix(m, 0xffffff, 0.35);
  switch (piece) {
    case 'bowler':
      oval(g, d, 0, -50, 27, 6.5);
      shape(g, m, [[-8, -50], [8, -50], [7.4, -56], [3.4, -60], [-3.4, -60], [-7.4, -56]]);
      shape(g, d, [[-8, -50], [8, -50], [8, -52.4], [-8, -52.4]]);
      shape(g, l, [[-5.5, -56.5], [-1.5, -59.4], [-4, -55]], 0.7);
      return;
    case 'topHat':
      oval(g, d, 0, -50, 27, 6.5);
      shape(g, m, [[-7, -50], [7, -50], [7.6, -69], [-7.6, -69]]);
      shape(g, 0xb8344a, [[-7.1, -50.5], [7.1, -50.5], [7.2, -54], [-7.2, -54]]);
      oval(g, l, 0, -69, 15.5, 4);
      return;
    case 'beret':
      oval(g, d, f * 2, -53, 23, 8);
      oval(g, m, f * 2.4, -54.2, 21, 7);
      shape(g, d, [[f * 2, -57], [f * 3.4, -61], [f * 4.2, -60.4], [f * 3, -56.6]]);
      return;
    case 'headscarf':
      shape(g, m, [[-12.4, -31], [-10.4, -48.5], [0, -57], [0, -46.6], [-7.6, -42.2], [-7.6, -33.6]]);
      shape(g, d, [[12.4, -31], [10.4, -48.5], [0, -57], [0, -46.6], [7.6, -42.2], [7.6, -33.6]]);
      shape(g, l, [[-10.4, -48.5], [0, -57], [-3, -50]], 0.6);
      shape(g, d, [[-3, -31], [3, -31], [f * 5, -25], [f * 1, -26.5]]);
      return;
    case 'bun':
      shape(g, m, [[-9.6, -46], [-7, -53.5], [0, -56.6], [7, -53.5], [9.6, -46], [0, -49]]);
      oval(g, m, -f * 2.5, -59.5, 9.5, 8.5);
      oval(g, l, -f * 3.4, -61, 3.6, 2.6, 0.8);
      shape(g, d, [[-f * 6.4, -56.6], [f * 1.4, -56.6], [f * 1.2, -58], [-f * 6.2, -58]]);
      return;
    case 'cap':
      shape(g, m, [[-8.6, -50], [8.6, -50], [7.2, -56.6], [0, -60.2], [-7.2, -56.6]]);
      shape(g, d, [[f * 3, -50], [f * 15.5, -48.4], [f * 14.4, -51.2], [f * 4, -52.6]]);
      shape(g, l, [[-6, -56], [0, -59.4], [-2, -55]], 0.8);
      return;
    case 'beanie':
      shape(g, m, [[-9, -50], [9, -50], [8, -56.4], [0, -61.4], [-8, -56.4]]);
      shape(g, d, [[-9.6, -48], [9.6, -48], [9.4, -51.8], [-9.4, -51.8]]);
      oval(g, l, 0, -62.6, 5.6, 5.6);
      return;
    case 'fedora':
      oval(g, d, 0, -50, 31, 7.4);
      shape(g, m, [[-8, -50], [8, -50], [6.8, -59.4], [0, -56.8], [-6.8, -59.4]]);
      shape(g, INK, [[-8, -50], [8, -50], [7.8, -52.8], [-7.8, -52.8]]);
      return;
    case 'chef':
      shape(g, mix(m, 0x000000, 0.12), [[-8, -49.6], [8, -49.6], [8, -54.4], [-8, -54.4]]);
      oval(g, m, -4.8, -59, 10, 10);
      oval(g, m, 4.8, -59, 10, 10);
      oval(g, m, 0, -62.4, 12, 11);
      oval(g, mix(m, 0x000000, 0.12), 4.8, -58, 6, 5, 0.6);
      return;
    case 'headset':
      line(g, d, 1.8, [[-10.2, -43], [-8.4, -51.6], [0, -57.4], [8.4, -51.6], [10.2, -43]]);
      oval(g, m, -10.2, -41.6, 4.6, 7);
      oval(g, m, 10.2, -41.6, 4.6, 7);
      line(g, d, 1, [[f * 10, -39.4], [f * 6.4, -33.6], [f * 3, -33]]);
      oval(g, d, f * 2.6, -33, 2.2, 2.2);
      return;
    case 'flatcap':
      shape(g, m, [[-9, -50], [9, -50], [8.4, -54.6], [2, -57.4], [-6.6, -56.4]]);
      shape(g, d, [[f * 3.4, -50], [f * 14, -49], [f * 12.6, -52], [f * 3, -52.2]]);
      shape(g, l, [[-5, -55.4], [1.6, -56.8], [-1, -54.4]], 0.6);
      return;
    case 'wideHat':
      oval(g, d, 0, -50, 39, 9.4, 0.95);
      shape(g, m, [[-7, -50], [7, -50], [6.2, -58.6], [-6.2, -58.6]]);
      shape(g, INK, [[-7.1, -50.4], [7.1, -50.4], [7, -53], [-7, -53]], 0.8);
      return;
    case 'rainHat':
      oval(g, d, -f * 2, -48.4, 33, 9);
      oval(g, m, -f * 2, -49.4, 31, 7.6);
      shape(g, m, [[-8, -50], [8, -50], [6.4, -57], [0, -59.4], [-6.4, -57]]);
      shape(g, l, [[-5.4, -56.4], [0, -58.6], [-2, -55]], 0.7);
      return;
    case 'captain':
      shape(g, m, [[-9, -50], [9, -50], [10.4, -56.4], [-10.4, -56.4]]);
      oval(g, l, 0, -56.4, 21, 4.6);
      shape(g, INK, [[-9, -50], [9, -50], [9, -52], [-9, -52]]);
      shape(g, INK, [[f * 2, -50.4], [f * 12.6, -48.2], [f * 11.4, -51.2], [f * 2, -52.4]]);
      shape(g, 0xf2c14e, [[0, -55.6], [1.6, -53.8], [0, -52.2], [-1.6, -53.8]]);
      return;
  }
}

// The eyes are at y -38, nudged toward the facing side, as in the body.
function drawEyes(g: G, piece: EyePiece, m: number, f: 1 | -1): void {
  switch (piece) {
    case 'glasses':
      g.lineStyle(1.4 * ART_SCALE, m, 1);
      for (const ex of [-3.2, 3.2]) g.strokeCircle((ex + f) * ART_SCALE, -38 * ART_SCALE, 2.5 * ART_SCALE);
      line(g, m, 1.1, [[-0.7 + f, -38.4], [0.7 + f, -38.4]]);
      return;
    case 'monocle':
      g.lineStyle(1.2 * ART_SCALE, m, 1);
      g.strokeCircle((f * 3.2 + f) * ART_SCALE, -38 * ART_SCALE, 2.7 * ART_SCALE);
      line(g, m, 0.6, [[f * 3.2 + f, -35.3], [f * 5, -30], [f * 4, -24]], 0.9);
      return;
    case 'shades':
      for (const lens of [[[-6.2 + f, -40], [-0.9 + f, -40], [-1.5 + f, -36.4], [-5.6 + f, -36.4]], [[0.9 + f, -40], [6.2 + f, -40], [5.6 + f, -36.4], [1.5 + f, -36.4]]] as const) {
        shape(g, m, lens);
        line(g, mix(m, 0xffffff, 0.65), 0.7, [...lens, lens[0]]);
      }
      shape(g, 0xffffff, [[-5.2 + f, -39.6], [-3.6 + f, -39.6], [-4.6 + f, -38]], 0.7);
      line(g, INK, 0.8, [[-0.9 + f, -39.2], [0.9 + f, -39.2]]);
      return;
    case 'mask':
      shape(g, m, [[-7.6, -41], [7.6, -41], [7.6, -35.4], [-7.6, -35.4]]);
      for (const ex of [-3.2, 3.2]) shape(g, 0xf4f1ff, [[ex + f, -40], [ex + f + 1.6, -38], [ex + f, -36.2], [ex + f - 1.6, -38]]);
      return;
  }
}

// The collar is just under the face at y -31; the gold amulet sits on the belt at y -17.
function drawNeck(g: G, piece: NeckPiece, m: number, f: 1 | -1): void {
  const d = mix(m, 0x000000, 0.35);
  switch (piece) {
    case 'scarf':
      shape(g, m, [[-8.4, -31.4], [8.4, -31.4], [5.6, -25.4], [0, -23.6], [-5.6, -25.4]]);
      shape(g, d, [[f * 1.4, -25], [f * 5, -26.4], [f * 6.2, -15.6], [f * 3, -15]]);
      line(g, d, 0.8, [[-6.6, -28.6], [0, -26.4], [6.6, -28.6]], 0.6);
      return;
    case 'tie':
      shape(g, 0xf4f1ea, [[-4, -31.4], [0, -27.4], [-2.6, -26]]);
      shape(g, 0xf4f1ea, [[4, -31.4], [0, -27.4], [2.6, -26]]);
      shape(g, m, [[-1.4, -29.4], [1.4, -29.4], [2.4, -21.4], [0, -19.4], [-2.4, -21.4]]);
      shape(g, d, [[0, -31], [1.6, -29.4], [0, -27.6], [-1.6, -29.4]]);
      return;
    case 'bowtie':
      shape(g, m, [[0, -29.6], [-5, -32.4], [-5, -26.8]]);
      shape(g, m, [[0, -29.6], [5, -32.4], [5, -26.8]]);
      shape(g, d, [[0, -31.2], [1.4, -29.6], [0, -28], [-1.4, -29.6]]);
      return;
    case 'pearls':
    case 'chain':
      for (let i = 0; i <= 8; i++) {
        const x = -6.4 + (12.8 * i) / 8;
        const y = -31 + 4.4 * (1 - ((x / 6.4) ** 2));
        oval(g, m, x, y, piece === 'chain' ? 2.4 : 2, piece === 'chain' ? 1.8 : 2);
      }
      if (piece === 'chain') shape(g, mix(m, 0xffffff, 0.2), [[0, -26.4], [2.6, -23.6], [0, -20.8], [-2.6, -23.6]]);
      return;
    case 'apron':
      shape(g, m, [[-7.4, -29], [7.4, -29], [9.6, -2.4], [0, -0.6], [-9.6, -2.4]]);
      shape(g, d, [[-4, -14], [4, -14], [4, -9], [-4, -9]], 0.7);
      line(g, d, 0.9, [[-7, -29], [-5, -33]]);
      line(g, d, 0.9, [[7, -29], [5, -33]]);
      return;
  }
}

// The near hand is at about (-11.5, -12), on the lit side; chest props sit on the robe front.
function drawProp(g: G, piece: PropPiece, m: number, f: 1 | -1): void {
  const d = mix(m, 0x000000, 0.35);
  const l = mix(m, 0xffffff, 0.3);
  switch (piece) {
    case 'camera':
      line(g, d, 0.9, [[-6, -27], [-8, -31]]);
      line(g, d, 0.9, [[6, -27], [8, -31]]);
      shape(g, m, [[-6.4, -27.4], [6.4, -27.4], [6.4, -18.6], [-6.4, -18.6]]);
      shape(g, d, [[-6.4, -27.4], [-2.4, -27.4], [-2.4, -29.4], [-6.4, -29.4]]);
      oval(g, 0x8fa3b8, f * 1.4, -23, 7.4, 7.4);
      oval(g, 0x16141c, f * 1.4, -23, 5, 5);
      oval(g, 0xffffff, f * 1.4 - 1, -24.2, 1.6, 1.6, 0.8);
      return;
    case 'briefcase':
      line(g, d, 1.2, [[-16.6, -12.6], [-16.6, -14.4], [-11.4, -14.4], [-11.4, -12.6]]);
      shape(g, m, [[-19.4, -12.6], [-8.6, -12.6], [-8.6, -3.4], [-19.4, -3.4]]);
      shape(g, d, [[-19.4, -8.6], [-8.6, -8.6], [-8.6, -7.6], [-19.4, -7.6]]);
      shape(g, 0xf2c14e, [[-14.8, -9.2], [-13.2, -9.2], [-13.2, -7], [-14.8, -7]]);
      return;
    case 'phone':
      shape(g, INK, [[-15.6, -18], [-10.8, -18], [-10.8, -9.6], [-15.6, -9.6]]);
      shape(g, m, [[-15, -17.2], [-11.4, -17.2], [-11.4, -10.6], [-15, -10.6]]);
      return;
    case 'book':
      shape(g, m, [[-18, -17], [-9.4, -17], [-9.4, -7], [-18, -7]]);
      shape(g, 0xf4f1ea, [[-17.4, -16.4], [-10, -16.4], [-10, -15.4], [-17.4, -15.4]]);
      shape(g, d, [[-18, -17], [-16.6, -17], [-16.6, -7], [-18, -7]]);
      return;
    case 'satchel':
      line(g, d, 1.2, [[8, -31], [-9, -13]]);
      shape(g, m, [[-16.4, -14.4], [-6.4, -14.4], [-6.4, -4.2], [-16.4, -4.2]]);
      shape(g, d, [[-16.4, -14.4], [-6.4, -14.4], [-6.4, -10.4], [-16.4, -10.4]]);
      shape(g, 0xf2c14e, [[-11.8, -10.8], [-11, -10.8], [-11, -9.2], [-11.8, -9.2]]);
      return;
    case 'basket':
      line(g, d, 1.2, [[-17, -12], [-13, -18.4], [-9.4, -12]]);
      oval(g, 0xe2553f, -15.6, -12.6, 3.6, 3.4);
      oval(g, 0x7fbf4d, -12.4, -13, 3.6, 3.4);
      shape(g, m, [[-18.6, -12], [-7.6, -12], [-9.2, -3.6], [-17, -3.6]]);
      line(g, d, 0.7, [[-18, -9], [-8.2, -9]], 0.8);
      line(g, d, 0.7, [[-17.4, -6.2], [-8.8, -6.2]], 0.8);
      return;
    case 'mic':
      line(g, INK, 1.6, [[-11.6, -12.6], [-9.4, -24.6]]);
      oval(g, m, -9, -26.6, 4.4, 4.4);
      oval(g, l, -9.8, -27.4, 1.6, 1.6, 0.8);
      return;
    case 'megaphone':
      shape(g, m, [[f * 9, -27.4], [f * 21, -33.6], [f * 21, -19.4], [f * 9, -24.6]]);
      oval(g, d, f * 21, -26.5, 4, 14.2);
      oval(g, l, f * 21.3, -26.5, 2.4, 11);
      shape(g, INK, [[f * 7.4, -27.8], [f * 9.4, -27.8], [f * 9.4, -24], [f * 7.4, -24]]);
      return;
  }
}

/** Everyday outfits for crowds and passers-by, so no two people in a row dress alike. */
export const EVERYDAY_COSTUMES: readonly Costume[] = [
  { head: ['cap', 0x2b4c7e], prop: ['basket', 0xc89b5a] },
  { head: ['headscarf', 0xe2553f] },
  { head: ['beanie', 0xf2c14e], neck: ['scarf', 0x3b4a7a] },
  { head: ['flatcap', 0x55585f], prop: ['satchel', 0x8a5a2b] },
  { head: ['bun', 0x4a2c20], prop: ['basket', 0xc89b5a] },
  { head: ['wideHat', 0x6e8b3d] },
  { eyes: ['glasses', 0xd9d4e6], prop: ['book', 0x2f5f8a] },
  { head: ['cap', 0xe2553f], prop: ['phone', 0x9fd8ff] },
  { neck: ['scarf', 0x8c2f39] },
  { head: ['rainHat', 0xf2d13a] },
  { eyes: ['shades', 0x1a1020], neck: ['chain', 0xf2c14e] },
  {},
];
