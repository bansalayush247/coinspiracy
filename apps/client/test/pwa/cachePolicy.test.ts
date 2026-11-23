import { describe, expect, it } from 'vitest';
import {
  CACHE_PREFIX,
  classifyRequest,
  contentTypeFits,
  extensionOf,
  isCacheableResponse,
  isSkipWaitingMessage,
  routingTable,
  runtimeCacheName,
  shellCacheName,
  staleCaches,
  underPrefix,
  type RequestFacts,
  type ResponseFacts,
} from '../../src/pwa/cachePolicy.js';
import { isSafePath, isSwConfig, type SwConfig } from '../../src/pwa/swConfig.js';

const ORIGIN = 'https://play.example.com';
const CONFIG: SwConfig = {
  version: '0123456789abcdef0123',
  html: '/',
  htmlScripts: ['/assets/index-AbCd1234.js'],
  navigation: ['/', '/index.html'],
  shell: ['/', '/assets/index-AbCd1234.js', '/assets/index-Zz_-9876.css', '/manifest.webmanifest', '/icons/icon-192.png'],
  hashed: ['/assets/index-AbCd1234.js', '/assets/index-Zz_-9876.css', '/assets/lazy-Qq123456.js'],
  bypass: ['/api', '/matchmake', '/colyseus', '/healthz', '/game'],
};
const table = routingTable(CONFIG);

function req(url: string, over: Partial<RequestFacts> = {}): RequestFacts {
  return { method: 'GET', url: url.startsWith('/') ? `${ORIGIN}${url}` : url, mode: 'cors', cache: 'default', hasRange: false, ...over };
}

describe('classifyRequest', () => {
  it('answers navigations to the app page network-first', () => {
    expect(classifyRequest(req('/', { mode: 'navigate' }), table, ORIGIN)).toBe('navigation');
    expect(classifyRequest(req('/index.html', { mode: 'navigate' }), table, ORIGIN)).toBe('navigation');
    expect(classifyRequest(req('/?utm=x', { mode: 'navigate' }), table, ORIGIN)).toBe('navigation');
  });

  it('serves precached and hashed files from the cache', () => {
    expect(classifyRequest(req('/assets/index-AbCd1234.js'), table, ORIGIN)).toBe('shell');
    expect(classifyRequest(req('/manifest.webmanifest'), table, ORIGIN)).toBe('shell');
    expect(classifyRequest(req('/assets/lazy-Qq123456.js'), table, ORIGIN)).toBe('asset');
  });

  it.each([
    ['a matchmake POST', req('/colyseus/matchmake/joinOrCreate/citadel', { method: 'POST' })],
    ['a matchmake GET on the server root', req('/matchmake/x')],
    ['a room lookup', req('/colyseus/api/rooms/ABC123')],
    ['the profiles API', req('/api/profile')],
    ['the health check', req('/healthz')],
    ['the same-origin game server path', req('/game/abc/def')],
    ['a navigation to an API path', req('/api/rooms/x', { mode: 'navigate' })],
    ['a navigation to the game server path', req('/colyseus/', { mode: 'navigate' })],
    ['a navigation to another page', req('/hub.html', { mode: 'navigate' })],
    ['a cross-origin script', req('https://cdn.example.net/assets/index-AbCd1234.js')],
    ['the game server on another origin', req('https://game.example.com/matchmake/x')],
    ['a cross-origin navigation', req('https://evil.example/', { mode: 'navigate' })],
    ['a lookalike origin', req('https://play.example.com.evil.example/assets/index-AbCd1234.js')],
    ['another port', req('https://play.example.com:8443/assets/index-AbCd1234.js')],
    ['plain http', req('http://play.example.com/assets/index-AbCd1234.js')],
    ['a query on a cached file', req('/assets/index-AbCd1234.js?v=2')],
    ['a range request', req('/assets/index-AbCd1234.js', { hasRange: true })],
    ['HEAD', req('/assets/index-AbCd1234.js', { method: 'HEAD' })],
    ['PUT', req('/assets/index-AbCd1234.js', { method: 'PUT' })],
    ['the devtools only-if-cached quirk', req('/assets/index-AbCd1234.js', { cache: 'only-if-cached', mode: 'no-cors' })],
    ['an unknown same-origin file', req('/robots.txt')],
    ['an unhashed file in assets', req('/assets/logo.png')],
    ['an old build’s hash', req('/assets/index-OldHash1.js')],
    ['a malformed URL', req('not a url')],
    ['a data URL', req('data:text/html,<p>x</p>')],
  ])('leaves %s to the browser', (_label, request) => {
    expect(classifyRequest(request, table, ORIGIN)).toBe('bypass');
  });

  it('normalises dot segments before matching, so they cannot smuggle API paths into the cache', () => {
    expect(classifyRequest(req('/assets/../colyseus/api/x'), table, ORIGIN)).toBe('bypass');
    expect(classifyRequest(req('/assets/%2e%2e/api/x'), table, ORIGIN)).toBe('bypass');
    expect(classifyRequest(req('/colyseus/../assets/index-AbCd1234.js'), table, ORIGIN)).toBe('shell');
  });

  it('bypass prefixes win over every allowlist', () => {
    const odd = routingTable({ ...CONFIG, navigation: ['/', '/api'], shell: [...CONFIG.shell, '/api/x.js'], bypass: ['/api'] });
    expect(classifyRequest(req('/api', { mode: 'navigate' }), odd, ORIGIN)).toBe('bypass');
    expect(classifyRequest(req('/api/x.js'), odd, ORIGIN)).toBe('bypass');
  });
});

describe('underPrefix', () => {
  it('matches whole segments only', () => {
    expect(underPrefix('/api', '/api')).toBe(true);
    expect(underPrefix('/api/rooms', '/api')).toBe(true);
    expect(underPrefix('/apiary', '/api')).toBe(false);
    expect(underPrefix('/', '/api')).toBe(false);
    expect(underPrefix('/anything', '')).toBe(false);
  });

  it('tolerates a trailing slash in the configured prefix', () => {
    const t = routingTable({ ...CONFIG, bypass: ['/game/'] });
    expect(classifyRequest(req('/game/x'), t, ORIGIN)).toBe('bypass');
    expect(classifyRequest(req('/game', { mode: 'navigate' }), t, ORIGIN)).toBe('bypass');
  });
});

describe('cache names', () => {
  it('versions both caches under the game prefix', () => {
    expect(shellCacheName('abc')).toBe(`${CACHE_PREFIX}shell-v1-abc`);
    expect(runtimeCacheName('abc')).toBe(`${CACHE_PREFIX}runtime-v1-abc`);
    expect(shellCacheName('a')).not.toBe(shellCacheName('b'));
  });

  it('marks only the game’s other versions as stale', () => {
    const keep = [shellCacheName('new'), runtimeCacheName('new')];
    const existing = [...keep, shellCacheName('old'), runtimeCacheName('old'), 'site-cache', 'workbox-precache', 'bcx'];
    expect(staleCaches(existing, keep)).toStrictEqual([shellCacheName('old'), runtimeCacheName('old')]);
    expect(staleCaches(keep, keep)).toStrictEqual([]);
  });
});

describe('response checks', () => {
  const ok: ResponseFacts = { status: 200, type: 'basic', redirected: false, contentType: 'text/javascript; charset=utf-8', cacheControl: null, vary: null };

  it('stores a plain same-origin 200 of the expected type', () => {
    expect(isCacheableResponse(ok, '/assets/index-AbCd1234.js', false)).toBe(true);
    expect(isCacheableResponse({ ...ok, contentType: 'application/javascript' }, '/assets/a-AbCd1234.js', false)).toBe(true);
    expect(isCacheableResponse({ ...ok, contentType: 'text/html' }, '/', true)).toBe(true);
    expect(isCacheableResponse({ ...ok, contentType: 'application/manifest+json' }, '/manifest.webmanifest', false)).toBe(true);
  });

  it.each([
    ['an HTML error page under a script name', { ...ok, contentType: 'text/html; charset=utf-8' }, '/assets/index-AbCd1234.js', false],
    ['a script served as the page', ok, '/', true],
    ['a 404', { ...ok, status: 404 }, '/assets/index-AbCd1234.js', false],
    ['a 206 partial', { ...ok, status: 206 }, '/assets/index-AbCd1234.js', false],
    ['a 304', { ...ok, status: 304 }, '/assets/index-AbCd1234.js', false],
    ['an opaque response', { ...ok, type: 'opaque', status: 0 }, '/assets/index-AbCd1234.js', false],
    ['a CORS response', { ...ok, type: 'cors' }, '/assets/index-AbCd1234.js', false],
    ['a redirected response', { ...ok, redirected: true }, '/assets/index-AbCd1234.js', false],
    ['no-store', { ...ok, cacheControl: 'private, no-store' }, '/assets/index-AbCd1234.js', false],
    ['Vary: *', { ...ok, vary: 'Accept-Encoding, *' }, '/assets/index-AbCd1234.js', false],
    ['a missing content type', { ...ok, contentType: null }, '/assets/index-AbCd1234.js', false],
    ['an unknown extension', { ...ok, contentType: 'application/octet-stream' }, '/assets/blob-AbCd1234.bin', false],
    ['a sniffable text type', { ...ok, contentType: 'text/plain' }, '/assets/index-AbCd1234.js', false],
  ] as const)('refuses %s', (_label, facts, path, isPage) => {
    expect(isCacheableResponse(facts, path, isPage)).toBe(false);
  });

  it('reads the media type case-insensitively and ignores parameters', () => {
    expect(contentTypeFits('/a/b.CSS', 'Text/CSS; charset=UTF-8', false)).toBe(true);
    expect(contentTypeFits('/icons/x.png', 'image/png', false)).toBe(true);
    expect(contentTypeFits('/icons/x.png', 'image/svg+xml', false)).toBe(false);
  });

  it('finds the extension of the last segment only', () => {
    expect(extensionOf('/assets/index-AbCd1234.js')).toBe('js');
    expect(extensionOf('/a.b/c')).toBe('');
    expect(extensionOf('/.hidden')).toBe('');
    expect(extensionOf('/')).toBe('');
  });
});

describe('isSkipWaitingMessage', () => {
  it('accepts exactly { type: "skip-waiting" }', () => {
    expect(isSkipWaitingMessage({ type: 'skip-waiting' })).toBe(true);
  });

  it.each([
    ['a string', 'skip-waiting'],
    ['null', null],
    ['an array', ['skip-waiting']],
    ['another type', { type: 'SKIP_WAITING' }],
    ['extra fields', { type: 'skip-waiting', url: '/x' }],
    ['a missing type', {}],
    ['a prototype trick', Object.create({ type: 'skip-waiting' }) as unknown],
    ['a null-prototype object', Object.assign(Object.create(null) as object, { type: 'skip-waiting' })],
    ['a number', 1],
  ])('ignores %s', (_label, data) => {
    expect(isSkipWaitingMessage(data)).toBe(false);
  });
});

describe('isSwConfig', () => {
  it('accepts a well-formed config', () => {
    expect(isSwConfig(CONFIG)).toBe(true);
  });

  it.each([
    ['a non-object', 'config'],
    ['null', null],
    ['a short version', { ...CONFIG, version: 'abc' }],
    ['a non-hex version', { ...CONFIG, version: 'zzzzzzzzzzzzzzzzzzzz' }],
    ['a relative path', { ...CONFIG, shell: [...CONFIG.shell, 'assets/x.js'] }],
    ['a dot segment', { ...CONFIG, hashed: ['/assets/../x.js'] }],
    ['a double slash', { ...CONFIG, shell: [...CONFIG.shell, '//evil.example/x.js'] }],
    ['a query', { ...CONFIG, shell: [...CONFIG.shell, '/x.js?y'] }],
    ['a fragment', { ...CONFIG, shell: [...CONFIG.shell, '/x.js#y'] }],
    ['a full URL', { ...CONFIG, shell: [...CONFIG.shell, 'https://evil.example/x.js'] }],
    ['duplicates', { ...CONFIG, shell: [...CONFIG.shell, '/'] }],
    ['the page missing from the shell', { ...CONFIG, shell: CONFIG.shell.slice(1) }],
    ['the page missing from navigation', { ...CONFIG, navigation: ['/index.html'] }],
    ['an entry script outside the shell', { ...CONFIG, htmlScripts: ['/assets/other-AbCd1234.js'] }],
    ['a bypass of everything', { ...CONFIG, bypass: ['/'] }],
    ['too many shell files', { ...CONFIG, shell: ['/', ...Array.from({ length: 64 }, (_, i) => `/f${String(i)}.js`)] }],
    ['a missing list', { ...CONFIG, hashed: undefined }],
    ['a non-string entry', { ...CONFIG, bypass: [42] }],
  ])('rejects %s', (_label, value) => {
    expect(isSwConfig(value)).toBe(false);
  });

  it('limits paths to plain absolute paths', () => {
    expect(isSafePath('/')).toBe(true);
    expect(isSafePath('/icons/icon-192.png')).toBe(true);
    expect(isSafePath('/.well-known/x')).toBe(false);
    expect(isSafePath(`/${'a'.repeat(300)}`)).toBe(false);
    expect(isSafePath('/a b')).toBe(false);
  });
});
