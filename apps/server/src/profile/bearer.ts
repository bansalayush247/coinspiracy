// Bearer session tokens (the guest cookie's signed value) for hosts that block third-party cookies, such as Discord.
import type { IncomingMessage } from 'node:http';
import { COOKIE_NAME, verifyCookie, type SessionKeys } from './session.js';

/** Lifetime of a session token readable by page scripts; the client fetches a fresh one on every launch. */
export const BEARER_MAX_AGE_S = 24 * 3600;
const MAX_TOKEN_CHARS = 128;

function bearerFromHeader(header: string | string[] | undefined): string | null {
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

// The Colyseus SDK sends the token as an Authorization header over HTTP and as _authToken on the socket URL.
function bearerFromUrl(url: string | undefined): string | null {
  if (url === undefined || url.length > 4096 || !url.includes('_authToken=')) return null;
  try {
    return new URL(url, 'http://gate.invalid').searchParams.get('_authToken');
  } catch {
    return null;
  }
}

/**
 * Replaces the request's cookies with the guest cookie carried by a bearer session token.
 * Requests without a token are left untouched. A present but invalid or expired token removes every cookie,
 * so an explicit credential never silently falls back to another identity.
 * @returns whether a valid token was applied
 */
export function applyBearerSession(keys: SessionKeys, req: IncomingMessage, nowMs: number, upgrade: boolean): boolean {
  const token = upgrade ? bearerFromUrl(req.url) : bearerFromHeader(req.headers.authorization);
  if (token === null) return false;
  const valid = token.length > 0 && token.length <= MAX_TOKEN_CHARS && verifyCookie(keys, token, nowMs, BEARER_MAX_AGE_S) !== null;
  if (valid) req.headers.cookie = `${COOKIE_NAME}=${token}`;
  else Reflect.deleteProperty(req.headers, 'cookie');
  return valid;
}
