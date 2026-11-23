// Visible consequences of actions: finishing a task, signing, refusing, freezes, partitions,
// councils, rotations and the end of a match. Built from physics particles plus a few tweens.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { ART_SCALE, TILE_W, isoDepth, worldToScreen } from './iso.js';
import type { PhysicsFx } from './physics.js';
import { audio } from '../audio/engine.js';
import { quality } from './quality.js';

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export class Effects {
  readonly #scene: Phaser.Scene;
  readonly #fx: PhysicsFx;
  readonly #layer: Phaser.GameObjects.Layer;
  readonly #reduced: boolean;

  constructor(scene: Phaser.Scene, fx: PhysicsFx, layer: Phaser.GameObjects.Layer, reducedMotion: boolean) {
    this.#scene = scene;
    this.#fx = fx;
    this.#layer = layer;
    this.#reduced = reducedMotion;
  }

  // A ring that spreads along the ground, like a ripple or a shockwave.
  ring(at: Vec2, color: number, radiusTiles: number, ms: number, width = 1): void {
    const s = worldToScreen(at.x, at.y);
    const img = this.#scene.add.image(s.x, s.y, 'fx-ring').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(isoDepth(at.x, at.y));
    this.#layer.add(img);
    const target = (radiusTiles * TILE_W * Math.SQRT2) / 120;
    img.setScale(0.1, 0.1 * width);
    this.#scene.tweens.add({
      targets: img,
      scaleX: target,
      scaleY: target * width,
      alpha: { from: 0.95, to: 0 },
      duration: this.#reduced ? 1 : ms,
      ease: 'Cubic.easeOut',
      onComplete: () => { img.destroy(); },
    });
  }

  // Gold sparks thrown up from the station, a coin that rises, and a ground ripple.
  taskDone(at: Vec2, color: number, sound = true): void {
    if (sound) audio.play('taskDone');
    this.ring(at, color, 1.8, 700);
    if (this.#reduced) return;
    for (let i = 0; i < 46; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.6, 2.4);
      this.#fx.spawn({
        x: at.x, y: at.y, z: 40 * ART_SCALE,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(260, 620) * ART_SCALE * 0.5,
        life: rand(0.9, 1.6), texture: i % 3 === 0 ? 'fx-spark' : 'fx-dot', color: i % 4 === 0 ? 0xffffff : color,
        size: rand(0.25, 0.55) * ART_SCALE, blend: 'add', bounce: 0.45, drag: 0.6, wind: 0.05, spin: rand(-6, 6),
      });
    }
    this.#rise(at, '+', color);
  }

  // A wax seal pressed onto a withdrawal: gold for a signature, a cracked grey one for a refusal.
  stamp(at: Vec2, signed: boolean): void {
    audio.play(signed ? 'sign' : 'refuse');
    const s = worldToScreen(at.x, at.y);
    const y = s.y - 86 * ART_SCALE;
    const g = this.#scene.add.graphics().setDepth(isoDepth(at.x, at.y) + 2);
    this.#layer.add(g);
    const r = 15 * ART_SCALE;
    const wax = signed ? 0xc8402e : 0x8a8090;
    g.fillStyle(0x2a1a33, 0.35);
    g.fillCircle(2 * ART_SCALE, 3 * ART_SCALE, r);
    g.fillStyle(wax, 1);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      g.fillCircle(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.32);
    }
    g.fillCircle(0, 0, r);
    g.lineStyle(2 * ART_SCALE, signed ? 0xffd27a : 0x5a5060, 1);
    if (signed) {
      // A check mark pressed into the wax.
      g.beginPath();
      g.moveTo(-6 * ART_SCALE, 0);
      g.lineTo(-1.5 * ART_SCALE, 5 * ART_SCALE);
      g.lineTo(7 * ART_SCALE, -6 * ART_SCALE);
      g.strokePath();
    } else {
      g.lineBetween(-6 * ART_SCALE, -6 * ART_SCALE, 6 * ART_SCALE, 6 * ART_SCALE);
      g.lineBetween(6 * ART_SCALE, -6 * ART_SCALE, -6 * ART_SCALE, 6 * ART_SCALE);
    }
    g.setPosition(s.x, y).setScale(2.2).setAlpha(0);
    this.#scene.tweens.add({ targets: g, scale: 1, alpha: 1, duration: this.#reduced ? 1 : 260, ease: 'Back.easeOut' });
    this.#scene.tweens.add({ targets: g, alpha: 0, y: y - 10 * ART_SCALE, delay: 1100, duration: 500, onComplete: () => { g.destroy(); } });
    if (this.#reduced) return;
    // Wax flecks on impact; a refusal crumbles and falls.
    this.#scene.time.delayedCall(220, () => {
      for (let i = 0; i < (signed ? 10 : 16); i++) {
        const a = rand(0, Math.PI * 2);
        this.#fx.spawn({
          x: at.x, y: at.y, z: 86 * ART_SCALE,
          vx: Math.cos(a) * rand(0.3, 1.2), vy: Math.sin(a) * rand(0.3, 1.2), vz: signed ? rand(60, 180) : rand(-20, 60),
          life: rand(0.7, 1.3), texture: 'fx-shard', color: wax, size: rand(0.4, 0.8) * ART_SCALE, bounce: 0.25, spin: rand(-8, 8),
        });
      }
    });
  }

  // Ice crystals snap around a frozen guardian; frost mist lingers.
  freeze(at: Vec2): void {
    audio.play('freeze');
    this.ring(at, 0x9fe6ff, 1.3, 600);
    if (this.#reduced) return;
    for (let i = 0; i < 28; i++) {
      const a = rand(0, Math.PI * 2);
      this.#fx.spawn({
        x: at.x + Math.cos(a) * 0.3, y: at.y + Math.sin(a) * 0.3, z: rand(0, 60) * ART_SCALE,
        vx: Math.cos(a) * rand(0.2, 0.9), vy: Math.sin(a) * rand(0.2, 0.9), vz: rand(-30, 120),
        life: rand(0.8, 1.6), texture: i % 2 === 0 ? 'fx-shard' : 'fx-spark', color: i % 3 === 0 ? 0xffffff : 0xa8ecff,
        size: rand(0.35, 0.7) * ART_SCALE, blend: 'add', bounce: 0.1, spin: rand(-4, 4), gravity: 0.4,
      });
    }
  }

  // Meltwater: drops fall under gravity and splash where they land.
  thaw(at: Vec2): void {
    audio.play('thaw');
    if (this.#reduced) return;
    for (let i = 0; i < 18; i++) {
      this.#fx.spawn({
        x: at.x + rand(-0.25, 0.25), y: at.y + rand(-0.25, 0.25), z: rand(20, 60) * ART_SCALE,
        vx: rand(-0.2, 0.2), vy: rand(-0.2, 0.2), vz: rand(0, 60),
        life: 1.6, texture: 'fx-dot', color: 0xbfeaff, size: 0.22 * ART_SCALE, bounce: 0, gravity: 1, drag: 0.1,
        onLand: (p) => { this.splash({ x: p.x, y: p.y }, 0xbfeaff, 3); },
      });
    }
  }

  // Tiny droplets thrown up where something lands on water or wet stone.
  splash(at: Vec2, color: number, n: number): void {
    this.ring(at, color, 0.25, 450, 1);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      this.#fx.spawn({
        x: at.x, y: at.y, z: 1, vx: Math.cos(a) * 0.4, vy: Math.sin(a) * 0.4, vz: rand(90, 160),
        life: 0.5, texture: 'fx-dot', color, size: 0.12 * ART_SCALE, bounce: 0, gravity: 1,
      });
    }
  }

  // Forked lightning between two points, flickering a few times: the network split.
  lightning(a: Vec2, b: Vec2, color = 0xff6b7a): void {
    audio.play('partition');
    const pa = worldToScreen(a.x, a.y);
    const pb = worldToScreen(b.x, b.y);
    const g = this.#scene.add.graphics().setDepth(100_000).setBlendMode(Phaser.BlendModes.ADD);
    this.#layer.add(g);
    const flashes = this.#reduced ? 1 : 4;
    let n = 0;
    const draw = (): void => {
      g.clear();
      const pts: { x: number; y: number }[] = [];
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const off = i === 0 || i === steps ? 0 : rand(-1, 1) * 40 * ART_SCALE * Math.sin(Math.PI * t);
        pts.push({ x: pa.x + (pb.x - pa.x) * t + off * 0.5, y: pa.y + (pb.y - pa.y) * t - 60 * ART_SCALE * Math.sin(Math.PI * t) + off });
      }
      for (const [w, alpha] of [[10, 0.18], [4, 0.6], [1.6, 1]] as const) {
        g.lineStyle(w * ART_SCALE, w > 2 ? color : 0xffffff, alpha);
        g.beginPath();
        pts.forEach((p, i) => {
          if (i === 0) g.moveTo(p.x, p.y);
          else g.lineTo(p.x, p.y);
        });
        g.strokePath();
      }
      n += 1;
      if (n < flashes) this.#scene.time.delayedCall(rand(60, 140), draw);
      else this.#scene.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => { g.destroy(); } });
    };
    draw();
    for (const at of [a, b]) this.ring(at, color, 1.5, 600);
  }

  // A steady beam between the relays once the link is back, then a burst at each end.
  beam(a: Vec2, b: Vec2): void {
    audio.play('repair');
    const pa = worldToScreen(a.x, a.y);
    const pb = worldToScreen(b.x, b.y);
    const g = this.#scene.add.graphics().setDepth(100_000).setBlendMode(Phaser.BlendModes.ADD);
    this.#layer.add(g);
    for (const [w, alpha] of [[14, 0.15], [6, 0.4], [2, 1]] as const) {
      g.lineStyle(w * ART_SCALE, w > 2 ? 0x5fd3b0 : 0xffffff, alpha);
      g.lineBetween(pa.x, pa.y - 30 * ART_SCALE, pb.x, pb.y - 30 * ART_SCALE);
    }
    this.#scene.tweens.add({ targets: g, alpha: 0, delay: 600, duration: 900, onComplete: () => { g.destroy(); } });
    for (const at of [a, b]) this.taskDone(at, 0x5fd3b0, false);
  }

  // The bell of the council: three slow shockwaves from the seal and a column of light.
  council(seal: Vec2): void {
    audio.play('council');
    for (let i = 0; i < 3; i++) this.#scene.time.delayedCall(i * 380, () => { this.ring(seal, 0xffd27a, 5, 1400); });
    if (this.#reduced) return;
    for (let i = 0; i < 40; i++) {
      this.#fx.spawn({
        x: seal.x + rand(-0.6, 0.6), y: seal.y + rand(-0.6, 0.6), z: rand(0, 20),
        vx: 0, vy: 0, vz: rand(80, 200), life: rand(1.2, 2.2), texture: 'fx-dot', color: 0xffe3a0,
        size: rand(0.3, 0.7) * ART_SCALE, blend: 'add', gravity: -0.05, drag: 0.5, wind: 0.3,
      });
    }
  }

  // A rotated-out guardian's light rises away in motes.
  dissolve(at: Vec2, color: number): void {
    audio.play('dissolve');
    if (this.#reduced) return;
    for (let i = 0; i < 36; i++) {
      this.#fx.spawn({
        x: at.x + rand(-0.2, 0.2), y: at.y + rand(-0.2, 0.2), z: rand(0, 56) * ART_SCALE,
        vx: rand(-0.1, 0.1), vy: rand(-0.1, 0.1), vz: rand(30, 90), life: rand(1.4, 2.6), texture: 'fx-dot',
        color, size: rand(0.25, 0.5) * ART_SCALE, blend: 'add', gravity: -0.03, drag: 0.3, wind: 0.6,
      });
    }
  }

  // Fireworks: shells climb, slow under gravity and burst at the top of their arc.
  fireworks(center: Vec2, colors: readonly number[]): void {
    if (this.#reduced) return;
    for (let k = 0; k < 7; k++) {
      this.#scene.time.delayedCall(k * 420 + rand(0, 200), () => {
        const x = center.x + rand(-6, 6);
        const y = center.y + rand(-6, 6);
        const color = colors[k % colors.length] ?? 0xffd27a;
        audio.play('firework');
        const vz = rand(700, 900) * ART_SCALE * 0.5;
        // Time to apex under gravity: v / g.
        const apexMs = (vz / (980 * ART_SCALE * 0.55)) * 1000;
        this.#fx.spawn({ x, y, z: 0, vx: 0, vy: 0, vz, life: apexMs / 1000, texture: 'fx-dot', color: 0xfff1c9, size: 0.3 * ART_SCALE, blend: 'add', drag: 0, wind: 0, sky: true });
        this.#scene.time.delayedCall(apexMs, () => {
          const top = (vz * vz) / (2 * 980 * ART_SCALE * 0.55);
          for (let i = 0; i < 60; i++) {
            const a = rand(0, Math.PI * 2);
            const e = rand(-1, 1);
            const sp = rand(1.2, 2.6);
            this.#fx.spawn({
              x, y, z: top, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: e * 260 * ART_SCALE * 0.5,
              life: rand(1.1, 1.9), texture: i % 2 === 0 ? 'fx-spark' : 'fx-dot', color: i % 5 === 0 ? 0xffffff : color,
              size: rand(0.3, 0.6) * ART_SCALE, blend: 'add', gravity: 0.25, drag: 1.4, wind: 0.2, sky: true, spin: rand(-5, 5),
            });
          }
        });
      });
    }
  }

  // Dust kicked up by a step on stone, or a ripple on water.
  footstep(at: Vec2, onWater: boolean, mine = false, surface: 'stone' | 'wood' | 'sand' = onWater ? 'wood' : 'stone'): void {
    if (mine) audio.play(surface === 'wood' ? 'stepWood' : surface === 'sand' ? 'stepSand' : 'step');
    if (this.#reduced || quality.current === 'low') return;
    if (onWater) {
      this.ring(at, 0xd8f2ff, 0.35, 500);
      return;
    }
    for (let i = 0; i < 2; i++) {
      this.#fx.spawn({
        x: at.x + rand(-0.08, 0.08), y: at.y + rand(-0.08, 0.08), z: 2, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(10, 30),
        life: rand(0.5, 0.8), texture: 'fx-dot', color: 0xe8cfa8, size: rand(0.35, 0.6) * ART_SCALE, gravity: 0.05, drag: 2, wind: 0.4, grow: 1.8,
      });
    }
  }

  // A number or sign that floats up and fades.
  #rise(at: Vec2, text: string, color: number): void {
    const s = worldToScreen(at.x, at.y);
    const label = this.#scene.add
      .text(s.x, s.y - 90 * ART_SCALE, text, { fontFamily: 'system-ui, sans-serif', fontSize: '34px', fontStyle: '900', color: `#${color.toString(16).padStart(6, '0')}`, stroke: '#2a1a33', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(100_001);
    this.#layer.add(label);
    this.#scene.tweens.add({ targets: label, y: label.y - 50 * ART_SCALE, alpha: { from: 1, to: 0 }, duration: 1300, ease: 'Cubic.easeOut', onComplete: () => { label.destroy(); } });
  }
}

