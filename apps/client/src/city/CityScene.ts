// Port Concord in Phaser. The ground and props stream in by chunk around the camera and are dropped far away,
// so a city many times the size of a match map costs about the same to draw.
import Phaser from 'phaser';
import { PLAYER_RADIUS, TICK_SECONDS, tileAt, type Vec2 } from '@byzantine-council/shared';
import { canStand } from '@byzantine-council/shared/pathfinding';
import { BUILDING_DOORS, INTERIOR_ORIGIN, buildingName, doorBySeed, layoutFor, roomMap, type RoomSpot } from '@byzantine-council/shared/city';
import { pushClear, type CarPose, type CrowdBody } from '@byzantine-council/shared/city';
import { CHUNK, CITY_BUILDINGS, carsSolid, CITY_DISTRICTS, CITY_HEIGHT, CITY_MAP, CITY_SPAWNS, CITY_WIDTH, DUMP_START, MAX_HEALTH, VAULT_DOOR, chunksAround, inSight, type CityBuilding, type CityCar, type CityDrop, type CityPlayer, type PunchLine } from '@byzantine-council/shared/city';
import type { Emote } from '@byzantine-council/shared/hub';
import { audio } from '../audio/engine.js';
import { TalkBubble } from '../game/bubbles.js';
import { CONFETTI, EmoteAction, spawnFlourishes } from '../game/emoteActions.js';
import { Effects } from '../game/effects.js';
import { GUARDIAN_HEIGHT, NO_WEAR, drawGuardian, drawShadow, type Wear } from '../game/guardianArt.js';
import { robeColors, sameWear, wearOf } from '../game/wear.js';
import { turnToward } from '../game/facing.js';
import { fairZoom, sceneDpr, viewSize } from '../game/hidpi.js';
import { INTERP_DELAY_MS, InterpBuffer, lerpFactor } from '../game/interpolation.js';
import { ART_SCALE, TILE_H, TILE_W, isoDepth, screenToWorld, worldToScreen } from '../game/iso.js';
import { COLORS, cssColor, seatColors } from '../game/palette.js';
import { PhysicsFx, makeFxTextures } from '../game/physics.js';
import { CorrectionSmoother, Predictor, type PendingInput } from '../game/prediction.js';
import { Townsfolk } from '../game/townsfolk.js';
import { roomBackdrop } from './interiorArt.js';
import { InteriorView } from './interiorView.js';
import { MissionView } from './missionView.js';
import { drawModernCar } from './carArt.js';
import { CAR_COLORS, Traffic } from './traffic.js';
import { drawFerryDock } from '../ferry/ferryDock.js';
import { buildingFront, drawBuilding, drawContainer, drawMound, drawStreetLamp, drawStreetTree, makeCoinTexture, paintChunk } from './cityArt.js';
import { shadowScale, startJump, stepHop } from '../game/jump.js';

export const CITY_SCENE_KEY = 'city';
const STEP_MS = TICK_SECONDS * 1000;
const BASE_ZOOM = 0.72;
// Indoors: how much closer the camera may come than on the street, and the room's wall height kept in view above its floor.
const ROOM_ZOOM_MAX = 2.6;
const ROOM_WALL_PX = 120 * ART_SCALE;
// Name boards hang over doors within this many tiles of the guardian, refreshed this often.
const SIGN_RANGE = 9;
const SIGN_EVERY_MS = 250;
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
  // The soft ground shadow, which shrinks while the guardian is in the air.
  readonly soft: Phaser.GameObjects.Image;
  readonly root: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly bubble: Phaser.GameObjects.Graphics;
  readonly bar: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  readonly talk: TalkBubble;
  // The emote they are acting out, if any.
  action: EmoteAction | null;
  // An outline drawn over everything, shown while a building or prop hides this guardian from the camera.
  readonly ghost: Phaser.GameObjects.Graphics;
  // The pose the x-ray outline was last drawn in (facing, doubled when seen from behind), 0 to redraw.
  ghostPose: number;
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
  // The latest position the server sent, for nudging this client's own guardian out of them.
  readonly server: { x: number; y: number };
  seat: number;
  wear: Wear;
  facing: 1 | -1;
  back: boolean;
  lastScreenX: number;
  lastScreenY: number;
  hop: number;
  hopV: number;
}

interface DrivenCar {
  readonly g: Phaser.GameObjects.Graphics;
  // Where the server last put the car, for walking into it the way the server does.
  readonly body: { x: number; y: number; heading: number };
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

// A prop's screen bounds, for skipping it while it is off camera.
interface Box {
  readonly g: Phaser.GameObjects.Graphics;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface Wall extends Box {
  readonly depth: number;
  readonly faded: number;
}

interface Chunk {
  readonly ground: Phaser.GameObjects.Image;
  readonly walls: readonly Wall[];
  readonly key: string;
  readonly props: Phaser.GameObjects.GameObject[];
  readonly boxes: readonly Box[];
}

// World pixels past the camera edge that props stay drawn for, so nothing pops in between culling passes.
const CULL_MARGIN = 320;

const CORNER = 1.5;

// Buildings by every chunk they touch (indexed cy * CHUNK_COLS + cx), for depth checks near the player.
const CHUNK_COLS = Math.ceil((CITY_WIDTH + 6) / CHUNK);
const BUILDINGS_BY_CHUNK: CityBuilding[][] = [];
for (const b of CITY_BUILDINGS) {
  for (let cy = Math.floor(Math.max(0, b.box.r0 - CORNER) / CHUNK); cy <= Math.floor((b.box.r1 + 5) / CHUNK); cy++) {
    for (let cx = Math.floor(Math.max(0, b.box.c0 - CORNER) / CHUNK); cx <= Math.floor((b.box.c1 + 5) / CHUNK); cx++) {
      (BUILDINGS_BY_CHUNK[cy * CHUNK_COLS + cx] ??= []).push(b);
    }
  }
}
const NO_BUILDINGS: readonly CityBuilding[] = [];

// Depth that keeps something standing in front of a big building drawn over it: the plain painter's order
// only compares one point per footprint, which a wide building gets wrong along its front faces.
export function sortDepth(x: number, y: number): number {
  let d = isoDepth(x, y);
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  const list = cx >= 0 && cy >= 0 && cx < CHUNK_COLS ? (BUILDINGS_BY_CHUNK[cy * CHUNK_COLS + cx] ?? NO_BUILDINGS) : NO_BUILDINGS;
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
  // Walls on or near the camera, refreshed with culling; only these can hide anything on screen.
  readonly #wallsInView: Wall[] = [];
  readonly #fade = new Set<Wall>();
  readonly #people: Vec2[] = [];
  readonly #carPoses: CarPose[] = [];
  readonly #cars = new Map<string, DrivenCar>();
  #driving = false;
  #following: Phaser.GameObjects.GameObject | null = null;
  #queue: string[] = [];
  #entities!: Phaser.GameObjects.Layer;
  #names!: Phaser.GameObjects.Layer;
  readonly #signs = new Map<number, Phaser.GameObjects.Text>();
  #signsAt = 0;
  #ground!: Phaser.GameObjects.Layer;
  #physics!: PhysicsFx;
  #effects!: Effects;
  #townsfolk: Townsfolk | null = null;
  #mission: MissionView | null = null;
  #traffic: Traffic | null = null;
  #reduced = false;
  #myId: string | null = null;
  // This client's own look while a change is shown before the server has it, and the last look the server sent.
  #myLook: Wear | null = null;
  #myServed: Wear | null = null;
  #predictor: Predictor | null = null;
  #smoother = new CorrectionSmoother();
  #prev: Vec2 = { x: 0, y: 0 };
  #acc = 0;
  #input: CityInput | null = null;
  #sink: CitySink | null = null;
  #streamAt = 0;
  // The building this client's guardian is inside (0 on the street) and the room drawn for it.
  #inside = 0;
  #room: InteriorView | null = null;
  #userZoom = 1;
  #roomBox: Phaser.Geom.Rectangle | null = null;
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
    this.#traffic = new Traffic(this, this.#entities, sortDepth, this.#reduced, this.#mission === null ? 44 : 12);
    if (this.#mission === null) drawFerryDock(this, this.#entities, 'city', sortDepth, this.#reduced);
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
    for (const sign of this.#signs.values()) sign.destroy();
    this.#signs.clear();
    this.#driving = false;
    this.#following = null;
    this.#myId = null;
    this.#myLook = null;
    this.#myServed = null;
    this.#predictor = null;
    this.#input = null;
    this.#sink = null;
    this.#room?.destroy();
    this.#room = null;
    this.#inside = 0;
    this.cameras.main.setBackgroundColor('#1d4a66');
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
    const wear = isMe && this.#myLook !== null ? this.#myLook : wearOf(p);
    if (isMe) this.#myServed = wearOf(p);
    drawGuardian(body, robeColors(p.seat, wear), 1, wear);
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
      root, soft, body, bubble, bar, label, talk: new TalkBubble(this, this.#names, this.#reduced), action: null, ghost, ghostPose: 0, stars: null, health: MAX_HEALTH, down: false, shielded: false, lunge: 0,
      buffer: new InterpBuffer(), isMe, npc: p.npc, inCar: false, pos: { x: p.x, y: p.y }, server: { x: p.x, y: p.y }, seat: p.seat, wear, facing: 1, back: false, lastScreenX: 0, lastScreenY: 0, hop: 0, hopV: 0,
    };
    this.#setFight(avatar, p);
    this.#seat(avatar, p.car);
    avatar.buffer.push(performance.now(), p.x, p.y);
    this.#avatars.set(id, avatar);
    if (isMe) {
      this.#predictor = new Predictor({ x: p.x, y: p.y }, CITY_MAP);
      this.#predictor.solidFrom = this.#carsAround;
      this.#predictor.crowd = this.#crowd;
      this.#prev = { x: p.x, y: p.y };
      this.#acc = 0;
      this.cameras.main.startFollow(root, false, 0.12, 0.12);
      this.#following = root;
      if (p.inside !== this.#inside) this.#goThrough(avatar, p);
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
    const entry: DrivenCar = { g, body: { x: car.x, y: car.y, heading: car.heading }, buffer: new InterpBuffer(), pos: { x: car.x, y: car.y }, heading: car.heading, target: car.heading, drawn: car.heading, color, driver: car.driver };
    entry.buffer.push(performance.now(), car.x, car.y);
    drawModernCar(g, car.heading, color, car.driver !== '');
    this.#cars.set(id, entry);
  }

  updateCar(id: string, car: CityCar): void {
    const c = this.#cars.get(id);
    if (c === undefined) return;
    c.buffer.push(performance.now(), car.x, car.y);
    c.target = car.heading;
    c.body.x = car.x;
    c.body.y = car.y;
    c.body.heading = car.heading;
    if (c.driver !== car.driver) {
      c.driver = car.driver;
      drawModernCar(c.g, c.heading, c.color, car.driver !== '');
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
        drawModernCar(c.g, c.heading, c.color, c.driver !== '');
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

  /** Shows this client's own guardian in a look straight away, before the server has it; null goes back to the server's. */
  dressMe(wear: Wear | null): void {
    if (this.#myId === null) return;
    this.#myLook = wear;
    const me = this.#avatars.get(this.#myId);
    const next = wear ?? this.#myServed;
    if (me === undefined || next === null || sameWear(me.wear, next)) return;
    me.wear = next;
    drawGuardian(me.body, robeColors(me.seat, me.wear), me.facing, me.wear, me.back);
  }

  // The look to draw: the server's, except for this client's own guardian while it shows a look the server is still catching up on.
  #wanted(isMe: boolean, p: CityPlayer): Wear {
    const served = wearOf(p);
    if (!isMe) return served;
    this.#myServed = served;
    if (this.#myLook !== null && sameWear(served, this.#myLook)) this.#myLook = null;
    return this.#myLook ?? served;
  }

  updatePlayer(id: string, p: CityPlayer): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    if (a.isMe && p.inside !== this.#inside) this.#goThrough(a, p);
    const want = this.#wanted(a.isMe, p);
    if (!sameWear(a.wear, want) || a.seat !== p.seat) {
      a.wear = want;
      a.seat = p.seat;
      a.ghostPose = 0;
      drawGuardian(a.body, robeColors(a.seat, a.wear), a.facing, a.wear, a.back);
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
      a.server.x = p.x;
      a.server.y = p.y;
    }
  }

  removePlayer(id: string): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    if (a.isMe) this.cameras.main.stopFollow();
    a.root.destroy();
    a.label.destroy();
    a.talk.destroy();
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
        drawGuardian(from.body, robeColors(from.seat, from.wear), dir, from.wear, from.back);
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

  /** A guardian acts out an emote: a wave, a jump for joy with confetti, a dance, hearts, a laugh or a shaka. */
  emote(id: string, kind: Emote): void {
    const a = this.#avatars.get(id);
    if (a === undefined || a.down) return;
    a.action?.end(a.body, true);
    a.action = new EmoteAction(this, a.root, a.body, kind, robeColors(a.seat, a.wear), this.game.loop.time);
    const s = worldToScreen(a.pos.x, a.pos.y);
    spawnFlourishes(this, this.#names, kind, s.x, s.y - GUARDIAN_HEIGHT * 1.05, this.#reduced);
    if (this.#reduced || kind !== 'cheer') return;
    a.hopV = 260;
    this.#confetti(a.pos);
  }

  #confetti(at: Vec2): void {
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2;
      this.#physics.spawn({
        x: at.x, y: at.y, z: 60 * ART_SCALE, vx: Math.cos(ang) * (0.5 + (i % 3) * 0.3), vy: Math.sin(ang) * (0.5 + (i % 4) * 0.25), vz: 220 + (i % 5) * 50,
        life: 1.6 + (i % 3) * 0.3, texture: 'fx-leaf', color: CONFETTI[i % CONFETTI.length] ?? 0xffffff,
        size: 0.5 * ART_SCALE, gravity: 0.35, drag: 1.2, wind: 0.6, spin: ((i % 7) - 3) * 4, bounce: 0.1,
      });
    }
  }

  /** A jump: up with real gravity, the shadow shrinking under it, and a puff of dust on landing. */
  jump(id: string): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    startJump(a);
  }

  zoomBy(factor: number): void {
    this.#userZoom = Phaser.Math.Clamp(this.#userZoom * factor, 0.45, 1.8);
    this.#applyZoom();
  }

  override update(time: number, delta: number): void {
    this.#stepLocal(delta);
    this.#physics.update(delta);
    this.#townsfolk?.update(time, delta, this.#reduced);
    if (this.#inside === 0 && time > this.#streamAt) {
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
    this.#cull();
    this.#seeThrough(delta);
    const eye = this.predictedPosition();
    const sees = (p: Vec2): boolean => eye === null || inSight(eye, p);
    this.#townsfolk?.cull(sees);
    const people = this.#people;
    people.length = 0;
    for (const a of this.#avatars.values()) if (!a.inCar) people.push(a.pos);
    this.#townsfolk?.collectPositions(people);
    const cars = this.#carPoses;
    cars.length = 0;
    for (const c of this.#cars.values()) cars.push({ x: c.pos.x, y: c.pos.y, heading: c.heading });
    this.#traffic?.update(time, delta, people, sees, cars);
    this.#mission?.update(time, delta, (this.#myId === null ? undefined : this.#avatars.get(this.#myId))?.pos ?? eye);
    this.#updateSigns(time, eye);
    const k = lerpFactor(0.12, delta);
    this.cameras.main.setLerp(k, k);
  }

  // A name board over each door near the guardian on the street; none indoors.
  #updateSigns(time: number, eye: Vec2 | null): void {
    if (time < this.#signsAt) return;
    this.#signsAt = time + SIGN_EVERY_MS;
    const near = new Set<number>();
    if (eye !== null && this.#inside === 0 && this.#mission === null) {
      for (const d of BUILDING_DOORS) if (Math.hypot(d.at.x - eye.x, d.at.y - eye.y) <= SIGN_RANGE) near.add(d.building.seed);
    }
    for (const [seed, sign] of this.#signs) {
      if (near.has(seed)) continue;
      sign.destroy();
      this.#signs.delete(seed);
    }
    for (const seed of near) {
      const door = doorBySeed(seed);
      if (door === null || this.#signs.has(seed)) continue;
      const at = worldToScreen(door.at.x, door.at.y);
      const sign = this.add
        .text(at.x, at.y - 34 * ART_SCALE, buildingName(seed), { fontFamily: FONT, fontSize: '15px', fontStyle: '700', color: '#fff6e6', backgroundColor: '#2a1a33cc', padding: { x: 8, y: 4 }, resolution: 2 })
        .setOrigin(0.5, 1);
      this.#names.add(sign);
      this.#signs.set(seed, sign);
    }
  }

  // Fades whatever is drawn in front of this client's guardian or anyone watching with a sight cone, and outlines any guardian the camera can't see
  // behind a building or prop, so nobody is ever lost behind a tower, a tree or a stack of crates.
  #seeThrough(delta: number): void {
    const k = Math.min(1, delta / 120);
    const fade = this.#fade;
    fade.clear();
    for (const a of this.#avatars.values()) {
      const s = worldToScreen(a.pos.x, a.pos.y, this.#tmp);
      const depth = sortDepth(a.pos.x, a.pos.y);
      let covered = false;
      for (const w of this.#wallsInView) {
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
      for (const w of this.#wallsInView) {
        if (!hides(w, s, depth)) continue;
        fade.add(w);
      }
    }
    for (const w of this.#wallsInView) {
      const target = fade.has(w) ? w.faded : 1;
      if (w.g.alpha !== target) w.g.setAlpha(Math.abs(w.g.alpha - target) < 0.02 ? target : w.g.alpha + (target - w.g.alpha) * k);
    }
  }

  #outline(a: Avatar, show: boolean): void {
    if (a.ghost.visible !== show) a.ghost.setVisible(show);
    if (!show) return;
    const pose = a.facing * (a.back ? 2 : 1);
    if (a.ghostPose !== pose) {
      a.ghostPose = pose;
      const c = a.isMe ? GHOST : seatColors(a.seat);
      drawGuardian(a.ghost, { lit: c.highlight, shadow: c.lit, highlight: 0xffffff }, a.facing, NO_WEAR, a.back);
    }
    a.ghost.setPosition(a.root.x, a.root.y + a.body.y).setAlpha(this.#reduced ? 0.55 : 0.4 + 0.15 * Math.sin(this.time.now / 240));
  }

  // Hides props well outside the camera: Phaser replays a visible Graphics every frame, on screen or not.
  #cull(): void {
    const v = this.cameras.main.worldView;
    const left = v.x - CULL_MARGIN;
    const right = v.right + CULL_MARGIN;
    const top = v.y - CULL_MARGIN;
    const bottom = v.bottom + CULL_MARGIN;
    const near = (b: Box): boolean => b.right > left && b.left < right && b.bottom > top && b.top < bottom;
    this.#wallsInView.length = 0;
    for (const chunk of this.#chunks.values()) {
      for (const b of chunk.boxes) {
        const show = near(b);
        if (b.g.visible !== show) b.g.setVisible(show);
      }
      for (const w of chunk.walls) if (near(w)) this.#wallsInView.push(w);
    }
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
    const boxes: Box[] = [];
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
      boxes.push(wall);
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
          boxes.push(wall);
          this.#walls.add(wall);
        };
        if (t === 'T') {
          prop(add(depth, (g) => {
            drawStreetTree(g, seed);
          }, foot.x, foot.y), 34, 90);
        } else if (t === 'L') {
          const g = add(depth, (gr) => {
            drawStreetLamp(gr, c, r);
          });
          boxes.push({ g, left: foot.x - 12 * ART_SCALE, right: foot.x + 40 * ART_SCALE, top: foot.y - 140 * ART_SCALE, bottom: foot.y + 8 * ART_SCALE });
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
    this.#chunks.set(key, { ground, walls, key: painted.key, props, boxes });
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
    const dy = s.y - a.lastScreenY;
    const moving = Math.abs(dx) > 0.05 || Math.abs(s.y - a.root.y) > 0.05;
    if (turnToward(a, dx, dy)) drawGuardian(a.body, robeColors(a.seat, a.wear), a.facing, a.wear, a.back);
    a.lastScreenX = s.x;
    a.lastScreenY = s.y;
    a.lunge *= 0.8;
    if (Math.abs(a.lunge) < 0.1) a.lunge = 0;
    a.root.setPosition(s.x + a.lunge, s.y);
    if (stepHop(a, Math.min(this.game.loop.delta, 50) / 1000) && !this.#reduced) this.#effects.ring(a.pos, 0xe8dcc4, 0.45, 320);
    const shadow = shadowScale(a.hop);
    a.soft.setScale(0.2 * shadow).setAlpha(0.45 * shadow);
    a.body.y = (moving && !this.#reduced ? Math.sin(time / 90) * 1.6 * ART_SCALE : 0) - a.hop * 0.5;
    a.root.setDepth(sortDepth(a.pos.x, a.pos.y));
    const zoom = this.cameras.main.zoom / sceneDpr(this);
    a.label.setScale(1 / zoom);
    a.label.setPosition(s.x, s.y - GUARDIAN_HEIGHT - 8 * ART_SCALE);
    a.talk.place(s.x, a.label.y - a.label.height / zoom, zoom, time, a.label.visible);
    if (a.action !== null && (a.down || !a.action.update(time, a.body, a.body.y, a.facing, this.#reduced))) {
      a.action.end(a.body, !a.down);
      a.action = null;
    }
    a.bar.setScale(1 / zoom).setPosition(s.x, s.y - GUARDIAN_HEIGHT - 2 * ART_SCALE);
    a.stars?.setScale(1 / zoom).setPosition(s.x, s.y - GUARDIAN_HEIGHT * 0.55);
    a.bubble.setAlpha(this.#reduced ? 0.5 : 0.35 + Math.sin(time / 260) * 0.15);
  }

  readonly #carsAround = (from: Vec2): ((p: Vec2) => boolean) => carsSolid([...this.#cars.values()].map((c) => c.body), from, PLAYER_RADIUS);

  // This guardian's half of the server's crowd push, away from the other guardians on foot where the server last put them.
  readonly #crowd = (at: Vec2, blocked: (from: Vec2, to: Vec2) => boolean): Vec2 => {
    const myId = this.#myId;
    if (myId === null) return at;
    const others: CrowdBody[] = [];
    for (const [id, a] of this.#avatars) if (!a.isMe && !a.npc && !a.inCar) others.push({ id, x: a.server.x, y: a.server.y });
    return others.length === 0 ? at : pushClear({ id: myId, x: at.x, y: at.y }, others, blocked);
  };

  /** Lights up the room spot this client's guardian can use right now; null for none. */
  markSpot(spot: RoomSpot | null): void {
    this.#room?.mark(spot);
  }

  /** The building this client's guardian is inside, by its seed; 0 on the street. */
  get inside(): number {
    return this.#inside;
  }

  // Through a door, in or out: the room is drawn (or put away), prediction moves to the new ground, and the camera
  // cuts to the guardian behind a short fade instead of sweeping across the city.
  #goThrough(a: Avatar, p: CityPlayer): void {
    this.#inside = p.inside;
    this.#room?.destroy();
    this.#room = null;
    const door = p.inside === 0 ? null : doorBySeed(p.inside);
    const predictor = this.#predictor;
    if (door !== null) {
      const layout = layoutFor(door.room, door.building.seed);
      this.#room = new InteriorView(this, this.#ground, this.#entities, layout, door.room, door.building.seed, sortDepth);
      if (predictor !== null) {
        predictor.map = roomMap(layout);
        predictor.origin = INTERIOR_ORIGIN;
        predictor.solidFrom = null;
      }
      const at = worldToScreen(INTERIOR_ORIGIN.x, INTERIOR_ORIGIN.y);
      const span = layout.w + layout.d;
      this.#roomBox = new Phaser.Geom.Rectangle(at.x - layout.d * (TILE_W / 2), at.y - ROOM_WALL_PX, span * (TILE_W / 2), span * (TILE_H / 2) + ROOM_WALL_PX);
      this.cameras.main.setBackgroundColor(roomBackdrop(layout, door.room));
    } else {
      if (predictor !== null) {
        predictor.map = CITY_MAP;
        predictor.origin = { x: 0, y: 0 };
        predictor.solidFrom = this.#carsAround;
      }
      this.#roomBox = null;
      this.cameras.main.setBackgroundColor('#1d4a66');
    }
    this.#applyZoom();
    predictor?.reset({ x: p.x, y: p.y });
    this.#prev = { x: p.x, y: p.y };
    this.#acc = 0;
    this.#smoother.clear();
    a.pos.x = p.x;
    a.pos.y = p.y;
    const s = worldToScreen(p.x, p.y);
    a.root.setPosition(s.x, s.y);
    this.cameras.main.centerOn(s.x, s.y);
    if (door === null) this.#stream(true);
    const bg = this.#room === null || door === null ? 0x0c0a08 : roomBackdrop(layoutFor(door.room, door.building.seed), door.room);
    if (!this.#reduced) this.cameras.main.fadeIn(220, (bg >> 16) & 255, (bg >> 8) & 255, bg & 255);
  }

  /** Shows the talking dots over the guardian with this session id, or over nobody. */
  talking(id: string | null): void {
    for (const [key, a] of this.#avatars) a.talk.show(key === id);
  }

  /** This client's own session id in the city, once connected. */
  get myId(): string | null {
    return this.#myId;
  }

  // Indoors the camera closes in until the room fills the view, and stays over the room instead of the dark around it.
  #applyZoom(): void {
    const { w, h } = viewSize(this);
    const cam = this.cameras.main;
    let zoom = fairZoom(w, h) * BASE_ZOOM * this.#userZoom;
    const box = this.#roomBox;
    // Indoors the room covers the whole view, and zooming out never shows the dark around it.
    if (box !== null) zoom = Math.min(Math.max(w / box.width, h / box.height) * Math.max(1, this.#userZoom), zoom * ROOM_ZOOM_MAX);
    cam.setZoom(sceneDpr(this) * zoom);
    if (box === null) {
      cam.removeBounds();
      return;
    }
    const bw = Math.max(box.width, cam.width / cam.zoom);
    const bh = Math.max(box.height, cam.height / cam.zoom);
    cam.setBounds(box.centerX - bw / 2, box.centerY - bh / 2, bw, bh);
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
