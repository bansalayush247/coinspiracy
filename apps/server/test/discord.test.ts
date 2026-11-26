import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ColyseusTestServer } from '@colyseus/testing';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { discordConfig, type DiscordConfig } from '../src/discord/config.js';
import { DISCORD_API, discordProfileId, type FetchLike } from '../src/discord/oauth.js';
import { DISCORD_TOKEN_PATH, createDiscordRouter } from '../src/discord/router.js';
import { MAX_FRAME_ANCESTORS, frameAncestorsDirective, parseFrameAncestors } from '../src/frameAncestors.js';
import { gateSecurityHeaders } from '../src/httpGate.js';
import { BEARER_MAX_AGE_S, applyBearerSession } from '../src/profile/bearer.js';
import { MemoryProfileStore } from '../src/profile/store.js';
import { COOKIE_NAME, signCookie, verifyCookie, type SessionKeys } from '../src/profile/session.js';
import { createScaling } from '../src/scaling/index.js';
import { ORIGIN, createRoom, freshIp, sdk, startServer, waitFor } from './helpers.js';

const PORT = 3871;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const DISCORD_ORIGIN = 'https://123456789012345678.discordsays.com';
const FRAMERS = ['https://discord.com', 'https://*.discordsays.com', 'https://games.crazygames.com'];
const keys: SessionKeys = { current: Buffer.from('k'.repeat(32)), previous: null, secure: false };
const ENV = { DISCORD_CLIENT_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 's'.repeat(32), DISCORD_PROFILE_SECRET: 'p'.repeat(40) };
const PER_MINUTE = 5;
const USERS: Readonly<Record<string, string>> = { alice: '80351110224678912', bob: '80351110224678913' };

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly authorization: string;
}

const seen: Seen[] = [];
let discordDown = false;

function jsonReply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fakeDiscord: FetchLike = (url, init) => {
  const headers = new Headers(init.headers);
  const body = typeof init.body === 'string' ? init.body : '';
  seen.push({ url, method: init.method ?? 'GET', body, authorization: headers.get('authorization') ?? '' });
  if (discordDown) return Promise.reject(new Error('network down'));
  if (url === `${DISCORD_API}/oauth2/token`) {
    const form = new URLSearchParams(body);
    const code = form.get('code') ?? '';
    if (form.get('client_secret') !== ENV.DISCORD_CLIENT_SECRET || form.get('grant_type') !== 'authorization_code') return Promise.resolve(jsonReply(401, { error: 'invalid_client' }));
    if (code === 'noscope') return Promise.resolve(jsonReply(200, { access_token: 'at-noscope', token_type: 'Bearer', scope: 'guilds' }));
    if (code === 'huge') return Promise.resolve(jsonReply(200, { access_token: 'at-huge', token_type: 'Bearer', scope: 'identify' }));
    if (code === 'teapot') return Promise.resolve(jsonReply(500, {}));
    if (USERS[code] === undefined) return Promise.resolve(jsonReply(400, { error: 'invalid_grant' }));
    return Promise.resolve(jsonReply(200, { access_token: `at-${code}`, token_type: 'Bearer', scope: 'identify', expires_in: 604800, refresh_token: `rt-${code}` }));
  }
  if (url === `${DISCORD_API}/users/@me`) {
    const who = headers.get('authorization')?.replace('Bearer at-', '') ?? '';
    if (who === 'huge') return Promise.resolve(jsonReply(200, { id: USERS['alice'], pad: 'x'.repeat(40_000) }));
    const id = USERS[who];
    if (id === undefined) return Promise.resolve(jsonReply(401, {}));
    return Promise.resolve(jsonReply(200, { id, username: `${who}_real`, global_name: `${who} Realname`, avatar: 'abc' }));
  }
  return Promise.resolve(jsonReply(404, {}));
};

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, {
    allowedOrigins: new Set([ORIGIN, DISCORD_ORIGIN]),
    profiles: { store: new MemoryProfileStore(), keys },
    discord: { config: discordConfig(ENV), fetch: fakeDiscord, perNetworkPerMinute: PER_MINUTE },
    frameAncestors: FRAMERS,
  }));
});

afterEach(async () => {
  seen.length = 0;
  discordDown = false;
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function exchange(body: unknown, options: { origin?: string | null; type?: string; ip?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': options.type ?? 'application/json', 'x-real-ip': options.ip ?? freshIp() };
  const origin = options.origin === undefined ? DISCORD_ORIGIN : options.origin;
  if (origin !== null) headers['origin'] = origin;
  return fetch(`${BASE}${DISCORD_TOKEN_PATH}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

async function tokenFor(code: string): Promise<string> {
  const res = await exchange({ code });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function withBearer(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { ...init, headers: { origin: DISCORD_ORIGIN, 'x-real-ip': freshIp(), authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) } });
}

describe('discord token exchange', () => {
  it('maps a Discord user to a stable guest profile and returns a signed session token', async () => {
    const first = await tokenFor('alice');
    const again = await tokenFor('alice');
    const other = await tokenFor('bob');
    const id = (t: string) => verifyCookie(keys, t, Date.now())?.id;
    expect(id(first)).toBeDefined();
    expect(id(first)).toBe(id(again));
    expect(id(other)).not.toBe(id(first));
    expect(id(first)).toBe(discordProfileId(Buffer.from(ENV.DISCORD_PROFILE_SECRET), USERS['alice'] ?? ''));
    expect(first).not.toContain(USERS['alice']);
  });

  it('asks Discord with the secret server-side and returns no Discord token or name', async () => {
    const res = await exchange({ code: 'alice' });
    const text = await res.text();
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['token']);
    for (const secret of ['at-alice', 'rt-alice', 'alice_real', 'Realname', USERS['alice'] ?? '', ENV.DISCORD_CLIENT_SECRET]) expect(text).not.toContain(secret);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([`POST ${DISCORD_API}/oauth2/token`, `GET ${DISCORD_API}/users/@me`]);
    expect(new URLSearchParams(seen[0]?.body).get('client_id')).toBe(ENV.DISCORD_CLIENT_ID);
    expect(seen[1]?.authorization).toBe('Bearer at-alice');
  });

  it('opens the profile API and room sockets with the bearer token instead of a cookie', async () => {
    const token = await tokenFor('alice');
    const session = await withBearer('/api/session', token, { method: 'POST', body: '{}' });
    expect(session.status).toBe(200);
    expect(((await session.json()) as { balance: number }).balance).toBe(500);
    expect((await withBearer('/api/profile', token)).status).toBe(200);
    expect((await withBearer('/api/profile', `${token}x`)).status).toBe(401);
    const look = { outfit: 'outfit:blue', hair: 'hair:hood', dye: 'dye:dark', beard: null, hat: null, shades: null, board: null };
    expect((await withBearer('/api/look', token, { method: 'POST', body: JSON.stringify({ look }) })).status).toBe(200);
    const client = sdk(PORT, { Origin: DISCORD_ORIGIN });
    client.auth.token = token;
    const room = await createRoom(client, { nickname: 'Proxied', private: true });
    await waitFor(() => room.state.players.get(room.sessionId)?.outfit === 'outfit:blue', 'bearer outfit synced');
  });

  it('validates the request', async () => {
    expect((await exchange({ code: 'alice' }, { origin: null })).status).toBe(403);
    expect((await exchange({ code: 'alice' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await exchange('code=alice', { type: 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await exchange({ code: '../etc' })).status).toBe(400);
    expect((await exchange({ code: '' })).status).toBe(400);
    expect((await exchange({ code: 'alice', scope: 'guilds' })).status).toBe(400);
    expect((await exchange('{not json')).status).toBe(400);
    expect((await exchange({ code: 'a'.repeat(129) })).status).toBe(400);
    expect((await exchange({ code: 'x'.repeat(4000) })).status).toBe(413);
    expect(seen).toEqual([]);
  });

  it('rate-limits each network', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i <= PER_MINUTE; i += 1) statuses.push((await exchange({ code: 'nobody' }, { ip })).status);
    expect(statuses.slice(0, PER_MINUTE).every((s) => s === 401)).toBe(true);
    expect(statuses[PER_MINUTE]).toBe(429);
    expect((await exchange({ code: 'alice' })).status).toBe(200);
  });

  it('refuses codes Discord rejects and fails closed when Discord misbehaves', async () => {
    expect((await exchange({ code: 'nobody' })).status).toBe(401);
    expect((await exchange({ code: 'noscope' })).status).toBe(401);
    expect((await exchange({ code: 'teapot' })).status).toBe(502);
    expect((await exchange({ code: 'huge' })).status).toBe(502);
    discordDown = true;
    expect((await exchange({ code: 'alice' })).status).toBe(502);
  });
});

describe('discord config', () => {
  it('is off with nothing set, broken when partial or invalid, and names variables only', () => {
    expect(discordConfig({}).state).toBe('off');
    const partial = discordConfig({ DISCORD_CLIENT_ID: ENV.DISCORD_CLIENT_ID });
    expect(partial.state).toBe('broken');
    const bad = discordConfig({ ...ENV, DISCORD_CLIENT_SECRET: 'short!' });
    expect(bad).toMatchObject({ state: 'broken' });
    expect(JSON.stringify(bad)).not.toContain('short!');
    expect(discordConfig(ENV).state).toBe('on');
  });

  it('answers 404 when off and 503 when misconfigured, without calling Discord', async () => {
    const app = express();
    const scaling = createScaling();
    const mount = (prefix: string, config: DiscordConfig): void => {
      const { router } = createDiscordRouter({ config, keys, allowedOrigins: new Set([ORIGIN]), perNetwork: scaling.rateLimiter('t', 50, 60_000), overall: scaling.rateLimiter('u', 50, 60_000), fetch: fakeDiscord });
      app.use(prefix, router);
    };
    mount('/off', discordConfig({}));
    mount('/broken', discordConfig({ DISCORD_CLIENT_ID: ENV.DISCORD_CLIENT_ID }));
    const server: Server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const call = (prefix: string) => fetch(`http://127.0.0.1:${String(port)}${prefix}${DISCORD_TOKEN_PATH}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{"code":"alice"}' });
    expect((await call('/off')).status).toBe(404);
    expect((await call('/broken')).status).toBe(503);
    expect(seen).toEqual([]);
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  });
});

describe('bearer sessions at the gate', () => {
  const request = (headers: Record<string, string>, url = '/api/profile') => ({ headers: { ...headers }, url }) as unknown as IncomingMessage;

  it('turns a valid token into the guest cookie and leaves token-less requests alone', () => {
    const token = signCookie(keys, 'A'.repeat(22), Date.now());
    const http = request({ authorization: `Bearer ${token}`, cookie: 'other=1' });
    expect(applyBearerSession(keys, http, Date.now(), false)).toBe(true);
    expect(http.headers.cookie).toBe(`${COOKIE_NAME}=${token}`);
    const socket = request({}, `/abc/room?sessionId=x&_authToken=${token}`);
    expect(applyBearerSession(keys, socket, Date.now(), true)).toBe(true);
    expect(socket.headers.cookie).toBe(`${COOKIE_NAME}=${token}`);
    const web = request({ cookie: `${COOKIE_NAME}=web` });
    expect(applyBearerSession(keys, web, Date.now(), false)).toBe(false);
    expect(web.headers.cookie).toBe(`${COOKIE_NAME}=web`);
  });

  it('drops every cookie for a forged, expired or oversized token', () => {
    const old = signCookie(keys, 'B'.repeat(22), Date.now() - (BEARER_MAX_AGE_S + 60) * 1000);
    const forged = signCookie({ ...keys, current: Buffer.from('z'.repeat(32)) }, 'C'.repeat(22), Date.now());
    for (const token of [old, forged, 'x'.repeat(300)]) {
      const req = request({ authorization: `Bearer ${token}`, cookie: `${COOKIE_NAME}=web` });
      expect(applyBearerSession(keys, req, Date.now(), false)).toBe(false);
      expect(req.headers.cookie).toBeUndefined();
    }
  });
});

describe('frame-ancestors', () => {
  it('sends the configured framers on every server response', async () => {
    const res = await fetch(`${BASE}/healthz`);
    expect(res.headers.get('content-security-policy')).toBe(`default-src 'none'; frame-ancestors ${FRAMERS.join(' ')}`);
  });

  it("keeps today's 'none' by default", () => {
    expect(gateSecurityHeaders()['Content-Security-Policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(frameAncestorsDirective(parseFrameAncestors(undefined))).toBe("frame-ancestors 'none'");
    expect(loadConfig({}).frameAncestors).toEqual([]);
  });

  it('accepts only https origins from FRAME_ANCESTORS', () => {
    expect(loadConfig({ FRAME_ANCESTORS: ' https://discord.com , https://*.discordsays.com ' }).frameAncestors).toEqual(['https://discord.com', 'https://*.discordsays.com']);
    for (const bad of ['*', "'self'", 'http://discord.com', 'https://discord.com/path', 'https:', 'https://*', 'https://a.*.com', 'data:', 'https://discord.com;script-src *']) {
      expect(() => loadConfig({ FRAME_ANCESTORS: bad }), bad).toThrow(/FRAME_ANCESTORS/);
    }
    const many = Array.from({ length: MAX_FRAME_ANCESTORS + 1 }, (_, i) => `https://p${String(i)}.example.com`).join(',');
    expect(() => parseFrameAncestors(many)).toThrow();
  });

  it('lets allowed origins send the Authorization header cross-origin', async () => {
    const res = await fetch(`${BASE}/api/profile`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });
});
