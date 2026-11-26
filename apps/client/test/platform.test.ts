import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentSecurityPolicy } from '../csp.js';
import { DEFAULT_PORTAL_REFERRERS, detectHost, portalReferrers, type HostInput } from '../src/platform/detect.js';
import { DISCORD_TOKEN_PATH, discordClientId, signInWithDiscord, type DiscordSdkLike } from '../src/platform/discord.js';
import { parseFrameAncestors } from '../src/platform/frameAncestors.js';
import { createPlatform, type PlatformDocument, type PlatformEnv } from '../src/platform/index.js';
import { createHolds, externalUrl, type LinkClick } from '../src/platform/lifecycle.js';
import { detectPortal } from '../src/platform/portal.js';
import { DISCORD_PROXY_PREFIX, discordServerEndpoint, proxyUrlBuilder } from '../src/platform/urls.js';
import { ProfileApi } from '../src/profile/api.js';
import { resolveServerEndpoint } from '../src/serverUrl.js';

const DISCORD_HOST = '123456789012345678.discordsays.com';
const TOKEN = `${'A'.repeat(22)}.1700000000.${'b'.repeat(43)}`;
const LAUNCH = '?frame_id=f1a2b3&instance_id=i-123-gc-456&platform=desktop';

function input(overrides: Partial<HostInput> = {}): HostInput {
  return { search: '', referrer: '', framed: false, buildPlatform: undefined, portalReferrers: DEFAULT_PORTAL_REFERRERS, ...overrides };
}

class FakeDocument implements PlatformDocument {
  hidden = false;
  readonly listeners: { type: string; listener: (e: LinkClick) => void }[] = [];
  addEventListener(type: string, listener: (e: LinkClick) => void): void {
    this.listeners.push({ type, listener });
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const l of this.listeners) if (l.type === 'visibilitychange') l.listener({ target: null, preventDefault: () => undefined });
  }
  click(href: string): boolean {
    let prevented = false;
    const link = { getAttribute: (name: string) => (name === 'href' ? href : null) };
    const target = { closest: (selector: string) => (selector === 'a[href]' ? link : null) };
    for (const l of this.listeners) {
      if (l.type === 'click') {
        l.listener({
          target,
          preventDefault: () => {
            prevented = true;
          },
        });
      }
    }
    return prevented;
  }
}

interface Harness {
  readonly env: PlatformEnv;
  readonly doc: FakeDocument;
  readonly held: boolean[];
  readonly calls: string[];
  readonly fetches: { url: string; init: RequestInit }[];
  readonly menu: (shown: boolean) => void;
}

function fakeSdk(calls: string[], authorize: () => Promise<{ code: string }> = () => Promise.resolve({ code: 'abc123' })): DiscordSdkLike {
  return {
    ready: () => {
      calls.push('ready');
      return Promise.resolve();
    },
    commands: {
      authorize: (args) => {
        calls.push(`authorize:${args.scope.join(',')}:${args.client_id}`);
        return authorize();
      },
      openExternalLink: (args) => {
        calls.push(`open:${args.url}`);
        return Promise.resolve({ opened: true });
      },
    },
  };
}

function harness(host: HostInput, overrides: Partial<PlatformEnv> = {}): Harness {
  const doc = new FakeDocument();
  const held: boolean[] = [];
  const calls: string[] = [];
  const fetches: { url: string; init: RequestInit }[] = [];
  let menuListener: (shown: boolean) => void = () => undefined;
  const env: PlatformEnv = {
    host,
    locationHost: DISCORD_HOST,
    origin: `https://${DISCORD_HOST}`,
    discordClientId: '123456789012345678',
    loadDiscordSdk: () => {
      calls.push('load');
      return Promise.resolve(fakeSdk(calls));
    },
    fetch: (url, init) => {
      fetches.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ token: TOKEN }), { status: 200 }));
    },
    portal: () => {
      calls.push('portal');
      return detectPortal({});
    },
    document: doc,
    holdAudio: (h) => held.push(h),
    watchMenu: (listener) => {
      menuListener = listener;
      listener(true);
    },
    openWindow: (url) => calls.push(`window:${url}`),
    ...overrides,
  };
  return { env, doc, held, calls, fetches, menu: (shown) => { menuListener(shown); } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('host detection', () => {
  it('is the web by default', () => {
    expect(detectHost(input())).toBe('web');
    expect(detectHost(input({ framed: true, referrer: 'https://example.org/' }))).toBe('web');
  });

  it('finds a Discord Activity by its launch parameters inside a frame', () => {
    expect(detectHost(input({ framed: true, search: LAUNCH }))).toBe('discord');
    expect(detectHost(input({ framed: false, search: LAUNCH }))).toBe('web');
    expect(detectHost(input({ framed: true, search: '?frame_id=f1' }))).toBe('web');
    expect(detectHost(input({ framed: true, search: '?frame_id=<x>&instance_id=i1' }))).toBe('web');
    expect(detectHost(input({ framed: true, search: LAUNCH, buildPlatform: 'portal' }))).toBe('discord');
  });

  it('finds a portal by build flag, framed query flag or framed referrer', () => {
    expect(detectHost(input({ buildPlatform: 'portal' }))).toBe('portal');
    expect(detectHost(input({ framed: true, search: '?bc_host=portal' }))).toBe('portal');
    expect(detectHost(input({ search: '?bc_host=portal' }))).toBe('web');
    expect(detectHost(input({ framed: true, referrer: 'https://www.crazygames.com/game/x' }))).toBe('portal');
    expect(detectHost(input({ framed: true, referrer: 'https://poki.com/en/g/x' }))).toBe('portal');
    expect(detectHost(input({ framed: true, referrer: 'https://evilcrazygames.com/' }))).toBe('web');
    expect(detectHost(input({ framed: true, referrer: 'http://poki.com/' }))).toBe('web');
    expect(detectHost(input({ framed: false, referrer: 'https://poki.com/' }))).toBe('web');
  });

  it('reads the portal referrer allowlist', () => {
    expect(portalReferrers(undefined)).toBe(DEFAULT_PORTAL_REFERRERS);
    expect(portalReferrers(' Portal.Example , bad_entry, ')).toEqual(['portal.example']);
    expect(portalReferrers('nope')).toBe(DEFAULT_PORTAL_REFERRERS);
  });

  it('accepts only numeric Discord application ids', () => {
    expect(discordClientId(' 123456789012345678 ')).toBe('123456789012345678');
    expect(discordClientId('abc')).toBeNull();
    expect(discordClientId(undefined)).toBeNull();
  });
});

describe('Discord proxy URLs', () => {
  it('puts a same-origin server path under /.proxy', () => {
    expect(discordServerEndpoint(resolveServerEndpoint('/colyseus', false))).toStrictEqual({ endpoint: '/.proxy/colyseus', httpBase: '/.proxy/colyseus', connectSources: [] });
  });

  it('maps an absolute server to its path, or /colyseus at the root', () => {
    expect(discordServerEndpoint(resolveServerEndpoint('wss://game.example.org/play', false)).endpoint).toBe('/.proxy/play');
    expect(discordServerEndpoint(resolveServerEndpoint('https://game.example.org', false)).httpBase).toBe('/.proxy/colyseus');
  });

  it('keeps every socket and request on the Activity origin', () => {
    const build = proxyUrlBuilder(DISCORD_HOST);
    expect(build(new URL(`wss://${DISCORD_HOST}/.proxy/colyseus/p1/r1?sessionId=s`))).toBe(`wss://${DISCORD_HOST}/.proxy/colyseus/p1/r1?sessionId=s`);
    expect(build(new URL('wss://play.example.org/colyseus/s1/p1/r1?_authToken=t'))).toBe(`wss://${DISCORD_HOST}${DISCORD_PROXY_PREFIX}/colyseus/s1/p1/r1?_authToken=t`);
    expect(build(new URL('https://play.example.org/.proxy/colyseus/matchmake/x'))).toBe(`https://${DISCORD_HOST}/.proxy/colyseus/matchmake/x`);
    expect(build(new URL('blob:https://play.example.org/1'))).toBe('blob:https://play.example.org/1');
  });
});

describe('the web platform', () => {
  it('changes nothing and installs nothing', async () => {
    const h = harness(input());
    const base = resolveServerEndpoint('/colyseus', false);
    const p = createPlatform(base, h.env);
    expect(p.kind).toBe('web');
    expect(p.server).toBe(base);
    expect(p.network).toBeNull();
    expect(p.allows).toEqual({ externalLinks: true, cookies: true, pwa: true });
    p.loaded();
    p.gameplay(true);
    p.gameplay(false);
    expect(await p.identity()).toEqual({ host: 'web', savedProgress: true, suggestedNickname: null });
    expect(h.doc.listeners).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.held).toEqual([]);
    expect(h.fetches).toEqual([]);
  });
});

describe('the Discord platform', () => {
  it('signs in with identify only and exchanges the code through the proxy', async () => {
    const h = harness(input({ framed: true, search: LAUNCH }));
    const p = createPlatform(resolveServerEndpoint('/colyseus', false), h.env);
    expect(p.kind).toBe('discord');
    expect(p.server.endpoint).toBe('/.proxy/colyseus');
    expect(p.allows).toEqual({ externalLinks: false, cookies: false, pwa: false });
    expect(await p.network?.credential).toEqual({ kind: 'bearer', token: TOKEN });
    expect(h.calls).toEqual(['load', 'ready', 'authorize:identify:123456789012345678']);
    expect(h.fetches.map((f) => f.url)).toEqual([`/.proxy/colyseus${DISCORD_TOKEN_PATH}`]);
    expect(h.fetches[0]?.init).toMatchObject({ method: 'POST', credentials: 'omit', body: JSON.stringify({ code: 'abc123' }) });
    expect(await p.identity()).toEqual({ host: 'discord', savedProgress: true, suggestedNickname: null });
  });

  it('plays without a profile when sign-in fails or is not configured', async () => {
    const declined = harness(input({ framed: true, search: LAUNCH }), { loadDiscordSdk: () => Promise.resolve(fakeSdk([], () => Promise.reject(new Error('closed')))) });
    expect(await createPlatform(resolveServerEndpoint('/colyseus', false), declined.env).network?.credential).toEqual({ kind: 'none' });
    expect(declined.fetches).toEqual([]);
    const unconfigured = harness(input({ framed: true, search: LAUNCH }), { discordClientId: null });
    const p = createPlatform(resolveServerEndpoint('/colyseus', false), unconfigured.env);
    expect(await p.network?.credential).toEqual({ kind: 'none' });
    expect(unconfigured.calls).toEqual([]);
    const sdkMissing = harness(input({ framed: true, search: LAUNCH }), { loadDiscordSdk: () => Promise.reject(new Error('chunk failed')) });
    expect(await createPlatform(resolveServerEndpoint('/colyseus', false), sdkMissing.env).network?.credential).toEqual({ kind: 'none' });
  });

  it('refuses a malformed token reply', async () => {
    const calls: string[] = [];
    const reply = (body: unknown, status = 200) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));
    const base = { sdk: fakeSdk(calls), clientId: '123456789012345678', httpBase: '/.proxy/colyseus' };
    expect(await signInWithDiscord({ ...base, fetch: reply({ token: 'nope' }) })).toEqual({ kind: 'none' });
    expect(await signInWithDiscord({ ...base, fetch: reply({ token: TOKEN, extra: 1 }) })).toEqual({ kind: 'none' });
    expect(await signInWithDiscord({ ...base, fetch: reply({ error: 'x' }, 503) })).toEqual({ kind: 'none' });
  });

  it('opens other sites through Discord, mutes while hidden, and leaves same-origin links alone', async () => {
    const h = harness(input({ framed: true, search: LAUNCH }));
    const p = createPlatform(resolveServerEndpoint('/colyseus', false), h.env);
    await p.network?.credential;
    expect(h.doc.click('https://example.org/codex/x/')).toBe(true);
    expect(h.doc.click('/assets/a.png')).toBe(false);
    expect(h.doc.click('blob:https://x/1')).toBe(false);
    await flush();
    expect(h.calls).toContain('open:https://example.org/codex/x/');
    h.doc.setHidden(true);
    h.doc.setHidden(false);
    expect(h.held).toEqual([true, false]);
  });
});

describe('the portal platform', () => {
  it('maps loading and gameplay to the CrazyGames SDK in order', async () => {
    const calls: string[] = [];
    const settings = { muteAudio: false };
    let onSettings: () => void = () => undefined;
    const sdk = {
      init: () => {
        calls.push('init');
        return Promise.resolve();
      },
      game: {
        settings,
        loadingStart: () => calls.push('loadingStart'),
        loadingStop: () => calls.push('loadingStop'),
        gameplayStart: () => calls.push('gameplayStart'),
        gameplayStop: () => calls.push('gameplayStop'),
        addSettingsChangeListener: (fn: () => void) => {
          onSettings = fn;
        },
      },
    };
    const h = harness(input({ buildPlatform: 'portal' }), { portal: () => detectPortal({ CrazyGames: { SDK: sdk } }) });
    const p = createPlatform(resolveServerEndpoint('https://play.example.org/colyseus', false), h.env);
    expect(p.kind).toBe('portal');
    expect(p.server.endpoint).toBe('wss://play.example.org/colyseus');
    expect(await p.network?.credential).toEqual({ kind: 'none' });
    p.loaded();
    h.menu(false);
    h.menu(false);
    h.menu(true);
    await flush();
    expect(calls).toEqual(['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop']);
    settings.muteAudio = true;
    onSettings();
    expect(h.held).toEqual([true]);
    expect(h.doc.click('https://elsewhere.example/')).toBe(true);
    expect(await p.openExternalLink('https://elsewhere.example/')).toBe(false);
  });

  it('maps gameplay to Poki and survives a throwing SDK', async () => {
    const calls: string[] = [];
    const poki = {
      init: () => Promise.reject(new Error('blocked')),
      gameLoadingFinished: () => calls.push('finished'),
      gameplayStart: () => {
        throw new Error('boom');
      },
      gameplayStop: () => calls.push('stop'),
    };
    const portal = detectPortal({ PokiSDK: poki });
    expect(portal.name).toBe('poki');
    await portal.init();
    portal.loadingDone();
    expect(() => {
      portal.gameplay(true);
    }).not.toThrow();
    portal.gameplay(false);
    expect(calls).toEqual(['finished', 'stop']);
  });

  it('is a safe no-op without a portal SDK', async () => {
    const none = detectPortal({});
    expect(none.name).toBe('none');
    await none.init();
    none.loadingStart();
    none.loadingDone();
    none.gameplay(true);
    expect(none.onMuteRequest(() => undefined)).toBe(false);
    expect(detectPortal({ CrazyGames: { SDK: 'nope' }, PokiSDK: { init: 1 } }).name).toBe('none');
  });
});

describe('profile API on hosts without cookies', () => {
  it('skips the network when there is no session and sends the bearer token otherwise', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response('{}', { status: 401 })));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    expect(await new ProfileApi('/.proxy/colyseus', { credential: Promise.resolve({ kind: 'none' }) }).session()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await new ProfileApi('/.proxy/colyseus', { credential: Promise.resolve({ kind: 'bearer', token: TOKEN }) }).profile();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/.proxy/colyseus/api/profile');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', headers: { authorization: `Bearer ${TOKEN}` } });
    await new ProfileApi('/colyseus').profile();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include' });
    expect(fetchMock.mock.calls[1]?.[1]).not.toHaveProperty('headers');
  });
});

describe('framing', () => {
  it("keeps frame-ancestors 'none' by default and accepts only https origins", () => {
    const server = resolveServerEndpoint('/colyseus', false);
    expect(contentSecurityPolicy(server)).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy(server, parseFrameAncestors('https://discord.com, https://*.discordsays.com'))).toContain('frame-ancestors https://discord.com https://*.discordsays.com');
    for (const bad of ['*', "'self'", 'http://discord.com', 'https://discord.com/x', 'https://discord.com; script-src *']) expect(() => parseFrameAncestors(bad), bad).toThrow(/FRAME_ANCESTORS/);
  });

  it('counts audio holds and only reports changes', () => {
    const seen: boolean[] = [];
    const holds = createHolds((h) => seen.push(h));
    holds.set('hidden', true);
    holds.set('portal', true);
    holds.set('hidden', false);
    holds.set('portal', false);
    holds.set('portal', false);
    expect(seen).toEqual([true, false]);
  });

  it('treats only other-origin web links as external', () => {
    expect(externalUrl('https://example.org/x', 'https://a.example')).toBe('https://example.org/x');
    expect(externalUrl('/x', 'https://a.example')).toBeNull();
    expect(externalUrl('javascript:alert(1)', 'https://a.example')).toBeNull();
    expect(externalUrl('mailto:a@b.c', 'https://a.example')).toBeNull();
  });
});
