// Match XP: what each guardian earned in one match, computed by the server from its own record.
import type { ArenaId } from '../arena.js';
import type { Role } from '../types.js';
import type { TaskKind } from '../tasks.js';
import type { Side, WinReason } from '../win.js';

export const SEASON_EVENTS = ['halving', 'genesisDay', 'pizzaDay', 'whitepaperDay'] as const;
export type SeasonEvent = (typeof SEASON_EVENTS)[number];

export interface MatchFacts {
  readonly matchId: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  // Guardians dealt at the start, and how many of them were people rather than bots.
  readonly players: number;
  readonly humans: number;
  readonly privateRoom: boolean;
  readonly winner: Side;
  readonly reason: WinReason;
  readonly blockHeight: number;
  readonly events: readonly SeasonEvent[];
  // Where the match was played; absent means the Citadel (facts from before arenas existed).
  readonly arena?: ArenaId;
}

export interface PlayerFacts {
  readonly role: Role;
  // Seated at the end; a reconnect counts.
  readonly finished: boolean;
  readonly afkKicked: boolean;
  readonly movedTiles: number;
  readonly tasks: Readonly<Record<TaskKind, number>>;
  readonly legitSigned: number;
  readonly forgedRefused: number;
  readonly forgedSigned: number;
  // Byzantine: honest signatures on forged withdrawals this player's team filed.
  readonly forgedSignaturesGathered: number;
  // Honest: council votes cast for a Byzantine.
  readonly byzantineVotes: number;
  // Byzantine: honest guardians rotated out.
  readonly misdirections: number;
  readonly partitionsRepaired: number;
  readonly partitionsRunOut: number;
  readonly rotatedOut: boolean;
}

export const XP_REASONS = [
  'finished',
  'won',
  'tasks',
  'signedReal',
  'refusedForgery',
  'votedByzantine',
  'repairedPartition',
  'gatheredSignatures',
  'misdirection',
  'partitionRanOut',
  'firstOfDay',
] as const;
export type XpReason = (typeof XP_REASONS)[number];

export interface XpLine {
  readonly reason: XpReason;
  readonly xp: number;
}

export const XP = Object.freeze({
  finished: 40,
  won: 60,
  task: 8,
  signedReal: 5,
  refusedForgery: 15,
  votedByzantine: 15,
  repairedPartition: 10,
  gatheredSignatures: 5,
  misdirection: 15,
  partitionRanOut: 10,
  firstOfDay: 50,
  perMatchCap: 300,
  dailySoftCap: 1500,
  // Percent counted past the daily soft cap.
  pastCapPercent: 25,
  practicePercent: 50,
  practiceDailyCap: 300,
  // The duration factor counts a match from a quarter (75 s or less) to full (5 minutes or more).
  fullMatchMs: 300_000,
  minMatchMs: 75_000,
  firstOfDayMinMs: 120_000,
  // Walking this far, or one action, makes a player active.
  activeTiles: 10,
});

const CAPS = Object.freeze({ tasks: 4, signedReal: 3, refusedForgery: 3, votedByzantine: 3, repairedPartition: 2, gatheredSignatures: 3, misdirection: 2, partitionRanOut: 2 });

export const DAY_MS = 86_400_000;
export function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

// Today's XP so far, for the daily caps and the first-match bonus.
export interface DayState {
  readonly index: number;
  readonly matchXp: number;
  readonly practiceXp: number;
  readonly firstBonus: boolean;
  // Courier deliveries paid today in Beach Town.
  readonly courier?: number;
  // Play sats carried into the Mint vault today in Port Concord.
  readonly vault?: number;
}

export type Ineligible = 'left' | 'afk' | 'idle';

export interface MatchXp {
  readonly eligible: boolean;
  readonly ineligible?: Ineligible;
  readonly practice: boolean;
  readonly lines: readonly XpLine[];
  readonly total: number;
  readonly day: DayState;
}

function count(n: number, cap: number): number {
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, cap) : 0;
}

export function totalTasks(p: PlayerFacts): number {
  return Object.values(p.tasks).reduce((a, b) => a + count(b, 99), 0);
}

function actions(p: PlayerFacts): number {
  return totalTasks(p) + p.legitSigned + p.forgedRefused + p.forgedSigned + p.byzantineVotes + p.partitionsRepaired;
}

export function isPractice(m: MatchFacts): boolean {
  return m.humans < m.players;
}

export function isActive(p: PlayerFacts): boolean {
  return p.movedTiles >= XP.activeTiles || actions(p) > 0;
}

// Today's state, rolled over to a new UTC day when needed.
export function dayFor(day: DayState, nowMs: number): DayState {
  const index = utcDay(nowMs);
  return day.index === index ? day : { index, matchXp: 0, practiceXp: 0, firstBonus: false };
}

export function computeMatchXp(m: MatchFacts, p: PlayerFacts, previous: DayState): MatchXp {
  const day = dayFor(previous, m.endedAtMs);
  const practice = isPractice(m);
  const ineligible: Ineligible | null = !p.finished ? 'left' : p.afkKicked ? 'afk' : !isActive(p) ? 'idle' : null;
  if (ineligible !== null) return { eligible: false, ineligible, practice, lines: [], total: 0, day };

  const honest = p.role === 'honest';
  const won = p.role === m.winner;
  const raw: XpLine[] = [
    { reason: 'finished', xp: XP.finished },
    { reason: 'won', xp: won ? XP.won : 0 },
    { reason: 'tasks', xp: XP.task * count(totalTasks(p), CAPS.tasks) },
    { reason: 'signedReal', xp: honest ? XP.signedReal * count(p.legitSigned, CAPS.signedReal) : 0 },
    { reason: 'refusedForgery', xp: honest ? XP.refusedForgery * count(p.forgedRefused, CAPS.refusedForgery) : 0 },
    { reason: 'votedByzantine', xp: honest ? XP.votedByzantine * count(p.byzantineVotes, CAPS.votedByzantine) : 0 },
    { reason: 'repairedPartition', xp: XP.repairedPartition * count(p.partitionsRepaired, CAPS.repairedPartition) },
    { reason: 'gatheredSignatures', xp: honest ? 0 : XP.gatheredSignatures * count(p.forgedSignaturesGathered, CAPS.gatheredSignatures) },
    { reason: 'misdirection', xp: honest ? 0 : XP.misdirection * count(p.misdirections, CAPS.misdirection) },
    { reason: 'partitionRanOut', xp: honest ? 0 : XP.partitionRanOut * count(p.partitionsRunOut, CAPS.partitionRanOut) },
  ];
  // Duration factor, per-match cap, then the daily soft cap or the practice cap, in integer maths.
  const duration = Math.min(XP.fullMatchMs, Math.max(XP.minMatchMs, Math.max(0, m.endedAtMs - m.startedAtMs)));
  const scale = (xp: number): number => Math.floor((xp * duration) / XP.fullMatchMs);
  let lines = raw.filter((l) => l.xp > 0).map((l) => ({ reason: l.reason, xp: scale(l.xp) }));
  let subtotal = lines.reduce((a, l) => a + l.xp, 0);
  if (subtotal > XP.perMatchCap) {
    lines = shrink(lines, XP.perMatchCap);
    subtotal = XP.perMatchCap;
  }
  let allowed: number;
  if (practice) {
    const half = Math.floor((subtotal * XP.practicePercent) / 100);
    allowed = Math.max(0, Math.min(half, XP.practiceDailyCap - day.practiceXp));
  } else {
    const full = Math.max(0, Math.min(subtotal, XP.dailySoftCap - day.matchXp));
    allowed = full + Math.floor(((subtotal - full) * XP.pastCapPercent) / 100);
  }
  if (allowed < subtotal) lines = shrink(lines, allowed);
  const matchXp = lines.reduce((a, l) => a + l.xp, 0);
  const bonus = !practice && !day.firstBonus && m.endedAtMs - m.startedAtMs >= XP.firstOfDayMinMs;
  if (bonus) lines = [...lines, { reason: 'firstOfDay', xp: XP.firstOfDay }];
  // Spread first: other daily tallies (Beach Town deliveries) must survive a match.
  const next: DayState = {
    ...day,
    index: day.index,
    matchXp: practice ? day.matchXp : day.matchXp + matchXp,
    practiceXp: practice ? day.practiceXp + matchXp : day.practiceXp,
    firstBonus: day.firstBonus || bonus,
  };
  return { eligible: true, practice, lines, total: matchXp + (bonus ? XP.firstOfDay : 0), day: next };
}

// Scales lines down to a total, keeping integers and dropping lines that reach zero.
function shrink(lines: readonly XpLine[], target: number): XpLine[] {
  const total = lines.reduce((a, l) => a + l.xp, 0);
  if (total <= target) return [...lines];
  const scaled = lines.map((l) => ({ reason: l.reason, xp: Math.floor((l.xp * target) / total) }));
  let short = target - scaled.reduce((a, l) => a + l.xp, 0);
  for (const l of scaled) {
    if (short <= 0) break;
    l.xp += 1;
    short -= 1;
  }
  return scaled.filter((l) => l.xp > 0);
}
