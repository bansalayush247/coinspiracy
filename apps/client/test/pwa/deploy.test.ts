import { describe, expect, it } from 'vitest';
import headers from '../../../../deploy/nginx/snippets/bc-play-headers.conf?raw';
import { securityHeaders } from '../../csp.js';
import { resolveServerEndpoint } from '../../src/serverUrl.js';

// deploy/ builds the client with VITE_SERVER_URL=/colyseus; nginx must send exactly what csp.ts would.
describe('nginx play headers', () => {
  const sent = new Map(Array.from(headers.matchAll(/^add_header ([A-Za-z-]+) "([^"]+)" always;$/gm), (m) => [m[1], m[2]]));
  it('match csp.ts for a same-origin server', () => {
    for (const [name, value] of Object.entries(securityHeaders(resolveServerEndpoint('/colyseus', false)))) expect(sent.get(name), name).toBe(value);
  });
  it('add HSTS', () => {
    expect(sent.get('Strict-Transport-Security')).toMatch(/^max-age=\d{7,}/);
  });
});
