// A small particle physics engine for effects: world position, height above the ground, gravity,
// air drag, wind and bounces with friction. Sprites are pooled, so effects never allocate per frame.
import Phaser from 'phaser';
import { ART_SCALE, isoDepth, worldToScreen } from './iso.js';

// Standard gravity in world pixels per second squared, scaled so a spark arcs like a real one.
export const GRAVITY = 980 * ART_SCALE * 0.55;
const MAX_PARTICLES = 420;

export interface ParticleSpec {
  // World tiles.
  x: number;
  y: number;
  // Height above the ground in world pixels.
  z: number;
  // World tiles per second, and world pixels per second upward.
  vx: number;
  vy: number;
  vz: number;
  life: number;
  texture: string;
  color: number;
  size: number;
  // Optional: 0 floats, 1 falls under full gravity, negative rises (warm air, bubbles).
  gravity?: number;
  // Fraction of speed lost per second to air resistance.
  drag?: number;
  // How strongly the wind carries it (light motes 1, heavy sparks 0.1).
  wind?: number;
  // Fraction of vertical speed kept on a bounce; 0 stops dead on the ground.
  bounce?: number;
  blend?: 'add' | 'normal';
  fadeIn?: number;
  // Size multiplier at end of life.
  grow?: number;
  spin?: number;
  // Draw above everything, ignoring painter's order (sky effects).
  sky?: boolean;
  onLand?: (p: Particle) => void;
}

export interface Particle extends Required<Omit<ParticleSpec, 'onLand'>> {
  age: number;
  sprite: Phaser.GameObjects.Image;
  landed: boolean;
  onLand: ((p: Particle) => void) | undefined;
}

export class PhysicsFx {
  readonly #scene: Phaser.Scene;
  readonly #layer: Phaser.GameObjects.Layer;
  readonly #sky: Phaser.GameObjects.Layer;
  readonly #live: Particle[] = [];
  readonly #pool: Phaser.GameObjects.Image[] = [];
  readonly #tmp = { x: 0, y: 0 };
  // World wind in tiles per second, set by the atmosphere every frame.
  wind = { x: 0.3, y: 0.05 };

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, sky: Phaser.GameObjects.Layer) {
    this.#scene = scene;
    this.#layer = layer;
    this.#sky = sky;
  }

  get count(): number {
    return this.#live.length;
  }

  spawn(spec: ParticleSpec): void {
    if (this.#live.length >= MAX_PARTICLES) return;
    const sprite = this.#pool.pop() ?? new Phaser.GameObjects.Image(this.#scene, 0, 0, spec.texture);
    sprite.setTexture(spec.texture).setTint(spec.color).setVisible(true).setAlpha(0).setRotation(0);
    sprite.setBlendMode(spec.blend === 'add' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    (spec.sky === true ? this.#sky : this.#layer).add(sprite);
    this.#live.push({
      gravity: 1,
      drag: 0.4,
      wind: 0.2,
      bounce: 0.35,
      blend: 'normal',
      fadeIn: 0.05,
      grow: 1,
      spin: 0,
      sky: false,
      ...spec,
      onLand: spec.onLand,
      age: 0,
      sprite,
      landed: false,
    });
  }

  // Semi-implicit Euler: velocity first, then position, which stays stable at frame rates down to 20 fps.
  update(deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000;
    for (let i = this.#live.length - 1; i >= 0; i--) {
      const p = this.#live[i];
      if (p === undefined) continue;
      p.age += dt;
      if (p.age >= p.life) {
        this.#release(i);
        continue;
      }
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx = (p.vx + (this.wind.x - p.vx) * p.wind * dt) * drag;
      p.vy = (p.vy + (this.wind.y - p.vy) * p.wind * dt) * drag;
      p.vz = (p.vz - GRAVITY * p.gravity * dt) * drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z <= 0 && p.gravity > 0) {
        p.z = 0;
        if (!p.landed) p.onLand?.(p);
        p.landed = true;
        // Bounce with restitution; friction slows the slide along the ground.
        p.vz = -p.vz * p.bounce;
        p.vx *= 0.6;
        p.vy *= 0.6;
        if (Math.abs(p.vz) < 20) p.vz = 0;
      }
      const t = p.age / p.life;
      const fadeIn = p.fadeIn > 0 ? Math.min(1, t / p.fadeIn) : 1;
      const fadeOut = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
      const s = worldToScreen(p.x, p.y, this.#tmp);
      p.sprite.setPosition(s.x, s.y - p.z);
      p.sprite.setScale(p.size * (1 + (p.grow - 1) * t));
      p.sprite.setAlpha(fadeIn * fadeOut);
      if (p.spin !== 0) p.sprite.rotation += p.spin * dt;
      if (!p.sky) p.sprite.setDepth(isoDepth(p.x, p.y) + 1);
    }
  }

  clear(): void {
    for (let i = this.#live.length - 1; i >= 0; i--) this.#release(i);
  }

  #release(i: number): void {
    const p = this.#live[i];
    if (p === undefined) return;
    p.sprite.setVisible(false);
    p.sprite.removeFromDisplayList();
    this.#pool.push(p.sprite);
    this.#live.splice(i, 1);
  }
}

// Soft procedural textures used by every effect, drawn once into canvases.
export function makeFxTextures(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): void => {
    if (scene.textures.exists(key)) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    if (c === null) return;
    draw(c);
    scene.textures.addCanvas(key, canvas);
  };
  make('fx-dot', 32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  });
  // A rounded gold chevron pointing right, drawn large so it stays crisp when turned and scaled down.
  make('fx-arrow', 64, 64, (c) => {
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(14, 13);
    c.lineTo(54, 32);
    c.lineTo(14, 51);
    c.lineTo(23, 32);
    c.closePath();
    c.fillStyle = '#ffd27a';
    c.strokeStyle = '#2a1a33';
    c.lineWidth = 6;
    c.stroke();
    c.fill();
    c.beginPath();
    c.moveTo(20, 20);
    c.lineTo(46, 32);
    c.lineTo(27, 32);
    c.closePath();
    c.fillStyle = 'rgba(255,246,218,0.7)';
    c.fill();
  });
  make('fx-spark', 32, 32, (c) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(16, 0);
    c.lineTo(19, 13);
    c.lineTo(32, 16);
    c.lineTo(19, 19);
    c.lineTo(16, 32);
    c.lineTo(13, 19);
    c.lineTo(0, 16);
    c.lineTo(13, 13);
    c.closePath();
    c.fill();
  });
  make('fx-shard', 16, 16, (c) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(8, 0);
    c.lineTo(15, 9);
    c.lineTo(6, 16);
    c.lineTo(1, 7);
    c.closePath();
    c.fill();
  });
  make('fx-drop', 6, 26, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 26);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0.9)');
    c.fillStyle = g;
    c.fillRect(2, 0, 2, 26);
  });
  make('fx-ring', 128, 64, (c) => {
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 4;
    c.beginPath();
    c.ellipse(64, 32, 60, 28, 0, 0, Math.PI * 2);
    c.stroke();
  });
  make('fx-leaf', 16, 10, (c) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.ellipse(8, 5, 7, 3.5, 0.3, 0, Math.PI * 2);
    c.fill();
  });
  make('fx-cloud', 256, 144, (c) => {
    for (const [x, y, r] of [
      [70, 80, 44],
      [120, 60, 56],
      [175, 78, 46],
      [100, 92, 40],
      [150, 95, 42],
    ] as const) {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  });
  // A ground pool of light that fades out smoothly, with no rim at its edge.
  make('fx-pool', 256, 128, (c) => {
    const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [at, a] of [[0, 1], [0.25, 0.8], [0.5, 0.42], [0.75, 0.13], [1, 0]] as const) g.addColorStop(at, `rgba(255,255,255,${String(a)})`);
    c.fillStyle = g;
    c.save();
    c.scale(1, 0.5);
    c.beginPath();
    c.arc(128, 128, 128, 0, Math.PI * 2);
    c.fill();
    c.restore();
  });
  make('fx-shadow', 256, 128, (c) => {
    const g = c.createRadialGradient(128, 64, 0, 128, 64, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.save();
    c.scale(1, 0.5);
    c.beginPath();
    c.arc(128, 128, 128, 0, Math.PI * 2);
    c.restore();
    c.fill();
  });
}
