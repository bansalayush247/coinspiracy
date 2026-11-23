// Service worker entry, built to /sw.js by the pwa() Vite plugin. It never imports other scripts at runtime.
import { isSwConfig } from './swConfig.js';
import { installServiceWorker, type SwScope } from './swRuntime.js';

// Replaced at build time with this build's SwConfig.
declare const __BC_SW_CONFIG__: unknown;

// The parts of ServiceWorkerGlobalScope used here; the app's DOM typings have no worker types.
interface WorkerGlobal {
  readonly location: { readonly origin: string };
  readonly caches: CacheStorage;
  readonly registration: { readonly navigationPreload?: { enable(): Promise<void> } };
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  skipWaiting(): Promise<void>;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  addEventListener(type: string, listener: (event: never) => void): void;
}

const worker = self as unknown as WorkerGlobal;
const config: unknown = __BC_SW_CONFIG__;
// Fail closed: a worker that cannot trust its config must not install.
if (!isSwConfig(config)) throw new Error('service worker config is invalid');

const scope: SwScope = {
  origin: worker.location.origin,
  caches: worker.caches,
  fetch: (input, init) => worker.fetch(input, init),
  skipWaiting: () => worker.skipWaiting(),
  enableNavigationPreload: async () => {
    await worker.registration.navigationPreload?.enable();
  },
  setTimeout: (callback, ms) => worker.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    if (typeof handle === 'number') worker.clearTimeout(handle);
  },
  addEventListener: (type: string, listener: (event: never) => void) => {
    worker.addEventListener(type, listener);
  },
};

installServiceWorker(scope, config);
