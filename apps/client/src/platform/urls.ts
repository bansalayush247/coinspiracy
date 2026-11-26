import type { ServerEndpoint } from '../serverUrl.js';

/** Discord serves an Activity from `https://<app id>.discordsays.com` and forwards `/.proxy/<mapping>/...` to the mapped target. */
export const DISCORD_PROXY_PREFIX = '/.proxy';
/** The mapping prefix used when the build's server has no path of its own (`wss://game.example.org`). */
export const DEFAULT_DISCORD_SERVER_PATH = '/colyseus';

function serverPath(base: ServerEndpoint): string {
  if (base.endpoint.startsWith('/')) return base.endpoint;
  try {
    return new URL(base.endpoint).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * The game server as seen from inside the Discord iframe: a same-origin path under `/.proxy`, so every request and
 * socket goes through Discord's URL mapping. The mapping prefix is the build's server path (`/colyseus`).
 */
export function discordServerEndpoint(base: ServerEndpoint): ServerEndpoint {
  const path = serverPath(base);
  const proxied = `${DISCORD_PROXY_PREFIX}${path === '' ? DEFAULT_DISCORD_SERVER_PATH : path}`;
  return { endpoint: proxied, httpBase: proxied, connectSources: [] };
}

/**
 * A Colyseus `urlBuilder` that keeps every URL on the Activity's own origin. URLs for another host (a multi-process
 * `PUBLIC_ADDRESS`) are rewritten to `/.proxy<path>`, which the server mapping forwards to the same path on the server host.
 */
export function proxyUrlBuilder(localHost: string): (url: URL) => string {
  return (url) => {
    if (url.host === localHost || !['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)) return url.href;
    const path = url.pathname.startsWith(`${DISCORD_PROXY_PREFIX}/`) ? url.pathname : `${DISCORD_PROXY_PREFIX}${url.pathname}`;
    return `${url.protocol}//${localHost}${path}${url.search}`;
  };
}
