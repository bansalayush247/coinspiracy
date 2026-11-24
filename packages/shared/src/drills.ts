// Academy-only drills for the islands whose ideas are not station tasks: thresholds (Signing Isle),
// the one-third rule and council evidence (Council Isle), and network splits (Watchtower Peaks).
// Like task minigames, every answer is derivable from its challenge, so the server keeps only the challenge.
import { z } from 'zod';
import { isHalted, threshold } from './federation.js';
import { TaskAnswerSchema, TaskChallengeSchema, checkAnswer, generateChallenge, solveChallenge, type TaskContext } from './minigames.js';
import type { RandomSource } from './roles.js';
import { TASK_KINDS, type TaskKind } from './tasks.js';

export const ISLAND_DRILL_KINDS = ['threshold', 'quorum', 'council', 'partition'] as const;
export type IslandDrillKind = (typeof ISLAND_DRILL_KINDS)[number];
export type DrillKind = TaskKind | IslandDrillKind;

// Federation sizes the drills use: large enough to be interesting, small enough to count on a screen.
export const DRILL_MIN_GUARDIANS = 4;
export const DRILL_MAX_GUARDIANS = 13;
// Council evidence: guardians in the story, and the names they go by.
export const COUNCIL_MIN = 5;
export const COUNCIL_MAX = 7;
export const COUNCIL_NAMES = Object.freeze(['Ash', 'Birch', 'Cedar', 'Dune', 'Elm', 'Fern', 'Gale'] as const);

const Guardians = z.number().int().min(DRILL_MIN_GUARDIANS).max(DRILL_MAX_GUARDIANS);
const Seat = z.number().int().min(0).max(COUNCIL_MAX - 1);

export const ThresholdChallengeSchema = z.strictObject({ kind: z.literal('threshold'), guardians: Guardians });
export const QuorumChallengeSchema = z.strictObject({ kind: z.literal('quorum'), guardians: Guardians, byzantine: z.number().int().min(1).max(4) });
export const CouncilChallengeSchema = z.strictObject({
  kind: z.literal('council'),
  guardians: z.number().int().min(COUNCIL_MIN).max(COUNCIL_MAX),
  // The forged withdrawal's number, for the story.
  forgery: z.number().int().min(1).max(99),
  // Seen in the Signing Hall when the forgery was filed.
  inHall: z.array(Seat).max(COUNCIL_MAX),
  // Signed the forged withdrawal.
  signed: z.array(Seat).max(COUNCIL_MAX),
});
export const PartitionChallengeSchema = z.strictObject({
  kind: z.literal('partition'),
  guardians: Guardians,
  // Guardians on each side of the split, in order; they add up to the federation.
  sides: z.array(z.number().int().min(1).max(DRILL_MAX_GUARDIANS)).min(2).max(3),
});

export const DrillChallengeSchema = z.union([TaskChallengeSchema, ThresholdChallengeSchema, QuorumChallengeSchema, CouncilChallengeSchema, PartitionChallengeSchema]);
export type ThresholdChallenge = z.infer<typeof ThresholdChallengeSchema>;
export type QuorumChallenge = z.infer<typeof QuorumChallengeSchema>;
export type CouncilChallenge = z.infer<typeof CouncilChallengeSchema>;
export type PartitionChallenge = z.infer<typeof PartitionChallengeSchema>;
export type DrillChallenge = z.infer<typeof DrillChallengeSchema>;

export const DrillAnswerSchema = z.union([
  TaskAnswerSchema,
  z.strictObject({ kind: z.literal('threshold'), signatures: z.number().int().min(1).max(DRILL_MAX_GUARDIANS) }),
  z.strictObject({ kind: z.literal('quorum'), rotations: z.number().int().min(0).max(DRILL_MAX_GUARDIANS) }),
  // -1 skips the vote.
  z.strictObject({ kind: z.literal('council'), suspect: z.number().int().min(-1).max(COUNCIL_MAX - 1) }),
  // -1 means no side can sign.
  z.strictObject({ kind: z.literal('partition'), side: z.number().int().min(-1).max(2) }),
]);
export type DrillAnswer = z.infer<typeof DrillAnswerSchema>;

export function isTaskKind(kind: DrillKind): kind is TaskKind {
  return (TASK_KINDS as readonly string[]).includes(kind);
}

function between(rng: RandomSource, min: number, max: number): number {
  return min + rng.int(max - min + 1);
}

function shuffled<T>(items: readonly T[], rng: RandomSource): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) throw new RangeError('RandomSource out of range');
    out[i] = b;
    out[j] = a;
  }
  return out;
}

// Honest guardians that can be rotated out by mistake before Byzantines reach a third and the federation halts.
export function safeRotations(guardians: number, byzantine: number): number {
  let k = 0;
  while (guardians - k - 1 > byzantine && !isHalted(byzantine, guardians - k - 1)) k += 1;
  return k;
}

// The side that can still reach the threshold on its own, or -1 when none can.
export function signingSide(guardians: number, sides: readonly number[]): number {
  const t = threshold(guardians);
  return sides.findIndex((s) => s >= t);
}

// The guardian both seen in the hall and signing the forgery, if exactly one is; -1 means skip the vote.
export function councilSuspect(c: CouncilChallenge): number {
  const both = c.inHall.filter((s) => c.signed.includes(s));
  return both.length === 1 ? (both[0] ?? -1) : -1;
}

function generateQuorum(rng: RandomSource): QuorumChallenge {
  const guardians = between(rng, 5, DRILL_MAX_GUARDIANS);
  // Fewer than a third are Byzantine at the start, so the federation is running.
  const byzantine = between(rng, 1, Math.min(4, Math.floor((guardians - 1) / 3)));
  return { kind: 'quorum', guardians, byzantine };
}

// Half the splits leave one side with enough signers; the rest leave nobody able to sign. Every range
// below is non-empty for 5 to 10 guardians, since the threshold is more than two thirds of them.
function generatePartition(rng: RandomSource): PartitionChallenge {
  const guardians = between(rng, 5, 10);
  const t = threshold(guardians);
  // 0-1: one side can sign; 2: two sides, both short; 3: three sides, all short.
  const shape = rng.int(4);
  let sides: number[];
  if (shape < 2) {
    const big = between(rng, t, guardians - 1);
    const rest = guardians - big;
    if (rest >= 2 && rng.int(2) === 0) {
      const a = between(rng, 1, rest - 1);
      sides = [big, a, rest - a];
    } else sides = [big, rest];
  } else if (shape === 2) {
    // Two sides, both short of the threshold.
    const a = between(rng, guardians - t + 1, t - 1);
    sides = [a, guardians - a];
  } else {
    // Three sides, all short.
    const a = between(rng, 1, t - 1);
    const rest = guardians - a;
    const b = between(rng, Math.max(1, rest - (t - 1)), Math.min(t - 1, rest - 1));
    sides = [a, b, rest - b];
  }
  return { kind: 'partition', guardians, sides: shuffled(sides, rng) };
}

// Evidence after a forgery: one Byzantine was both in the hall and signed it. Honest decoys did one of the two:
// someone working in the hall, and guardians who signed without checking. Sometimes nobody did both, and the
// right call is to skip the vote rather than rotate out an honest key.
function generateCouncil(rng: RandomSource): CouncilChallenge {
  const guardians = between(rng, COUNCIL_MIN, COUNCIL_MAX);
  const seats = shuffled(Array.from({ length: guardians }, (_, i) => i), rng);
  const [byz = 0, inHallOnly = 1, signedOnly = 2, signedToo = 3] = seats;
  const proven = rng.int(5) !== 0;
  const inHall = proven ? [byz, inHallOnly] : [inHallOnly];
  const signed = proven ? [byz, signedOnly] : [signedOnly];
  if (rng.int(2) === 0) signed.push(signedToo);
  return { kind: 'council', guardians, forgery: between(rng, 2, 40), inHall: inHall.sort((a, b) => a - b), signed: signed.sort((a, b) => a - b) };
}

export function generateDrill(kind: DrillKind, rng: RandomSource, ctx: TaskContext): DrillChallenge {
  switch (kind) {
    case 'threshold':
      return { kind: 'threshold', guardians: between(rng, DRILL_MIN_GUARDIANS, DRILL_MAX_GUARDIANS) };
    case 'quorum':
      return generateQuorum(rng);
    case 'council':
      return generateCouncil(rng);
    case 'partition':
      return generatePartition(rng);
    default:
      return generateChallenge(kind, rng, ctx);
  }
}

export function checkDrill(c: DrillChallenge, answer: DrillAnswer): boolean {
  switch (c.kind) {
    case 'threshold':
      return answer.kind === 'threshold' && answer.signatures === threshold(c.guardians);
    case 'quorum':
      return answer.kind === 'quorum' && answer.rotations === safeRotations(c.guardians, c.byzantine);
    case 'council':
      return answer.kind === 'council' && answer.suspect === councilSuspect(c);
    case 'partition':
      return answer.kind === 'partition' && answer.side === signingSide(c.guardians, c.sides);
    default:
      return answer.kind !== 'threshold' && answer.kind !== 'quorum' && answer.kind !== 'council' && answer.kind !== 'partition' && checkAnswer(c, answer);
  }
}

// The correct answer, for tests.
export function solveDrill(c: DrillChallenge): DrillAnswer {
  switch (c.kind) {
    case 'threshold':
      return { kind: 'threshold', signatures: threshold(c.guardians) };
    case 'quorum':
      return { kind: 'quorum', rotations: safeRotations(c.guardians, c.byzantine) };
    case 'council':
      return { kind: 'council', suspect: councilSuspect(c) };
    case 'partition':
      return { kind: 'partition', side: signingSide(c.guardians, c.sides) };
    default:
      return solveChallenge(c);
  }
}

// Fastest a person could answer an island drill; station drills use the match task timing.
export const ISLAND_DRILL_MIN_MS: Readonly<Record<IslandDrillKind, number>> = Object.freeze({ threshold: 1200, quorum: 1500, council: 3000, partition: 1500 });
