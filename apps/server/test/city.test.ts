import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CAR_HALF_LENGTH, CITY_BUILDINGS, CITY_MAP, CITY_MESSAGES, CITY_ROOM, CITY_SPAWNS, CityState, KNOCKOUT_MS, MAX_HEALTH, PUNCH_COOLDOWN_MS, PunchLineSchema, ROUGH_STREETS, districtAt, inSight, isRough, TOUGH_PURSE_MIN, type PunchLine } from '@byzantine-council/shared/city';
import { PLAYER_RADIUS, isBlocked } from '@byzantine-council/shared';
import { EmoteLineSchema, JUMP_GAP_MS, JumpLineSchema } from '@byzantine-council/shared/hub';
import type { CityRoom } from '../src/city/CityRoom.js';
import { sdk, startServer, waitFor } from './helpers.js';

const PORT = 3896;
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

async function join(nickname: string, toughs = false) {
  const client = await sdk(PORT).joinOrCreate<CityState>(CITY_ROOM, { nickname }, CityState);
  if (!toughs) colyseus.getRoomById<CityRoom>(client.roomId).toughsOff();
  return client;
}

describe('Port Concord', () => {
  it('puts guardians in one city, near each other at the spawn', async () => {
    const a = await join('Rook');
    const b = await join('Dani');
    expect(b.roomId).toBe(a.roomId);
    await waitFor(() => a.state.players.size === 2 && b.state.players.size === 2, 'both see each other');
    expect(a.state.population).toBe(2);
    const me = a.state.players.get(a.sessionId);
    expect(me?.ack).toBe(0);
    // Owner-only fields stay private.
    expect(a.state.players.get(b.sessionId)?.ack).toBeUndefined();
  });

  it('only sends the players near you, and brings them back when they return', async () => {
    const a = await join('Near');
    const b = await join('Far');
    await waitFor(() => a.state.players.size === 2, 'together at first');
    const room = colyseus.getRoomById<CityRoom>(a.roomId);
    const far = room.state.players.get(b.sessionId);
    if (far === undefined) throw new Error('far player');
    // Across the city: dropped from the other's view, but still counted.
    far.x = 120.5;
    far.y = 20.5;
    await waitFor(() => a.state.players.size === 1, 'far player leaves the view');
    expect(a.state.players.has(b.sessionId)).toBe(false);
    expect(a.state.population).toBe(2);
    expect(room.seenBy(a.sessionId)).toEqual([a.sessionId]);
    // Back at the spawn: synced again, at the new position.
    const spawn = CITY_SPAWNS[3] ?? { x: 73, y: 63 };
    far.x = spawn.x;
    far.y = spawn.y;
    await waitFor(() => a.state.players.size === 2, 'returns to the view');
    expect(a.state.players.get(b.sessionId)?.x).toBeCloseTo(spawn.x);
  });

  it('never sends a player hidden behind a building, however close', async () => {
    const a = await join('Here');
    const b = await join('Hidden');
    await waitFor(() => a.state.players.size === 2, 'together at first');
    const room = colyseus.getRoomById<CityRoom>(a.roomId);
    const tower = CITY_BUILDINGS.find((x) => x.kind === 'gateTower');
    const me = room.state.players.get(a.sessionId);
    const other = room.state.players.get(b.sessionId);
    if (tower === undefined || me === undefined || other === undefined) throw new Error('setup');
    const midX = (tower.box.c0 + tower.box.c1 + 1) / 2;
    me.x = midX;
    me.y = tower.box.r0 - 1.5;
    other.x = midX;
    other.y = tower.box.r1 + 2.5;
    expect(inSight(me, other)).toBe(false);
    await waitFor(() => a.state.players.size === 1 && b.state.players.size === 1, 'out of sight both ways');
    other.x = midX + 3;
    other.y = me.y;
    await waitFor(() => a.state.players.size === 2, 'in sight again');
  });

  it('keeps guardians out of the river and the sea', async () => {
    const a = await join('Swimmer');
    await waitFor(() => a.state.players.size >= 1, 'joined');
    const room = colyseus.getRoomById<CityRoom>(a.roomId);
    const me = room.state.players.get(a.sessionId);
    if (me === undefined) throw new Error('me');
    // On the river bank at Council Hill, facing the water to the west.
    me.x = 66.5;
    me.y = 40.5;
    for (let seq = 1; seq <= 40; seq++) a.send('move', { seq, dx: -1, dy: 0 });
    await waitFor(() => (a.state.players.get(a.sessionId)?.ack ?? 0) >= 40, 'moves applied', 6000);
    expect(a.state.players.get(a.sessionId)?.x).toBeGreaterThan(65.6);
  });

  it('stops a walker at a parked car instead of letting them walk through it', async () => {
    const a = await join('Bumper');
    await waitFor(() => a.state.players.size >= 1, 'joined');
    const room = colyseus.getRoomById<CityRoom>(a.roomId);
    const me = room.state.players.get(a.sessionId);
    const car = room.carList()[0];
    if (me === undefined || car === undefined) throw new Error('setup');
    const ahead = { x: Math.cos(car.heading), y: Math.sin(car.heading) };
    me.x = car.x + ahead.x * 2.2;
    me.y = car.y + ahead.y * 2.2;
    for (let seq = 1; seq <= 30; seq++) a.send('move', { seq, dx: -ahead.x, dy: -ahead.y });
    await waitFor(() => (a.state.players.get(a.sessionId)?.ack ?? 0) >= 30, 'moves applied', 6000);
    const along = (me.x - car.x) * ahead.x + (me.y - car.y) * ahead.y;
    expect(along).toBeGreaterThan(CAR_HALF_LENGTH + PLAYER_RADIUS - 0.01);
    expect(along).toBeLessThan(2.2);
  });

  it('only shows emotes to the guardians who can see you', async () => {
    const a = await join('Waver');
    const near = await join('Nearby');
    const far = await join('Faraway');
    await waitFor(() => a.state.players.size === 3, 'all together');
    const room = colyseus.getRoomById<CityRoom>(a.roomId);
    const p = room.state.players.get(far.sessionId);
    if (p === undefined) throw new Error('far');
    p.x = 120.5;
    p.y = 20.5;
    await waitFor(() => a.state.players.size === 2, 'far one out of view');
    const seenNear: string[] = [];
    const seenFar: string[] = [];
    near.onMessage(CITY_MESSAGES.EMOTE, (m: unknown) => seenNear.push(EmoteLineSchema.parse(m).emote));
    far.onMessage(CITY_MESSAGES.EMOTE, (m: unknown) => seenFar.push(EmoteLineSchema.parse(m).emote));
    a.send('emote', { emote: 'wave' });
    await waitFor(() => seenNear.length === 1, 'nearby sees it');
    await new Promise((r) => setTimeout(r, 200));
    expect(seenFar).toEqual([]);
  });

  it('shows a jump to whoever can see the jumper, at most once per JUMP_GAP_MS', async () => {
    const a = await join('Jumper');
    const near = await join('Watcher');
    await waitFor(() => near.state.players.size >= 2, 'together');
    const room = colyseus.getRoomById<CityRoom>(a.roomId);
    const seen: string[] = [];
    near.onMessage(CITY_MESSAGES.JUMP, (m: unknown) => seen.push(JumpLineSchema.parse(m).from));
    await waitFor(() => [...room.state.players.keys()].includes(near.sessionId), 'watcher in room');
    a.send('jump');
    a.send('jump');
    await waitFor(() => seen.length === 1, 'watcher sees one jump');
    expect(seen).toEqual([a.sessionId]);
    await new Promise((r) => setTimeout(r, JUMP_GAP_MS + 50));
    a.send('jump');
    await waitFor(() => seen.length === 2, 'a second jump after the gap');
  });

  it('refuses a bad nickname', async () => {
    await expect(join('')).rejects.toThrow();
  });

  describe('cars', () => {
    const drive = async (client: Awaited<ReturnType<typeof join>>, dx: number, dy: number, ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        client.send('drive', { dx, dy });
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    it('gets in a parked car, drives it, and gets out beside it', async () => {
      const a = await join('Driver');
      const room = colyseus.getRoomById<CityRoom>(a.roomId);
      const me = room.state.players.get(a.sessionId);
      const car = room.carList()[0];
      if (me === undefined || car === undefined) throw new Error('setup');
      me.x = car.x + 1;
      me.y = car.y;
      a.send('ride');
      await waitFor(() => me.car === car.id, 'in the car');
      expect(room.carList()[0]?.driver).toBe(a.sessionId);
      const start = { x: me.x, y: me.y };
      const ahead = { x: Math.cos(car.heading), y: Math.sin(car.heading) };
      await drive(a, ahead.x, ahead.y, 700);
      const moved = room.carList()[0];
      expect(moved).toBeDefined();
      expect(Math.hypot((moved?.x ?? 0) - start.x, (moved?.y ?? 0) - start.y)).toBeGreaterThan(1);
      expect(me.x).toBeCloseTo(moved?.x ?? 0, 5);
      a.send('punch');
      a.send('ride');
      await waitFor(() => me.car === '', 'out of the car');
      expect(room.carList()[0]?.driver).toBe('');
      expect(Math.hypot(me.x - (moved?.x ?? 0), me.y - (moved?.y ?? 0))).toBeGreaterThan(0.5);
    });

    it('drives straight on the gas from the keyboard, with no wheel input', async () => {
      const a = await join('Pedals');
      const room = colyseus.getRoomById<CityRoom>(a.roomId);
      const me = room.state.players.get(a.sessionId);
      const car = room.carList()[0];
      if (me === undefined || car === undefined) throw new Error('setup');
      me.x = car.x + 1;
      me.y = car.y;
      a.send('ride');
      await waitFor(() => me.car === car.id, 'in the car');
      const heading = car.heading;
      const end = Date.now() + 600;
      while (Date.now() < end) {
        a.send('drive', { throttle: 1, steer: 0 });
        await new Promise((r) => setTimeout(r, 50));
      }
      const moved = room.carList()[0];
      if (moved === undefined) throw new Error('car');
      expect(moved.heading).toBeCloseTo(heading, 9);
      expect(Math.hypot(moved.x - car.x, moved.y - car.y)).toBeGreaterThan(0.5);
      a.send('ride');
      await waitFor(() => me.car === '', 'out of the car');
    });

    it('lets the car go when the driver stops sending, and never drives through a wall', async () => {
      const a = await join('Rammer');
      const room = colyseus.getRoomById<CityRoom>(a.roomId);
      const me = room.state.players.get(a.sessionId);
      const car = room.carList()[0];
      if (me === undefined || car === undefined) throw new Error('setup');
      me.x = car.x;
      me.y = car.y;
      a.send('ride');
      await waitFor(() => me.car === car.id, 'in the car');
      await drive(a, Math.cos(car.heading + Math.PI / 2), Math.sin(car.heading + Math.PI / 2), 3000);
      const stopped = room.carList()[0];
      if (stopped === undefined) throw new Error('car');
      expect(isBlocked(CITY_MAP, stopped, 0.45)).toBe(false);
      await new Promise((r) => setTimeout(r, 1500));
      const later = room.carList()[0];
      await new Promise((r) => setTimeout(r, 300));
      const after = room.carList()[0];
      expect(Math.hypot((after?.x ?? 0) - (later?.x ?? 0), (after?.y ?? 0) - (later?.y ?? 0))).toBeLessThan(0.01);
    });

    it('keeps a second driver out, and nobody can punch someone in a car', async () => {
      const a = await join('First');
      const b = await join('Second');
      const room = colyseus.getRoomById<CityRoom>(a.roomId);
      room.random = { int: () => 0 };
      const pa = room.state.players.get(a.sessionId);
      const pb = room.state.players.get(b.sessionId);
      const street = ROUGH_STREETS.find((p) => districtAt(p)?.id === 'lowtide');
      const car = room.carList().find((c) => isRough(c));
      if (pa === undefined || pb === undefined || car === undefined || street === undefined) throw new Error('setup');
      pa.x = car.x;
      pa.y = car.y;
      a.send('ride');
      await waitFor(() => pa.car === car.id, 'first driver in');
      pb.x = car.x + 0.9;
      pb.y = car.y;
      room.shieldOff(a.sessionId);
      room.shieldOff(b.sessionId);
      b.send('ride');
      await new Promise((r) => setTimeout(r, 200));
      expect(pb.car).toBe('');
      const lines: PunchLine[] = [];
      b.onMessage(CITY_MESSAGES.PUNCH, (m: unknown) => lines.push(PunchLineSchema.parse(m)));
      b.send('punch');
      await waitFor(() => lines.length === 1, 'swing seen');
      expect(lines[0]?.to).toBeNull();
      expect(pa.health).toBe(MAX_HEALTH);
    });
  });

  describe('street toughs', () => {
    it('roam only the rough streets and are not counted as people', async () => {
      const a = await join('Visitor', true);
      const room = colyseus.getRoomById<CityRoom>(a.roomId);
      const toughs = room.toughs();
      expect(toughs.length).toBe(8);
      for (const t of toughs) expect(isRough(t)).toBe(true);
      expect(toughs.some((t) => t.bully)).toBe(true);
      await waitFor(() => a.state.population === 1, 'population counts people only');
      expect(a.state.population).toBe(1);
    });

    it('a tough goes down after four punches, drops a purse, and swings back while it lasts', async () => {
      const a = await join('Solo', true);
      const room = colyseus.getRoomById<CityRoom>(a.roomId);
      room.random = { int: () => 0 };
      const tough = room.toughs().find((t) => !t.bully);
      const me = room.state.players.get(a.sessionId);
      if (tough === undefined || me === undefined) throw new Error('setup');
      const body = room.state.players.get(tough.id);
      if (body === undefined) throw new Error('tough');
      me.x = body.x;
      me.y = body.y + 0.6;
      room.shieldOff(a.sessionId);
      await waitFor(() => a.state.players.has(tough.id), 'the tough is in view');
      const lines: PunchLine[] = [];
      a.onMessage(CITY_MESSAGES.PUNCH, (m: unknown) => lines.push(PunchLineSchema.parse(m)));
      a.send('punch');
      await waitFor(() => lines.some((l) => l.from === tough.id), 'the tough swings back', 4000);
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, PUNCH_COOLDOWN_MS + 30));
        me.x = body.x;
        me.y = body.y + 0.6;
        a.send('punch');
      }
      await waitFor(() => lines.some((l) => l.from === a.sessionId && l.knockedOut), 'knocked out', 4000);
      expect(body.down).toBe(true);
      await waitFor(() => (me.pocket ?? 0) >= TOUGH_PURSE_MIN, 'grabs the purse');
      expect(me.health).toBeLessThan(MAX_HEALTH);
      await waitFor(() => !a.state.players.has(tough.id), 'the tough limps off', KNOCKOUT_MS + 2000);
    }, 15_000);

    it('a bully goes for a fat pocket without being hit first', async () => {
      const a = await join('Rich', true);
      const room = colyseus.getRoomById<CityRoom>(a.roomId);
      const bully = room.toughs().find((t) => t.bully);
      const me = room.state.players.get(a.sessionId);
      if (bully === undefined || me === undefined) throw new Error('setup');
      const body = room.state.players.get(bully.id);
      if (body === undefined) throw new Error('bully');
      me.x = body.x;
      me.y = body.y + 0.6;
      me.pocket = 200;
      room.shieldOff(a.sessionId);
      await waitFor(() => me.health < MAX_HEALTH, 'the bully swings', 5000);
    }, 10_000);
  });

  describe('street fights', () => {
    const street = ROUGH_STREETS.find((p) => districtAt(p)?.id === 'lowtide') ?? { x: 100.5, y: 100.5 };
    const gap = () => new Promise((r) => setTimeout(r, PUNCH_COOLDOWN_MS + 30));

    const pair = async () => {
      const a = await join('Brawler');
      const b = await join('Target');
      await waitFor(() => a.state.players.size === 2 && b.state.players.size === 2, 'together');
      const room = colyseus.getRoomById<CityRoom>(a.roomId);
      room.random = { int: () => 0 };
      const pa = room.state.players.get(a.sessionId);
      const pb = room.state.players.get(b.sessionId);
      if (pa === undefined || pb === undefined) throw new Error('players');
      return { a, b, room, pa, pb };
    };

    it('misses on safe streets, whoever is in reach', async () => {
      const { a, pb } = await pair();
      const lines: PunchLine[] = [];
      a.onMessage(CITY_MESSAGES.PUNCH, (m: unknown) => lines.push(PunchLineSchema.parse(m)));
      a.send('punch');
      await waitFor(() => lines.length === 1, 'swing seen');
      expect(lines[0]?.to).toBeNull();
      expect(pb.health).toBe(MAX_HEALTH);
    });

    it('knocks a guardian out on rough streets, hands their pocket to the winner and wakes them at home', async () => {
      const { a, b, room, pa, pb } = await pair();
      pa.x = street.x;
      pa.y = street.y;
      pb.x = street.x + 0.6;
      pb.y = street.y;
      pb.pocket = 120;
      const home = { x: CITY_SPAWNS[1]?.x ?? 0, y: CITY_SPAWNS[1]?.y ?? 0 };
      room.shieldOff(b.sessionId);
      const lines: PunchLine[] = [];
      b.onMessage(CITY_MESSAGES.PUNCH, (m: unknown) => lines.push(PunchLineSchema.parse(m)));
      for (let i = 0; i < 4; i++) {
        a.send('punch');
        await gap();
      }
      await waitFor(() => lines.length === 4, 'four swings seen');
      expect(lines.every((l) => l.to === b.sessionId)).toBe(true);
      expect(lines.at(-1)?.knockedOut).toBe(true);
      expect(pb.down).toBe(true);
      expect(pb.pocket).toBe(0);
      await waitFor(() => pa.pocket === 120, 'the winner grabs the pile');
      await waitFor(() => !pb.down, 'wakes up', KNOCKOUT_MS + 2000);
      expect(pb.health).toBe(MAX_HEALTH);
      expect(pb.shielded).toBe(true);
      expect(pb.x).toBeCloseTo(home.x);
      expect(pb.y).toBeCloseTo(home.y);
    });

    it('lets the attacker pick up the pile, and only the owner sees their pocket', async () => {
      const { a, b, room, pa } = await pair();
      pa.x = street.x;
      pa.y = street.y;
      room.dropCoins(street.x + 0.3, street.y, 75);
      await waitFor(() => a.state.players.get(a.sessionId)?.pocket === 75, 'picked up');
      expect([...room.state.drops.values()].some((d) => d.amount === 75)).toBe(false);
      expect(b.state.players.get(a.sessionId)?.pocket).toBeUndefined();
    });

    it('drops the pocket of a guardian who quits mid-fight', async () => {
      const { a, b, room, pa, pb } = await pair();
      pa.x = street.x;
      pa.y = street.y;
      pb.x = street.x + 0.6;
      pb.y = street.y;
      pb.pocket = 40;
      room.shieldOff(b.sessionId);
      a.send('punch');
      await waitFor(() => pb.health < MAX_HEALTH, 'hit');
      await b.leave();
      await waitFor(() => [...room.state.drops.values()].some((d) => d.amount === 40), 'pocket left behind');
    });
  });
});

