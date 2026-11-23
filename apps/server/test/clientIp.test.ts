import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { IpSlots, ipKey, normalizeIp, requestIp, sanitizeIpHeaders } from '../src/clientIp.js';

function request(peer: string, headers: Record<string, string | string[]>): IncomingMessage {
  return { socket: { remoteAddress: peer }, headers: { ...headers } } as unknown as IncomingMessage;
}

describe('normalizeIp', () => {
  it('unwraps IPv4-mapped IPv6 and marks missing addresses', () => {
    expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp(undefined)).toBe('unknown');
    expect(normalizeIp('')).toBe('unknown');
  });
});

describe('ipKey', () => {
  it('keys IPv4 addresses individually', () => {
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('keys IPv6 addresses by their /64, whatever the notation', () => {
    const a = ipKey('2001:db8:1:2:aaaa::1');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe(a);
    expect(ipKey('2001:db8:1:2::')).toBe(a);
    expect(ipKey('2001:db8:1:3::1')).not.toBe(a);
  });

  it('expands :: at the front and in the middle of the prefix', () => {
    expect(ipKey('::1')).toBe('0:0:0:0::/64');
    expect(ipKey('2001::1')).toBe('2001:0:0:0::/64');
    expect(ipKey('2001:db8::5:1')).toBe('2001:db8:0:0::/64');
  });
});

describe('sanitizeIpHeaders', () => {
  const trusted = { trustedProxies: new Set(['127.0.0.1']) };
  const nobody = { trustedProxies: new Set<string>() };

  it('replaces spoofed headers with the socket peer when the peer is not a trusted proxy', () => {
    const req = request('198.51.100.7', { 'x-real-ip': '7.7.7.7', 'x-forwarded-for': '8.8.8.8', 'x-client-ip': '9.9.9.9' });
    sanitizeIpHeaders(req, nobody);
    expect(req.headers['x-real-ip']).toBe('198.51.100.7');
    expect(req.headers['x-forwarded-for']).toBeUndefined();
    expect(req.headers['x-client-ip']).toBeUndefined();
    expect(requestIp(req)).toBe('198.51.100.7');
  });

  it('keeps X-Real-IP set by a trusted proxy and drops X-Forwarded-For', () => {
    const req = request('::ffff:127.0.0.1', { 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '6.6.6.6' });
    sanitizeIpHeaders(req, trusted);
    expect(req.headers['x-real-ip']).toBe('203.0.113.5');
    expect(req.headers['x-forwarded-for']).toBeUndefined();
  });

  it('falls back to the proxy address when a trusted proxy sends no X-Real-IP', () => {
    const req = request('127.0.0.1', { 'x-forwarded-for': '6.6.6.6' });
    sanitizeIpHeaders(req, trusted);
    expect(req.headers['x-real-ip']).toBe('127.0.0.1');
  });

  it('takes only the first value of a list or repeated header', () => {
    const req = request('127.0.0.1', { 'x-real-ip': '203.0.113.5, 6.6.6.6' });
    sanitizeIpHeaders(req, trusted);
    expect(req.headers['x-real-ip']).toBe('203.0.113.5');
  });
});

describe('IpSlots', () => {
  it('caps concurrent seats per key and frees them on release', () => {
    const slots = new IpSlots(2);
    expect(slots.tryAcquire('a')).toBe(true);
    expect(slots.tryAcquire('a')).toBe(true);
    expect(slots.tryAcquire('a')).toBe(false);
    expect(slots.tryAcquire('b')).toBe(true);
    slots.release('a');
    expect(slots.tryAcquire('a')).toBe(true);
  });

  it('lets a reconnect reclaim a seat past the cap and never goes negative', () => {
    const slots = new IpSlots(1);
    slots.tryAcquire('a');
    slots.forceAcquire('a');
    expect(slots.count('a')).toBe(2);
    slots.release('a');
    slots.release('a');
    slots.release('a');
    expect(slots.count('a')).toBe(0);
    expect(slots.tryAcquire('a')).toBe(true);
  });
});
