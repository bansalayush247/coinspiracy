import { describe, expect, it } from 'vitest';
import { DEV_PLAY_URL, DEV_SITE_URL, SiteConfigError, resolveSiteSettings } from '../src/config/env.js';

const build = (env: Record<string, string>) => resolveSiteSettings(env, 'build');
const problemsOf = (fn: () => unknown): readonly string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof SiteConfigError) return error.problems;
    throw error;
  }
  return [];
};

describe('site settings', () => {
  it('uses loopback defaults in dev', () => {
    expect(resolveSiteSettings({}, 'dev')).toMatchObject({ site: DEV_SITE_URL, playUrl: DEV_PLAY_URL, analyticsSrc: null });
  });

  it('requires SITE_URL for builds and derives the play host', () => {
    expect(problemsOf(() => build({}))[0]).toContain('SITE_URL is required');
    expect(build({ SITE_URL: 'https://www.example.org/' })).toMatchObject({ site: 'https://www.example.org', playUrl: 'https://play.example.org/' });
  });

  it.each([
    ['http://example.org', 'https'],
    ['https://example.org/path', 'bare origin'],
    ['https://user:pw@example.org', 'credentials'],
    ['https://example.org?q=1', 'bare origin'],
    ['javascript:alert(1)', 'https'],
    ['https://exa mple.org', 'characters'],
    [`https://${'a'.repeat(600)}.org`, 'too long'],
  ])('rejects SITE_URL %s', (value, why) => {
    expect(problemsOf(() => build({ SITE_URL: value })).join(' ')).toContain(why);
  });

  it('never echoes the bad value', () => {
    const problems = problemsOf(() => build({ SITE_URL: 'https://secret-token@example.org' }));
    expect(problems.join(' ')).not.toContain('secret-token');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil', '/a/../b', 'http://evil.example/', 'https://example.org/#x', 'https://u:p@example.org/', ' /play/'])(
    'rejects PUBLIC_PLAY_URL %s',
    (value) => {
      expect(problemsOf(() => build({ SITE_URL: 'https://example.org', PUBLIC_PLAY_URL: value }))).toHaveLength(1);
    },
  );

  it('accepts https play URLs, loopback http and plain paths', () => {
    for (const value of ['https://play.example.org/', 'http://127.0.0.1:5180/', '/play/']) {
      expect(build({ SITE_URL: 'https://example.org', PUBLIC_PLAY_URL: value }).playUrl).toBe(value);
    }
  });

  it('only allows a same-origin analytics script', () => {
    expect(build({ SITE_URL: 'https://example.org', PUBLIC_ANALYTICS_SRC: '/stats/count.js' }).analyticsSrc).toBe('/stats/count.js');
    for (const bad of ['https://cdn.example/x.js', '//x/y.js', '/x/../y.js', '/stats/count', '/a b.js']) {
      expect(problemsOf(() => build({ SITE_URL: 'https://example.org', PUBLIC_ANALYTICS_SRC: bad }))).toHaveLength(1);
    }
  });

  it('warns when a build uses a loopback origin', () => {
    expect(build({ SITE_URL: 'http://127.0.0.1:3930' }).warnings).toHaveLength(1);
  });
});
