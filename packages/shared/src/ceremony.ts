// Signing ceremonies: withdrawal proposals, forging, audits and the liveness rule.
import { SERVER_TICK_HZ } from './movement.js';
import { ROOM_REGIONS, roomAt, type RoomRegions, type Vec2 } from './map.js';
import type { Proposal } from './proposals.js';
import type { RandomSource } from './roles.js';
import { STATION_RANGE, TASK_STATIONS, inStationRange, type TaskStations } from './tasks.js';

export interface CeremonyTiming {
  // Calm opening before the first withdrawal appears.
  readonly firstProposalMs: number;
  // Gap between legitimate withdrawals, drawn uniformly from [min, max].
  readonly spawnMinMs: number;
  readonly spawnMaxMs: number;
  // How long a proposal stays open for signatures.
  readonly ttlMs: number;
  // Open proposals at once, legitimate and forged together.
  readonly maxOpen: number;
  // Per Byzantine, between forgeries.
  readonly forgeCooldownMs: number;
  // Standing at the Ledger Archive this long reveals one proposal's truth to the auditor.
  readonly auditMs: number;
  // Per player, between audits.
  readonly auditCooldownMs: number;
}

export const CEREMONY_TIMING: CeremonyTiming = Object.freeze({
  firstProposalMs: 60_000,
  spawnMinMs: 35_000,
  spawnMaxMs: 55_000,
  ttlMs: 45_000,
  maxOpen: 3,
  forgeCooldownMs: 40_000,
  auditMs: 3_000,
  auditCooldownMs: 20_000,
});

// Failed legitimate withdrawals the federation survives; one more and users have lost access.
export const LIVENESS_LIMIT = 3;

// Withdrawal amounts in sats: whole hundreds, the same range for real and forged ones.
export const WITHDRAWAL_MIN = 1_000;
export const WITHDRAWAL_MAX = 50_000;

export function withdrawalAmount(rng: RandomSource): number {
  const steps = (WITHDRAWAL_MAX - WITHDRAWAL_MIN) / 100 + 1;
  return WITHDRAWAL_MIN + 100 * rng.int(steps);
}

export function msToTicks(ms: number): number {
  return Math.max(1, Math.ceil((ms * SERVER_TICK_HZ) / 1000));
}

// Whole seconds left on a proposal, for display.
export function secondsLeft(expiresAtTick: number, nowTick: number): number {
  return Math.max(0, Math.min(255, Math.ceil((expiresAtTick - nowTick) / SERVER_TICK_HZ)));
}

// Forgeries are filed from the Signing Hall, where others may see who stands there.
export function inSigningHall(pos: Vec2, regions: RoomRegions = ROOM_REGIONS): boolean {
  return roomAt(pos, regions) === 'signingHall';
}

// Audits happen at the Ledger Archive station, where the note records are.
export function atAuditDesk(pos: Vec2, stations: TaskStations = TASK_STATIONS): boolean {
  return inStationRange(pos, 'ledger', STATION_RANGE, stations);
}

// A legitimate withdrawal that did not go through costs the federation liveness.
export function isLivenessFailure(p: Proposal): boolean {
  return !p.forged && (p.status === 'rejected' || p.status === 'expired');
}

export function livenessStrikes(proposals: readonly Proposal[]): number {
  return proposals.filter(isLivenessFailure).length;
}
