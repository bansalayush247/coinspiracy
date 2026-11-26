import type { ServerEndpoint } from '../serverUrl.js';

/** Where the client is running: the open web, a Discord Activity iframe, or a web game portal iframe. */
export type HostKind = 'web' | 'discord' | 'portal';

/** What the host allows the game to do. */
export interface PlatformAllows {
  /** Plain `<a href>` navigation to other sites; Discord opens links through its SDK, portals forbid them. */
  readonly externalLinks: boolean;
  /** First-party cookies for the guest session; false in third-party iframes. */
  readonly cookies: boolean;
  /** The service worker and install prompts. */
  readonly pwa: boolean;
}

/** How the game client proves who it is when cookies are unavailable. */
export type Credential = { readonly kind: 'bearer'; readonly token: string } | { readonly kind: 'none' };

/** Network settings for hosts without first-party cookies; the open web has none. */
export interface PlatformNetwork {
  /** Settles once the host's sign-in is done; `none` means play without a saved profile. Never rejects. */
  readonly credential: Promise<Credential>;
  /** Rewrites socket and HTTP URLs for the Colyseus SDK (Discord's proxy). */
  readonly urlBuilder?: (url: URL) => string;
}

/** What the platform knows about the player. Never a real name or avatar: players pick their own nickname. */
export interface IdentityHint {
  readonly host: HostKind;
  /** True when progress is saved to a profile (guest cookie on the web, Discord sign-in in an Activity). */
  readonly savedProgress: boolean;
  /** Always null by design: other players only ever see the nickname a player types. */
  readonly suggestedNickname: null;
}

/** The one interface the rest of the client uses to talk to its host. */
export interface Platform {
  readonly kind: HostKind;
  readonly allows: PlatformAllows;
  /** The game server endpoint for this host (Discord: through the `/.proxy/` URL mapping). */
  readonly server: ServerEndpoint;
  /** Credentials and URL rewriting for the Colyseus client and the profile API; null on the open web. */
  readonly network: PlatformNetwork | null;
  /** Settles after sign-in, like `network.credential`. */
  identity(): Promise<IdentityHint>;
  /** Call once when the game is interactive; ends portal loading screens and starts gameplay tracking. */
  loaded(): void;
  /** Tells the host whether the player is in active play (portal `gameplayStart`/`gameplayStop`). */
  gameplay(active: boolean): void;
  /** Opens a link the host's way; resolves false when the host does not allow it. */
  openExternalLink(url: string): Promise<boolean>;
}
