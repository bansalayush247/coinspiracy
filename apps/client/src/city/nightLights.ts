// A story night over Port Concord: the city sinks into deep blue, every street lamp throws a warm pool on the road
// and glows at its head, and a faint light around your guardian keeps the way ahead readable.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { tileAt } from '@byzantine-council/shared';
import { CITY_HEIGHT, CITY_MAP, CITY_WIDTH } from '@byzantine-council/shared/city';
import { ART_SCALE, worldToScreen } from '../game/iso.js';

const NIGHT = 0x0b1530;
// The darkest night an act uses; lamps shine at full strength there and fade out towards dawn.
const DEEPEST = 0.55;
const LAMP_WARM = 0xffb45e;
const BULB = 0xffe7b8;
const AROUND_ME = 0xa9c2ff;
// One tile across, on screen, at ART_SCALE 1; the 'fx-pool' texture is 256 pixels wide.
const TILE_PX = 64;
const CULL_MARGIN = 320;
// How far out from its pole, on screen, a lamp's head hangs over the road.
const HEAD_REACH = 22;
const HEAD_HEIGHT = 107;

let lampsCache: readonly Vec2[] | null = null;

// Every street lamp in the city, by the middle of its tile; found once, the map never changes.
function lamps(): readonly Vec2[] {
  if (lampsCache !== null) return lampsCache;
  const out: Vec2[] = [];
  for (let r = 0; r < CITY_HEIGHT; r++) for (let c = 0; c < CITY_WIDTH; c++) if (tileAt(CITY_MAP, c, r) === 'L') out.push(worldToScreen(c + 0.5, r + 0.5));
  lampsCache = out;
  return out;
}

export class NightLights {
  readonly #night: Phaser.GameObjects.Rectangle;
  readonly #pools: Phaser.GameObjects.Image[] = [];
  readonly #bulbs: Phaser.GameObjects.Image[] = [];
  readonly #me: Phaser.GameObjects.Image;
  #dark = DEEPEST;

  // Pools of light sit on the ground at `groundDepth`, under buildings, and the night shades them like everything
  // else; bulbs glow over the night at `skyDepth`.
  constructor(private readonly scene: Phaser.Scene, private readonly groundDepth: number, private readonly skyDepth: number) {
    this.#night = scene.add.rectangle(0, 0, 10, 10, NIGHT, DEEPEST).setOrigin(0).setDepth(skyDepth);
    this.#me = this.#light('fx-pool', AROUND_ME, groundDepth).setScale((3.4 * TILE_PX * ART_SCALE) / 256);
  }

  /** How dark the night lies: deep at night, a thin blue haze for dawn and morning scenes. */
  setDark(alpha: number): void {
    this.#dark = alpha;
    this.#night.setFillStyle(NIGHT, alpha);
  }

  /** Lights the lamps in view and the ground around `me`, as strong as the night is dark. */
  update(me: Vec2 | null): void {
    const view = this.scene.cameras.main.worldView;
    this.#night.setPosition(view.x - 400, view.y - 400).setSize(view.width + 800, view.height + 800);
    const strength = Math.min(1, this.#dark / DEEPEST);
    let used = 0;
    if (strength > 0.05) {
      for (const foot of lamps()) {
        if (foot.x < view.x - CULL_MARGIN || foot.x > view.right + CULL_MARGIN || foot.y < view.y - CULL_MARGIN || foot.y > view.bottom + CULL_MARGIN) continue;
        const x = foot.x + HEAD_REACH * ART_SCALE;
        this.#pool(used).setPosition(x, foot.y).setAlpha(0.75 * strength).setVisible(true);
        this.#bulb(used).setPosition(x, foot.y - HEAD_HEIGHT * ART_SCALE).setAlpha(0.55 * strength).setVisible(true);
        used++;
      }
    }
    for (let i = used; i < this.#pools.length; i++) {
      this.#pools[i]?.setVisible(false);
      this.#bulbs[i]?.setVisible(false);
    }
    if (me === null || strength <= 0.05) {
      this.#me.setVisible(false);
      return;
    }
    const s = worldToScreen(me.x, me.y);
    this.#me.setPosition(s.x, s.y).setAlpha(0.3 * strength).setVisible(true);
  }

  #light(texture: string, tint: number, depth: number): Phaser.GameObjects.Image {
    return this.scene.add.image(0, 0, texture).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setVisible(false);
  }

  #pool(i: number): Phaser.GameObjects.Image {
    let p = this.#pools[i];
    if (p === undefined) {
      p = this.#light('fx-pool', LAMP_WARM, this.groundDepth).setScale((3.4 * TILE_PX * ART_SCALE) / 256);
      this.#pools.push(p);
    }
    return p;
  }

  #bulb(i: number): Phaser.GameObjects.Image {
    let b = this.#bulbs[i];
    if (b === undefined) {
      b = this.#light('fx-dot', BULB, this.skyDepth + 0.5).setScale(1.4 * ART_SCALE);
      this.#bulbs.push(b);
    }
    return b;
  }

  destroy(): void {
    this.#night.destroy();
    this.#me.destroy();
    for (const p of this.#pools) p.destroy();
    for (const b of this.#bulbs) b.destroy();
  }
}
