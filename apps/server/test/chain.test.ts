import { describe, expect, it } from 'vitest';
import { ChainTipSource, estimateHeight, parseHeight } from '../src/chain.js';

const NOW = Date.UTC(2026, 10, 22);
const URL = 'https://chain.example/api/blocks/tip/height';

function source(fetch: typeof globalThis.fetch) {
  return new ChainTipSource({ url: URL, fetch, now: () => NOW });
}

const reply = (body: string, status = 200): typeof globalThis.fetch => () => Promise.resolve(new Response(body, { status }));

describe('estimateHeight', () => {
  it('counts ten-minute blocks from the 2024 halving', () => {
    expect(estimateHeight(1_713_571_767_000)).toBe(840_000);
    expect(estimateHeight(1_713_571_767_000 + 6 * 600_000)).toBe(840_006);
    expect(estimateHeight(0)).toBe(840_000);
  });
});

describe('parseHeight', () => {
  const near = String(estimateHeight(NOW) - 4000);
  it.each([
    [near, Number(near)],
    [`${near}\n`, Number(near)],
    ['', null],
    ['abc', null],
    ['-5', null],
    ['1e6', null],
    ['12', null],
    ['9999999999', null],
    [null, null],
  ])('reads %j as %s', (body, want) => {
    expect(parseHeight(body, NOW)).toBe(want);
  });
});

describe('ChainTipSource', () => {
  it('estimates until a poll succeeds, then reports the live height', async () => {
    const live = estimateHeight(NOW) - 3000;
    const chain = source(reply(String(live)));
    expect(chain.current()).toStrictEqual({ height: estimateHeight(NOW), live: false });
    await chain.poll();
    expect(chain.current()).toStrictEqual({ height: live, live: true });
  });

  it('keeps the last good height on errors, junk, oversized bodies and big rewinds', async () => {
    const live = estimateHeight(NOW) - 3000;
    let next: typeof globalThis.fetch = reply(String(live));
    const chain = source((input, init) => next(input, init));
    await chain.poll();
    for (const bad of [
      reply('oops', 500),
      reply('not a number'),
      reply(`${String(live)}${' '.repeat(64)}`),
      reply(String(live - 50)),
      () => Promise.reject(new Error('network down')),
    ] as typeof globalThis.fetch[]) {
      next = bad;
      await chain.poll();
      expect(chain.current()).toStrictEqual({ height: live, live: true });
    }
    // A short reorg is accepted.
    next = reply(String(live - 2));
    await chain.poll();
    expect(chain.current().height).toBe(live - 2);
  });

  it('holds back one wild jump instead of pinning the tip to it', async () => {
    const live = estimateHeight(NOW) - 3000;
    let next: typeof globalThis.fetch = reply(String(live));
    const chain = source((input, init) => next(input, init));
    await chain.poll();
    next = reply(String(live + 50_000));
    await chain.poll();
    expect(chain.current()).toStrictEqual({ height: live, live: true });
    // The next honest reading is still accepted, so one bad answer cannot freeze the tip.
    next = reply(String(live + 1));
    await chain.poll();
    expect(chain.current().height).toBe(live + 1);
  });

  it('follows a source that consistently moved, after three readings in a row', async () => {
    const live = estimateHeight(NOW) - 3000;
    let next: typeof globalThis.fetch = reply(String(live));
    const chain = source((input, init) => next(input, init));
    await chain.poll();
    for (const [i, height] of [live - 400, live - 399, live - 399].entries()) {
      next = reply(String(height));
      await chain.poll();
      expect(chain.current().height).toBe(i < 2 ? live : live - 399);
    }
    // Readings that disagree with each other never add up to a resync.
    for (const height of [live + 900, live - 900, live + 900, live - 900]) {
      next = reply(String(height));
      await chain.poll();
    }
    expect(chain.current().height).toBe(live - 399);
  });

  it('allows forward progress in proportion to the time since the last good reading', async () => {
    let now = NOW;
    const live = estimateHeight(NOW) - 3000;
    let next: typeof globalThis.fetch = reply(String(live));
    const chain = new ChainTipSource({ url: URL, fetch: (input, init) => next(input, init), now: () => now });
    await chain.poll();
    next = reply(String(live + 20));
    await chain.poll();
    expect(chain.current().height).toBe(live);
    // An hour later twenty new blocks are plausible.
    now += 60 * 60_000;
    await chain.poll();
    expect(chain.current().height).toBe(live + 20);
  });

  it('never runs two polls at once', async () => {
    let calls = 0;
    let release: (res: Response) => void = () => undefined;
    const chain = source(() => {
      calls += 1;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const first = chain.poll();
    await chain.poll();
    expect(calls).toBe(1);
    release(new Response(String(estimateHeight(NOW))));
    await first;
    expect(chain.current().live).toBe(true);
  });

  it('refuses redirects and asks for plain text', async () => {
    let seen: RequestInit | undefined;
    const chain = source((_input, init) => {
      seen = init;
      return Promise.resolve(new Response(String(estimateHeight(NOW))));
    });
    await chain.poll();
    expect(seen?.redirect).toBe('error');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it('only accepts https endpoints, or none at all', () => {
    expect(() => new ChainTipSource({ url: 'http://chain.example/height' })).toThrow();
    expect(() => new ChainTipSource({ url: 'not a url' })).toThrow();
    const off = new ChainTipSource({ url: null, now: () => NOW });
    off.start();
    expect(off.current().live).toBe(false);
    off.stop();
  });
});
