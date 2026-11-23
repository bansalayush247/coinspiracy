// Pays out a finished match or Academy level: XP, sats and items in one transaction per profile,
// keyed so a retry or a second tab on the same profile can never pay twice.
import { credit, rewardItem, type Wallet } from '@byzantine-council/shared/economy';
import { applyAcademyResult, applyMatch, type Applied, type Award, type MatchFacts, type PlayerFacts } from '@byzantine-council/shared/progression';
import { log } from '../logger.js';
import { utcDayOf, type ProfileData, type ProfileStore } from './store.js';

export interface Payee {
  readonly sessionId: string;
  readonly profileId: string;
  readonly facts: PlayerFacts;
}

// Sats that do not fit the wallet are skipped, never clamped; items join the owned list once.
export function pay(data: ProfileData, applied: Applied): ProfileData {
  let wallet: Wallet = data.wallet;
  if (applied.award.sats > 0) {
    const paid = credit(wallet, applied.award.sats);
    if (paid.ok) wallet = paid.value.wallet;
  }
  const owned = new Set(data.owned);
  for (const reward of applied.award.items) owned.add(rewardItem(reward));
  return { ...data, wallet, owned: [...owned], progress: applied.progress };
}

export async function awardMatch(store: ProfileStore, match: MatchFacts, payees: readonly Payee[], nowMs: number): Promise<Map<string, Award>> {
  const awards = new Map<string, Award>();
  const results = await Promise.allSettled(
    payees.map(async (p) => {
      const out = await store.change(p.profileId, `match:${match.matchId}:${p.profileId}`, nowMs, (data) => {
        const applied = applyMatch(data.progress, match, p.facts);
        return { data: pay(data, applied), result: applied.award };
      });
      if (out.ok) awards.set(p.sessionId, out.result);
    }),
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) log.error('match awards failed', results.find((r) => r.status === 'rejected')?.reason, { failed });
  // Anonymous aggregates only: how matches end, never who played them.
  const day = utcDayOf(nowMs);
  await Promise.all([
    store.count(day, 'matches'),
    store.count(day, `winner:${match.winner}`),
    store.count(day, `reason:${match.reason}`),
    store.count(day, `players:${String(match.players)}`),
  ]).catch((error: unknown) => {
    log.error('daily stats failed', error);
  });
  return awards;
}

export async function awardAcademy(store: ProfileStore, profileId: string, runId: string, level: number, stars: number, nowMs: number, blockHeight: number): Promise<Award | null> {
  const out = await store.change(profileId, `academy:${runId}`, nowMs, (data) => {
    const applied = applyAcademyResult(data.progress, level, stars, nowMs, blockHeight);
    return { data: pay(data, applied), result: applied.award };
  });
  return out.ok ? out.result : null;
}
