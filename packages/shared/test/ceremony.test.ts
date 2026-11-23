import { describe, expect, it } from 'vitest';
import {
  CEREMONY_TIMING,
  LIVENESS_LIMIT,
  WITHDRAWAL_MAX,
  WITHDRAWAL_MIN,
  atAuditDesk,
  inSigningHall,
  isLivenessFailure,
  livenessStrikes,
  msToTicks,
  secondsLeft,
  withdrawalAmount,
} from '../src/ceremony.js';
import { CONSENSUS_GOAL } from '../src/constants.js';
import { ROOM_REGIONS } from '../src/map.js';
import { SERVER_TICK_HZ } from '../src/movement.js';
import type { Proposal, ProposalStatus } from '../src/proposals.js';
import type { RandomSource } from '../src/roles.js';
import { stationCenter } from '../src/tasks.js';
import type { Guardian } from '../src/types.js';
import { evaluateWinner } from '../src/win.js';

function fixed(value: (max: number) => number): RandomSource {
  return { int: value };
}

function proposal(id: string, status: ProposalStatus, forged: boolean): Proposal {
  return { id, amount: 5000, requestedBy: 'federation', forged, signatures: [], refusals: [], status, expiresAtTick: 900 };
}

const GUARDIANS: Guardian[] = Array.from({ length: 5 }, (_, i) => ({
  id: `player-${String(i)}x`,
  role: i === 0 ? 'byzantine' : 'honest',
  status: 'active',
}));

describe('withdrawal amounts', () => {
  it('spans the range in whole hundreds at both ends', () => {
    expect(withdrawalAmount(fixed(() => 0))).toBe(WITHDRAWAL_MIN);
    expect(withdrawalAmount(fixed((max) => max - 1))).toBe(WITHDRAWAL_MAX);
    for (let i = 0; i < 200; i++) {
      const amount = withdrawalAmount({ int: (max) => Math.floor(Math.random() * max) });
      expect(amount % 100).toBe(0);
      expect(amount).toBeGreaterThanOrEqual(WITHDRAWAL_MIN);
      expect(amount).toBeLessThanOrEqual(WITHDRAWAL_MAX);
    }
  });
});

describe('ticks and seconds', () => {
  it('converts milliseconds to at least one tick, rounding up', () => {
    expect(msToTicks(1000)).toBe(SERVER_TICK_HZ);
    expect(msToTicks(1)).toBe(1);
    expect(msToTicks(0)).toBe(1);
    expect(msToTicks(CEREMONY_TIMING.ttlMs)).toBe((CEREMONY_TIMING.ttlMs / 1000) * SERVER_TICK_HZ);
  });

  it('shows whole seconds left, never negative and never above a byte', () => {
    expect(secondsLeft(100, 100)).toBe(0);
    expect(secondsLeft(100, 120)).toBe(0);
    expect(secondsLeft(100 + SERVER_TICK_HZ, 100)).toBe(1);
    expect(secondsLeft(101, 100)).toBe(1);
    expect(secondsLeft(100 + 1000 * SERVER_TICK_HZ, 100)).toBe(255);
  });
});

describe('places', () => {
  it('knows the Signing Hall', () => {
    const hall = ROOM_REGIONS.signingHall;
    expect(inSigningHall({ x: hall.x + 1.5, y: hall.y + 1.5 })).toBe(true);
    expect(inSigningHall({ x: 15, y: 15 })).toBe(false);
  });

  it('puts the audit desk at the Ledger Archive station', () => {
    expect(atAuditDesk(stationCenter('ledger'))).toBe(true);
    expect(atAuditDesk(stationCenter('deposit'))).toBe(false);
  });
});

describe('liveness', () => {
  it('counts only legitimate withdrawals that failed', () => {
    expect(isLivenessFailure(proposal('1', 'rejected', false))).toBe(true);
    expect(isLivenessFailure(proposal('2', 'expired', false))).toBe(true);
    expect(isLivenessFailure(proposal('3', 'passed', false))).toBe(false);
    expect(isLivenessFailure(proposal('4', 'open', false))).toBe(false);
    expect(isLivenessFailure(proposal('5', 'rejected', true))).toBe(false);
    expect(isLivenessFailure(proposal('6', 'expired', true))).toBe(false);
  });

  it('ends the match for the Byzantines once the limit is reached, not before', () => {
    const failed = Array.from({ length: LIVENESS_LIMIT }, (_, i) => proposal(String(i), i % 2 === 0 ? 'rejected' : 'expired', false));
    expect(livenessStrikes(failed)).toBe(LIVENESS_LIMIT);
    expect(evaluateWinner({ guardians: GUARDIANS, proposals: failed.slice(1), consensus: 0 })).toBeNull();
    expect(evaluateWinner({ guardians: GUARDIANS, proposals: failed, consensus: 0 })).toEqual({ side: 'byzantine', reason: 'livenessLost' });
  });

  it('lets blocked forgeries pile up without harm', () => {
    const blocked = Array.from({ length: 10 }, (_, i) => proposal(String(i), 'rejected', true));
    expect(evaluateWinner({ guardians: GUARDIANS, proposals: blocked, consensus: 0 })).toBeNull();
  });

  it('checks a passed forgery before liveness, and liveness before consensus', () => {
    const failed = Array.from({ length: LIVENESS_LIMIT }, (_, i) => proposal(String(i), 'expired', false));
    expect(evaluateWinner({ guardians: GUARDIANS, proposals: [...failed, proposal('f', 'passed', true)], consensus: 0 })?.reason).toBe('forgedProposalPassed');
    expect(evaluateWinner({ guardians: GUARDIANS, proposals: failed, consensus: CONSENSUS_GOAL })?.reason).toBe('livenessLost');
  });
});
