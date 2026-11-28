// Emotes as things a guardian does rather than icons over their head: a wave of the hand, a jump for joy, a little
// dance, hearts, a laugh that shakes them, a shaka. Each is a pose over time plus a hand or a small flourish.
import Phaser from 'phaser';
import type { Emote } from '@byzantine-council/shared/hub';
import { ACTION, poseAt } from './emotePoses.js';
import { GUARDIAN_HEIGHT } from './guardianArt.js';
import { ART_SCALE } from './iso.js';
import { COLORS, mix, type GuardianColors } from './palette.js';

const H = GUARDIAN_HEIGHT;
const S = ART_SCALE;

/** The colours of a cheer's confetti. */
export const CONFETTI: readonly number[] = Object.freeze([0xff7f6a, 0xffd27a, 0x5fd3b0, 0xa983ff, 0x7fc8ff]);

type Pt = readonly [number, number];

// A guardian's hands are made of the same dark, faceted stuff as the face under the hood, rimmed with the same warm light.
const HAND = COLORS.face;
const HAND_LIT = mix(COLORS.face, 0xffffff, 0.2);
const HAND_DARK = mix(COLORS.face, 0x000000, 0.35);

// A finger: wide at the knuckle with a blunt, chamfered tip, and its lit half towards the light.
function digit(bx: number, by: number, tx: number, ty: number, w: number): { readonly all: readonly Pt[]; readonly lit: readonly Pt[] } {
  const len = Math.hypot(tx - bx, ty - by) || 1;
  const ux = (tx - bx) / len;
  const uy = (ty - by) / len;
  const nx = -uy * w;
  const ny = ux * w;
  const cx = tx - ux * w * 0.75;
  const cy = ty - uy * w * 0.75;
  const all: Pt[] = [[bx - nx, by - ny], [cx - nx, cy - ny], [tx - nx * 0.5, ty - ny * 0.5], [tx + nx * 0.5, ty + ny * 0.5], [cx + nx, cy + ny], [bx + nx, by + ny]];
  return { all, lit: [[bx - nx, by - ny], [cx - nx, cy - ny], [tx - nx * 0.5, ty - ny * 0.5], [tx, ty], [bx, by]] };
}

const PALM: readonly Pt[] = [[-3.4, 0], [3.4, 0], [4, -2.6], [3.6, -6.4], [2.6, -7.4], [-2.6, -7.4], [-3.6, -6.4], [-4, -2.6]];
const PALM_LIT: readonly Pt[] = [[-3.4, 0], [0.2, 0], [0.4, -7.4], [-2.6, -7.4], [-3.6, -6.4], [-4, -2.6]];

const OPEN_FINGERS = [digit(-2.35, -6.2, -3.3, -10.6, 0.98), digit(-0.75, -6.6, -0.95, -11.6, 1.02), digit(0.85, -6.6, 1.35, -11.2, 1), digit(2.4, -6, 3.6, -9.7, 0.92), digit(-3.3, -2.6, -6.4, -6, 1.1)];
const SHAKA_FINGERS = [digit(2.5, -5.8, 6.2, -11, 1.02), digit(-3.3, -2.6, -8, -4.6, 1.15)];
// The three fingers folded into the palm, seen as rounded knuckles along its top edge.
const KNUCKLES: readonly (readonly Pt[])[] = [
  [[-2.8, -6.6], [-1.1, -6.6], [-1.0, -8.2], [-1.5, -8.8], [-2.4, -8.8], [-2.9, -8.2]],
  [[-1.1, -6.6], [0.6, -6.6], [0.7, -8.4], [0.2, -9], [-0.7, -9], [-1.2, -8.4]],
  [[0.6, -6.6], [2.3, -6.6], [2.3, -8.1], [1.8, -8.6], [1.0, -8.6], [0.6, -8.1]],
];

function trace(g: Phaser.GameObjects.Graphics, pts: readonly Pt[]): void {
  g.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) g.moveTo(x * S, y * S);
    else g.lineTo(x * S, y * S);
  });
  g.closePath();
}

function fillPoly(g: Phaser.GameObjects.Graphics, pts: readonly Pt[], color: number): void {
  g.fillStyle(color, 1);
  trace(g, pts);
  g.fillPath();
}

/** Draws a guardian's hand, wrist at the origin and fingers up, open or making a shaka. */
export function drawHand(g: Phaser.GameObjects.Graphics, sign: 'open' | 'shaka'): void {
  g.clear();
  const fingers = sign === 'open' ? OPEN_FINGERS : SHAKA_FINGERS;
  const solids = [PALM, ...fingers.map((f) => f.all), ...(sign === 'shaka' ? KNUCKLES : [])];
  g.lineStyle(1.8 * S, COLORS.rim, 0.9);
  for (const pts of solids) {
    trace(g, pts);
    g.strokePath();
  }
  for (const pts of solids) fillPoly(g, pts, HAND);
  fillPoly(g, PALM_LIT, HAND_LIT);
  for (const f of fingers) fillPoly(g, f.lit, HAND_LIT);
  if (sign === 'shaka') for (const k of KNUCKLES) fillPoly(g, [k[1] ?? [0, 0], k[2] ?? [0, 0], k[3] ?? [0, 0], k[0] ?? [0, 0]], HAND_LIT);
  fillPoly(g, [[0.9, -4.6], [1.8, -3.6], [0.9, -2.6], [0, -3.6]], COLORS.eye);
}

function drawHeart(g: Phaser.GameObjects.Graphics, size: number): void {
  const r = size / 2;
  g.fillStyle(0xff5a7a, 1);
  g.fillCircle(-r * 0.55, -r * 0.2, r * 0.62);
  g.fillCircle(r * 0.55, -r * 0.2, r * 0.62);
  g.fillTriangle(-r * 1.12, 0, r * 1.12, 0, 0, r * 1.15);
  g.fillStyle(0xffffff, 0.6);
  g.fillCircle(-r * 0.6, -r * 0.4, r * 0.2);
}

const FLOURISH_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Small pictures that rise off the guardian: hearts, music notes, a laugh; staggered so they come out one by one.
type Flourish = Phaser.GameObjects.Graphics | Phaser.GameObjects.Text;

function flourishes(emote: Emote): readonly { readonly make: (scene: Phaser.Scene) => Flourish; readonly delay: number; readonly side: number }[] {
  const text = (glyph: string, color: string, size: number) => (scene: Phaser.Scene): Phaser.GameObjects.Text =>
    new Phaser.GameObjects.Text(scene, 0, 0, glyph, { fontFamily: FLOURISH_FONT, fontSize: `${String(size)}px`, fontStyle: '800', color, stroke: '#2a1a33', strokeThickness: 4 }).setOrigin(0.5, 1);
  switch (emote) {
    case 'heart':
      return [0, 1, 2, 3].map((i) => ({
        make: (scene: Phaser.Scene) => {
          const g = new Phaser.GameObjects.Graphics(scene);
          drawHeart(g, (8 + (i % 2) * 3) * S);
          return g;
        },
        delay: i * 260,
        side: i % 2 === 0 ? -1 : 1,
      }));
    case 'dance':
      return [0, 1, 2, 3].map((i) => ({ make: text(i % 2 === 0 ? '♪' : '♫', '#ffd27a', 22), delay: i * 520, side: i % 2 === 0 ? 1 : -1 }));
    case 'laugh':
      return [0, 1, 2].map((i) => ({ make: text(i === 1 ? 'ha!' : 'ha', '#fff1de', i === 1 ? 18 : 15), delay: i * 300, side: i % 2 === 0 ? 1 : -1 }));
    case 'wave':
    case 'cheer':
    case 'shaka':
      return [];
  }
}

/** Sends an emote's flourishes up from a guardian's head at (x, y) in world space, into `layer`. */
export function spawnFlourishes(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, emote: Emote, x: number, y: number, reduced: boolean): void {
  for (const f of flourishes(emote)) {
    const node = f.make(scene);
    node.setPosition(x + f.side * 0.3 * H, y).setAlpha(0);
    layer.add(node);
    scene.tweens.add({
      targets: node,
      delay: f.delay,
      duration: ACTION.flourishMs,
      alpha: { from: 1, to: 0 },
      y: reduced ? y : y - ACTION.riseHeight,
      x: reduced ? node.x : node.x + f.side * 6 * S,
      ease: 'Sine.easeOut',
      onComplete: () => {
        node.destroy();
      },
    });
  }
}

// How big a hand is drawn, where the arm leaves the robe, the sleeve's half-width at shoulder, elbow and bell cuff in art
// units, and how much of the way to the pose's hand position the arm reaches, keeping arms in proportion with the robe.
const HAND_SCALE = 0.8;
const SHOULDER = { x: 10.5, y: -29 };
const WIDTH = { shoulder: 3.2, elbow: 2.6, cuff: 3.9 };
const REACH = 0.8;
// How far the elbow sits out of line between shoulder and wrist, as a share of the arm's length.
const BEND = 0.28;

type V = { x: number; y: number };

// A tapered stretch of sleeve from a to b: its upper half in the light, its lower half in shade.
function sleeveSegment(g: Phaser.GameObjects.Graphics, a: V, b: V, wa: number, wb: number, light: number, dark: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const up: Pt[] = [[a.x + nx * wa, a.y + ny * wa], [b.x + nx * wb, b.y + ny * wb], [b.x, b.y], [a.x, a.y]];
  const down: Pt[] = [[a.x, a.y], [b.x, b.y], [b.x - nx * wb, b.y - ny * wb], [a.x - nx * wa, a.y - ny * wa]];
  fillPoly(g, up, light);
  fillPoly(g, down, dark);
}

function outline(g: Phaser.GameObjects.Graphics, a: V, b: V, wa: number, wb: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  trace(g, [[a.x + nx * wa, a.y + ny * wa], [b.x + nx * wb, b.y + ny * wb], [b.x - nx * wb, b.y - ny * wb], [a.x - nx * wa, a.y - ny * wa]]);
  g.strokePath();
}

// An ellipse across the sleeve's end at c, along direction d: the dark inside of the bell cuff, or its near lip.
function cuffRing(c: V, d: V, across: number, along: number, from: number, to: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = from + ((to - from) * i) / 12;
    const u = Math.cos(t) * across;
    const v = Math.sin(t) * along;
    pts.push([c.x - d.y * u + d.x * v, c.y + d.x * u + d.y * v]);
  }
  return pts;
}

/** One guardian's emote in progress: moves their body each frame and raises their arms out of the robe, then tidies up. */
export class EmoteAction {
  readonly #arms: { readonly sleeve: Phaser.GameObjects.Graphics; readonly hand: Phaser.GameObjects.Graphics; readonly lip: Phaser.GameObjects.Graphics }[] = [];
  readonly #start: number;
  readonly #robe: GuardianColors;

  constructor(scene: Phaser.Scene, root: Phaser.GameObjects.Container, body: Phaser.GameObjects.Graphics, readonly emote: Emote, colors: GuardianColors, now: number) {
    this.#start = now;
    this.#robe = colors;
    const first = poseAt(emote, 0, 1);
    if (first?.hand == null) return;
    for (let i = 0; i < (first.hand.both ? 2 : 1); i++) {
      const sleeve = new Phaser.GameObjects.Graphics(scene);
      const hand = new Phaser.GameObjects.Graphics(scene);
      const lip = new Phaser.GameObjects.Graphics(scene);
      drawHand(hand, first.hand.sign);
      // The sleeve goes behind the robe, so the arm comes out from under it; the hand and the cuff's lip stay in front.
      const under = root.getIndex(body);
      if (under >= 0) root.addAt(sleeve, under);
      else root.add(sleeve);
      root.add([hand, lip]);
      this.#arms.push({ sleeve, hand, lip });
    }
  }

  /** Poses the body for this moment, `baseY` being where it would be standing; false once the action is over. */
  update(now: number, body: Phaser.GameObjects.Graphics, baseY: number, facing: 1 | -1, reduced: boolean): boolean {
    const pose = poseAt(this.emote, now - this.#start, facing);
    if (pose === null) return false;
    const p = reduced ? { ...pose, dx: 0, dy: 0, rot: 0, sx: Math.sign(pose.sx), sy: 1 } : pose;
    body.setPosition(p.dx, baseY + p.dy).setRotation(p.rot).setScale(p.sx, p.sy);
    const held = p.hand;
    if (held === null) return true;
    this.#arms.forEach(({ sleeve, hand, lip }, i) => {
      const side = held.both ? (i === 0 ? 1 : -1) : Math.sign(held.x) || 1;
      const shoulder = { x: p.dx / S + side * SHOULDER.x, y: (baseY + p.dy) / S + SHOULDER.y };
      const aim = { x: (p.dx + (held.both ? side * held.x : held.x)) / S, y: (baseY + p.dy + held.y) / S };
      const wrist = { x: shoulder.x + (aim.x - shoulder.x) * REACH, y: shoulder.y + (aim.y - shoulder.y) * REACH };
      this.#drawArm(sleeve, lip, shoulder, wrist, side);
      const elbow = this.#elbow(shoulder, wrist, side);
      const fx = wrist.x - elbow.x;
      const fy = wrist.y - elbow.y;
      const fl = Math.hypot(fx, fy) || 1;
      const angle = Math.atan2(fy, fx) + Math.PI / 2;
      const wobble = reduced ? 0 : side * held.rot * 0.6;
      hand
        .setPosition((wrist.x + (fx / fl) * 0.4) * S, (wrist.y + (fy / fl) * 0.4) * S)
        .setRotation(angle + wobble)
        .setScale(side * HAND_SCALE, HAND_SCALE);
    });
    return true;
  }

  // Elbows hang below the line from shoulder to wrist and out away from the body.
  #elbow(shoulder: V, wrist: V, side: number): V {
    const dx = wrist.x - shoulder.x;
    const dy = wrist.y - shoulder.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    if (ny < 0 || (ny === 0 && nx * side < 0)) {
      nx = -nx;
      ny = -ny;
    }
    return { x: shoulder.x + dx / 2 + nx * len * BEND + side * len * 0.08, y: shoulder.y + dy / 2 + ny * len * BEND };
  }

  #drawArm(sleeve: Phaser.GameObjects.Graphics, lip: Phaser.GameObjects.Graphics, shoulder: V, wrist: V, side: number): void {
    const c = this.#robe;
    const light = side < 0 ? c.lit : mix(c.lit, c.shadow, 0.3);
    const elbow = this.#elbow(shoulder, wrist, side);
    const fl = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y) || 1;
    const d = { x: (wrist.x - elbow.x) / fl, y: (wrist.y - elbow.y) / fl };
    sleeve.clear();
    lip.clear();
    sleeve.lineStyle(1.2 * S, COLORS.rim, 0.85);
    outline(sleeve, shoulder, elbow, WIDTH.shoulder, WIDTH.elbow);
    outline(sleeve, elbow, wrist, WIDTH.elbow, WIDTH.cuff);
    sleeve.fillStyle(COLORS.rim, 0.85);
    sleeve.fillCircle(elbow.x * S, elbow.y * S, (WIDTH.elbow + 0.6) * S);
    sleeve.fillStyle(c.shadow, 1);
    sleeve.fillCircle(elbow.x * S, elbow.y * S, WIDTH.elbow * S);
    sleeveSegment(sleeve, shoulder, elbow, WIDTH.shoulder, WIDTH.elbow, light, c.shadow);
    sleeveSegment(sleeve, elbow, wrist, WIDTH.elbow, WIDTH.cuff, light, c.shadow);
    // A crease of light where the sleeve folds at the elbow, and a trim band near the cuff.
    sleeve.lineStyle(1 * S, c.highlight, 0.7);
    sleeve.lineBetween((elbow.x - d.y * 0.8) * S, (elbow.y + d.x * 0.8) * S, (elbow.x + d.x * 2 - d.y * 1.6) * S, (elbow.y + d.y * 2 + d.x * 1.6) * S);
    const band = { x: wrist.x - d.x * 1.1, y: wrist.y - d.y * 1.1 };
    fillPoly(sleeve, cuffRing(band, d, WIDTH.cuff * 0.86, 0.6, 0, Math.PI * 2), c.highlight);
    fillPoly(sleeve, cuffRing(wrist, d, WIDTH.cuff, 1.2, 0, Math.PI * 2), HAND_DARK);
    lip.lineStyle(1 * S, c.highlight, 0.95);
    trace(lip, cuffRing(wrist, d, WIDTH.cuff, 1.2, 0, Math.PI));
    lip.strokePath();
  }

  /** Removes the arms and stands the body straight again, unless something else now holds it (a knockout). */
  end(body: Phaser.GameObjects.Graphics, straighten: boolean): void {
    for (const a of this.#arms) {
      a.sleeve.destroy();
      a.hand.destroy();
      a.lip.destroy();
    }
    this.#arms.length = 0;
    if (straighten) body.setPosition(0, body.y).setRotation(0).setScale(1, 1);
  }
}
