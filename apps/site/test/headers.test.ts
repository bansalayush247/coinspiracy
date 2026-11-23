import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HeadersFileError, headersFor, parseHeadersFile, patternMatches } from '../src/lib/headers.js';
import { cspFromHeadersFile, cspProblems, metaCsp } from '../src/lib/security.js';

const text = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');

describe('_headers', () => {
  it('has a strict CSP and every security header', () => {
    const csp = cspFromHeadersFile(text);
    expect(cspProblems(csp)).toEqual([]);
    const all = headersFor(parseHeadersFile(text), '/*');
    for (const name of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Permissions-Policy']) expect(all[name]).toBeDefined();
  });

  it('drops header-only directives from the meta CSP', () => {
    const meta = metaCsp(cspFromHeadersFile(text));
    expect(meta).not.toContain('frame-ancestors');
    expect(meta).toContain("script-src 'self'");
  });

  it('flags weak policies', () => {
    expect(cspProblems("default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.example")).toEqual(
      expect.arrayContaining(["default-src must be 'none'", "script-src allows 'unsafe-inline'", 'script-src allows a third-party host https://cdn.example', 'missing frame-ancestors']),
    );
  });

  it('rejects malformed files', () => {
    expect(() => parseHeadersFile('  X: y')).toThrow(HeadersFileError);
    expect(() => parseHeadersFile('/*\n  Bad Name: y')).toThrow(HeadersFileError);
    expect(() => parseHeadersFile('no-slash\n')).toThrow(HeadersFileError);
  });

  it('matches path patterns', () => {
    expect(patternMatches('/_astro/*', '/_astro/x.css')).toBe(true);
    expect(patternMatches('/og/*', '/codex/')).toBe(false);
    expect(patternMatches('/robots.txt', '/robots.txt')).toBe(true);
  });
});
