// A profile's progression and every way it changes. Pure: the server stores the result and
// applies it in one transaction with the matching sats, keyed by match or Academy run.
import type { ActId } from '../city/story.js';
import type { RewardId } from '../economy/catalog.js';
import type { RandomSource } from '../roles.js';
import { ACADEMY_FIRST_CLEAR, ACADEMY_LEVELS, ACADEMY_MAX_STARS, ACADEMY_THREE_STARS, academyLevel } from './academy.js';
import { computeMatchXp, dayFor, utcDay, type DayState, type Ineligible, type MatchFacts, type PlayerFacts, type XpLine } from './award.js';
import { addCounters, matchCounters, type Counters } from './counters.js';
import { epochOf, epochReward, epochTier } from './epoch.js';
import { drawQuest, MAX_QUESTS, questById, STARTER_QUESTS, type Quest, type QuestEvent } from './quests.js';
import { FRAME_IDS, MAX_RANK, RANK_ROAD, RANK_TITLES, RANK_TITLE_IDS, RANK_UP_SATS, rankFor, rankTitle, type FrameId, type RankTitleId } from './rank.js';
import { SEAL_TITLE_IDS, SEAL_TITLE_NAMES, SEAL_XP, newSeals, sealById, type SealTitleId } from './seals.js';

export type TitleId = RankTitleId | SealTitleId;
export const TITLE_IDS: readonly TitleId[] = Object.freeze([...RANK_TITLE_IDS, ...SEAL_TITLE_IDS]);
export const TITLE_NAMES: Readonly<Record<TitleId, string>> = Object.freeze({
  ...Object.fromEntries(RANK_TITLES.map((t) => [t.id, t.name])),
  ...SEAL_TITLE_NAMES,
} as Record<TitleId, string>);

export interface Progress {
  readonly v: 1;
  readonly xp: number;
  readonly counters: Counters;
  readonly seals: readonly string[];
  readonly quests: readonly Quest[];
  // UTC days of the last quest offer and the last reroll.
  readonly offerDay: number;
  readonly rerollDay: number;
  readonly epoch: { readonly index: number; readonly xp: number; readonly tier: number };
  readonly day: DayState;
  // Epoch of the last finished match, for the epochs-played counter; -1 before the first.
  readonly lastEpochPlayed: number;
  // Best stars per Academy level, indexed by level - 1.
  readonly academy: readonly number[];
  readonly epochFrame: boolean;
  readonly title: TitleId | null;
  readonly frame: FrameId | null;
  readonly story?: Readonly<Partial<Record<StoryKey, StoryRecord>>>;
}

// Every saved story: the acts, the side cases, and the signing ceremony.
export type StoryKey = ActId | 'ceremony';

export interface StoryRecord {
  readonly done: boolean;
  readonly honest: boolean;
  readonly marks: readonly string[];
}

export function newProgress(nowMs: number): Progress {
  const today = utcDay(nowMs);
  return {
    v: 1,
    xp: 0,
    counters: {},
    seals: [],
    quests: STARTER_QUESTS.map((id) => ({ id, progress: 0 })),
    offerDay: today,
    rerollDay: -1,
    epoch: { index: 0, xp: 0, tier: 0 },
    day: { index: today, matchXp: 0, practiceXp: 0, firstBonus: false },
    lastEpochPlayed: -1,
    academy: ACADEMY_LEVELS.map(() => 0),
    epochFrame: false,
    title: null,
    frame: null,
  };
}

export interface QuestDone {
  readonly id: string;
  readonly xp: number;
  readonly sats: number;
}

export interface Award {
  readonly eligible: boolean;
  readonly ineligible?: Ineligible;
  readonly practice: boolean;
  // Match XP lines; seal, quest, Academy and Epoch Road rewards are listed separately.
  readonly lines: readonly XpLine[];
  readonly xpBefore: number;
  readonly xpAfter: number;
  readonly rankBefore: number;
  readonly rankAfter: number;
  readonly sats: number;
  readonly items: readonly RewardId[];
  readonly frames: readonly FrameId[];
  readonly titles: readonly TitleId[];
  readonly seals: readonly string[];
  readonly questsDone: readonly QuestDone[];
  readonly quests: readonly Quest[];
  readonly epoch: { readonly index: number; readonly xpBefore: number; readonly xpAfter: number; readonly tierBefore: number; readonly tierAfter: number };
}

export interface Applied {
  readonly progress: Progress;
  readonly award: Award;
}

export function ownedFrames(p: Progress): FrameId[] {
  const rank = rankFor(p.xp).rank;
  const frames = new Set<FrameId>();
  for (const [r, unlock] of RANK_ROAD) if (r <= rank && unlock.frame !== undefined) frames.add(unlock.frame);
  if (p.epochFrame) frames.add('epoch');
  return FRAME_IDS.filter((f) => frames.has(f));
}

export function ownedTitles(p: Progress): TitleId[] {
  const rank = rankFor(p.xp).rank;
  const titles: TitleId[] = RANK_TITLES.filter((t) => t.rank <= rank).map((t) => t.id);
  for (const id of p.seals) {
    const title = sealById(id)?.title;
    if (title !== undefined) titles.push(title);
  }
  return TITLE_IDS.filter((t) => titles.includes(t));
}

// Shared tail of every gain: quests, seals, ranks and the Epoch Road, in that order.
function settle(
  p: Progress,
  gain: { xp: number; sats: number; items: RewardId[]; counters: Counters; quest: QuestEvent | null; lines: readonly XpLine[]; eligible: boolean; ineligible?: Ineligible; practice: boolean; day: DayState; lastEpochPlayed: number; academy: readonly number[] },
  blockHeight: number,
): Applied {
  const counters = addCounters(p.counters, gain.counters);
  let xp = gain.xp;
  let sats = gain.sats;
  const items = [...gain.items];
  const frames: FrameId[] = [];
  const titles: TitleId[] = [];

  // Quests advance; finished ones pay out and leave the list.
  const questsDone: QuestDone[] = [];
  const quests: Quest[] = [];
  for (const q of p.quests) {
    const template = questById(q.id);
    if (template === undefined) continue;
    const progress = Math.min(template.target, q.progress + (gain.quest === null ? 0 : template.step(gain.quest)));
    if (progress >= template.target) {
      questsDone.push({ id: q.id, xp: template.xp, sats: template.sats });
      xp += template.xp;
      sats += template.sats;
    } else {
      quests.push({ id: q.id, progress });
    }
  }

  // Seals earned with the new counters.
  const earned = new Set(p.seals);
  const sealsEarned = newSeals(counters, earned);
  for (const seal of sealsEarned) {
    xp += SEAL_XP[seal.frame];
    if (seal.item !== undefined) items.push(seal.item);
    if (seal.title !== undefined) titles.push(seal.title);
  }

  // Ranks passed on the way, each with its sats and any Rank Road unlock.
  const before = rankFor(p.xp).rank;
  const total = Math.min(Number.MAX_SAFE_INTEGER, p.xp + xp);
  const after = rankFor(total).rank;
  for (let r = before + 1; r <= Math.min(after, MAX_RANK); r++) {
    sats += RANK_UP_SATS;
    const unlock = RANK_ROAD.get(r);
    if (unlock?.frame !== undefined) frames.push(unlock.frame);
    if (unlock?.item !== undefined) items.push(unlock.item);
    if (RANK_TITLES.some((t) => t.rank === r)) titles.push(rankTitle(r));
  }

  // The Epoch Road: the stored epoch never goes backwards; a newer one starts the road over.
  const index = Math.max(p.epoch.index, epochOf(blockHeight));
  const startXp = index === p.epoch.index ? p.epoch.xp : 0;
  const startTier = index === p.epoch.index ? p.epoch.tier : 0;
  const epochXp = Math.min(1_000_000, startXp + xp);
  const tier = epochTier(epochXp);
  let epochFrame = p.epochFrame;
  for (let t = startTier + 1; t <= tier; t++) {
    const reward = epochReward(t, index);
    if (reward.frame !== undefined) {
      if (epochFrame) sats += 150;
      else {
        epochFrame = true;
        frames.push(reward.frame);
      }
    }
    if (reward.sats !== undefined) sats += reward.sats;
    if (reward.item !== undefined) items.push(reward.item);
  }

  const progress: Progress = {
    ...p,
    xp: total,
    counters,
    seals: [...p.seals, ...sealsEarned.map((s) => s.id)],
    quests,
    epoch: { index, xp: epochXp, tier },
    day: gain.day,
    lastEpochPlayed: gain.lastEpochPlayed,
    academy: gain.academy,
    epochFrame,
  };
  return {
    progress,
    award: {
      eligible: gain.eligible,
      ...(gain.ineligible === undefined ? {} : { ineligible: gain.ineligible }),
      practice: gain.practice,
      lines: gain.lines,
      xpBefore: p.xp,
      xpAfter: total,
      rankBefore: before,
      rankAfter: after,
      sats,
      items: [...new Set(items)],
      frames,
      titles: [...new Set(titles)],
      seals: sealsEarned.map((s) => s.id),
      questsDone,
      quests,
      epoch: { index, xpBefore: startXp, xpAfter: epochXp, tierBefore: startTier, tierAfter: tier },
    },
  };
}

export function applyMatch(p: Progress, match: MatchFacts, player: PlayerFacts): Applied {
  const result = computeMatchXp(match, player, p.day);
  if (!result.eligible) {
    return settle(
      p,
      { xp: 0, sats: 0, items: [], counters: {}, quest: null, lines: [], eligible: false, ...(result.ineligible === undefined ? {} : { ineligible: result.ineligible }), practice: result.practice, day: result.day, lastEpochPlayed: p.lastEpochPlayed, academy: p.academy },
      match.blockHeight,
    );
  }
  const epoch = Math.max(p.epoch.index, epochOf(match.blockHeight));
  const newEpoch = !result.practice && p.lastEpochPlayed !== epoch;
  // Play sats for the match: half the match XP after every cap, so the caps apply to sats too.
  const matchSats = Math.floor(result.lines.filter((l) => l.reason !== 'firstOfDay').reduce((a, l) => a + l.xp, 0) / 2);
  return settle(
    p,
    {
      xp: result.total,
      sats: matchSats,
      items: [],
      counters: matchCounters(match, player, newEpoch),
      quest: result.practice ? null : { kind: 'match', match, player },
      lines: result.lines,
      eligible: true,
      practice: result.practice,
      day: result.day,
      lastEpochPlayed: result.practice ? p.lastEpochPlayed : epoch,
      academy: p.academy,
    },
    match.blockHeight,
  );
}

// The per-island clear counter for the islands whose Seal Book pages track their Academy levels.
function islandClears(island: string): Counters {
  if (island === 'signing') return { clearsSigning: 1 };
  if (island === 'council') return { clearsCouncil: 1 };
  if (island === 'watchtower') return { clearsPeaks: 1 };
  return {};
}

// An Academy level finished with this many stars. Rewards come once per level; replays only raise the best.
export function applyAcademyResult(p: Progress, level: number, stars: number, nowMs: number, blockHeight: number): Applied {
  const def = academyLevel(level);
  const clean = Number.isInteger(stars) ? Math.max(0, Math.min(ACADEMY_MAX_STARS, stars)) : 0;
  const day = dayFor(p.day, nowMs);
  if (def === undefined || clean === 0) {
    return settle(p, { xp: 0, sats: 0, items: [], counters: {}, quest: null, lines: [], eligible: false, practice: false, day, lastEpochPlayed: p.lastEpochPlayed, academy: p.academy }, blockHeight);
  }
  const best = p.academy[level - 1] ?? 0;
  const firstClear = best === 0;
  const firstThree = best < ACADEMY_MAX_STARS && clean === ACADEMY_MAX_STARS;
  const newStars = Math.max(0, clean - best);
  const academy = p.academy.map((s, i) => (i === level - 1 ? Math.max(s, clean) : s));
  return settle(
    p,
    {
      xp: (firstClear ? ACADEMY_FIRST_CLEAR.xp : 0) + (firstThree ? ACADEMY_THREE_STARS.xp : 0),
      sats: firstClear ? ACADEMY_FIRST_CLEAR.sats : 0,
      items: [],
      counters: { academyClears: firstClear ? 1 : 0, academyStars: newStars, ...(firstClear ? islandClears(def.island) : {}) },
      quest: { kind: 'academy', firstClear, newStars },
      lines: [],
      eligible: true,
      practice: false,
      day,
      lastEpochPlayed: p.lastEpochPlayed,
      academy,
    },
    blockHeight,
  );
}

// A paid Beach Town delivery: counts toward the courier seals and their XP; the sats are paid by the caller.
export function applyCourierDelivery(p: Progress, nowMs: number, blockHeight: number): Applied {
  return settle(
    p,
    { xp: 0, sats: 0, items: [], counters: { courierDeliveries: 1 }, quest: null, lines: [], eligible: true, practice: false, day: dayFor(p.day, nowMs), lastEpochPlayed: p.lastEpochPlayed, academy: p.academy },
    blockHeight,
  );
}

// One new quest a UTC day while fewer than three are held. Returns the same object if nothing changes.
export function offerDailyQuest(p: Progress, rng: RandomSource, nowMs: number): Progress {
  const today = utcDay(nowMs);
  if (p.offerDay >= today || p.quests.length >= MAX_QUESTS) return p;
  const id = drawQuest(rng, p.quests.map((q) => q.id), rankFor(p.xp).rank);
  return { ...p, offerDay: today, quests: id === null ? p.quests : [...p.quests, { id, progress: 0 }] };
}

// Swaps one held quest for another, once a UTC day.
export function rerollQuest(p: Progress, questId: string, rng: RandomSource, nowMs: number): Progress | null {
  const today = utcDay(nowMs);
  if (p.rerollDay >= today || !p.quests.some((q) => q.id === questId)) return null;
  const id = drawQuest(rng, p.quests.map((q) => q.id), rankFor(p.xp).rank);
  if (id === null) return null;
  return { ...p, rerollDay: today, quests: p.quests.map((q) => (q.id === questId ? { id, progress: 0 } : q)) };
}

export function selectTitle(p: Progress, title: TitleId | null): Progress | null {
  if (title !== null && !ownedTitles(p).includes(title)) return null;
  return { ...p, title };
}

export function selectFrame(p: Progress, frame: FrameId | null): Progress | null {
  if (frame !== null && !ownedFrames(p).includes(frame)) return null;
  return { ...p, frame };
}

// The title shown beside a name: the chosen one, else the rank band's.
export function displayTitle(p: Progress): TitleId {
  return p.title ?? rankTitle(rankFor(p.xp).rank);
}
