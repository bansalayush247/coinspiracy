// Port Concord in Phaser. The ground and props stream in by chunk around the camera and are dropped far away,
// so a city many times the size of a match map costs about the same to draw.
import Phaser from 'phaser';
import { TICK_SECONDS, tileAt, type Vec2 } from '@byzantine-council/shared';
import { CHUNK, CITY_BUILDINGS, CITY_DISTRICTS, CITY_HEIGHT, CITY_MAP, CITY_SPAWNS, CITY_WIDTH, chunksAround, type CityBuilding, type CityPlayer } from '@byzantine-council/shared/city';
import { Effects } from '../game/effects.js';
import { GUARDIAN_HEIGHT, drawGuardian, drawShadow, type Wear } from '../game/guardianArt.js';
import { fairZoom, sceneDpr, viewSize } from '../game/hidpi.js';
import { INTERP_DELAY_MS, InterpBuffer, lerpFactor } from '../game/interpolation.js';
import { ART_SCALE, TILE_H, isoDepth, screenToWorld, worldToScreen } from '../game/iso.js';
import { COLORS, cssColor, seatColors } from '../game/palette.js';
import { PhysicsFx, makeFxTextures } from '../game/physics.js';
import { CorrectionSmoother, Predictor, type PendingInput } from '../game/prediction.js';
import { Townsfolk } from '../game/townsfolk.js';
import { buildingFront, drawBuilding, drawContainer, drawMound, drawStreetLamp, drawStreetTree, paintChunk } from './cityArt.js';

export const CITY_SCENE_KEY = 'city';
const STEP_MS = TICK_SECONDS * 1000;
const BASE_ZOOM = 0.72;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
// Chunks are painted within LOAD of the camera and dropped beyond KEEP.
const LOAD = 2;
const KEEP = 3;

export interface CityInput {
  direction(): Vec2;
}
export interface CitySink {
  readonly canSend: boolean;
  send(input: PendingInput): void;
}

interface Avatar {
  readonly root: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  readonly buffer: InterpBuffer;
  readonly isMe: boolean;
  readonly pos: { x: number; y: number };
  seat: number;
  wear: Wear;
  facing: 1 | -1;
  lastScreenX: number;
  hop: number;
  hopV: number;
}

interface Chunk {
  readonly ground: Phaser.GameObjects.Image;
  readonly key: string;
  readonly props: Phaser.GameObjects.GameObject[];
}

// Buildings by every chunk they touch, for depth checks near the player.
const BUILDINGS_BY_CHUNK = new Map<string, CityBuilding[]>();
for (const b of CITY_BUILDINGS) {
  for (let cy = Math.floor(b.box.r0 / CHUNK); cy <= Math.floor((b.box.r1 + 5) / CHUNK); cy++) {
    for (let cx = Math.floor(b.box.c0 / CHUNK); cx <= Math.floor((b.box.c1 + 5) / CHUNK); cx++) {
      const key = `${String(cx)},${String(cy)}`;
      const list = BUILDINGS_BY_CHUNK.get(key) ?? [];
      list.push(b);
      BUILDINGS_BY_CHUNK.set(key, list);
    }
  }
}

// Depth that keeps something standing in front of a big building drawn over it: the plain painter's order
// only compares one point per footprint, which a wide building gets wrong along its front faces.
export function sortDepth(x: number, y: number): number {
  let d = isoDepth(x, y);
  const list = BUILDINGS_BY_CHUNK.get(`${String(Math.floor(x / CHUNK))},${String(Math.floor(y / CHUNK))}`) ?? [];
  for (const b of list) {
    const { c0, r0, c1, r1 } = b.box;
    const southOf = x >= c0 && x <= c1 + 1 && y >= r1 + 1 && y <= r1 + 5;
    const eastOf = y >= r0 && y <= r1 + 1 && x >= c1 + 1 && x <= c1 + 5;
    if (southOf || eastOf) d = Math.max(d, buildingFront(b.box) * (TILE_H / 2) + 1);
  }
  return d;
}

export class CityScene extends Phaser.Scene {
  readonly #avatars = new Map<string, Avatar>();
  readonly #chunks = new Map<string, Chunk>();
  #queue: string[] = [];
  #entities!: Phaser.GameObjects.Layer;
  #names!: Phaser.GameObjects.Layer;
  #ground!: Phaser.GameObjects.Layer;
  #physics!: PhysicsFx;
  #effects!: Effects;
  #townsfolk: Townsfolk | null = null;
  #reduced = false;
  #myId: string | null = null;
  #predictor: Predictor | null = null;
  #smoother = new CorrectionSmoother();
  #prev: Vec2 = { x: 0, y: 0 };
  #acc = 0;
  #input: CityInput | null = null;
  #sink: CitySink | null = null;
  #streamAt = 0;
  #userZoom = 1;
  readonly #tmp = { x: 0, y: 0 };

  constructor() {
    super({ key: CITY_SCENE_KEY, active: false });
  }

  create(): void {
    this.#reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.cameras.main.setBackgroundColor('#1d4a66');
    this.#ground = this.add.layer().setDepth(0);
    this.#entities = this.add.layer().setDepth(10);
    this.#names = this.add.layer().setDepth(20);
    makeFxTextures(this);
    const sky = this.add.layer().setDepth(19);
    this.#physics = new PhysicsFx(this, this.#entities, sky);
    this.#effects = new Effects(this, this.#physics, this.#entities, this.#reduced);
    // District names painted large on the ground, readable from far out.
    for (const d of CITY_DISTRICTS) {
      const mid = worldToScreen((d.box.c0 + d.box.c1 + 1) / 2, (d.box.r0 + d.box.r1 + 1) / 2);
      const label = this.add
        .text(mid.x, mid.y, d.name.toUpperCase(), { fontFamily: FONT, fontSize: '64px', fontStyle: '800', color: '#fff6e6', stroke: '#2a1a33', strokeThickness: 8, resolution: 1 })
        .setOrigin(0.5)
        .setAlpha(0.32)
        .setDepth(5);
      this.#names.add(label);
    }
    // A few townsfolk wander between the city's squares and stalls.
    const spots = [{ x: 52, y: 63 }, { x: 78, y: 79 }, { x: 88, y: 47 }, { x: 57, y: 31 }, { x: 31, y: 47 }, { x: 103, y: 79 }, { x: 47, y: 90 }, { x: 74, y: 95 }];
    this.#townsfolk = new Townsfolk(this, this.#entities, CITY_MAP, spots, 8);
    if (import.meta.env.VITE_E2E === '1') Object.assign(window, { __bcCityPos: () => this.predictedPosition(), __bcCityChunks: () => this.#chunks.size });
    const start = CITY_SPAWNS[0] ?? { x: 73, y: 63 };
    const center = worldToScreen(start.x, start.y);
    this.cameras.main.centerOn(center.x, center.y);
    this.#applyZoom();
    this.#stream(true);
    const onResize = (): void => {
      this.#applyZoom();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      for (const key of [...this.#chunks.keys()]) this.#unload(key);
    });
  }

  attach(myId: string, input: CityInput, sink: CitySink): void {
    this.detach();
    this.#myId = myId;
    this.#input = input;
    this.#sink = sink;
  }

  detach(): void {
    for (const id of [...this.#avatars.keys()]) this.removePlayer(id);
    this.#myId = null;
    this.#predictor = null;
    this.#input = null;
    this.#sink = null;
    this.cameras.main.stopFollow();
  }

  addPlayer(id: string, p: CityPlayer): void {
    if (this.#avatars.has(id)) {
      this.updatePlayer(id, p);
      return;
    }
    const isMe = id === this.#myId;
    const soft = new Phaser.GameObjects.Image(this, 6 * ART_SCALE, 2 * ART_SCALE, 'fx-shadow').setScale(0.2, 0.2).setTint(0x3b2752).setAlpha(0.45);
    const ring = new Phaser.GameObjects.Graphics(this);
    drawShadow(ring, isMe);
    const body = new Phaser.GameObjects.Graphics(this);
    const wear: Wear = { hat: p.hat, shades: p.shades, outfit: p.outfit };
    drawGuardian(body, seatColors(p.seat), 1, wear);
    const root = new Phaser.GameObjects.Container(this, 0, 0, [soft, ring, body]);
    this.#entities.add(root);
    const label = new Phaser.GameObjects.Text(this, 0, 0, p.name, {
      fontFamily: FONT, fontSize: '14px', fontStyle: '700', color: isMe ? cssColor(COLORS.gold) : '#fff1de', stroke: '#2a1a33', strokeThickness: 4, resolution: Math.ceil(sceneDpr(this)),
    }).setOrigin(0.5, 1);
    this.#names.add(label);
    const avatar: Avatar = { root, body, label, buffer: new InterpBuffer(), isMe, pos: { x: p.x, y: p.y }, seat: p.seat, wear, facing: 1, lastScreenX: 0, hop: 0, hopV: 0 };
    avatar.buffer.push(performance.now(), p.x, p.y);
    this.#avatars.set(id, avatar);
    if (isMe) {
      this.#predictor = new Predictor({ x: p.x, y: p.y }, CITY_MAP);
      this.#prev = { x: p.x, y: p.y };
      this.#acc = 0;
      this.cameras.main.startFollow(root, false, 0.12, 0.12);
    }
  }

  updatePlayer(id: string, p: CityPlayer): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    if (a.wear.hat !== p.hat || a.wear.shades !== p.shades || a.wear.outfit !== p.outfit || a.seat !== p.seat) {
      a.wear = { hat: p.hat, shades: p.shades, outfit: p.outfit };
      a.seat = p.seat;
      drawGuardian(a.body, seatColors(a.seat), a.facing, a.wear);
    }
    if (a.isMe && this.#predictor !== null) {
      const before = this.#predictor.position;
      this.#predictor.reconcile({ x: p.x, y: p.y }, p.ack ?? 0);
      const after = this.#predictor.position;
      this.#prev = { x: this.#prev.x + after.x - before.x, y: this.#prev.y + after.y - before.y };
      this.#smoother.correct(before, after);
    } else {
      a.buffer.push(performance.now(), p.x, p.y);
    }
  }

  removePlayer(id: string): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    if (a.isMe) this.cameras.main.stopFollow();
    a.root.destroy();
    a.label.destroy();
    this.#avatars.delete(id);
  }

  predictedPosition(): Vec2 | null {
    return this.#predictor === null ? null : { ...this.#predictor.position };
  }

  // Positions of the other guardians this client can see, for the minimap.
  others(): Vec2[] {
    return [...this.#avatars.values()].filter((a) => !a.isMe).map((a) => ({ x: a.pos.x, y: a.pos.y }));
  }

  emote(id: string, glyph: string, kind: string): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    const s = worldToScreen(a.pos.x, a.pos.y);
    const bubble = this.add
      .text(s.x, s.y - GUARDIAN_HEIGHT - 34 * ART_SCALE, glyph, { fontFamily: 'system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif', fontSize: '44px', backgroundColor: '#fff6e6', padding: { x: 10, y: 6 } })
      .setOrigin(0.5, 1)
      .setDepth(30)
      .setScale(0.2);
    this.tweens.add({ targets: bubble, scale: 1 / (this.cameras.main.zoom / sceneDpr(this)), duration: this.#reduced ? 1 : 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: bubble, alpha: 0, y: bubble.y - 20, delay: 2200, duration: 500, onComplete: () => {
      bubble.destroy();
    } });
    if (!this.#reduced) a.hopV = kind === 'dance' ? 260 : 200;
  }

  zoomBy(factor: number): void {
    this.#userZoom = Phaser.Math.Clamp(this.#userZoom * factor, 0.45, 1.8);
    this.#applyZoom();
  }

  override update(time: number, delta: number): void {
    this.#stepLocal(delta);
    this.#physics.update(delta);
    this.#townsfolk?.update(time, delta, this.#reduced);
    if (time > this.#streamAt) {
      this.#streamAt = time + 200;
      this.#stream(false);
    }
    // At most one new chunk painted per frame, so walking never stutters.
    const next = this.#queue.shift();
    if (next !== undefined) this.#load(next);
    const renderTime = performance.now() - INTERP_DELAY_MS;
    for (const a of this.#avatars.values()) {
      if (a.isMe && this.#predictor !== null) {
        const alpha = this.#acc / STEP_MS;
        const cur = this.#predictor.position;
        a.pos.x = this.#prev.x + (cur.x - this.#prev.x) * alpha + this.#smoother.offset.x;
        a.pos.y = this.#prev.y + (cur.y - this.#prev.y) * alpha + this.#smoother.offset.y;
      } else if (a.buffer.sample(renderTime, this.#tmp)) {
        a.pos.x = this.#tmp.x;
        a.pos.y = this.#tmp.y;
      }
      this.#place(a, time);
    }
    const k = lerpFactor(0.12, delta);
    this.cameras.main.setLerp(k, k);
  }

  // Queues the chunks near the camera and drops the far ones.
  #stream(now: boolean): void {
    const cam = this.cameras.main;
    const mid = screenToWorld(cam.midPoint.x, cam.midPoint.y);
    const want = chunksAround(mid, LOAD, CITY_WIDTH, CITY_HEIGHT);
    this.#queue = want.filter((k) => !this.#chunks.has(k));
    if (now) for (const k of this.#queue.splice(0, 9)) this.#load(k);
    const cx = Math.floor(mid.x / CHUNK);
    const cy = Math.floor(mid.y / CHUNK);
    for (const key of [...this.#chunks.keys()]) {
      const [x = 0, y = 0] = key.split(',').map(Number);
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > KEEP) this.#unload(key);
    }
  }

  #load(key: string): void {
    if (this.#chunks.has(key)) return;
    const [cx = 0, cy = 0] = key.split(',').map(Number);
    const painted = paintChunk(this, cx, cy);
    const ground = this.add.image(painted.x, painted.y, painted.key).setOrigin(0).setScale(1 / painted.scale);
    this.#ground.add(ground);
    const props: Phaser.GameObjects.GameObject[] = [];
    const add = (depth: number, draw: (g: Phaser.GameObjects.Graphics) => void, x = 0, y = 0): Phaser.GameObjects.Graphics => {
      const g = new Phaser.GameObjects.Graphics(this);
      draw(g);
      g.setPosition(x, y).setDepth(depth);
      this.#entities.add(g);
      props.push(g);
      return g;
    };
    // A building belongs to the chunk holding its front corner, so it is drawn exactly once.
    for (const b of CITY_BUILDINGS) {
      if (Math.floor(b.box.c1 / CHUNK) !== cx || Math.floor(b.box.r1 / CHUNK) !== cy) continue;
      add(buildingFront(b.box) * (TILE_H / 2), (g) => {
        drawBuilding(g, b);
      });
    }
    for (let r = cy * CHUNK; r < (cy + 1) * CHUNK; r++) {
      for (let c = cx * CHUNK; c < (cx + 1) * CHUNK; c++) {
        const t = tileAt(CITY_MAP, c, r);
        const depth = sortDepth(c + 0.5, r + 0.5);
        const seed = c * 31 + r * 17;
        if (t === 'T') {
          const foot = worldToScreen(c + 0.5, r + 0.5);
          add(depth, (g) => {
            drawStreetTree(g, seed);
          }, foot.x, foot.y);
        } else if (t === 'L') {
          add(depth, (g) => {
            drawStreetLamp(g, c, r);
          });
        } else if (t === 'C') {
          add(depth, (g) => {
            drawContainer(g, c, r, seed);
          });
        } else if (t === 'M') {
          add(depth, (g) => {
            drawMound(g, c, r, seed);
          });
        }
      }
    }
    this.#chunks.set(key, { ground, key: painted.key, props });
  }

  #unload(key: string): void {
    const chunk = this.#chunks.get(key);
    if (chunk === undefined) return;
    chunk.ground.destroy();
    for (const p of chunk.props) p.destroy();
    if (this.textures.exists(chunk.key)) this.textures.remove(chunk.key);
    this.#chunks.delete(key);
  }

  #stepLocal(delta: number): void {
    const p = this.#predictor;
    if (p === null) return;
    this.#smoother.decay(delta);
    this.#acc = Math.min(this.#acc + delta, 250);
    while (this.#acc >= STEP_MS) {
      this.#acc -= STEP_MS;
      this.#prev = { ...p.position };
      const dir = this.#input?.direction() ?? { x: 0, y: 0 };
      const sink = this.#sink;
      if (Math.hypot(dir.x, dir.y) < 0.01 || sink === null || !sink.canSend || p.stalled) continue;
      sink.send(p.apply(Math.max(-1, Math.min(1, dir.x)), Math.max(-1, Math.min(1, dir.y))));
    }
  }

  #place(a: Avatar, time: number): void {
    const s = worldToScreen(a.pos.x, a.pos.y, this.#tmp);
    const dx = s.x - a.lastScreenX;
    const moving = Math.abs(dx) > 0.05 || Math.abs(s.y - a.root.y) > 0.05;
    if (Math.abs(dx) > 0.2) {
      const facing = dx > 0 ? 1 : -1;
      if (facing !== a.facing) {
        a.facing = facing;
        drawGuardian(a.body, seatColors(a.seat), facing, a.wear);
      }
    }
    a.lastScreenX = s.x;
    a.root.setPosition(s.x, s.y);
    if (a.hop > 0 || a.hopV > 0) {
      const dt = Math.min(this.game.loop.delta, 50) / 1000;
      a.hopV -= 980 * dt;
      a.hop = Math.max(0, a.hop + a.hopV * dt);
      if (a.hop === 0) a.hopV = 0;
    }
    a.body.y = (moving && !this.#reduced ? Math.sin(time / 90) * 1.6 * ART_SCALE : 0) - a.hop * 0.5;
    a.root.setDepth(sortDepth(a.pos.x, a.pos.y));
    const zoom = this.cameras.main.zoom / sceneDpr(this);
    a.label.setScale(1 / zoom);
    a.label.setPosition(s.x, s.y - GUARDIAN_HEIGHT - 8 * ART_SCALE);
  }

  #applyZoom(): void {
    const { w, h } = viewSize(this);
    this.cameras.main.setZoom(sceneDpr(this) * fairZoom(w, h) * BASE_ZOOM * this.#userZoom);
  }

  // The visual feedback hook the controller uses for small celebrations.
  celebrate(at: Vec2): void {
    this.#effects.taskDone(at, 0xffd27a);
  }
}
