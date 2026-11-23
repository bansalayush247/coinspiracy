// Byzantine sabotage: network partitions that block signing until repaired, and freezing a guardian.
import type { Vec2 } from './map.js';

export interface SabotageTiming {
  // No sabotage in the opening of a match.
  readonly openingMs: number;
  // A partition must be repaired within this long, or the federation takes a liveness strike.
  readonly partitionMs: number;
  // Shared by the Byzantine team, from the end of one partition to the next.
  readonly partitionCooldownMs: number;
  // Both relays held at once for this long repairs the partition.
  readonly repairMs: number;
  readonly freezeMs: number;
  // Per Byzantine, between freezes.
  readonly freezeCooldownMs: number;
}

export const SABOTAGE_TIMING: SabotageTiming = Object.freeze({
  openingMs: 60_000,
  partitionMs: 45_000,
  partitionCooldownMs: 90_000,
  repairMs: 3_000,
  freezeMs: 15_000,
  freezeCooldownMs: 45_000,
});

// Two relays far apart, so a repair takes two guardians working together.
export const RELAYS: readonly Vec2[] = Object.freeze([Object.freeze({ x: 5.5, y: 10.5 }), Object.freeze({ x: 23.5, y: 17.5 })]);
export const RELAY_RANGE = 1.25;
// How close a Byzantine must stand to freeze someone.
export const FREEZE_RANGE = 1.5;

export function relayAt(pos: Vec2): number | null {
  const i = RELAYS.findIndex((r) => Math.hypot(pos.x - r.x, pos.y - r.y) <= RELAY_RANGE);
  return i < 0 ? null : i;
}

export function withinFreezeRange(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= FREEZE_RANGE;
}
