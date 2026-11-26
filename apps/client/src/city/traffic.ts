// Ambient life for Port Concord: cars that keep their lane, stop at red lights and for anyone in the road, and
// ships that sail the harbour and the open sea. Drawn on each screen alone; nothing here touches the game state.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { CAR_LANES, SHIP_ROUTES, greenFor, lanePoint, type Lane, type ShipKind, type ShipRoute } from '@byzantine-council/shared/city';
import { prism, fan, P } from '../beach/beachArt.js';
import { ART_SCALE, worldToScreen } from '../game/iso.js';
import { shade } from '../game/palette.js';
import { drawModernCar } from './carArt.js';

const CAR_SPEED = 2.8;
const CAR_ACCEL = 5;
const CAR_LENGTH = 1.5;
const GAP = 1.1;
const PEOPLE_GAP = 1.4;
const SPAWN_CLEAR = 4;
// Cars fade in and out over this many tiles at the ends of their lane, where roads meet the sea.
const FADE = 1.5;
export const CAR_COLORS = [0xd9534f, 0x4f8fd9, 0xf0c05a, 0x5fb87a, 0xe9e2d6, 0x8a5fd9, 0x3b3f4a, 0xf08a4b];

interface Car {
  readonly g: Phaser.GameObjects.Graphics;
  lane: Lane;
  s: number;
  v: number;
  color: number;
}

interface Ship {
  readonly g: Phaser.GameObjects.Graphics;
  readonly route: ShipRoute;
  leg: number;
  pos: Vec2;
  heading: string;
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
      if ((this.#byLane.get(lane) ?? []).some((c) => Math.abs(c.s - s) < CAR_LENGTH + GAP + 1)) continue;
      this.#addCar(lane, s, CAR_COLORS[i % CAR_COLORS.length] ?? 0xd9534f);
    }
    SHIP_ROUTES.forEach((route, i) => {
      const g = new Phaser.GameObjects.Graphics(scene);
      layer.add(g);
      const start = route.points[0] ?? { x: 0, y: 0 };
      this.#ships.push({ g, route, leg: 0, pos: { ...start }, heading: '', phase: i * 1.3 });
    });
  }

  update(time: number, delta: number, people: readonly Vec2[], sees: (p: Vec2) => boolean): void {
    const dt = Math.min(delta, 50) / 1000;
    const now = Date.now();
    const view = this.scene.cameras.main.worldView;
    const onScreen = (p: { x: number; y: number }): boolean => p.x > view.x - 300 && p.x < view.right + 300 && p.y > view.y - 300 && p.y < view.bottom + 300;
    for (const car of this.#cars) this.#drive(car, dt, now, people);
    for (const car of this.#cars) {
      const ahead = (car.s - car.lane.to) * car.lane.dir;
      if (ahead >= 0) this.#respawn(car);
    }
    for (const car of this.#cars) {
      const p = lanePoint(car.lane, car.s);
      const s = worldToScreen(p.x, p.y);
      const shown = onScreen(s) && sees(p);
      car.g.setVisible(shown);
      if (!shown) continue;
      const edge = Math.min(Math.abs(car.s - car.lane.from), Math.abs(car.lane.to - car.s));
      car.g.setPosition(s.x, s.y).setDepth(this.depthOf(p.x, p.y)).setAlpha(Math.max(0, Math.min(1, edge / FADE)));
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

  #addCar(lane: Lane, s: number, color: number): void {
    const g = new Phaser.GameObjects.Graphics(this.scene);
    this.layer.add(g);
    drawModernCar(g, laneHeading(lane), color);
    const car: Car = { g, lane, s, v: CAR_SPEED, color };
    this.#cars.push(car);
    const list = this.#byLane.get(lane) ?? [];
    list.push(car);
    this.#byLane.set(lane, list);
  }

  // How far a car may still go: up to the car in front, anyone in the road, or a red light's stop line.
  #drive(car: Car, dt: number, now: number, people: readonly Vec2[]): void {
    const { lane } = car;
    let room = Infinity;
    for (const other of this.#byLane.get(lane) ?? []) {
      if (other === car) continue;
      const d = (other.s - car.s) * lane.dir;
      if (d > 0) room = Math.min(room, d - CAR_LENGTH - GAP);
    }
    for (const p of people) {
      const across = lane.axis === 'col' ? Math.abs(p.x - lane.at) : Math.abs(p.y - lane.at);
      if (across > 0.75) continue;
      const d = ((lane.axis === 'col' ? p.y : p.x) - car.s) * lane.dir;
      if (d > 0) room = Math.min(room, d - CAR_LENGTH / 2 - PEOPLE_GAP);
    }
    if (!greenFor(lane.axis, now)) {
      for (const [a, b] of lane.crossings) {
        const entry = lane.dir === 1 ? a : b;
        const d = (entry - car.s) * lane.dir;
        if (d > CAR_LENGTH / 2 - 0.05) room = Math.min(room, d - CAR_LENGTH / 2 - 0.1);
      }
    }
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
      if ((this.#byLane.get(lane) ?? []).some((c) => Math.abs(c.s - lane.from) < SPAWN_CLEAR)) continue;
      car.lane = lane;
      car.s = lane.from;
      car.v = CAR_SPEED;
      break;
    }
    const list = this.#byLane.get(car.lane) ?? [];
    list.push(car);
    this.#byLane.set(car.lane, list);
    drawModernCar(car.g, laneHeading(car.lane), car.color);
  }

  #sail(ship: Ship, dt: number): void {
    const pts = ship.route.points;
    let budget = ship.route.speed * dt;
    while (budget > 0) {
      const target = pts[(ship.leg + 1) % pts.length] ?? ship.pos;
      const dx = target.x - ship.pos.x;
      const dy = target.y - ship.pos.y;
      const dist = Math.hypot(dx, dy);
      const heading = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : dy >= 0 ? 's' : 'n';
      if (heading !== ship.heading) {
        ship.heading = heading;
        drawShip(ship.g, ship.route.kind, heading === 'e' || heading === 'w');
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

// A car along its lane: east or west on a row, south or north on a column.
const laneHeading = (lane: Lane): number => (lane.axis === 'row' ? (lane.dir === 1 ? 0 : Math.PI) : lane.dir === 1 ? Math.PI / 2 : -Math.PI / 2);

// Ships by kind, long along the way they sail.
function drawShip(g: Phaser.GameObjects.Graphics, kind: ShipKind, eastWest: boolean): void {
  const [length, beam] = ({ ferry: [2.6, 0.9], sailboat: [1.4, 0.5], fishing: [1.6, 0.6], cargo: [4.2, 1.2] } as const)[kind];
  const [l, w] = [length / 2, beam / 2];
  const box = (a: number, b: number, c: number, d: number): [number, number, number, number] => (eastWest ? [a, b, c, d] : [b, a, d, c]);
  g.clear();
  g.fillStyle(0xffffff, 0.25);
  const wake = P(0, 0, 0);
  g.fillEllipse(wake.x, wake.y + 2 * ART_SCALE, (length + 0.6) * 40 * ART_SCALE, (beam + 0.4) * 26 * ART_SCALE);
  const hull = { ferry: 0xe9e2d6, sailboat: 0xf6efe2, fishing: 0x3f7fa8, cargo: 0x9e3b32 }[kind];
  prism(g, ...box(-l, -w, l, w), 0, kind === 'cargo' ? 14 : 8, hull, shade(hull, 0.15));
  if (kind === 'ferry') {
    prism(g, ...box(-l + 0.3, -w + 0.12, l - 0.5, w - 0.12), 8, 14, 0xf6efe2);
    prism(g, ...box(-l + 0.4, -w + 0.2, l - 0.7, w - 0.2), 22, 8, 0x4f8fd9);
    prism(g, ...box(-0.15, -0.12, 0.15, 0.12), 30, 14, 0xe8a03a);
  } else if (kind === 'cargo') {
    const colors = [0xd9534f, 0x4f8fd9, 0xf0c05a, 0x5fb87a, 0x8a5fd9];
    for (let i = 0; i < 5; i++) prism(g, ...box(-l + 0.5 + i * 0.6, -w + 0.15, -l + 1.0 + i * 0.6, w - 0.15), 14, 10, colors[i] ?? 0xd9534f);
    prism(g, ...box(l - 0.8, -w + 0.15, l - 0.2, w - 0.15), 14, 22, 0xf6efe2);
  } else if (kind === 'fishing') {
    prism(g, ...box(-l + 0.2, -w + 0.1, 0, w - 0.1), 8, 12, 0xf6efe2);
    const top = P(0.3, 0, 40);
    const base = P(0.3, 0, 8);
    g.lineStyle(2 * ART_SCALE, 0x4a3a2a, 1);
    g.lineBetween(base.x, base.y, top.x, top.y);
  } else {
    const base = P(0, 0, 8);
    const top = P(0, 0, 70);
    g.lineStyle(2 * ART_SCALE, 0x6b5a48, 1);
    g.lineBetween(base.x, base.y, top.x, top.y);
    const tip = eastWest ? P(l - 0.1, 0, 12) : P(0, l - 0.1, 12);
    fan(g, 0xfff8ee, [top, base, tip]);
  }
}
