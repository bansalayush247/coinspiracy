// Quests: up to three held at once, never expiring; one new one a day, one free reroll a day.
// None rewards disruptive play, and none needs a particular role. Ids are stored, so never rename one.
import type { RandomSource } from '../roles.js';
import { totalTasks, type MatchFacts, type PlayerFacts } from './award.js';

export const MAX_QUESTS = 3;

export type QuestEvent =
  | { readonly kind: 'match'; readonly match: MatchFacts; readonly player: PlayerFacts }
  | { readonly kind: 'academy'; readonly firstClear: boolean; readonly newStars: number };

export interface QuestTemplate {
  readonly id: string;
  readonly text: string;
  readonly target: number;
  readonly minRank: number;
  readonly xp: number;
  readonly sats: number;
  // Progress one event adds.
  readonly step: (e: QuestEvent) => number;
}

function fromMatch(f: (m: MatchFacts, p: PlayerFacts) => number): (e: QuestEvent) => number {
  return (e) => (e.kind === 'match' ? Math.max(0, f(e.match, e.player)) : 0);
}

const won = (m: MatchFacts, p: PlayerFacts): boolean => m.winner === p.role;

export const QUESTS: readonly QuestTemplate[] = Object.freeze([
  { id: 'finish2', text: 'Finish 2 matches', target: 2, minRank: 1, xp: 60, sats: 100, step: fromMatch(() => 1) },
  { id: 'tasks5', text: 'Complete 5 tasks at any station', target: 5, minRank: 1, xp: 60, sats: 100, step: fromMatch((_, p) => totalTasks(p)) },
  { id: 'deposit3', text: 'Blind-sign 3 deposits at the Deposit Gate', target: 3, minRank: 1, xp: 60, sats: 120, step: fromMatch((_, p) => p.tasks.deposit) },
  { id: 'ledger3', text: 'Check the notes 3 times at the Ledger Archive', target: 3, minRank: 1, xp: 60, sats: 120, step: fromMatch((_, p) => p.tasks.ledger) },
  { id: 'route3', text: 'Route 3 Lightning payments at the Gateway Dock', target: 3, minRank: 1, xp: 60, sats: 120, step: fromMatch((_, p) => p.tasks.route) },
  { id: 'watch3', text: 'Confirm the block height 3 times at the Watchtower', target: 3, minRank: 1, xp: 60, sats: 120, step: fromMatch((_, p) => p.tasks.watchtower) },
  { id: 'win1', text: 'Win a match', target: 1, minRank: 1, xp: 80, sats: 150, step: fromMatch((m, p) => (won(m, p) ? 1 : 0)) },
  { id: 'big1', text: 'Finish a match with 7 or more guardians', target: 1, minRank: 1, xp: 60, sats: 100, step: fromMatch((m) => (m.players >= 7 ? 1 : 0)) },
  { id: 'friends1', text: 'Finish a match in an invite room', target: 1, minRank: 1, xp: 80, sats: 150, step: fromMatch((m) => (m.privateRoom ? 1 : 0)) },
  { id: 'academy1', text: 'Clear an Academy level for the first time', target: 1, minRank: 1, xp: 60, sats: 100, step: (e) => (e.kind === 'academy' && e.firstClear ? 1 : 0) },
  { id: 'stars3', text: 'Earn 3 Academy stars', target: 3, minRank: 1, xp: 60, sats: 100, step: (e) => (e.kind === 'academy' ? e.newStars : 0) },
  { id: 'sign2', text: 'Sign 2 real withdrawals', target: 2, minRank: 2, xp: 60, sats: 100, step: fromMatch((_, p) => (p.role === 'honest' ? p.legitSigned : 0)) },
  { id: 'refuse1', text: 'Refuse a forged withdrawal', target: 1, minRank: 2, xp: 80, sats: 150, step: fromMatch((_, p) => (p.role === 'honest' ? p.forgedRefused : 0)) },
  { id: 'allFour', text: 'Complete all four stations in one match', target: 1, minRank: 2, xp: 100, sats: 200, step: fromMatch((_, p) => (Object.values(p.tasks).every((n) => n > 0) ? 1 : 0)) },
  { id: 'vote1', text: 'Vote for a Byzantine guardian in a council', target: 1, minRank: 3, xp: 80, sats: 150, step: fromMatch((_, p) => (p.role === 'honest' ? p.byzantineVotes : 0)) },
  { id: 'mend1', text: 'Help repair a partition', target: 1, minRank: 3, xp: 80, sats: 150, step: fromMatch((_, p) => p.partitionsRepaired) },
]);
export const QUEST_IDS: readonly string[] = Object.freeze(QUESTS.map((q) => q.id));
export const STARTER_QUESTS: readonly string[] = Object.freeze(['academy1', 'tasks5', 'finish2']);
const BY_ID: ReadonlyMap<string, QuestTemplate> = new Map(QUESTS.map((q) => [q.id, q]));

export function questById(id: string): QuestTemplate | undefined {
  return BY_ID.get(id);
}

export interface Quest {
  readonly id: string;
  readonly progress: number;
}

// A quest the player does not hold yet and is ranked for, chosen uniformly.
export function drawQuest(rng: RandomSource, held: readonly string[], rank: number): string | null {
  const open = QUESTS.filter((q) => q.minRank <= rank && !held.includes(q.id));
  if (open.length === 0) return null;
  return open[rng.int(open.length)]?.id ?? null;
}
