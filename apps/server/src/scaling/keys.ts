// Redis key names. Network keys are keyed hashes, so Redis, its snapshots and replicas never hold an address.
import { createHmac } from 'node:crypto';

export const MIN_KEY_SECRET_LENGTH = 32;
export const MAX_KEY_SECRET_LENGTH = 1024;
// Network keys come from ipKey(); anything longer is refused rather than stored.
export const MAX_NETWORK_KEY_LENGTH = 256;

export function isNetworkKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_NETWORK_KEY_LENGTH;
}

export class NetworkKeys {
  readonly #secret: Buffer;

  constructor(secret: string) {
    if (secret.length < MIN_KEY_SECRET_LENGTH || secret.length > MAX_KEY_SECRET_LENGTH) {
      throw new RangeError(`the scaling key secret must be ${String(MIN_KEY_SECRET_LENGTH)}-${String(MAX_KEY_SECRET_LENGTH)} characters`);
    }
    this.#secret = Buffer.from(secret, 'utf8');
  }

  // 132 bits of HMAC-SHA256 as base64url; every process with the same secret derives the same token.
  token(key: string): string {
    return createHmac('sha256', this.#secret).update(`bc-net:v1:${key}`).digest('base64url').slice(0, 22);
  }
}

export function rateKey(name: string, token: string): string {
  return `bc:rl:${name}:${token}`;
}

// Seat keys share the {seats} hash tag, so one transaction may touch a network hash and the process table.
export function seatKey(token: string): string {
  return `bc:{seats}:n:${token}`;
}

export const PROCS_KEY = 'bc:{seats}:procs';

/** Prefix ioredis puts on every key Colyseus writes (room listing, process stats, room codes); channels are not keys. */
export const COLYSEUS_KEY_PREFIX = 'bc:cy:';
