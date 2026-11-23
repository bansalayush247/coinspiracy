import { canAct, findGuardian, isMember } from './guardians.js';
import { err, ok, type Result } from './result.js';
import { assertTick } from './ticks.js';
import type { Guardian, PlayerId } from './types.js';

// Safe as a sentinel: player ids are at least 8 characters.
export const SKIP = 'skip';
export type VoteTarget = PlayerId;

export interface Council {
  readonly calledBy: PlayerId;
  readonly closesAtTick: number;
  readonly votes: ReadonlyMap<PlayerId, VoteTarget>;
}

export interface Tally {
  readonly counts: ReadonlyMap<PlayerId, number>;
  readonly skips: number;
  readonly ejected: PlayerId | null;
}

function actingMember(guardians: readonly Guardian[], id: PlayerId): Result<Guardian> {
  const guardian = findGuardian(guardians, id);
  if (guardian === undefined || !isMember(guardian)) return err('notGuardian');
  if (!canAct(guardian)) return err('cannotAct');
  return ok(guardian);
}

export function openCouncil(
  calledBy: PlayerId,
  guardians: readonly Guardian[],
  nowTick: number,
  durationTicks: number,
): Result<Council> {
  assertTick(nowTick);
  if (!Number.isSafeInteger(durationTicks) || durationTicks < 1) {
    throw new RangeError('durationTicks must be a positive integer');
  }
  const closesAtTick = nowTick + durationTicks;
  assertTick(closesAtTick, 'closesAtTick');
  const caller = actingMember(guardians, calledBy);
  if (!caller.ok) return caller;
  return ok({ calledBy, closesAtTick, votes: new Map() });
}

// One vote per guardian; no self votes; targets must still be members.
export function castVote(
  council: Council,
  voterId: PlayerId,
  target: VoteTarget,
  guardians: readonly Guardian[],
  nowTick: number,
): Result<Council> {
  assertTick(nowTick);
  // Fails closed even if closesAtTick was corrupted.
  if (!(nowTick < council.closesAtTick)) return err('votingClosed');
  const voter = actingMember(guardians, voterId);
  if (!voter.ok) return voter;
  if (council.votes.has(voterId)) return err('alreadyVoted');
  if (target !== SKIP) {
    if (target === voterId) return err('selfVote');
    const targetGuardian = findGuardian(guardians, target);
    if (targetGuardian === undefined || !isMember(targetGuardian)) return err('invalidTarget');
  }
  const votes = new Map(council.votes);
  votes.set(voterId, target);
  return ok({ ...council, votes });
}

// Ejects the unique top target only if it beats the skip count.
export function tallyVotes(council: Council, guardians: readonly Guardian[]): Tally {
  const memberIds = new Set(guardians.filter(isMember).map((g) => g.id));
  const counts = new Map<PlayerId, number>();
  let skips = 0;
  for (const [voter, target] of council.votes) {
    if (!memberIds.has(voter)) continue;
    if (target === SKIP) skips += 1;
    else if (memberIds.has(target)) counts.set(target, (counts.get(target) ?? 0) + 1);
  }

  let top: PlayerId | null = null;
  let topCount = 0;
  let tie = false;
  for (const [id, count] of counts) {
    if (count > topCount) {
      top = id;
      topCount = count;
      tie = false;
    } else if (count === topCount) {
      tie = true;
    }
  }
  const ejected = top !== null && !tie && topCount > skips ? top : null;
  return { counts, skips, ejected };
}
