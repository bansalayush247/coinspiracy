import { frameAncestorsDirective } from './src/platform/frameAncestors.js';
import type { ServerEndpoint } from './src/serverUrl.js';

// No eval, no inline code, and only the game server as a network peer.
// Phaser needs img-src data: for its built-in textures (verified).
// frameAncestors comes from FRAME_ANCESTORS (Discord, portals); empty keeps 'none'.
export function contentSecurityPolicy(server: ServerEndpoint, frameAncestors: readonly string[] = []): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    ["connect-src 'self'", ...server.connectSources].join(' '),
    // The service worker (/sw.js) and the web app manifest.
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    frameAncestorsDirective(frameAncestors),
  ].join('; ');
}

// Headers for every page response; preview sends them and the build writes them to dist/_headers.
export function securityHeaders(server: ServerEndpoint, frameAncestors: readonly string[] = []): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(server, frameAncestors),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
}

// Per-path Cache-Control; deploy/nginx applies the same rules. sw.js must always revalidate or players stay on an old version.
export const CACHE_RULES: readonly (readonly [path: string, cacheControl: string])[] = [
  ['/', 'no-cache'],
  ['/index.html', 'no-cache'],
  ['/sw.js', 'no-cache'],
  ['/manifest.webmanifest', 'no-cache'],
  ['/assets/*', 'public, max-age=31536000, immutable'],
  ['/icons/*', 'public, max-age=86400'],
];

// dist/_headers for static hosts: the security headers on every path, then the cache rules.
export function renderHeadersFile(headers: Readonly<Record<string, string>>): string {
  const lines = ['/*', ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)];
  for (const [path, cacheControl] of CACHE_RULES) lines.push(path, `  Cache-Control: ${cacheControl}`);
  return `${lines.join('\n')}\n`;
}
