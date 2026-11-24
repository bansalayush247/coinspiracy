// Townsfolk: decorative guardians who stroll between spots so the world never feels empty.
// Purely visual and client-side: they never touch game state and nobody can interact with them.
import Phaser from 'phaser';
import type { CitadelMap, Vec2 } from '@byzantine-council/shared';
import { findPath } from '@byzantine-council/shared/pathfinding';
import { drawGuardian, type Wear } from './guardianArt.js';
import { ART_SCALE, isoDepth, worldToScreen } from './iso.js';
import { seatColors } from './palette.js';

const SPEED = 1.4;
const HATS = ['', '', 'hat:straw', 'hat:cap', 'hat:bucket', ''];

interface Walker {
  readonly root: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly seat: number;
  readonly wear: Wear;
  pos: Vec2;
  path: Vec2[];
  waitUntil: number;
  facing: 1 | -1;
  phase: number;
}

export class Townsfolk {
  readonly #scene: Phaser.Scene;
  readonly #map: CitadelMap;
  readonly #spots: readonly Vec2[];
  readonly #walkers: Walker[] = [];
  #visible = true;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, map: CitadelMap, spots: readonly Vec2[], count: number, private readonly depthOf: (x: number, y: number) => number = isoDepth) {
    this.#scene = scene;
    this.#map = map;
    this.#spots = spots;
    for (let i = 0; i < count; i++) {
      const start = spots[(i * 3) % spots.length] ?? { x: 15, y: 15 };
      const seat = (i * 5 + 2) % 9;
      const wear: Wear = { hat: HATS[i % HATS.length] ?? '', shades: i % 4 === 3 ? 'shades:classic' : '', outfit: '' };
      const shadow = new Phaser.GameObjects.Image(scene, 6 * ART_SCALE, 2 * ART_SCALE, 'fx-shadow').setScale(0.2, 0.2).setTint(0x3b2752).setAlpha(0.4);
      const body = new Phaser.GameObjects.Graphics(scene);
      drawGuardian(body, seatColors(seat), 1, wear);
      const root = new Phaser.GameObjects.Container(scene, 0, 0, [shadow, body]);
      layer.add(root);
      this.#walkers.push({ root, body, seat, wear, pos: { ...start }, path: [], waitUntil: i * 900, facing: 1, phase: i * 1.7 });
    }
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    for (const w of this.#walkers) w.root.setVisible(visible);
  }

  // Where the walkers are, so traffic can stop for them.
  positions(): Vec2[] {
    return this.#visible ? this.#walkers.map((w) => w.pos) : [];
  }

  // Hides the walkers a viewer cannot see, such as those behind a building.
  cull(sees: (pos: Vec2) => boolean): void {
    if (!this.#visible) return;
    for (const w of this.#walkers) {
      const shown = sees(w.pos);
      if (w.root.visible !== shown) w.root.setVisible(shown);
    }
  }

  update(time: number, delta: number, reducedMotion: boolean): void {
    if (!this.#visible) return;
    const dt = Math.min(delta, 50) / 1000;
    for (const w of this.#walkers) {
      if (w.path.length === 0 && time >= w.waitUntil) this.#plan(w);
      const next = w.path[0];
      let moving = false;
      if (next !== undefined && !reducedMotion) {
        const dx = next.x - w.pos.x;
        const dy = next.y - w.pos.y;
        const d = Math.hypot(dx, dy);
        const step = SPEED * dt;
        if (d <= step) {
          w.pos = { ...next };
          w.path.shift();
          // A pause to look around at the end of a walk.
          if (w.path.length === 0) w.waitUntil = time + 2500 + Math.random() * 6000;
        } else {
          w.pos = { x: w.pos.x + (dx / d) * step, y: w.pos.y + (dy / d) * step };
          moving = true;
          const facing = dx - dy > 0 ? 1 : -1;
          if (facing !== w.facing) {
            w.facing = facing;
            drawGuardian(w.body, seatColors(w.seat), facing, w.wear);
          }
        }
      }
      const s = worldToScreen(w.pos.x, w.pos.y);
      w.root.setPosition(s.x, s.y).setDepth(this.depthOf(w.pos.x, w.pos.y));
      w.body.y = moving ? Math.sin(time / 90 + w.phase) * 1.6 * ART_SCALE : 0;
    }
  }

  #plan(w: Walker): void {
    const goal = this.#spots[Math.floor(Math.random() * this.#spots.length)];
    if (goal === undefined) return;
    const result = findPath(this.#map, w.pos, goal);
    if (result.ok) w.path = [...result.value];
    else w.waitUntil = this.#scene.time.now + 2000;
  }
}
