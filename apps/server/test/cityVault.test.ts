import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CITY_MESSAGES, CITY_ROOM, CITY_SPAWNS, CityState, DepositResultSchema, VAULT_DAILY_LIMIT, VAULT_DOOR, type DepositResult } from '@byzantine-council/shared/city';
import type { CityRoom } from '../src/city/CityRoom.js';
import { MemoryProfileStore } from '../src/profile/store.js';
import { COOKIE_NAME, type SessionKeys } from '../src/profile/session.js';
import { ORIGIN, freshIp, sdk, startServer, waitFor } from './helpers.js';

const PORT = 3897;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const keys: SessionKeys = { current: Buffer.from('v'.repeat(32)), previous: null, secure: false };
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, profiles: { store: new MemoryProfileStore(), keys } }));
});
afterEach(async () => {
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

async function balance(cookie: string): Promise<number> {
  const res = await fetch(`${BASE}/api/profile`, { headers: { origin: ORIGIN, 'x-real-ip': freshIp(), cookie } });
  return ((await res.json()) as { balance: number }).balance;
}

async function enter(cookie: string | null) {
  const client = await sdk(PORT, cookie === null ? {} : { cookie }).joinOrCreate<CityState>(CITY_ROOM, { nickname: 'Saver' }, CityState);
  await waitFor(() => client.state.players.has(client.sessionId), 'joined');
  const room = colyseus.getRoomById<CityRoom>(client.roomId);
  room.random = { int: () => 0 };
  const me = room.state.players.get(client.sessionId);
  if (me === undefined) throw new Error('me');
  const results: DepositResult[] = [];
  client.onMessage(CITY_MESSAGES.VAULT, (m: unknown) => results.push(DepositResultSchema.parse(m)));
  return { client, me, results };
}

describe('the Mint vault', () => {
  it('moves the pocket into the wallet at the Mint Hall door', async () => {
    const cookie = await guest();
    const { client, me, results } = await enter(cookie);
    me.x = VAULT_DOOR.x;
    me.y = VAULT_DOOR.y;
    me.pocket = 120;
    client.send('deposit');
    await waitFor(() => results.length === 1, 'deposit answered');
    expect(results[0]).toEqual({ paid: 120, kept: 0, reason: 'paid', today: 120, limit: VAULT_DAILY_LIMIT });
    expect(me.pocket).toBe(0);
    expect(await balance(cookie)).toBe(500 + 120);
  });

  it('stops at the daily limit and hands the rest back', async () => {
    const cookie = await guest();
    const { client, me, results } = await enter(cookie);
    me.x = VAULT_DOOR.x;
    me.y = VAULT_DOOR.y;
    me.pocket = VAULT_DAILY_LIMIT + 50;
    client.send('deposit');
    await waitFor(() => results.length === 1, 'first deposit');
    expect(results[0]).toMatchObject({ paid: VAULT_DAILY_LIMIT, kept: 50, reason: 'paid' });
    expect(me.pocket).toBe(50);
    client.send('deposit');
    await waitFor(() => results.length === 2, 'second deposit');
    expect(results[1]).toMatchObject({ paid: 0, kept: 50, reason: 'dailyLimit', today: VAULT_DAILY_LIMIT });
    expect(me.pocket).toBe(50);
    expect(await balance(cookie)).toBe(500 + VAULT_DAILY_LIMIT);
  });

  it('refuses away from the door, with an empty pocket, or without a profile', async () => {
    const cookie = await guest();
    const { client, me, results } = await enter(cookie);
    const spawn = CITY_SPAWNS[0] ?? { x: 61, y: 90 };
    me.x = spawn.x;
    me.y = spawn.y;
    me.pocket = 80;
    client.send('deposit');
    await waitFor(() => results.length === 1, 'far from the vault');
    expect(results[0]?.reason).toBe('notAtVault');
    expect(me.pocket).toBe(80);
    me.x = VAULT_DOOR.x;
    me.y = VAULT_DOOR.y;
    me.pocket = 0;
    client.send('deposit');
    await waitFor(() => results.length === 2, 'empty pocket');
    expect(results[1]?.reason).toBe('empty');
    expect(await balance(cookie)).toBe(500);
    const anon = await enter(null);
    anon.me.x = VAULT_DOOR.x;
    anon.me.y = VAULT_DOOR.y;
    anon.me.pocket = 30;
    anon.client.send('deposit');
    await waitFor(() => anon.results.length === 1, 'no profile');
    expect(anon.results[0]).toMatchObject({ reason: 'noProfile', kept: 30 });
    expect(anon.me.pocket).toBe(30);
  });

  it('pays a double-sent deposit only once', async () => {
    const cookie = await guest();
    const { client, me, results } = await enter(cookie);
    me.x = VAULT_DOOR.x;
    me.y = VAULT_DOOR.y;
    me.pocket = 100;
    client.send('deposit');
    client.send('deposit');
    await waitFor(() => results.length === 2, 'both answered');
    expect(results.reduce((n, r) => n + r.paid, 0)).toBe(100);
    expect(await balance(cookie)).toBe(600);
  });
});
