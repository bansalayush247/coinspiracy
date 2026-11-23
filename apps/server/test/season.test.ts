import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { SEASON_PATH, SeasonReplySchema } from '@byzantine-council/shared/seasons';
import { freshIp, startServer } from './helpers.js';

const PORT = 3892;
let colyseus: ColyseusTestServer | undefined;

afterAll(async () => {
  await colyseus?.shutdown();
});

describe('season endpoint', () => {
  it('answers with a valid, cacheable banner and rate-limits per network', async () => {
    ({ colyseus } = await startServer(PORT));
    const ip = freshIp();
    const res = await fetch(`http://127.0.0.1:${String(PORT)}${SEASON_PATH}`, { headers: { 'X-Real-IP': ip } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(SeasonReplySchema.safeParse(await res.json()).success).toBe(true);
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await fetch(`http://127.0.0.1:${String(PORT)}${SEASON_PATH}`, { headers: { 'X-Real-IP': ip } })).status);
    expect(statuses).toContain(429);
  });
});
