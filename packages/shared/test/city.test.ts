import { describe, expect, it, vi } from 'vitest';
import {
  BUILDING_KINDS,
  CHUNK,
  CITY_BUILDINGS,
  CITY_DISTRICTS,
  CITY_HEIGHT,
  CITY_MAP,
  CITY_SPAWNS,
  CITY_WALKABLE,
  CITY_WIDTH,
  DISTRICT_IDS,
  INTEREST_HIDE,
  INTEREST_SHOW,
  MAX_HEALTH,
  MAX_POCKET,
  MINT_HALL,
  PUNCH_RANGE,
  REGEN_DELAY_MS,
  ROUGH_DISTRICTS,
  ROUGH_STREETS,
  VAULT_DAILY_LIMIT,
  VAULT_DOOR,
  CAR_LANES,
  CAR_REVERSE_SPEED,
  CAR_TOP_SPEED,
  PARKING,
  carBlockedByMap,
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  DrivePayloadSchema,
  carsSolid,
  controls,
  driveControls,
  stepCar,
  touchesCar,
  LIGHT_CYCLE_MS,
  SHIP_ROUTES,
  SIGHT_TOUCH,
  greenFor,
  lanePoint,
  afterPunch,
  clearLine,
  inSight,
  atVault,
  canHit,
  canPickUp,
  chunkOf,
  chunksAround,
  depositable,
  districtAt,
  isRough,
  keepsInView,
  pickTarget,
  regenerate,
  takeFromPile,
  type Fighter,
} from '../src/city/index.js';
import { isWalkableTile, tileAt } from '../src/map.js';
import { canStand, findPath } from '../src/pathfinding.js';
import { PLAYER_RADIUS, stepMovement } from '../src/movement.js';

const walkable = (c: number, r: number): boolean => isWalkableTile(CITY_MAP, c, r);

describe('Port Concord map', () => {
  it('is 128 x 128 with a void rim', () => {
    expect(CITY_MAP.width).toBe(CITY_WIDTH);
    expect(CITY_MAP.height).toBe(CITY_HEIGHT);
    expect(CITY_MAP.rows).toHaveLength(CITY_HEIGHT);
    for (const row of CITY_MAP.rows) expect(row).toHaveLength(CITY_WIDTH);
    for (let i = 0; i < CITY_WIDTH; i++) {
      expect(tileAt(CITY_MAP, i, 0)).toBe('#');
      expect(tileAt(CITY_MAP, i, CITY_HEIGHT - 1)).toBe('#');
      expect(tileAt(CITY_MAP, 0, i)).toBe('#');
      expect(tileAt(CITY_MAP, CITY_WIDTH - 1, i)).toBe('#');
    }
  });

  it('is the same map every time it is built', async () => {
    vi.resetModules();
    const again = await import('../src/city/map.js');
    expect(again.CITY_MAP).not.toBe(CITY_MAP);
    expect(again.CITY_MAP.rows).toEqual(CITY_MAP.rows);
  });

  it('only walks on the city tiles the movement rules know', () => {
    for (const t of CITY_WALKABLE) expect(isWalkableTile({ width: 1, height: 1, rows: [t] }, 0, 0)).toBe(true);
  });

  it('is one connected city: every walkable tile reaches every other', () => {
    const W = CITY_WIDTH;
    const total = CITY_MAP.rows.join('').split('').filter((t) => CITY_WALKABLE.includes(t)).length;
    const start = CITY_SPAWNS[0];
    if (start === undefined) throw new Error('spawn');
    const seen = new Set<number>([Math.floor(start.y) * W + Math.floor(start.x)]);
    const queue = [...seen];
    while (queue.length > 0) {
      const i = queue.pop() ?? 0;
      const c = i % W;
      const r = (i - c) / W;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = (r + dr) * W + c + dc;
        if (!seen.has(n) && walkable(c + dc, r + dr)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(total);
    // Big enough to explore: many times a match arena.
    expect(total).toBeGreaterThan(5000);
  });

  it('spawns everyone on their own standable spot', () => {
    expect(CITY_SPAWNS.length).toBeGreaterThanOrEqual(8);
    for (const s of CITY_SPAWNS) expect(canStand(CITY_MAP, s)).toBe(true);
  });

  it('reaches every district on foot from the spawn', () => {
    const start = CITY_SPAWNS[0];
    if (start === undefined) throw new Error('spawn');
    for (const d of CITY_DISTRICTS) {
      let target: { x: number; y: number } | null = null;
      for (let r = d.box.r0; r <= d.box.r1 && target === null; r++) {
        for (let c = d.box.c0; c <= d.box.c1 && target === null; c++) if (canStand(CITY_MAP, { x: c + 0.5, y: r + 0.5 })) target = { x: c + 0.5, y: r + 0.5 };
      }
      expect(target, d.id).not.toBeNull();
      if (target !== null) expect(findPath(CITY_MAP, start, target).ok, d.id).toBe(true);
    }
  });

  it('names a district for every tile, and every district is on the map', () => {
    expect(new Set(CITY_DISTRICTS.map((d) => d.id))).toEqual(new Set(DISTRICT_IDS));
    for (let r = 1; r < CITY_HEIGHT - 1; r += 7) for (let c = 1; c < CITY_WIDTH - 1; c += 7) expect(districtAt({ x: c + 0.5, y: r + 0.5 })).not.toBeNull();
    expect(districtAt({ x: -3, y: 4 })).toBeNull();
  });

  it('marks every building on the map, without overlaps, and has each landmark once', () => {
    const owner = new Map<string, number>();
    CITY_BUILDINGS.forEach((b, i) => {
      expect(BUILDING_KINDS).toContain(b.kind);
      for (let r = b.box.r0; r <= b.box.r1; r++) {
        for (let c = b.box.c0; c <= b.box.c1; c++) {
          expect(tileAt(CITY_MAP, c, r)).toBe('B');
          expect(owner.has(`${String(c)},${String(r)}`)).toBe(false);
          owner.set(`${String(c)},${String(r)}`, i);
        }
      }
    });
    for (const kind of ['mintHall', 'gateTower', 'cityHall', 'hospital', 'fishMarket', 'lighthouse', 'radioMast', 'gatehouse'] as const) {
      expect(CITY_BUILDINGS.filter((b) => b.kind === kind), kind).toHaveLength(1);
    }
    // Every B tile belongs to a building the client knows how to draw.
    let tiles = 0;
    for (const row of CITY_MAP.rows) for (const t of row) if (t === 'B') tiles++;
    expect(tiles).toBe(owner.size);
  });
});

describe('interest management', () => {
  it('shows players inside the near range and keeps them until the far range', () => {
    const me = { x: 50, y: 50 };
    expect(keepsInView(me, { x: 50 + INTEREST_SHOW, y: 50 }, false)).toBe(true);
    expect(keepsInView(me, { x: 50 + INTEREST_SHOW + 1, y: 50 }, false)).toBe(false);
    // Already visible: kept a little further out, so walking along the edge doesn't flicker.
    expect(keepsInView(me, { x: 50 + INTEREST_SHOW + 1, y: 50 }, true)).toBe(true);
    expect(keepsInView(me, { x: 50, y: 50 + INTEREST_HIDE + 0.5 }, true)).toBe(false);
  });

  it('streams chunks nearest first and never off the map', () => {
    expect(chunkOf({ x: CHUNK * 2 + 0.5, y: 3 })).toEqual({ cx: 2, cy: 0 });
    const keys = chunksAround({ x: 1, y: 1 }, 1, CITY_WIDTH, CITY_HEIGHT);
    expect(keys[0]).toBe('0,0');
    expect(keys).toHaveLength(4);
    const middle = chunksAround({ x: 64, y: 64 }, 2, CITY_WIDTH, CITY_HEIGHT);
    expect(middle).toHaveLength(25);
    expect(middle[0]).toBe('4,4');
  });
});

describe('street fights', () => {
  const at = (x: number, y: number, extra: Partial<Fighter> = {}): Fighter => ({ x, y, health: MAX_HEALTH, knockedOutUntil: 0, shieldUntil: 0, ...extra });
  const street = ROUGH_STREETS.find((p) => districtAt(p)?.id === 'lowtide');
  if (street === undefined) throw new Error('no rough street');
  const safe = CITY_SPAWNS[0];
  if (safe === undefined) throw new Error('spawn');

  it('marks the four rough districts and keeps the spawn safe', () => {
    expect([...ROUGH_DISTRICTS].sort()).toEqual(['docks', 'gullmoor', 'lowtide', 'shallows']);
    expect(isRough(safe)).toBe(false);
    expect(ROUGH_STREETS.length).toBeGreaterThan(500);
    for (const p of ROUGH_STREETS) {
      expect(isRough(p)).toBe(true);
      expect(walkable(Math.floor(p.x), Math.floor(p.y))).toBe(true);
    }
  });

  it('only lands punches on rough streets, in reach, on someone awake and unshielded', () => {
    const me = at(street.x, street.y);
    expect(canHit(me, at(street.x + 1, street.y), 0)).toBe(true);
    expect(canHit(me, at(street.x + PUNCH_RANGE + 0.1, street.y), 0)).toBe(false);
    expect(canHit(me, at(street.x + 1, street.y, { shieldUntil: 10 }), 5)).toBe(false);
    expect(canHit(me, at(street.x + 1, street.y, { knockedOutUntil: 10 }), 5)).toBe(false);
    expect(canHit(at(street.x, street.y, { knockedOutUntil: 10 }), at(street.x + 1, street.y), 5)).toBe(false);
    expect(canHit(at(safe.x, safe.y), at(safe.x + 1, safe.y), 0)).toBe(false);
  });

  it('picks the nearest target it can hit', () => {
    const me = at(street.x, street.y);
    const others: [string, Fighter][] = [
      ['far', at(street.x + 1.4, street.y)],
      ['near', at(street.x + 0.5, street.y)],
      ['shielded', at(street.x + 0.2, street.y, { shieldUntil: 99 })],
    ];
    expect(pickTarget(me, others, 1)).toBe('near');
    expect(pickTarget(me, [], 1)).toBeNull();
  });

  it('knocks out after four punches and heals only after a quiet spell', () => {
    let health = MAX_HEALTH;
    let out = false;
    for (let i = 0; i < 4; i++) ({ health, knockedOut: out } = afterPunch(health));
    expect(health).toBe(0);
    expect(out).toBe(true);
    expect(regenerate(50, 1000, 1000 + REGEN_DELAY_MS - 1, 1)).toBe(50);
    expect(regenerate(50, 1000, 1000 + REGEN_DELAY_MS, 1)).toBe(60);
    expect(regenerate(98, 0, REGEN_DELAY_MS, 1)).toBe(MAX_HEALTH);
  });

  it('fills a pocket up to its limit and leaves the rest on the ground', () => {
    expect(takeFromPile(0, 30)).toEqual({ pocket: 30, left: 0 });
    expect(takeFromPile(MAX_POCKET - 10, 30)).toEqual({ pocket: MAX_POCKET, left: 20 });
    expect(canPickUp({ x: 1, y: 1 }, { x: 1.5, y: 1.5 })).toBe(true);
    expect(canPickUp({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
  });
});

describe('the Mint vault', () => {
  it('has its door on a street in the safe Mint district', () => {
    expect(MINT_HALL.kind).toBe('mintHall');
    expect(canStand(CITY_MAP, VAULT_DOOR)).toBe(true);
    expect(districtAt(VAULT_DOOR)?.id).toBe('mint');
    expect(isRough(VAULT_DOOR)).toBe(false);
    expect(atVault(VAULT_DOOR)).toBe(true);
    const spawn = CITY_SPAWNS[0];
    if (spawn === undefined) throw new Error('spawn');
    expect(atVault(spawn)).toBe(false);
    expect(findPath(CITY_MAP, spawn, VAULT_DOOR).ok).toBe(true);
  });

  it('takes the pocket up to what is left of today', () => {
    expect(depositable(120, 0)).toBe(120);
    expect(depositable(120, VAULT_DAILY_LIMIT - 20)).toBe(20);
    expect(depositable(120, VAULT_DAILY_LIMIT)).toBe(0);
    expect(depositable(0, 0)).toBe(0);
  });
});

describe('line of sight', () => {
  const tower = CITY_BUILDINGS.find((b) => b.kind === 'gateTower');
  if (tower === undefined) throw new Error('tower');
  const { c0, r0, c1, r1 } = tower.box;
  const midX = (c0 + c1 + 1) / 2;
  const north = { x: midX, y: r0 - 1.5 };
  const south = { x: midX, y: r1 + 2.5 };

  it('stops at buildings and nowhere else', () => {
    expect(clearLine(north, south)).toBe(false);
    expect(inSight(north, south)).toBe(false);
    expect(inSight(north, { x: midX + 3, y: north.y })).toBe(true);
    let tree: { c: number; r: number } | undefined;
    for (let r = 0; r < CITY_HEIGHT && tree === undefined; r++) for (let c = 1; c < CITY_WIDTH - 1 && tree === undefined; c++) if (tileAt(CITY_MAP, c, r) === 'T' && walkable(c - 1, r) && walkable(c + 1, r)) tree = { c, r };
    if (tree === undefined) throw new Error('tree');
    expect(clearLine({ x: tree.c - 0.5, y: tree.r + 0.5 }, { x: tree.c + 1.5, y: tree.r + 0.5 })).toBe(true);
  });

  it('looks past open market stalls', () => {
    const stall = CITY_BUILDINGS.find((b) => b.kind === 'stall');
    if (stall === undefined) throw new Error('stall');
    const y = (stall.box.r0 + stall.box.r1 + 1) / 2;
    expect(clearLine({ x: stall.box.c0 - 1.5, y }, { x: stall.box.c1 + 2.5, y })).toBe(true);
  });

  it('sees someone right beside you even round a corner, and half a body past one', () => {
    const corner = { x: c0 - 0.5, y: r0 - 0.5 };
    expect(inSight(corner, { x: c0 - 0.5 + SIGHT_TOUCH * 0.7, y: r0 - 0.5 + SIGHT_TOUCH * 0.7 })).toBe(true);
    const eye = { x: c0 - 3, y: r0 + 1.5 };
    const peeking = { x: c0 + 1.5, y: r0 - 0.6 };
    expect(clearLine(eye, peeking)).toBe(false);
    expect(inSight(eye, peeking)).toBe(true);
  });
});

describe('traffic', () => {
  it('runs every car lane down the middle of a road, both ways on every road', () => {
    expect(CAR_LANES.length).toBeGreaterThan(20);
    for (const lane of CAR_LANES) {
      const lo = Math.min(lane.from, lane.to);
      const hi = Math.max(lane.from, lane.to);
      for (let s = lo + 0.25; s < hi; s += 0.5) {
        const p = lanePoint(lane, s);
        expect([':', '='], `${lane.axis} ${String(lane.at)} at ${String(s)}`).toContain(tileAt(CITY_MAP, Math.floor(p.x), Math.floor(p.y)));
      }
      for (const [a, b] of lane.crossings) expect(b - a).toBe(2);
    }
    expect(new Set(CAR_LANES.map((l) => l.dir))).toEqual(new Set([1, -1]));
  });

  it('never shows green both ways at a crossing', () => {
    for (let t = 0; t < LIGHT_CYCLE_MS; t += 100) expect(greenFor('col', t) && greenFor('row', t)).toBe(false);
    expect(greenFor('col', 1000)).toBe(true);
    expect(greenFor('row', 9000)).toBe(true);
  });

  it('sails every ship route on open water, clear of piers and the shore', () => {
    for (const route of SHIP_ROUTES) {
      const pts = route.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a === undefined || b === undefined) throw new Error('route');
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4);
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const y = a.y + ((b.y - a.y) * k) / steps;
          for (const [dx, dy] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]] as const) expect(tileAt(CITY_MAP, Math.floor(x + dx), Math.floor(y + dy)), `${route.kind} ${String(x)},${String(y)}`).toBe('~');
        }
      }
    }
  });
});

describe('cars', () => {
  const open = (): boolean => false;
  const drive = (want: { x: number; y: number }, seconds: number, start = { x: 0, y: 0, heading: 0, speed: 0 }, blocked: (p: { x: number; y: number }) => boolean = open) => {
    let car = start;
    for (let t = 0; t < seconds; t += 0.05) {
      const c = controls(car.heading, car.speed, want);
      car = stepCar(car, c.throttle, c.steer, 0.05, blocked);
    }
    return car;
  };

  it('speeds up toward top speed and coasts to a stop', () => {
    const fast = drive({ x: 1, y: 0 }, 3);
    expect(fast.speed).toBeCloseTo(CAR_TOP_SPEED, 1);
    expect(fast.x).toBeGreaterThan(10);
    expect(Math.abs(fast.y)).toBeLessThan(0.01);
    expect(drive({ x: 0, y: 0 }, 3, fast).speed).toBe(0);
  });

  it('turns toward where the driver points, and backs up when that is behind', () => {
    const turned = drive({ x: 0, y: 1 }, 2, { x: 0, y: 0, heading: 0, speed: 4 });
    expect(Math.abs(turned.heading - Math.PI / 2)).toBeLessThan(0.15);
    const back = drive({ x: -1, y: 0 }, 1.5);
    expect(back.speed).toBeLessThan(0);
    expect(back.speed).toBeGreaterThanOrEqual(-CAR_REVERSE_SPEED);
    expect(back.x).toBeLessThan(0);
  });

  it('stops dead against a wall', () => {
    const wall = (p: { x: number; y: number }): boolean => p.x > 3;
    const out = drive({ x: 1, y: 0 }, 3, undefined, wall);
    expect(out.x).toBeLessThanOrEqual(3);
    expect(out.speed).toBe(0);
  });

  it('parks cars kerbside in every district and by the arrival point, clear of walls', () => {
    expect(PARKING.length).toBeGreaterThanOrEqual(14);
    for (const p of PARKING) expect(carBlockedByMap(p)).toBe(false);
    const arrival = CITY_SPAWNS[0];
    if (arrival === undefined) throw new Error('spawn');
    expect(PARKING.some((p) => Math.hypot(p.x - arrival.x, p.y - arrival.y) < 8)).toBe(true);
    for (const d of CITY_DISTRICTS) expect(PARKING.some((p) => districtAt(p)?.id === d.id), d.id).toBe(true);
  });

  it('drives with pedal and wheel from the keyboard: straight on gas, turning right on positive steer, and back on reverse', () => {
    const pedal = (throttle: number, steer: number, seconds: number, start = { x: 0, y: 0, heading: 0, speed: 0 }) => {
      let car = start;
      for (let t = 0; t < seconds; t += 0.05) {
        const c = driveControls(car.heading, car.speed, { throttle, steer });
        car = stepCar(car, c.throttle, c.steer, 0.05, open);
      }
      return car;
    };
    const straight = pedal(1, 0, 2);
    expect(straight.x).toBeGreaterThan(5);
    expect(Math.abs(straight.y)).toBeLessThan(1e-9);
    expect(straight.heading).toBe(0);
    expect(pedal(1, 1, 0.5).heading).toBeGreaterThan(0);
    expect(pedal(1, -1, 0.5).heading).toBeLessThan(0);
    expect(pedal(-1, 0, 2).x).toBeLessThan(-1);
    expect(driveControls(0, 0, { throttle: 3, steer: -3 })).toStrictEqual({ throttle: 1, steer: -1 });
    expect(driveControls(0, 0, { dx: 1, dy: 0 })).toStrictEqual(controls(0, 0, { x: 1, y: 0 }));
  });

  it('gives a car a solid body that walkers bump into, but never traps someone already against it', () => {
    const car = { x: 10.5, y: 10.5, heading: 0 };
    expect(touchesCar(car, { x: 10.5 + CAR_HALF_LENGTH + 0.2, y: 10.5 }, 0.3)).toBe(true);
    expect(touchesCar(car, { x: 10.5 + CAR_HALF_LENGTH + 0.35, y: 10.5 }, 0.3)).toBe(false);
    expect(touchesCar(car, { x: 10.5, y: 10.5 + CAR_HALF_WIDTH + 0.2 }, 0.3)).toBe(true);
    expect(touchesCar({ ...car, heading: Math.PI / 2 }, { x: 10.5, y: 10.5 + CAR_HALF_LENGTH + 0.2 }, 0.3)).toBe(true);
    const open = { width: 21, height: 21, rows: Array.from({ length: 21 }, () => '.'.repeat(21)) };
    let pos = { x: 6.5, y: 10.5 };
    for (let i = 0; i < 40; i++) pos = stepMovement(pos, { x: 1, y: 0 }, 0.05, open, carsSolid([car], pos, PLAYER_RADIUS));
    expect(pos.x).toBeLessThan(10.5 - CAR_HALF_LENGTH);
    expect(touchesCar(car, pos, PLAYER_RADIUS)).toBe(false);
    const inside = { x: 10.5, y: 10.6 };
    const out = stepMovement(inside, { x: 0, y: 1 }, 0.05, open, carsSolid([car], inside, PLAYER_RADIUS));
    expect(out.y).toBeGreaterThan(inside.y);
  });

  it('accepts a stick direction or pedal and wheel, never a mix or out-of-range values', () => {
    expect(DrivePayloadSchema.safeParse({ dx: 0.5, dy: -1 }).success).toBe(true);
    expect(DrivePayloadSchema.safeParse({ throttle: 1, steer: -0.5 }).success).toBe(true);
    for (const bad of [{ dx: 1, dy: 0, throttle: 1 }, { throttle: 2, steer: 0 }, { steer: 1 }, {}]) expect(DrivePayloadSchema.safeParse(bad).success).toBe(false);
  });
});
