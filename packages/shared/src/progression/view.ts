// What a player sees of their own progression; built on the server, validated on the client.
import { ACADEMY_LEVELS, academyLevelOpen } from './academy.js';
import { epochReward, EPOCH_TIERS, EPOCH_TIER_XP, epochHat } from './epoch.js';
import { MAX_QUESTS, questById } from './quests.js';
import { nextUnlock, rankFor, RANK_UP_SATS } from './rank.js';
import { SEALS, sealProgress, sealVisible } from './seals.js';
import { displayTitle, ownedFrames, ownedTitles, type Progress, type StoryKey } from './progress.js';

export function toProgressView(p: Progress, nowMs: number) {
  const rank = rankFor(p.xp);
  const earned = new Set(p.seals);
  const next = nextUnlock(rank.rank);
  return {
    xp: p.xp,
    rank: rank.rank,
    into: rank.into,
    forNext: rank.forNext,
    stars: rank.stars,
    rankUpSats: RANK_UP_SATS,
    next: next === null ? null : { rank: next.rank, ...(next.unlock.frame === undefined ? {} : { frame: next.unlock.frame }), ...(next.unlock.item === undefined ? {} : { item: next.unlock.item }) },
    title: displayTitle(p),
    chosenTitle: p.title,
    frame: p.frame,
    titles: ownedTitles(p),
    frames: ownedFrames(p),
    seals: SEALS.map((s) => ({
      id: s.id,
      visible: sealVisible(s, earned),
      done: earned.has(s.id),
      progress: sealProgress(s, p.counters),
    })),
    quests: p.quests.flatMap((q) => {
      const t = questById(q.id);
      return t === undefined ? [] : [{ id: q.id, text: t.text, progress: q.progress, target: t.target, xp: t.xp, sats: t.sats }];
    }),
    questSlots: MAX_QUESTS,
    canReroll: p.rerollDay < Math.floor(nowMs / 86_400_000),
    epoch: {
      index: p.epoch.index,
      xp: p.epoch.xp,
      tier: p.epoch.tier,
      tiers: EPOCH_TIERS,
      tierXp: EPOCH_TIER_XP,
      hat: epochHat(p.epoch.index),
      rewards: Array.from({ length: EPOCH_TIERS }, (_, i) => {
        const r = epochReward(i + 1, p.epoch.index);
        return { tier: i + 1, ...(r.sats === undefined ? {} : { sats: r.sats }), ...(r.frame === undefined ? {} : { frame: r.frame }), ...(r.item === undefined ? {} : { item: r.item }) };
      }),
    },
    academy: ACADEMY_LEVELS.map((l, i) => ({
      level: l.level,
      stars: p.academy[i] ?? 0,
      // Opens with its island, then once the island's level before it is cleared.
      open: academyLevelOpen(l.level, p.xp, p.academy),
    })),
    stories: Object.entries(p.story ?? {}).flatMap(([k, r]) => (r.done ? [k as StoryKey] : [])),
  };
}
export type ProgressView = ReturnType<typeof toProgressView>;
