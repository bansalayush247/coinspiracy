import { request } from 'node:http';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_CODES, ROOM_NAME } from '@byzantine-council/shared';
import { ORIGIN, freshIp, startServer } from './helpers.js';

const PORT = 3862;
const BASE = `http://127.0.0.1:${String(PORT)}`;
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { matchmakePerMinute: 5 }));
});

afterAll(async () => {
  await colyseus.shutdown();
});

function matchmake(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}/matchmake/joinOrCreate/${ROOM_NAME}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Real-IP': freshIp(), ...headers },
    body,
  });
}

// fetch cannot send a chunked body with no length, so this uses node:http directly.
function chunkedPost(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers = { 'Transfer-Encoding': 'chunked', 'Content-Type': 'application/json' };
    const req = request(`${BASE}${path}`, { method: 'POST', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.write('{"nickname":');
    req.end('"Chunky"}');
  });
}

describe('CORS', () => {
  it('allows the client origin and nobody else on matchmake routes', async () => {
    // The SDK fetches with credentials, so the client origin needs Allow-Credentials.
    const allowed = await matchmake('{"nickname":"Alice"}', { Origin: ORIGIN });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');

    const evil = await matchmake('{"nickname":"Mallory"}', { Origin: 'https://evil.example' });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    expect(evil.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('refuses matchmaking and code lookups from foreign pages, even when the response would be hidden', async () => {
    const evil = await matchmake('{"nickname":"Mallory"}', { Origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toStrictEqual({ error: 'origin_not_allowed' });
    const lookup = await fetch(`${BASE}/api/rooms/ABCDEF`, { headers: { Origin: 'https://evil.example', 'X-Real-IP': freshIp() } });
    expect(lookup.status).toBe(403);
  });

  it('refuses form-encoded matchmake bodies, which a cross-site form could send without a preflight', async () => {
    const res = await fetch(`${BASE}/matchmake/joinOrCreate/${ROOM_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Real-IP': freshIp() },
      body: 'nickname=Mallory',
    });
    expect(res.status).toBe(415);
    const text = await fetch(`${BASE}/matchmake/joinOrCreate/${ROOM_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-Real-IP': freshIp() },
      body: '{"nickname":"Mallory"}',
    });
    expect(text.status).toBe(415);
  });

  it('still serves requests without an Origin, such as server-to-server checks', async () => {
    expect((await matchmake('{"nickname":"Alice"}')).status).toBe(200);
  });

  it('answers preflight for the client origin only, never with a wildcard', async () => {
    const preflight = (origin: string) =>
      fetch(`${BASE}/matchmake/joinOrCreate/${ROOM_NAME}`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      });
    const evil = await preflight('https://evil.example');
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    expect(evil.headers.get('access-control-allow-credentials')).toBeNull();
    const ok = await preflight(ORIGIN);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    expect(ok.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
  });

  it('adds no wildcard for requests without an Origin', async () => {
    const res = await fetch(`${BASE}/healthz`);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('HTTP hardening', () => {
  it('sends security headers on app and Colyseus routes', async () => {
    for (const res of [await fetch(`${BASE}/healthz`), await matchmake('{"nickname":"Alice"}')]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-powered-by')).toBeNull();
    }
  });

  it('does not reveal the Colyseus version on /', async () => {
    const res = await fetch(`${BASE}/`);
    expect(await res.text()).not.toMatch(/colyseus/i);
  });

  it('reports health', async () => {
    const res = await fetch(`${BASE}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ ok: true });
  });

  it('refuses oversized and chunked matchmake bodies before Colyseus parses them', async () => {
    const big = JSON.stringify({ nickname: 'Alice', pad: 'x'.repeat(5000) });
    expect((await matchmake(big)).status).toBe(413);
    expect(await chunkedPost(`/matchmake/joinOrCreate/${ROOM_NAME}`)).toBe(411);
  });

  it('rate-limits matchmaking per network, counting rejected attempts too', async () => {
    const ip = freshIp();
    const codes: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await matchmake('{"nickname":"x"}', { 'X-Real-IP': ip });
      codes.push(((await res.json()) as { code?: unknown }).code);
    }
    expect(codes.slice(0, 5).every((c) => c !== CLOSE_CODES.RATE_LIMITED)).toBe(true);
    expect(codes[5]).toBe(CLOSE_CODES.RATE_LIMITED);
    // Another network is unaffected.
    const other = await matchmake('{"nickname":"Alice"}');
    expect(other.status).toBe(200);
  });
});
