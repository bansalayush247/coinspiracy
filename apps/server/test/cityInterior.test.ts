import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BUILDING_DOORS, CITY_MESSAGES, CITY_ROOM, CityState, DOOR_TUNING, DepositResultSchema, DoorResultSchema, MAX_HEALTH, ROUGH_STREETS, RestResultSchema, isIndoors, layoutFor, toWorld, type DepositResult, type DoorResult, type RestResult, type RoomSpot } from '@byzantine-council/shared/city';
import type { CityRoom } from '../src/city/CityRoom.js';
import { sdk, startServer, waitFor } from './helpers.js';

const PORT = 3911;
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

const doorsOf = (room: string): (typeof BUILDING_DOORS)[number][] => BUILDING_DOORS.filter((d) => d.room === room);
const [shopA, shopB] = doorsOf('shop');
const [house] = doorsOf('flat');
const [hospital] = doorsOf('hospital');
const [mintHall] = doorsOf('mintHall');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function walkIn(name: string) {
  const client = await sdk(PORT).joinOrCreate<CityState>(CITY_ROOM, { nickname: name }, CityState);
  await waitFor(() => client.state.players.has(client.sessionId), 'joined');
  const room = colyseus.getRoomById<CityRoom>(client.roomId);
  room.toughsOff();
  const me = room.state.players.get(client.sessionId);
  if (me === undefined) throw new Error('me');
  const doors: DoorResult[] = [];
  client.onMessage(CITY_MESSAGES.DOOR, (m: unknown) => doors.push(DoorResultSchema.parse(m)));
  const standAt = (door: (typeof BUILDING_DOORS)[number] | undefined): void => {
    if (door === undefined) throw new Error('no such door');
    me.x = door.at.x;
    me.y = door.at.y;
  };
  const rests: RestResult[] = [];
  client.onMessage(CITY_MESSAGES.REST, (m: unknown) => rests.push(RestResultSchema.parse(m)));
  const deposits: DepositResult[] = [];
  client.onMessage(CITY_MESSAGES.VAULT, (m: unknown) => deposits.push(DepositResultSchema.parse(m)));
  const standOn = (spot: RoomSpot | undefined): void => {
    if (spot === undefined) throw new Error('no such spot');
    const at = toWorld({ x: spot.c + 0.5, y: spot.r + 0.5 });
    me.x = at.x;
    me.y = at.y;
  };
  return { client, room, me, doors, rests, deposits, standAt, standOn };
}

describe('walk-in buildings', () => {
  it('lets a guardian into a shop at its door, out of sight of the street, and back out at the door', async () => {
    const a = await walkIn('Ana');
    const b = await walkIn('Bo');
    a.standAt(shopA);
    b.standAt(shopA);
    await waitFor(() => b.client.state.players.has(a.client.sessionId), 'Bo sees Ana on the street');
    a.client.send('enter');
    await waitFor(() => a.doors.length === 1, 'door answered');
    expect(a.doors[0]).toMatchObject({ ok: true, reason: 'in', inside: shopA?.building.seed });
    expect(isIndoors(a.me)).toBe(true);
    await waitFor(() => !b.client.state.players.has(a.client.sessionId), 'Bo loses sight of Ana');
    b.me.x = shopA?.at.x ?? 0;
    b.me.y = (shopA?.at.y ?? 0) + 1;
    await sleep(DOOR_TUNING.gapMs + 50);
    a.client.send('exit');
    await waitFor(() => a.doors.length === 2, 'exit answered');
    expect(a.doors[1]).toMatchObject({ ok: false, reason: 'notAtDoor' });
    const layout = layoutFor('shop', shopA?.building.seed ?? 0);
    const inner = toWorld({ x: Math.floor(layout.w / 2) + 0.5, y: layout.d - 1.6 });
    a.me.x = inner.x;
    a.me.y = inner.y;
    a.client.send('exit');
    await waitFor(() => a.doors.length === 3, 'exit at the door answered');
    expect(a.doors[2]).toMatchObject({ ok: true, reason: 'out', inside: 0 });
    expect(a.me.x).toBeCloseTo(shopA?.at.x ?? 0);
    expect(a.me.y).toBeCloseTo(shopA?.at.y ?? 0);
    await waitFor(() => b.client.state.players.has(a.client.sessionId), 'Bo sees Ana again');
  });

  it('shows guardians in the same shop to each other, and never to those in another shop', async () => {
    const a = await walkIn('Ana');
    const b = await walkIn('Bo');
    const c = await walkIn('Cy');
    a.standAt(shopA);
    b.standAt(shopA);
    c.standAt(shopB);
    for (const g of [a, b, c]) g.client.send('enter');
    await waitFor(() => [a, b, c].every((g) => g.doors.length === 1), 'all inside');
    await waitFor(() => a.client.state.players.has(b.client.sessionId) && b.client.state.players.has(a.client.sessionId), 'Ana and Bo see each other');
    await sleep(300);
    expect(c.client.state.players.has(a.client.sessionId)).toBe(false);
    expect(a.client.state.players.has(c.client.sessionId)).toBe(false);
  });

  it('gives every guardian their own private flat behind the same house door', async () => {
    const a = await walkIn('Ana');
    const b = await walkIn('Bo');
    a.standAt(house);
    b.standAt(house);
    a.client.send('enter');
    b.client.send('enter');
    await waitFor(() => a.doors.length === 1 && b.doors.length === 1, 'both inside');
    expect(a.doors[0]?.ok && b.doors[0]?.ok).toBe(true);
    await sleep(300);
    expect(a.client.state.players.has(b.client.sessionId)).toBe(false);
    expect(b.client.state.players.has(a.client.sessionId)).toBe(false);
  });

  it('refuses away from a door, too soon after the last trip, and just after being hit', async () => {
    const a = await walkIn('Ana');
    a.me.x += 0.5;
    a.client.send('enter');
    await waitFor(() => a.doors.length === 1, 'answered');
    expect(a.doors[0]).toMatchObject({ ok: false, reason: 'notAtDoor' });
    a.standAt(shopA);
    a.client.send('enter');
    await waitFor(() => a.doors.length === 2, 'in');
    const layout = layoutFor('shop', shopA?.building.seed ?? 0);
    const inner = toWorld({ x: Math.floor(layout.w / 2) + 0.5, y: layout.d - 1.6 });
    a.me.x = inner.x;
    a.me.y = inner.y;
    a.client.send('exit');
    await waitFor(() => a.doors.length === 3, 'answered');
    expect(a.doors[2]).toMatchObject({ ok: false, reason: 'tooSoon' });

    const b = await walkIn('Bo');
    const c = await walkIn('Cy');
    const rough = ROUGH_STREETS[0] ?? { x: 0, y: 0 };
    for (const g of [b, c]) {
      g.me.x = rough.x;
      g.me.y = rough.y;
      g.room.shieldOff(g.client.sessionId);
    }
    c.me.x += 0.4;
    await sleep(100);
    c.client.send('punch');
    await waitFor(() => b.me.health < MAX_HEALTH, 'Bo is hit');
    b.standAt(shopB);
    b.client.send('enter');
    await waitFor(() => b.doors.length === 1, 'answered');
    expect(b.doors[0]).toMatchObject({ ok: false, reason: 'fighting' });
  });

  it('lets a guardian leave by walking out through the doorway', async () => {
    const a = await walkIn('Ana');
    a.standAt(shopA);
    a.client.send('enter');
    await waitFor(() => a.doors.length === 1, 'in');
    await sleep(DOOR_TUNING.lockMs + 50);
    const layout = layoutFor('shop', shopA?.building.seed ?? 0);
    const out = toWorld({ x: Math.floor(layout.w / 2) + 0.5, y: layout.d - 0.5 });
    a.me.x = out.x;
    a.me.y = out.y;
    await waitFor(() => a.doors.length === 2, 'walked out');
    expect(a.doors[1]).toMatchObject({ ok: true, reason: 'out' });
    expect(isIndoors(a.me)).toBe(false);
  });

  it('patches a guardian up at the hospital, and stops punches indoors', async () => {
    const a = await walkIn('Ana');
    const b = await walkIn('Bo');
    a.me.health = 30;
    a.standAt(hospital);
    b.standAt(hospital);
    a.client.send('enter');
    b.client.send('enter');
    await waitFor(() => a.doors.length === 1 && b.doors.length === 1, 'both inside');
    expect(a.me.health).toBe(MAX_HEALTH);
    a.room.shieldOff(a.client.sessionId);
    a.room.shieldOff(b.client.sessionId);
    a.me.x = b.me.x + 0.4;
    a.me.y = b.me.y;
    a.client.send('punch');
    await sleep(200);
    expect(b.me.health).toBe(MAX_HEALTH);
  });

  it('rests a guardian back to full health in bed at home, and only at the bed', async () => {
    const a = await walkIn('Ana');
    a.standAt(house);
    a.client.send('enter');
    await waitFor(() => a.doors.length === 1, 'home');
    const layout = layoutFor('flat', house?.building.seed ?? 0);
    a.room.hurt(a.client.sessionId, 40);
    a.client.send('rest');
    await waitFor(() => a.rests.length === 1, 'rest answered away from the bed');
    expect(a.rests[0]).toEqual({ ok: false, reason: 'notHere' });
    a.standOn(layout.spots.find((s) => s.kind === 'bed'));
    await sleep(DOOR_TUNING.restGapMs + 50);
    a.client.send('rest');
    await waitFor(() => a.rests.length === 2, 'rest answered in bed');
    expect(a.rests[1]).toEqual({ ok: true, reason: 'healed' });
    await waitFor(() => a.me.health === MAX_HEALTH, 'healed');
    a.client.send('rest');
    await sleep(200);
    expect(a.rests).toHaveLength(2);
    a.room.hurt(a.client.sessionId, 55);
    a.standOn(layout.spots.find((s) => s.kind === 'kitchen'));
    await sleep(DOOR_TUNING.restGapMs + 50);
    a.client.send('rest');
    await waitFor(() => a.rests.length === 3, 'rest answered in the kitchen');
    expect(a.rests[2]).toEqual({ ok: true, reason: 'healed' });
  });

  it('takes a deposit at the Mint Hall counter inside, but not elsewhere in the hall', async () => {
    const a = await walkIn('Ana');
    a.standAt(mintHall);
    a.client.send('enter');
    await waitFor(() => a.doors.length === 1, 'in the hall');
    a.me.pocket = 50;
    const layout = layoutFor('mintHall', mintHall?.building.seed ?? 0);
    a.standOn(layout.spots.find((s) => s.kind === 'board'));
    a.client.send('deposit');
    await waitFor(() => a.deposits.length === 1, 'deposit answered at the board');
    expect(a.deposits[0]?.reason).toBe('notAtVault');
    a.standOn(layout.spots.find((s) => s.kind === 'counter'));
    a.client.send('deposit');
    await waitFor(() => a.deposits.length === 2, 'deposit answered at the counter');
    expect(a.deposits[1]?.reason).toBe('noProfile');
  });
});
