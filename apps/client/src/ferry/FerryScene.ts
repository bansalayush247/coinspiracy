// The ferry crossing between Port Concord and Beach Town: open sea, the ferry with this guardian on its foredeck, the
// harbour falling away behind and the other island coming up ahead. Only for show: the rooms are switched underneath.
import Phaser from 'phaser';
import { FERRY_TUNING, type FerryIsland } from '@byzantine-council/shared/city';
import { audio } from '../audio/engine.js';
import { drawShip } from '../city/shipArt.js';
import { drawGuardian, NO_WEAR, type Wear } from '../game/guardianArt.js';
import { sceneDpr, viewSize } from '../game/hidpi.js';
import { ART_SCALE, TILE_H, TILE_W } from '../game/iso.js';
import { seatColors } from '../game/palette.js';
import { t } from '../i18n/index.js';
import { buildCoast } from './coastArt.js';

/** The Phaser scene key of the crossing. */
export const FERRY_SCENE_KEY = 'ferry';

/** How this guardian looks on deck: their seat colours and what they wear. */
export interface FerryLook {
  readonly seat: number;
  readonly wear: Wear;
}

/** One crossing: where from, where to, and who stands on deck. */
export interface FerryTrip {
  readonly from: FerryIsland;
  readonly to: FerryIsland;
  readonly look: FerryLook | null;
}

/** The island names the ferry sails between; proper names, the same in every language. */
export const FERRY_NAMES: Readonly<Record<FerryIsland, string>> = { city: 'Port Concord', beach: 'Beach Town' };

const SHIP_SCALE = 4;
const GUARDIAN_SCALE = 0.95;
const SHIP_SEED = 11;
const SEA = 0x2f86b5;
const DEEP = 0x1f5f8a;
const FOAM = 0xf4fbfb;
const ALONG = { x: (-TILE_W / 2) * SHIP_SCALE, y: (TILE_H / 2) * SHIP_SCALE };
const ACROSS = { x: (TILE_W / 2) * SHIP_SCALE, y: (TILE_H / 2) * SHIP_SCALE };
const COAST_SCALE = 0.9;
const WAVES = 90;
const WAVE_SPAN = 9;
const SEA_SPEED = 1.6;

interface Crest {
  a: number;
  b: number;
  phase: number;
  size: number;
}

interface Puff {
  a: number;
  b: number;
  age: number;
  life: number;
  size: number;
}

interface Gull {
  x: number;
  y: number;
  vx: number;
  phase: number;
}

const ease = (k: number): number => k * k * (3 - 2 * k);

export class FerryScene extends Phaser.Scene {
  #trip: FerryTrip = { from: 'city', to: 'beach', look: null };
  #reduced = false;
  #elapsed = 0;
  #k = 0;
  #landing = false;
  #crests: Crest[] = [];
  #puffs: Puff[] = [];
  #gulls: Gull[] = [];
  #sea!: Phaser.GameObjects.Graphics;
  #fx!: Phaser.GameObjects.Graphics;
  #sky!: Phaser.GameObjects.Graphics;
  #ship!: Phaser.GameObjects.Container;
  #behind!: Phaser.GameObjects.Container;
  #ahead!: Phaser.GameObjects.Container;
  #card: HTMLElement | null = null;
  #hint: HTMLElement | null = null;
  #arrive: () => void = () => undefined;
  #gullCall = 0;
  #zoom = 1;
  /** Resolves once the ferry is in, by the clock or because the player skipped the rest. */
  arrived: Promise<void> = Promise.resolve();

  constructor() {
    super({ key: FERRY_SCENE_KEY, active: false });
  }

  create(data?: Partial<FerryTrip>): void {
    this.#trip = { from: data?.from ?? 'city', to: data?.to ?? 'beach', look: data?.look ?? null };
    this.#reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.#elapsed = 0;
    this.#k = 0;
    this.#landing = false;
    this.arrived = new Promise((resolve) => {
      this.#arrive = resolve;
    });
    this.cameras.main.setAlpha(1);
    this.#sea = this.add.graphics().setDepth(0);
    this.#behind = buildCoast(this, this.#trip.from, 'behind').setDepth(1);
    this.#ahead = buildCoast(this, this.#trip.to, 'ahead').setDepth(1);
    this.#fx = this.add.graphics().setDepth(0.5);
    this.#sky = this.add.graphics().setDepth(4);
    this.#ship = this.#buildShip().setDepth(3);
    this.#crests = Array.from({ length: WAVES }, (_, i) => ({ a: ((i * 37) % 100) / 100 * 2 * WAVE_SPAN - WAVE_SPAN, b: ((i * 61) % 100) / 100 * 2 * WAVE_SPAN - WAVE_SPAN, phase: i * 0.7, size: 0.6 + ((i * 13) % 10) / 14 }));
    this.#puffs = [];
    this.#gulls = this.#reduced ? [] : [{ x: -0.7, y: -0.3, vx: 0.05, phase: 0 }, { x: -0.95, y: -0.36, vx: 0.06, phase: 1.7 }];
    this.#mountCard();
    this.#layout();
    const onResize = (): void => {
      this.#layout();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || !['KeyE', 'Space', 'Enter', 'Escape'].includes(e.code)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.#skip();
    };
    const onTap = (): void => {
      this.#skip();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onTap, true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onTap, true);
      this.#card?.remove();
      this.#card = null;
      this.#hint = null;
    });
    if (import.meta.env.VITE_E2E === '1') Object.assign(window, { __bcFerry: () => (this.scene.isActive() ? { from: this.#trip.from, to: this.#trip.to, progress: this.#k, reduced: this.#reduced } : null) });
    audio.play('gull');
    this.#gullCall = 3_800;
    this.cameras.main.fadeIn(this.#reduced ? 200 : 350, 16, 40, 64);
    this.#draw(0);
  }

  /** Fades the crossing away over the island it has arrived at; resolves when the island shows through. */
  land(): Promise<void> {
    this.#landing = true;
    this.#card?.classList.add('leaving');
    return new Promise((resolve) => {
      const ms = this.#reduced ? Math.min(FERRY_TUNING.landMs, 250) : FERRY_TUNING.landMs;
      if (ms === 0 || !this.scene.isActive()) {
        resolve();
        return;
      }
      this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: ms, ease: 'Sine.easeIn', onComplete: () => { resolve(); } });
    });
  }

  override update(_time: number, delta: number): void {
    const step = Math.min(delta, 100);
    this.#elapsed += step;
    const span = this.#reduced ? FERRY_TUNING.reducedMs : FERRY_TUNING.tripMs;
    this.#k = Math.max(this.#k, Math.min(1, this.#elapsed / span));
    if (this.#k >= 1) this.#arrive();
    if (this.#hint !== null && this.#elapsed >= FERRY_TUNING.skipAfterMs && this.#hint.hidden && !this.#landing) this.#hint.hidden = false;
    if (!this.#reduced && this.#elapsed > this.#gullCall) {
      this.#gullCall = Number.POSITIVE_INFINITY;
      audio.play('gull');
    }
    this.#draw(Math.min(step, 50) / 1000);
  }

  // Jumps to the end of the crossing once the first second has gone.
  #skip(): void {
    if (this.#landing || this.#elapsed < FERRY_TUNING.skipAfterMs) return;
    this.#k = 1;
    this.#arrive();
  }

  #buildShip(): Phaser.GameObjects.Container {
    const hull = this.add.graphics().setScale(SHIP_SCALE);
    drawShip(hull, 'ferry', 's', SHIP_SEED);
    const look = this.#trip.look;
    const body = this.add.graphics();
    drawGuardian(body, seatColors(look?.seat ?? 0), -1, look?.wear ?? NO_WEAR);
    const deck = { x: -0.95 * (TILE_W / 2) * SHIP_SCALE, y: (0.95 * (TILE_H / 2) - 12 * ART_SCALE) * SHIP_SCALE };
    const shadow = this.add.ellipse(deck.x + 4 * ART_SCALE, deck.y + 2, 34 * ART_SCALE, 12 * ART_SCALE, 0x2a1a33, 0.3);
    body.setPosition(deck.x, deck.y).setScale(GUARDIAN_SCALE);
    return this.add.container(0, 0, [hull, shadow, body]);
  }

  #mountCard(): void {
    const ui = document.getElementById('ui');
    if (ui === null) return;
    const card = document.createElement('div');
    card.className = 'ferry-card';
    card.setAttribute('role', 'status');
    const title = document.createElement('b');
    title.textContent = t('ferry.sailingTo', { name: FERRY_NAMES[this.#trip.to] });
    const hint = document.createElement('small');
    hint.textContent = t('ferry.skip');
    hint.hidden = true;
    card.append(title, hint);
    ui.append(card);
    this.#card = card;
    this.#hint = hint;
  }

  #layout(): void {
    const { w, h } = viewSize(this);
    const shipW = 2.8 * Math.hypot(ALONG.x, ALONG.y);
    const fit = Math.min((w * 0.62) / shipW, (h * 0.5) / (shipW * 0.62));
    this.#zoom = sceneDpr(this) * Math.max(0.12, fit);
    this.cameras.main.setZoom(this.#zoom);
    this.cameras.main.centerOn(0, 0);
  }

  // One frame of the crossing at its current progress; `dt` seconds have passed since the last.
  #draw(dt: number): void {
    const k = this.#k;
    const time = this.time.now / 1000;
    const still = this.#reduced;
    const away = still ? 0.6 : ease(Math.min(1, k / 0.7));
    const near = still ? 0.4 : ease(Math.max(0, (k - 0.25) / 0.75));
    this.#place(this.#behind, -1, 1.45 + 1.4 * away, 1 - 0.7 * away, 1 - 0.85 * away);
    this.#place(this.#ahead, 1, 2.9 - 1.3 * near, 0.3 + 0.7 * near, Math.min(1, near * 2.5));
    this.cameras.main.setZoom(this.#zoom * (still ? 1 : 1 - 0.08 * Math.sin(Math.PI * k)));
    const pan = still ? 0 : 0.35 * (2 * ease(k) - 1);
    this.cameras.main.centerOn(pan * ALONG.x, pan * ALONG.y);
    const bob = still ? 0 : Math.sin(time * 1.5) * 5 * ART_SCALE;
    this.#ship.setPosition(0, bob).setRotation(still ? 0 : Math.sin(time * 1.1) * 0.012);
    const flow = still ? 0 : SEA_SPEED * dt;
    const sea = this.#sea;
    sea.clear();
    const view = this.cameras.main.worldView;
    sea.fillGradientStyle(0x3a9ac6, 0x3a9ac6, DEEP, DEEP, 1);
    sea.fillRect(view.x - 40, view.y - 40, view.width + 80, view.height + 80);
    for (const c of this.#crests) {
      c.a -= flow;
      if (c.a < -WAVE_SPAN) c.a += 2 * WAVE_SPAN;
      const x = c.a * ALONG.x + c.b * ACROSS.x;
      const y = c.a * ALONG.y + c.b * ACROSS.y;
      const lift = still ? 0.6 : 0.5 + 0.5 * Math.sin(time * 1.8 + c.phase);
      const r = 26 * ART_SCALE * c.size;
      sea.lineStyle(3 * ART_SCALE, FOAM, 0.18 + 0.3 * lift);
      sea.beginPath();
      sea.arc(x, y + 6 * lift, r, Math.PI * 1.15, Math.PI * 1.85);
      sea.strokePath();
      sea.fillStyle(SEA, 0.25 * lift);
      sea.fillEllipse(x, y + 10 * lift + r * 0.4, r * 1.6, r * 0.35);
    }
    this.#wake(dt, still);
    this.#birds(dt, time);
  }

  // A coast behind (-1) or ahead (+1), `reach` ship tiles from the ferry: the further off, the smaller and hazier.
  #place(coast: Phaser.GameObjects.Container, side: 1 | -1, reach: number, size: number, alpha: number): void {
    coast.setPosition(side * reach * ALONG.x, side * reach * ALONG.y).setScale(COAST_SCALE * size).setAlpha(Math.max(0, Math.min(1, alpha)));
  }

  // Foam churned up at the stern, spreading and fading behind the ferry.
  #wake(dt: number, still: boolean): void {
    const fx = this.#fx;
    fx.clear();
    if (!still && this.#puffs.length < 70) {
      for (let i = 0; i < 2; i++) this.#puffs.push({ a: -1.35, b: (Math.random() - 0.5) * 0.3, age: 0, life: 1.4 + Math.random(), size: 0.4 + Math.random() * 0.5 });
    }
    this.#puffs = this.#puffs.filter((p) => p.age < p.life);
    for (const p of this.#puffs) {
      p.age += dt;
      p.a -= SEA_SPEED * dt;
      p.b *= 1 + dt * 0.9;
      const fade = 1 - p.age / p.life;
      const x = p.a * ALONG.x + p.b * ACROSS.x;
      const y = p.a * ALONG.y + p.b * ACROSS.y + this.#ship.y;
      fx.fillStyle(FOAM, 0.4 * fade);
      fx.fillEllipse(x, y, 22 * ART_SCALE * p.size * (1 + 0.6 * p.age), 9 * ART_SCALE * p.size * (1 + 0.6 * p.age));
    }
  }

  // A gull or two gliding over the ferry, wings beating now and then.
  #birds(dt: number, time: number): void {
    const fx = this.#sky;
    fx.clear();
    const view = this.cameras.main.worldView;
    for (const gull of this.#gulls) {
      gull.x += gull.vx * dt;
      if (gull.x > 0.8) gull.x = -0.9;
      const cx = view.centerX + gull.x * view.width;
      const cy = view.centerY + gull.y * view.height + Math.sin(time * 0.8 + gull.phase) * 12;
      const flap = Math.sin(time * 7 + gull.phase) * 0.5 + 0.2;
      const span = 26 * ART_SCALE * (view.width / 2400);
      fx.lineStyle(3.2 * ART_SCALE * (view.width / 2400), 0xfaf6ee, 1);
      fx.beginPath();
      fx.moveTo(cx - span, cy - span * flap);
      fx.lineTo(cx - span * 0.35, cy - span * 0.15);
      fx.lineTo(cx, cy);
      fx.lineTo(cx + span * 0.35, cy - span * 0.15);
      fx.lineTo(cx + span, cy - span * flap);
      fx.strokePath();
    }
  }
}
