import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BEACH_MESSAGES, BEACH_ROOM, CourierRefusedSchema, EmoteLineSchema, HubState } from '@byzantine-council/shared/hub';
import { CLOSE_CODES } from '@byzantine-council/shared';
import { DEFAULT_LOOK } from '@byzantine-council/shared/economy';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../src/profile/store.js';
import { COOKIE_NAME, type SessionKeys } from '../src/profile/session.js';
import { ORIGIN, freshIp, sdk, startServer, waitFor } from './helpers.js';

const PORT = 3893;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const keys: SessionKeys = { current: Buffer.from('b'.repeat(32)), previous: null, secure: false };
class OpenedStore extends MemoryProfileStore {
  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) => fn({ ...data, progress: { ...data.progress, academy: data.progress.academy.map((_, i) => (i < 2 ? 2 : 0)) } }));
  }
}

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, profiles: { store: new OpenedStore(), keys } }));
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

const visit = (nickname: string, cookie: string) => sdk(PORT, { cookie }).joinOrCreate<HubState>(BEACH_ROOM, { nickname }, HubState);

describe('Beach Town', () => {
  it('turns away anyone without a profile, whatever the way in', async () => {
    await expect(sdk(PORT).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Sneak' }, HubState)).rejects.toMatchObject({ code: CLOSE_CODES.ISLAND_LOCKED });
    await expect(sdk(PORT, { cookie: `${COOKIE_NAME}=forged` }).joinOrCreate<HubState>(BEACH_ROOM, { nickname: 'Forger' }, HubState)).rejects.toMatchObject({ code: CLOSE_CODES.ISLAND_LOCKED });
  });

  it('lets guests in, together, and keeps them on the island', async () => {
    const a = await visit('Surfer', await guest());
    const b = await visit('Cook', await guest());
    expect(b.roomId).toBe(a.roomId);
    await waitFor(() => a.state.players.size === 2, 'both in town');
    // Walk south into the lagoon for two seconds: the shore stops the guardian.
    for (let seq = 1; seq <= 40; seq++) a.send('move', { seq, dx: 0, dy: 1 });
    await waitFor(() => (a.state.players.get(a.sessionId)?.ack ?? 0) >= 40, 'moves applied', 6000);
    expect(a.state.players.get(a.sessionId)?.y).toBeLessThan(17);
  });

  it('only gives courier jobs at a shop counter and refuses deliveries without one', async () => {
    const room = await visit('Runner', await guest());
    const refusals: string[] = [];
    room.onMessage(BEACH_MESSAGES.REFUSED, (p: unknown) => refusals.push(CourierRefusedSchema.parse(p).reason));
    room.send('takeJob', { shop: 'cafe' });
    room.send('deliver');
    await waitFor(() => refusals.length === 2, 'refusals');
    expect(refusals).toEqual(['notHere', 'noJob']);
  });

  it('shares emotes with the town, paced per guardian', async () => {
    const a = await visit('Waver', await guest());
    const b = await visit('Watcher', await guest());
    const seen: string[] = [];
    b.onMessage(BEACH_MESSAGES.EMOTE, (p: unknown) => seen.push(EmoteLineSchema.parse(p).emote));
    a.send('emote', { emote: 'wave' });
    a.send('emote', { emote: 'cheer' });
    await waitFor(() => seen.length >= 1, 'an emote');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(seen).toEqual(['wave']);
  });

  it('shows a changed look to the town, even two changes in a row', async () => {
    const cookie = await guest();
    expect((await post('/api/shop/buy', { item: 'hat:cap', shop: 'hats', notes: [256] }, cookie)).status).toBe(200);
    const room = await visit('Dresser', cookie);
    await waitFor(() => room.state.players.has(room.sessionId), 'in town');
    const me = () => room.state.players.get(room.sessionId);
    const wear = async (look: Record<string, string | null>): Promise<void> => {
      expect((await post('/api/look', { look: { ...DEFAULT_LOOK, ...look } }, cookie)).status).toBe(200);
      room.send('refreshLook');
    };
    await wear({ hat: 'hat:cap', hair: 'hair:hood' });
    await waitFor(() => me()?.hat === 'hat:cap', 'the cap shows');
    expect(me()?.hair).toBe('hair:hood');
    await wear({ hat: null });
    await waitFor(() => me()?.hat === '', 'the cap comes off soon after, though asked for within the gap', 4000);
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
