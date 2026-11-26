// Discord Activity sign-in settings. Off unless every variable is set; a partial setup fails closed with a 503.
import { z } from 'zod';

const ClientId = z.string().regex(/^\d{17,20}$/, 'must be the numeric application id');
const ClientSecret = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, 'must be the OAuth2 client secret');
const ProfileSecret = z.string().min(32).max(512);

/** Everything the token exchange needs; the secrets never leave the server. */
export interface DiscordSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Keys the Discord user id to a stable guest profile id; rotating it gives every Discord player a new profile. */
  readonly profileKey: Buffer;
}

/** `off`: nothing set, the endpoint does not exist. `broken`: partly or wrongly set, the endpoint answers 503. */
export type DiscordConfig =
  | { readonly state: 'off' }
  | { readonly state: 'broken'; readonly problems: readonly string[] }
  | { readonly state: 'on'; readonly settings: DiscordSettings };

/** The env variables, by name, so docs and the env template can list them. */
export const DISCORD_ENV = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_PROFILE_SECRET'] as const;

/** Reads the Discord settings; problems name the variable, never its value. */
export function discordConfig(env: NodeJS.ProcessEnv): DiscordConfig {
  const raw = Object.fromEntries(DISCORD_ENV.map((name) => [name, env[name]?.trim() ?? ''])) as Record<(typeof DISCORD_ENV)[number], string>;
  if (DISCORD_ENV.every((name) => raw[name] === '')) return { state: 'off' };
  const problems: string[] = [];
  const check = (name: (typeof DISCORD_ENV)[number], schema: z.ZodString): void => {
    const r = schema.safeParse(raw[name]);
    if (!r.success) problems.push(`${name}: ${raw[name] === '' ? 'not set' : (r.error.issues[0]?.message ?? 'invalid')}`);
  };
  check('DISCORD_CLIENT_ID', ClientId);
  check('DISCORD_CLIENT_SECRET', ClientSecret);
  check('DISCORD_PROFILE_SECRET', ProfileSecret);
  if (problems.length > 0) return { state: 'broken', problems };
  return {
    state: 'on',
    settings: { clientId: raw.DISCORD_CLIENT_ID, clientSecret: raw.DISCORD_CLIENT_SECRET, profileKey: Buffer.from(raw.DISCORD_PROFILE_SECRET) },
  };
}
