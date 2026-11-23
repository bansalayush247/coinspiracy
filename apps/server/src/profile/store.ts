// Profile storage. Every change runs as one atomic step: load, apply, save, with an optional
// idempotency key so a retried award or purchase can never apply twice.
import { z } from 'zod';
import { cryptoRandom } from '@byzantine-council/shared';
import { DEFAULT_LOOK, LookSchema, OwnedCosmeticsSchema, WalletSchema, walletFromAmount, type Look } from '@byzantine-council/shared/economy';
import { ProgressSchema, newProgress, offerDailyQuest, type Progress } from '@byzantine-council/shared/progression';

// Play sats a new guest starts with, enough for a first haircut or hat.
export const START_BALANCE = 500;
// Guests who have not been seen for this long are deleted with everything they own.
export const RETENTION_DAYS = 400;
// Idempotency keys only need to outlive any retry.
export const KEY_RETENTION_DAYS = 30;

export const ProfileDataSchema = z.strictObject({
  wallet: WalletSchema,
  owned: OwnedCosmeticsSchema,
  look: LookSchema,
  progress: ProgressSchema,
});
export interface ProfileData {
  readonly wallet: readonly number[];
  readonly owned: readonly string[];
  readonly look: Look;
  readonly progress: Progress;
}

export function newProfileData(nowMs: number): ProfileData {
  const wallet = walletFromAmount(START_BALANCE);
  if (!wallet.ok) throw new Error('start balance is not a valid wallet');
  return { wallet: wallet.value, owned: [], look: DEFAULT_LOOK, progress: newProgress(nowMs) };
}

// Loaded data is untrusted until it parses; a bad row fails closed rather than being repaired silently.
export function parseProfileData(raw: unknown): ProfileData {
  return ProfileDataSchema.parse(raw) as ProfileData;
}

export type Change<R> = { readonly data: ProfileData; readonly result: R } | null;
export type ChangeOutcome<R> = { readonly ok: true; readonly result: R } | { readonly ok: false; readonly reason: 'duplicate' | 'refused' };

export interface ProfileStore {
  // Applies fn to the profile (created on first use). fn returning null leaves it unchanged.
  change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>>;
  // Adds to an anonymous daily aggregate; never per player.
  count(day: number, key: string, n?: number): Promise<void>;
  // Deletes long-unseen guests and old idempotency keys.
  purge(nowMs: number): Promise<{ readonly profiles: number }>;
  close(): Promise<void>;
}

export function utcDayOf(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

// Loads a profile, offering today's quest on the way.
export async function loadProfile(store: ProfileStore, id: string, nowMs: number): Promise<ProfileData> {
  const out = await store.change(id, null, nowMs, (data) => {
    const progress = offerDailyQuest(data.progress, cryptoRandom, nowMs);
    const next = progress === data.progress ? data : { ...data, progress };
    return { data: next, result: next };
  });
  if (!out.ok) throw new Error('profile load refused');
  return out.result;
}

// In-process store for development and tests: bounded, and gone on restart.
export class MemoryProfileStore implements ProfileStore {
  readonly #rows = new Map<string, { data: ProfileData; lastSeen: number }>();
  readonly #keys = new Map<string, number>();
  readonly #stats = new Map<string, number>();

  constructor(private readonly maxProfiles = 50_000) {}

  change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    try {
      return Promise.resolve(this.#change(id, key, nowMs, fn));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('profile change failed'));
    }
  }

  #change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): ChangeOutcome<R> {
    if (key !== null && this.#keys.has(key)) return { ok: false, reason: 'duplicate' };
    const row = this.#rows.get(id);
    if (row === undefined && this.#rows.size >= this.maxProfiles) this.#evictOldest();
    const current = row?.data ?? newProfileData(nowMs);
    const out = fn(current);
    if (out === null) return { ok: false, reason: 'refused' };
    this.#rows.set(id, { data: parseProfileData(out.data), lastSeen: utcDayOf(nowMs) });
    if (key !== null) this.#keys.set(key, utcDayOf(nowMs));
    return { ok: true, result: out.result };
  }

  count(day: number, key: string, n = 1): Promise<void> {
    const k = `${String(day)}:${key}`;
    this.#stats.set(k, (this.#stats.get(k) ?? 0) + n);
    return Promise.resolve();
  }

  purge(nowMs: number): Promise<{ profiles: number }> {
    const today = utcDayOf(nowMs);
    let profiles = 0;
    for (const [id, row] of this.#rows) {
      if (row.lastSeen < today - RETENTION_DAYS) {
        this.#rows.delete(id);
        profiles += 1;
      }
    }
    for (const [key, day] of this.#keys) if (day < today - KEY_RETENTION_DAYS) this.#keys.delete(key);
    return Promise.resolve({ profiles });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  stats(): ReadonlyMap<string, number> {
    return this.#stats;
  }

  #evictOldest(): void {
    let oldest: [string, number] | null = null;
    for (const [id, row] of this.#rows) if (oldest === null || row.lastSeen < oldest[1]) oldest = [id, row.lastSeen];
    if (oldest !== null) this.#rows.delete(oldest[0]);
  }
}
