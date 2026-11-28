// Walkable visual previews for islands that are not yet full multiplayer spaces.
// They are local-only: exploring never changes progression or sends game messages.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { drawGuardian, drawShadow } from '../game/guardianArt.js';
import { ART_SCALE, TILE_H, TILE_W } from '../game/iso.js';
import { seatColors } from '../game/palette.js';
import {
  ISLAND_OBJECTIVES,
  islandObjectiveProgress,
  nearbyObjectivePoint,
  type InteractionPoint,
  type IslandObjective,
  type IslandProgress,
  type PreviewIslandId,
} from './islandObjectives.js';
import { poseOf } from '../game/facing.js';
import { findSparkle, islandFinds } from './findJournal.js';
import { FIND_REACH, type IslandFind } from './islandFinds.js';

export const ISLAND_SCENE_KEY = 'island-preview';
export type { PreviewIslandId } from './islandObjectives.js';

export interface IslandDirectionSource {
  direction(): Vec2;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const CENTER = { x: 10, y: 10 };

function p(x: number, y: number, z = 0): Point {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) - z * ART_SCALE };
}

function fan(g: Phaser.GameObjects.Graphics, color: number, points: readonly Point[], alpha = 1): void {
  const [first] = points;
  if (first === undefined) return;
  g.fillStyle(color, alpha);
  for (let i = 1; i < points.length - 1; i++) {
    const b = points[i];
    const c = points[i + 1];
    if (b !== undefined && c !== undefined) g.fillTriangle(first.x, first.y, b.x, b.y, c.x, c.y);
  }
}

function darken(color: number, amount: number): number {
  return Phaser.Display.Color.IntegerToColor(color).darken(amount).color;
}

function prism(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, z: number, height: number, color: number, top = color): void {
  const high = z + height;
  fan(g, darken(color, 22), [p(x0, y1, z), p(x1, y1, z), p(x1, y1, high), p(x0, y1, high)]);
  fan(g, darken(color, 34), [p(x1, y1, z), p(x1, y0, z), p(x1, y0, high), p(x1, y1, high)]);
  fan(g, top, [p(x0, y0, high), p(x1, y0, high), p(x1, y1, high), p(x0, y1, high)]);
}

function line(g: Phaser.GameObjects.Graphics, a: Point, b: Point, color: number, width = 3, alpha = 1): void {
  g.lineStyle(width * ART_SCALE, color, alpha);
  g.lineBetween(a.x, a.y, b.x, b.y);
}

const THEMES: Readonly<Record<PreviewIslandId, { sky: number; grass: number; edge: number; accent: number }>> = {
  mint: { sky: 0x8d729f, grass: 0x5fd3b0, edge: 0x846277, accent: 0xffd27a },
  signing: { sky: 0x735f94, grass: 0xe5bd68, edge: 0x8b635c, accent: 0xffe0a0 },
  council: { sky: 0x604f84, grass: 0xa983ff, edge: 0x67506f, accent: 0xffd27a },
  watchtower: { sky: 0x476f91, grass: 0x70badf, edge: 0x4d6075, accent: 0xff8b68 },
  reef: { sky: 0x2f7798, grass: 0x42b5bd, edge: 0x416579, accent: 0xffe36a },
};

export class IslandScene extends Phaser.Scene {
  #island: PreviewIslandId = 'mint';
  #input: IslandDirectionSource | null = null;
  #avatar!: Phaser.GameObjects.Container;
  #body!: Phaser.GameObjects.Graphics;
  #position = { x: 10, y: 12.5 };
  #facing: 1 | -1 = 1;
  #back = false;
  #objective: IslandObjective = ISLAND_OBJECTIVES.mint;
  #markers!: Phaser.GameObjects.Graphics;
  #find!: Phaser.GameObjects.Graphics;
  #rank = 1;
  readonly #completed = new Set<string>();
  #nearbyId: string | null = null;
  onProgress: (progress: IslandProgress) => void = () => undefined;
  onActivated: (complete: boolean) => void = () => undefined;
  onFindNearby: (nearby: boolean) => void = () => undefined;
  onFind: (find: IslandFind) => void = () => undefined;

  constructor() {
    super({ key: ISLAND_SCENE_KEY, active: false });
  }

  init(data: { island?: PreviewIslandId; rank?: number }): void {
    this.#island = data.island ?? 'mint';
    this.#rank = data.rank ?? 1;
    this.#objective = ISLAND_OBJECTIVES[this.#island];
    this.#position = { x: 10, y: 12.5 };
    this.#completed.clear();
    this.#nearbyId = null;
  }

  create(): void {
    const theme = THEMES[this.#island];
    this.cameras.main.setBackgroundColor(theme.sky);
    const backdrop = this.add.graphics().setDepth(-10);
    this.#drawBackdrop(backdrop, theme);
    const ground = this.add.graphics().setDepth(0);
    this.#drawIsland(ground, theme.grass, theme.edge);
    const props = this.add.graphics().setDepth(10);
    this.#drawLandmark(props, theme);
    this.#addDetails(props, theme);
    this.#markers = this.add.graphics().setDepth(14);
    this.#find = this.add.graphics().setDepth(15);
    this.#drawMarkers();

    const shadow = new Phaser.GameObjects.Graphics(this);
    drawShadow(shadow, true);
    this.#body = new Phaser.GameObjects.Graphics(this);
    drawGuardian(this.#body, seatColors(1), this.#facing, { hat: '', shades: '', outfit: '' });
    this.#avatar = new Phaser.GameObjects.Container(this, 0, 0, [shadow, this.#body]).setDepth(30);
    this.add.existing(this.#avatar);
    this.#placeAvatar();
    this.#emitProgress();
    this.#updateFind();

    const center = p(CENTER.x, CENTER.y);
    this.cameras.main.centerOn(center.x, center.y - 20);
    this.#fit();
    const resize = (): void => {
      this.#fit();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, resize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, resize);
      this.#input = null;
    });
  }

  attach(input: IslandDirectionSource): void {
    this.#input = input;
    this.#emitProgress();
  }

  interact(): void {
    const found = islandFinds.search(this.#island, this.#position, this.#rank);
    if (found !== null) {
      this.onFind(found);
      this.#updateFind();
      return;
    }
    if (this.#completed.size >= this.#objective.target) return;
    const point = this.#nearbyPoint();
    if (point === null) {
      this.#emitProgress();
      return;
    }
    this.#completed.add(point.id);
    const complete = this.#completed.size >= this.#objective.target;
    this.#nearbyId = null;
    this.#drawMarkers();
    this.#emitProgress();
    this.onActivated(complete);
  }

  override update(_time: number, delta: number): void {
    const direction = this.#input?.direction() ?? { x: 0, y: 0 };
    if (direction.x === 0 && direction.y === 0) return;
    const step = Math.min(delta, 50) * 0.0042;
    const next = { x: this.#position.x + direction.x * step, y: this.#position.y + direction.y * step };
    const dx = (next.x - CENTER.x) / 7.4;
    const dy = (next.y - CENTER.y) / 5.8;
    if (dx * dx + dy * dy <= 1) this.#position = next;
    const pose = poseOf(Math.atan2(direction.y, direction.x));
    if (pose.facing !== this.#facing || pose.back !== this.#back) {
      this.#facing = pose.facing;
      this.#back = pose.back;
      drawGuardian(this.#body, seatColors(1), pose.facing, { hat: '', shades: '', outfit: '' }, pose.back);
    }
    this.#placeAvatar();
    this.#updateFind();
    const nearby = this.#nearbyPoint()?.id ?? null;
    if (nearby !== this.#nearbyId) {
      this.#nearbyId = nearby;
      this.#emitProgress();
    }
  }

  #nearbyPoint(): InteractionPoint | null {
    return nearbyObjectivePoint(this.#objective, this.#completed, this.#position);
  }

  #updateFind(): void {
    const found = islandFinds.nearby(this.#island, this.#position, this.#rank, 1.85);
    findSparkle(this.#find, found);
    this.onFindNearby(found !== null && Math.hypot(found.at.x - this.#position.x, found.at.y - this.#position.y) <= FIND_REACH);
  }

  #emitProgress(): void {
    this.onProgress(islandObjectiveProgress(this.#objective, this.#completed, this.#position));
  }

  #drawMarkers(): void {
    this.#markers.clear();
    const complete = this.#completed.size >= this.#objective.target;
    const accent = THEMES[this.#island].accent;
    for (const point of this.#objective.points) {
      const at = p(point.x, point.y, 4);
      const done = this.#completed.has(point.id);
      const color = done ? 0x5fd3b0 : complete ? 0x8f8298 : accent;
      this.#markers.fillStyle(color, done ? 0.22 : 0.12);
      this.#markers.fillEllipse(at.x, at.y, 76, 27);
      this.#markers.lineStyle(2.5 * ART_SCALE, color, done ? 0.8 : 1);
      this.#markers.strokeEllipse(at.x, at.y, done ? 54 : 68, done ? 18 : 24);
      if (!done && !complete) {
        this.#markers.fillStyle(color, 0.9);
        this.#markers.fillTriangle(at.x, at.y - 42, at.x - 8, at.y - 27, at.x + 8, at.y - 27);
      }
    }
  }

  #placeAvatar(): void {
    const at = p(this.#position.x, this.#position.y);
    this.#avatar.setPosition(at.x, at.y).setDepth(20 + (this.#position.x + this.#position.y) * 2);
  }

  #fit(): void {
    const size = this.scale.gameSize;
    const ceiling = this.#island === 'watchtower' ? 0.68 : this.#island === 'signing' ? 0.78 : 0.82;
    this.cameras.main.setZoom(Math.max(0.58, Math.min(ceiling, size.width / 1100, size.height / 850)));
  }

  #drawIsland(g: Phaser.GameObjects.Graphics, top: number, edge: number): void {
    const rim: Point[] = [];
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * Math.PI * 2;
      rim.push(p(10 + Math.cos(angle) * 8.2, 10 + Math.sin(angle) * 6.5));
    }
    const lower = rim.map((point) => ({ x: point.x, y: point.y + 95 * ART_SCALE }));
    fan(g, edge, [...rim.slice(20), ...lower.slice(20).reverse()]);
    g.fillStyle(0x34223f, 0.24);
    const center = p(CENTER.x, CENTER.y);
    g.fillEllipse(center.x, center.y + 120, 1050, 250);
    g.fillStyle(top, 1);
    const vectors = rim.map((point) => new Phaser.Math.Vector2(point.x, point.y));
    g.fillPoints(vectors, true);
    g.lineStyle(5 * ART_SCALE, 0xffe2ad, 0.7);
    g.strokePoints(vectors, true);
    // Strata down the visible cliff make the island read as a floating land mass, not a flat disc.
    for (let i = 21; i < 39; i += 3) {
      const at = rim[i];
      if (at === undefined) continue;
      line(g, at, { x: at.x + (i % 2 === 0 ? 10 : -8), y: at.y + (62 + (i % 4) * 8) * ART_SCALE }, darken(edge, 22), 2, 0.65);
    }
    for (let i = 0; i < 24; i++) {
      const x = 3 + ((i * 47) % 140) / 10;
      const y = 5 + ((i * 31) % 100) / 10;
      const dx = (x - 10) / 8.2;
      const dy = (y - 10) / 6.5;
      if (dx * dx + dy * dy > 0.82) continue;
      const at = p(x, y);
      g.fillStyle(i % 3 === 0 ? 0xffe8a8 : 0xffffff, 0.35);
      g.fillCircle(at.x, at.y, 2.2 * ART_SCALE);
    }
    // A main route and two smaller branches keep the composition legible while walking.
    this.#path(g, [[10, 14.7], [10, 12.4], [10, 10.4], [10, 8.5]]);
    this.#path(g, [[10, 11.6], [7.8, 11], [5.8, 10.4]], true);
    this.#path(g, [[10, 11.6], [12.3, 11], [14.4, 10]], true);
  }

  #drawBackdrop(g: Phaser.GameObjects.Graphics, theme: (typeof THEMES)[PreviewIslandId]): void {
    const center = p(CENTER.x, CENTER.y);
    g.fillStyle(theme.accent, 0.16);
    g.fillCircle(center.x + 430, center.y - 420, 105);
    const cloud = (x: number, y: number, scale: number): void => {
      g.fillStyle(0xfff3df, 0.12);
      g.fillEllipse(x, y, 260 * scale, 70 * scale);
      g.fillEllipse(x - 55 * scale, y - 24 * scale, 120 * scale, 80 * scale);
      g.fillEllipse(x + 45 * scale, y - 34 * scale, 155 * scale, 100 * scale);
    };
    cloud(center.x - 480, center.y - 300, 1);
    cloud(center.x + 510, center.y - 210, 0.75);
    cloud(center.x - 590, center.y + 30, 0.55);
  }

  #path(g: Phaser.GameObjects.Graphics, points: readonly (readonly [number, number])[], branch = false): void {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a === undefined || b === undefined) continue;
      line(g, p(a[0], a[1], 1), p(b[0], b[1], 1), 0xffedc7, branch ? 10 : 17, branch ? 0.22 : 0.3);
      line(g, p(a[0], a[1], 2), p(b[0], b[1], 2), 0x9d765c, branch ? 1 : 1.5, 0.22);
    }
  }

  #surface(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, color: number, alpha = 1): void {
    const at = p(x, y, 2);
    g.fillStyle(color, alpha);
    g.fillEllipse(at.x, at.y, width, height);
    g.lineStyle(2 * ART_SCALE, 0xfff0cf, Math.min(alpha, 0.55));
    g.strokeEllipse(at.x, at.y, width, height);
  }

  #door(g: Phaser.GameObjects.Graphics, x: number, y: number, height: number, accent: number): void {
    fan(g, 0x3c2949, [p(x - 0.55, y, 0), p(x + 0.55, y, 0), p(x + 0.55, y, height), p(x - 0.55, y, height)]);
    const at = p(x, y, height * 0.6);
    g.fillStyle(accent, 1);
    g.fillCircle(at.x, at.y, 7 * ART_SCALE);
    g.lineStyle(2 * ART_SCALE, 0xfff3cf, 0.8);
    g.strokeCircle(at.x, at.y, 11 * ART_SCALE);
  }

  #beacon(g: Phaser.GameObjects.Graphics, x: number, y: number, height: number, color: number): void {
    prism(g, x - 0.11, y - 0.11, x + 0.11, y + 0.11, 0, height, 0x584161, 0x8e72a2);
    const at = p(x, y, height + 6);
    g.fillStyle(color, 0.18);
    g.fillCircle(at.x, at.y, 27 * ART_SCALE);
    g.fillStyle(color, 1);
    g.fillCircle(at.x, at.y, 8 * ART_SCALE);
  }

  #arch(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, color: number, accent: number): void {
    const half = width / 2;
    prism(g, x - half, y - 0.18, x - half + 0.3, y + 0.18, 0, height, color, accent);
    prism(g, x + half - 0.3, y - 0.18, x + half, y + 0.18, 0, height, color, accent);
    prism(g, x - half, y - 0.2, x + half, y + 0.2, height - 12, 14, color, accent);
  }

  #coin(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number): void {
    const at = p(x, y, 5);
    g.fillStyle(0x6d4d62, 0.9);
    g.fillEllipse(at.x + 5, at.y + 8, size, size * 0.34);
    g.fillStyle(color, 1);
    g.fillEllipse(at.x, at.y, size, size * 0.34);
    g.lineStyle(2 * ART_SCALE, 0xfff1cc, 0.8);
    g.strokeEllipse(at.x, at.y, size * 0.68, size * 0.2);
  }

  #banner(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    const foot = p(x, y);
    const top = p(x, y, 105);
    line(g, foot, top, 0x4b354f, 2.5);
    fan(g, color, [top, { x: top.x + 58, y: top.y + 16 }, { x: top.x, y: top.y + 37 }]);
  }

  #relay(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    prism(g, x - 0.5, y - 0.5, x + 0.5, y + 0.5, 0, 32, 0x536b78, 0x9bbccb);
    const at = p(x, y, 70);
    line(g, p(x, y, 32), at, 0x344754, 3);
    g.fillStyle(color, 0.85);
    g.fillEllipse(at.x, at.y, 92, 36);
    g.fillStyle(0xdff8ff, 0.75);
    g.fillEllipse(at.x, at.y - 4, 58, 18);
  }

  #rock(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number): void {
    const foot = p(x, y);
    fan(g, color, [{ x: foot.x - size, y: foot.y }, { x: foot.x + size, y: foot.y }, { x: foot.x + size * 0.45, y: foot.y - size * 0.9 }, { x: foot.x - size * 0.35, y: foot.y - size * 0.7 }]);
    fan(g, darken(color, 22), [{ x: foot.x + size, y: foot.y }, { x: foot.x + size * 0.45, y: foot.y - size * 0.9 }, { x: foot.x, y: foot.y - size * 0.5 }]);
  }

  #coral(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    const foot = p(x, y);
    line(g, foot, { x: foot.x - 8, y: foot.y - 72 }, color, 5);
    line(g, { x: foot.x - 5, y: foot.y - 38 }, { x: foot.x + 24, y: foot.y - 58 }, color, 4);
    line(g, { x: foot.x - 7, y: foot.y - 50 }, { x: foot.x - 32, y: foot.y - 65 }, color, 3.5);
    g.fillStyle(color, 0.2);
    g.fillCircle(foot.x - 8, foot.y - 48, 28);
  }

  #tree(g: Phaser.GameObjects.Graphics, x: number, y: number, scale: number, color: number): void {
    const at = p(x, y);
    g.fillStyle(0x704838, 1);
    g.fillRect(at.x - 4 * scale, at.y - 7 * scale, 8 * scale, 30 * scale);
    g.fillStyle(darken(color, 12), 1);
    g.fillTriangle(at.x, at.y - 86 * scale, at.x - 34 * scale, at.y - 8 * scale, at.x + 34 * scale, at.y - 8 * scale);
    g.fillStyle(color, 1);
    g.fillTriangle(at.x, at.y - 110 * scale, at.x - 26 * scale, at.y - 42 * scale, at.x + 26 * scale, at.y - 42 * scale);
  }

  #lamp(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    const foot = p(x, y);
    const top = { x: foot.x, y: foot.y - 48 };
    line(g, foot, top, 0x4f394e, 2);
    g.fillStyle(color, 0.12);
    g.fillCircle(top.x, top.y, 30);
    g.fillStyle(color, 1);
    g.fillCircle(top.x, top.y, 6);
  }

  #drawLandmark(g: Phaser.GameObjects.Graphics, theme: (typeof THEMES)[PreviewIslandId]): void {
    switch (this.#island) {
      case 'mint':
        // The mint vault, with two seal towers and a blind-signing pavilion.
        prism(g, 7.5, 6.6, 12.5, 9.5, 0, 78, 0xf2d5ae, 0xffebc7);
        fan(g, 0x8d6bc8, [p(7.1, 6.2, 78), p(12.9, 6.2, 78), p(12.9, 9.9, 78), p(10, 8, 142)]);
        fan(g, 0x7150af, [p(12.9, 9.9, 78), p(7.1, 9.9, 78), p(10, 8, 142)]);
        this.#door(g, 10, 9.52, 54, theme.accent);
        for (const x of [7, 13]) {
          prism(g, x - 0.55, 8.6, x + 0.55, 9.7, 0, 98, 0xe8c99f, 0xb18ddd);
          this.#beacon(g, x, 9.15, 105, theme.accent);
        }
        this.#arch(g, 5.1, 10.2, 2.6, 70, 0xf3d9b1, theme.accent);
        for (const [x, y, size] of [[14.1, 9.6, 58], [14.8, 10.3, 45], [13.8, 10.8, 38]] as const) this.#coin(g, x, y, size, theme.accent);
        this.#seal(g, 10, 10.4, theme.accent, 66);
        break;
      case 'signing':
        // A long open signing hall: four lit keys frame the shared threshold table.
        prism(g, 6.6, 6.9, 13.4, 9.8, 0, 54, 0xe8c58a, 0xffe6ae);
        fan(g, 0x6f507f, [p(6.2, 6.5, 54), p(13.8, 6.5, 54), p(13.8, 10.2, 54), p(10, 8.3, 112)]);
        fan(g, 0x513862, [p(13.8, 10.2, 54), p(6.2, 10.2, 54), p(10, 8.3, 112)]);
        for (const x of [7.1, 9, 11, 12.9]) this.#beacon(g, x, 10.1, 72, x === 12.9 ? 0xff8a9a : theme.accent);
        prism(g, 8.1, 9.2, 11.9, 10.5, 0, 20, 0x7c5666, 0xf4d49c);
        line(g, p(8.6, 9.5, 35), p(12.8, 6.4, 170), theme.accent, 6);
        fan(g, 0xfff1c9, [p(12.8, 6.4, 170), p(12.3, 6.6, 145), p(13.3, 6.1, 155)]);
        this.#arch(g, 4.7, 10.5, 2.4, 64, 0xe3c382, 0xffe0a0);
        this.#arch(g, 13.2, 10.5, 2.4, 64, 0xe3c382, 0xffe0a0);
        break;
      case 'council':
        // A circular open-air council with nine seats, three banners, and the rotation seal.
        this.#surface(g, 10, 9, 500, 185, 0x7656a5, 0.7);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const x = 10 + Math.cos(a) * 4.2;
          const y = 9 + Math.sin(a) * 3.2;
          prism(g, x - 0.42, y - 0.42, x + 0.42, y + 0.42, 0, 30, 0x4f385f, i % 3 === 0 ? 0xffd27a : 0xd2b2ff);
        }
        this.#seal(g, 10, 9, theme.accent, 110);
        for (const [x, y, color] of [[5.2, 7.7, 0x5fd3b0], [14.8, 7.7, 0xff8a9a], [10, 5.1, 0xffd27a]] as const) this.#banner(g, x, y, color);
        this.#arch(g, 8.7, 13.2, 2.6, 68, 0x8062a0, theme.accent);
        break;
      case 'watchtower':
        // The central watchtower and two relay outposts joined by visible signal lines.
        prism(g, 8.8, 7.5, 11.2, 9.9, 0, 175, 0xd8c7b3, 0xbde7ff);
        prism(g, 8.1, 6.8, 11.9, 10.6, 175, 24, 0x456b89, 0x7fc8ff);
        fan(g, theme.accent, [p(7.9, 6.6, 199), p(12.1, 6.6, 199), p(10, 8.2, 260)]);
        line(g, p(10, 8.2, 260), p(10, 8.2, 315), 0xffe9b0, 3);
        this.#relay(g, 5.2, 10.4, 0x5fd3b0);
        this.#relay(g, 14.8, 10.4, 0xff8a9a);
        line(g, p(5.2, 10.4, 86), p(9, 8.7, 155), theme.accent, 3, 0.85);
        line(g, p(11, 8.7, 155), p(14.8, 10.4, 86), theme.accent, 3, 0.85);
        for (const [x, y] of [[6.6, 6.8], [13.5, 7.1], [7, 12.8], [13.3, 12.5]] as const) this.#rock(g, x, y, 34, 0x65788a);
        break;
      case 'reef':
        // A shallow reef lagoon with coral routes and a Lightning gateway arch.
        this.#surface(g, 10, 8.8, 650, 235, 0x2388b3, 0.9);
        this.#surface(g, 10, 8.8, 520, 170, 0x73d9d4, 0.45);
        this.#arch(g, 8.2, 8.5, 3.6, 115, 0x3b6991, theme.accent);
        line(g, p(9.1, 8.5, 120), p(11, 7.6, 205), theme.accent, 7);
        line(g, p(11, 7.6, 205), p(10.2, 8.5, 205), theme.accent, 7);
        line(g, p(10.2, 8.5, 205), p(12.2, 7.9, 275), theme.accent, 7);
        for (const [x, y, color] of [[6, 8, 0xff718b], [13.8, 8.7, 0xffb15c], [7.2, 11.4, 0xa983ff], [13.2, 11.8, 0x5fd3b0], [10.5, 12.5, 0xff718b]] as const) this.#coral(g, x, y, color);
        for (const [x, y] of [[5.4, 12.3], [14.7, 12.4], [5.7, 6.7], [14.4, 6.8]] as const) this.#rock(g, x, y, 28, 0x437a8c);
        break;
    }
  }

  #seal(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, radius = 78): void {
    const at = p(x, y, 4);
    g.fillStyle(0x4b3760, 0.7);
    g.fillEllipse(at.x, at.y, radius * 2, radius * 0.72);
    g.lineStyle(5 * ART_SCALE, color, 1);
    g.strokeEllipse(at.x, at.y, radius * 1.6, radius * 0.55);
    g.strokeEllipse(at.x, at.y, radius * 0.65, radius * 0.23);
  }

  #addDetails(g: Phaser.GameObjects.Graphics, theme: (typeof THEMES)[PreviewIslandId]): void {
    const treeColor = this.#island === 'watchtower' ? 0x365e68 : this.#island === 'reef' ? 0x287a69 : 0x4b744c;
    for (const [x, y, scale] of [[4.2, 9, 1], [5.5, 13, 0.8], [14.7, 6.5, 0.85], [15.7, 12.5, 1.05], [4.8, 6.8, 0.65]] as const) this.#tree(g, x, y, scale, treeColor);
    for (const [x, y] of [[7.2, 13.4], [12.8, 13.2], [4.6, 11.7], [15.3, 9]] as const) this.#lamp(g, x, y, theme.accent);
    const glow = p(10, 9, 20);
    g.fillStyle(theme.accent, 0.13);
    g.fillCircle(glow.x, glow.y, 135);
  }
}
