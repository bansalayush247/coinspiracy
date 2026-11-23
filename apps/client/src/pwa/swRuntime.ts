import {
  MAX_RUNTIME_ENTRIES,
  NAVIGATION_TIMEOUT_MS,
  classifyRequest,
  isCacheableResponse,
  isSkipWaitingMessage,
  responseFacts,
  routingTable,
  runtimeCacheName,
  shellCacheName,
  staleCaches,
} from './cachePolicy.js';
import type { SwConfig } from './swConfig.js';

// The slice of the Cache API the worker uses; the real Cache and CacheStorage satisfy it.
export interface CacheLike {
  match(request: string, options?: CacheQueryOptions): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  keys(): Promise<readonly Request[]>;
  delete(request: Request | string): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  has(name: string): Promise<boolean>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  // Absent where navigation preload is unsupported.
  readonly preloadResponse?: Promise<unknown>;
  respondWith(response: Promise<Response>): void;
}

export interface MessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
}

// Everything the handlers touch, injected so tests can drive them without a browser.
export interface SwScope {
  readonly origin: string;
  readonly caches: CacheStorageLike;
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  skipWaiting(): Promise<void>;
  enableNavigationPreload(): Promise<void>;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

function pathOf(request: Request): string {
  return new URL(request.url).pathname;
}

export function installServiceWorker(scope: SwScope, config: SwConfig): void {
  const shellName = shellCacheName(config.version);
  const runtimeName = runtimeCacheName(config.version);
  const table = routingTable(config);
  const hashed = new Set(config.hashed);

  // Fetches everything first and writes only when all of it is good; any failure fails the install.
  async function precache(): Promise<void> {
    const existed = await scope.caches.has(shellName);
    try {
      const fetched = await Promise.all(
        config.shell.map(async (path) => {
          const response = await scope.fetch(path, {
            cache: hashed.has(path) ? 'default' : 'no-cache',
            credentials: 'same-origin',
            redirect: 'error',
          });
          if (!isCacheableResponse(responseFacts(response), path, path === config.html)) throw new Error(`cannot precache ${path}`);
          return { path, response };
        }),
      );
      const page = fetched.find((entry) => entry.path === config.html);
      if (page === undefined) throw new Error('the page is not in the shell');
      // A deploy that lands mid-install would pair a new page with old scripts.
      const html = await page.response.clone().text();
      if (!config.htmlScripts.every((script) => html.includes(script))) throw new Error('the page does not match this version');
      const cache = await scope.caches.open(shellName);
      await Promise.all(fetched.map(({ path, response }) => cache.put(path, response)));
    } catch (error) {
      // Same-version caches may already serve the active worker; only a cache made here is dropped.
      if (!existed) await scope.caches.delete(shellName).catch(() => false);
      throw error;
    }
  }

  async function activate(): Promise<void> {
    const names = await scope.caches.keys();
    await Promise.all(staleCaches(names, [shellName, runtimeName]).map((name) => scope.caches.delete(name)));
    await scope.enableNavigationPreload().catch(() => undefined);
  }

  async function cachedPage(): Promise<Response | undefined> {
    const cache = await scope.caches.open(shellName);
    return cache.match(config.html, { ignoreVary: true });
  }

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = scope.setTimeout(() => {
        reject(new Error('timed out'));
      }, ms);
      promise.then(
        (value) => {
          scope.clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          scope.clearTimeout(timer);
          reject(error instanceof Error ? error : new Error('network error'));
        },
      );
    });
  }

  async function network(event: FetchEventLike): Promise<Response> {
    const preloaded = await event.preloadResponse?.catch(() => undefined);
    return preloaded instanceof Response ? preloaded : scope.fetch(event.request);
  }

  // Network first; the cached page only when the network fails or stalls. Fresh HTML never replaces the cached page.
  async function navigate(event: FetchEventLike): Promise<Response> {
    const fromNetwork = network(event);
    fromNetwork.catch(() => undefined);
    try {
      return await withTimeout(fromNetwork, NAVIGATION_TIMEOUT_MS);
    } catch {
      const cached = await cachedPage().catch(() => undefined);
      return cached ?? fromNetwork;
    }
  }

  async function fromShell(request: Request): Promise<Response> {
    const cache = await scope.caches.open(shellName);
    return (await cache.match(pathOf(request), { ignoreVary: true })) ?? scope.fetch(request);
  }

  async function store(cache: CacheLike, path: string, response: Response): Promise<void> {
    try {
      await cache.put(path, response);
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - MAX_RUNTIME_ENTRIES))) await cache.delete(key);
    } catch {
      // Quota or a concurrent activate; the next request simply fetches again.
    }
  }

  // Hashed names never change content, so a cached copy is always right.
  async function fromAssets(event: FetchEventLike): Promise<Response> {
    const path = pathOf(event.request);
    const cache = await scope.caches.open(runtimeName);
    const hit = await cache.match(path, { ignoreVary: true });
    if (hit !== undefined) return hit;
    const response = await scope.fetch(event.request);
    if (isCacheableResponse(responseFacts(response), path, false)) event.waitUntil(store(cache, path, response.clone()));
    return response;
  }

  scope.addEventListener('install', (event) => {
    event.waitUntil(precache());
  });

  scope.addEventListener('activate', (event) => {
    event.waitUntil(activate());
  });

  scope.addEventListener('fetch', (event) => {
    const request = event.request;
    const route = classifyRequest(
      { method: request.method, url: request.url, mode: request.mode, cache: request.cache, hasRange: request.headers.has('range') },
      table,
      scope.origin,
    );
    if (route === 'navigation') event.respondWith(navigate(event));
    else if (route === 'shell') event.respondWith(fromShell(request));
    else if (route === 'asset') event.respondWith(fromAssets(event));
    // A bypassed navigation still settles its preload, or the browser reports it as cancelled.
    else if (request.mode === 'navigate' && event.preloadResponse !== undefined) event.waitUntil(event.preloadResponse.catch(() => undefined));
  });

  scope.addEventListener('message', (event) => {
    if (isSkipWaitingMessage(event.data)) event.waitUntil(scope.skipWaiting());
  });
}
