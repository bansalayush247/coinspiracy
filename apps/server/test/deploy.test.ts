import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { profileConfig } from '../src/profile/config.js';
import { loadScalingConfig } from '../src/scaling/config.js';

const read = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

function envFile(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

describe('deploy/', () => {
  const env = envFile(read('deploy/env/server.env.example'));

  it('has an env template every config loader accepts in production', () => {
    expect(env['NODE_ENV']).toBe('production');
    const config = loadConfig(env);
    expect(config.production).toBe(true);
    expect([...config.trustedProxies]).toEqual(['127.0.0.1']);
    expect(profileConfig(env).ephemeralSecret).toBe(false);
    expect(loadScalingConfig(env, true).redisUrl).toBeNull();
  });

  it('documents every variable the server reads', () => {
    const template = read('deploy/env/server.env.example');
    for (const name of ['NODE_ENV', 'HOST', 'PORT', 'ALLOWED_ORIGINS', 'TRUSTED_PROXIES', 'MAX_SEATS_PER_IP', 'BLOCK_HEIGHT_URL', 'LOG_LEVEL', 'BOTS', 'DATABASE_URL', 'SESSION_SECRET', 'SESSION_SECRET_PREVIOUS', 'REDIS_URL', 'SCALING_KEY_SECRET', 'PUBLIC_ADDRESS', 'FRAME_ANCESTORS', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_PROFILE_SECRET', 'FEEDBACK_DIR']) {
      expect(template, name).toContain(name);
    }
  });

  it('hardens the systemd unit', () => {
    const unit = read('deploy/systemd/byzantine-council.service');
    for (const line of ['User=bcouncil', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'ProtectSystem=strict', 'PrivateDevices=yes', 'SystemCallFilter=@system-service', 'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX', 'MemoryMax=1G']) {
      expect(unit.split('\n'), line).toContain(line);
    }
  });

  it('keeps the nginx config well formed and private', () => {
    const conf = read('deploy/nginx/byzantine-council.conf');
    const opens = conf.match(/\{/g)?.length ?? 0;
    expect(conf.match(/\}/g)?.length).toBe(opens);
    // Every location that adds a header must repeat the security headers.
    for (const block of conf.split(/\n\s*location /).slice(1)) {
      const body = block.slice(0, block.indexOf('}'));
      if (body.includes('add_header')) expect(body, block.split('\n')[0]).toMatch(/include \/etc\/nginx\/snippets\/bc-(site|play)-headers\.conf;/);
    }
    for (const m of conf.matchAll(/log_format \w+ '([^']+)'/g)) {
      expect(m[1]).not.toMatch(/remote_addr|request_uri|\$request\b|args|http_x_forwarded_for/);
    }
    const proxy = read('deploy/nginx/snippets/bc-proxy.conf');
    expect(proxy).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(proxy).toContain('proxy_set_header X-Forwarded-For "";');
    expect(proxy).not.toContain('proxy_add_x_forwarded_for');
  });

  it('sends the site the same headers as its _headers file', () => {
    const file = read('apps/site/public/_headers');
    const block = file.slice(file.indexOf('/*'), file.indexOf('\n\n', file.indexOf('/*')));
    const expected = Array.from(block.matchAll(/^ {2}([A-Za-z-]+): (.+)$/gm), (m) => [m[1], m[2]]);
    const snippet = read('deploy/nginx/snippets/bc-site-headers.conf');
    for (const [name, value] of expected) expect(snippet, name).toContain(`add_header ${String(name)} "${String(value)}" always;`);
  });
});
