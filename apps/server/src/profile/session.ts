// Anonymous guest identity: a random profile id in an HMAC-signed, HTTP-only cookie. No sign-up,
// no personal data. Keys rotate: new cookies use the current secret, old ones still verify with the previous.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'bc_guest';
// Browsers cap cookie lifetimes near 400 days; renewing on use keeps active players signed in.
export const COOKIE_MAX_AGE_S = 400 * 24 * 3600;
const RENEW_AFTER_MS = 7 * 24 * 3600 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

export interface SessionKeys {
  readonly current: Buffer;
  readonly previous: Buffer | null;
  readonly secure: boolean;
}

export function newProfileId(): string {
  return randomBytes(16).toString('base64url');
}

export function isProfileId(id: string): boolean {
  return ID_RE.test(id);
}

function mac(key: Buffer, id: string, issued: number): Buffer {
  return createHmac('sha256', key).update(`v1.${id}.${String(issued)}`).digest();
}

export function signCookie(keys: SessionKeys, id: string, nowMs: number): string {
  const issued = Math.floor(nowMs / 1000);
  return `${id}.${String(issued)}.${mac(keys.current, id, issued).toString('base64url')}`;
}

export interface Session {
  readonly id: string;
  // True when the cookie is old or signed with the previous key, so a fresh one should be sent.
  readonly renew: boolean;
}

export function verifyCookie(keys: SessionKeys, value: string, nowMs: number): Session | null {
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [id = '', issuedText = '', sig = ''] = parts;
  if (!isProfileId(id) || !/^\d{1,12}$/.test(issuedText) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  const issued = Number(issuedText);
  const ageMs = nowMs - issued * 1000;
  if (ageMs < -60_000 || ageMs > COOKIE_MAX_AGE_S * 1000) return null;
  const given = Buffer.from(sig, 'base64url');
  for (const [key, isCurrent] of [[keys.current, true], [keys.previous, false]] as const) {
    if (key === null) continue;
    const want = mac(key, id, issued);
    if (want.length === given.length && timingSafeEqual(want, given)) return { id, renew: !isCurrent || ageMs > RENEW_AFTER_MS };
  }
  return null;
}

// Reads our cookie out of a Cookie header; anything malformed reads as no cookie.
export function readCookie(header: string | null | undefined): string | null {
  if (header === null || header === undefined || header.length > 8192) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

export function profileIdFromCookieHeader(keys: SessionKeys, header: string | null | undefined, nowMs: number): string | null {
  const value = readCookie(header);
  return value === null ? null : (verifyCookie(keys, value, nowMs)?.id ?? null);
}

export function setCookieHeader(keys: SessionKeys, value: string): string {
  return `${COOKIE_NAME}=${value}; Max-Age=${String(COOKIE_MAX_AGE_S)}; Path=/; HttpOnly; SameSite=Lax${keys.secure ? '; Secure' : ''}`;
}
