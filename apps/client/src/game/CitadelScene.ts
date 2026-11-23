import Phaser from 'phaser';
import { CITADEL_MAP, STATION_PROMPT_RANGE, TASK_KINDS, TICK_SECONDS, stationCenter, tileAt, type Role, type TaskKind, type Vec2, RELAYS, RELAY_RANGE } from '@byzantine-council/shared';
import type { PlayerState } from '@byzantine-council/shared/state';
import { GUARDIAN_HEIGHT, drawGuardian, drawShadow, type Wear } from './guardianArt.js';
import { paintGround } from './groundPaint.js';
import { Atmosphere, type Daylight, type NatureNote } from './atmosphere.js';
import { Effects } from './effects.js';
import { PhysicsFx, makeFxTextures } from './physics.js';
import { Townsfolk } from './townsfolk.js';
import { drawBunting } from './festive.js';
import { fairZoom, sceneDpr, viewSize } from './hidpi.js';
import { INTERP_DELAY_MS, InterpBuffer, lerpFactor } from './interpolation.js';
import { ART_SCALE, TILE_H, TILE_W, isoDepth, worldToScreen } from './iso.js';
import {
  AREA_LABELS,
  AREA_LABEL_DEPTH,
  ENTITY_DEPTH,
  GROUND_DEPTH,
  NAME_DEPTH,
  STATION_ACCENT,
  STATION_HEIGHT,
  WATER_DEPTH,
  createProps,
  windAt,
  type Swaying,
  drawWaterShine,
  labelPoint,
} from './mapArt.js';
import { COLORS, cssColor, seatColors } from './palette.js';
import { CorrectionSmoother, Predictor, type PendingInput } from './prediction.js';

export const SCENE_KEY = 'citadel';
const STEP_MS = TICK_SECONDS * 1000;
// A backgrounded tab never replays more than this much input on return.
const MAX_CATCHUP_MS = 250;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MIN_USER_ZOOM = 0.6;
export const MAX_USER_ZOOM = 1.8;
// Default framing shows the plaza and the buildings around it, as in the concept art.
const BASE_ZOOM = 0.72;
const PLAZA = { x: 15, y: 15 };

export interface DirectionSource {
  direction(): Vec2;
}

// What the scene needs from a joined room; the controller wires the real SDK room in.
export interface MoveSink {
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
  name: string;
  status: string;
  // Key rotated out by a council: drawn as a faded spectator.
  out: boolean;
  frozen: boolean;
  facing: 1 | -1;
  lastScreenX: number;
  moving: boolean;
  // Distance walked since the last footstep puff.
  stride: number;
  lastPos: { x: number; y: number };
}

interface StationMarker {
  readonly ring: Phaser.GameObjects.Graphics;
  readonly gem: Phaser.GameObjects.Graphics;
}

const NAME_COLOR = '#fff1de';
const BYZANTINE_NAME_COLOR = '#ff8a9a';

interface Local {
  readonly id: string;
  readonly predictor: Predictor;
  readonly smoother: CorrectionSmoother;
  prev: Vec2;
  acc: number;
}

function clampUnit(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

export class CitadelScene extends Phaser.Scene {
  readonly #avatars = new Map<string, Avatar>();
  #entities!: Phaser.GameObjects.Layer;
  #names!: Phaser.GameObjects.Layer;
  #myId: string | null = null;
  #local: Local | null = null;
  #input: DirectionSource | null = null;
  #sink: MoveSink | null = null;
  #userZoom = 1;
  #reducedMotion = false;
  readonly #markers = new Map<TaskKind, StationMarker>();
  // Relay rings shown during a network partition, one per relay.
  readonly #relays: Phaser.GameObjects.Graphics[] = [];
  // Roles this client is allowed to know; only Byzantines are drawn differently.
  #roles: ReadonlyMap<string, Role> = new Map();
  readonly #tmp = { x: 0, y: 0 };
  #swaying: Swaying[] = [];
  #physics!: PhysicsFx;
  #effects!: Effects;
  #atmosphere!: Atmosphere;
  #relaysActive = false;
  // Strollers on the plaza while nobody is in a room (the menu backdrop).
  #townsfolk: Townsfolk | null = null;
  #relaysHeld = 0;
  // Set by the controller to explain sky phenomena to the player.
  onNatureNote: (note: NatureNote) => void = () => undefined;

  constructor() {
    super({ key: SCENE_KEY });
  }

  create(): void {
    this.#reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = sceneDpr(this);
    const painted = paintGround(this);
    this.add.image(painted.x, painted.y, painted.key).setOrigin(0).setScale(1 / painted.scale).setDepth(GROUND_DEPTH);
    const water = this.add.graphics().setDepth(WATER_DEPTH);
    drawWaterShine(water);
    if (!this.#reducedMotion) {
      this.tweens.add({ targets: water, alpha: { from: 0.2, to: 0.9 }, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    const labelRes = Math.ceil(dpr * MAX_USER_ZOOM * BASE_ZOOM * 1.25);
    for (const area of AREA_LABELS) {
      const p = labelPoint(area.x, area.y);
      this.add
        .text(p.x, p.y, area.text, { fontFamily: FONT, fontSize: '26px', fontStyle: '800', color: '#8a5a4a', resolution: labelRes })
        .setOrigin(0.5)
        .setAlpha(0.45)
        .setDepth(AREA_LABEL_DEPTH);
    }
    this.#entities = this.add.layer().setDepth(ENTITY_DEPTH);
    this.#swaying = createProps(this, this.#entities);
    makeFxTextures(this);
    const sky = this.add.layer().setDepth(NAME_DEPTH - 1);
    this.#physics = new PhysicsFx(this, this.#entities, sky);
    this.#effects = new Effects(this, this.#physics, this.#entities, this.#reducedMotion);
    this.#atmosphere = new Atmosphere(this, this.#physics, this.#effects, this.#reducedMotion);
    this.#atmosphere.onNote = (note) => {
      this.onNatureNote(note);
    };
    const spots = [
      { x: 13, y: 12 }, { x: 17.5, y: 12.5 }, { x: 12.5, y: 17 }, { x: 18, y: 17.5 }, { x: 6, y: 11 }, { x: 21, y: 9.5 },
      { x: 7, y: 21.5 }, { x: 24, y: 15 }, { x: 15, y: 20.5 }, { x: 10, y: 9.5 },
    ];
    this.#townsfolk = new Townsfolk(this, this.#entities, CITADEL_MAP, spots, 6);
    this.#names = this.add.layer().setDepth(NAME_DEPTH);
    this.#createMarkers();

    const plaza = worldToScreen(PLAZA.x, PLAZA.y);
    this.cameras.main.centerOn(plaza.x, plaza.y);
    this.#applyZoom();

    // Global emitters outlive the scene, so unhook them on shutdown.
    const onResize = (): void => {
      this.#applyZoom();
    };
    const onDpr = (): void => {
      this.#applyZoom();
      for (const a of this.#avatars.values()) a.label.setResolution(Math.ceil(sceneDpr(this)));
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.registry.events.on('changedata-dpr', onDpr);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.registry.events.off('changedata-dpr', onDpr);
    });
  }

  // Starts drawing a joined room; players arrive through addPlayer().
  attach(myId: string, input: DirectionSource, sink: MoveSink): void {
    this.detach();
    this.#townsfolk?.setVisible(false);
    this.#myId = myId;
    this.#input = input;
    this.#sink = sink;
  }

  detach(): void {
    for (const id of [...this.#avatars.keys()]) this.removePlayer(id);
    this.#myId = null;
    this.#local = null;
    this.#input = null;
    this.#sink = null;
    this.#roles = new Map();
    this.setTaskMarkers(new Set());
    this.#createRelays();
    this.setFocusStation(null);
    this.stationBusy(null);
    this.cameras.main.stopFollow();
    this.#townsfolk?.setVisible(true);
  }

  addPlayer(id: string, p: PlayerState): void {
    if (this.#avatars.has(id)) {
      this.updatePlayer(id, p);
      return;
    }
    const isMe = id === this.#myId;
    const soft = new Phaser.GameObjects.Image(this, 6 * ART_SCALE, 2 * ART_SCALE, 'fx-shadow').setScale(0.2, 0.2).setTint(0x3b2752).setAlpha(0.5);
    const shadow = new Phaser.GameObjects.Graphics(this);
    drawShadow(shadow, isMe);
    const body = new Phaser.GameObjects.Graphics(this);
    const wear: Wear = { hat: p.hat, shades: p.shades, outfit: p.outfit };
    drawGuardian(body, seatColors(p.seat), 1, wear);
    const root = new Phaser.GameObjects.Container(this, 0, 0, [soft, shadow, body]);
    this.#entities.add(root);
    const label = new Phaser.GameObjects.Text(this, 0, 0, p.name, {
      fontFamily: FONT,
      fontSize: '14px',
      fontStyle: '700',
      color: isMe ? cssColor(COLORS.gold) : NAME_COLOR,
      stroke: '#2a1a33',
      strokeThickness: 4,
      resolution: Math.ceil(sceneDpr(this)),
    }).setOrigin(0.5, 1);
    this.#names.add(label);
    const avatar: Avatar = {
      root,
      body,
      label,
      buffer: new InterpBuffer(),
      isMe,
      pos: { x: p.x, y: p.y },
      seat: p.seat,
      wear,
      name: p.name,
      status: p.status,
      out: p.out,
      frozen: p.frozen > 0,
      facing: 1,
      lastScreenX: 0,
      moving: false,
      stride: 0,
      lastPos: { x: p.x, y: p.y },
    };
    this.#avatars.set(id, avatar);
    this.#applyNameColor(id, avatar);
    avatar.buffer.push(performance.now(), p.x, p.y);
    this.#applyStatus(avatar);
    this.#place(avatar, 0);
    if (isMe) {
      this.#local = {
        id,
        predictor: new Predictor({ x: p.x, y: p.y }),
        smoother: new CorrectionSmoother(),
        prev: { x: p.x, y: p.y },
        acc: 0,
      };
      this.cameras.main.startFollow(root, false, 0.12, 0.12);
    }
  }

  updatePlayer(id: string, p: PlayerState): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    if (a.seat !== p.seat || a.wear.hat !== p.hat || a.wear.shades !== p.shades || a.wear.outfit !== p.outfit) {
      a.seat = p.seat;
      a.wear = { hat: p.hat, shades: p.shades, outfit: p.outfit };
      drawGuardian(a.body, seatColors(a.seat), a.facing, a.wear);
    }
    if (!a.frozen && p.frozen > 0) this.#effects.freeze(a.pos);
    if (a.frozen && p.frozen === 0) this.#effects.thaw(a.pos);
    if (!a.out && p.out) this.#effects.dissolve(a.pos, seatColors(a.seat).highlight);
    if (a.name !== p.name || a.status !== p.status || a.out !== p.out || a.frozen !== p.frozen > 0) {
      a.name = p.name;
      a.status = p.status;
      a.out = p.out;
      a.frozen = p.frozen > 0;
      this.#applyStatus(a);
    }
    const local = this.#local;
    if (local !== null && local.id === id) {
      const before = local.predictor.position;
      local.predictor.reconcile({ x: p.x, y: p.y }, p.ack ?? 0);
      const after = local.predictor.position;
      local.prev = { x: local.prev.x + after.x - before.x, y: local.prev.y + after.y - before.y };
      local.smoother.correct(before, after);
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
    if (this.#local?.id === id) this.#local = null;
  }

  // The server forgets queued inputs on reconnect, so prediction restarts from its position.
  resetPrediction(p: PlayerState): void {
    const local = this.#local;
    if (local === null) return;
    local.predictor.reset({ x: p.x, y: p.y });
    local.prev = { x: p.x, y: p.y };
    local.acc = 0;
    local.smoother.clear();
  }

  // Floating markers over the stations whose tasks this player still has to do.
  setTaskMarkers(kinds: ReadonlySet<TaskKind>): void {
    for (const [kind, m] of this.#markers) m.gem.setVisible(kinds.has(kind));
  }

  // Ground ring around the station the player can use right now.
  setFocusStation(kind: TaskKind | null): void {
    for (const [k, m] of this.#markers) m.ring.setVisible(k === kind);
  }

  setRoles(roles: ReadonlyMap<string, Role>): void {
    this.#roles = roles;
    for (const [id, a] of this.#avatars) this.#applyNameColor(id, a);
  }

  // A live seasonal event decorates the plaza: bunting between the lamps and drifting confetti.
  #festive: Phaser.GameObjects.Graphics | null = null;
  #confetti: readonly number[] = [];
  #confettiAt = 0;

  setSeason(colors: readonly [string, string] | null): void {
    this.#festive?.destroy();
    this.#festive = null;
    this.#confetti = [];
    if (colors === null) return;
    const a = Number.parseInt(colors[0].slice(1), 16);
    const b = Number.parseInt(colors[1].slice(1), 16);
    this.#confetti = [a, b, 0xffffff];
    const g = this.add.graphics().setDepth(NAME_DEPTH - 2);
    // Strings run between the four plaza lamps and round the seal.
    const posts = [{ x: 10.5, y: 10.5 }, { x: 19.5, y: 10.5 }, { x: 19.5, y: 19.5 }, { x: 10.5, y: 19.5 }];
    posts.forEach((p, i) => {
      const q = posts[(i + 1) % posts.length] ?? p;
      drawBunting(g, worldToScreen(p.x, p.y), worldToScreen(q.x, q.y), 58 * ART_SCALE, [a, b]);
    });
    this.#festive = g;
  }

  // The station this player is working at comes alive while the task is open.
  #busy: TaskKind | null = null;
  #busyAt = 0;
  #beam: Phaser.GameObjects.Graphics | null = null;

  stationBusy(kind: TaskKind | null): void {
    this.#busy = kind;
    this.#beam?.destroy();
    this.#beam = null;
    if (kind === 'watchtower' && !this.#reducedMotion) {
      // The telescope's lamp sweeps a beam across the sky.
      const c = stationCenter('watchtower');
      const s = worldToScreen(c.x, c.y);
      const beam = this.add.graphics().setDepth(NAME_DEPTH - 1).setBlendMode(Phaser.BlendModes.ADD).setPosition(s.x + 10 * ART_SCALE, s.y - 74 * ART_SCALE);
      beam.fillStyle(0xfff1c9, 0.18);
      beam.fillTriangle(0, 0, 520 * ART_SCALE, -60 * ART_SCALE, 520 * ART_SCALE, 60 * ART_SCALE);
      beam.fillStyle(0xfff1c9, 0.12);
      beam.fillTriangle(0, 0, 520 * ART_SCALE, -25 * ART_SCALE, 520 * ART_SCALE, 25 * ART_SCALE);
      beam.rotation = -2.6;
      this.tweens.add({ targets: beam, rotation: -1.6, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.#beam = beam;
    }
  }

  #stationLife(time: number): void {
    const kind = this.#busy;
    if (kind === null || this.#reducedMotion || time < this.#busyAt) return;
    const c = stationCenter(kind);
    const accent = STATION_ACCENT[kind];
    if (kind === 'deposit') {
      // The mint press: a coin pops out with a glint and falls back.
      this.#busyAt = time + 650;
      this.#physics.spawn({ x: c.x, y: c.y, z: 62 * ART_SCALE, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, vz: 160, life: 1.1, texture: 'fx-dot', color: accent, size: 0.35 * ART_SCALE, blend: 'add', bounce: 0.4 });
    } else if (kind === 'ledger') {
      // Pages flutter off the open book on the breeze.
      this.#busyAt = time + 500;
      this.#physics.spawn({ x: c.x, y: c.y, z: 56 * ART_SCALE, vx: 0, vy: 0, vz: 40, life: 2.2, texture: 'fx-leaf', color: 0xfff4dc, size: 0.6 * ART_SCALE, gravity: 0.05, drag: 1.2, wind: 0.9, spin: 6, bounce: 0 });
    } else if (kind === 'route') {
      // The Lightning beacon crackles.
      this.#busyAt = time + 260;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        this.#physics.spawn({ x: c.x, y: c.y, z: 84 * ART_SCALE, vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 1.4, vz: (Math.random() - 0.3) * 160, life: 0.35, texture: 'fx-spark', color: i === 0 ? 0xffffff : accent, size: 0.3 * ART_SCALE, blend: 'add', gravity: 0, drag: 3 });
      }
    }
  }

  // Effects the match view triggers from game events.
  taskDone(kind: TaskKind): void {
    this.#effects.taskDone(stationCenter(kind), STATION_ACCENT[kind]);
  }

  stamp(playerId: string, signed: boolean): void {
    const a = this.#avatars.get(playerId);
    if (a !== undefined) this.#effects.stamp(a.pos, signed);
  }

  councilCalled(): void {
    this.#effects.council({ x: 15, y: 15 });
  }

  celebrate(side: 'honest' | 'byzantine'): void {
    this.#effects.fireworks({ x: 15, y: 15 }, side === 'honest' ? [0xffd27a, 0x5fd3b0, 0xffffff] : [0xff8a9a, 0xa983ff, 0xffb070]);
  }

  setDaylight(daylight: Daylight): void {
    this.#atmosphere.setDaylight(daylight);
  }

  zoomBy(factor: number): void {
    this.#userZoom = Phaser.Math.Clamp(this.#userZoom * factor, MIN_USER_ZOOM, MAX_USER_ZOOM);
    this.#applyZoom();
  }

  // Rendered world position of a player, for tests and debugging.
  positionOf(id: string): Vec2 | null {
    const a = this.#avatars.get(id);
    return a === undefined ? null : { x: a.pos.x, y: a.pos.y };
  }

  predictedPosition(): Vec2 | null {
    return this.#local === null ? null : { ...this.#local.predictor.position };
  }

  override update(time: number, delta: number): void {
    this.#stepLocal(delta);
    this.#physics.update(delta);
    this.#atmosphere.update(time, delta);
    this.#townsfolk?.update(time, delta, this.#reducedMotion);
    this.#stationLife(time);
    if (this.#confetti.length > 0 && !this.#reducedMotion && time > this.#confettiAt) {
      this.#confettiAt = time + 120;
      this.#physics.spawn({
        x: 10 + Math.random() * 10, y: 10 + Math.random() * 10, z: 260 * ART_SCALE, vx: 0, vy: 0, vz: -20,
        life: 5, texture: 'fx-leaf', color: this.#confetti[Math.floor(Math.random() * this.#confetti.length)] ?? 0xffffff,
        size: 0.45 * ART_SCALE, gravity: 0.06, drag: 1.6, wind: 0.8, spin: (Math.random() - 0.5) * 10, bounce: 0,
      });
    }
    if (!this.#reducedMotion) {
      // Trees lean with the wind and spring back: a damped sway around the wind's push.
      for (const tree of this.#swaying) {
        const w = windAt(time, tree.g.x);
        tree.g.rotation = 0.018 * tree.amount * w * (0.6 + 0.4 * Math.sin(time / 640 + tree.phase));
      }
    }
    const renderTime = performance.now() - INTERP_DELAY_MS;
    for (const a of this.#avatars.values()) {
      if (a.isMe && this.#local !== null) {
        const l = this.#local;
        const alpha = l.acc / STEP_MS;
        const cur = l.predictor.position;
        a.pos.x = l.prev.x + (cur.x - l.prev.x) * alpha + l.smoother.offset.x;
        a.pos.y = l.prev.y + (cur.y - l.prev.y) * alpha + l.smoother.offset.y;
      } else if (a.buffer.sample(renderTime, this.#tmp)) {
        a.pos.x = this.#tmp.x;
        a.pos.y = this.#tmp.y;
      }
      this.#place(a, time);
    }
    const cam = this.cameras.main;
    if (this.#local !== null) {
      const k = lerpFactor(0.12, delta);
      cam.setLerp(k, k);
    } else if (!this.#reducedMotion) {
      // Slow drift over the plaza behind the menu.
      const p = worldToScreen(PLAZA.x + Math.sin(time / 5000) * 2.5, PLAZA.y + Math.cos(time / 6500) * 2.5);
      cam.centerOn(p.x, p.y);
    }
  }

  // Fixed 20 Hz input steps, matching the server tick: each step is predicted and sent.
  #stepLocal(delta: number): void {
    const l = this.#local;
    if (l === null) return;
    l.smoother.decay(delta);
    l.acc = Math.min(l.acc + delta, MAX_CATCHUP_MS);
    while (l.acc >= STEP_MS) {
      l.acc -= STEP_MS;
      l.prev = { ...l.predictor.position };
      const dir = this.#input?.direction() ?? { x: 0, y: 0 };
      const sink = this.#sink;
      if (Math.hypot(dir.x, dir.y) < 0.01 || sink === null || !sink.canSend || l.predictor.stalled) continue;
      sink.send(l.predictor.apply(clampUnit(dir.x), clampUnit(dir.y)));
    }
  }

  #place(a: Avatar, time: number): void {
    const screen = worldToScreen(a.pos.x, a.pos.y, this.#tmp);
    const dx = screen.x - a.lastScreenX;
    a.moving = Math.abs(dx) > 0.05 || Math.abs(screen.y - a.root.y) > 0.05;
    if (Math.abs(dx) > 0.2) {
      const facing = dx > 0 ? 1 : -1;
      if (facing !== a.facing) {
        a.facing = facing;
        drawGuardian(a.body, seatColors(a.seat), facing, a.wear);
      }
    }
    a.lastScreenX = screen.x;
    // A puff of dust, or a ripple on the planks over water, every stride.
    const step = Math.hypot(a.pos.x - a.lastPos.x, a.pos.y - a.lastPos.y);
    a.lastPos.x = a.pos.x;
    a.lastPos.y = a.pos.y;
    // A jump (council gathering, reconnect) is a teleport, not a stride.
    a.stride = step > 1 ? 0 : a.stride + step;
    if (a.stride > 0.55) {
      a.stride = 0;
      if (!a.out) this.#effects.footstep(a.pos, tileAt(CITADEL_MAP, Math.floor(a.pos.x), Math.floor(a.pos.y)) === '=', a.isMe);
    }
    a.root.setPosition(screen.x, screen.y);
    a.body.y = a.moving && !this.#reducedMotion ? Math.sin(time / 90) * 1.6 * ART_SCALE : 0;
    // Lean into the walk, and settle back upright when standing.
    const lean = a.moving && !this.#reducedMotion ? a.facing * 0.06 : 0;
    a.body.rotation += (lean - a.body.rotation) * 0.2;
    const depth = isoDepth(a.pos.x, a.pos.y);
    if (a.root.depth !== depth) a.root.setDepth(depth);
    // Names keep a constant on-screen size whatever the zoom.
    const zoom = this.cameras.main.zoom / sceneDpr(this);
    a.label.setScale(1 / zoom);
    a.label.setPosition(screen.x, screen.y - GUARDIAN_HEIGHT - 8 * ART_SCALE);
  }

  #applyNameColor(id: string, a: Avatar): void {
    const color = a.isMe ? cssColor(COLORS.gold) : this.#roles.get(id) === 'byzantine' ? BYZANTINE_NAME_COLOR : NAME_COLOR;
    a.label.setColor(color);
  }

  #createRelays(): void {
    for (const r of RELAYS) {
      const ring = this.add.graphics().setDepth(AREA_LABEL_DEPTH).setVisible(false);
      const base = worldToScreen(r.x, r.y);
      ring.setPosition(base.x, base.y);
      this.#relays.push(ring);
      if (!this.#reducedMotion) this.tweens.add({ targets: ring, alpha: { from: 1, to: 0.5 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  // During a partition both relays glow; a held relay turns green.
  setRelays(active: boolean, held: number): void {
    const [r0, r1] = RELAYS;
    if (r0 !== undefined && r1 !== undefined) {
      if (active && !this.#relaysActive) this.#effects.lightning(r0, r1);
      // The link came back while both relays were held: a repair, not a timeout.
      if (!active && this.#relaysActive && this.#relaysHeld === 3) this.#effects.beam(r0, r1);
    }
    this.#relaysActive = active;
    this.#relaysHeld = held;
    const w = RELAY_RANGE * TILE_W * Math.SQRT2;
    const hgt = RELAY_RANGE * TILE_H * Math.SQRT2;
    this.#relays.forEach((ring, i) => {
      ring.setVisible(active);
      if (!active) return;
      const color = (held & (1 << i)) !== 0 ? 0x5fd3b0 : 0xff6b7a;
      ring.clear();
      ring.fillStyle(color, 0.22);
      ring.fillEllipse(0, 0, w, hgt, 40);
      ring.lineStyle(4 * ART_SCALE, color, 0.95);
      ring.strokeEllipse(0, 0, w, hgt, 40);
      ring.lineStyle(2 * ART_SCALE, color, 0.6);
      ring.strokeEllipse(0, 0, w * 1.4, hgt * 1.4, 40);
    });
  }

  #createMarkers(): void {
    for (const kind of TASK_KINDS) {
      const c = stationCenter(kind);
      const base = worldToScreen(c.x, c.y);
      const accent = STATION_ACCENT[kind];
      const ring = this.add.graphics().setDepth(AREA_LABEL_DEPTH).setVisible(false);
      const w = STATION_PROMPT_RANGE * TILE_W * Math.SQRT2;
      const hgt = STATION_PROMPT_RANGE * TILE_H * Math.SQRT2;
      ring.fillStyle(accent, 0.16);
      ring.fillEllipse(base.x, base.y, w, hgt, 40);
      ring.lineStyle(3 * ART_SCALE, accent, 0.85);
      ring.strokeEllipse(base.x, base.y, w, hgt, 40);
      const gem = new Phaser.GameObjects.Graphics(this).setVisible(false);
      const y = base.y - (STATION_HEIGHT[kind] + 46) * ART_SCALE;
      const s = 9 * ART_SCALE;
      gem.fillStyle(0x2a1a33, 0.9);
      gem.fillTriangle(base.x - s - 3, y, base.x + s + 3, y, base.x, y + 1.6 * s + 5);
      gem.fillTriangle(base.x - s - 3, y, base.x + s + 3, y, base.x, y - s - 4);
      gem.fillStyle(accent, 1);
      gem.fillTriangle(base.x - s, y, base.x + s, y, base.x, y + 1.6 * s);
      gem.fillStyle(0xfff4dc, 1);
      gem.fillTriangle(base.x - s, y, base.x + s, y, base.x, y - s);
      this.#names.add(gem);
      if (!this.#reducedMotion) {
        this.tweens.add({ targets: gem, y: -6 * ART_SCALE, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: ring, alpha: { from: 1, to: 0.55 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      this.#markers.set(kind, { ring, gem });
    }
  }

  #applyStatus(a: Avatar): void {
    const away = a.status !== 'active';
    a.root.setAlpha(a.out ? 0.3 : away ? 0.45 : a.frozen ? 0.6 : 1);
    a.label.setText(a.out ? `${a.name} (rotated out)` : away ? `${a.name} (reconnecting)` : a.frozen ? `${a.name} (frozen)` : a.name);
    a.label.setAlpha(a.out || away ? 0.7 : 1);
  }

  #applyZoom(): void {
    const { w, h } = viewSize(this);
    this.cameras.main.setZoom(sceneDpr(this) * fairZoom(w, h) * BASE_ZOOM * this.#userZoom);
  }
}

