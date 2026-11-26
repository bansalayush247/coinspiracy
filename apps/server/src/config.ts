import { isIP } from 'node:net';
import { z } from 'zod';
import { parseFrameAncestors } from './frameAncestors.js';

// Vite serves the client here in development (5199 is taken on the dev machine).
export const DEV_CLIENT_ORIGINS = ['http://127.0.0.1:5180', 'http://localhost:5180'] as const;

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

export const DEFAULT_BLOCK_HEIGHT_URL = 'https://mempool.space/api/blocks/tip/height';

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const list = z
  .string()
  .max(4096)
  .transform((raw) =>
    raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(2567),
  // Loopback by default: production runs behind a TLS reverse proxy on the same host.
  HOST: z.string().min(1).default('127.0.0.1'),
  ALLOWED_ORIGINS: list.pipe(z.array(z.string().refine(isOrigin, 'not an origin like https://play.example.com')).min(1)).optional(),
  // Peers allowed to set X-Real-IP. "none" means clients connect directly.
  TRUSTED_PROXIES: list
    .transform((items) => (items.length === 1 && items[0] === 'none' ? [] : items))
    .pipe(z.array(z.string().refine((ip) => isIP(ip) !== 0, 'not an IP address')))
    .optional(),
  // Households and classrooms share an address, so this is generous.
  MAX_SEATS_PER_IP: z.coerce.number().int().min(1).max(1000).default(16),
  // Plain-text Bitcoin tip height over https, or "off" to estimate from the clock.
  // Practice bots the host can add to a lobby.
  BOTS: z.enum(['on', 'off']).default('on'),
  BLOCK_HEIGHT_URL: z
    .string()
    .max(512)
    .default(DEFAULT_BLOCK_HEIGHT_URL)
    .refine((v) => v === 'off' || isHttpsUrl(v), 'must be an https URL or "off"'),
  // Origins that may frame the game (Discord, web portals); unset keeps frame-ancestors 'none'.
  FRAME_ANCESTORS: z
    .string()
    .max(4096)
    .optional()
    .transform((raw, ctx) => {
      try {
        return parseFrameAncestors(raw);
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'invalid' });
        return z.NEVER;
      }
    }),
});

export interface ServerConfig {
  readonly production: boolean;
  readonly port: number;
  readonly host: string;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly trustedProxies: ReadonlySet<string>;
  readonly maxSeatsPerIp: number;
  readonly chainTipUrl: string | null;
  readonly bots: boolean;
  readonly frameAncestors: readonly string[];
}

// Fails fast with the offending variable names; values are not echoed.
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`invalid server environment: ${problems.join('; ')}`);
  }
  const cfg = parsed.data;
  const production = cfg.NODE_ENV === 'production';
  if (production && cfg.ALLOWED_ORIGINS === undefined) {
    throw new Error('invalid server environment: ALLOWED_ORIGINS is required in production');
  }
  // Behind an untrusted proxy every player shares the proxy's address, and so its limits.
  if (production && cfg.TRUSTED_PROXIES === undefined) {
    throw new Error('invalid server environment: TRUSTED_PROXIES is required in production (use "none" without a proxy)');
  }
  return {
    production,
    port: cfg.PORT,
    host: cfg.HOST,
    allowedOrigins: new Set(cfg.ALLOWED_ORIGINS ?? DEV_CLIENT_ORIGINS),
    trustedProxies: new Set(cfg.TRUSTED_PROXIES ?? []),
    maxSeatsPerIp: cfg.MAX_SEATS_PER_IP,
    chainTipUrl: cfg.BLOCK_HEIGHT_URL === 'off' ? null : cfg.BLOCK_HEIGHT_URL,
    bots: cfg.BOTS === 'on',
    frameAncestors: cfg.FRAME_ANCESTORS,
  };
}
