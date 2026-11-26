import { readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FEEDBACK_MAX_TEXT, FEEDBACK_PATH, feedbackWhere } from '@byzantine-council/shared';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { fileFeedbackSink, memoryFeedbackSink } from '../src/feedback.js';
import { ORIGIN, freshIp, startServer } from './helpers.js';

const PORT = 3874;
const URL_ = `http://127.0.0.1:${String(PORT)}${FEEDBACK_PATH}`;
const PER_TEN_MINUTES = 3;
const sink = memoryFeedbackSink(5);
const GOOD = { fun: 4, text: '  The letters were fun but Varnish is too slow.  ', where: 'story:book', locale: 'en', build: '0.1.0' };
let colyseus: ColyseusTestServer;

function send(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(URL_, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Real-IP': freshIp(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { feedback: { sink, perNetworkPer10Min: PER_TEN_MINUTES } }));
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe('playtest feedback', () => {
  it('stores the rating, note and place, trimmed, with the time rounded to the minute and nothing about the sender', async () => {
    const res = await send(GOOD, { 'X-Real-IP': '203.0.113.9', Cookie: 'bc_guest=abc' });
    expect(res.status).toBe(204);
    const record = sink.records.at(-1);
    expect(record).toMatchObject({ fun: 4, text: 'The letters were fun but Varnish is too slow.', where: 'story:book', locale: 'en', build: '0.1.0' });
    expect(record?.t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    expect(JSON.stringify(record)).not.toMatch(/203\.0\.113\.9|bc_guest|abc/);
    expect(Object.keys(record ?? {}).sort()).toEqual(['build', 'fun', 'locale', 't', 'text', 'where']);
  });

  it('refuses other origins, other content types, bad bodies and oversized ones', async () => {
    expect((await send(GOOD, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await send(GOOD, { 'Content-Type': 'text/plain' })).status).toBe(415);
    for (const bad of [
      { ...GOOD, fun: 7 },
      { ...GOOD, fun: 0 },
      { ...GOOD, extra: 1 },
      { ...GOOD, text: 'x'.repeat(FEEDBACK_MAX_TEXT + 1) },
      { ...GOOD, text: 'hidden\u202eevil' },
      { ...GOOD, text: 'line\u0007bell' },
      { ...GOOD, where: 'Story Book' },
      { ...GOOD, locale: 'fr' },
      { ...GOOD, build: '<script>' },
      '{not json',
    ]) {
      const res = await send(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await send({ ...GOOD, text: 'y'.repeat(3000) })).status).toBe(413);
  });

  it('limits each network, and answers busy once the day is full', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < PER_TEN_MINUTES + 2; i++) statuses.push((await send(GOOD, { 'X-Real-IP': ip })).status);
    expect(statuses.slice(PER_TEN_MINUTES)).toEqual([429, 429]);
    while (sink.records.length < 5) await send(GOOD);
    expect((await send(GOOD)).status).toBe(503);
  });

  it('is off unless FEEDBACK_DIR is an absolute path', () => {
    expect(loadConfig({}).feedbackDir).toBeNull();
    expect(loadConfig({ FEEDBACK_DIR: '/var/lib/byzantine-council/feedback' }).feedbackDir).toBe('/var/lib/byzantine-council/feedback');
    expect(() => loadConfig({ FEEDBACK_DIR: 'relative/dir' })).toThrow(/FEEDBACK_DIR/);
    expect(() => loadConfig({ FEEDBACK_DIR: '/var/lib/../etc' })).toThrow(/FEEDBACK_DIR/);
  });

  it('writes one owner-only JSON line per note into a daily file, up to a daily cap', async () => {
    const dir = fileURLToPath(new URL(`../../../.scratch/test-feedback-${String(process.pid)}/`, import.meta.url));
    try {
      const files = fileFeedbackSink(dir, 300);
      const at = Date.UTC(2026, 10, 26, 9, 30);
      const record = { t: new Date(at).toISOString(), fun: 5, text: 'Loved the crowd.', where: 'story:clock', locale: 'es' as const, build: '0.1.0' };
      expect(await files.write(record, at)).toBe('ok');
      expect(await files.write(record, at)).toBe('ok');
      expect(await files.write(record, at)).toBe('full');
      const file = `${dir}feedback-2026-11-26.jsonl`;
      const lines = (await readFile(file, 'utf8')).trim().split('\n');
      expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([record, record]);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await files.write(record, Date.UTC(2026, 10, 27))).toBe('ok');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('names the place in the game without anything a player typed', () => {
    expect(feedbackWhere('story', 'book')).toBe('story:book');
    expect(feedbackWhere('match')).toBe('match');
    expect(feedbackWhere('City Hall!', '')).toBe('cityhall');
    expect(feedbackWhere('9lives')).toBe('menu');
  });
});
