import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_RUNTIME_ENTRIES, NAVIGATION_TIMEOUT_MS, runtimeCacheName, shellCacheName } from '../../src/pwa/cachePolicy.js';
import type { SwConfig } from '../../src/pwa/swConfig.js';
import {
  installServiceWorker,
  type CacheLike,
  type CacheStorageLike,
  type ExtendableEventLike,
  type FetchEventLike,
  type MessageEventLike,
  type SwScope,
} from '../../src/pwa/swRuntime.js';

const ORIGIN = 'https://play.example.com';
const ENTRY = '/assets/index-AbCd1234.js';
const CSS = '/assets/index-Zz_-9876.css';
const LAZY = '/assets/lazy-Qq123456.js';
const PAGE = `<!doctype html><script type="module" src="${ENTRY}"></script><link rel="stylesheet" href="${CSS}">`;
const CONFIG: SwConfig = {
  version: '0123456789abcdef0123',
  html: '/',
  htmlScripts: [ENTRY],
  navigation: ['/', '/index.html'],
  shell: ['/', ENTRY, CSS, '/manifest.webmanifest'],
  hashed: [ENTRY, CSS, LAZY],
  bypass: ['/api', '/matchmake', '/colyseus', '/healthz'],
};
const SHELL = shellCacheName(CONFIG.version);
const RUNTIME = runtimeCacheName(CONFIG.version);

class FakeCache implements CacheLike {
  readonly entries = new Map<string, Response>();

  static key(request: Request | string): string {
    return new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;
  }

  match(request: string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(FakeCache.key(request))?.clone());
  }

  put(request: string, response: Response): Promise<void> {
    this.entries.set(FakeCache.key(request), response);
    return Promise.resolve();
  }

  keys(): Promise<readonly Request[]> {
    return Promise.resolve([...this.entries.keys()].map((url) => new Request(url)));
  }

  delete(request: Request | string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(FakeCache.key(request)));
  }
}

class FakeCaches implements CacheStorageLike {
  readonly stores = new Map<string, FakeCache>();

  open(name: string): Promise<FakeCache> {
    const existing = this.stores.get(name);
    if (existing !== undefined) return Promise.resolve(existing);
    const created = new FakeCache();
    this.stores.set(name, created);
    return Promise.resolve(created);
  }

  has(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.has(name));
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.stores.keys()]);
  }

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name));
  }

  paths(name: string): string[] {
    return [...(this.stores.get(name)?.entries.keys() ?? [])].map((url) => new URL(url).pathname);
  }
}

// Same-origin responses from fetch() are "basic"; constructed ones say "default".
function basic(body: string, type: string, init: { status?: number; redirected?: boolean; headers?: Record<string, string> } = {}): Response {
  const response = new Response(body, { status: init.status ?? 200, headers: { 'content-type': type, ...init.headers } });
  Object.defineProperty(response, 'type', { value: 'basic' });
  Object.defineProperty(response, 'redirected', { value: init.redirected ?? false });
  return response;
}

type Route = () => Response | Promise<Response>;

const SITE: Record<string, Route> = {
  '/': () => basic(PAGE, 'text/html; charset=utf-8'),
  [ENTRY]: () => basic('console.log(1)', 'text/javascript'),
  [CSS]: () => basic('body{}', 'text/css'),
  [LAZY]: () => basic('export {}', 'text/javascript'),
  '/manifest.webmanifest': () => basic('{}', 'application/manifest+json'),
};

interface Harness {
  readonly scope: SwScope;
  readonly caches: FakeCaches;
  readonly fetched: { path: string; init: RequestInit | undefined }[];
  readonly skipWaiting: ReturnType<typeof vi.fn>;
  readonly enablePreload: ReturnType<typeof vi.fn<() => Promise<void>>>;
  emit(type: 'install' | 'activate'): Promise<void>;
  fetch(request: Request, preload?: Promise<unknown>): { responded: Promise<Response> | undefined; waited: Promise<unknown>[] };
  message(data: unknown): Promise<unknown>[];
}

function harness(routes: Record<string, Route> = SITE, caches = new FakeCaches(), config: SwConfig = CONFIG): Harness {
  const listeners = new Map<string, (event: never) => void>();
  const fetched: Harness['fetched'] = [];
  const skipWaiting = vi.fn(() => Promise.resolve());
  const enablePreload = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const scope: SwScope = {
    origin: ORIGIN,
    caches,
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
      fetched.push({ path: url.pathname, init });
      const route = url.origin === ORIGIN ? routes[url.pathname] : undefined;
      if (route === undefined) throw new TypeError('Failed to fetch');
      return route();
    },
    skipWaiting,
    enableNavigationPreload: enablePreload,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners.set(type, listener);
    },
  };
  installServiceWorker(scope, config);
  const fire = (type: string, event: ExtendableEventLike | FetchEventLike | MessageEventLike): void => {
    const found = listeners.get(type) as ((e: typeof event) => void) | undefined;
    if (found === undefined) throw new Error(`no ${type} listener`);
    found(event);
  };
  return {
    scope,
    caches,
    fetched,
    skipWaiting,
    enablePreload,
    async emit(type) {
      const waits: Promise<unknown>[] = [];
      fire(type, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    },
    fetch(request, preload) {
      let responded: Promise<Response> | undefined;
      const waited: Promise<unknown>[] = [];
      const event: FetchEventLike = {
        request,
        ...(preload === undefined ? {} : { preloadResponse: preload }),
        respondWith: (p) => {
          responded = p;
        },
        waitUntil: (p) => waited.push(p),
      };
      fire('fetch', event);
      return { responded, waited };
    },
    message(data) {
      const waited: Promise<unknown>[] = [];
      const event: MessageEventLike = { data, waitUntil: (p) => waited.push(p) };
      fire('message', event);
      return waited;
    },
  };
}

function navigation(path: string): Request {
  const request = new Request(`${ORIGIN}${path}`);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}

function get(path: string, init?: RequestInit): Request {
  return new Request(path.startsWith('http') ? path : `${ORIGIN}${path}`, init);
}

async function installed(routes: Record<string, Route> = SITE): Promise<Harness> {
  const h = harness(routes);
  await h.emit('install');
  await h.emit('activate');
  h.fetched.length = 0;
  return h;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('install', () => {
  it('precaches the whole shell into this version’s cache', async () => {
    const h = harness();
    await h.emit('install');
    expect(h.caches.paths(SHELL).sort()).toStrictEqual([...CONFIG.shell].sort());
    expect(await (await h.caches.open(SHELL)).match('/')).toBeInstanceOf(Response);
  });

  it('revalidates unhashed files and lets hashed ones come from the HTTP cache, never following redirects', async () => {
    const h = harness();
    await h.emit('install');
    const mode = (path: string): RequestInit | undefined => h.fetched.find((f) => f.path === path)?.init;
    expect(mode('/')?.cache).toBe('no-cache');
    expect(mode('/manifest.webmanifest')?.cache).toBe('no-cache');
    expect(mode(ENTRY)?.cache).toBe('default');
    expect(h.fetched.every((f) => f.init?.redirect === 'error' && f.init.credentials === 'same-origin')).toBe(true);
  });

  it('never calls skipWaiting on its own', async () => {
    const h = harness();
    await h.emit('install');
    await h.emit('activate');
    expect(h.skipWaiting).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing file', { ...SITE, [CSS]: () => basic('nope', 'text/html', { status: 404 }) }],
    ['an HTML fallback under a script name', { ...SITE, [ENTRY]: () => basic(PAGE, 'text/html') }],
    ['a redirected page', { ...SITE, '/': () => basic(PAGE, 'text/html', { redirected: true }) }],
    ['a network error', { ...SITE, '/manifest.webmanifest': () => Promise.reject(new TypeError('Failed to fetch')) }],
    ['a page from another deploy', { ...SITE, '/': () => basic('<script src="/assets/index-NewHash1.js"></script>', 'text/html') }],
    ['a no-store answer', { ...SITE, [CSS]: () => basic('body{}', 'text/css', { headers: { 'cache-control': 'no-store' } }) }],
  ])('fails and writes nothing on %s', async (_label, routes) => {
    const h = harness(routes);
    await expect(h.emit('install')).rejects.toThrow();
    expect(await h.caches.has(SHELL)).toBe(false);
  });

  it('keeps a same-version cache that the active worker may be serving when a reinstall fails', async () => {
    const caches = new FakeCaches();
    await (await caches.open(SHELL)).put('/', basic(PAGE, 'text/html'));
    const h = harness({ ...SITE, [CSS]: () => basic('x', 'text/html', { status: 500 }) }, caches);
    await expect(h.emit('install')).rejects.toThrow();
    expect(caches.paths(SHELL)).toStrictEqual(['/']);
  });
});

describe('activate', () => {
  it('deletes the game’s old caches only and turns on navigation preload', async () => {
    const caches = new FakeCaches();
    for (const name of [shellCacheName('old'), runtimeCacheName('old'), 'someone-else', SHELL]) await caches.open(name);
    const h = harness(SITE, caches);
    await h.emit('activate');
    expect((await caches.keys()).sort()).toStrictEqual(['someone-else', SHELL].sort());
    expect(h.enablePreload).toHaveBeenCalledTimes(1);
  });

  it('still activates where navigation preload is unavailable', async () => {
    const h = harness();
    h.enablePreload.mockImplementation(() => Promise.reject(new Error('unsupported')));
    await expect(h.emit('activate')).resolves.toBeUndefined();
  });
});

describe('navigations', () => {
  it('prefer the network and never overwrite the cached page', async () => {
    const h = await installed({ ...SITE });
    const fresh = '<!doctype html><script src="/assets/index-NewHash1.js"></script>';
    const routes = { ...SITE, '/': () => basic(fresh, 'text/html') };
    const online = harness(routes, h.caches);
    const { responded } = online.fetch(navigation('/'));
    expect(await (await responded)?.text()).toBe(fresh);
    expect(await (await (await h.caches.open(SHELL)).match('/'))?.text()).toBe(PAGE);
  });

  it('fall back to the cached page offline, for both page paths', async () => {
    const h = await installed();
    const offline = harness({}, h.caches);
    for (const path of ['/', '/index.html', '/?from=pwa']) {
      const { responded } = offline.fetch(navigation(path));
      expect(await (await responded)?.text()).toBe(PAGE);
    }
  });

  it('fall back to the cached page when the network stalls', async () => {
    vi.useFakeTimers();
    const h = await installed();
    const stalled = harness({ '/': () => new Promise<Response>(() => undefined) }, h.caches);
    const { responded } = stalled.fetch(navigation('/'));
    await vi.advanceTimersByTimeAsync(NAVIGATION_TIMEOUT_MS + 1);
    expect(await (await responded)?.text()).toBe(PAGE);
  });

  it('use the navigation preload response instead of a second request', async () => {
    const h = await installed();
    const { responded } = h.fetch(navigation('/'), Promise.resolve(basic('preloaded', 'text/html')));
    expect(await (await responded)?.text()).toBe('preloaded');
    expect(h.fetched).toHaveLength(0);
  });

  it('fetch normally when preload yields nothing', async () => {
    const h = await installed();
    const { responded } = h.fetch(navigation('/'), Promise.resolve(undefined));
    expect(await (await responded)?.text()).toBe(PAGE);
    expect(h.fetched.map((f) => f.path)).toStrictEqual(['/']);
  });

  it('fail like the network when there is no cached page', async () => {
    const h = harness({});
    const { responded } = h.fetch(navigation('/'));
    await expect(responded).rejects.toThrow();
  });

  it('pass server errors through rather than hiding them', async () => {
    const h = await installed();
    const down = harness({ '/': () => basic('maintenance', 'text/html', { status: 503 }) }, h.caches);
    const { responded } = down.fetch(navigation('/'));
    expect((await responded)?.status).toBe(503);
  });
});

describe('cached files', () => {
  it('serve the shell from the cache without touching the network', async () => {
    const h = await installed();
    const { responded } = h.fetch(get(ENTRY));
    expect(await (await responded)?.text()).toBe('console.log(1)');
    expect(h.fetched).toHaveLength(0);
  });

  it('fetch a shell file the cache lost, rather than failing', async () => {
    const h = await installed();
    await (await h.caches.open(SHELL)).delete(CSS);
    const { responded } = h.fetch(get(CSS));
    expect((await responded)?.status).toBe(200);
    expect(h.fetched.map((f) => f.path)).toStrictEqual([CSS]);
  });

  it('cache hashed files on first use and serve them from the cache after', async () => {
    const h = await installed();
    const first = h.fetch(get(LAZY));
    expect((await first.responded)?.status).toBe(200);
    await Promise.all(first.waited);
    expect(h.caches.paths(RUNTIME)).toStrictEqual([LAZY]);
    const second = h.fetch(get(LAZY));
    expect(await (await second.responded)?.text()).toBe('export {}');
    expect(h.fetched.map((f) => f.path)).toStrictEqual([LAZY]);
  });

  it('do not cache a bad answer for a hashed file', async () => {
    const h = await installed({ ...SITE, [LAZY]: () => basic('<h1>not found</h1>', 'text/html', { status: 404 }) });
    const { responded, waited } = h.fetch(get(LAZY));
    expect((await responded)?.status).toBe(404);
    await Promise.all(waited);
    expect(h.caches.paths(RUNTIME)).toStrictEqual([]);
  });

  it('keep the runtime cache bounded', async () => {
    const extra = Array.from({ length: MAX_RUNTIME_ENTRIES + 5 }, (_, i) => `/assets/x${String(i)}-AbCd1234.js`);
    const routes = { ...SITE, ...Object.fromEntries(extra.map((p) => [p, () => basic('1', 'text/javascript')])) };
    const caches = new FakeCaches();
    const h = harness(routes, caches, { ...CONFIG, hashed: [...CONFIG.hashed, ...extra] });
    // The store is registered with waitUntil only after the network answers, so wait for the response first.
    for (const path of extra) {
      const r = h.fetch(get(path));
      await r.responded;
      await Promise.all(r.waited);
    }
    expect(caches.paths(RUNTIME)).toHaveLength(MAX_RUNTIME_ENTRIES);
    expect(caches.paths(RUNTIME)).not.toContain(extra[0]);
  });
});

describe('requests the worker must leave alone', () => {
  it.each([
    ['a matchmake POST', get('/colyseus/matchmake/joinOrCreate/citadel', { method: 'POST', body: '{}' })],
    ['a room lookup', get('/colyseus/api/rooms/ABC123')],
    ['a profiles call', get('/api/profile')],
    ['a health check', get('/healthz')],
    ['a cross-origin request', get('https://game.example.com/matchmake/x')],
    ['a query string', get(`${ENTRY}?x=1`)],
    ['a range request', get(ENTRY, { headers: { range: 'bytes=0-1' } })],
    ['an unknown file', get('/robots.txt')],
  ])('%s', async (_label, request) => {
    const h = await installed();
    const { responded, waited } = h.fetch(request, Promise.resolve(undefined));
    expect(responded).toBeUndefined();
    expect(waited).toHaveLength(0);
    expect(h.fetched).toHaveLength(0);
  });

  it('a navigation outside the app, settling its preload so the browser can use it', async () => {
    const h = await installed();
    const { responded, waited } = h.fetch(navigation('/api/rooms/x'), Promise.resolve(undefined));
    expect(responded).toBeUndefined();
    expect(waited).toHaveLength(1);
  });
});

describe('messages', () => {
  it('skip waiting only when a page asks for it in the exact shape', async () => {
    const h = harness();
    expect(h.message({ type: 'nope' })).toHaveLength(0);
    expect(h.message('skip-waiting')).toHaveLength(0);
    expect(h.message({ type: 'skip-waiting', extra: 1 })).toHaveLength(0);
    expect(h.skipWaiting).not.toHaveBeenCalled();
    await Promise.all(h.message({ type: 'skip-waiting' }));
    expect(h.skipWaiting).toHaveBeenCalledTimes(1);
  });
});
