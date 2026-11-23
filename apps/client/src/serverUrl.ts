// Where the game server lives: an absolute ws(s) or http(s) URL, or a same-origin path behind a proxy.
export interface ServerEndpoint {
  // Passed to the Colyseus SDK Client.
  readonly endpoint: string;
  // Base for plain HTTP calls such as the room-code lookup.
  readonly httpBase: string;
  // Extra CSP connect-src sources; empty when the server is same-origin.
  readonly connectSources: readonly string[];
}

// The Vite dev server proxies this path to the local game server.
export const DEV_SERVER_PATH = '/colyseus';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PATH_PATTERN = /^(\/[A-Za-z0-9_-]+)+$/;

function sameOrigin(path: string): ServerEndpoint {
  return { endpoint: path, httpBase: path, connectSources: [] };
}

// Throws on anything unexpected: a production build must never guess where to connect.
export function resolveServerEndpoint(raw: string | undefined, allowDefault: boolean): ServerEndpoint {
  const value = raw?.trim() ?? '';
  if (value === '') {
    if (allowDefault) return sameOrigin(DEV_SERVER_PATH);
    throw new Error('VITE_SERVER_URL must be set for production builds');
  }
  if (value.startsWith('/')) {
    const path = value.replace(/\/+$/, '');
    if (!PATH_PATTERN.test(path)) throw new Error('VITE_SERVER_URL path may only use letters, digits, "/", "_" and "-"');
    return sameOrigin(path);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_SERVER_URL is not a valid URL');
  }
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)) throw new Error('VITE_SERVER_URL must use ws, wss, http or https');
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('VITE_SERVER_URL must not contain credentials, a query or a fragment');
  }
  const secure = url.protocol === 'wss:' || url.protocol === 'https:';
  if (!allowDefault && !secure && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('VITE_SERVER_URL must use wss or https outside loopback');
  }
  const path = url.pathname.replace(/\/+$/, '');
  const http = `${secure ? 'https' : 'http'}://${url.host}`;
  const ws = `${secure ? 'wss' : 'ws'}://${url.host}`;
  return { endpoint: `${ws}${path}`, httpBase: `${http}${path}`, connectSources: [http, ws] };
}
