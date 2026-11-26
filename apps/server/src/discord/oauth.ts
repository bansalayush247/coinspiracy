// Discord OAuth2: trades an Activity's authorization code for the user's id alone (no names or avatars), then forgets the token.
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { DiscordSettings } from './config.js';

/** Discord's API root; tests point the fetch elsewhere instead of changing this. */
export const DISCORD_API = 'https://discord.com/api/v10';
/** The only scope requested: enough to learn a stable user id. */
export const DISCORD_SCOPE = 'identify';
const MAX_REPLY_BYTES = 16 * 1024;

const TokenReplySchema = z.object({
  access_token: z.string().regex(/^[A-Za-z0-9._~+/=-]{1,512}$/),
  token_type: z.string().regex(/^bearer$/i),
  scope: z.string().max(512),
});
const UserReplySchema = z.object({ id: z.string().regex(/^\d{17,20}$/) });

/** Why an exchange failed: `rejected` is the player's code, `unavailable` is Discord or the network. */
export type ExchangeFailure = 'rejected' | 'unavailable';
/** The Discord user id, or why there is none. */
export type ExchangeResult = { readonly ok: true; readonly userId: string } | { readonly ok: false; readonly reason: ExchangeFailure };

/** The slice of fetch the exchange uses, injectable for tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// Reads at most MAX_REPLY_BYTES of JSON; a longer or malformed body reads as null.
async function readJson(res: Response): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_REPLY_BYTES) return null;
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = res.body?.getReader();
  if (reader === undefined) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPLY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * Exchanges an authorization code for the Discord user id. The access token lives only inside this call.
 * @param timeoutMs per request to Discord
 */
export async function exchangeDiscordCode(settings: DiscordSettings, code: string, fetchFn: FetchLike, timeoutMs: number): Promise<ExchangeResult> {
  const call = async (url: string, init: RequestInit): Promise<Response | null> => {
    try {
      return await fetchFn(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return null;
    }
  };
  const form = new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, grant_type: 'authorization_code', code });
  const tokenRes = await call(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  });
  if (tokenRes === null) return { ok: false, reason: 'unavailable' };
  if (tokenRes.status === 400 || tokenRes.status === 401) {
    await tokenRes.body?.cancel().catch(() => undefined);
    return { ok: false, reason: 'rejected' };
  }
  if (!tokenRes.ok) {
    await tokenRes.body?.cancel().catch(() => undefined);
    return { ok: false, reason: 'unavailable' };
  }
  const token = TokenReplySchema.safeParse(await readJson(tokenRes));
  if (!token.success) return { ok: false, reason: 'unavailable' };
  if (!token.data.scope.split(' ').includes(DISCORD_SCOPE)) return { ok: false, reason: 'rejected' };

  const userRes = await call(`${DISCORD_API}/users/@me`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token.data.access_token}`, accept: 'application/json' },
  });
  if (userRes === null) return { ok: false, reason: 'unavailable' };
  if (!userRes.ok) {
    await userRes.body?.cancel().catch(() => undefined);
    return { ok: false, reason: userRes.status === 401 ? 'rejected' : 'unavailable' };
  }
  const user = UserReplySchema.safeParse(await readJson(userRes));
  return user.success ? { ok: true, userId: user.data.id } : { ok: false, reason: 'unavailable' };
}

/** The guest profile id for a Discord user: a keyed hash, so the Discord id itself is never stored. */
export function discordProfileId(profileKey: Buffer, userId: string): string {
  return createHmac('sha256', profileKey).update(`discord.v1.${userId}`).digest().subarray(0, 16).toString('base64url');
}
