// The living sky around the citadel: clouds and their shadows, dust in the sunbeams, a flock of
// birds, rain showers with a rainbow after, and the light changing from afternoon to dusk.
import Phaser from 'phaser';
import { CITADEL_MAP, tileAt, type CitadelMap, type Vec2 } from '@byzantine-council/shared';
import type { Effects } from './effects.js';
import { ART_SCALE, isoDepth, worldToScreen } from './iso.js';
import { windAt, windowLights } from './mapArt.js';
import type { PhysicsFx } from './physics.js';
import { audio } from '../audio/engine.js';
import { quality } from './quality.js';

export type Daylight = 'day' | 'sunset' | 'dusk';
type Weather = 'clear' | 'rain' | 'rainbow';

// Short science notes shown when something happens in the sky.
export const NATURE_NOTES = {
  rain: 'Rain: water vapour cools as warm air rises, condenses on dust and falls once the drops are heavy enough.',
  rainbow: 'Rainbow: sunlight bends inside each raindrop and comes back at about 42°, split into colours because each wavelength bends a little differently.',
  birds: 'Starlings flock with three simple rules: keep apart, match your neighbours’ heading, and stay close to the group.',
  dusk: 'Dusk: low sunlight crosses more air, which scatters blue away and leaves the warm reds and oranges.',
  thunder: 'Thunder: light arrives almost at once, sound at 343 metres a second. Count the seconds after the flash: three seconds is about a kilometre away.',
  meteor: 'Shooting star: a grain of space dust, often smaller than sand, burning up about 100 km overhead.',
} as const;
export type NatureNote = keyof typeof NATURE_NOTES;

interface Bird {
  pos: Vec2;
  vel: Vec2;
  z: number;
  g: Phaser.GameObjects.Graphics;
  phase: number;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const CENTER = { x: 15, y: 14 };

export class Atmosphere {
  readonly #scene: Phaser.Scene;
  readonly #fx: PhysicsFx;
  readonly #effects: Effects;
  readonly #reduced: boolean;
  readonly #clouds: { img: Phaser.GameObjects.Image; speed: number }[] = [];
  readonly #shadows: Phaser.GameObjects.Image[] = [];
  readonly #lamps: Phaser.GameObjects.Image[] = [];
  readonly #birds: Bird[] = [];
  #rainbow: Phaser.GameObjects.Graphics | null = null;
  #weather: Weather = 'clear';
  #weatherUntil = 0;
  #nextFlock = 0;
  #moteAcc = 0;
  #rainAcc = 0;
  #daylight: Daylight = 'day';
  #ambienceAt = 0;
  #instant = false;
  #boltAt = 0;
  #meteorAt = 0;
  #stormy = false;
  // The colour of the hour, multiplied over the world but under the lamp glows.
  #tint!: Phaser.GameObjects.Rectangle;
  // Called with a note when a phenomenon starts, so the UI can explain it once.
  onNote: (note: NatureNote) => void = () => undefined;

  readonly #map: CitadelMap;

  constructor(scene: Phaser.Scene, fx: PhysicsFx, effects: Effects, reducedMotion: boolean, map: CitadelMap = CITADEL_MAP) {
    this.#map = map;
    this.#scene = scene;
    this.#fx = fx;
    this.#effects = effects;
    this.#reduced = reducedMotion;
    this.#createClouds();
    this.#createLamps();
    this.#tint = scene.add.rectangle(0, 1200, 12_000, 8000, 0xffffff, 1).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(15).setAlpha(0);
    // The first shower comes after a few minutes; then every so often.
    this.#weatherUntil = scene.time.now + rand(150_000, 240_000);
    this.#nextFlock = scene.time.now + rand(15_000, 30_000);
  }

  // Lamps and windows warm up as the light goes.
  // `instant` sets the light at once, for a scene that opens at an hour rather than living through it.
  setDaylight(daylight: Daylight, instant = false): void {
    if (daylight === this.#daylight) return;
    this.#daylight = daylight;
    this.#instant = instant;
    const alpha = daylight === 'day' ? 0.08 : daylight === 'sunset' ? 0.3 : 0.6;
    this.#scene.tweens.add({ targets: this.#lamps, alpha, duration: instant ? 1 : 4000 });
    document.documentElement.dataset['daylight'] = daylight;
    this.#applyTint();
    if (daylight === 'dusk') this.onNote('dusk');
  }

  #applyTint(): void {
    const rain = this.#weather === 'rain';
    const [color, alpha] =
      this.#daylight === 'dusk' ? [rain ? 0x5f5fa0 : 0x6e64be, rain ? 0.7 : 0.62] : this.#daylight === 'sunset' ? [0xffaa8c, rain ? 0.6 : 0.5] : rain ? [0x96a0b9, 0.45] : [0xffffff, 0];
    this.#tint.setFillStyle(color, 1);
    this.#scene.tweens.add({ targets: this.#tint, alpha, duration: this.#instant ? 1 : 5000, ease: 'Sine.easeInOut' });
    this.#instant = false;
  }

  update(time: number, delta: number): void {
    const wind = windAt(time, 0);
    if (time > this.#ambienceAt) {
      this.#ambienceAt = time + 250;
      audio.setAmbience(wind, this.#weather === 'rain');
      if (this.#birds.length > 0 && Math.random() < 0.25) audio.play('chirp');
    }
    // World wind: blowing from the west (screen left) toward the east.
    this.#fx.wind = { x: 0.35 * wind, y: 0.1 * wind };
    const dt = delta / 1000;
    for (const c of this.#clouds) {
      c.img.x += c.speed * wind * dt * 30;
      if (c.img.x > 3200) c.img.x = -3200;
    }
    for (const s of this.#shadows) {
      s.x += wind * dt * 24;
      s.y += wind * dt * 12;
      if (s.x > 2600) {
        s.x = -2600;
        s.y = rand(200, 1600);
      }
    }
    if (this.#reduced) return;
    // Low quality keeps the weather and birds but drops drifting motes and fireflies.
    if (quality.current === 'high') this.#motes(dt);
    this.#flock(time, dt);
    this.#weatherStep(time, dt);
    if (this.#daylight === 'dusk' && quality.current === 'high') this.#fireflies(dt);
    if (this.#daylight === 'dusk' && this.#weather !== 'rain' && time > this.#meteorAt) {
      this.#meteorAt = time + rand(7000, 16_000);
      this.#meteor();
    }
  }

  #createClouds(): void {
    // Far clouds below and around the floating island, drawn behind the ground.
    for (let i = 0; i < (quality.current === 'high' ? 14 : 6); i++) {
      const img = this.#scene.add
        .image(rand(-3000, 3000), rand(700, 2600), 'fx-cloud')
        .setScale(rand(2.2, 4.5))
        .setAlpha(rand(0.35, 0.7))
        .setTint(0xfff0e0)
        .setDepth(-10);
      this.#clouds.push({ img, speed: rand(0.4, 1.2) });
    }
    // Shadows of passing clouds slide over the ground.
    for (let i = 0; i < 3; i++) {
      const img = this.#scene.add
        .image(rand(-2000, 2000), rand(300, 1500), 'fx-shadow')
        .setScale(rand(5, 8), rand(3, 5))
        .setTint(0x3b2752)
        .setAlpha(0.1)
        .setBlendMode(Phaser.BlendModes.MULTIPLY)
        .setDepth(0.5);
      this.#shadows.push(img);
    }
  }

  #createLamps(): void {
    // Lit windows on the citadel's buildings glow as the light goes.
    if (this.#map === CITADEL_MAP) {
      for (const w of windowLights()) {
        this.#lamps.push(this.#scene.add.image(w.x, w.y, 'fx-dot').setScale(2.2 * ART_SCALE, 2.6 * ART_SCALE).setTint(0xffc46a).setAlpha(0.08).setBlendMode(Phaser.BlendModes.ADD).setDepth(16));
      }
    }
    for (let r = 0; r < this.#map.height; r++) {
      for (let c = 0; c < this.#map.width; c++) {
        if (tileAt(this.#map, c, r) !== 'L') continue;
        const s = worldToScreen(c + 0.5, r + 0.5);
        const glow = this.#scene.add
          .image(s.x, s.y - 60 * ART_SCALE, 'fx-dot')
          .setScale(3.2 * ART_SCALE)
          .setTint(0xffc26a)
          .setAlpha(0.08)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(isoDepth(c + 0.5, r + 0.5) + 30);
        this.#lamps.push(glow);
        // A pool of lamplight on the ground.
        const pool = this.#scene.add.image(s.x, s.y, 'fx-shadow').setScale(1.1, 1.1).setTint(0xffb860).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.08).setDepth(0.6);
        this.#lamps.push(pool);
      }
    }
  }

  // Dust and pollen drifting through the low sun, carried by the wind.
  #motes(dt: number): void {
    this.#moteAcc += dt * 6;
    while (this.#moteAcc >= 1) {
      this.#moteAcc -= 1;
      const cam = this.#scene.cameras.main;
      const view = cam.worldView;
      const sx = rand(view.x, view.x + view.width);
      const sy = rand(view.y, view.y + view.height);
      // Screen point back to world tiles (on the ground plane), lifted into the air.
      const x = sy / 64 + sx / 128;
      const y = sy / 64 - sx / 128;
      this.#fx.spawn({
        x, y, z: rand(20, 160) * ART_SCALE, vx: 0, vy: 0, vz: rand(-4, 8), life: rand(4, 8), texture: 'fx-dot',
        color: this.#daylight === 'dusk' ? 0xffd9a0 : 0xfff3cf, size: rand(0.08, 0.2) * ART_SCALE, blend: 'add',
        gravity: 0, drag: 0.2, wind: 0.9, fadeIn: 0.25,
      });
    }
  }

  #fireflies(dt: number): void {
    if (Math.random() > dt * 3) return;
    const lamp = this.#lamps[Math.floor(Math.random() * this.#lamps.length)];
    if (lamp === undefined) return;
    const x = lamp.y / 64 + lamp.x / 128;
    const y = lamp.y / 64 - lamp.x / 128;
    this.#fx.spawn({
      x: x + rand(-1.5, 1.5), y: y + rand(-1.5, 1.5), z: rand(10, 50) * ART_SCALE, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(-10, 10),
      life: rand(2, 4), texture: 'fx-dot', color: 0xe8ff8a, size: 0.18 * ART_SCALE, blend: 'add', gravity: 0, drag: 0.1, wind: 0.2, fadeIn: 0.3,
    });
  }

  // Boids: separation, alignment and cohesion, plus a gentle pull along the flight path.
  #flock(time: number, dt: number): void {
    if (this.#birds.length === 0 && time > this.#nextFlock) this.#spawnFlock(time);
    if (this.#birds.length === 0) return;
    for (const b of this.#birds) {
      let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0, n = 0;
      for (const o of this.#birds) {
        if (o === b) continue;
        const dx = o.pos.x - b.pos.x;
        const dy = o.pos.y - b.pos.y;
        const d = Math.hypot(dx, dy);
        if (d > 4) continue;
        n += 1;
        if (d < 0.9) {
          sepX -= dx / (d * d + 0.01);
          sepY -= dy / (d * d + 0.01);
        }
        aliX += o.vel.x;
        aliY += o.vel.y;
        cohX += o.pos.x;
        cohY += o.pos.y;
      }
      let ax = sepX * 0.6;
      let ay = sepY * 0.6;
      if (n > 0) {
        ax += (aliX / n - b.vel.x) * 0.8 + (cohX / n - b.pos.x) * 0.35;
        ay += (aliY / n - b.vel.y) * 0.8 + (cohY / n - b.pos.y) * 0.35;
      }
      // Migrate west to east across the island.
      ax += (3.2 - b.vel.x) * 0.4;
      ay += (-1.2 - b.vel.y) * 0.4;
      b.vel = { x: b.vel.x + ax * dt, y: b.vel.y + ay * dt };
      const speed = Math.hypot(b.vel.x, b.vel.y);
      const max = 4.2;
      if (speed > max) b.vel = { x: (b.vel.x / speed) * max, y: (b.vel.y / speed) * max };
      b.pos = { x: b.pos.x + b.vel.x * dt, y: b.pos.y + b.vel.y * dt };
      const s = worldToScreen(b.pos.x, b.pos.y);
      // Wingbeat: flap, then glide now and then.
      const flap = Math.sin(time / 90 + b.phase);
      const glide = Math.sin(time / 1700 + b.phase) > 0.6;
      const w = 9 * ART_SCALE;
      const up = (glide ? 0.15 : flap) * 6 * ART_SCALE;
      b.g.clear();
      b.g.lineStyle(2 * ART_SCALE, 0x3a2a48, 0.85);
      b.g.beginPath();
      b.g.moveTo(-w, -up);
      b.g.lineTo(0, 0);
      b.g.lineTo(w, -up);
      b.g.strokePath();
      b.g.setPosition(s.x, s.y - b.z);
    }
    if (this.#birds.every((b) => b.pos.x > 40 || b.pos.y < -12)) {
      for (const b of this.#birds) b.g.destroy();
      this.#birds.length = 0;
      this.#nextFlock = time + rand(40_000, 90_000);
    }
  }

  #spawnFlock(time: number): void {
    const n = Math.floor(rand(6, 11));
    for (let i = 0; i < n; i++) {
      const g = this.#scene.add.graphics().setDepth(200_000);
      this.#birds.push({ pos: { x: rand(-8, -5), y: rand(18, 26) }, vel: { x: rand(2.5, 3.5), y: rand(-1.5, -0.5) }, z: rand(260, 340) * ART_SCALE, g, phase: rand(0, 6) });
    }
    if (time > 60_000) this.onNote('birds');
  }

  // Clear -> a passing shower -> a rainbow while the sun comes back -> clear.
  #weatherStep(time: number, dt: number): void {
    if (time > this.#weatherUntil) {
      if (this.#weather === 'clear') {
        this.#weather = 'rain';
        this.#weatherUntil = time + rand(30_000, 45_000);
        // Some showers bring a thunderstorm.
        this.#stormy = Math.random() < 0.5;
        this.#boltAt = time + rand(6000, 12_000);
        document.documentElement.dataset['weather'] = 'rain';
        this.#applyTint();
        this.onNote('rain');
      } else if (this.#weather === 'rain') {
        this.#weather = 'rainbow';
        this.#weatherUntil = time + 28_000;
        document.documentElement.dataset['weather'] = 'clear';
        this.#applyTint();
        this.#showRainbow();
        this.onNote('rainbow');
      } else {
        this.#weather = 'clear';
        this.#weatherUntil = time + rand(300_000, 480_000);
        this.#hideRainbow();
      }
    }
    if (this.#weather !== 'rain') return;
    if (this.#stormy && time > this.#boltAt) {
      this.#boltAt = time + rand(9000, 18_000);
      this.#strike();
    }
    this.#rainAcc += dt * 70;
    const view = this.#scene.cameras.main.worldView;
    while (this.#rainAcc >= 1) {
      this.#rainAcc -= 1;
      const sx = rand(view.x - 200, view.x + view.width);
      const sy = rand(view.y, view.y + view.height + 200);
      const x = sy / 64 + sx / 128;
      const y = sy / 64 - sx / 128;
      const ground = tileAt(this.#map, Math.floor(x), Math.floor(y));
      if (ground === '#') continue;
      // Terminal velocity of a raindrop is about 9 m/s: they fall fast and straight, slanted by the wind.
      this.#fx.spawn({
        x, y, z: rand(300, 500) * ART_SCALE, vx: 0.5, vy: 0.1, vz: -900 * ART_SCALE * 0.5, life: 1.2, texture: 'fx-drop',
        color: 0xd8ecff, size: 0.8 * ART_SCALE, gravity: 0.2, drag: 0, wind: 0.5, bounce: 0, fadeIn: 0.05,
        onLand: (p) => {
          if (ground === '~') this.#effects.ring({ x: p.x, y: p.y }, 0xe6f6ff, 0.22, 500);
          else if (Math.random() < 0.3) this.#effects.splash({ x: p.x, y: p.y }, 0xdbe8f4, 2);
          p.life = p.age + 0.05;
        },
      });
    }
  }

  // A flash over the island, then thunder delayed by the distance at the speed of sound.
  #strike(): void {
    const cam = this.#scene.cameras.main;
    const view = cam.worldView;
    const flash = this.#scene.add.rectangle(view.centerX, view.centerY, view.width * 2, view.height * 2, 0xeef2ff, 1).setDepth(18).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.#scene.tweens.chain({
      targets: flash,
      tweens: [
        { alpha: 0.55, duration: 60 },
        { alpha: 0.1, duration: 90 },
        { alpha: 0.4, duration: 50 },
        { alpha: 0, duration: 400 },
      ],
      onComplete: () => {
        flash.destroy();
      },
    });
    const km = rand(0.7, 3.5);
    window.setTimeout(() => {
      audio.play('thunder');
    }, (km * 1000) / 0.343);
    this.onNote('thunder');
  }

  // A meteor: a short bright streak with a fading tail, high in the evening sky.
  #meteor(): void {
    const view = this.#scene.cameras.main.worldView;
    const x0 = view.x + rand(0.1, 0.9) * view.width;
    const y0 = view.y + rand(0.02, 0.25) * view.height;
    const len = rand(160, 320);
    const g = this.#scene.add.graphics().setDepth(17).setBlendMode(Phaser.BlendModes.ADD);
    const angle = rand(0.35, 0.7);
    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len;
    let t = 0;
    const timer = this.#scene.time.addEvent({
      delay: 16,
      repeat: 40,
      callback: () => {
        t += 1 / 40;
        g.clear();
        const hx = x0 + dx * t;
        const hy = y0 + dy * t;
        for (let i = 0; i < 6; i++) {
          const f = i / 6;
          g.lineStyle(4 - i * 0.6, 0xfff6e0, (1 - f) * (1 - t * 0.6));
          g.lineBetween(hx - dx * 0.25 * f, hy - dy * 0.25 * f, hx - dx * 0.25 * (f + 1 / 6), hy - dy * 0.25 * (f + 1 / 6));
        }
        if (t >= 1) {
          timer.remove();
          g.destroy();
        }
      },
    });
    this.onNote('meteor');
  }

  // The bow sits opposite the low western sun, centred on the antisolar point, 42° out.
  #showRainbow(): void {
    this.#hideRainbow();
    const center = worldToScreen(CENTER.x + 16, CENTER.y - 16);
    const g = this.#scene.add.graphics().setDepth(-5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    const bands = [0xff4d4d, 0xff9a3d, 0xffe14d, 0x6ee26e, 0x4db8ff, 0x6a5cff, 0xb05cff];
    const radius = 1500;
    bands.forEach((color, i) => {
      g.lineStyle(26, color, 0.32);
      g.beginPath();
      g.arc(center.x, center.y + 900, radius - i * 24, Math.PI * 1.08, Math.PI * 1.92);
      g.strokePath();
    });
    this.#rainbow = g;
    this.#scene.tweens.add({ targets: g, alpha: 1, duration: 4000 });
  }

  #hideRainbow(): void {
    const g = this.#rainbow;
    if (g === null) return;
    this.#rainbow = null;
    this.#scene.tweens.add({ targets: g, alpha: 0, duration: 4000, onComplete: () => { g.destroy(); } });
  }
}
