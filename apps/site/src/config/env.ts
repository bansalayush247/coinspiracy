// Build-time settings from the environment: parsed once, never echoed, and failing closed.
import { z } from 'astro/zod';

export type Command = 'dev' | 'build' | 'preview' | 'sync';

export const DEV_SITE_URL = 'http://127.0.0.1:3930';
export const DEV_PLAY_URL = 'http://127.0.0.1:5180/';
export const MAX_URL_LENGTH = 512;
export const MAX_SCRIPT_PATH_LENGTH = 256;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);
// Printable ASCII without spaces, quotes, angle brackets or backslashes.
const SAFE_URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
// One leading slash, then unreserved path characters only.
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/]*$/;
const SAFE_SCRIPT_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/]+\.js$/;

export interface SiteSettings {
  // Bare origin without a trailing slash, e.g. https://example.org.
  readonly site: string;
  readonly playUrl: string;
  readonly analyticsSrc: string | null;
  readonly warnings: readonly string[];
}

export class SiteConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid site environment: ${problems.join('; ')}`);
    this.name = 'SiteConfigError';
    this.problems = problems;
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

// https anywhere; plain http only on this machine.
function allowedScheme(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackUrl(url));
}

function hasDotSegment(path: string): boolean {
  return path.split('/').some((part) => part === '.' || part === '..');
}

const SiteUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH, 'is too long')
  .regex(SAFE_URL_CHARS, 'has characters that are not allowed')
  .transform((value, ctx) => {
    const url = parseUrl(value);
    if (url === null) {
      ctx.addIssue({ code: 'custom', message: 'is not a URL' });
      return z.NEVER;
    }
    if (!allowedScheme(url)) {
      ctx.addIssue({ code: 'custom', message: 'must use https (http only for 127.0.0.1, localhost or [::1])' });
      return z.NEVER;
    }
    if (url.username !== '' || url.password !== '') {
      ctx.addIssue({ code: 'custom', message: 'must not contain credentials' });
      return z.NEVER;
    }
    if (value !== url.origin && value !== `${url.origin}/`) {
      ctx.addIssue({ code: 'custom', message: 'must be a bare origin like https://example.org (no path, query or fragment)' });
      return z.NEVER;
    }
    return url.origin;
  });

const PlayUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH, 'is too long')
  .regex(SAFE_URL_CHARS, 'has characters that are not allowed')
  .transform((value, ctx) => {
    if (value.startsWith('/')) {
      if (!SAFE_PATH.test(value) || hasDotSegment(value)) {
        ctx.addIssue({ code: 'custom', message: 'must be a plain same-origin path like /play/' });
        return z.NEVER;
      }
      return value;
    }
    const url = parseUrl(value);
    if (url === null) {
      ctx.addIssue({ code: 'custom', message: 'is not a URL or a path starting with /' });
      return z.NEVER;
    }
    if (!allowedScheme(url)) {
      ctx.addIssue({ code: 'custom', message: 'must use https (http only for 127.0.0.1, localhost or [::1])' });
      return z.NEVER;
    }
    if (url.username !== '' || url.password !== '' || url.hash !== '' || url.search !== '') {
      ctx.addIssue({ code: 'custom', message: 'must not contain credentials, a query or a fragment' });
      return z.NEVER;
    }
    if (hasDotSegment(url.pathname)) {
      ctx.addIssue({ code: 'custom', message: 'must not contain . or .. path segments' });
      return z.NEVER;
    }
    return url.href;
  });

const AnalyticsSrcSchema = z
  .string()
  .max(MAX_SCRIPT_PATH_LENGTH, 'is too long')
  .refine((value) => SAFE_SCRIPT_PATH.test(value) && !hasDotSegment(value), 'must be a same-origin path to a .js file, like /stats/count.js');

// The game client's public address when none is configured: play.<site host>, as in the README's deploy layout.
export function defaultPlayUrl(site: string, command: Command): string {
  const url = new URL(site);
  if (command === 'dev' || isLoopbackUrl(url)) return DEV_PLAY_URL;
  const host = url.host.startsWith('www.') ? url.host.slice(4) : url.host;
  return `https://play.${host}/`;
}

function unset(value: string | undefined): value is undefined {
  return value === undefined || value === '';
}

// Throws SiteConfigError naming each bad variable and the rule it broke; values are never echoed.
export function resolveSiteSettings(env: Readonly<Record<string, string | undefined>>, command: Command): SiteSettings {
  const problems: string[] = [];
  const warnings: string[] = [];

  let site = DEV_SITE_URL;
  const rawSite = env['SITE_URL'];
  if (unset(rawSite)) {
    if (command === 'build') problems.push('SITE_URL is required for builds (e.g. SITE_URL=https://example.org)');
  } else {
    const parsed = SiteUrlSchema.safeParse(rawSite);
    if (parsed.success) site = parsed.data;
    else problems.push(`SITE_URL ${parsed.error.issues[0]?.message ?? 'is invalid'}`);
  }

  let playUrl = '';
  const rawPlay = env['PUBLIC_PLAY_URL'];
  if (!unset(rawPlay)) {
    const parsed = PlayUrlSchema.safeParse(rawPlay);
    if (parsed.success) playUrl = parsed.data;
    else problems.push(`PUBLIC_PLAY_URL ${parsed.error.issues[0]?.message ?? 'is invalid'}`);
  }

  let analyticsSrc: string | null = null;
  const rawAnalytics = env['PUBLIC_ANALYTICS_SRC'];
  if (!unset(rawAnalytics)) {
    const parsed = AnalyticsSrcSchema.safeParse(rawAnalytics);
    if (parsed.success) analyticsSrc = parsed.data;
    else problems.push(`PUBLIC_ANALYTICS_SRC ${parsed.error.issues[0]?.message ?? 'is invalid'}`);
  }

  if (problems.length > 0) throw new SiteConfigError(problems);
  if (command === 'build' && isLoopbackUrl(new URL(site))) {
    warnings.push('SITE_URL is a loopback address; canonical URLs in this build only work on this machine');
  }
  if (playUrl === '') playUrl = defaultPlayUrl(site, command);
  return { site, playUrl, analyticsSrc, warnings };
}
