// Cars anyone can drive in Port Concord. On the keyboard the driver works the pedal and wheel; on the touch stick they
// point where they want to go and the car steers toward it, reversing when it points behind. Cars stop dead against
// walls, water and people. The server runs it; these are the rules it runs.
import { isBlocked, type Vec2 } from '../map.js';
import { CITY_DISTRICTS, CITY_MAP, CITY_SPAWNS } from './map.js';

export const CAR_RADIUS = 0.45;
export const CAR_TOP_SPEED = 8;
export const CAR_REVERSE_SPEED = 3;
export const CAR_ACCEL = 9;
export const CAR_BRAKE = 16;
export const CAR_DRAG = 4;
export const CAR_TURN = 2.8;
export const ENTER_RANGE = 1.8;
// A driver whose input stops arriving (a dropped connection, a closed tab) lets go of the pedal this soon.
export const DRIVE_INPUT_TTL_MS = 300;
// An abandoned car away from its spot is towed back after this long.
export const CAR_TOW_MS = 240_000;
export const CAR_COLORS = 8;

export interface CarBody {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly speed: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// Turns "I want to go that way" into pedal and wheel: steer toward it, or back up when it is behind a slow car.
export function controls(heading: number, speed: number, want: Vec2): { throttle: number; steer: number } {
  const amount = Math.min(1, Math.hypot(want.x, want.y));
  if (amount < 0.2) return { throttle: 0, steer: 0 };
  const diff = wrap(Math.atan2(want.y, want.x) - heading);
  if (Math.abs(diff) > 2.5 && speed < 1) return { throttle: -amount, steer: clamp(-wrap(diff - Math.PI) * 2, -1, 1) };
  return { throttle: amount * (Math.abs(diff) < 1.6 ? 1 : 0.35), steer: clamp(diff * 2.5, -1, 1) };
}

/** Pedal and wheel from a driver's input: passed straight through from the keyboard, steered toward a stick direction. */
export function driveControls(heading: number, speed: number, input: { dx: number; dy: number } | { throttle: number; steer: number }): { throttle: number; steer: number } {
  if ('throttle' in input) return { throttle: clamp(input.throttle, -1, 1), steer: clamp(input.steer, -1, 1) };
  return controls(heading, speed, { x: input.dx, y: input.dy });
}

// One physics step. `blocked` says whether the car's middle may stand somewhere; a blocked move slides along the
// obstacle if it can, and otherwise stops the car.
export function stepCar(car: CarBody, throttle: number, steer: number, dt: number, blocked: (p: Vec2) => boolean): CarBody & { bumped: boolean } {
  const target = throttle >= 0 ? throttle * CAR_TOP_SPEED : throttle * CAR_REVERSE_SPEED;
  const braking = target !== 0 && Math.sign(target) !== Math.sign(car.speed) && car.speed !== 0;
  const rate = throttle === 0 ? CAR_DRAG : braking ? CAR_BRAKE : CAR_ACCEL;
  const gap = target - car.speed;
  let speed = car.speed + clamp(gap, -rate * dt, rate * dt);
  const heading = wrap(car.heading + steer * CAR_TURN * clamp(speed / 2.5, -1, 1) * dt);
  let x = car.x;
  let y = car.y;
  let bumped = false;
  const total = speed * dt;
  const steps = Math.max(1, Math.ceil(Math.abs(total) / 0.15));
  const dx = (Math.cos(heading) * total) / steps;
  const dy = (Math.sin(heading) * total) / steps;
  const slide = Math.hypot(dx, dy) * 0.3;
  for (let i = 0; i < steps; i++) {
    if (!blocked({ x: x + dx, y: y + dy })) {
      x += dx;
      y += dy;
    } else if (Math.abs(dx) > slide && !blocked({ x: x + dx, y })) {
      x += dx;
      speed *= 0.6;
    } else if (Math.abs(dy) > slide && !blocked({ x, y: y + dy })) {
      y += dy;
      speed *= 0.6;
    } else {
      speed = 0;
      bumped = true;
      break;
    }
  }
  return { x, y, heading, speed, bumped };
}

export const carBlockedByMap = (p: Vec2): boolean => isBlocked(CITY_MAP, p, CAR_RADIUS);

/** Half the length and half the width of a car's body, in tiles: the box the art draws. */
export const CAR_HALF_LENGTH = 0.75;
export const CAR_HALF_WIDTH = 0.38;

/** Whether someone of `radius` standing at `p` overlaps a car's body (a box turned to the car's heading). */
export function touchesCar(car: { readonly x: number; readonly y: number; readonly heading: number }, p: Vec2, radius: number): boolean {
  const dx = p.x - car.x;
  const dy = p.y - car.y;
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  return Math.hypot(u - clamp(u, -CAR_HALF_LENGTH, CAR_HALF_LENGTH), v - clamp(v, -CAR_HALF_WIDTH, CAR_HALF_WIDTH)) < radius;
}

/**
 * Cars as solid ground for someone walking from `from`: a step into a car is refused, but anyone already overlapping
 * one (just out of the driver's door, or a car stopped against them) can always walk clear.
 */
export function carsSolid(cars: readonly { readonly x: number; readonly y: number; readonly heading: number }[], from: Vec2, radius: number): (p: Vec2) => boolean {
  const solid = cars.filter((car) => !touchesCar(car, from, radius));
  return (p) => solid.some((car) => touchesCar(car, p, radius));
}

export interface ParkingSpot {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

// Half-tiles a car could roll from `p` along `heading` before a wall or another parked car stops it, up to six tiles.
function clearRun(p: Vec2, heading: number, others: readonly Vec2[]): number {
  let n = 0;
  for (; n < 12; n++) {
    const at = { x: p.x + Math.cos(heading) * (n + 1) * 0.5, y: p.y + Math.sin(heading) * (n + 1) * 0.5 };
    if (carBlockedByMap(at) || others.some((o) => o !== p && Math.hypot(o.x - at.x, o.y - at.y) < CAR_RADIUS * 2)) break;
  }
  return n;
}

const PULL_OUT = 8;

// A parked car faces along its kerb, toward the longer stretch of open road, so it can pull straight out.
const openWay = (p: Vec2, axis: number, others: readonly Vec2[] = []): number =>
  clearRun(p, axis, others) >= clearRun(p, axis + Math.PI, others) ? wrap(axis) : wrap(axis + Math.PI);

// Kerbside spots on open pavement beside a road, a few per district and two by the arrival point, spaced apart.
export const PARKING: readonly ParkingSpot[] = Object.freeze(
  (() => {
    const road = (c: number, r: number): boolean => CITY_MAP.rows[r]?.[c] === ':';
    const spots: ParkingSpot[] = [];
    const far = (p: Vec2, gap: number): boolean => spots.every((s) => Math.hypot(s.x - p.x, s.y - p.y) >= gap);
    const candidates: ParkingSpot[] = [];
    for (let r = 1; r < CITY_MAP.height - 1; r++) {
      for (let c = 1; c < CITY_MAP.width - 1; c++) {
        if (CITY_MAP.rows[r]?.[c] !== '.') continue;
        const p = { x: c + 0.5, y: r + 0.5 };
        if (carBlockedByMap(p)) continue;
        const axis = road(c - 1, r) || road(c + 1, r) ? Math.PI / 2 : road(c, r - 1) || road(c, r + 1) ? 0 : null;
        // Only spots a car can pull straight out of: at least PULL_OUT half-tiles of open kerb one way.
        if (axis !== null && Math.max(clearRun(p, axis, []), clearRun(p, axis + Math.PI, [])) >= PULL_OUT) candidates.push({ ...p, heading: openWay(p, axis) });
      }
    }
    const nearest = (to: Vec2): ParkingSpot[] => [...candidates].sort((a, b) => Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y));
    const arrival = CITY_SPAWNS[0];
    if (arrival !== undefined) for (const s of nearest(arrival)) if (spots.length < 2 && far(s, 6)) spots.push(s);
    for (const d of CITY_DISTRICTS) {
      const mid = { x: (d.box.c0 + d.box.c1 + 1) / 2, y: (d.box.r0 + d.box.r1 + 1) / 2 };
      let added = 0;
      for (const s of nearest(mid)) {
        if (added === 2) break;
        if (s.x < d.box.c0 || s.x > d.box.c1 + 1 || s.y < d.box.r0 || s.y > d.box.r1 + 1 || !far(s, 8)) continue;
        spots.push(s);
        added++;
      }
    }
    // Point each car away from the cars parked ahead of it now that every spot is known.
    return spots.map((s) => Object.freeze({ ...s, heading: openWay(s, Math.abs(Math.sin(s.heading)) > 0.5 ? Math.PI / 2 : 0, spots) }));
  })(),
);
