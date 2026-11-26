// What a story mission adds to Port Concord: night, the characters, the guards' torches, the act's own markers
// (heap signs at the tip, guardians who have signed), and a marker for where to go next. Drawn on top of the city
// scene; it keeps no game state of its own.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { CAMERA_HALF_ANGLE, CAMERA_RANGE, CITY_MAP, GLANCE_HALF_ANGLE, GLANCE_RANGE, HEAPS, TORCH_HALF_ANGLE, TORCH_KINDS, TORCH_RANGE, inSight, type NpcKind, type StoryAct } from '@byzantine-council/shared/city';
import { clearReaches } from '@byzantine-council/shared/pathfinding';
import { drawCostume } from '../game/costumes.js';
import { GUARDIAN_HEIGHT, drawGuardian, drawShadow } from '../game/guardianArt.js';
import { LOOKS, shopperLook, type Look } from './looks.js';
import { sceneDpr } from '../game/hidpi.js';
import { INTERP_DELAY_MS, InterpBuffer } from '../game/interpolation.js';
import { ART_SCALE, worldToScreen } from '../game/iso.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Rays per sight cone; enough that a wall corner cuts it cleanly at the longest reach.
const CONE_RAYS = 24;
const ANIMAL_NAMES: Readonly<Record<'duncan' | 'gull', string>> = { duncan: 'Duncan', gull: 'Gull' };

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
  // Its own look, when a kind comes in many (the shoppers in a crowd).
  readonly look?: Look;
}

export interface NpcView {
  readonly kind: string;
  readonly name: string;
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
  #digging: ReadonlySet<number> = new Set();
  #act: StoryAct | null = null;

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
  }

  // Puts up the act's markers: a sign on every heap or place, or a badge over each guardian once asked.
  setAct(act: StoryAct): void {
    if (this.#act === act) return;
    this.#act = act;
    for (const sign of this.#signs) sign.destroy();
    for (const mark of this.#digMarks) mark.destroy();
    this.#signs.length = 0;
    this.#digMarks.length = 0;
    if (act.markers === 'none') return;
    const dig = act.markers === 'heaps';
    const labelled = act.markers !== 'badges';
    act.spots.forEach((spot, i) => {
      const s = worldToScreen(spot.at.x, spot.at.y);
      const winter = dig && HEAPS[i]?.winter === true;
      const sign = this.scene.add
        .text(s.x, s.y - (labelled ? 40 : 78) * ART_SCALE, labelled ? spot.label : '', { fontFamily: FONT, fontSize: '15px', fontStyle: '800', color: winter ? '#cfe8ff' : '#fff1de', backgroundColor: '#2a1a33cc', padding: { x: 6, y: 3 } })
        .setOrigin(0.5, 1)
        .setDepth(-1)
        .setVisible(labelled);
      this.names.add(sign);
      this.#signs.push(sign);
      const mark = new Phaser.GameObjects.Graphics(this.scene).setPosition(s.x, s.y).setDepth(this.depthOf(spot.at.x, spot.at.y) + 0.1).setVisible(false);
      this.entities.add(mark);
      if (dig) {
        mark.fillStyle(0x3b2a1c, 0.85);
        mark.fillEllipse(0, 6 * ART_SCALE, 40 * ART_SCALE, 18 * ART_SCALE);
      } else {
        mark.lineStyle(3 * ART_SCALE, 0xe8c25a, 0.9);
        mark.strokeEllipse(0, 0, 70 * ART_SCALE, 34 * ART_SCALE);
      }
      this.#digMarks[i] = mark;
    });
  }

  setNpc(id: string, npc: NpcView): void {
    let f = this.#figures.get(id);
    if (f === undefined) {
      const kind = npc.kind as NpcKind;
      const ring = new Phaser.GameObjects.Graphics(this.scene);
      if (kind !== 'letter') drawShadow(ring, false);
      const body = new Phaser.GameObjects.Graphics(this.scene);
      const root = new Phaser.GameObjects.Container(this.scene, 0, 0, [ring, body]);
      this.entities.add(root);
      const label = new Phaser.GameObjects.Text(this.scene, 0, 0, npc.name !== '' ? npc.name : kind === 'letter' ? '' : kind === 'duncan' || kind === 'gull' ? ANIMAL_NAMES[kind] : LOOKS[kind].name, {
        fontFamily: FONT, fontSize: '14px', fontStyle: '700', color: '#ffe3a8', stroke: '#2a1a33', strokeThickness: 4, resolution: Math.ceil(sceneDpr(this.scene)),
      }).setOrigin(0.5, 1);
      this.names.add(label);
      f = { kind, root, body, label, buffer: new InterpBuffer(), pos: { x: npc.x, y: npc.y }, facing: npc.facing, side: 1, chasing: false, shown: npc.shown, ...(kind === 'shopper' ? { look: shopperLook(Number(id.replace(/\D/g, ''))) } : {}) };
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

  setSpot(index: number, done: boolean): void {
    this.#digMarks[index]?.setVisible(done);
    const sign = this.#signs[index];
    if (sign === undefined) return;
    if (this.#act?.markers !== 'badges') {
      sign.setAlpha(done ? 0.45 : 1);
      return;
    }
    const refused = this.#act.spots[index]?.refuses === true;
    sign.setText(refused ? 'Won’t sign' : (this.#act.badge ?? 'Signed')).setColor(refused ? '#ff9c85' : '#ffe3a8').setVisible(done);
  }

  setDigging(heaps: readonly number[]): void {
    this.#digging = new Set(heaps);
  }

  // How dark the night lies over the city: deep at night, a thin blue haze for dawn and morning scenes.
  setDark(alpha: number): void {
    this.#night.setFillStyle(0x0b1530, alpha);
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
      if (f.kind === 'letter') f.body.setAlpha(f.chasing && !this.reduced ? 0.55 + 0.45 * Math.abs(Math.sin(time / 160)) : 1);
      f.label.setScale(1 / zoom).setPosition(s.x, s.y - (f.kind === 'duncan' ? 24 : f.kind === 'gull' ? 86 : GUARDIAN_HEIGHT / ART_SCALE + 8) * ART_SCALE);
    }
    for (const sign of this.#signs) sign.setScale(1 / zoom);
    this.#drawTorch();
    this.#drawBeacon(time);
    this.#drawPointer(me, zoom);
    this.#digMarks.forEach((m, i) => {
      if (this.#digging.has(i) && !this.reduced) m.setVisible(true).setAlpha(0.5 + 0.5 * Math.abs(Math.sin(time / 120)));
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
    if (f.kind === 'gull') {
      drawGull(f.body, f.side);
      return;
    }
    if (f.kind === 'letter') {
      drawLetter(f.body, f.chasing);
      return;
    }
    const look = f.look ?? LOOKS[f.kind];
    drawGuardian(f.body, look.colors, f.side, look.wear);
    drawCostume(f.body, look.costume, f.side);
  }

  // Torches: a warm cone on the ground in front of every guard, in the same reach the server uses.
  #drawTorch(): void {
    const g = this.#torch;
    g.clear();
    const watch = this.#act?.watch;
    for (const f of this.#figures.values()) {
      if (watch !== undefined && f.kind === watch.npc) {
        if (f.shown && f.chasing) this.#ring(g, watch.at, watch.range);
        continue;
      }
      const c = coneOf(f);
      if (c !== null) this.#cone(g, f, c.range, c.half, c.color, c.lamp);
    }
  }

  /** Where every figure watching right now stands (a cone, or the act's ring), so the scene can fade whatever would hide them. */
  watchers(): Vec2[] {
    const npc = this.#act?.watch?.npc;
    return [...this.#figures.values()].filter((f) => (f.kind === npc ? f.shown && f.chasing : coneOf(f) !== null)).map((f) => f.pos);
  }

  /** The ring on the ground a character watches: inside it, the act's rules can catch you. */
  #ring(g: Phaser.GameObjects.Graphics, at: Vec2, range: number): void {
    const points = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      const p = worldToScreen(at.x + Math.cos(a) * range, at.y + Math.sin(a) * range);
      return new Phaser.Math.Vector2(p.x, p.y);
    });
    g.fillStyle(0xbff0e2, 0.12);
    g.fillPoints(points, true);
    g.lineStyle(3 * ART_SCALE, 0xbff0e2, 0.55);
    g.strokePoints(points, true);
  }

  /** A cone on the ground in front of a figure, cut off where the server's line of sight is: a torch's light, or a glance back. */
  #cone(g: Phaser.GameObjects.Graphics, guard: Figure, range: number, half: number, color: number, lamp: boolean): void {
    const angles = Array.from({ length: CONE_RAYS + 1 }, (_, i) => guard.facing - half + (2 * half * i) / CONE_RAYS);
    const reach = clearReaches(CITY_MAP, guard.pos, angles, range);
    const points: Phaser.Math.Vector2[] = [];
    const o = worldToScreen(guard.pos.x, guard.pos.y);
    points.push(new Phaser.Math.Vector2(o.x, o.y));
    angles.forEach((a, i) => {
      const r = reach[i] ?? 0;
      const p = worldToScreen(guard.pos.x + Math.cos(a) * r, guard.pos.y + Math.sin(a) * r);
      points.push(new Phaser.Math.Vector2(p.x, p.y));
    });
    g.fillStyle(color, 0.28);
    g.fillPoints(points, true);
    if (!lamp) return;
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

// A gull hanging in the air over its stretch of road, wings up, beak the way it faces.
function drawGull(g: Phaser.GameObjects.Graphics, side: 1 | -1): void {
  const k = ART_SCALE * 1.6;
  g.clear();
  g.fillStyle(0xf4f4f0, 1);
  g.fillEllipse(0, -34 * k, 22 * k, 10 * k);
  g.fillCircle(side * 10 * k, -38 * k, 5.5 * k);
  g.fillStyle(0xb9bfc6, 1);
  g.fillTriangle(-4 * k, -36 * k, -20 * k, -50 * k, 4 * k, -38 * k);
  g.fillTriangle(4 * k, -36 * k, 20 * k, -50 * k, -4 * k, -38 * k);
  g.fillStyle(0x2a2a30, 1);
  g.fillCircle(side * 12 * k, -39 * k, 1.4 * k);
  g.fillStyle(0xf2a23a, 1);
  g.fillTriangle(side * 15 * k, -39 * k, side * 21 * k, -37 * k, side * 15 * k, -36 * k);
  g.fillStyle(0x2a2a30, 0.9);
  g.fillTriangle(-side * 11 * k, -34 * k, -side * 17 * k, -36 * k, -side * 17 * k, -31 * k);
}

// A letter floating over whoever holds it: white with a gold seal, or red with a warning mark once its guardian is alone with it.
function drawLetter(g: Phaser.GameObjects.Graphics, alone: boolean): void {
  const k = ART_SCALE;
  const top = -GUARDIAN_HEIGHT - 56 * k;
  g.clear();
  g.fillStyle(alone ? 0xff8a7a : 0xfff6e8, 1);
  g.lineStyle(3 * k, 0x2a1a33, 1);
  g.fillRect(-15 * k, top, 30 * k, 20 * k);
  g.strokeRect(-15 * k, top, 30 * k, 20 * k);
  g.lineBetween(-15 * k, top, 0, top + 11 * k);
  g.lineBetween(15 * k, top, 0, top + 11 * k);
  g.fillStyle(alone ? 0xb3261e : 0xe8c25a, 1);
  g.fillCircle(0, top + 11 * k, 4 * k);
  if (!alone) return;
  g.fillStyle(0xb3261e, 1);
  g.fillRect(-2 * k, top - 20 * k, 4 * k, 11 * k);
  g.fillCircle(0, top - 5 * k, 2.2 * k);
}

// The sight cone a figure shows right now, if any: a torch, Mr Fennick's glance back, or Lumley's camera.
function coneOf(f: Figure): { range: number; half: number; color: number; lamp: boolean } | null {
  if (!f.shown) return null;
  if (TORCH_KINDS.has(f.kind)) return { range: TORCH_RANGE, half: TORCH_HALF_ANGLE, color: 0xffe9a8, lamp: true };
  if (f.kind === 'fennick' && f.chasing) return { range: GLANCE_RANGE, half: GLANCE_HALF_ANGLE, color: 0xbfe3ff, lamp: false };
  if (f.kind === 'lumley' && f.chasing) return { range: CAMERA_RANGE, half: CAMERA_HALF_ANGLE, color: 0xf2c6ff, lamp: false };
  return null;
}
