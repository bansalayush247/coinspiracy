import { z } from 'zod';
import type { Credential } from './types.js';

/** The server route that trades a Discord authorization code for a guest session token. */
export const DISCORD_TOKEN_PATH = '/api/discord/token';
/** Minimum scope: `identify` gives the server a stable user id and nothing it shows to anyone. */
export const DISCORD_SCOPES = ['identify'] as const;
const EXCHANGE_TIMEOUT_MS = 10_000;
const TokenReplySchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{22}\.\d{1,12}\.[A-Za-z0-9_-]{43}$/) });

/** The slice of `@discord/embedded-app-sdk`'s DiscordSDK the client uses, so tests can stand in for it. */
export interface DiscordSdkLike {
  ready(): Promise<void>;
  readonly commands: {
    authorize(args: { client_id: string; response_type: 'code'; state: string; prompt: 'none'; scope: 'identify'[] }): Promise<{ code: string }>;
    openExternalLink(args: { url: string }): Promise<unknown>;
  };
}

/** Accepts only a Discord application id (a numeric snowflake). */
export function discordClientId(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  return /^\d{17,20}$/.test(value) ? value : null;
}

/** Loads the official SDK on demand, so web and portal bundles never include it. */
export async function loadDiscordSdk(clientId: string): Promise<DiscordSdkLike> {
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  return new DiscordSDK(clientId);
}

/** What the sign-in needs: the loaded SDK, the application id, the proxied server and a fetch. */
export interface DiscordSignIn {
  readonly sdk: DiscordSdkLike;
  readonly clientId: string;
  /** The proxied server base, such as `/.proxy/colyseus`. */
  readonly httpBase: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Discord's embedded OAuth2 flow: `authorize` (identify only) gives a one-time code, the server exchanges it with the
 * client secret and answers with a signed guest session token. Any failure means playing without a saved profile.
 */
export async function signInWithDiscord(options: DiscordSignIn): Promise<Credential> {
  try {
    await options.sdk.ready();
    const { code } = await options.sdk.commands.authorize({ client_id: options.clientId, response_type: 'code', state: '', prompt: 'none', scope: [...DISCORD_SCOPES] });
    const res = await options.fetch(`${options.httpBase}${DISCORD_TOKEN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: 'none' };
    const parsed = TokenReplySchema.safeParse(await res.json());
    return parsed.success ? { kind: 'bearer', token: parsed.data.token } : { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
}
