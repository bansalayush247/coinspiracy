// Academy: solo levels the server runs, each teaching one idea, scored out of three stars.
// Level numbers are stored and append-only. Each level belongs to an island and opens with it.
import type { DrillKind } from '../drills.js';
import { islandOpenFor } from './world.js';

export interface AcademyLevel {
  readonly level: number;
  // The island on the world map this level teaches.
  readonly island: string;
  readonly name: string;
  readonly drills: readonly DrillKind[];
  readonly parMs: number;
  readonly teaches: string;
  readonly intro: string;
  // Codex page on the site, relative to its learn section.
  readonly codex: string;
}

export const ACADEMY_LEVELS: readonly AcademyLevel[] = Object.freeze([
  {
    level: 1,
    island: 'mint',
    name: 'Deposit Gate',
    drills: ['deposit', 'deposit'],
    parMs: 45_000,
    teaches: 'Blind signatures and power-of-two notes',
    intro: 'Fedimint splits every amount into power-of-two notes, then has the guardians sign them blinded, so no guardian can tell which notes are yours.',
    codex: 'ecash-blind-signatures',
  },
  {
    level: 2,
    island: 'mint',
    name: 'Ledger Archive',
    drills: ['ledger', 'ledger'],
    parMs: 50_000,
    teaches: 'Double-spends and invalid signatures',
    intro: 'A note is only good if the federation signed it and it was never spent before. Spot the forged seal and the note spent twice.',
    codex: 'double-spending',
  },
  {
    level: 3,
    island: 'mint',
    name: 'Gateway Dock',
    drills: ['route', 'route'],
    parMs: 40_000,
    teaches: 'Lightning routing and channel liquidity',
    intro: 'Gateways pay out over Lightning. A payment only gets through if every channel on its route can carry the whole amount.',
    codex: 'lightning-gateways',
  },
  {
    level: 4,
    island: 'mint',
    name: 'Watchtower',
    drills: ['watchtower', 'watchtower'],
    parMs: 35_000,
    teaches: 'Block height and the median of reports',
    intro: 'Guardians agree on the Bitcoin block height by taking the median of everyone’s report, so a few faulty reports cannot move it.',
    codex: 'block-height-consensus',
  },
  {
    level: 5,
    island: 'mint',
    name: 'Night Shift',
    drills: ['deposit', 'ledger', 'route', 'watchtower'],
    parMs: 120_000,
    teaches: 'Putting it all together',
    intro: 'One of each station, in a random order. Work steadily: a careful guardian beats a fast one.',
    codex: 'federations-and-guardians',
  },
  {
    level: 6,
    island: 'reef',
    name: 'Reef Currents',
    drills: ['route', 'route', 'route'],
    parMs: 50_000,
    teaches: 'Routing under pressure on Lightning Reef',
    intro: 'Three payments, one after another. Read each channel’s balance on the sending side: a route is only as strong as its weakest link.',
    codex: 'lightning-gateways',
  },
  {
    level: 7,
    island: 'reef',
    name: 'Gateway Rush',
    drills: ['deposit', 'route', 'deposit', 'route'],
    parMs: 90_000,
    teaches: 'Ecash in, Lightning out',
    intro: 'A busy evening at the gateway: mint notes for incoming deposits, then route the outgoing payments. Alternate calmly between the two.',
    codex: 'lightning-gateways',
  },
  {
    level: 8,
    island: 'signing',
    name: 'Threshold Hall',
    drills: ['threshold', 'threshold', 'threshold'],
    parMs: 40_000,
    teaches: 'How many signatures a withdrawal needs',
    intro: 'A federation of n guardians can survive f faulty ones, where n is at least 3f + 1. A withdrawal needs n − f signatures: enough that the faulty ones can never pass it alone, and few enough that the honest ones always can.',
    codex: 'threshold-signatures',
  },
  {
    level: 9,
    island: 'signing',
    name: 'Audit Desk',
    drills: ['threshold', 'ledger', 'threshold', 'ledger'],
    parMs: 90_000,
    teaches: 'Thresholds and checking before you sign',
    intro: 'A signature is a promise. Work out how many signatures each federation needs, and check the notes at the desk before you add yours.',
    codex: 'threshold-signatures',
  },
  {
    level: 10,
    island: 'council',
    name: 'One-Third Rule',
    drills: ['quorum', 'quorum', 'quorum'],
    parMs: 45_000,
    teaches: 'Why every honest key lost matters',
    intro: 'The federation halts once Byzantine guardians are a third or more of the active ones. Rotating out an honest guardian by mistake brings that day closer. How many mistakes can the federation survive?',
    codex: 'one-third-rule',
  },
  {
    level: 11,
    island: 'council',
    name: 'Council Evidence',
    drills: ['council', 'council', 'quorum', 'council'],
    parMs: 100_000,
    teaches: 'Voting on evidence, not on hunches',
    intro: 'A forgery was filed from the Signing Hall. Rotate out the guardian the evidence proves: seen in the hall and signing the forgery. If nobody did both, skip the vote rather than lose an honest key.',
    codex: 'byzantine-fault-tolerance',
  },
  {
    level: 12,
    island: 'watchtower',
    name: 'Split Network',
    drills: ['partition', 'partition', 'partition'],
    parMs: 45_000,
    teaches: 'Consensus across a network partition',
    intro: 'A partition splits the guardians into groups that cannot hear each other. A group can only sign if it alone reaches the threshold, so most splits stop the federation until the link is repaired.',
    codex: 'network-partitions',
  },
  {
    level: 13,
    island: 'watchtower',
    name: 'Night Watch',
    drills: ['partition', 'watchtower', 'partition', 'watchtower'],
    parMs: 80_000,
    teaches: 'Keeping watch over a split network',
    intro: 'A long night on the peaks: judge which side of each split can still sign, and agree on the block height between the outages.',
    codex: 'network-partitions',
  },
]);
export const ACADEMY_MAX_STARS = 3;
// Rewards for a level, once each.
export const ACADEMY_FIRST_CLEAR = Object.freeze({ xp: 50, sats: 100 });
export const ACADEMY_THREE_STARS = Object.freeze({ xp: 50 });
// Lockout after a wrong answer in the Academy, shorter than in matches since this is for learning.
export const ACADEMY_RETRY_MS = 1500;
export const ACADEMY_DRILL_EXPIRE_MS = 120_000;
export const ACADEMY_LEVEL_LIMIT_MS = 600_000;

export function academyLevel(level: number): AcademyLevel | undefined {
  return ACADEMY_LEVELS.find((l) => l.level === level);
}

// A level is open once the level before it on the same island is cleared; an island's first level opens
// with the island itself (by rank or stars). A level already cleared never locks again.
export function academyLevelOpen(level: number, xp: number, academy: readonly number[]): boolean {
  const index = ACADEMY_LEVELS.findIndex((l) => l.level === level);
  const def = ACADEMY_LEVELS[index];
  if (def === undefined) return false;
  if ((academy[index] ?? 0) > 0) return true;
  const earlier = ACADEMY_LEVELS.slice(0, index).filter((l) => l.island === def.island);
  const previous = earlier.at(-1);
  if (previous !== undefined) return (academy[ACADEMY_LEVELS.indexOf(previous)] ?? 0) > 0;
  return def.island === 'mint' || islandOpenFor(def.island, xp, academy);
}

// One star for clearing, two for at most one mistake, three for no mistakes within par.
export function starsFor(mistakes: number, timeMs: number, parMs: number): number {
  if (mistakes === 0 && timeMs <= parMs) return 3;
  if (mistakes <= 1) return 2;
  return 1;
}
