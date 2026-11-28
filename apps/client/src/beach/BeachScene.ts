// Beach Town in Phaser: the painted beach, swaying palms, the sky, and every guardian in town.
import Phaser from 'phaser';
import { TICK_SECONDS, tileAt, type Vec2 } from '@byzantine-council/shared';
import { colorNumber, getShop, type BeachShopId } from '@byzantine-council/shared/economy';
import type { Emote } from '@byzantine-council/shared/hub';
import { BEACH_MAP, HOME_RANGE, SHOP_RANGE, homeDoor, shopCounter, type HubPlayer } from '@byzantine-council/shared/hub';
import { Atmosphere, type NatureNote } from '../game/atmosphere.js';
import { CONFETTI, EmoteAction, spawnFlourishes } from '../game/emoteActions.js';
import { Effects } from '../game/effects.js';
import { GUARDIAN_HEIGHT, drawGuardian, drawShadow, type Wear } from '../game/guardianArt.js';
import { robeColors, sameWear, wearOf } from '../game/wear.js';
import { turnToward } from '../game/facing.js';
import { fairZoom, sceneDpr, viewSize } from '../game/hidpi.js';
import { INTERP_DELAY_MS, InterpBuffer, lerpFactor } from '../game/interpolation.js';
import { ART_SCALE, TILE_H, TILE_W, isoDepth, worldToScreen } from '../game/iso.js';
import { windAt, type Swaying } from '../game/mapArt.js';
import { COLORS, cssColor } from '../game/palette.js';
import { PhysicsFx, makeFxTextures } from '../game/physics.js';
import { CorrectionSmoother, Predictor, type PendingInput } from '../game/prediction.js';
import { createBeachProps, drawBoat, drawHutDecor, paintBeach } from './beachArt.js';
import { Townsfolk } from '../game/townsfolk.js';
import { drawBunting } from '../game/festive.js';
import { BEACH_SHOP_IDS } from '@byzantine-council/shared/economy';
import { audio } from '../audio/engine.js';
import { quality } from '../game/quality.js';
import { shadowScale, startJump, stepHop } from '../game/jump.js';
import { drawFerryDock } from '../ferry/ferryDock.js';

export const BEACH_SCENE_KEY = 'beach';
const STEP_MS = TICK_SECONDS * 1000;
const BASE_ZOOM = 0.8;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface BeachInput {
  direction(): Vec2;
}
export interface BeachSink {
  readonly canSend: boolean;
  send(input: PendingInput): void;
}

interface Avatar {
  // The soft ground shadow, which shrinks while the guardian is in the air.
  readonly soft: Phaser.GameObjects.Image;
  readonly root: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly parcel: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  readonly buffer: InterpBuffer;
  readonly isMe: boolean;
  readonly pos: { x: number; y: number };
  readonly last: { x: number; y: number };
  seat: number;
  wear: Wear;
  facing: 1 | -1;
  back: boolean;
  // A hop: height above the ground and vertical speed, integrated under gravity.
  hop: number;
  hopV: number;
  lastScreenX: number;
  lastScreenY: number;
  stride: number;
  // The emote they are acting out, if any.
  action: EmoteAction | null;
}

export class BeachScene extends Phaser.Scene {
  readonly #avatars = new Map<string, Avatar>();
  #entities!: Phaser.GameObjects.Layer;
  #names!: Phaser.GameObjects.Layer;
  #physics!: PhysicsFx;
  #effects!: Effects;
  #atmosphere!: Atmosphere;
  #swaying: Swaying[] = [];
  #keepers: Phaser.GameObjects.Graphics[] = [];
  #boat!: Phaser.GameObjects.Graphics;
  #glintAt = 0;
  #townsfolk: Townsfolk | null = null;
  // Set by the controller so sky phenomena explain themselves here too.
  onNatureNote: (note: NatureNote) => void = () => undefined;
  #gullAt = 0;
  #reduced = false;
  #myId: string | null = null;
  // This client's own look while a change is shown before the server has it, and the last look the server sent.
  #myLook: Wear | null = null;
  #myServed: Wear | null = null;
  #predictor: Predictor | null = null;
  #smoother = new CorrectionSmoother();
  #prev: Vec2 = { x: 0, y: 0 };
  #acc = 0;
  #input: BeachInput | null = null;
  #sink: BeachSink | null = null;
  #focus!: Phaser.GameObjects.Graphics;
  #focusShop: BeachShopId | null = null;
  #hutDecor: Phaser.GameObjects.Graphics | null = null;
  #owned: readonly string[] = [];
  #target!: Phaser.GameObjects.Graphics;
  readonly #tmp = { x: 0, y: 0 };

  constructor() {
    super({ key: BEACH_SCENE_KEY, active: false });
  }

  create(): void {
    this.#reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const painted = paintBeach(this);
    this.add.image(painted.x, painted.y, painted.key).setOrigin(0).setScale(1 / painted.scale).setDepth(0);
    this.#entities = this.add.layer().setDepth(10);
    this.#names = this.add.layer().setDepth(20);
    makeFxTextures(this);
    const props = createBeachProps(this, this.#entities, this.#names);
    this.#swaying = props.swaying;
    this.#keepers = props.keepers;
    this.#hutDecor = props.hutDecor;
    drawFerryDock(this, this.#entities, 'beach', isoDepth, this.#reduced);
    drawHutDecor(props.hutDecor, this.#owned);
    // Townsfolk browse the stalls and stroll to the shore.
    const spots = [...BEACH_SHOP_IDS.map((id) => shopCounter(id)), homeDoor(), { x: 14.5, y: 15 }, { x: 7, y: 12.5 }, { x: 22.5, y: 12.5 }, { x: 15, y: 9.5 }];
    this.#townsfolk = new Townsfolk(this, this.#entities, BEACH_MAP, spots, 5);
    // A sailboat tacking slowly across the lagoon.
    this.#boat = this.add.graphics().setDepth(5);
    drawBoat(this.#boat, 0xff7f6a);
    const sky = this.add.layer().setDepth(19);
    this.#physics = new PhysicsFx(this, this.#entities, sky);
    this.#effects = new Effects(this, this.#physics, this.#entities, this.#reduced);
    this.#atmosphere = new Atmosphere(this, this.#physics, this.#effects, this.#reduced, BEACH_MAP);
    this.#atmosphere.onNote = (note) => {
      this.onNatureNote(note);
    };
    this.#focus = this.add.graphics().setDepth(2).setVisible(false);
    this.#target = this.add.graphics().setDepth(21).setVisible(false);
    // End-to-end builds only (compiled out otherwise): lets the browser test steer by the guardian's own position.
    if (import.meta.env.VITE_E2E === '1') Object.assign(window, { __bcBeachPos: () => this.predictedPosition() });
    if (!this.#reduced) this.tweens.add({ targets: this.#target, y: -8 * ART_SCALE, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // Beach Town keeps the visitor's own clock: bright days, warm sunrise and sunset, torch-lit nights.
    const syncDaylight = (instant = false): void => {
      const hour = new Date().getHours();
      this.#atmosphere.setDaylight(hour >= 20 || hour < 6 ? 'dusk' : hour >= 18 || hour < 7 ? 'sunset' : 'day', instant);
    };
    syncDaylight(true);
    this.time.addEvent({ delay: 60_000, loop: true, callback: () => {
      syncDaylight();
    } });
    const center = worldToScreen(15, 9.5);
    this.cameras.main.centerOn(center.x, center.y);
    this.#applyZoom();
    const onResize = (): void => {
      this.#applyZoom();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
  }

  attach(myId: string, input: BeachInput, sink: BeachSink): void {
    this.detach();
    this.#myId = myId;
    this.#input = input;
    this.#sink = sink;
  }

  detach(): void {
    for (const id of [...this.#avatars.keys()]) this.removePlayer(id);
    this.#myId = null;
    this.#myLook = null;
    this.#myServed = null;
    this.#predictor = null;
    this.#input = null;
    this.#sink = null;
    this.setFocusShop(null);
    this.setTarget(null);
    this.cameras.main.stopFollow();
  }

  addPlayer(id: string, p: HubPlayer): void {
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
    const parcel = new Phaser.GameObjects.Graphics(this);
    drawParcel(parcel);
    parcel.setVisible(p.carrying);
    const root = new Phaser.GameObjects.Container(this, 0, 0, [soft, ring, body, parcel]);
    this.#entities.add(root);
    const label = new Phaser.GameObjects.Text(this, 0, 0, p.name, {
      fontFamily: FONT, fontSize: '14px', fontStyle: '700', color: isMe ? cssColor(COLORS.gold) : '#fff1de', stroke: '#2a1a33', strokeThickness: 4, resolution: Math.ceil(sceneDpr(this)),
    }).setOrigin(0.5, 1);
    this.#names.add(label);
    const avatar: Avatar = { root, soft, body, parcel, label, buffer: new InterpBuffer(), isMe, pos: { x: p.x, y: p.y }, last: { x: p.x, y: p.y }, seat: p.seat, wear, facing: 1, back: false, lastScreenX: 0, lastScreenY: 0, stride: 0, hop: 0, hopV: 0, action: null };
    avatar.buffer.push(performance.now(), p.x, p.y);
    this.#avatars.set(id, avatar);
    if (isMe) {
      this.#predictor = new Predictor({ x: p.x, y: p.y }, BEACH_MAP);
      this.#prev = { x: p.x, y: p.y };
      this.#acc = 0;
      this.cameras.main.startFollow(root, false, 0.12, 0.12);
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
  #wanted(isMe: boolean, p: HubPlayer): Wear {
    const served = wearOf(p);
    if (!isMe) return served;
    this.#myServed = served;
    if (this.#myLook !== null && sameWear(served, this.#myLook)) this.#myLook = null;
    return this.#myLook ?? served;
  }

  updatePlayer(id: string, p: HubPlayer): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    const want = this.#wanted(a.isMe, p);
    if (!sameWear(a.wear, want) || a.seat !== p.seat) {
      a.wear = want;
      a.seat = p.seat;
      drawGuardian(a.body, robeColors(a.seat, a.wear), a.facing, a.wear, a.back);
    }
    a.parcel.setVisible(p.carrying);
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

  // A soft ring on the counter of the shop the player is standing at.
  setFocusShop(shop: BeachShopId | null): void {
    this.#focusShop = shop;
    this.#focus.setVisible(shop !== null);
    if (shop === null) return;
    this.#ring(shopCounter(shop), SHOP_RANGE, colorNumber(getShop(shop)?.color ?? '#FFD27A'));
  }

  // The same ring on the hut porch; leaving it never hides a shop's ring.
  setFocusHome(on: boolean): void {
    if (on) {
      this.#focus.setVisible(true);
      this.#ring(homeDoor(), HOME_RANGE, 0xffd27a);
    } else if (this.#focusShop === null) {
      this.#focus.setVisible(false);
    }
  }

  // The pennants on the hut follow the player's collection.
  setHutDecor(owned: readonly string[]): void {
    this.#owned = owned;
    if (this.#hutDecor !== null && this.#hutDecor.active) drawHutDecor(this.#hutDecor, owned);
  }

  #ring(at: Vec2, range: number, color: number): void {
    const s = worldToScreen(at.x, at.y);
    this.#focus.clear();
    this.#focus.fillStyle(color, 0.16);
    this.#focus.fillEllipse(s.x, s.y, range * TILE_W * Math.SQRT2, range * TILE_H * Math.SQRT2, 40);
    this.#focus.lineStyle(3 * ART_SCALE, color, 0.85);
    this.#focus.strokeEllipse(s.x, s.y, range * TILE_W * Math.SQRT2, range * TILE_H * Math.SQRT2, 40);
  }

  // A bobbing parcel marker over the shop a delivery is for.
  setTarget(shop: BeachShopId | null): void {
    this.#target.setVisible(shop !== null);
    if (shop === null) return;
    const c = shopCounter(shop);
    const s = worldToScreen(c.x, c.y);
    this.#target.clear();
    this.#target.setPosition(0, 0);
    const y = s.y - 150 * ART_SCALE;
    this.#target.fillStyle(0x2a1a33, 0.9);
    this.#target.fillTriangle(s.x - 14, y, s.x + 14, y, s.x, y + 26);
    this.#target.fillStyle(0xffd27a, 1);
    this.#target.fillTriangle(s.x - 10, y + 2, s.x + 10, y + 2, s.x, y + 20);
    this.#target.fillStyle(0xc08a58, 1);
    this.#target.fillRect(s.x - 12, y - 24, 24, 20);
    this.#target.lineStyle(2, 0x7a4e3e, 1);
    this.#target.strokeRect(s.x - 12, y - 24, 24, 20);
  }

  /** A jump: up with real gravity, the shadow shrinking under it, and a puff of dust on landing. */
  jump(id: string): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    startJump(a);
  }

  /** A guardian acts out an emote: a wave, a jump for joy with confetti, a dance, hearts, a laugh or a shaka. */
  emote(id: string, kind: Emote): void {
    const a = this.#avatars.get(id);
    if (a === undefined) return;
    a.action?.end(a.body, true);
    a.action = new EmoteAction(this, a.root, a.body, kind, robeColors(a.seat, a.wear), this.game.loop.time);
    const s = worldToScreen(a.pos.x, a.pos.y);
    spawnFlourishes(this, this.#names, kind, s.x, s.y - GUARDIAN_HEIGHT * 1.05, this.#reduced);
    if (this.#reduced || kind !== 'cheer') return;
    a.hopV = 260;
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2;
      this.#physics.spawn({
        x: a.pos.x, y: a.pos.y, z: 60 * ART_SCALE, vx: Math.cos(ang) * (0.5 + Math.random()), vy: Math.sin(ang) * (0.5 + Math.random()), vz: 200 + Math.random() * 260,
        life: 1.6 + Math.random(), texture: 'fx-leaf', color: CONFETTI[i % CONFETTI.length] ?? 0xffffff,
        size: 0.5 * ART_SCALE, gravity: 0.35, drag: 1.2, wind: 0.6, spin: (Math.random() - 0.5) * 14, bounce: 0.1,
      });
    }
  }

  // A live seasonal event strings bunting between the stalls along the boardwalk.
  #festive: Phaser.GameObjects.Graphics | null = null;

  setSeason(colors: readonly [string, string] | null): void {
    this.#festive?.destroy();
    this.#festive = null;
    if (colors === null) return;
    const a = Number.parseInt(colors[0].slice(1), 16);
    const b = Number.parseInt(colors[1].slice(1), 16);
    const g = this.add.graphics().setDepth(19);
    const posts = [{ x: 3, y: 6 }, { x: 9, y: 6 }, { x: 15, y: 6 }, { x: 21, y: 6 }, { x: 27, y: 6 }];
    for (let i = 0; i < posts.length - 1; i++) {
      const p = posts[i];
      const q = posts[i + 1];
      if (p !== undefined && q !== undefined) drawBunting(g, worldToScreen(p.x, p.y), worldToScreen(q.x, q.y), 100 * ART_SCALE, [a, b]);
    }
    this.#festive = g;
  }

  delivered(shop: BeachShopId, paid: number): void {
    const c = shopCounter(shop);
    this.#effects.taskDone(c, paid > 0 ? 0xffd27a : 0xbfb3c8);
  }

  zoomBy(factor: number): void {
    this.#userZoom = Phaser.Math.Clamp(this.#userZoom * factor, 0.6, 1.8);
    this.#applyZoom();
  }

  #userZoom = 1;

  override update(time: number, delta: number): void {
    this.#stepLocal(delta);
    this.#physics.update(delta);
    this.#atmosphere.update(time, delta);
    if (!this.#reduced) {
      for (const palm of this.#swaying) palm.g.rotation = 0.02 * palm.amount * windAt(time, palm.g.x) * (0.6 + 0.4 * Math.sin(time / 700 + palm.phase));
    }
    this.#lagoon(time);
    this.#townsfolk?.update(time, delta, this.#reduced);
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

  // The boat bobs on a slow swell; sun glints wink on the water; gulls call now and then.
  #lagoon(time: number): void {
    const t = time / 1000;
    const bx = 8 + ((t * 0.18) % 22);
    const p = worldToScreen(bx, 19.5 + Math.sin(t * 0.2) * 0.6);
    this.#boat.setPosition(p.x, p.y + Math.sin(t * 1.3) * 2.5 * ART_SCALE);
    this.#boat.rotation = Math.sin(t * 1.1) * 0.035;
    if (this.#reduced) return;
    this.#keepers.forEach((k, i) => {
      k.y += Math.sin(t * 0.9 + i) * 0.02;
    });
    if (time > this.#glintAt && quality.current === 'high') {
      this.#glintAt = time + 140;
      const x = 2 + Math.random() * 26;
      const y = 17 + Math.random() * 5;
      this.#physics.spawn({ x, y, z: 0, vx: 0, vy: 0, vz: 0, life: 0.9, texture: 'fx-spark', color: 0xffffff, size: (0.15 + Math.random() * 0.2) * ART_SCALE, blend: 'add', gravity: 0, wind: 0, fadeIn: 0.4, spin: 1.5 });
    }
    if (time > this.#gullAt) {
      this.#gullAt = time + 9000 + Math.random() * 14_000;
      if (this.#gullAt > 12_000) audio.play('gull');
    }
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
    const dy = s.y - a.lastScreenY;
    const moving = Math.abs(dx) > 0.05 || Math.abs(s.y - a.root.y) > 0.05;
    if (turnToward(a, dx, dy)) drawGuardian(a.body, robeColors(a.seat, a.wear), a.facing, a.wear, a.back);
    a.lastScreenX = s.x;
    a.lastScreenY = s.y;
    a.root.setPosition(s.x, s.y);
    // Hops integrate under gravity and stop on the ground.
    if (stepHop(a, Math.min(this.game.loop.delta, 50) / 1000) && !this.#reduced) this.#effects.ring(a.pos, 0xe8dcc4, 0.45, 320);
    const shadow = shadowScale(a.hop);
    a.soft.setScale(0.2 * shadow).setAlpha(0.45 * shadow);
    a.body.y = (moving && !this.#reduced ? Math.sin(time / 90) * 1.6 * ART_SCALE : 0) - a.hop * 0.5;
    if (a.action !== null && !a.action.update(time, a.body, a.body.y, a.facing, this.#reduced)) {
      a.action.end(a.body, true);
      a.action = null;
    }
    a.parcel.y = a.body.y;
    a.root.setDepth(isoDepth(a.pos.x, a.pos.y));
    const step = Math.hypot(a.pos.x - a.last.x, a.pos.y - a.last.y);
    a.last.x = a.pos.x;
    a.last.y = a.pos.y;
    a.stride = step > 1 ? 0 : a.stride + step;
    if (a.stride > 0.55) {
      a.stride = 0;
      const onBoards = tileAt(BEACH_MAP, Math.floor(a.pos.x), Math.floor(a.pos.y)) === '=';
      this.#effects.footstep(a.pos, false, a.isMe, onBoards ? 'wood' : 'sand');
    }
    const zoom = this.cameras.main.zoom / sceneDpr(this);
    a.label.setScale(1 / zoom);
    a.label.setPosition(s.x, s.y - GUARDIAN_HEIGHT - 8 * ART_SCALE);
  }

  #applyZoom(): void {
    const { w, h } = viewSize(this);
    this.cameras.main.setZoom(sceneDpr(this) * fairZoom(w, h) * BASE_ZOOM * this.#userZoom);
  }
}

// A brown parcel held in front of the guardian.
function drawParcel(g: Phaser.GameObjects.Graphics): void {
  const s = ART_SCALE;
  g.fillStyle(0xc08a58, 1);
  g.fillRect(-8 * s, -24 * s, 16 * s, 11 * s);
  g.fillStyle(0xa8744a, 1);
  g.fillRect(-8 * s, -24 * s, 16 * s, 3 * s);
  g.lineStyle(1.4 * s, 0xf2d48a, 1);
  g.lineBetween(0, -24 * s, 0, -13 * s);
}
