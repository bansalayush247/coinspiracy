// Academy: solo levels the server runs, each teaching one station, scored out of three stars.
// Level numbers are stored and append-only.
import type { TaskKind } from '../tasks.js';

export interface AcademyLevel {
  readonly level: number;
  readonly name: string;
  readonly drills: readonly TaskKind[];
  readonly parMs: number;
  readonly teaches: string;
  readonly intro: string;
  // Codex page on the site, relative to its learn section.
  readonly codex: string;
}

export const ACADEMY_LEVELS: readonly AcademyLevel[] = Object.freeze([
  {
    level: 1,
    name: 'Deposit Gate',
    drills: ['deposit', 'deposit'],
    parMs: 45_000,
    teaches: 'Blind signatures and power-of-two notes',
    intro: 'Fedimint splits every amount into power-of-two notes, then has the guardians sign them blinded, so no guardian can tell which notes are yours.',
    codex: 'ecash-blind-signatures',
  },
  {
    level: 2,
    name: 'Ledger Archive',
    drills: ['ledger', 'ledger'],
    parMs: 50_000,
    teaches: 'Double-spends and invalid signatures',
    intro: 'A note is only good if the federation signed it and it was never spent before. Spot the forged seal and the note spent twice.',
    codex: 'double-spending',
  },
  {
    level: 3,
    name: 'Gateway Dock',
    drills: ['route', 'route'],
    parMs: 40_000,
    teaches: 'Lightning routing and channel liquidity',
    intro: 'Gateways pay out over Lightning. A payment only gets through if every channel on its route can carry the whole amount.',
    codex: 'lightning-gateways',
  },
  {
    level: 4,
    name: 'Watchtower',
    drills: ['watchtower', 'watchtower'],
    parMs: 35_000,
    teaches: 'Block height and the median of reports',
    intro: 'Guardians agree on the Bitcoin block height by taking the median of everyone’s report, so a few faulty reports cannot move it.',
    codex: 'block-height-consensus',
  },
  {
    level: 5,
    name: 'Night Shift',
    drills: ['deposit', 'ledger', 'route', 'watchtower'],
    parMs: 120_000,
    teaches: 'Putting it all together',
    intro: 'One of each station, in a random order. Work steadily: a careful guardian beats a fast one.',
    codex: 'federations-and-guardians',
  },
  {
    level: 6,
    name: 'Reef Currents',
    drills: ['route', 'route', 'route'],
    parMs: 50_000,
    teaches: 'Routing under pressure on Lightning Reef',
    intro: 'Three payments, one after another. Read each channel’s balance on the sending side: a route is only as strong as its weakest link.',
    codex: 'lightning-gateways',
  },
  {
    level: 7,
    name: 'Gateway Rush',
    drills: ['deposit', 'route', 'deposit', 'route'],
    parMs: 90_000,
    teaches: 'Ecash in, Lightning out',
    intro: 'A busy evening at the gateway: mint notes for incoming deposits, then route the outgoing payments. Alternate calmly between the two.',
    codex: 'lightning-gateways',
  },
]);
export const ACADEMY_MAX_STARS = 3;
export const ACADEMY_TOTAL_STARS = ACADEMY_LEVELS.length * ACADEMY_MAX_STARS;
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

// One star for clearing, two for at most one mistake, three for no mistakes within par.
export function starsFor(mistakes: number, timeMs: number, parMs: number): number {
  if (mistakes === 0 && timeMs <= parMs) return 3;
  if (mistakes <= 1) return 2;
  return 1;
}
