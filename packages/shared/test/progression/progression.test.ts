import { describe, expect, it } from 'vitest';
import { REWARD_IDS } from '../../src/economy/catalog.js';
import {
  ACADEMY_LEVELS,
  AwardSchema,
  COUNTER_IDS,
  DAY_MS,
  EPOCH_BLOCKS,
  EPOCH_HATS,
  MAX_RANK,
  ProgressSchema,
  ProgressViewSchema,
  QUESTS,
  QUEST_IDS,
  RANK_START,
  RANK_UP_SATS,
  SEALS,
  SEAL_XP,
  STARTER_QUESTS,
  TITLE_IDS,
  XP,
  applyAcademyResult,
  applyMatch,
  computeMatchXp,
  drawQuest,
  epochHat,
  epochOf,
  epochTier,
  newProgress,
  newSeals,
  offerDailyQuest,
  ownedFrames,
  rankFor,
  rerollQuest,
  sealVisible,
  selectFrame,
  selectTitle,
  starsFor,
  toProgressView,
  type MatchFacts,
  type PlayerFacts,
  type Progress,
} from '../../src/progression/index.js';
import type { RandomSource } from '../../src/roles.js';

const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
const HEIGHT = 925_000;
const first: RandomSource = { int: () => 0 };

function match(over: Partial<MatchFacts> = {}): MatchFacts {
  return {
    matchId: 'match-0001',
    startedAtMs: T0 - 600_000,
    endedAtMs: T0,
    players: 5,
    humans: 5,
    privateRoom: false,
    winner: 'honest',
    reason: 'consensusReached',
    blockHeight: HEIGHT,
    events: [],
    ...over,
  };
}

function player(over: Partial<PlayerFacts> = {}): PlayerFacts {
  return {
    role: 'honest',
    finished: true,
    afkKicked: false,
    movedTiles: 80,
    tasks: { deposit: 1, ledger: 1, route: 1, watchtower: 1 },
    legitSigned: 2,
    forgedRefused: 1,
    forgedSigned: 0,
    forgedSignaturesGathered: 0,
    byzantineVotes: 1,
    misdirections: 0,
    partitionsRepaired: 0,
    partitionsRunOut: 0,
    rotatedOut: false,
    ...over,
  };
}

const freshDay = { index: Math.floor(T0 / DAY_MS), matchXp: 0, practiceXp: 0, firstBonus: true };

describe('Guardian Rank', () => {
  it('follows the documented curve: rank 2 at 100 XP and rank 50 at 24,150', () => {
    expect(RANK_START[0]).toBe(0);
    expect(RANK_START[1]).toBe(100);
    expect(RANK_START[2]).toBe(225);
    expect(RANK_START[MAX_RANK - 1]).toBe(24_150);
    expect(rankFor(0)).toEqual({ rank: 1, into: 0, forNext: 100, stars: 0 });
    expect(rankFor(99).rank).toBe(1);
    expect(rankFor(100)).toEqual({ rank: 2, into: 0, forNext: 125, stars: 0 });
    expect(rankFor(24_149).rank).toBe(49);
    expect(rankFor(24_150)).toEqual({ rank: 50, into: 0, forNext: 1000, stars: 0 });
    expect(rankFor(24_150 + 2_500).stars).toBe(2);
    expect(rankFor(Number.MAX_SAFE_INTEGER).stars).toBe(999);
    expect(rankFor(-5).rank).toBe(1);
    expect(rankFor(Number.NaN).rank).toBe(1);
  });
});

describe('match XP', () => {
  it('adds up a typical honest win', () => {
    const r = computeMatchXp(match(), player(), freshDay);
    expect(r.eligible).toBe(true);
    expect(r.lines).toEqual([
      { reason: 'finished', xp: 40 },
      { reason: 'won', xp: 60 },
      { reason: 'tasks', xp: 32 },
      { reason: 'signedReal', xp: 10 },
      { reason: 'refusedForgery', xp: 15 },
      { reason: 'votedByzantine', xp: 15 },
    ]);
    expect(r.total).toBe(172);
  });

  it('pays nothing to leavers, players removed for idling, and players who did nothing', () => {
    expect(computeMatchXp(match(), player({ finished: false }), freshDay)).toMatchObject({ eligible: false, ineligible: 'left', total: 0 });
    expect(computeMatchXp(match(), player({ afkKicked: true }), freshDay)).toMatchObject({ eligible: false, ineligible: 'afk' });
    const idle = player({ movedTiles: 3, tasks: { deposit: 0, ledger: 0, route: 0, watchtower: 0 }, legitSigned: 0, forgedRefused: 0, byzantineVotes: 0 });
    expect(computeMatchXp(match(), idle, freshDay)).toMatchObject({ eligible: false, ineligible: 'idle' });
  });

  it('scales short matches down to a quarter', () => {
    const short = computeMatchXp(match({ startedAtMs: T0 - 30_000 }), player(), freshDay);
    expect(short.total).toBe(Math.floor((40 * 75_000) / 300_000) + Math.floor((60 * 75_000) / 300_000) + 8 + 2 + 3 + 3);
  });

  it('gives Byzantine actions their own lines and keeps honest-only lines honest', () => {
    const byz = player({ role: 'byzantine', legitSigned: 3, forgedRefused: 2, byzantineVotes: 3, forgedSignaturesGathered: 2, misdirections: 1, partitionsRunOut: 1 });
    const r = computeMatchXp(match({ winner: 'byzantine', reason: 'forgedProposalPassed' }), byz, freshDay);
    const reasons = r.lines.map((l) => l.reason);
    expect(reasons).toContain('gatheredSignatures');
    expect(reasons).toContain('misdirection');
    expect(reasons).toContain('partitionRanOut');
    expect(reasons).not.toContain('signedReal');
    expect(reasons).not.toContain('votedByzantine');
  });

  it('caps a match, then counts a quarter past the daily soft cap', () => {
    const huge = player({ legitSigned: 99, forgedRefused: 99, byzantineVotes: 99, partitionsRepaired: 99 });
    expect(computeMatchXp(match(), huge, freshDay).total).toBeLessThanOrEqual(XP.perMatchCap);
    const nearCap = { ...freshDay, matchXp: XP.dailySoftCap - 20 };
    const r = computeMatchXp(match(), player(), nearCap);
    expect(r.total).toBe(20 + Math.floor(((172 - 20) * XP.pastCapPercent) / 100));
    expect(r.day.matchXp).toBe(nearCap.matchXp + r.total);
  });

  it('halves practice matches and caps them per day', () => {
    const practice = match({ humans: 3 });
    const r = computeMatchXp(practice, player(), freshDay);
    expect(r.practice).toBe(true);
    expect(r.total).toBe(86);
    const capped = computeMatchXp(practice, player(), { ...freshDay, practiceXp: XP.practiceDailyCap - 10 });
    expect(capped.total).toBe(10);
  });

  it('pays the first-match-of-the-day bonus once a UTC day, for matches of two minutes or more', () => {
    const day = { ...freshDay, firstBonus: false };
    const one = computeMatchXp(match(), player(), day);
    expect(one.lines.at(-1)).toEqual({ reason: 'firstOfDay', xp: XP.firstOfDay });
    const two = computeMatchXp(match(), player(), one.day);
    expect(two.lines.some((l) => l.reason === 'firstOfDay')).toBe(false);
    const nextDay = computeMatchXp(match({ startedAtMs: T0 + DAY_MS - 600_000, endedAtMs: T0 + DAY_MS }), player(), one.day);
    expect(nextDay.lines.some((l) => l.reason === 'firstOfDay')).toBe(true);
    const quick = computeMatchXp(match({ startedAtMs: T0 - 60_000 }), player(), day);
    expect(quick.lines.some((l) => l.reason === 'firstOfDay')).toBe(false);
  });

  it('keeps honest and Byzantine players within 15% of each other over typical matches', () => {
    let honest = 0;
    let byz = 0;
    for (let i = 0; i < 400; i++) {
      // Each side wins about half the time; each does its own job in a typical way.
      const winner = i % 2 === 0 ? 'honest' : 'byzantine';
      const m = match({ winner, reason: winner === 'honest' ? 'consensusReached' : 'forgedProposalPassed' });
      honest += computeMatchXp(m, player({ legitSigned: 2, forgedRefused: i % 3 === 0 ? 1 : 0, byzantineVotes: i % 4 === 0 ? 1 : 0 }), freshDay).total;
      byz += computeMatchXp(m, player({ role: 'byzantine', legitSigned: 2, forgedRefused: 0, byzantineVotes: 0, forgedSignaturesGathered: 1 + (i % 2), misdirections: i % 5 === 0 ? 1 : 0, partitionsRunOut: i % 3 === 0 ? 1 : 0 }), freshDay).total;
    }
    expect(Math.abs(honest - byz) / Math.max(honest, byz)).toBeLessThan(0.15);
  });
});

describe('the Seal Book', () => {
  it('has 58 seals with unique ids and parents in the same tab', () => {
    expect(SEALS).toHaveLength(58);
    expect(new Set(SEALS.map((s) => s.id)).size).toBe(58);
    for (const s of SEALS) {
      if (s.parent !== null) expect(SEALS.find((p) => p.id === s.parent)?.tab).toBe(s.tab);
      expect(s.counters.length).toBeGreaterThan(0);
      if (s.frame === 'legend') expect(s.title).toBeDefined();
    }
  });

  it('earns a seal whenever its counter reaches the target, whatever its parent', () => {
    expect(newSeals({ tasksLedger: 5 }, new Set()).map((s) => s.id)).toEqual(['ledger1']);
    expect(newSeals({ tasksLedger: 100 }, new Set(['ledger1'])).map((s) => s.id)).toEqual(['ledger2', 'ledger3']);
    expect(newSeals({ tasksDeposit: 1, tasksLedger: 1, tasksRoute: 1 }, new Set()).map((s) => s.id)).not.toContain('allStations');
  });

  it('shows hidden seals only once earned, and children once their parent is', () => {
    const halving = SEALS.find((s) => s.id === 'halving');
    const ledger2 = SEALS.find((s) => s.id === 'ledger2');
    if (halving === undefined || ledger2 === undefined) throw new Error('missing seals');
    expect(sealVisible(halving, new Set(['epoch1']))).toBe(false);
    expect(sealVisible(halving, new Set(['halving']))).toBe(true);
    expect(sealVisible(ledger2, new Set())).toBe(false);
    expect(sealVisible(ledger2, new Set(['ledger1']))).toBe(true);
  });
});

describe('quests', () => {
  it('only offers quests the player is ranked for and does not hold', () => {
    for (let i = 0; i < QUESTS.length; i++) {
      const id = drawQuest({ int: (max) => i % max }, [], 1);
      expect(QUESTS.find((q) => q.id === id)?.minRank).toBe(1);
    }
    const held = QUESTS.filter((q) => q.minRank <= 1).map((q) => q.id).slice(1);
    expect(drawQuest(first, held, 1)).toBe(QUESTS.find((q) => q.minRank <= 1 && !held.includes(q.id))?.id);
    expect(drawQuest(first, QUEST_IDS, 99)).toBeNull();
  });

  it('starts new profiles on the starter quests, then offers one a day up to three', () => {
    const p = newProgress(T0);
    expect(p.quests.map((q) => q.id)).toEqual([...STARTER_QUESTS]);
    expect(offerDailyQuest(p, first, T0 + DAY_MS)).toBe(p);
    const two: Progress = { ...p, quests: p.quests.slice(0, 2) };
    const offered = offerDailyQuest(two, first, T0 + DAY_MS);
    expect(offered.quests).toHaveLength(3);
    expect(offerDailyQuest(offered, first, T0 + DAY_MS)).toBe(offered);
    expect(offerDailyQuest(two, first, T0)).toBe(two);
  });

  it('allows one reroll a UTC day', () => {
    const p = newProgress(T0);
    const rerolled = rerollQuest(p, 'finish2', first, T0);
    expect(rerolled?.quests.map((q) => q.id)).not.toContain('finish2');
    if (rerolled === null) throw new Error('reroll failed');
    expect(rerollQuest(rerolled, 'tasks5', first, T0)).toBeNull();
    expect(rerollQuest(rerolled, 'tasks5', first, T0 + DAY_MS)).not.toBeNull();
    expect(rerollQuest(p, 'notHeld', first, T0)).toBeNull();
  });
});

describe('the Epoch Road', () => {
  it('follows Bitcoin difficulty epochs and rotates six caps', () => {
    expect(epochOf(0)).toBe(0);
    expect(epochOf(EPOCH_BLOCKS - 1)).toBe(0);
    expect(epochOf(EPOCH_BLOCKS)).toBe(1);
    expect(epochTier(199)).toBe(0);
    expect(epochTier(200)).toBe(1);
    expect(epochTier(1_000_000)).toBe(10);
    expect(new Set(Array.from({ length: 12 }, (_, i) => epochHat(i))).size).toBe(EPOCH_HATS.length);
    for (const hat of EPOCH_HATS) expect(REWARD_IDS).toContain(hat);
  });

  it('starts over in a new epoch and never moves the stored epoch backwards', () => {
    let p = newProgress(T0);
    p = applyMatch(p, match(), player()).progress;
    expect(p.epoch.index).toBe(epochOf(HEIGHT));
    const later = applyMatch(p, match({ blockHeight: HEIGHT + EPOCH_BLOCKS }), player()).progress;
    expect(later.epoch.index).toBe(epochOf(HEIGHT) + 1);
    expect(later.epoch.xp).toBeLessThan(p.epoch.xp + 500);
    const reorg = applyMatch(later, match({ blockHeight: HEIGHT }), player()).progress;
    expect(reorg.epoch.index).toBe(later.epoch.index);
  });
});

describe('a new player’s first match', () => {
  it('earns XP, a rank, sats, the first seal with its robe, and quest progress', () => {
    const p = newProgress(T0);
    const { progress, award } = applyMatch(p, match(), player());
    expect(award.eligible).toBe(true);
    expect(award.lines.some((l) => l.reason === 'firstOfDay')).toBe(true);
    expect(award.seals).toContain('firstShift');
    expect(award.seals).toContain('allStations');
    expect(award.items).toContain('firstMatch');
    expect(award.items).toContain('honestWin');
    expect(award.rankBefore).toBe(1);
    expect(award.rankAfter).toBeGreaterThanOrEqual(2);
    expect(award.sats).toBeGreaterThanOrEqual(RANK_UP_SATS);
    expect(award.frames).toContain('copper');
    expect(award.quests.find((q) => q.id === 'finish2')?.progress).toBe(1);
    expect(award.questsDone).toEqual([]);
    expect(progress.counters.matchesFinished).toBe(1);
    expect(progress.counters.epochsPlayed).toBe(1);
    expect(progress.xp).toBe(award.xpAfter);
    expect(award.xpAfter - award.xpBefore).toBe(
      award.lines.reduce((a, l) => a + l.xp, 0) + award.seals.reduce((a, id) => a + SEAL_XP[SEALS.find((s) => s.id === id)?.frame ?? 'normal'], 0),
    );
    expect(ProgressSchema.safeParse(progress).success).toBe(true);
    expect(AwardSchema.safeParse(award).success).toBe(true);
    expect(ProgressViewSchema.safeParse(toProgressView(progress, T0)).success).toBe(true);
  });

  it('completes quests and pays them out', () => {
    let p = newProgress(T0);
    p = applyMatch(p, match(), player()).progress;
    const { award } = applyMatch(p, match({ matchId: 'match-0002' }), player());
    expect(award.questsDone.map((q) => q.id).sort()).toEqual(['finish2', 'tasks5']);
    expect(award.quests.map((q) => q.id)).toEqual(['academy1']);
  });

  it('moves only the station counters in practice, and no quests', () => {
    const { progress, award } = applyMatch(newProgress(T0), match({ humans: 2 }), player());
    expect(award.practice).toBe(true);
    expect(progress.counters.matchesFinished).toBeUndefined();
    expect(progress.counters.tasksLedger).toBe(1);
    expect(award.quests.find((q) => q.id === 'finish2')?.progress).toBe(0);
  });
});

describe('the Academy', () => {
  it('scores stars by mistakes and par time', () => {
    expect(starsFor(0, 30_000, 45_000)).toBe(3);
    expect(starsFor(0, 50_000, 45_000)).toBe(2);
    expect(starsFor(1, 10_000, 45_000)).toBe(2);
    expect(starsFor(2, 10_000, 45_000)).toBe(1);
  });

  it('rewards a level once, and three stars once, while replays only raise the best', () => {
    const p = newProgress(T0);
    const one = applyAcademyResult(p, 1, 2, T0, HEIGHT);
    // First clear, the academy1 starter quest, and the rank-up those bring.
    expect(one.award.sats).toBe(100 + 100 + RANK_UP_SATS);
    expect(one.progress.academy[0]).toBe(2);
    expect(one.award.seals).toContain('academy1');
    expect(one.award.questsDone.map((q) => q.id)).toContain('academy1');
    const three = applyAcademyResult(one.progress, 1, 3, T0, HEIGHT);
    expect(three.award.xpAfter - three.award.xpBefore).toBeGreaterThanOrEqual(50);
    expect(three.award.sats).toBe(0);
    const again = applyAcademyResult(three.progress, 1, 3, T0, HEIGHT);
    expect(again.award.xpAfter).toBe(again.award.xpBefore);
    expect(again.progress.counters.academyStars).toBe(3);
    expect(applyAcademyResult(p, 99, 3, T0, HEIGHT).award.eligible).toBe(false);
  });

  it('opens each level once the one before it is cleared', () => {
    const view = toProgressView(applyAcademyResult(newProgress(T0), 1, 1, T0, HEIGHT).progress, T0);
    expect(view.academy.map((a) => a.open)).toEqual([true, true, ...Array<boolean>(ACADEMY_LEVELS.length - 2).fill(false)]);
    expect(view.academy).toHaveLength(ACADEMY_LEVELS.length);
  });
});

describe('titles and frames', () => {
  it('can only choose what the player owns', () => {
    const p = newProgress(T0);
    expect(selectTitle(p, 'apprentice')?.title).toBe('apprentice');
    expect(selectTitle(p, 'scholar')).toBeNull();
    expect(selectFrame(p, 'copper')).toBeNull();
    const ranked = { ...p, xp: RANK_START[9] ?? 0 };
    expect(ownedFrames(ranked)).toEqual(['copper', 'silver']);
    expect(selectFrame(ranked, 'silver')?.frame).toBe('silver');
    expect(selectFrame(ranked, null)?.frame).toBeNull();
  });
});

describe('stored data', () => {
  it('pins every stored id', () => {
    expect([...COUNTER_IDS]).toMatchSnapshot();
    expect(SEALS.map((s) => s.id)).toMatchSnapshot();
    expect([...QUEST_IDS]).toMatchSnapshot();
    expect([...TITLE_IDS]).toMatchSnapshot();
  });

  it('rejects hostile stored progress', () => {
    const good = newProgress(T0);
    expect(ProgressSchema.safeParse(good).success).toBe(true);
    // Saved before newer Academy levels existed: padded with zeros rather than refused.
    const older = ProgressSchema.parse({ ...good, academy: [3, 2] });
    expect(older.academy).toEqual([3, 2, ...Array<number>(ACADEMY_LEVELS.length - 2).fill(0)]);
    for (const bad of [
      { ...good, xp: -1 },
      { ...good, xp: 1.5 },
      { ...good, extra: true },
      { ...good, seals: ['firstShift', 'firstShift'] },
      { ...good, seals: ['made-up'] },
      { ...good, quests: [...good.quests, { id: 'win1', progress: 0 }] },
      { ...good, counters: JSON.parse('{"__proto__":5}') as unknown },
      { ...good, counters: { matchesFinished: -1 } },
      { ...good, academy: [] },
      { ...good, academy: Array<number>(99).fill(0) },
      { ...good, academy: [4] },
      { ...good, title: 'emperor' },
      { ...good, v: 2 },
    ]) {
      expect(ProgressSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('the archipelago', () => {
  it('opens Mint Island from the start and later islands by rank or by Academy stars', async () => {
    const { ISLANDS, islandOpen } = await import('../../src/progression/world.js');
    const mint = ISLANDS[0];
    const signing = ISLANDS.find((i) => i.id === 'signing');
    if (mint === undefined || signing === undefined) throw new Error('missing islands');
    expect(islandOpen(mint, 1, 0)).toBe(true);
    expect(islandOpen(signing, 1, 0)).toBe(false);
    expect(islandOpen(signing, signing.rank, 0)).toBe(true);
    expect(islandOpen(signing, 1, signing.stars)).toBe(true);
    expect(new Set(ISLANDS.map((i) => i.id)).size).toBe(ISLANDS.length);
  });
});
