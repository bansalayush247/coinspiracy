// Shades the ground your guardian cannot see: rays from their eyes stop at buildings, and everything beyond each
// ray's end is darkened. It sits under buildings and people, so walls stay readable and only the ground dims.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { INTEREST_SHOW, sightDistance } from '@byzantine-council/shared/city';
import { worldToScreen } from '../game/iso.js';

const RAYS = 360;
const RECAST_MOVE = 0.12;
// Far enough past the edge of any view, in tiles.
const OUTER = 160;
// The soft edge where shade begins: this many tiles fading from light to full shade.
const PENUMBRA = 0.9;
// How long a newly cast shade takes to fade in over the last one.
const FADE_MS = 160;

export class Vision {
  // Two layers that take turns: the newest shade fades in over the one before, so the edge sweeps instead of jumping.
  readonly #a: Phaser.GameObjects.Graphics;
  readonly #b: Phaser.GameObjects.Graphics;
  #frontIsA = true;
  #fade = 1;
  #from: Vec2 | null = null;
  readonly #near: { x: number; y: number }[] = Array.from({ length: RAYS }, () => ({ x: 0, y: 0 }));
  readonly #mid: { x: number; y: number }[] = Array.from({ length: RAYS }, () => ({ x: 0, y: 0 }));
  readonly #far: { x: number; y: number }[] = Array.from({ length: RAYS }, () => ({ x: 0, y: 0 }));
  readonly #cos = Float64Array.from({ length: RAYS }, (_, i) => Math.cos((i / RAYS) * Math.PI * 2));
  readonly #sin = Float64Array.from({ length: RAYS }, (_, i) => Math.sin((i / RAYS) * Math.PI * 2));

  constructor(scene: Phaser.Scene, depth: number, private readonly alpha: number) {
    this.#a = scene.add.graphics().setDepth(depth);
    this.#b = scene.add.graphics().setDepth(depth).setAlpha(0);
  }

  get #front(): Phaser.GameObjects.Graphics {
    return this.#frontIsA ? this.#a : this.#b;
  }

  get #back(): Phaser.GameObjects.Graphics {
    return this.#frontIsA ? this.#b : this.#a;
  }

  update(eye: Vec2 | null, deltaMs = 16): void {
    this.#a.setVisible(eye !== null);
    this.#b.setVisible(eye !== null);
    if (eye === null) {
      this.#from = null;
      return;
    }
    if (this.#fade < 1) {
      this.#fade = Math.min(1, this.#fade + deltaMs / FADE_MS);
      this.#front.setAlpha(this.#fade);
      this.#back.setAlpha(1 - this.#fade);
    }
    if (this.#from !== null && Math.hypot(eye.x - this.#from.x, eye.y - this.#from.y) < RECAST_MOVE) return;
    const first = this.#from === null;
    this.#from = { x: eye.x, y: eye.y };
    for (let i = 0; i < RAYS; i++) {
      const c = this.#cos[i] ?? 1;
      const s = this.#sin[i] ?? 0;
      const d = sightDistance(eye, (i / RAYS) * Math.PI * 2, INTEREST_SHOW);
      worldToScreen(eye.x + c * d, eye.y + s * d, this.#near[i]);
      worldToScreen(eye.x + c * (d + PENUMBRA), eye.y + s * (d + PENUMBRA), this.#mid[i]);
      worldToScreen(eye.x + c * OUTER, eye.y + s * OUTER, this.#far[i]);
    }
    // Draw into the back layer and fade it in; the first cast shows at once.
    this.#frontIsA = !this.#frontIsA;
    const g = this.#front;
    g.clear();
    this.#band(g, this.#near, this.#mid, this.alpha * 0.45);
    this.#band(g, this.#mid, this.#far, this.alpha);
    this.#fade = first ? 1 : 0;
    g.setAlpha(this.#fade);
    this.#back.setAlpha(1 - this.#fade);
  }

  // Fills the ring between two outlines, one quad per ray.
  #band(g: Phaser.GameObjects.Graphics, inner: readonly { x: number; y: number }[], outer: readonly { x: number; y: number }[], alpha: number): void {
    g.fillStyle(0x0e1222, alpha);
    for (let i = 0; i < RAYS; i++) {
      const j = (i + 1) % RAYS;
      const p0 = inner[i];
      const p1 = inner[j];
      const q0 = outer[i];
      const q1 = outer[j];
      if (p0 === undefined || p1 === undefined || q0 === undefined || q1 === undefined) continue;
      g.fillTriangle(p0.x, p0.y, q0.x, q0.y, q1.x, q1.y);
      g.fillTriangle(p0.x, p0.y, q1.x, q1.y, p1.x, p1.y);
    }
  }

  destroy(): void {
    this.#a.destroy();
    this.#b.destroy();
  }
}
