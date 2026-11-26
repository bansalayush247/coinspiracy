// POST /api/discord/token: an Activity's OAuth2 code in, a signed guest session token out. Nothing about the Discord user is stored.
import { Router, json, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ipKey, requestIp } from '../clientIp.js';
import { log } from '../logger.js';
import { signCookie, type SessionKeys } from '../profile/session.js';
import type { RateLimiter } from '../scaling/index.js';
import type { DiscordConfig } from './config.js';
import { discordProfileId, exchangeDiscordCode, type FetchLike } from './oauth.js';

/** The token exchange route, under the server's own path (`/colyseus` behind nginx). */
export const DISCORD_TOKEN_PATH = '/api/discord/token';

/** Request body: Discord's authorization codes are short URL-safe strings. */
export const DiscordTokenRequestSchema = z.strictObject({ code: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });

/** Settings and limiters for the token exchange route. */
export interface DiscordRouterOptions {
  readonly config: DiscordConfig;
  readonly keys: SessionKeys;
  readonly allowedOrigins: ReadonlySet<string>;
  /** Per network: exchanges each address may start. */
  readonly perNetwork: RateLimiter;
  /** Process-wide, keyed by one constant: caps the calls this server makes to Discord. */
  readonly overall: RateLimiter;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly maxInFlight?: number;
  readonly timeoutMs?: number;
}

/** The Express router to mount, and a stop() for its limiters. */
export interface DiscordRouter {
  readonly router: Router;
  stop(): void;
}

function fail(res: Response, status: number, error: string): void {
  if (!res.headersSent) res.status(status).json({ error });
}

/** The exchange route; with Discord off it registers nothing, so the path is a plain 404. */
export function createDiscordRouter(options: DiscordRouterOptions): DiscordRouter {
  const router = Router();
  const config = options.config;
  const stop = (): void => {
    options.perNetwork.stop();
    options.overall.stop();
  };
  if (config.state === 'off') return { router, stop };

  const now = options.now ?? Date.now;
  const fetchFn: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const maxInFlight = options.maxInFlight ?? 32;
  const timeoutMs = options.timeoutMs ?? 5_000;
  let inFlight = 0;
  const body = json({ limit: '1kb', strict: true, type: 'application/json' });

  const gate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (config.state !== 'on') {
      fail(res, 503, 'discord_unavailable');
      return;
    }
    if (!(await options.perNetwork.take(ipKey(requestIp(req))))) {
      fail(res, 429, 'rate_limited');
      return;
    }
    const origin = req.headers.origin;
    if (origin === undefined || !options.allowedOrigins.has(origin)) {
      fail(res, 403, 'origin_not_allowed');
      return;
    }
    if ((req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      fail(res, 415, 'json_required');
      return;
    }
    next();
  };

  router.post(DISCORD_TOKEN_PATH, gate, body, async (req, res) => {
    if (config.state !== 'on') return;
    const parsed = DiscordTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'bad_request');
      return;
    }
    if (inFlight >= maxInFlight || !(await options.overall.take('all'))) {
      fail(res, 503, 'busy');
      return;
    }
    inFlight += 1;
    try {
      const out = await exchangeDiscordCode(config.settings, parsed.data.code, fetchFn, timeoutMs);
      if (!out.ok) {
        log.warn('discord exchange failed', { reason: out.reason });
        fail(res, out.reason === 'rejected' ? 401 : 502, out.reason === 'rejected' ? 'discord_rejected' : 'discord_unreachable');
        return;
      }
      const profileId = discordProfileId(config.settings.profileKey, out.userId);
      res.json({ token: signCookie(options.keys, profileId, now()) });
    } catch (error) {
      log.error('discord exchange error', error);
      fail(res, 500, 'server_error');
    } finally {
      inFlight -= 1;
    }
  });

  // Body-parser errors (bad JSON, too large) answer in JSON like every other refusal.
  router.use(DISCORD_TOKEN_PATH, (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = typeof error === 'object' && error !== null && 'status' in error && error.status === 413 ? 413 : 400;
    fail(res, status, status === 413 ? 'body_too_large' : 'bad_request');
  });

  return { router, stop };
}
