import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOCK_HEIGHT_URL, DEV_CLIENT_ORIGINS, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses safe development defaults', () => {
    const cfg = loadConfig({});
    expect(cfg.production).toBe(false);
    expect(cfg.port).toBe(2567);
    expect(cfg.host).toBe('127.0.0.1');
    expect([...cfg.allowedOrigins]).toStrictEqual([...DEV_CLIENT_ORIGINS]);
    expect(cfg.trustedProxies.size).toBe(0);
    expect(cfg.maxSeatsPerIp).toBe(16);
    expect(cfg.chainTipUrl).toBe(DEFAULT_BLOCK_HEIGHT_URL);
  });

  it('turns the block height feed off, or points it at another https endpoint', () => {
    expect(loadConfig({ BLOCK_HEIGHT_URL: 'off' }).chainTipUrl).toBeNull();
    expect(loadConfig({ BLOCK_HEIGHT_URL: 'https://node.example/tip' }).chainTipUrl).toBe('https://node.example/tip');
    for (const bad of ['http://node.example/tip', 'file:///etc/passwd', 'nope', '']) {
      expect(() => loadConfig({ BLOCK_HEIGHT_URL: bad })).toThrow(/BLOCK_HEIGHT_URL/);
    }
  });

  it('parses explicit settings', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      HOST: '0.0.0.0',
      ALLOWED_ORIGINS: 'https://play.example.com, https://www.example.com',
      TRUSTED_PROXIES: '127.0.0.1,::1',
      MAX_SEATS_PER_IP: '4',
    });
    expect(cfg.production).toBe(true);
    expect(cfg.port).toBe(8080);
    expect([...cfg.allowedOrigins]).toStrictEqual(['https://play.example.com', 'https://www.example.com']);
    expect([...cfg.trustedProxies]).toStrictEqual(['127.0.0.1', '::1']);
    expect(cfg.maxSeatsPerIp).toBe(4);
  });

  it('requires an explicit origin allowlist in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', TRUSTED_PROXIES: '127.0.0.1' })).toThrow(/ALLOWED_ORIGINS is required/);
  });

  it('requires an explicit proxy setting in production, so players are not all one network', () => {
    const env = { NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://play.example.com' };
    expect(() => loadConfig(env)).toThrow(/TRUSTED_PROXIES is required/);
    expect(loadConfig({ ...env, TRUSTED_PROXIES: 'none' }).trustedProxies.size).toBe(0);
    expect([...loadConfig({ ...env, TRUSTED_PROXIES: '127.0.0.1' }).trustedProxies]).toStrictEqual(['127.0.0.1']);
  });

  it.each([
    { label: 'a port out of range', env: { PORT: '70000' } },
    { label: 'a non-numeric port', env: { PORT: 'http' } },
    { label: 'an origin with a path', env: { ALLOWED_ORIGINS: 'https://play.example.com/game' } },
    { label: 'a wildcard origin', env: { ALLOWED_ORIGINS: '*' } },
    { label: 'an origin with a trailing slash', env: { ALLOWED_ORIGINS: 'https://play.example.com/' } },
    { label: 'a hostname as proxy', env: { TRUSTED_PROXIES: 'proxy.internal' } },
    { label: 'an unknown NODE_ENV', env: { NODE_ENV: 'staging' } },
    { label: 'a zero seat cap', env: { MAX_SEATS_PER_IP: '0' } },
  ])('rejects $label without echoing the value', ({ env }) => {
    expect(() => loadConfig(env)).toThrow(/invalid server environment/);
    try {
      loadConfig(env);
    } catch (error) {
      for (const value of Object.values(env)) expect(String(error)).not.toContain(value);
    }
  });
});
