import { LIVENESS_LIMIT, livenessStrikes } from './ceremony.js';
import { CONSENSUS_GOAL } from './constants.js';
import { isHalted } from './federation.js';
import { members } from './guardians.js';
import type { Proposal } from './proposals.js';
import type { Guardian } from './types.js';

export type WinReason =
  | 'forgedProposalPassed'
  | 'livenessLost'
  // The final block arrived before the honest guardians reached consensus.
  | 'outOfTime'
  | 'federationHalted'
  | 'allByzantineRotatedOut'
  | 'consensusReached';

export type Side = 'honest' | 'byzantine';

export interface Winner {
  readonly side: Side;
  readonly reason: WinReason;
}

export interface MatchSnapshot {
  readonly guardians: readonly Guardian[];
  readonly proposals: readonly Proposal[];
  readonly consensus: number;
  // Partitions that ran out the timer; each costs liveness like a failed real withdrawal.
  readonly outages?: number;
}

// Byzantine wins are checked first so a passed forgery always counts.
export function evaluateWinner(match: MatchSnapshot): Winner | null {
  if (!Number.isFinite(match.consensus) || match.consensus < 0) {
    throw new RangeError('consensus must be a non-negative number');
  }
  if (match.proposals.some((p) => p.forged && p.status === 'passed')) {
    return { side: 'byzantine', reason: 'forgedProposalPassed' };
  }
  const active = members(match.guardians);
  const byzantine = active.filter((g) => g.role === 'byzantine').length;
  if (isHalted(byzantine, active.length)) {
    return { side: 'byzantine', reason: 'federationHalted' };
  }
  // Refusing everything is no defence: users who cannot withdraw have lost their money too.
  if (livenessStrikes(match.proposals) + (match.outages ?? 0) >= LIVENESS_LIMIT) {
    return { side: 'byzantine', reason: 'livenessLost' };
  }
  if (byzantine === 0) return { side: 'honest', reason: 'allByzantineRotatedOut' };
  if (match.consensus >= CONSENSUS_GOAL) return { side: 'honest', reason: 'consensusReached' };
  return null;
}
