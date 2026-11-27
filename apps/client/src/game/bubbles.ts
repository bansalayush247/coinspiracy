// Bubbles over a guardian's head: an emote that stays up long enough to be seen and follows its guardian, and the
// three dots of someone talking while their line is on the story panel.
import Phaser from 'phaser';

/** Bubble tuning: how long an emote stays up, and how the talking dots step. */
export const BUBBLES = Object.freeze({
  emoteHoldMs: 4_000,
  emoteFadeMs: 500,
  emoteRisePx: 20,
  popMs: 260,
  dotsEveryMs: 220,
  gapPx: 4,
});

const W = 40;
const H = 22;
const TAIL = 7;
const INK = 0x2a1a33;
const PAPER = 0xfff6e6;

/** The three dots of a talking guardian, drawn at screen size above the name over their head. */
export class TalkBubble {
  readonly #g: Phaser.GameObjects.Graphics;
  readonly #reduced: boolean;
  #lit = -1;
  #on = false;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, reduced: boolean) {
    this.#g = new Phaser.GameObjects.Graphics(scene).setVisible(false);
    layer.add(this.#g);
    this.#reduced = reduced;
  }

  get shown(): boolean {
    return this.#on;
  }

  show(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    this.#lit = -1;
    this.#g.setVisible(on);
  }

  /** Puts the bubble's tail at (x, y) in world space, sized for the camera's zoom, the dots stepping with time. */
  place(x: number, y: number, zoom: number, time: number, visible: boolean): void {
    if (!this.#on) return;
    this.#g.setVisible(visible);
    if (!visible) return;
    const lit = this.#reduced ? 3 : Math.floor(time / BUBBLES.dotsEveryMs) % 3;
    if (lit !== this.#lit) this.#draw(lit);
    this.#g.setScale(1 / zoom).setPosition(x, y - BUBBLES.gapPx / zoom);
  }

  destroy(): void {
    this.#g.destroy();
  }

  #draw(lit: number): void {
    this.#lit = lit;
    const g = this.#g;
    g.clear();
    g.fillStyle(PAPER, 0.96);
    g.lineStyle(2, INK, 1);
    g.fillRoundedRect(-W / 2, -H - TAIL, W, H, 8);
    g.strokeRoundedRect(-W / 2, -H - TAIL, W, H, 8);
    g.fillTriangle(-5, -TAIL - 1, 5, -TAIL - 1, 0, 0);
    g.lineBetween(-5, -TAIL, 0, 0);
    g.lineBetween(5, -TAIL, 0, 0);
    for (let i = 0; i < 3; i++) {
      g.fillStyle(INK, lit === 3 || lit === i ? 1 : 0.3);
      g.fillCircle((i - 1) * 10, -TAIL - H / 2, 3);
    }
  }
}
