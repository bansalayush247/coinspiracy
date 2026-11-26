import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { ipKey, requestIp, sanitizeIpHeaders, type ClientIpPolicy } from './clientIp.js';
import { frameAncestorsDirective } from './frameAncestors.js';

export interface HttpGateOptions {
  readonly ipPolicy: ClientIpPolicy;
  readonly allowedOrigins: ReadonlySet<string>;
  // Colyseus reads /matchmake bodies with no size limit; join options are tiny.
  readonly maxMatchmakeBodyBytes: number;
  // Open sockets per network. Reconnect attempts bypass room auth, so this is the only cap on them.
  readonly maxSocketsPerIp: number;
  /** Origins allowed to frame our responses (FRAME_ANCESTORS); empty or absent keeps `'none'`. */
  readonly frameAncestors?: readonly string[];
  /** Rewrites credentials on each request after the IP headers are sanitized (bearer session tokens). */
  readonly normalizeCredentials?: (req: IncomingMessage, upgrade: boolean) => void;
}

export interface HttpGate {
  openSockets(key: string): number;
}

/** Headers sent on every HTTP response, including Colyseus's own matchmake routes. */
export function gateSecurityHeaders(frameAncestors: readonly string[] = []): Readonly<Record<string, string>> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; ${frameAncestorsDirective(frameAncestors)}`,
    'Cross-Origin-Resource-Policy': 'same-site',
  };
}

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;
type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

function reject(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
  res.end(JSON.stringify({ error }));
}

function isApiPath(url: string | undefined): boolean {
  return url !== undefined && (url.startsWith('/matchmake/') || url.startsWith('/api/'));
}

// Wraps every 'request' and 'upgrade' listener Colyseus installed, so call it after server.listen().
export function installHttpGate(server: HttpServer, options: HttpGateOptions): HttpGate {
  const securityHeaders = gateSecurityHeaders(options.frameAncestors);
  const requestListeners = server.listeners('request') as RequestListener[];
  server.removeAllListeners('request');
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    sanitizeIpHeaders(req, options.ipPolicy);
    options.normalizeCredentials?.(req, false);
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    if (isApiPath(req.url)) {
      // CORS only hides responses; a cross-site form post would still reserve seats.
      const origin = req.headers.origin;
      if (origin !== undefined && !options.allowedOrigins.has(origin)) {
        req.resume();
        reject(res, 403, 'origin_not_allowed');
        return;
      }
    }
    if (req.method === 'POST' && req.url?.startsWith('/matchmake/') === true) {
      // JSON forces a CORS preflight; forms and no-cors fetches cannot send it.
      const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      if (type !== 'application/json') {
        req.resume();
        reject(res, 415, 'json_required');
        return;
      }
      if (req.headers['transfer-encoding'] !== undefined) {
        req.resume();
        reject(res, 411, 'length_required');
        return;
      }
      const length = Number(req.headers['content-length'] ?? '0');
      if (!Number.isSafeInteger(length) || length > options.maxMatchmakeBodyBytes) {
        req.resume();
        reject(res, 413, 'body_too_large');
        return;
      }
    }
    for (const listener of requestListeners) listener.call(server, req, res);
  });

  const open = new Map<string, number>();
  const upgradeListeners = server.listeners('upgrade') as UpgradeListener[];
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    sanitizeIpHeaders(req, options.ipPolicy);
    options.normalizeCredentials?.(req, true);
    const key = ipKey(requestIp(req));
    const count = open.get(key) ?? 0;
    if (count >= options.maxSocketsPerIp) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    open.set(key, count + 1);
    socket.once('close', () => {
      const left = (open.get(key) ?? 1) - 1;
      if (left <= 0) open.delete(key);
      else open.set(key, left);
    });
    for (const listener of upgradeListeners) listener.call(server, req, socket, head);
  });

  return {
    openSockets: (key) => open.get(key) ?? 0,
  };
}
