import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BEACH_MESSAGES, BEACH_ROOM, CourierRefusedSchema, EmoteLineSchema, HubState } from '@byzantine-council/shared/hub';
import { MemoryProfileStore } from '../src/profile/store.js';
import { COOKIE_NAME, type SessionKeys } from '../src/profile/session.js';
import { ORIGIN, freshIp, sdk, startServer, waitFor } from './helpers.js';

const PORT = 3893;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const keys: SessionKeys = { current: Buffer.from('b'.repeat(32)), previous: null, secure: false };
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

function post(path: string, body: unknown, cookie: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': freshIp(), cookie }, body: JSON.stringify(body) });
}

describe('Beach Town', () => {
  it('lets guests in, together, and keeps them on the island', async () => {
    const a = await sdk(PORT).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Surfer' }, HubState);
    const b = await sdk(PORT).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Cook' }, HubState);
    expect(b.roomId).toBe(a.roomId);
    await waitFor(() => a.state.players.size === 2, 'both in town');
    // Walk south into the lagoon for two seconds: the shore stops the guardian.
    for (let seq = 1; seq <= 40; seq++) a.send('move', { seq, dx: 0, dy: 1 });
    await waitFor(() => (a.state.players.get(a.sessionId)?.ack ?? 0) >= 40, 'moves applied', 6000);
    expect(a.state.players.get(a.sessionId)?.y).toBeLessThan(17);
  });

  it('only gives courier jobs at a shop counter and refuses deliveries without one', async () => {
    const room = await sdk(PORT).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Runner' }, HubState);
    const refusals: string[] = [];
    room.onMessage(BEACH_MESSAGES.REFUSED, (p: unknown) => refusals.push(CourierRefusedSchema.parse(p).reason));
    room.send('takeJob', { shop: 'cafe' });
    room.send('deliver');
    await waitFor(() => refusals.length === 2, 'refusals');
    expect(refusals).toEqual(['notHere', 'noJob']);
  });

  it('shares emotes with the town, paced per guardian', async () => {
    const a = await sdk(PORT).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Waver' }, HubState);
    const b = await sdk(PORT).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Watcher' }, HubState);
    const seen: string[] = [];
    b.onMessage(BEACH_MESSAGES.EMOTE, (p: unknown) => seen.push(EmoteLineSchema.parse(p).emote));
    a.send('emote', { emote: 'wave' });
    a.send('emote', { emote: 'cheer' });
    await waitFor(() => seen.length >= 1, 'an emote');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(seen).toEqual(['wave']);
  });

  it('sells with chosen notes, refuses overpaying, wrong shops and items owned already', async () => {
    const cookie = await guest();
    // A new guest holds 500 sats: 256 + 128 + 64 + 32 + 16 + 4.
    expect((await post('/api/shop/buy', { item: 'hat:cap', shop: 'tailor', notes: [256] }, cookie)).status).toBe(409);
    expect((await post('/api/shop/buy', { item: 'hat:cap', shop: 'hats', notes: [256, 128] }, cookie)).status).toBe(409);
    const ok = await post('/api/shop/buy', { item: 'hat:cap', shop: 'hats', notes: [256] }, cookie);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { balance: number; owned: string[] };
    expect(body.balance).toBe(300);
    expect(body.owned).toContain('hat:cap');
    expect((await post('/api/shop/buy', { item: 'hat:cap', shop: 'hats', notes: [128, 64, 16] }, cookie)).status).toBe(409);
    expect((await post('/api/shop/buy', { item: 'food:coffee', shop: 'cafe', notes: [32] }, cookie)).status).toBe(200);
  });
});
