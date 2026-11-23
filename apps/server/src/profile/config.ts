// Profile settings from the environment. Production requires a database and a real session secret.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { SessionKeys } from './session.js';

const Secret = z.string().min(32).max(512);

export interface ProfileConfig {
  readonly databaseUrl: string | null;
  readonly keys: SessionKeys;
  // True when the session secret was generated for this process only (development).
  readonly ephemeralSecret: boolean;
}

export function profileConfig(env: NodeJS.ProcessEnv = process.env): ProfileConfig {
  const production = env['NODE_ENV'] === 'production';
  const url = env['DATABASE_URL']?.trim() ?? '';
  const databaseUrl = url === '' ? null : z.url().max(2048).parse(url);
  if (production && databaseUrl === null) throw new Error('DATABASE_URL is required in production');
  const secret = env['SESSION_SECRET'];
  if (production && secret === undefined) throw new Error('SESSION_SECRET is required in production (at least 32 characters)');
  const previous = env['SESSION_SECRET_PREVIOUS'];
  return {
    databaseUrl,
    keys: {
      current: secret === undefined ? randomBytes(32) : Buffer.from(Secret.parse(secret)),
      previous: previous === undefined || previous === '' ? null : Buffer.from(Secret.parse(previous)),
      secure: production,
    },
    ephemeralSecret: secret === undefined,
  };
}
