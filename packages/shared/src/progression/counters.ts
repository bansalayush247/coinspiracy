// Lifetime counters per profile; seals and quests read them. Ids are stored, so never rename one.
import { TASK_KINDS } from '../tasks.js';
import { isPractice, totalTasks, type MatchFacts, type PlayerFacts } from './award.js';

export const COUNTER_IDS = [
  'matchesFinished',
  'bigMatches',
  'fullMatches',
  'privateMatches',
  'wins',
  'honestWins',
  'byzantineWins',
  'consensusWins',
  'rotationWins',
  'haltWins',
  'forgeWins',
  'tasksDeposit',
  'tasksLedger',
  'tasksRoute',
  'tasksWatchtower',
  'legitSigned',
  'forgedRefused',
  'byzantineVotes',
  'partitionsRepaired',
  'misdirections',
  'epochsPlayed',
  'eventGenesisDay',
  'eventPizzaDay',
  'eventWhitepaperDay',
  'eventHalving',
  'academyClears',
  'academyStars',
  'courierDeliveries',
] as const;
export type CounterId = (typeof COUNTER_IDS)[number];
export type Counters = Readonly<Partial<Record<CounterId, number>>>;

// Counters stop here; far beyond any seal, and safe from overflow.
export const COUNTER_MAX = 1_000_000;

const TASK_COUNTER = { deposit: 'tasksDeposit', ledger: 'tasksLedger', route: 'tasksRoute', watchtower: 'tasksWatchtower' } as const;

function small(n: number, cap = 9): number {
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, cap) : 0;
}

// What one eligible match adds. Practice matches move only the station counters.
export function matchCounters(m: MatchFacts, p: PlayerFacts, newEpoch: boolean): Counters {
  const delta: Partial<Record<CounterId, number>> = {};
  for (const kind of TASK_KINDS) delta[TASK_COUNTER[kind]] = small(p.tasks[kind]);
  if (isPractice(m)) return delta;
  const won = p.role === m.winner;
  Object.assign(delta, {
    matchesFinished: 1,
    bigMatches: m.players >= 7 ? 1 : 0,
    fullMatches: m.players >= 9 ? 1 : 0,
    privateMatches: m.privateRoom ? 1 : 0,
    wins: won ? 1 : 0,
    honestWins: won && p.role === 'honest' ? 1 : 0,
    byzantineWins: won && p.role === 'byzantine' ? 1 : 0,
    consensusWins: won && m.reason === 'consensusReached' ? 1 : 0,
    rotationWins: won && m.reason === 'allByzantineRotatedOut' ? 1 : 0,
    haltWins: won && m.reason === 'federationHalted' ? 1 : 0,
    forgeWins: won && m.reason === 'forgedProposalPassed' ? 1 : 0,
    legitSigned: p.role === 'honest' ? small(p.legitSigned) : 0,
    forgedRefused: p.role === 'honest' ? small(p.forgedRefused) : 0,
    byzantineVotes: p.role === 'honest' ? small(p.byzantineVotes) : 0,
    partitionsRepaired: small(p.partitionsRepaired),
    misdirections: p.role === 'byzantine' ? small(p.misdirections) : 0,
    epochsPlayed: newEpoch ? 1 : 0,
    eventGenesisDay: m.events.includes('genesisDay') ? 1 : 0,
    eventPizzaDay: m.events.includes('pizzaDay') ? 1 : 0,
    eventWhitepaperDay: m.events.includes('whitepaperDay') ? 1 : 0,
    eventHalving: m.events.includes('halving') ? 1 : 0,
  });
  return delta;
}

export function addCounters(base: Counters, delta: Counters): Counters {
  const next: Partial<Record<CounterId, number>> = { ...base };
  for (const id of COUNTER_IDS) {
    const d = delta[id] ?? 0;
    if (d > 0) next[id] = Math.min(COUNTER_MAX, (base[id] ?? 0) + d);
  }
  return next;
}

export { totalTasks };
