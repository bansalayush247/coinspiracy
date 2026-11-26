import { FEEDBACK_PATH } from '@byzantine-council/shared';
import { describe, expect, it } from 'vitest';
import { feedbackBuild, sendFeedback } from '../src/ui/feedback.js';

const BASE = 'https://play.example.org/colyseus';
const BODY = { fun: 5, text: 'Loved the crowd.', where: 'story:clock', locale: 'en', build: 'dev' } as const;

function fakeFetch(reply: number | 'throw') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (reply === 'throw') return Promise.reject(new Error('offline'));
    return Promise.resolve(new Response(null, { status: reply }));
  }) as typeof fetch;
  return { fn, calls };
}

describe('playtest feedback from the client', () => {
  it('posts JSON to the feedback route without cookies or credentials', async () => {
    const { fn, calls } = fakeFetch(204);
    expect(await sendFeedback(BASE, BODY, fn)).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}${FEEDBACK_PATH}`);
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(BODY);
  });

  it('tells a rate limit apart from any other failure', async () => {
    expect(await sendFeedback(BASE, BODY, fakeFetch(429).fn)).toBe('limited');
    expect(await sendFeedback(BASE, BODY, fakeFetch(500).fn)).toBe('failed');
    expect(await sendFeedback(BASE, BODY, fakeFetch('throw').fn)).toBe('failed');
  });

  it('never sends feedback the server would refuse', async () => {
    const { fn, calls } = fakeFetch(204);
    expect(await sendFeedback(BASE, { ...BODY, fun: 9 }, fn)).toBe('failed');
    expect(await sendFeedback(BASE, { ...BODY, text: 'x'.repeat(601) }, fn)).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  it('reports a safe build id, or dev', () => {
    expect(feedbackBuild('2026.11.26-a')).toBe('2026.11.26-a');
    expect(feedbackBuild(undefined)).toBe('dev');
    expect(feedbackBuild('<script>')).toBe('dev');
    expect(feedbackBuild('x'.repeat(41))).toBe('dev');
  });
});
