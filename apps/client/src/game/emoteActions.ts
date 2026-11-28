// Emotes as things a guardian does rather than icons over their head: a wave of the hand, a jump for joy, a little
// dance, hearts, a laugh that shakes them, a shaka. Each is a pose over time plus a hand or a small flourish.
import Phaser from 'phaser';
import type { Emote } from '@byzantine-council/shared/hub';
import { ACTION, poseAt } from './emotePoses.js';
import { GUARDIAN_HEIGHT } from './guardianArt.js';
import { ART_SCALE } from './iso.js';
import { shade } from './palette.js';

const H = GUARDIAN_HEIGHT;
const S = ART_SCALE;

/** The colours of a cheer's confetti. */
export const CONFETTI: readonly number[] = Object.freeze([0xff7f6a, 0xffd27a, 0x5fd3b0, 0xa983ff, 0x7fc8ff]);

const GLOVE = 0xffe9cc;
const HAND_INK = (robe: number): number => shade(robe, 0.6);

type HandPart =
  | { readonly kind: 'capsule'; readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number; readonly r: number }
  | { readonly kind: 'box'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number }
  | { readonly kind: 'dot'; readonly x: number; readonly y: number; readonly r: number };

const finger = (ax: number, ay: number, bx: number, by: number, r: number): HandPart => ({ kind: 'capsule', ax, ay, bx, by, r });

const PALM: HandPart = { kind: 'box', x: -3.4, y: -7.4, w: 6.8, h: 7, r: 2.8 };
const CUFF: HandPart = { kind: 'box', x: -2.5, y: -1.1, w: 5, h: 3, r: 1 };

const OPEN_HAND: readonly HandPart[] = [
  PALM,
  finger(-2.3, -6, -3.1, -9.6, 1),
  finger(-0.75, -6.4, -0.95, -11.2, 1.02),
  finger(0.85, -6.4, 1.25, -10.7, 1),
  finger(2.35, -5.8, 3.3, -9, 0.92),
  finger(-2.4, -2.8, -5.7, -5.4, 1.1),
];

const SHAKA_HAND: readonly HandPart[] = [
  PALM,
  { kind: 'dot', x: -2.1, y: -7, r: 1.35 },
  { kind: 'dot', x: -0.3, y: -7.3, r: 1.35 },
  { kind: 'dot', x: 1.45, y: -7, r: 1.3 },
  finger(2.4, -5.4, 5.3, -9.1, 1),
  finger(-2.4, -2.8, -6.6, -4.4, 1.1),
];

// A round-ended bar from (ax, ay) to (bx, by): two circles joined by a quad.
function fillCapsule(g: Phaser.GameObjects.Graphics, ax: number, ay: number, bx: number, by: number, r: number): void {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / len) * r;
  const ny = ((bx - ax) / len) * r;
  g.fillCircle(ax, ay, r);
  g.fillCircle(bx, by, r);
  g.fillTriangle(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny);
  g.fillTriangle(ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny);
}

function fillPart(g: Phaser.GameObjects.Graphics, p: HandPart, grow: number): void {
  switch (p.kind) {
    case 'capsule':
      fillCapsule(g, p.ax * S, p.ay * S, p.bx * S, p.by * S, p.r * S + grow);
      return;
    case 'box':
      g.fillRoundedRect(p.x * S - grow, p.y * S - grow, p.w * S + 2 * grow, p.h * S + 2 * grow, p.r * S + grow);
      return;
    case 'dot':
      g.fillCircle(p.x * S, p.y * S, p.r * S + grow);
  }
}

/** Draws a cartoon glove for a guardian in robe colour `robe`, wrist at the origin and fingers up: open, or a shaka. */
export function drawHand(g: Phaser.GameObjects.Graphics, robe: number, sign: 'open' | 'shaka'): void {
  g.clear();
  const parts = sign === 'open' ? OPEN_HAND : SHAKA_HAND;
  const outline = 0.75 * S;
  g.fillStyle(HAND_INK(robe), 1);
  for (const p of [...parts, CUFF]) fillPart(g, p, outline);
  g.fillStyle(GLOVE, 1);
  for (const p of parts) fillPart(g, p, 0);
  g.fillStyle(0xffffff, 0.5);
  g.fillEllipse(-1.2 * S, -5.4 * S, 2.6 * S, 1.8 * S);
  g.fillStyle(robe, 1);
  fillPart(g, CUFF, 0);
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

// How big a hand is drawn, and where the sleeve that holds it comes out of the robe, as fractions of the height.
const HAND_SCALE = 1.6;
const SHOULDER = { x: 0.2, y: 0.6 };
const SLEEVE = 5 * S;

/** One guardian's emote in progress: moves their body each frame and holds up their arms, then tidies up. */
export class EmoteAction {
  readonly #arms: { readonly sleeve: Phaser.GameObjects.Graphics; readonly hand: Phaser.GameObjects.Graphics }[] = [];
  readonly #start: number;
  readonly #robe: number;

  constructor(scene: Phaser.Scene, root: Phaser.GameObjects.Container, readonly emote: Emote, color: number, now: number) {
    this.#start = now;
    this.#robe = color;
    const first = poseAt(emote, 0, 1);
    if (first?.hand == null) return;
    for (let i = 0; i < (first.hand.both ? 2 : 1); i++) {
      const sleeve = new Phaser.GameObjects.Graphics(scene);
      const hand = new Phaser.GameObjects.Graphics(scene);
      drawHand(hand, color, first.hand.sign);
      root.add([sleeve, hand]);
      this.#arms.push({ sleeve, hand });
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
    this.#arms.forEach(({ sleeve, hand }, i) => {
      const side = held.both ? (i === 0 ? 1 : -1) : Math.sign(held.x) || 1;
      const wx = p.dx + (held.both ? side * held.x : held.x);
      const wy = baseY + p.dy + held.y;
      const sx = p.dx + side * SHOULDER.x * H;
      const sy = baseY + p.dy - SHOULDER.y * H;
      sleeve.clear();
      sleeve.lineStyle(SLEEVE + 2 * S, HAND_INK(this.#robe), 1);
      sleeve.lineBetween(sx, sy, wx, wy);
      sleeve.lineStyle(SLEEVE, this.#robe, 1);
      sleeve.lineBetween(sx, sy, wx, wy);
      hand.setPosition(wx, wy).setRotation(reduced ? 0 : side * held.rot).setScale(side * HAND_SCALE, HAND_SCALE);
    });
    return true;
  }

  /** Removes the arms and stands the body straight again, unless something else now holds it (a knockout). */
  end(body: Phaser.GameObjects.Graphics, straighten: boolean): void {
    for (const a of this.#arms) {
      a.sleeve.destroy();
      a.hand.destroy();
    }
    this.#arms.length = 0;
    if (straighten) body.setPosition(0, body.y).setRotation(0).setScale(1, 1);
  }
}
