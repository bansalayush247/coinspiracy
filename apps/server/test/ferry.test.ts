import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_CODES } from '@byzantine-council/shared';
import { CITY_ROOM, CITY_SPAWNS, CityState, FERRY_TUNING } from '@byzantine-council/shared/city';
import { BEACH_ROOM, BEACH_SPAWNS, HubState } from '@byzantine-council/shared/hub';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../src/profile/store.js';
import { COOKIE_NAME, type SessionKeys } from '../src/profile/session.js';
import type { CityRoom } from '../src/city/CityRoom.js';
import { ORIGIN, freshIp, sdk, startServer, waitFor } from './helpers.js';

const PORT = 3921;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const keys: SessionKeys = { current: Buffer.from('f'.repeat(32)), previous: null, secure: false };

class SwitchableStore extends MemoryProfileStore {
  opened = false;

  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) => fn(this.opened ? { ...data, progress: { ...data.progress, academy: data.progress.academy.map((_, i) => (i < 2 ? 2 : 0)) } } : data));
  }
}

const store = new SwitchableStore();
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, profiles: { store, keys } }));
});
afterEach(async () => {
  store.opened = false;
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

async function guest(): Promise<string> {
  const res = await fetch(`${BASE}/api/session`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': freshIp() }, body: '{}' });
  const value = /bc_guest=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return `${COOKIE_NAME}=${value}`;
}

const near = (p: { x: number; y: number } | undefined, q: { x: number; y: number }): boolean => p !== undefined && Math.hypot(p.x - q.x, p.y - q.y) < 0.01;

describe('the ferry', () => {
  it('lands a city arrival at the Port Concord dock instead of the seafront spawn', async () => {
    const walker = await sdk(PORT).joinOrCreate<CityState>(CITY_ROOM, { nickname: 'Walker' }, CityState);
    const sailor = await sdk(PORT).joinOrCreate<CityState>(CITY_ROOM, { nickname: 'Sailor', arrive: 'ferry' }, CityState);
    colyseus.getRoomById<CityRoom>(sailor.roomId).toughsOff();
    await waitFor(() => sailor.state.players.has(sailor.sessionId) && walker.state.players.has(walker.sessionId), 'both in the city');
    expect(near(sailor.state.players.get(sailor.sessionId), FERRY_TUNING.stops.city.arrive)).toBe(true);
    expect(CITY_SPAWNS.some((s) => near(walker.state.players.get(walker.sessionId), s))).toBe(true);
  });

  it('refuses any other arrival and any extra join field', async () => {
    await expect(sdk(PORT).joinOrCreate<CityState>(CITY_ROOM, { nickname: 'Pirate', arrive: 'vault' }, CityState)).rejects.toBeDefined();
    await expect(sdk(PORT).joinOrCreate<CityState>(CITY_ROOM, { nickname: 'Pirate', arrive: 'ferry', x: 74, y: 24 }, CityState)).rejects.toBeDefined();
    await expect(sdk(PORT).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Pirate', arrive: 'ferry', x: 3, y: 3 }, HubState)).rejects.toBeDefined();
  });

  it('only sails guardians who have opened Beach Town, and lands them at its pier', async () => {
    const cookie = await guest();
    await expect(sdk(PORT, { cookie }).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Early', arrive: 'ferry' }, HubState)).rejects.toMatchObject({ code: CLOSE_CODES.ISLAND_LOCKED });
    await expect(sdk(PORT).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Nobody', arrive: 'ferry' }, HubState)).rejects.toMatchObject({ code: CLOSE_CODES.ISLAND_LOCKED });
    store.opened = true;
    const room = await sdk(PORT, { cookie }).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Ready', arrive: 'ferry' }, HubState);
    await waitFor(() => room.state.players.has(room.sessionId), 'in town');
    expect(near(room.state.players.get(room.sessionId), FERRY_TUNING.stops.beach.arrive)).toBe(true);
    await expect(sdk(PORT).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Stroller' }, HubState)).rejects.toMatchObject({ code: CLOSE_CODES.ISLAND_LOCKED });
    const walkIn = await sdk(PORT, { cookie }).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Stroller' }, HubState);
    await waitFor(() => walkIn.state.players.has(walkIn.sessionId), 'stroller in town');
    expect(BEACH_SPAWNS.some((s) => near(walkIn.state.players.get(walkIn.sessionId), s))).toBe(true);
  });
});
