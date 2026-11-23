import { threshold } from './federation.js';
import { canAct, findGuardian, isMember, members } from './guardians.js';
import { err, ok, type Result } from './result.js';
import { assertTick } from './ticks.js';
import type { Guardian, PlayerId } from './types.js';

export type ProposalStatus = 'open' | 'passed' | 'rejected' | 'expired';

// Server-side proposal; `forged` is hidden information.
export interface Proposal {
  readonly id: string;
  readonly amount: number;
  readonly requestedBy: PlayerId;
  readonly forged: boolean;
  readonly signatures: readonly PlayerId[];
  readonly refusals: readonly PlayerId[];
  readonly status: ProposalStatus;
  readonly expiresAtTick: number;
}

// Client view; `forged?: never` makes a raw Proposal fail to type-check as one.
export interface PublicProposal {
  readonly id: string;
  readonly amount: number;
  readonly requestedBy: PlayerId;
  readonly signatures: readonly PlayerId[];
  readonly refusals: readonly PlayerId[];
  readonly status: ProposalStatus;
  readonly expiresAtTick: number;
  readonly forged?: never;
}

export interface NewProposal {
  readonly id: string;
  readonly amount: number;
  readonly requestedBy: PlayerId;
  readonly forged: boolean;
  readonly expiresAtTick: number;
}

export function createProposal(input: NewProposal): Proposal {
  if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
    throw new RangeError('amount must be a positive integer');
  }
  assertTick(input.expiresAtTick, 'expiresAtTick');
  return { ...input, signatures: [], refusals: [], status: 'open' };
}

// Explicit field copy so new server fields never leak by default.
export function toPublicProposal(p: Proposal): PublicProposal {
  return {
    id: p.id,
    amount: p.amount,
    requestedBy: p.requestedBy,
    signatures: [...p.signatures],
    refusals: [...p.refusals],
    status: p.status,
    expiresAtTick: p.expiresAtTick,
  };
}

// Re-evaluates from current members' responses; an overdue proposal expires first.
export function settleProposal(
  p: Proposal,
  guardians: readonly Guardian[],
  nowTick: number,
): Proposal {
  assertTick(nowTick);
  if (p.status !== 'open') return p;
  if (!(nowTick < p.expiresAtTick)) return { ...p, status: 'expired' };
  const memberIds = new Set(members(guardians).map((g) => g.id));
  if (memberIds.size === 0) return { ...p, status: 'rejected' };
  const needed = threshold(memberIds.size);
  const signed = p.signatures.filter((id) => memberIds.has(id)).length;
  const refused = p.refusals.filter((id) => memberIds.has(id)).length;
  if (signed >= needed) return { ...p, status: 'passed' };
  if (memberIds.size - refused < needed) return { ...p, status: 'rejected' };
  return p;
}

function checkResponder(
  p: Proposal,
  playerId: PlayerId,
  guardians: readonly Guardian[],
  nowTick: number,
): Result<null> {
  assertTick(nowTick);
  if (p.status !== 'open') return err('notOpen');
  // Fails closed even if expiresAtTick was corrupted.
  if (!(nowTick < p.expiresAtTick)) return err('expired');
  const guardian = findGuardian(guardians, playerId);
  if (guardian === undefined || !isMember(guardian)) return err('notGuardian');
  if (!canAct(guardian)) return err('cannotAct');
  if (p.signatures.includes(playerId) || p.refusals.includes(playerId)) {
    return err('alreadyResponded');
  }
  return ok(null);
}

export function signProposal(
  p: Proposal,
  signerId: PlayerId,
  guardians: readonly Guardian[],
  nowTick: number,
): Result<Proposal> {
  const check = checkResponder(p, signerId, guardians, nowTick);
  if (!check.ok) return check;
  const next = { ...p, signatures: [...p.signatures, signerId] };
  return ok(settleProposal(next, guardians, nowTick));
}

export function refuseProposal(
  p: Proposal,
  refuserId: PlayerId,
  guardians: readonly Guardian[],
  nowTick: number,
): Result<Proposal> {
  const check = checkResponder(p, refuserId, guardians, nowTick);
  if (!check.ok) return check;
  const next = { ...p, refusals: [...p.refusals, refuserId] };
  return ok(settleProposal(next, guardians, nowTick));
}

// Closes an open proposal whose deadline has passed.
export function expireProposal(p: Proposal, nowTick: number): Proposal {
  assertTick(nowTick);
  if (p.status === 'open' && !(nowTick < p.expiresAtTick)) return { ...p, status: 'expired' };
  return p;
}
