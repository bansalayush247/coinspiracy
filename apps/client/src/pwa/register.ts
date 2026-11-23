import { showUpdatePrompt } from './updatePrompt.js';

export const SW_URL = '/sw.js';
export const UPDATE_CHECK_MS = 60 * 60 * 1000;
// If the waiting worker never takes over, reload anyway so the button always does something.
export const RELOAD_FALLBACK_MS = 5000;
export const SKIP_WAITING_MESSAGE = { type: 'skip-waiting' } as const;

// The slices of the Service Worker API used here; the browser's own objects satisfy them.
export interface WorkerLike extends EventTarget {
  readonly state: string;
  postMessage(message: unknown): void;
}

export interface RegistrationLike extends EventTarget {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  update(): Promise<unknown>;
}

export interface ContainerLike extends EventTarget {
  readonly controller: unknown;
  register(url: string, options: RegistrationOptions): Promise<RegistrationLike>;
}

// Everything that touches the page, injected so tests can drive the flow.
export interface SwHost {
  readonly container: ContainerLike;
  readonly loaded: Promise<void>;
  reload(): void;
  repeat(ms: number, task: () => void): void;
  schedule(ms: number, task: () => void): void;
}

// Receives apply(), which switches to the new version and reloads this tab.
export type UpdateHandler = (apply: () => void) => void;

export interface RegisterOptions {
  // Defaults to a small banner with "Reload" and "Later".
  readonly onUpdate?: UpdateHandler;
}

// Never reloads on its own: only apply(), called from a user action, reloads, and only this tab.
export async function startServiceWorker(host: SwHost, onUpdate: UpdateHandler): Promise<RegistrationLike | null> {
  const container = host.container;
  await host.loaded;
  let registration: RegistrationLike;
  try {
    registration = await container.register(SW_URL, { scope: '/', updateViaCache: 'none' });
  } catch {
    // Blocked storage or an old browser: the game works without the worker.
    return null;
  }

  let asked = false;
  let reloading = false;
  const reloadOnce = (): void => {
    if (reloading) return;
    reloading = true;
    host.reload();
  };
  const offered = new WeakSet<WorkerLike>();
  const offer = (worker: WorkerLike): void => {
    // No controller means this is the first install, not an update.
    if (container.controller === null || offered.has(worker)) return;
    offered.add(worker);
    onUpdate(() => {
      if (asked) return;
      asked = true;
      worker.postMessage(SKIP_WAITING_MESSAGE);
      host.schedule(RELOAD_FALLBACK_MS, reloadOnce);
    });
  };

  container.addEventListener('controllerchange', () => {
    if (asked) reloadOnce();
    // Another tab switched versions while this page still runs the old code.
    else onUpdate(reloadOnce);
  });
  if (registration.waiting !== null) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (worker === null) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker);
    });
  });
  host.repeat(UPDATE_CHECK_MS, () => {
    registration.update().catch(() => undefined);
  });
  return registration;
}

// No-op in dev, in e2e builds (VITE_E2E=1), without service worker support and outside a secure context.
export function registerServiceWorker(options: RegisterOptions = {}): Promise<RegistrationLike | null> {
  if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') return Promise.resolve(null);
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return Promise.resolve(null);
  return startServiceWorker(
    {
      container: navigator.serviceWorker,
      loaded:
        document.readyState === 'complete'
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              window.addEventListener(
                'load',
                () => {
                  resolve();
                },
                { once: true },
              );
            }),
      reload: () => {
        window.location.reload();
      },
      repeat: (ms, task) => {
        window.setInterval(task, ms);
      },
      schedule: (ms, task) => {
        window.setTimeout(task, ms);
      },
    },
    options.onUpdate ?? showUpdatePrompt,
  );
}
