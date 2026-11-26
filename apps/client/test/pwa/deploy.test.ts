import { describe, expect, it } from 'vitest';
import ancestors from '../../../../deploy/nginx/snippets/bc-frame-ancestors.conf?raw';
import headers from '../../../../deploy/nginx/snippets/bc-play-headers.conf?raw';
import site from '../../../../deploy/nginx/byzantine-council.conf?raw';
import { securityHeaders } from '../../csp.js';
import { resolveServerEndpoint } from '../../src/serverUrl.js';

// deploy/ builds the client with VITE_SERVER_URL=/colyseus; nginx must send exactly what csp.ts would.
describe('nginx play headers', () => {
  const framers = /default "([^"]+)";/.exec(ancestors)?.[1] ?? '';
  const sent = new Map(Array.from(headers.matchAll(/^add_header ([A-Za-z-]+) "([^"]+)" always;$/gm), (m) => [m[1], m[2]?.replace('$bc_frame_ancestors', framers)]));
  it('match csp.ts for a same-origin server', () => {
    for (const [name, value] of Object.entries(securityHeaders(resolveServerEndpoint('/colyseus', false)))) expect(sent.get(name), name).toBe(value);
  });
  it("keep framing at 'none' by default and load the map at the http level", () => {
    expect(framers).toBe("'none'");
    expect(ancestors).toMatch(/^map \$host \$bc_frame_ancestors \{$/m);
    expect(site).toContain('include /etc/nginx/snippets/bc-frame-ancestors.conf;');
  });
  it('add HSTS', () => {
    expect(sent.get('Strict-Transport-Security')).toMatch(/^max-age=\d{7,}/);
  });
});
