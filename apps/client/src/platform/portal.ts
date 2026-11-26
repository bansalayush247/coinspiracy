/** Which portal SDK the page provides, if any. */
export type PortalName = 'crazygames' | 'poki' | 'none';

/** Lifecycle calls mapped onto whichever portal SDK the portal page loaded; every call is safe when none is present. */
export interface PortalAdapter {
  readonly name: PortalName;
  /** Initializes the SDK; resolves even if it fails. */
  init(): Promise<void>;
  loadingStart(): void;
  loadingDone(): void;
  /** Deduplicated: repeated calls with the same value do nothing. */
  gameplay(active: boolean): void;
  /** Registers a listener for the portal asking for silence (CrazyGames `muteAudio`); returns false if unsupported. */
  onMuteRequest(listener: (muted: boolean) => void): boolean;
}

type Fn = (...args: never[]) => unknown;

function isFn(value: unknown): value is Fn {
  return typeof value === 'function';
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

// Calls a portal method by name if it exists; portal SDK errors never reach the game.
function invoke(target: unknown, method: string, ...args: unknown[]): unknown {
  const fn = field(target, method);
  if (!isFn(fn)) return undefined;
  try {
    const out = (fn as (...a: unknown[]) => unknown).apply(target, args);
    if (out instanceof Promise) out.catch(() => undefined);
    return out;
  } catch {
    return undefined;
  }
}

// A portal SDK that fails to start leaves the game running without it.
function settle(value: unknown): Promise<void> {
  return Promise.resolve(value).then(
    () => undefined,
    () => undefined,
  );
}

function adapter(name: PortalName, calls: { init: () => unknown; loadingStart: () => void; loadingDone: () => void; start: () => void; stop: () => void; onMute?: (listener: (muted: boolean) => void) => boolean }): PortalAdapter {
  let active = false;
  return {
    name,
    init: () => settle(calls.init()),
    loadingStart: calls.loadingStart,
    loadingDone: calls.loadingDone,
    gameplay(next) {
      if (active === next) return;
      active = next;
      if (next) calls.start();
      else calls.stop();
    },
    onMuteRequest: calls.onMute ?? (() => false),
  };
}

/** Feature-detects CrazyGames (`window.CrazyGames.SDK`, v3) and Poki (`window.PokiSDK`, v2) on the given window. */
export function detectPortal(win: unknown): PortalAdapter {
  const crazy = field(field(win, 'CrazyGames'), 'SDK');
  const crazyGame = field(crazy, 'game');
  if (crazy !== undefined && isFn(field(crazy, 'init')) && crazyGame !== undefined) {
    return adapter('crazygames', {
      init: () => invoke(crazy, 'init'),
      loadingStart: () => invoke(crazyGame, 'loadingStart'),
      loadingDone: () => invoke(crazyGame, 'loadingStop'),
      start: () => invoke(crazyGame, 'gameplayStart'),
      stop: () => invoke(crazyGame, 'gameplayStop'),
      onMute: (listener) => {
        if (!isFn(field(crazyGame, 'addSettingsChangeListener'))) return false;
        const muted = (): boolean => field(field(crazyGame, 'settings'), 'muteAudio') === true;
        invoke(crazyGame, 'addSettingsChangeListener', () => {
          listener(muted());
        });
        listener(muted());
        return true;
      },
    });
  }
  const poki = field(win, 'PokiSDK');
  if (poki !== undefined && isFn(field(poki, 'init'))) {
    return adapter('poki', {
      init: () => invoke(poki, 'init'),
      loadingStart: () => undefined,
      loadingDone: () => invoke(poki, 'gameLoadingFinished'),
      start: () => invoke(poki, 'gameplayStart'),
      stop: () => invoke(poki, 'gameplayStop'),
    });
  }
  return adapter('none', { init: () => undefined, loadingStart: () => undefined, loadingDone: () => undefined, start: () => undefined, stop: () => undefined });
}
