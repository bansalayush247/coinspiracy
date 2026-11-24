import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CITY_MESSAGES, CITY_ROOM, CITY_SPAWNS, CityState } from '@byzantine-council/shared/city';
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
});
