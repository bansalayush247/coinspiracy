// Emotes as things a guardian does rather than icons over their head: a wave of the hand, a jump for joy, a little
// dance, hearts, a laugh that shakes them, a shaka. Each is a pose over time plus a hand or a small flourish.
import Phaser from 'phaser';
import type { Emote } from '@byzantine-council/shared/hub';
import { ACTION, poseAt } from './emotePoses.js';
import { GUARDIAN_HEIGHT } from './guardianArt.js';
import { ART_SCALE } from './iso.js';
import { lit, shade } from './palette.js';

const H = GUARDIAN_HEIGHT;
const S = ART_SCALE;

/** The colours of a cheer's confetti. */
export const CONFETTI: readonly number[] = Object.freeze([0xff7f6a, 0xffd27a, 0x5fd3b0, 0xa983ff, 0x7fc8ff]);

/** Draws a mitten hand in the guardian's colour, wrist at the origin and fingers up: open, or a shaka. */
export function drawHand(g: Phaser.GameObjects.Graphics, color: number, sign: 'open' | 'shaka'): void {
  g.clear();
  const ink = shade(color, 0.45);
  g.lineStyle(1.2 * S, ink, 1);
  g.fillStyle(color, 1);
  if (sign === 'open') {
    for (const fx of [-2.6, -0.9, 0.9, 2.6]) {
      g.fillRoundedRect((fx - 0.9) * S, -10 * S, 1.8 * S, 5 * S, 0.9 * S);
      g.strokeRoundedRect((fx - 0.9) * S, -10 * S, 1.8 * S, 5 * S, 0.9 * S);
    }
  } else {
    g.fillRoundedRect(-5.4 * S, -8.4 * S, 1.9 * S, 5 * S, 0.9 * S);
    g.strokeRoundedRect(-5.4 * S, -8.4 * S, 1.9 * S, 5 * S, 0.9 * S);
    g.fillRoundedRect(3.4 * S, -9.6 * S, 1.9 * S, 5.6 * S, 0.9 * S);
    g.strokeRoundedRect(3.4 * S, -9.6 * S, 1.9 * S, 5.6 * S, 0.9 * S);
  }
  g.fillCircle(0, -4 * S, 3.8 * S);
  g.strokeCircle(0, -4 * S, 3.8 * S);
  g.fillStyle(0xffffff, 0.35);
  g.fillCircle(-1.2 * S, -5.2 * S, 1.3 * S);
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
      drawHand(hand, lit(color, 0.45), first.hand.sign);
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
      sleeve.lineStyle(SLEEVE + 2 * S, shade(this.#robe, 0.45), 1);
      sleeve.lineBetween(sx, sy, wx, wy + 2 * S);
      sleeve.lineStyle(SLEEVE, this.#robe, 1);
      sleeve.lineBetween(sx, sy, wx, wy + 2 * S);
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
