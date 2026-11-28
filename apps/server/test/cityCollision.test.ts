import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, isBlocked } from '@byzantine-council/shared';
import {
  BUILDING_DOORS,
  CAR_HALF_LENGTH,
  CITY_MAP,
  CITY_MESSAGES,
  CITY_ROOM,
  CITY_SPAWNS,
  COLLISION_TUNING,
  CityState,
  DoorResultSchema,
  carBlockedByMap,
  carsOverlap,
  layoutFor,
  roomMap,
  toWorld,
  type DoorResult,
} from '@byzantine-council/shared/city';
import type { CityRoom } from '../src/city/CityRoom.js';
import { sdk, sleep, startServer, waitFor } from './helpers.js';

const PORT = 3913;
const { minDistance } = COLLISION_TUNING.crowd;
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64 }));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const gap = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const [shopA, shopB] = BUILDING_DOORS.filter((d) => d.room === 'shop');

async function join(name: string) {
  const client = await sdk(PORT).joinOrCreate<CityState>(CITY_ROOM, { nickname: name }, CityState);
  await waitFor(() => client.state.players.has(client.sessionId), 'joined');
  const room = colyseus.getRoomById<CityRoom>(client.roomId);
  room.toughsOff();
  const me = room.state.players.get(client.sessionId);
  if (me === undefined) throw new Error('me');
  const doors: DoorResult[] = [];
  client.onMessage(CITY_MESSAGES.DOOR, (m: unknown) => doors.push(DoorResultSchema.parse(m)));
  return { client, room, me, doors };
}

async function enter(g: Awaited<ReturnType<typeof join>>, door: (typeof BUILDING_DOORS)[number] | undefined): Promise<void> {
  if (door === undefined) throw new Error('no such door');
  g.me.x = door.at.x;
  g.me.y = door.at.y;
  g.client.send('enter');
  await waitFor(() => g.doors.some((d) => d.ok && d.reason === 'in'), 'inside');
}

// A room spot open in both shops, so guardians in each can stand on the very same world point.
function sharedSpot(): { x: number; y: number } {
  const a = layoutFor('shop', shopA?.building.seed ?? 0);
  const b = layoutFor('shop', shopB?.building.seed ?? 0);
  const ma = roomMap(a);
  const mb = roomMap(b);
  for (let r = 1; r < Math.min(a.d, b.d) - 1; r++) {
    for (let c = 1; c < Math.min(a.w, b.w) - 1; c++) {
      const local = { x: c + 0.5, y: r + 0.5 };
      const room = [-minDistance / 2, 0, minDistance / 2].map((dx) => ({ x: local.x + dx, y: local.y }));
      if (room.every((p) => !isBlocked(ma, p, PLAYER_RADIUS) && !isBlocked(mb, p, PLAYER_RADIUS))) return toWorld(local);
    }
  }
  throw new Error('no spot open in both shops');
}

describe('guardians on foot', () => {
  it('pushes two guardians standing on top of each other apart, onto open ground', async () => {
    const a = await join('Ana');
    const b = await join('Bo');
    const spot = CITY_SPAWNS[0] ?? { x: 73, y: 63 };
    for (const g of [a, b]) {
      g.me.x = spot.x;
      g.me.y = spot.y;
    }
    await waitFor(() => gap(a.me, b.me) >= minDistance - 1e-6, 'pushed apart');
    expect(isBlocked(CITY_MAP, a.me, PLAYER_RADIUS)).toBe(false);
    expect(isBlocked(CITY_MAP, b.me, PLAYER_RADIUS)).toBe(false);
    await waitFor(() => b.client.state.players.get(a.client.sessionId)?.x === a.me.x, 'the push reaches the clients');
  });

  it('pushes guardians apart in the same room, and never someone in another place', async () => {
    const a = await join('Ana');
    const b = await join('Bo');
    const c = await join('Cy');
    await enter(a, shopA);
    await enter(b, shopA);
    await enter(c, shopB);
    const spot = sharedSpot();
    for (const g of [a, b, c]) {
      g.me.x = spot.x;
      g.me.y = spot.y;
    }
    await waitFor(() => gap(a.me, b.me) >= minDistance - 1e-6, 'pushed apart in the shop');
    await sleep(300);
    expect(c.me.x).toBe(spot.x);
    expect(c.me.y).toBe(spot.y);
    expect(a.me.inside).toBe(shopA?.building.seed);
    expect(b.me.inside).toBe(shopA?.building.seed);
  });
});

describe('cars', () => {
  it('stops a car driven at another car against it instead of through it', async () => {
    const d = await join('Driver');
    const cars = d.room.carList();
    const open = cars.find((car) => {
      const ahead = { x: Math.cos(car.heading), y: Math.sin(car.heading) };
      return Array.from({ length: 8 }, (_, i) => (i + 1) * 0.5).every((t) => !carBlockedByMap({ x: car.x + ahead.x * t, y: car.y + ahead.y * t }));
    });
    const other = cars.find((car) => car !== open);
    if (open === undefined || other === undefined) throw new Error('no car with open road ahead');
    const ahead = { x: Math.cos(open.heading), y: Math.sin(open.heading) };
    d.me.x = open.x + Math.cos(open.heading + Math.PI / 2);
    d.me.y = open.y + Math.sin(open.heading + Math.PI / 2);
    d.client.send('ride');
    await waitFor(() => d.me.car === open.id, 'in the car');
    const target = { x: open.x + ahead.x * 3, y: open.y + ahead.y * 3, heading: open.heading };
    d.room.placeCar(other.id, target.x, target.y, target.heading);
    const end = Date.now() + 1500;
    while (Date.now() < end) {
      d.client.send('drive', { throttle: 1, steer: 0 });
      await sleep(50);
    }
    const driven = d.room.carList().find((car) => car.id === open.id);
    const parked = d.room.carList().find((car) => car.id === other.id);
    if (driven === undefined || parked === undefined) throw new Error('cars');
    expect(gap(driven, open)).toBeGreaterThan(0.5);
    expect(carsOverlap(driven, parked)).toBe(false);
    expect(gap(driven, parked)).toBeLessThan(2 * CAR_HALF_LENGTH + 0.3);
    expect(parked).toMatchObject({ x: target.x, y: target.y, driver: '' });
  });
});
