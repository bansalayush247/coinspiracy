import type { SwConfig } from './swConfig.js';

// Only caches with this prefix belong to the game; nothing else on the origin is touched.
export const CACHE_PREFIX = 'bc-';
// Bump when the cache layout changes, so a new worker never reads an old layout.
const LAYOUT = 'v1';
export const MAX_RUNTIME_ENTRIES = 128;
export const NAVIGATION_TIMEOUT_MS = 4000;

export function shellCacheName(version: string): string {
  return `${CACHE_PREFIX}shell-${LAYOUT}-${version}`;
}

export function runtimeCacheName(version: string): string {
  return `${CACHE_PREFIX}runtime-${LAYOUT}-${version}`;
}

// The game's caches this version does not use.
export function staleCaches(existing: readonly string[], keep: readonly string[]): string[] {
  return existing.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.includes(name));
}

export type Route = 'navigation' | 'shell' | 'asset' | 'bypass';

export interface RequestFacts {
  readonly method: string;
  readonly url: string;
  readonly mode: string;
  readonly cache: string;
  readonly hasRange: boolean;
}

export interface RoutingTable {
  readonly navigation: ReadonlySet<string>;
  readonly shell: ReadonlySet<string>;
  readonly hashed: ReadonlySet<string>;
  readonly bypass: readonly string[];
}

export function routingTable(config: SwConfig): RoutingTable {
  return {
    navigation: new Set(config.navigation),
    shell: new Set(config.shell),
    hashed: new Set(config.hashed),
    bypass: config.bypass.map((p) => p.replace(/\/+$/, '')),
  };
}

// Segment-aware: "/api" covers "/api" and "/api/x" but not "/apiary".
export function underPrefix(pathname: string, prefix: string): boolean {
  return prefix !== '' && (pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Allowlist: anything not positively recognised is left to the browser.
export function classifyRequest(req: RequestFacts, table: RoutingTable, origin: string): Route {
  if (req.method !== 'GET' || req.hasRange) return 'bypass';
  // Chrome quirk: devtools can issue only-if-cached requests that fetch() would reject.
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return 'bypass';
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return 'bypass';
  }
  if (url.origin !== origin) return 'bypass';
  const path = url.pathname;
  if (table.bypass.some((prefix) => underPrefix(path, prefix))) return 'bypass';
  if (req.mode === 'navigate') return table.navigation.has(path) ? 'navigation' : 'bypass';
  if (url.search !== '') return 'bypass';
  if (table.shell.has(path)) return 'shell';
  if (table.hashed.has(path)) return 'asset';
  return 'bypass';
}

const TYPES: Readonly<Record<string, readonly string[]>> = {
  js: ['text/javascript', 'application/javascript', 'application/x-javascript', 'application/ecmascript'],
  mjs: ['text/javascript', 'application/javascript'],
  css: ['text/css'],
  html: ['text/html'],
  json: ['application/json'],
  webmanifest: ['application/manifest+json', 'application/json'],
  svg: ['image/svg+xml'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  avif: ['image/avif'],
  gif: ['image/gif'],
  ico: ['image/x-icon', 'image/vnd.microsoft.icon'],
  woff2: ['font/woff2'],
  woff: ['font/woff', 'application/font-woff'],
  ttf: ['font/ttf', 'application/x-font-ttf'],
  wasm: ['application/wasm'],
  mp3: ['audio/mpeg'],
  ogg: ['audio/ogg'],
  wav: ['audio/wav', 'audio/x-wav'],
  m4a: ['audio/mp4'],
};

export function extensionOf(pathname: string): string {
  const name = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

// The media types a file may be served with; empty means the worker will not cache it.
export function expectedTypes(pathname: string, isPage: boolean): readonly string[] {
  if (isPage) return TYPES['html'] ?? [];
  return TYPES[extensionOf(pathname)] ?? [];
}

export function contentTypeFits(pathname: string, contentType: string | null, isPage: boolean): boolean {
  const media = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return media !== '' && expectedTypes(pathname, isPage).includes(media);
}

export interface ResponseFacts {
  readonly status: number;
  readonly type: string;
  readonly redirected: boolean;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly vary: string | null;
}

export function responseFacts(response: Response): ResponseFacts {
  return {
    status: response.status,
    type: response.type,
    redirected: response.redirected,
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    vary: response.headers.get('vary'),
  };
}

// Only a plain same-origin 200 of the expected type is stored: no error page or redirect under a script's name.
export function isCacheableResponse(res: ResponseFacts, pathname: string, isPage: boolean): boolean {
  if (res.status !== 200 || res.type !== 'basic' || res.redirected) return false;
  if (/(^|,)\s*no-store\s*(,|$)/i.test(res.cacheControl ?? '')) return false;
  if ((res.vary ?? '').split(',').some((v) => v.trim() === '*')) return false;
  return contentTypeFits(pathname, res.contentType, isPage);
}

// The one message the worker accepts: exactly { type: 'skip-waiting' }.
export function isSkipWaitingMessage(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Object.getPrototypeOf(data) !== Object.prototype) return false;
  const keys = Object.keys(data);
  return keys.length === 1 && keys[0] === 'type' && (data as { readonly type?: unknown }).type === 'skip-waiting';
}
