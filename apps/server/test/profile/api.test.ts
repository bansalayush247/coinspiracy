import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_MESSAGES, TaskOpenedSchema, TaskResultSchema, solveChallenge, stationCenter, type TaskTiming } from '@byzantine-council/shared';
import { AwardSchema } from '@byzantine-council/shared/progression';
import type { CitadelRoom } from '../../src/CitadelRoom.js';
import { MemoryProfileStore } from '../../src/profile/store.js';
import { COOKIE_NAME, type SessionKeys } from '../../src/profile/session.js';
import { ORIGIN, createRoom, freshIp, joinRoom, sdk, startServer, waitFor } from '../helpers.js';

const PORT = 3890;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const keys: SessionKeys = { current: Buffer.from('k'.repeat(32)), previous: null, secure: false };
const FAST: TaskTiming = { minSolveMs: { deposit: 0, ledger: 0, route: 0, watchtower: 0 }, expireMs: 60_000, retryMs: 300, openCooldownMs: 0 };
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, taskTiming: FAST, resultMs: 300, profiles: { store: new MemoryProfileStore(), keys } }));
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function post(path: string, body: unknown, cookie?: string, origin: string | null = ORIGIN, type = 'application/json'): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': type, 'x-real-ip': freshIp() };
  if (origin !== null) headers['origin'] = origin;
  if (cookie !== undefined) headers['cookie'] = cookie;
  return fetch(`${BASE}${path}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

function get(path: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN, 'x-real-ip': freshIp() };
  if (cookie !== undefined) headers['cookie'] = cookie;
  return fetch(`${BASE}${path}`, { headers });
}

async function newGuest(): Promise<string> {
  const res = await post('/api/session', {});
  expect(res.status).toBe(200);
  const set = res.headers.get('set-cookie') ?? '';
  const value = /bc_guest=([^;]+)/.exec(set)?.[1];
  if (value === undefined) throw new Error('no cookie');
  return `${COOKIE_NAME}=${value}`;
}

describe('guest sessions', () => {
  it('issue an HTTP-only cookie and a profile with no id in the body', async () => {
    const res = await post('/api/session', {});
    expect(res.status).toBe(200);
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^bc_guest=[^;]+; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax$/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['balance']).toBe(500);
    const id = /bc_guest=([^.]+)\./.exec(set)?.[1] ?? 'none';
    expect(JSON.stringify(body)).not.toContain(id);
  });

  it('keep the same profile on the next visit without a new cookie', async () => {
    const cookie = await newGuest();
    const again = await post('/api/session', {}, cookie);
    expect(again.status).toBe(200);
    expect(again.headers.get('set-cookie')).toBeNull();
  });

  it('refuse writes without our Origin or a JSON body', async () => {
    expect((await post('/api/session', {}, undefined, null)).status).toBe(403);
    expect((await post('/api/session', {}, undefined, 'https://evil.example')).status).toBe(403);
    expect((await post('/api/session', 'a=b', undefined, ORIGIN, 'application/x-www-form-urlencoded')).status).toBe(415);
  });

  it('treat a tampered cookie as no session', async () => {
    const cookie = await newGuest();
    expect((await get('/api/profile', `${cookie}x`)).status).toBe(401);
    expect((await get('/api/profile')).status).toBe(401);
    expect((await get('/api/profile', cookie)).status).toBe(200);
  });
});

describe('progression choices', () => {
  it('allow owned titles only and validate the body', async () => {
    const cookie = await newGuest();
    const ok = await post('/api/progress/title', { title: 'apprentice' }, cookie);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { progress: { chosenTitle: string } }).progress.chosenTitle).toBe('apprentice');
    expect((await post('/api/progress/title', { title: 'scholar' }, cookie)).status).toBe(409);
    expect((await post('/api/progress/title', { title: 'emperor' }, cookie)).status).toBe(400);
    expect((await post('/api/progress/title', { title: 'apprentice', extra: 1 }, cookie)).status).toBe(400);
    expect((await post('/api/progress/title', { title: 'x'.repeat(4000) }, cookie)).status).toBe(413);
    expect((await post('/api/progress/title', { title: 'apprentice' })).status).toBe(401);
  });

  it('let guests wear only what they own, and show it in a match', async () => {
    const cookie = await newGuest();
    const base = { outfit: 'outfit:blue', hair: 'hair:hood', dye: 'dye:dark', beard: null, hat: null, shades: null, board: null };
    expect((await post('/api/look', { look: { ...base, hat: 'hat:threshold' } }, cookie)).status).toBe(409);
    expect((await post('/api/look', { look: { ...base, hat: 'hat:nope' } }, cookie)).status).toBe(400);
    const res = await post('/api/look', { look: base }, cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { look: unknown }).look).toEqual(base);
    const room = await createRoom(sdk(PORT, { Cookie: cookie }), { nickname: 'Dressed', private: true });
    await waitFor(() => room.state.players.get(room.sessionId)?.outfit === 'outfit:blue', 'outfit synced');
    expect(room.state.players.get(room.sessionId)?.hat).toBe('');
  });

  it('allow one quest reroll a day', async () => {
    const cookie = await newGuest();
    expect((await post('/api/progress/reroll', { quest: 'finish2' }, cookie)).status).toBe(200);
    expect((await post('/api/progress/reroll', { quest: 'tasks5' }, cookie)).status).toBe(409);
  });
});

describe('match rewards', () => {
  it('pay each guest privately at the end, and nothing to idle players', async () => {
    const cookies = await Promise.all(Array.from({ length: 5 }, () => newGuest()));
    const clients = cookies.map((cookie) => sdk(PORT, { Cookie: cookie }));
    const [hostClient, ...rest] = clients;
    if (hostClient === undefined) throw new Error('no client');
    const host = await createRoom(hostClient, { nickname: 'Host', private: true });
    const rooms = [host];
    for (const c of rest) rooms.push(await joinRoom(c, host.roomId, { nickname: 'Guest' }));
    await waitFor(() => rooms.every((r) => r.state.players.size === 5), 'everyone synced');
    const awards = rooms.map((r) => {
      const seen: unknown[] = [];
      r.onMessage(SERVER_MESSAGES.MATCH_REWARDS, (p: unknown) => seen.push(p));
      return seen;
    });
    host.send('startMatch');
    await waitFor(() => rooms.every((r) => r.state.players.get(r.sessionId)?.role !== undefined), 'roles dealt');
    const byzIndex = rooms.findIndex((r) => r.state.players.get(r.sessionId)?.role === 'byzantine');
    const worker = rooms.find((_, i) => i !== byzIndex);
    if (worker === undefined) throw new Error('no worker');

    // One honest guardian does a task; then the Byzantine walks out and the honest side wins.
    const server = colyseus.getRoomById<CitadelRoom>(worker.roomId);
    const p = server.state.players.get(worker.sessionId);
    const c = stationCenter('ledger');
    if (p === undefined) throw new Error('no player');
    p.x = c.x;
    p.y = c.y + 1;
    await waitFor(() => worker.state.players.get(worker.sessionId)?.y === c.y + 1, 'placed');
    const opened = new Promise<unknown>((resolve) => worker.onMessage(SERVER_MESSAGES.TASK_OPENED, resolve));
    worker.send('openTask', { kind: 'ledger' });
    const task = TaskOpenedSchema.parse(await opened);
    const result = new Promise<unknown>((resolve) => worker.onMessage(SERVER_MESSAGES.TASK_RESULT, resolve));
    worker.send('taskAnswer', { id: task.id, answer: solveChallenge(task.challenge) });
    expect(TaskResultSchema.parse(await result).ok).toBe(true);
    await rooms[byzIndex]?.leave();

    const stayed = rooms.map((r, i) => ({ r, i })).filter(({ i }) => i !== byzIndex);
    await waitFor(() => stayed.every(({ i }) => (awards[i]?.length ?? 0) > 0), 'rewards sent', 5000);
    const workerAward = AwardSchema.parse(awards[rooms.indexOf(worker)]?.[0]);
    expect(workerAward.eligible).toBe(true);
    expect(workerAward.lines.map((l) => l.reason)).toContain('won');
    expect(workerAward.seals).toContain('firstShift');
    expect(workerAward.items).toContain('firstMatch');
    expect(workerAward.sats).toBeGreaterThan(0);
    const idle = stayed.find(({ r }) => r !== worker);
    expect(AwardSchema.parse(awards[idle?.i ?? -1]?.[0])).toMatchObject({ eligible: false, ineligible: 'idle' });
    expect(awards[byzIndex]).toEqual([]);

    // The payout is stored: the worker's profile shows the XP, the robe and the sats.
    const profile = (await (await get('/api/profile', cookies[rooms.indexOf(worker)])).json()) as { balance: number; owned: string[]; progress: { xp: number } };
    expect(profile.progress.xp).toBe(workerAward.xpAfter);
    expect(profile.owned).toContain('outfit:genesis');
    expect(profile.balance).toBe(500 + workerAward.sats);
  });
});
