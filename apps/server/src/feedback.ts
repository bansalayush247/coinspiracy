// POST /api/feedback: a playtester's rating and note, appended to a daily file. Nothing that identifies the sender
// (address, profile, cookie) is kept; the time is rounded to the minute.
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FEEDBACK_PATH, FeedbackSchema, type Feedback } from '@byzantine-council/shared';
import { Router, json, type NextFunction, type Request, type Response } from 'express';
import { ipKey, requestIp } from './clientIp.js';
import { log } from './logger.js';
import type { RateLimiter } from './scaling/index.js';

/** What one stored line holds. */
export interface FeedbackRecord extends Feedback {
  /** When it arrived, as an ISO time rounded down to the minute. */
  readonly t: string;
}

/** Where feedback goes: `full` once today's cap is reached. */
export interface FeedbackSink {
  write(record: FeedbackRecord, nowMs: number): Promise<'ok' | 'full'>;
}

/** Daily JSON-lines files `feedback-YYYY-MM-DD.jsonl` in `dir`, owner-only, each capped at `maxBytesPerDay`. */
export function fileFeedbackSink(dir: string, maxBytesPerDay = 5_000_000): FeedbackSink {
  let ready: Promise<unknown> | null = null;
  let day = '';
  let bytes = 0;
  return {
    async write(record, nowMs) {
      ready ??= mkdir(dir, { recursive: true, mode: 0o700 });
      await ready;
      const today = new Date(nowMs).toISOString().slice(0, 10);
      const file = join(dir, `feedback-${today}.jsonl`);
      if (today !== day) {
        day = today;
        bytes = await stat(file).then((s) => s.size, () => 0);
      }
      const line = `${JSON.stringify(record)}\n`;
      const size = Buffer.byteLength(line);
      if (bytes + size > maxBytesPerDay) return 'full';
      bytes += size;
      await appendFile(file, line, { mode: 0o600, flag: 'a' });
      return 'ok';
    },
  };
}

/** Keeps feedback in memory, for tests. */
export function memoryFeedbackSink(maxRecords = 1000): FeedbackSink & { readonly records: FeedbackRecord[] } {
  const records: FeedbackRecord[] = [];
  return {
    records,
    write(record) {
      if (records.length >= maxRecords) return Promise.resolve('full');
      records.push(record);
      return Promise.resolve('ok');
    },
  };
}

/** Settings and limiters for the feedback route. */
export interface FeedbackRouterOptions {
  readonly sink: FeedbackSink;
  readonly allowedOrigins: ReadonlySet<string>;
  /** Per network: how much feedback each address may send. */
  readonly perNetwork: RateLimiter;
  /** Process-wide, keyed by one constant. */
  readonly overall: RateLimiter;
  readonly now?: () => number;
}

/** The Express router to mount, and a stop() for its limiters. */
export interface FeedbackRouter {
  readonly router: Router;
  stop(): void;
}

function fail(res: Response, status: number, error: string): void {
  if (!res.headersSent) res.status(status).json({ error });
}

/** The feedback route: origin-checked, rate-limited, schema-checked, and stored without anything that identifies the sender. */
export function createFeedbackRouter(options: FeedbackRouterOptions): FeedbackRouter {
  const router = Router();
  const now = options.now ?? Date.now;
  const body = json({ limit: '2kb', strict: true, type: 'application/json' });

  const gate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const origin = req.headers.origin;
    if (origin === undefined || !options.allowedOrigins.has(origin)) {
      fail(res, 403, 'origin_not_allowed');
      return;
    }
    if ((req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      fail(res, 415, 'json_required');
      return;
    }
    if (!(await options.perNetwork.take(ipKey(requestIp(req))))) {
      fail(res, 429, 'rate_limited');
      return;
    }
    next();
  };

  router.post(FEEDBACK_PATH, gate, body, async (req, res) => {
    const parsed = FeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'bad_request');
      return;
    }
    if (!(await options.overall.take('all'))) {
      fail(res, 503, 'busy');
      return;
    }
    const at = now();
    const record: FeedbackRecord = { t: new Date(Math.floor(at / 60_000) * 60_000).toISOString(), ...parsed.data };
    try {
      const out = await options.sink.write(record, at);
      if (out === 'full') {
        fail(res, 503, 'busy');
        return;
      }
      res.status(204).end();
    } catch (error) {
      log.error('feedback write failed', error);
      fail(res, 500, 'server_error');
    }
  });

  router.use(FEEDBACK_PATH, (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = typeof error === 'object' && error !== null && 'status' in error && error.status === 413 ? 413 : 400;
    fail(res, status, status === 413 ? 'body_too_large' : 'bad_request');
  });

  return {
    router,
    stop: () => {
      options.perNetwork.stop();
      options.overall.stop();
    },
  };
}
