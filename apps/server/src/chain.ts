// Bitcoin chain tip for the Watchtower task and the HUD. One poller per process; rooms only read it.
import { log } from './logger.js';

export interface ChainTip {
  readonly height: number;
  // False while the height is only estimated from the clock.
  readonly live: boolean;
}

export interface ChainTipOptions {
  // Plain-text tip height endpoint, e.g. mempool.space's /api/blocks/tip/height; null to only estimate.
  readonly url: string | null;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

// Block 840,000 (the 2024 halving) and its timestamp anchor the offline estimate.
const ANCHOR_HEIGHT = 840_000;
const ANCHOR_MS = 1_713_571_767_000;
const BLOCK_MS = 600_000;
// A reported height further than this from the estimate is treated as a bad answer.
const SANITY_BAND = 60_000;
// Small reorgs move the tip back a little; anything more is ignored.
const MAX_REORG = 6;
// Forward jumps are capped at four blocks per expected block interval since the last good reading, plus slack.
const FORWARD_SLACK = 6;
const FORWARD_RATE = 4;
// A source that keeps disagreeing with the tip, consistently, is believed after this many readings in a row.
const RESYNC_READINGS = 3;
const MAX_BODY_BYTES = 32;
const MAX_BACKOFF_MS = 15 * 60_000;

export function estimateHeight(nowMs: number): number {
  return ANCHOR_HEIGHT + Math.max(0, Math.floor((nowMs - ANCHOR_MS) / BLOCK_MS));
}

// Reads at most `limit` bytes so a misbehaving endpoint cannot make us buffer a large body.
async function readCapped(res: Response, limit: number): Promise<string | null> {
  const reader: ReadableStreamDefaultReader<unknown> | undefined = res.body?.getReader();
  if (reader === undefined) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      if (!(chunk instanceof Uint8Array)) return null;
      size += chunk.byteLength;
      if (size > limit) return null;
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function parseHeight(body: string | null, nowMs: number): number | null {
  const text = body?.trim() ?? '';
  if (!/^\d{1,9}$/.test(text)) return null;
  const height = Number(text);
  return Math.abs(height - estimateHeight(nowMs)) <= SANITY_BAND ? height : null;
}

export class ChainTipSource {
  readonly #url: string | null;
  readonly #intervalMs: number;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  #live: number | null = null;
  #liveAt = 0;
  // Consistent readings the current tip rules out; enough of them replace it.
  #disputed: { height: number; count: number } | null = null;
  #timer: NodeJS.Timeout | null = null;
  #failures = 0;
  #stopped = true;
  #inFlight = false;

  constructor(options: ChainTipOptions) {
    if (options.url !== null) {
      const url = new URL(options.url);
      if (url.protocol !== 'https:') throw new Error('chain tip url must be https');
    }
    this.#url = options.url;
    this.#intervalMs = options.intervalMs ?? 60_000;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
  }

  current(): ChainTip {
    return this.#live === null ? { height: estimateHeight(this.#now()), live: false } : { height: this.#live, live: true };
  }

  start(): void {
    if (this.#url === null || !this.#stopped) return;
    this.#stopped = false;
    void this.poll();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  // One fetch; exported for tests. Failures back off exponentially and keep the last good height.
  async poll(): Promise<void> {
    if (this.#url === null || this.#inFlight) return;
    this.#inFlight = true;
    let height: number | null = null;
    try {
      const res = await this.#fetch(this.#url, {
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: { accept: 'text/plain' },
      });
      if (res.ok) height = parseHeight(await readCapped(res, MAX_BODY_BYTES), this.#now());
      else await res.body?.cancel().catch(() => undefined);
    } catch {
      height = null;
    } finally {
      this.#inFlight = false;
    }
    if (height === null) {
      this.#failures += 1;
      if (this.#failures === 3) log.warn('chain tip unavailable, using last known or estimated height');
    } else {
      this.#failures = 0;
      this.#consider(height);
    }
    this.#schedule();
  }

  // Accepts a plausible next tip; one wild reading cannot pin the tip, and a source that moved for good is followed.
  #consider(height: number): void {
    const now = this.#now();
    const live = this.#live;
    const allowance = FORWARD_SLACK + Math.ceil((FORWARD_RATE * Math.max(0, now - this.#liveAt)) / BLOCK_MS);
    if (live === null || (height >= live - MAX_REORG && height <= live + allowance)) {
      this.#accept(height, now);
      return;
    }
    const disputed = this.#disputed;
    const agrees = disputed !== null && Math.abs(height - disputed.height) <= FORWARD_SLACK;
    this.#disputed = { height, count: agrees ? disputed.count + 1 : 1 };
    if (this.#disputed.count >= RESYNC_READINGS) {
      log.warn('chain tip source moved; following it');
      this.#accept(height, now);
    }
  }

  #accept(height: number, now: number): void {
    this.#live = height;
    this.#liveAt = now;
    this.#disputed = null;
  }

  #schedule(): void {
    if (this.#stopped) return;
    if (this.#timer !== null) clearTimeout(this.#timer);
    const delay = Math.min(MAX_BACKOFF_MS, this.#intervalMs * 2 ** Math.min(this.#failures, 4));
    this.#timer = setTimeout(() => {
      void this.poll();
    }, delay);
    this.#timer.unref();
  }
}
