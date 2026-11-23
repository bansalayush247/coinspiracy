import { describe, expect, it } from 'vitest';
import { COOKIE_MAX_AGE_S, COOKIE_NAME, newProfileId, profileIdFromCookieHeader, readCookie, setCookieHeader, signCookie, verifyCookie, type SessionKeys } from '../../src/profile/session.js';

const KEY_A = Buffer.from('a'.repeat(32));
const KEY_B = Buffer.from('b'.repeat(32));
const keys: SessionKeys = { current: KEY_A, previous: null, secure: false };
const T0 = 1_800_000_000_000;

describe('guest session cookies', () => {
  it('round-trips a random 128-bit id', () => {
    const id = newProfileId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newProfileId()).not.toBe(id);
    expect(verifyCookie(keys, signCookie(keys, id, T0), T0)).toEqual({ id, renew: false });
  });

  it('rejects tampered, forged, malformed and expired cookies', () => {
    const id = newProfileId();
    const good = signCookie(keys, id, T0);
    const [, issued, sig] = good.split('.');
    const other = newProfileId();
    expect(verifyCookie(keys, `${other}.${issued ?? ''}.${sig ?? ''}`, T0)).toBeNull();
    expect(verifyCookie(keys, `${id}.${String(Number(issued) + 1)}.${sig ?? ''}`, T0)).toBeNull();
    expect(verifyCookie({ ...keys, current: KEY_B }, good, T0)).toBeNull();
    expect(verifyCookie(keys, 'garbage', T0)).toBeNull();
    expect(verifyCookie(keys, `${id}.${issued ?? ''}`, T0)).toBeNull();
    expect(verifyCookie(keys, good, T0 + (COOKIE_MAX_AGE_S + 1) * 1000)).toBeNull();
    expect(verifyCookie(keys, good, T0 - 3_600_000)).toBeNull();
  });

  it('accepts the previous key during rotation and asks for renewal', () => {
    const id = newProfileId();
    const old = signCookie({ ...keys, current: KEY_B }, id, T0);
    expect(verifyCookie({ current: KEY_A, previous: KEY_B, secure: false }, old, T0)).toEqual({ id, renew: true });
  });

  it('asks for renewal after a week', () => {
    const id = newProfileId();
    expect(verifyCookie(keys, signCookie(keys, id, T0), T0 + 8 * 86_400_000)?.renew).toBe(true);
  });

  it('reads the cookie out of a Cookie header among others', () => {
    const id = newProfileId();
    const value = signCookie(keys, id, T0);
    expect(readCookie(`theme=dark; ${COOKIE_NAME}=${value}; x=1`)).toBe(value);
    expect(profileIdFromCookieHeader(keys, `a=b; ${COOKIE_NAME}=${value}`, T0)).toBe(id);
    expect(profileIdFromCookieHeader(keys, null, T0)).toBeNull();
    expect(profileIdFromCookieHeader(keys, 'x'.repeat(9000), T0)).toBeNull();
  });

  it('sets an HTTP-only, SameSite=Lax cookie, Secure in production', () => {
    expect(setCookieHeader(keys, 'v')).toBe(`${COOKIE_NAME}=v; Max-Age=${String(COOKIE_MAX_AGE_S)}; Path=/; HttpOnly; SameSite=Lax`);
    expect(setCookieHeader({ ...keys, secure: true }, 'v')).toContain('; Secure');
  });
});
