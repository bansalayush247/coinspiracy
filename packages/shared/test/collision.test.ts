import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/map.js';
import { PLAYER_RADIUS } from '../src/movement.js';
import { COLLISION_TUNING, CollisionTuningSchema, pushClear, resolveCrowd, type CrowdBody, type PushBlocked } from '../src/city/collision.js';
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, boxesOverlap, carsBlockCar, carsOverlap, stepCar } from '../src/city/vehicle.js';
import raw from '../src/city/tuning/collision.json' with { type: 'json' };

const { minDistance, maxPush } = COLLISION_TUNING.crowd;
const open: PushBlocked = () => false;
const wallWestOf = (x: number): PushBlocked => (_from, to) => to.x < x;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function settle(bodies: CrowdBody[], blocked: PushBlocked, ticks: number): CrowdBody[] {
  let now = bodies;
  for (let i = 0; i < ticks; i++) {
    const moved = resolveCrowd(now, blocked);
    now = now.map((b) => ({ id: b.id, ...(moved.get(b.id) ?? { x: b.x, y: b.y }) }));
  }
  return now;
}

describe('collision tuning', () => {
  it('loads the shipped file and keeps two guardians a body apart', () => {
    expect(CollisionTuningSchema.safeParse(raw).success).toBe(true);
    expect(minDistance).toBeCloseTo(2 * PLAYER_RADIUS);
  });

  it('rejects a tuning file with a missing or negative number', () => {
    expect(CollisionTuningSchema.safeParse({ ...raw, crowd: { minDistance: -1, maxPush } }).success).toBe(false);
    expect(CollisionTuningSchema.safeParse({ crowd: raw.crowd }).success).toBe(false);
  });
});

describe('resolveCrowd', () => {
  it('leaves guardians who are far enough apart where they are', () => {
    expect(resolveCrowd([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 10 + minDistance, y: 10 }], open).size).toBe(0);
    expect(resolveCrowd([{ id: 'a', x: 10, y: 10 }], open).size).toBe(0);
  });

  it('pushes two close guardians apart along the line between them, half each', () => {
    const gap = minDistance / 2;
    const moved = resolveCrowd([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 10, y: 10 + gap }], open);
    const a = moved.get('a');
    const b = moved.get('b');
    if (a === undefined || b === undefined) throw new Error('both should move');
    expect(a.x).toBeCloseTo(10);
    expect(b.x).toBeCloseTo(10);
    expect(10 - a.y).toBeCloseTo(b.y - (10 + gap));
    expect(dist(a, b)).toBeCloseTo(Math.min(minDistance, gap + 2 * maxPush));
  });

  it('never moves anyone more than the push cap in one tick', () => {
    const moved = resolveCrowd([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 10.01, y: 10 }, { id: 'c', x: 10, y: 10.01 }, { id: 'd', x: 10.01, y: 10.01 }], open);
    for (const [id, at] of moved) {
      const start = { a: { x: 10, y: 10 }, b: { x: 10.01, y: 10 }, c: { x: 10, y: 10.01 }, d: { x: 10.01, y: 10.01 } }[id];
      if (start === undefined) throw new Error(id);
      expect(dist(at, start)).toBeLessThanOrEqual(maxPush + 1e-9);
    }
  });

  it('parts guardians on exactly the same spot the same way whatever order they come in', () => {
    const one = resolveCrowd([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 10, y: 10 }], open);
    const two = resolveCrowd([{ id: 'b', x: 10, y: 10 }, { id: 'a', x: 10, y: 10 }], open);
    expect(one).toEqual(two);
    expect(one.get('a')?.x).toBeLessThan(10);
    expect(one.get('b')?.x).toBeGreaterThan(10);
  });

  it('gives the whole push to the guardian who can move when the other is against a wall', () => {
    const moved = resolveCrowd([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 10.2, y: 10 }], wallWestOf(10));
    expect(moved.has('a')).toBe(false);
    expect(moved.get('b')?.x).toBeCloseTo(10.2 + Math.min(minDistance - 0.2, maxPush));
  });

  it('moves nobody when both are pinned', () => {
    const pinned: PushBlocked = (from, to) => dist(from, to) > 0;
    expect(resolveCrowd([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 10.1, y: 10 }], pinned).size).toBe(0);
  });

  it('slides a push along a wall when the straight push would go into it', () => {
    const moved = resolveCrowd([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 10.2, y: 10.2 }], wallWestOf(10));
    const a = moved.get('a');
    expect(a?.x).toBeCloseTo(10);
    expect(a?.y).toBeLessThan(10);
  });

  it('spreads a crowd out over a few ticks until nobody overlaps', () => {
    const crowd = Array.from({ length: 6 }, (_, i) => ({ id: `p${String(i)}`, x: 20 + (i % 2) * 0.05, y: 20 + Math.floor(i / 2) * 0.05 }));
    const after = settle(crowd, open, 60);
    for (const a of after) for (const b of after) if (a.id < b.id) expect(dist(a, b)).toBeGreaterThan(minDistance - 0.02);
  });
});

describe('pushClear', () => {
  it('moves only its own half of the overlap, away from the other guardian', () => {
    const at = pushClear({ id: 'a', x: 10, y: 10 }, [{ id: 'b', x: 10.2, y: 10 }], open);
    expect(at.y).toBeCloseTo(10);
    expect(at.x).toBeCloseTo(10 - Math.min((minDistance - 0.2) / 2, maxPush));
  });

  it('agrees with the server about which way a coincident pair parts', () => {
    const server = resolveCrowd([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 10, y: 10 }], open);
    const asA = pushClear({ id: 'a', x: 10, y: 10 }, [{ id: 'b', x: 10, y: 10 }], open);
    const asB = pushClear({ id: 'b', x: 10, y: 10 }, [{ id: 'a', x: 10, y: 10 }], open);
    expect(asA).toEqual(server.get('a'));
    expect(asB).toEqual(server.get('b'));
  });

  it('ignores itself and anyone far enough away, and never pushes into a wall', () => {
    expect(pushClear({ id: 'a', x: 10, y: 10 }, [{ id: 'a', x: 10, y: 10 }, { id: 'c', x: 11, y: 10 }], open)).toEqual({ x: 10, y: 10 });
    expect(pushClear({ id: 'a', x: 10, y: 10 }, [{ id: 'b', x: 10.2, y: 10 }], wallWestOf(10))).toEqual({ x: 10, y: 10 });
  });
});

describe('car bodies', () => {
  const along = 2 * CAR_HALF_LENGTH;
  const across = 2 * CAR_HALF_WIDTH;

  it('overlaps nose to tail only when the boxes really meet', () => {
    expect(carsOverlap({ x: 0, y: 0, heading: 0 }, { x: along - 0.01, y: 0, heading: 0 })).toBe(true);
    expect(carsOverlap({ x: 0, y: 0, heading: 0 }, { x: along + 0.01, y: 0, heading: 0 })).toBe(false);
  });

  it('lets two cars park side by side closer than their length', () => {
    expect(carsOverlap({ x: 0, y: 0, heading: 0 }, { x: 0, y: across + 0.01, heading: 0 })).toBe(false);
    expect(carsOverlap({ x: 0, y: 0, heading: 0 }, { x: 0, y: across - 0.01, heading: 0 })).toBe(true);
  });

  it('turns the boxes with their headings', () => {
    const tBone = CAR_HALF_LENGTH + CAR_HALF_WIDTH;
    expect(carsOverlap({ x: 0, y: 0, heading: 0 }, { x: tBone - 0.01, y: 0, heading: Math.PI / 2 })).toBe(true);
    expect(carsOverlap({ x: 0, y: 0, heading: 0 }, { x: tBone + 0.01, y: 0, heading: Math.PI / 2 })).toBe(false);
    expect(carsOverlap({ x: 0, y: 0, heading: Math.PI / 4 }, { x: 1.1, y: -1.1, heading: Math.PI / 4 })).toBe(false);
  });

  it('works for boxes of any size', () => {
    const bus = { x: 0, y: 0, heading: 0, halfLength: 1.45, halfWidth: 0.42 };
    expect(boxesOverlap(bus, { x: 2, y: 0, heading: 0, halfLength: 0.6, halfWidth: 0.3 })).toBe(true);
    expect(boxesOverlap(bus, { x: 2.1, y: 0, heading: 0, halfLength: 0.6, halfWidth: 0.3 })).toBe(false);
  });

  it('stops a car driven at another one against its back', () => {
    const parked = { x: 6, y: 0, heading: 0 };
    let car = { x: 0, y: 0, heading: 0, speed: 0 };
    const blocked = carsBlockCar([parked], car);
    let bumped = false;
    for (let i = 0; i < 60; i++) {
      const next = stepCar(car, 1, 0, 0.05, blocked);
      bumped ||= next.bumped;
      car = next;
    }
    expect(bumped).toBe(true);
    expect(car.speed).toBe(0);
    expect(carsOverlap(car, parked)).toBe(false);
    expect(parked.x - car.x).toBeLessThan(along + 0.2);
  });

  it('lets a car already overlapping another drive off it, but not further in', () => {
    const other = { x: 1, y: 0, heading: 0 };
    const from = { x: 0, y: 0, heading: 0 };
    const blocked = carsBlockCar([other], from);
    expect(blocked({ x: -0.1, y: 0 }, 0)).toBe(false);
    expect(blocked({ x: 0.1, y: 0 }, 0)).toBe(true);
    expect(blocked({ x: 0, y: -2 }, 0)).toBe(false);
  });
});
