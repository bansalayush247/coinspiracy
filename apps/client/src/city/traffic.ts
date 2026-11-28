// Ambient life for Port Concord: cars that keep their lane, stop at red lights, for anyone in the road and for player
// cars, and ships that sail the harbour and the open sea. Drawn on each screen alone; nothing here touches the game state.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, CAR_LANES, COLLISION_TUNING, SHIP_ROUTES, boxesOverlap, greenFor, lanePoint, type CarPose, type GroundBox, type Lane, type ShipRoute } from '@byzantine-council/shared/city';
import { ART_SCALE, worldToScreen } from '../game/iso.js';
import { CAR_PAINTS, carHalfLength, carHalfWidth, drawModernCar, type CarStyle } from './carArt.js';
import { drawShip, type ShipHeading } from './shipArt.js';

const CAR_SPEED = 2.8;
const CAR_ACCEL = 5;
const CAR_LENGTH = 1.5;
const GAP = 1.1;
const PEOPLE_GAP = 1.4;
const SPAWN_CLEAR = 4;
// Cars fade in and out over this many tiles at the ends of their lane, where roads meet the sea.
const FADE = 1.5;
const YIELD = COLLISION_TUNING.traffic;
export const CAR_COLORS = [0xd9534f, 0x4f8fd9, 0xf0c05a, 0x5fb87a, 0xe9e2d6, 0x8a5fd9, 0x3b3f4a, 0xf08a4b];
// Ambient traffic cycles through these bodies, so a street shows a mix and now and then a bus.
const TRAFFIC_STYLES: readonly CarStyle[] = ['sedan', 'hatch', 'suv', 'sedan', 'van', 'taxi', 'pickup', 'hatch', 'bus', 'suv', 'sedan', 'van'];

interface Car {
  readonly g: Phaser.GameObjects.Graphics;
  lane: Lane;
  s: number;
  v: number;
  readonly color: number;
  readonly style: CarStyle;
  readonly len: number;
  readonly hw: number;
  // 1 normally; falls to 0 while a player car crowds this car, which then gives way by leaving the road.
  shown: number;
}

interface Ship {
  readonly g: Phaser.GameObjects.Graphics;
  readonly route: ShipRoute;
  leg: number;
  pos: Vec2;
  heading: ShipHeading | null;
  readonly seed: number;
  phase: number;
}

// A small seeded generator, so every screen starts its traffic the same way.
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export class Traffic {
  readonly #cars: Car[] = [];
  readonly #ships: Ship[] = [];
  readonly #rand = seeded(20_130_103);
  readonly #byLane = new Map<Lane, Car[]>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    private readonly depthOf: (x: number, y: number) => number,
    private readonly reduced: boolean,
    cars: number,
  ) {
    for (let i = 0; i < cars && CAR_LANES.length > 0; i++) {
      const lane = CAR_LANES[i % CAR_LANES.length];
      if (lane === undefined) continue;
      const span = lane.to - lane.from;
      const s = lane.from + span * this.#rand();
      const style = TRAFFIC_STYLES[i % TRAFFIC_STYLES.length] ?? 'sedan';
      const len = carHalfLength(style) * 2;
      if ((this.#byLane.get(lane) ?? []).some((c) => Math.abs(c.s - s) < (c.len + len) / 2 + GAP + 1)) continue;
      this.#addCar(lane, s, CAR_PAINTS[(i * 5) % CAR_PAINTS.length] ?? 0xd9534f, style, len, carHalfWidth(style));
    }
    SHIP_ROUTES.forEach((route, i) => {
      const g = new Phaser.GameObjects.Graphics(scene);
      layer.add(g);
      const start = route.points[0] ?? { x: 0, y: 0 };
      this.#ships.push({ g, route, leg: 0, pos: { ...start }, heading: null, seed: i, phase: i * 1.3 });
    });
  }

  /** One frame: `people` on foot and the player `cars` (parked or driven, where they are drawn) are kept clear of. */
  update(time: number, delta: number, people: readonly Vec2[], sees: (p: Vec2) => boolean, cars: readonly CarPose[] = []): void {
    const dt = Math.min(delta, 50) / 1000;
    const now = Date.now();
    const view = this.scene.cameras.main.worldView;
    const onScreen = (p: { x: number; y: number }): boolean => p.x > view.x - 300 && p.x < view.right + 300 && p.y > view.y - 300 && p.y < view.bottom + 300;
    for (const car of this.#cars) this.#drive(car, dt, now, people, cars);
    for (const car of this.#cars) {
      const ahead = (car.s - car.lane.to) * car.lane.dir;
      if (ahead >= 0 || car.shown <= 0) this.#respawn(car);
    }
    for (const car of this.#cars) {
      const p = lanePoint(car.lane, car.s);
      const s = worldToScreen(p.x, p.y);
      const shown = onScreen(s) && sees(p);
      car.g.setVisible(shown);
      if (!shown) continue;
      const edge = Math.min(Math.abs(car.s - car.lane.from), Math.abs(car.lane.to - car.s));
      car.g.setPosition(s.x, s.y).setDepth(this.depthOf(p.x, p.y)).setAlpha(Math.max(0, Math.min(1, edge / FADE, car.shown)));
    }
    for (const ship of this.#ships) {
      this.#sail(ship, dt);
      const s = worldToScreen(ship.pos.x, ship.pos.y);
      const shown = onScreen(s) && sees(ship.pos);
      ship.g.setVisible(shown);
      if (!shown) continue;
      const bob = this.reduced ? 0 : Math.sin(time / 600 + ship.phase) * 1.5 * ART_SCALE;
      ship.g.setPosition(s.x, s.y + bob).setDepth(this.depthOf(ship.pos.x, ship.pos.y));
    }
  }

  // For browser tests: where the ships are and how many cars are on screen.
  snapshot(): { ships: { kind: string; x: number; y: number; shown: boolean }[]; carsShown: number; carsMoving: number } {
    return {
      ships: this.#ships.map((sh) => ({ kind: sh.route.kind, x: sh.pos.x, y: sh.pos.y, shown: sh.g.visible })),
      carsShown: this.#cars.filter((c) => c.g.visible).length,
      carsMoving: this.#cars.filter((c) => c.v > 0.1).length,
    };
  }

  destroy(): void {
    for (const c of this.#cars) c.g.destroy();
    for (const s of this.#ships) s.g.destroy();
    this.#cars.length = 0;
    this.#ships.length = 0;
    this.#byLane.clear();
  }

  #addCar(lane: Lane, s: number, color: number, style: CarStyle, len: number, hw: number): void {
    const g = new Phaser.GameObjects.Graphics(this.scene);
    this.layer.add(g);
    drawModernCar(g, laneHeading(lane), color, false, style);
    const car: Car = { g, lane, s, v: CAR_SPEED, color, style, len, hw, shown: 1 };
    this.#cars.push(car);
    const list = this.#byLane.get(lane) ?? [];
    list.push(car);
    this.#byLane.set(lane, list);
  }

  // How far a car may still go: up to the car in front, anyone in the road, a player car in its path, or a red light's
  // stop line; a player car pressing into it makes it fade off the road instead of being driven through.
  #drive(car: Car, dt: number, now: number, people: readonly Vec2[], players: readonly CarPose[]): void {
    const { lane } = car;
    let room = Infinity;
    for (const other of this.#byLane.get(lane) ?? []) {
      if (other === car) continue;
      const d = (other.s - car.s) * lane.dir;
      if (d > 0) room = Math.min(room, d - (car.len + other.len) / 2 - GAP);
    }
    for (const p of people) {
      const across = lane.axis === 'col' ? Math.abs(p.x - lane.at) : Math.abs(p.y - lane.at);
      if (across > 0.75) continue;
      const d = ((lane.axis === 'col' ? p.y : p.x) - car.s) * lane.dir;
      if (d > 0) room = Math.min(room, d - car.len / 2 - PEOPLE_GAP);
    }
    if (!greenFor(lane.axis, now)) {
      for (const [a, b] of lane.crossings) {
        const entry = lane.dir === 1 ? a : b;
        const d = (entry - car.s) * lane.dir;
        if (d > car.len / 2 - 0.05) room = Math.min(room, d - car.len / 2 - 0.1);
      }
    }
    const here = lanePoint(lane, car.s);
    let crowded = false;
    let touching = false;
    for (const pc of players) {
      if (Math.abs(pc.x - here.x) + Math.abs(pc.y - here.y) > YIELD.lookAhead + car.len + 2 * CAR_HALF_LENGTH) continue;
      const other: GroundBox = { x: pc.x, y: pc.y, heading: pc.heading, halfLength: CAR_HALF_LENGTH, halfWidth: CAR_HALF_WIDTH };
      if (boxesOverlap(laneBox(car, car.s, YIELD.yieldMargin), other)) crowded = true;
      for (let t = 0; t <= YIELD.lookAhead; t += YIELD.probeStep) {
        if (!boxesOverlap(laneBox(car, car.s + t * lane.dir, 0), other)) continue;
        if (t === 0) touching = true;
        room = Math.min(room, t - YIELD.gap);
        break;
      }
    }
    const fade = (dt * 1000) / YIELD.yieldFadeMs;
    car.shown = touching ? 0 : crowded ? Math.max(0, car.shown - fade) : Math.min(1, car.shown + fade);
    const want = room <= 0 ? 0 : Math.min(CAR_SPEED, Math.sqrt(2 * CAR_ACCEL * room));
    car.v = want < car.v ? want : Math.min(want, car.v + CAR_ACCEL * dt);
    car.s += car.v * dt * lane.dir;
  }

  // A car leaving the map comes back at the start of some lane with room to pull in.
  #respawn(car: Car): void {
    const old = this.#byLane.get(car.lane);
    if (old !== undefined) old.splice(old.indexOf(car), 1);
    for (let tries = 0; tries < 8; tries++) {
      const lane = CAR_LANES[Math.floor(this.#rand() * CAR_LANES.length)];
      if (lane === undefined) continue;
      if ((this.#byLane.get(lane) ?? []).some((c) => Math.abs(c.s - lane.from) < SPAWN_CLEAR + (c.len + car.len) / 2 - CAR_LENGTH)) continue;
      car.lane = lane;
      car.s = lane.from;
      car.v = CAR_SPEED;
      break;
    }
    car.shown = 1;
    const list = this.#byLane.get(car.lane) ?? [];
    list.push(car);
    this.#byLane.set(car.lane, list);
    drawModernCar(car.g, laneHeading(car.lane), car.color, false, car.style);
  }

  #sail(ship: Ship, dt: number): void {
    const pts = ship.route.points;
    let budget = ship.route.speed * dt;
    while (budget > 0) {
      const target = pts[(ship.leg + 1) % pts.length] ?? ship.pos;
      const dx = target.x - ship.pos.x;
      const dy = target.y - ship.pos.y;
      const dist = Math.hypot(dx, dy);
      const heading: ShipHeading = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : dy >= 0 ? 's' : 'n';
      if (heading !== ship.heading) {
        ship.heading = heading;
        drawShip(ship.g, ship.route.kind, heading, ship.seed);
      }
      if (dist <= budget) {
        ship.pos = { ...target };
        ship.leg = (ship.leg + 1) % pts.length;
        budget -= dist;
        if (dist === 0) break;
        continue;
      }
      ship.pos = { x: ship.pos.x + (dx / dist) * budget, y: ship.pos.y + (dy / dist) * budget };
      budget = 0;
    }
  }
}

// A traffic car's body at `s` along its lane, grown by `margin` all round.
const laneBox = (car: Car, s: number, margin: number): GroundBox => {
  const p = lanePoint(car.lane, s);
  return { x: p.x, y: p.y, heading: laneHeading(car.lane), halfLength: car.len / 2 + margin, halfWidth: car.hw + margin };
};

// A car along its lane: east or west on a row, south or north on a column.
const laneHeading = (lane: Lane): number => (lane.axis === 'row' ? (lane.dir === 1 ? 0 : Math.PI) : lane.dir === 1 ? Math.PI / 2 : -Math.PI / 2);
