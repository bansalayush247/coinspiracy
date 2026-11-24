// What a story mission adds to Port Concord: night, the characters, Ivor's torch, the heap signs at the tip, and
// a marker for where to go next. Drawn on top of the city scene; it keeps no game state of its own.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { HEAPS, TORCH_HALF_ANGLE, TORCH_RANGE, heapCentre, inSight, type NpcKind } from '@byzantine-council/shared/city';
import { GUARDIAN_HEIGHT, drawGuardian, drawShadow, type Wear } from '../game/guardianArt.js';
import { sceneDpr } from '../game/hidpi.js';
import { INTERP_DELAY_MS, InterpBuffer } from '../game/interpolation.js';
import { ART_SCALE, worldToScreen } from '../game/iso.js';
import { seatColors, type GuardianColors } from '../game/palette.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const LOOKS: Readonly<Record<Exclude<NpcKind, 'duncan'>, { name: string; colors: GuardianColors; wear: Wear }>> = {
  dani: { name: 'Dani', colors: { lit: 0x4fb3a9, shadow: 0x2b6b66, highlight: 0xa6e3dc }, wear: { hat: '', shades: '', outfit: '' } },
  mags: { name: 'Mags', colors: { lit: 0xd98c3f, shadow: 0x8a5426, highlight: 0xf2c491 }, wear: { hat: '', shades: '', outfit: '' } },
  guard: { name: 'Ivor', colors: seatColors(7), wear: { hat: '', shades: '', outfit: '' } },
};

interface Figure {
  readonly kind: NpcKind;
  readonly root: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  readonly buffer: InterpBuffer;
  readonly pos: { x: number; y: number };
  facing: number;
  side: 1 | -1;
  chasing: boolean;
  shown: boolean;
}

export interface NpcView {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly shown: boolean;
  readonly chasing: boolean;
}

export class MissionView {
  readonly #figures = new Map<string, Figure>();
  readonly #night: Phaser.GameObjects.Rectangle;
  readonly #torch: Phaser.GameObjects.Graphics;
  readonly #beacon: Phaser.GameObjects.Graphics;
  readonly #pointer: Phaser.GameObjects.Graphics;
  readonly #signs: Phaser.GameObjects.Text[] = [];
  readonly #digMarks: Phaser.GameObjects.Graphics[] = [];
  readonly #tmp = { x: 0, y: 0 };
  #target: Vec2 | null = null;
  #digging = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly entities: Phaser.GameObjects.Layer,
    private readonly names: Phaser.GameObjects.Layer,
    private readonly depthOf: (x: number, y: number) => number,
    private readonly reduced: boolean,
  ) {
    this.#night = scene.add.rectangle(0, 0, 10, 10, 0x0b1530, 0.55).setOrigin(0).setDepth(15);
    this.#torch = scene.add.graphics().setDepth(16).setBlendMode(Phaser.BlendModes.ADD);
    this.#beacon = scene.add.graphics().setDepth(17);
    this.#pointer = scene.add.graphics().setDepth(18);
    HEAPS.forEach((h, i) => {
      const c = heapCentre(h);
      const s = worldToScreen(c.x, c.y);
      const sign = scene.add
        .text(s.x, s.y - 40 * ART_SCALE, h.label, { fontFamily: FONT, fontSize: '15px', fontStyle: '800', color: h.winter ? '#cfe8ff' : '#fff1de', backgroundColor: '#2a1a33cc', padding: { x: 6, y: 3 } })
        .setOrigin(0.5, 1)
        .setDepth(-1);
      this.names.add(sign);
      this.#signs.push(sign);
      const mark = new Phaser.GameObjects.Graphics(scene).setPosition(s.x, s.y).setDepth(depthOf(c.x, c.y) + 0.1).setVisible(false);
      this.entities.add(mark);
      mark.fillStyle(0x3b2a1c, 0.85);
      mark.fillEllipse(0, 6 * ART_SCALE, 40 * ART_SCALE, 18 * ART_SCALE);
      this.#digMarks[i] = mark;
    });
  }

  setNpc(id: string, npc: NpcView): void {
    let f = this.#figures.get(id);
    if (f === undefined) {
      const kind = npc.kind as NpcKind;
      const ring = new Phaser.GameObjects.Graphics(this.scene);
      drawShadow(ring, false);
      const body = new Phaser.GameObjects.Graphics(this.scene);
      const root = new Phaser.GameObjects.Container(this.scene, 0, 0, [ring, body]);
      this.entities.add(root);
      const label = new Phaser.GameObjects.Text(this.scene, 0, 0, kind === 'duncan' ? 'Duncan' : LOOKS[kind].name, {
        fontFamily: FONT, fontSize: '14px', fontStyle: '700', color: '#ffe3a8', stroke: '#2a1a33', strokeThickness: 4, resolution: Math.ceil(sceneDpr(this.scene)),
      }).setOrigin(0.5, 1);
      this.names.add(label);
      f = { kind, root, body, label, buffer: new InterpBuffer(), pos: { x: npc.x, y: npc.y }, facing: npc.facing, side: 1, chasing: false, shown: npc.shown };
      this.#draw(f);
      this.#figures.set(id, f);
    }
    f.buffer.push(performance.now(), npc.x, npc.y);
    f.facing = npc.facing;
    const side: 1 | -1 = Math.cos(f.facing) - Math.sin(f.facing) >= 0 ? 1 : -1;
    if (side !== f.side || npc.chasing !== f.chasing) {
      f.side = side;
      f.chasing = npc.chasing;
      this.#draw(f);
    }
    f.shown = npc.shown;
  }

  setHeap(index: number, dug: boolean): void {
    this.#digMarks[index]?.setVisible(dug);
    this.#signs[index]?.setAlpha(dug ? 0.45 : 1);
  }

  setDigging(index: number): void {
    this.#digging = index;
  }

  setTarget(target: Vec2 | null): void {
    this.#target = target;
  }

  update(time: number, me: Vec2 | null): void {
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    this.#night.setPosition(view.x - 400, view.y - 400).setSize(view.width + 800, view.height + 800);
    const renderTime = performance.now() - INTERP_DELAY_MS;
    const zoom = cam.zoom / sceneDpr(this.scene);
    for (const f of this.#figures.values()) {
      if (f.buffer.sample(renderTime, this.#tmp)) {
        f.pos.x = this.#tmp.x;
        f.pos.y = this.#tmp.y;
      }
      const s = worldToScreen(f.pos.x, f.pos.y);
      const trot = f.kind === 'duncan' && f.chasing && !this.reduced ? Math.abs(Math.sin(time / 70)) * 3 * ART_SCALE : 0;
      const seen = f.shown && (me === null || inSight(me, f.pos));
      f.root.setVisible(seen);
      f.label.setVisible(seen);
      f.root.setPosition(s.x, s.y).setDepth(this.depthOf(f.pos.x, f.pos.y));
      f.body.y = -trot;
      f.label.setScale(1 / zoom).setPosition(s.x, s.y - (f.kind === 'duncan' ? 24 : GUARDIAN_HEIGHT / ART_SCALE + 8) * ART_SCALE);
    }
    for (const sign of this.#signs) sign.setScale(1 / zoom);
    this.#drawTorch();
    this.#drawBeacon(time);
    this.#drawPointer(me, zoom);
    this.#digMarks.forEach((m, i) => {
      if (i === this.#digging && !this.reduced) m.setVisible(true).setAlpha(0.5 + 0.5 * Math.abs(Math.sin(time / 120)));
    });
  }

  destroy(): void {
    for (const f of this.#figures.values()) {
      f.root.destroy();
      f.label.destroy();
    }
    this.#figures.clear();
    for (const s of this.#signs) s.destroy();
    for (const m of this.#digMarks) m.destroy();
    this.#night.destroy();
    this.#torch.destroy();
    this.#beacon.destroy();
    this.#pointer.destroy();
  }

  #draw(f: Figure): void {
    if (f.kind === 'duncan') {
      drawDog(f.body, f.side, f.chasing);
      return;
    }
    const look = LOOKS[f.kind];
    drawGuardian(f.body, look.colors, f.side, look.wear);
  }

  // The torch: a warm cone on the ground in front of Ivor, in the same reach the server uses.
  #drawTorch(): void {
    const g = this.#torch;
    g.clear();
    const guard = [...this.#figures.values()].find((f) => f.kind === 'guard');
    if (guard === undefined || !guard.shown) return;
    const steps = 10;
    const points: Phaser.Math.Vector2[] = [];
    const o = worldToScreen(guard.pos.x, guard.pos.y);
    points.push(new Phaser.Math.Vector2(o.x, o.y));
    for (let i = 0; i <= steps; i++) {
      const a = guard.facing - TORCH_HALF_ANGLE + (2 * TORCH_HALF_ANGLE * i) / steps;
      const p = worldToScreen(guard.pos.x + Math.cos(a) * TORCH_RANGE, guard.pos.y + Math.sin(a) * TORCH_RANGE);
      points.push(new Phaser.Math.Vector2(p.x, p.y));
    }
    g.fillStyle(0xffe9a8, 0.28);
    g.fillPoints(points, true);
    g.fillStyle(0xfff6d8, 0.25);
    g.fillCircle(o.x, o.y - GUARDIAN_HEIGHT * 0.55, 6 * ART_SCALE);
  }

  #drawBeacon(time: number): void {
    const g = this.#beacon;
    g.clear();
    if (this.#target === null) return;
    const s = worldToScreen(this.#target.x, this.#target.y);
    const pulse = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(time / 300);
    const w = 2.4 * 64 * ART_SCALE;
    g.lineStyle(3 * ART_SCALE, 0xffd27a, 0.6 + 0.4 * pulse);
    g.strokeEllipse(s.x, s.y, w * (0.8 + 0.2 * pulse), (w / 2) * (0.8 + 0.2 * pulse));
    g.fillStyle(0xffd27a, 0.5);
    g.fillTriangle(s.x - 10 * ART_SCALE, s.y - 70 * ART_SCALE - pulse * 8, s.x + 10 * ART_SCALE, s.y - 70 * ART_SCALE - pulse * 8, s.x, s.y - 52 * ART_SCALE - pulse * 8);
  }

  // A small arrow at the player's feet pointing to the next place, when it is off in the distance.
  #drawPointer(me: Vec2 | null, zoom: number): void {
    const g = this.#pointer;
    g.clear();
    if (me === null || this.#target === null) return;
    const dist = Math.hypot(this.#target.x - me.x, this.#target.y - me.y);
    if (dist < 6) return;
    const from = worldToScreen(me.x, me.y);
    const to = worldToScreen(this.#target.x, this.#target.y);
    const a = Math.atan2(to.y - from.y, to.x - from.x);
    const r = 46 / zoom;
    const tip = { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r * 0.6 };
    const size = 12 / zoom;
    g.fillStyle(0xffd27a, 0.95);
    g.lineStyle(3 / zoom, 0x2a1a33, 1);
    const p1 = { x: tip.x + Math.cos(a) * size, y: tip.y + Math.sin(a) * size };
    const p2 = { x: tip.x + Math.cos(a + 2.4) * size, y: tip.y + Math.sin(a + 2.4) * size };
    const p3 = { x: tip.x + Math.cos(a - 2.4) * size, y: tip.y + Math.sin(a - 2.4) * size };
    g.fillTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    g.strokeTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  }
}

// Duncan: a stout cartoon dog, ears up when he's on the chase.
function drawDog(g: Phaser.GameObjects.Graphics, side: 1 | -1, chasing: boolean): void {
  const k = ART_SCALE;
  g.clear();
  g.fillStyle(0x6b4a2e, 1);
  g.fillEllipse(0, -9 * k, 26 * k, 13 * k);
  g.fillRect(-10 * k, -6 * k, 4 * k, 7 * k);
  g.fillRect(6 * k, -6 * k, 4 * k, 7 * k);
  g.fillStyle(0x8a6240, 1);
  g.fillCircle(side * 13 * k, -15 * k, 7 * k);
  g.fillStyle(0x4a3220, 1);
  g.fillTriangle(side * 9 * k, -20 * k, side * 12 * k, chasing ? -28 * k : -18 * k, side * 15 * k, -20 * k);
  g.fillStyle(0x2a1a33, 1);
  g.fillCircle(side * 19 * k, -14 * k, 2 * k);
  g.fillCircle(side * 14 * k, -16 * k, 1.2 * k);
  g.lineStyle(3 * k, 0x6b4a2e, 1);
  g.lineBetween(-side * 12 * k, -11 * k, -side * 17 * k, chasing ? -18 * k : -13 * k);
  g.fillStyle(0xc0503a, 1);
  g.fillRect(side * 7 * k, -12 * k, 4 * k, 2 * k);
}
