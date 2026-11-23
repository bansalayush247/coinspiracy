import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from '../csp.js';
import { DEV_SERVER_PATH, resolveServerEndpoint } from '../src/serverUrl.js';

describe('resolveServerEndpoint', () => {
  it('uses the dev proxy path when nothing is configured in development', () => {
    expect(resolveServerEndpoint(undefined, true)).toStrictEqual({ endpoint: DEV_SERVER_PATH, httpBase: DEV_SERVER_PATH, connectSources: [] });
  });

  it('refuses to build without a server', () => {
    expect(() => resolveServerEndpoint(undefined, false)).toThrow(/must be set/);
    expect(() => resolveServerEndpoint('  ', false)).toThrow(/must be set/);
  });

  it('derives the socket and HTTP addresses from a wss URL', () => {
    expect(resolveServerEndpoint('wss://game.example.com/', false)).toStrictEqual({
      endpoint: 'wss://game.example.com',
      httpBase: 'https://game.example.com',
      connectSources: ['https://game.example.com', 'wss://game.example.com'],
    });
    expect(resolveServerEndpoint('https://game.example.com/play', false).endpoint).toBe('wss://game.example.com/play');
  });

  it('accepts a same-origin path for deployments behind one proxy', () => {
    expect(resolveServerEndpoint('/game/', false)).toStrictEqual({ endpoint: '/game', httpBase: '/game', connectSources: [] });
  });

  it('allows plaintext only to loopback outside development', () => {
    expect(resolveServerEndpoint('ws://127.0.0.1:2567', false).httpBase).toBe('http://127.0.0.1:2567');
    expect(() => resolveServerEndpoint('ws://game.example.com', false)).toThrow(/wss or https/);
    expect(resolveServerEndpoint('ws://game.example.com', true).endpoint).toBe('ws://game.example.com');
  });

  it.each([
    'ftp://game.example.com',
    'javascript:alert(1)',
    'wss://user:pass@game.example.com',
    'wss://game.example.com/?token=1',
    'wss://game.example.com/#x',
    '//evil.example',
    '/game/../x',
    '/game?x=1',
    'not a url',
  ])('rejects %s', (raw) => {
    expect(() => resolveServerEndpoint(raw, false)).toThrow();
  });
});

describe('contentSecurityPolicy', () => {
  it('allows only same-origin code and the configured game server', () => {
    const csp = contentSecurityPolicy(resolveServerEndpoint('wss://game.example.com', false));
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' https://game.example.com wss://game.example.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-(eval|inline)/);
  });

  it('needs no extra network peers for a same-origin server', () => {
    expect(contentSecurityPolicy(resolveServerEndpoint('/colyseus', false))).toContain("connect-src 'self';");
  });

  it('ships the other security headers alongside it', () => {
    const headers = securityHeaders(resolveServerEndpoint('/colyseus', false));
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
  });
});

describe('site url for Codex links', () => {
  it('accepts only bare https origins, or loopback http', async () => {
    const { resolveSiteUrl } = await import('../src/siteUrl.js');
    expect(resolveSiteUrl('https://example.org')).toBe('https://example.org');
    expect(resolveSiteUrl('https://example.org/')).toBe('https://example.org');
    expect(resolveSiteUrl('http://127.0.0.1:3930')).toBe('http://127.0.0.1:3930');
    for (const bad of ['', 'http://example.org', 'javascript:alert(1)', 'https://example.org/path', 'https://u:p@example.org', 'https://example.org/?q=1', '//example.org', 'data:text/html,x']) {
      expect(resolveSiteUrl(bad)).toBeNull();
    }
  });
});
