import type { ServerEndpoint } from '../serverUrl.js';
import { detectHost, portalReferrers, type HostInput } from './detect.js';
import { discordClientId, loadDiscordSdk, signInWithDiscord, type DiscordSdkLike } from './discord.js';
import { createHolds, holdWhileHidden, installLinkPolicy, type LinkClick, type VisibilitySource } from './lifecycle.js';
import { detectPortal, type PortalAdapter } from './portal.js';
import type { Credential, Platform, PlatformAllows } from './types.js';
import { discordServerEndpoint, proxyUrlBuilder } from './urls.js';

export type { Credential, HostKind, IdentityHint, Platform, PlatformAllows, PlatformNetwork } from './types.js';

/** The page document as the platform layer uses it. */
export interface PlatformDocument extends VisibilitySource {
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  addEventListener(type: 'click', listener: (e: LinkClick) => void, options: { capture: true }): void;
}

/** Everything the platform layer reads from or does to the page, injected so each host can be tested. */
export interface PlatformEnv {
  readonly host: HostInput;
  /** `location.host` and `location.origin`. */
  readonly locationHost: string;
  readonly origin: string;
  readonly discordClientId: string | null;
  readonly loadDiscordSdk: (clientId: string) => Promise<DiscordSdkLike>;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly portal: () => PortalAdapter;
  readonly document: PlatformDocument;
  /** Suspends or resumes game audio without touching the player's saved sound settings. */
  readonly holdAudio: (held: boolean) => void;
  /** Reports whether the main menu is showing, now and on every change. */
  readonly watchMenu: (listener: (menuShown: boolean) => void) => void;
  readonly openWindow: (url: string) => void;
}

const WEB: PlatformAllows = { externalLinks: true, cookies: true, pwa: true };
const FRAMED: PlatformAllows = { externalLinks: false, cookies: false, pwa: false };
const NO_CREDENTIAL: Credential = { kind: 'none' };

function webPlatform(base: ServerEndpoint, env: PlatformEnv): Platform {
  return {
    kind: 'web',
    allows: WEB,
    server: base,
    network: null,
    identity: () => Promise.resolve({ host: 'web', savedProgress: true, suggestedNickname: null }),
    loaded: () => undefined,
    gameplay: () => undefined,
    openExternalLink(url) {
      env.openWindow(url);
      return Promise.resolve(true);
    },
  };
}

function discordPlatform(base: ServerEndpoint, env: PlatformEnv): Platform {
  const server = discordServerEndpoint(base);
  let sdk: DiscordSdkLike | null = null;
  const clientId = env.discordClientId;
  const credential: Promise<Credential> =
    clientId === null
      ? Promise.resolve(NO_CREDENTIAL)
      : env.loadDiscordSdk(clientId).then(
          (loaded) => {
            sdk = loaded;
            return signInWithDiscord({ sdk: loaded, clientId, httpBase: server.httpBase, fetch: env.fetch });
          },
          () => NO_CREDENTIAL,
        );
  const openExternalLink = async (url: string): Promise<boolean> => {
    await credential;
    if (sdk === null) return false;
    try {
      await sdk.commands.openExternalLink({ url });
      return true;
    } catch {
      return false;
    }
  };
  const holds = createHolds(env.holdAudio);
  holdWhileHidden(env.document, holds);
  installLinkPolicy(env.document, env.origin, (url) => {
    void openExternalLink(url);
  });
  return {
    kind: 'discord',
    allows: FRAMED,
    server,
    network: { credential, urlBuilder: proxyUrlBuilder(env.locationHost) },
    identity: () => credential.then((c) => ({ host: 'discord', savedProgress: c.kind === 'bearer', suggestedNickname: null })),
    loaded: () => undefined,
    gameplay: () => undefined,
    openExternalLink,
  };
}

// Portal SDK calls run in order after init and never block the game.
function portalPlatform(base: ServerEndpoint, env: PlatformEnv): Platform {
  const portal = env.portal();
  const holds = createHolds(env.holdAudio);
  holdWhileHidden(env.document, holds);
  installLinkPolicy(env.document, env.origin, null);
  let queue = portal.init().then(() => {
    portal.loadingStart();
    portal.onMuteRequest((muted) => {
      holds.set('portal', muted);
    });
  });
  const later = (step: () => void): void => {
    queue = queue.then(step);
  };
  let started = false;
  return {
    kind: 'portal',
    allows: FRAMED,
    server: base,
    network: { credential: Promise.resolve(NO_CREDENTIAL) },
    identity: () => Promise.resolve({ host: 'portal', savedProgress: false, suggestedNickname: null }),
    loaded() {
      if (started) return;
      started = true;
      later(() => {
        portal.loadingDone();
      });
      env.watchMenu((menuShown) => {
        later(() => {
          portal.gameplay(!menuShown);
        });
      });
    },
    gameplay(active) {
      later(() => {
        portal.gameplay(active);
      });
    },
    openExternalLink: () => Promise.resolve(false),
  };
}

/** Builds the platform for the detected host. The web path adds no listeners and changes nothing. */
export function createPlatform(base: ServerEndpoint, env: PlatformEnv): Platform {
  const kind = detectHost(env.host);
  if (kind === 'discord') return discordPlatform(base, env);
  if (kind === 'portal') return portalPlatform(base, env);
  return webPlatform(base, env);
}

function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function watchMenuElement(listener: (menuShown: boolean) => void): void {
  const menu = document.getElementById('menu');
  if (menu === null) return;
  const report = (): void => {
    listener(!menu.hidden);
  };
  new MutationObserver(report).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
  report();
}

/** The browser's page as a PlatformEnv; `holdAudio` comes from the caller so this layer does not own the audio engine. */
export function browserEnv(holdAudio: (held: boolean) => void): PlatformEnv {
  return {
    host: {
      search: window.location.search,
      referrer: document.referrer,
      framed: isFramed(),
      buildPlatform: import.meta.env.VITE_PLATFORM,
      portalReferrers: portalReferrers(import.meta.env.VITE_PORTAL_REFERRERS),
    },
    locationHost: window.location.host,
    origin: window.location.origin,
    discordClientId: discordClientId(import.meta.env.VITE_DISCORD_CLIENT_ID),
    loadDiscordSdk,
    fetch: (url, init) => fetch(url, init),
    portal: () => detectPortal(window),
    document,
    holdAudio,
    watchMenu: watchMenuElement,
    openWindow: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}

/** The boot hook: detects the host for this page and returns its platform. */
export function startPlatform(base: ServerEndpoint, holdAudio: (held: boolean) => void): Platform {
  return createPlatform(base, browserEnv(holdAudio));
}
