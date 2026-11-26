// The guest profile API. On the web the session lives in an HTTP-only cookie the page never sees (on Discord, a bearer
// token from the host's sign-in); every response is validated before it reaches the UI.
import { z } from 'zod';
import { LookSchema } from '@byzantine-council/shared/economy';
import { ProgressViewSchema } from '@byzantine-council/shared/progression';
import { SEASON_PATH, SeasonReplySchema, type SeasonReply } from '@byzantine-council/shared/seasons';
import type { PlatformNetwork } from '../platform/types.js';

const TIMEOUT_MS = 8000;

export const ProfileSummarySchema = z.strictObject({
  balance: z.number().int().min(0).max(10_000_000),
  notes: z.array(z.number().int().min(1)).max(64),
  look: LookSchema,
  owned: z.array(z.string().max(40)).max(200),
  progress: ProgressViewSchema,
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export class ProfileApi {
  // On hosts without cookies the session is a bearer token from the host's sign-in, or there is no profile at all.
  constructor(
    private readonly base: string,
    private readonly network: PlatformNetwork | null = null,
  ) {}

  async #call(path: string, init: RequestInit = {}): Promise<ProfileSummary | null> {
    if (this.network === null) return this.#send(path, { ...init, credentials: 'include' });
    const credential = await this.network.credential;
    if (credential.kind === 'none') return null;
    return this.#send(path, { ...init, credentials: 'omit', headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${credential.token}` } });
  }

  async #send(path: string, init: RequestInit): Promise<ProfileSummary | null> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);
    try {
      const res = await fetch(`${this.base}${path}`, { ...init, signal: controller.signal });
      if (!res.ok) return null;
      const parsed = ProfileSummarySchema.safeParse(await res.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  #post(path: string, body: unknown): Promise<ProfileSummary | null> {
    return this.#call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  // Starts or resumes the guest session; null when profiles are unavailable.
  session(): Promise<ProfileSummary | null> {
    return this.#post('/api/session', {});
  }

  profile(): Promise<ProfileSummary | null> {
    return this.#call('/api/profile');
  }

  chooseTitle(title: string | null): Promise<ProfileSummary | null> {
    return this.#post('/api/progress/title', { title });
  }

  chooseFrame(frame: string | null): Promise<ProfileSummary | null> {
    return this.#post('/api/progress/frame', { frame });
  }

  buy(item: string, shop: string, notes: readonly number[]): Promise<ProfileSummary | null> {
    return this.#post('/api/shop/buy', { item, shop, notes });
  }

  wear(look: unknown): Promise<ProfileSummary | null> {
    return this.#post('/api/look', { look });
  }

  reroll(quest: string): Promise<ProfileSummary | null> {
    return this.#post('/api/progress/reroll', { quest });
  }

  // The featured seasonal event; no cookie needed, and null on any failure.
  async season(): Promise<SeasonReply | null> {
    try {
      const res = await fetch(`${this.base}${SEASON_PATH}`, { credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const parsed = SeasonReplySchema.safeParse(await res.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
