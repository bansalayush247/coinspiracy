// Council meetings: where they are called, how long they last, and who may call one.
import type { Vec2 } from './map.js';

export interface CouncilTiming {
  // No council in the opening of a match, so everyone gets to move first.
  readonly openingMs: number;
  // Voting and quick-chat discussion; ends early once every member has voted.
  readonly votingMs: number;
  // The ballots stay on screen this long before play resumes.
  readonly resultMs: number;
  // Gap after one council ends before the next can be called.
  readonly cooldownMs: number;
  // Councils each guardian may call in one match.
  readonly perPlayer: number;
  // Quick-chat lines each guardian may send in one council, and the gap between them.
  readonly chatPerCouncil: number;
  readonly chatGapMs: number;
}

export const COUNCIL_TIMING: CouncilTiming = Object.freeze({
  openingMs: 20_000,
  votingMs: 60_000,
  resultMs: 7_000,
  cooldownMs: 30_000,
  perPlayer: 1,
  chatPerCouncil: 20,
  chatGapMs: 1_200,
});

// The great seal in the middle of the plaza, ringed by the spawn points.
export const COUNCIL_SEAL: Vec2 = Object.freeze({ x: 15, y: 15 });
export const COUNCIL_SEAL_RANGE = 3;

export function atCouncilSeal(pos: Vec2): boolean {
  return Math.hypot(pos.x - COUNCIL_SEAL.x, pos.y - COUNCIL_SEAL.y) <= COUNCIL_SEAL_RANGE;
}

export const COUNCIL_STAGES = ['', 'voting', 'result'] as const;
export type CouncilStage = (typeof COUNCIL_STAGES)[number];
