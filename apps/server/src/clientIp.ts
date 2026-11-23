import type { IncomingMessage } from 'node:http';
import { isIPv6 } from 'node:net';

// Colyseus resolves AuthContext.ip from these headers blindly, in this order.
const IP_HEADERS = ['x-real-ip', 'x-forwarded-for', 'x-client-ip'] as const;

export interface ClientIpPolicy {
  // Peer addresses allowed to set X-Real-IP (the reverse proxy); empty trusts nobody.
  readonly trustedProxies: ReadonlySet<string>;
}

export function normalizeIp(address: string | undefined): string {
  if (address === undefined || address === '') return 'unknown';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

// Limits key on the /64 for IPv6, since one subscriber controls the whole prefix.
export function ipKey(address: string | undefined): string {
  const ip = normalizeIp(address);
  if (!isIPv6(ip)) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const groups = ip.includes('::') ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.split(',')[0]?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

// Rewrites X-Real-IP to the trusted proxy's value or the socket peer, and drops the other IP headers.
export function sanitizeIpHeaders(req: IncomingMessage, policy: ClientIpPolicy): void {
  const peer = normalizeIp(req.socket.remoteAddress);
  const forwarded = policy.trustedProxies.has(peer) ? first(req.headers['x-real-ip']) : undefined;
  for (const name of IP_HEADERS) Reflect.deleteProperty(req.headers, name);
  req.headers['x-real-ip'] = forwarded ?? peer;
}

// Same answer Colyseus gives as AuthContext.ip once headers are sanitized.
export function requestIp(req: IncomingMessage): string {
  return first(req.headers['x-real-ip']) ?? normalizeIp(req.socket.remoteAddress);
}

// Concurrent seats per network; released when the socket closes, so counts cannot leak.
export class IpSlots {
  readonly #counts = new Map<string, number>();

  constructor(readonly max: number) {}

  tryAcquire(key: string): boolean {
    const used = this.#counts.get(key) ?? 0;
    if (used >= this.max) return false;
    this.#counts.set(key, used + 1);
    return true;
  }

  // A reconnect reclaims a seat this network already held, so it bypasses the cap.
  forceAcquire(key: string): void {
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
  }

  release(key: string): void {
    const used = this.#counts.get(key) ?? 0;
    if (used <= 1) this.#counts.delete(key);
    else this.#counts.set(key, used - 1);
  }

  count(key: string): number {
    return this.#counts.get(key) ?? 0;
  }
}
