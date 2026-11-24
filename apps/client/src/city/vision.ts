// Shades the ground your guardian cannot see: rays from their eyes stop at buildings, and everything beyond each
// ray's end is darkened. It sits under buildings and people, so walls stay readable and only the ground dims.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { INTEREST_SHOW, sightDistance } from '@byzantine-council/shared/city';
import { worldToScreen } from '../game/iso.js';

const RAYS = 360;
const RECAST_MOVE = 0.08;
// Far enough past the edge of any view, in tiles.
const OUTER = 160;

export class Vision {
  readonly #shade: Phaser.GameObjects.Graphics;
  #from: Vec2 | null = null;

  constructor(scene: Phaser.Scene, depth: number, private readonly alpha: number) {
    this.#shade = scene.add.graphics().setDepth(depth);
  }

  update(eye: Vec2 | null): void {
    this.#shade.setVisible(eye !== null);
    if (eye === null) {
      this.#from = null;
      return;
    }
    if (this.#from !== null && Math.hypot(eye.x - this.#from.x, eye.y - this.#from.y) < RECAST_MOVE) return;
    this.#from = { x: eye.x, y: eye.y };
    const near: Vec2[] = [];
    const far: Vec2[] = [];
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const d = sightDistance(eye, a, INTEREST_SHOW);
      near.push(worldToScreen(eye.x + Math.cos(a) * d, eye.y + Math.sin(a) * d));
      far.push(worldToScreen(eye.x + Math.cos(a) * OUTER, eye.y + Math.sin(a) * OUTER));
    }
    const g = this.#shade;
    g.clear();
    g.fillStyle(0x0e1222, this.alpha);
    for (let i = 0; i < RAYS; i++) {
      const j = (i + 1) % RAYS;
      const p0 = near[i];
      const p1 = near[j];
      const q0 = far[i];
      const q1 = far[j];
      if (p0 === undefined || p1 === undefined || q0 === undefined || q1 === undefined) continue;
      g.fillTriangle(p0.x, p0.y, q0.x, q0.y, q1.x, q1.y);
      g.fillTriangle(p0.x, p0.y, q1.x, q1.y, p1.x, p1.y);
    }
  }

  destroy(): void {
    this.#shade.destroy();
  }
}
