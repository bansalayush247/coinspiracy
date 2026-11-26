// Port Concord in Phaser. The ground and props stream in by chunk around the camera and are dropped far away,
// so a city many times the size of a match map costs about the same to draw.
import Phaser from 'phaser';
import { TICK_SECONDS, tileAt, type Vec2 } from '@byzantine-council/shared';
import { canStand } from '@byzantine-council/shared/pathfinding';
import { CHUNK, CITY_BUILDINGS, CITY_DISTRICTS, CITY_HEIGHT, CITY_MAP, CITY_SPAWNS, CITY_WIDTH, DUMP_START, MAX_HEALTH, VAULT_DOOR, chunksAround, inSight, type CityBuilding, type CityCar, type CityDrop, type CityPlayer, type PunchLine } from '@byzantine-council/shared/city';
import { audio } from '../audio/engine.js';
import { Effects } from '../game/effects.js';
import { GUARDIAN_HEIGHT, NO_WEAR, drawGuardian, drawShadow, type Wear } from '../game/guardianArt.js';
import { fairZoom, sceneDpr, viewSize } from '../game/hidpi.js';
import { INTERP_DELAY_MS, InterpBuffer, lerpFactor } from '../game/interpolation.js';
import { ART_SCALE, TILE_H, isoDepth, screenToWorld, worldToScreen } from '../game/iso.js';
import { COLORS, cssColor, seatColors } from '../game/palette.js';
import { PhysicsFx, makeFxTextures } from '../game/physics.js';
import { CorrectionSmoother, Predictor, type PendingInput } from '../game/prediction.js';
import { Townsfolk } from '../game/townsfolk.js';
import { MissionView } from './missionView.js';
import { CAR_COLORS, Traffic, drawDrivenCar } from './traffic.js';
import { Vision } from './vision.js';
import { buildingFront, drawBuilding, drawContainer, drawMound, drawStreetLamp, drawStreetTree, makeCoinTexture, paintChunk } from './cityArt.js';

export const CITY_SCENE_KEY = 'city';
const STEP_MS = TICK_SECONDS * 1000;
const BASE_ZOOM = 0.72;
const COIN = 'city-coin';
const GHOST = { lit: 0xffd27a, shadow: 0xffb347, highlight: 0xfff1c9 };
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
  readonly bubble: Phaser.GameObjects.Graphics;
  readonly bar: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  // An outline drawn over everything, shown while a building or prop hides this guardian from the camera.
  readonly ghost: Phaser.GameObjects.Graphics;
  ghostFacing: 0 | 1 | -1;
  stars: Phaser.GameObjects.Text | null;
  health: number;
  down: boolean;
  shielded: boolean;
  lunge: number;
  readonly buffer: InterpBuffer;
  readonly isMe: boolean;
  readonly npc: boolean;
  inCar: boolean;
  readonly pos: { x: number; y: number };
  seat: number;
  wear: Wear;
  facing: 1 | -1;
  lastScreenX: number;
  hop: number;
  hopV: number;
}

interface DrivenCar {
  readonly g: Phaser.GameObjects.Graphics;
  readonly buffer: InterpBuffer;
  readonly pos: { x: number; y: number };
  heading: number;
  target: number;
  drawn: number;
  readonly color: number;
  driver: string;
}

interface Pile {
  readonly c: Phaser.GameObjects.Container;
  readonly g: Phaser.GameObjects.Graphics;
  readonly face: Phaser.GameObjects.Image;
  readonly pos: Vec2;
  amount: number;
}

interface Wall {
  readonly g: Phaser.GameObjects.Graphics;
  readonly depth: number;
  readonly faded: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface Chunk {
  readonly ground: Phaser.GameObjects.Image;
  readonly walls: readonly Wall[];
  readonly key: string;
  readonly props: Phaser.GameObjects.GameObject[];
}

const CORNER = 1.5;

// Buildings by every chunk they touch, for depth checks near the player.
const BUILDINGS_BY_CHUNK = new Map<string, CityBuilding[]>();
for (const b of CITY_BUILDINGS) {
  for (let cy = Math.floor(Math.max(0, b.box.r0 - CORNER) / CHUNK); cy <= Math.floor((b.box.r1 + 5) / CHUNK); cy++) {
    for (let cx = Math.floor(Math.max(0, b.box.c0 - CORNER) / CHUNK); cx <= Math.floor((b.box.c1 + 5) / CHUNK); cx++) {
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
    // A margin past each front corner, so someone walking round it is not cut in half by the wall.
    const southOf = x >= c0 - CORNER && x <= c1 + 1 && y >= r1 + 1 && y <= r1 + 5;
    const eastOf = y >= r0 - CORNER && y <= r1 + 1 && x >= c1 + 1 && x <= c1 + 5;
    if (southOf || eastOf) d = Math.max(d, buildingFront(b.box) * (TILE_H / 2) + 1);
  }
  return d;
}

export class CityScene extends Phaser.Scene {
  readonly #avatars = new Map<string, Avatar>();
  readonly #chunks = new Map<string, Chunk>();
  readonly #piles = new Map<string, Pile>();
  readonly #walls = new Set<Wall>();
  readonly #cars = new Map<string, DrivenCar>();
  #driving = false;
  #following: Phaser.GameObjects.GameObject | null = null;
  #queue: string[] = [];
  #entities!: Phaser.GameObjects.Layer;
  #names!: Phaser.GameObjects.Layer;
  #ground!: Phaser.GameObjects.Layer;
  #physics!: PhysicsFx;
  #effects!: Effects;
  #townsfolk: Townsfolk | null = null;
  #mission: MissionView | null = null;
  #vision: Vision | null = null;
  #traffic: Traffic | null = null;
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

  create(data?: { mission?: boolean }): void {
    this.#reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.cameras.main.setBackgroundColor('#1d4a66');
    this.#ground = this.add.layer().setDepth(0);
    this.#entities = this.add.layer().setDepth(10);
    this.#names = this.add.layer().setDepth(20);
    makeFxTextures(this);
    makeCoinTexture(this, COIN);
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
    this.#vaultMark();
    this.#mission = data?.mission === true ? new MissionView(this, this.#entities, this.#names, sortDepth, this.#reduced) : null;
    this.#vision = new Vision(this, 5, this.#mission === null ? 0.42 : 0.6);
    this.#traffic = new Traffic(this, this.#entities, sortDepth, this.#reduced, this.#mission === null ? 44 : 12);
    // A few townsfolk wander between the city's squares and stalls; on a story night the streets are empty.
    const spots = [
      { x: 52, y: 63 }, { x: 78, y: 79 }, { x: 88, y: 47 }, { x: 57, y: 31 }, { x: 31, y: 47 }, { x: 103, y: 79 }, { x: 47, y: 90 }, { x: 74, y: 95 },
      { x: 61, y: 97 }, { x: 70, y: 66 }, { x: 95, y: 63 }, { x: 110, y: 33 }, { x: 60, y: 17 }, { x: 40, y: 64 }, { x: 118, y: 90 }, { x: 84, y: 96 },
    ].filter((p) => canStand(CITY_MAP, p));
    this.#townsfolk = this.#mission === null ? new Townsfolk(this, this.#entities, CITY_MAP, spots, 14, sortDepth) : null;
    if (import.meta.env.VITE_E2E === '1') Object.assign(window, { __bcCityPos: () => this.predictedPosition(), __bcCityChunks: () => this.#chunks.size, __bcTraffic: () => this.#traffic?.snapshot() ?? null });
    const start = this.#mission !== null ? DUMP_START : (CITY_SPAWNS[0] ?? { x: 73, y: 63 });
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
      this.#mission?.destroy();
      this.#mission = null;
      this.#vision?.destroy();
      this.#vision = null;
      this.#traffic?.destroy();
      this.#traffic = null;
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
    for (const id of [...this.#piles.keys()]) this.removeDrop(id);
    for (const id of [...this.#cars.keys()]) this.removeCar(id);
    this.#driving = false;
    this.#following = null;
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
    const bubble = new Phaser.GameObjects.Graphics(this);
    drawShield(bubble);
    const root = new Phaser.GameObjects.Container(this, 0, 0, [soft, ring, body, bubble]);
    this.#entities.add(root);
    const label = new Phaser.GameObjects.Text(this, 0, 0, p.name, {
      fontFamily: FONT, fontSize: '14px', fontStyle: '700', color: isMe ? cssColor(COLORS.gold) : p.npc ? '#ff9c85' : '#fff1de', stroke: '#2a1a33', strokeThickness: 4, resolution: Math.ceil(sceneDpr(this)),
    }).setOrigin(0.5, 1);
    this.#names.add(label);
    const bar = new Phaser.GameObjects.Graphics(this);
    this.#names.add(bar);
    const ghost = new Phaser.GameObjects.Graphics(this).setVisible(false).setBlendMode(Phaser.BlendModes.ADD).setDepth(-2);
    this.#names.add(ghost);
    const avatar: Avatar = {
      root, body, bubble, bar, label, ghost, ghostFacing: 0, stars: null, health: MAX_HEALTH, down: false, shielded: false, lunge: 0,
      buffer: new InterpBuffer(), isMe, npc: p.npc, inCar: false, pos: { x: p.x, y: p.y }, seat: p.seat, wear, facing: 1, lastScreenX: 0, hop: 0, hopV: 0,
    };
    this.#setFight(avatar, p);
    this.#seat(avatar, p.car);
    avatar.buffer.push(performance.now(), p.x, p.y);
    this.#avatars.set(id, avatar);
    if (isMe) {
      this.#predictor = new Predictor({ x: p.x, y: p.y }, CITY_MAP);
      this.#prev = { x: p.x, y: p.y };
      this.#acc = 0;
      this.cameras.main.startFollow(root, false, 0.12, 0.12);
      this.#following = root;
    }
  }

  // A guardian in a car is drawn as the car: their body and name are hidden until they get out.
  #seat(a: Avatar, car: string): void {
    const inCar = car !== '';
    if (a.inCar === inCar) return;
    a.inCar = inCar;
    a.root.setVisible(!inCar);
    a.label.setVisible(!inCar);
    if (inCar) a.bar.setVisible(false);
  }

  // While this client drives, its walking input stops; the controller sends driving input instead.
  set driving(on: boolean) {
    this.#driving = on;
  }

  addCar(id: string, car: CityCar): void {
    if (this.#cars.has(id)) return;
    const g = new Phaser.GameObjects.Graphics(this);
    this.#entities.add(g);
    const color = CAR_COLORS[car.color % CAR_COLORS.length] ?? 0xd9534f;
    const entry: DrivenCar = { g, buffer: new InterpBuffer(), pos: { x: car.x, y: car.y }, heading: car.heading, target: car.heading, drawn: car.heading, color, driver: car.driver };
    entry.buffer.push(performance.now(), car.x, car.y);
    drawDrivenCar(g, car.heading, color, car.driver !== '');
    this.#cars.set(id, entry);
  }

  updateCar(id: string, car: CityCar): void {
    const c = this.#cars.get(id);
    if (c === undefined) return;
    c.buffer.push(performance.now(), car.x, car.y);
    c.target = car.heading;
    if (c.driver !== car.driver) {
      c.driver = car.driver;
      drawDrivenCar(c.g, c.heading, c.color, car.driver !== '');
    }
  }

  removeCar(id: string): void {
    this.#cars.get(id)?.g.destroy();
    this.#cars.delete(id);
  }

  // Whether a parked car is close enough to get into.
  freeCarNear(at: Vec2, range: number): boolean {
    for (const c of this.#cars.values()) if (c.driver === '' && Math.hypot(c.pos.x - at.x, c.pos.y - at.y) <= range) return true;
    return false;
  }

  #placeCars(renderTime: number): void {
    for (const c of this.#cars.values()) {
      if (c.buffer.sample(renderTime, this.#tmp)) {
        c.pos.x = this.#tmp.x;
        c.pos.y = this.#tmp.y;
      }
      const turn = Math.atan2(Math.sin(c.target - c.heading), Math.cos(c.target - c.heading));
      c.heading += turn * 0.35;
      if (Math.abs(Math.atan2(Math.sin(c.heading - c.drawn), Math.cos(c.heading - c.drawn))) > 0.04) {
        c.drawn = c.heading;
        drawDrivenCar(c.g, c.heading, c.color, c.driver !== '');
      }
      const s = worldToScreen(c.pos.x, c.pos.y);
      c.g.setPosition(s.x, s.y).setDepth(sortDepth(c.pos.x, c.pos.y));
    }
    if (this.#myId === null) return;
    const myCar = [...this.#cars.values()].find((c) => c.driver === this.#myId);
    const want = myCar?.g ?? this.#avatars.get(this.#myId)?.root ?? null;
    if (want !== null && want !== this.#following) {
      this.cameras.main.startFollow(want, false, 0.12, 0.12);
      this.#following = want;
    }
  }

  updatePlayer(id: string, p: CityPlayer): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    if (a.wear.hat !== p.hat || a.wear.shades !== p.shades || a.wear.outfit !== p.outfit || a.seat !== p.seat) {
      a.wear = { hat: p.hat, shades: p.shades, outfit: p.outfit };
      a.seat = p.seat;
      a.ghostFacing = 0;
      drawGuardian(a.body, seatColors(a.seat), a.facing, a.wear);
    }
    this.#setFight(a, p);
    this.#seat(a, p.car);
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
    a.bar.destroy();
    a.ghost.destroy();
    a.stars?.destroy();
    this.#avatars.delete(id);
  }

  // Whether this client's guardian is knocked out, so the controller can hold back input.
  get meDown(): boolean {
    const me = this.#myId === null ? undefined : this.#avatars.get(this.#myId);
    return me?.down ?? false;
  }

  #setFight(a: Avatar, p: CityPlayer): void {
    const changed = a.health !== p.health;
    a.health = p.health;
    a.shielded = p.shielded;
    a.bubble.setVisible(p.shielded);
    if (a.down !== p.down) {
      a.down = p.down;
      a.body.setAngle(p.down ? (a.facing === 1 ? -82 : 82) : 0);
      a.stars?.destroy();
      a.stars = null;
      if (p.down) {
        a.stars = this.add.text(0, 0, '★ ★ ★', { fontFamily: FONT, fontSize: '20px', color: '#ffd27a', stroke: '#2a1a33', strokeThickness: 4 }).setOrigin(0.5).setDepth(30);
        this.#names.add(a.stars);
        if (!this.#reduced) this.tweens.add({ targets: a.stars, angle: 360, duration: 1400, repeat: -1 });
      }
    }
    if (changed || p.down) drawHealth(a.bar, a.health, a.down);
    a.bar.setVisible(a.health < MAX_HEALTH && !a.down);
  }

  // A swing: the attacker lunges toward the target, and a hit lands with a star burst, or a whoosh if it misses.
  punch(line: PunchLine): void {
    const from = this.#avatars.get(line.from);
    if (from === undefined) return;
    const to = line.to === null ? undefined : this.#avatars.get(line.to);
    if (to !== undefined) {
      const dir = to.pos.x - to.pos.y > from.pos.x - from.pos.y ? 1 : -1;
      if (dir !== from.facing) {
        from.facing = dir;
        drawGuardian(from.body, seatColors(from.seat), dir, from.wear);
      }
    }
    from.lunge = this.#reduced ? 0 : 9 * ART_SCALE * from.facing;
    if (to === undefined) {
      audio.play('whiff');
      return;
    }
    audio.play(line.knockedOut ? 'knockout' : 'punch');
    const at = worldToScreen(to.pos.x, to.pos.y);
    const word = line.knockedOut ? 'KO!' : (['POW!', 'BIFF!', 'BONK!', 'WHAP!'][Math.floor(Math.random() * 4)] ?? 'POW!');
    const pop = this.add
      .text(at.x, at.y - GUARDIAN_HEIGHT * 0.6, word, { fontFamily: FONT, fontSize: line.knockedOut ? '40px' : '28px', fontStyle: '900', color: line.knockedOut ? '#ff6b4a' : '#ffd27a', stroke: '#2a1a33', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(31)
      .setScale(0.3 / (this.cameras.main.zoom / sceneDpr(this)))
      .setAngle(Phaser.Math.Between(-14, 14));
    this.tweens.add({ targets: pop, scale: 1 / (this.cameras.main.zoom / sceneDpr(this)), duration: this.#reduced ? 1 : 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: pop, alpha: 0, y: pop.y - 24, delay: 450, duration: 350, onComplete: () => {
      pop.destroy();
    } });
    if (!this.#reduced) {
      to.hopV = line.knockedOut ? 260 : 120;
      if (line.knockedOut) this.#effects.ring(to.pos, 0xffd27a, 1.2, 500);
      if (to.isMe) this.cameras.main.shake(line.knockedOut ? 260 : 90, line.knockedOut ? 0.012 : 0.004);
    }
  }

  addDrop(id: string, drop: CityDrop): void {
    const g = new Phaser.GameObjects.Graphics(this);
    const face = new Phaser.GameObjects.Image(this, 0, 0, COIN).setDisplaySize(15 * ART_SCALE, 15 * ART_SCALE);
    const s = worldToScreen(drop.x, drop.y);
    const c = new Phaser.GameObjects.Container(this, s.x, s.y, [g, face]).setDepth(sortDepth(drop.x, drop.y) - 0.5);
    const pile: Pile = { c, g, face, pos: { x: drop.x, y: drop.y }, amount: drop.amount };
    drawPile(g, face, drop.amount);
    this.#entities.add(c);
    this.#piles.set(id, pile);
    if (!this.#reduced) {
      c.setScale(0.2);
      this.tweens.add({ targets: c, scale: 1, duration: 260, ease: 'Back.easeOut' });
    }
  }

  updateDrop(id: string, drop: CityDrop): void {
    const pile = this.#piles.get(id);
    if (pile === undefined || pile.amount === drop.amount) return;
    pile.amount = drop.amount;
    drawPile(pile.g, pile.face, drop.amount);
  }

  removeDrop(id: string): void {
    const pile = this.#piles.get(id);
    if (pile === undefined) return;
    pile.c.destroy();
    this.#piles.delete(id);
  }

  // The story overlay, when this scene was launched for a mission.
  get mission(): MissionView | null {
    return this.#mission;
  }

  predictedPosition(): Vec2 | null {
    return this.#predictor === null ? null : { ...this.#predictor.position };
  }

  // Positions of the other guardians this client can see, for the minimap.
  others(): (Vec2 & { npc: boolean })[] {
    return [...this.#avatars.values()].filter((a) => !a.isMe).map((a) => ({ x: a.pos.x, y: a.pos.y, npc: a.npc }));
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
    this.#placeCars(renderTime);
    this.#seeThrough(delta);
    const eye = this.predictedPosition();
    this.#vision?.update(eye);
    const sees = (p: Vec2): boolean => eye === null || inSight(eye, p);
    this.#townsfolk?.cull(sees);
    this.#traffic?.update(time, delta, [...[...this.#avatars.values()].map((a) => a.pos), ...[...this.#cars.values()].map((c) => c.pos), ...(this.#townsfolk?.positions() ?? [])], sees);
    this.#mission?.update(time, eye);
    const k = lerpFactor(0.12, delta);
    this.cameras.main.setLerp(k, k);
  }

  // Fades whatever is drawn in front of this client's guardian or anyone watching with a sight cone, and outlines any guardian the camera can't see
  // behind a building or prop, so nobody is ever lost behind a tower, a tree or a stack of crates.
  #seeThrough(delta: number): void {
    const k = Math.min(1, delta / 120);
    const fade = new Set<Wall>();
    for (const a of this.#avatars.values()) {
      const s = worldToScreen(a.pos.x, a.pos.y, this.#tmp);
      const depth = sortDepth(a.pos.x, a.pos.y);
      let covered = false;
      for (const w of this.#walls) {
        if (!hides(w, s, depth)) continue;
        covered = true;
        if (a.isMe) fade.add(w);
        else break;
      }
      this.#outline(a, covered && !a.down && !a.inCar);
    }
    for (const p of this.#mission?.watchers() ?? []) {
      const s = worldToScreen(p.x, p.y, this.#tmp);
      const depth = sortDepth(p.x, p.y);
      for (const w of this.#walls) {
        if (!hides(w, s, depth)) continue;
        fade.add(w);
      }
    }
    for (const w of this.#walls) {
      const target = fade.has(w) ? w.faded : 1;
      if (w.g.alpha !== target) w.g.setAlpha(Math.abs(w.g.alpha - target) < 0.02 ? target : w.g.alpha + (target - w.g.alpha) * k);
    }
  }

  #outline(a: Avatar, show: boolean): void {
    if (a.ghost.visible !== show) a.ghost.setVisible(show);
    if (!show) return;
    if (a.ghostFacing !== a.facing) {
      a.ghostFacing = a.facing;
      const c = a.isMe ? GHOST : seatColors(a.seat);
      drawGuardian(a.ghost, { lit: c.highlight, shadow: c.lit, highlight: 0xffffff }, a.facing, NO_WEAR);
    }
    a.ghost.setPosition(a.root.x, a.root.y + a.body.y).setAlpha(this.#reduced ? 0.55 : 0.4 + 0.15 * Math.sin(this.time.now / 240));
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
    const walls: Wall[] = [];
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
      const depth = buildingFront(b.box) * (TILE_H / 2);
      const g = add(depth, (gr) => {
        drawBuilding(gr, b);
      });
      const { c0, r0, c1, r1 } = b.box;
      const wall: Wall = {
        g,
        depth,
        faded: 0.18,
        left: worldToScreen(c0, r1 + 1).x,
        right: worldToScreen(c1 + 1, r0).x,
        top: worldToScreen(c0, r0).y - (b.height + 120) * ART_SCALE,
        bottom: worldToScreen(c1 + 1, r1 + 1).y,
      };
      walls.push(wall);
      this.#walls.add(wall);
    }
    for (let r = cy * CHUNK; r < (cy + 1) * CHUNK; r++) {
      for (let c = cx * CHUNK; c < (cx + 1) * CHUNK; c++) {
        const t = tileAt(CITY_MAP, c, r);
        const depth = sortDepth(c + 0.5, r + 0.5);
        const seed = c * 31 + r * 17;
        const foot = worldToScreen(c + 0.5, r + 0.5);
        const prop = (g: Phaser.GameObjects.Graphics, half: number, height: number): void => {
          const wall: Wall = { g, depth, faded: 0.3, left: foot.x - half * ART_SCALE, right: foot.x + half * ART_SCALE, top: foot.y - height * ART_SCALE, bottom: foot.y + (TILE_H / 2) };
          walls.push(wall);
          this.#walls.add(wall);
        };
        if (t === 'T') {
          prop(add(depth, (g) => {
            drawStreetTree(g, seed);
          }, foot.x, foot.y), 34, 90);
        } else if (t === 'L') {
          add(depth, (g) => {
            drawStreetLamp(g, c, r);
          });
        } else if (t === 'C') {
          prop(add(depth, (g) => {
            drawContainer(g, c, r, seed);
          }), 34, 90);
        } else if (t === 'M') {
          prop(add(depth, (g) => {
            drawMound(g, c, r, seed);
          }), 42, 56);
        }
      }
    }
    this.#chunks.set(key, { ground, walls, key: painted.key, props });
  }

  #unload(key: string): void {
    const chunk = this.#chunks.get(key);
    if (chunk === undefined) return;
    chunk.ground.destroy();
    for (const w of chunk.walls) this.#walls.delete(w);
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
      if (Math.hypot(dir.x, dir.y) < 0.01 || sink === null || !sink.canSend || p.stalled || this.meDown || this.#driving) continue;
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
    a.lunge *= 0.8;
    if (Math.abs(a.lunge) < 0.1) a.lunge = 0;
    a.root.setPosition(s.x + a.lunge, s.y);
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
    a.bar.setScale(1 / zoom).setPosition(s.x, s.y - GUARDIAN_HEIGHT - 2 * ART_SCALE);
    a.stars?.setScale(1 / zoom).setPosition(s.x, s.y - GUARDIAN_HEIGHT * 0.55);
    a.bubble.setAlpha(this.#reduced ? 0.5 : 0.35 + Math.sin(time / 260) * 0.15);
  }

  #applyZoom(): void {
    const { w, h } = viewSize(this);
    this.cameras.main.setZoom(sceneDpr(this) * fairZoom(w, h) * BASE_ZOOM * this.#userZoom);
  }

  // A pulsing gold ring on the street at the Mint Hall door, where pockets go into the vault.
  #vaultMark(): void {
    const s = worldToScreen(VAULT_DOOR.x, VAULT_DOOR.y);
    const g = this.add.graphics().setPosition(s.x, s.y).setDepth(sortDepth(VAULT_DOOR.x, VAULT_DOOR.y) - 1);
    this.#entities.add(g);
    const w = 3 * 64 * ART_SCALE;
    g.fillStyle(0xffd27a, 0.22);
    g.fillEllipse(0, 0, w, w / 2);
    g.lineStyle(3 * ART_SCALE, 0xffd27a, 0.9);
    g.strokeEllipse(0, 0, w, w / 2);
    g.lineStyle(2 * ART_SCALE, 0xfff6e6, 0.7);
    g.strokeEllipse(0, 0, w * 0.7, w * 0.35);
    const label = this.add
      .text(s.x, s.y + w / 4 + 10 * ART_SCALE, 'VAULT', { fontFamily: FONT, fontSize: '22px', fontStyle: '900', color: '#ffd27a', stroke: '#2a1a33', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(6);
    this.#names.add(label);
    if (!this.#reduced) this.tweens.add({ targets: g, alpha: 0.55, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  // The visual feedback hook the controller uses for small celebrations.
  celebrate(at: Vec2): void {
    this.#effects.taskDone(at, 0xffd27a);
  }
}

function drawShield(g: Phaser.GameObjects.Graphics): void {
  g.clear();
  g.fillStyle(0x7fe0ff, 0.18);
  g.fillEllipse(0, -GUARDIAN_HEIGHT * 0.45, 34 * ART_SCALE, GUARDIAN_HEIGHT * 1.15);
  g.lineStyle(2 * ART_SCALE, 0xbff1ff, 0.8);
  g.strokeEllipse(0, -GUARDIAN_HEIGHT * 0.45, 34 * ART_SCALE, GUARDIAN_HEIGHT * 1.15);
}

// A short bar above the head, in screen pixels: green when healthy, amber, then red.
function drawHealth(g: Phaser.GameObjects.Graphics, health: number, down: boolean): void {
  const w = 44;
  const k = down ? 0 : Math.max(0, Math.min(1, health / MAX_HEALTH));
  g.clear();
  g.fillStyle(0x2a1a33, 0.85);
  g.fillRoundedRect(-w / 2 - 2, -6, w + 4, 8, 3);
  g.fillStyle(k > 0.6 ? 0x5fd38a : k > 0.3 ? 0xffb347 : 0xff5a4a, 1);
  g.fillRoundedRect(-w / 2, -4, Math.max(2, w * k), 4, 2);
}

// A pile of gold coins whose height grows with the amount, topped by one standing ₿ coin.
function drawPile(g: Phaser.GameObjects.Graphics, face: Phaser.GameObjects.Image, amount: number): void {
  const stacks = amount >= 500 ? 5 : amount >= 100 ? 3 : amount >= 30 ? 2 : 1;
  const height = Math.min(6, 1 + Math.floor(Math.log2(Math.max(1, amount)) / 2));
  const spots = [[0, 0], [-7, 3], [7, 3], [-4, -3], [5, -4]];
  g.clear();
  g.fillStyle(0x2a1a33, 0.25);
  g.fillEllipse(0, 2 * ART_SCALE, 26 * ART_SCALE, 9 * ART_SCALE);
  for (let i = 0; i < stacks; i++) {
    const [sx = 0, sy = 0] = spots[i] ?? [];
    const levels = Math.max(1, height - i);
    for (let l = 0; l < levels; l++) {
      const x = sx * ART_SCALE;
      const y = (sy - l * 2.4) * ART_SCALE;
      g.fillStyle(0xb8862f, 1);
      g.fillEllipse(x, y + 1.2 * ART_SCALE, 9 * ART_SCALE, 4 * ART_SCALE);
      g.fillStyle(0xffd27a, 1);
      g.fillEllipse(x, y, 9 * ART_SCALE, 4 * ART_SCALE);
    }
  }
  face.setPosition(2 * ART_SCALE, -((height - 1) * 2.4 + 6.5) * ART_SCALE);
}

// Whether a wall is drawn over a guardian standing at screen point `s` with sort depth `depth`.
function hides(w: Wall, s: { x: number; y: number }, depth: number): boolean {
  return w.depth > depth && s.x > w.left - 14 * ART_SCALE && s.x < w.right + 14 * ART_SCALE && s.y - GUARDIAN_HEIGHT < w.bottom && s.y > w.top;
}
