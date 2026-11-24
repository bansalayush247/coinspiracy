import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CITY_MESSAGES, CITY_ROOM, CITY_SPAWNS, CityState, KNOCKOUT_MS, MAX_HEALTH, PUNCH_COOLDOWN_MS, PunchLineSchema, ROUGH_STREETS, districtAt, type PunchLine } from '@byzantine-council/shared/city';
import { EmoteLineSchema } from '@byzantine-council/shared/hub';
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

const join = (nickname: string) => sdk(PORT).joinOrCreate<CityState>(CITY_ROOM, { nickname }, CityState);

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

  it('refuses a bad nickname', async () => {
    await expect(join('')).rejects.toThrow();
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

