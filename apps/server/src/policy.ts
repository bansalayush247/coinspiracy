import {
  CEREMONY_TIMING,
  COUNCIL_TIMING,
  ISLAND_DRILL_MIN_MS,
  PACING,
  SABOTAGE_TIMING,
  TASK_TIMING,
  type CeremonyTiming,
  type CouncilTiming,
  type IslandDrillKind,
  type Pacing,
  type SabotageTiming,
  type TaskTiming,
} from '@byzantine-council/shared';
import { ChainTipSource } from './chain.js';
import type { SessionKeys } from './profile/session.js';
import type { ProfileStore } from './profile/store.js';
import { createScaling, type RateLimiter, type Scaling, type SeatCounter } from './scaling/index.js';

// Abuse limits shared by every room: per process, or across processes when scaling runs on Redis.
export interface RoomPolicy {
  // Concurrent seats per network.
  readonly ipSlots: SeatCounter;
  // Matchmake calls per network per minute.
  readonly matchmake: RateLimiter;
  // Matchmake calls per network inside one seat-reservation window, so one network cannot
  // fill a room with reservations it never uses.
  readonly reservations: RateLimiter;
  // Seat hold after an unexpected disconnect.
  readonly reconnectSeconds: number;
  // A player who sends nothing for this long is removed.
  readonly idleKickMs: number;
  readonly taskTiming: TaskTiming;
  // Fastest answers to the Academy's island drills (thresholds, quorums, councils, partitions).
  readonly islandDrillMinMs: Readonly<Record<IslandDrillKind, number>>;
  readonly ceremonyTiming: CeremonyTiming;
  readonly councilTiming: CouncilTiming;
  readonly sabotageTiming: SabotageTiming;
  readonly pacing: Pacing;
  // How long the result screen stays up before the room returns to the lobby.
  readonly resultMs: number;
  readonly chain: ChainTipSource;
  // Guest profiles and rewards; null runs matches without them (tests, or profiles switched off).
  readonly profiles: ProfileServices | null;
}

export interface ProfileServices {
  readonly store: ProfileStore;
  readonly keys: SessionKeys;
}

export interface RoomPolicyOptions {
  readonly maxSeatsPerIp?: number;
  readonly matchmakePerMinute?: number;
  readonly reservationsPerWindow?: number;
  readonly reconnectSeconds?: number;
  readonly idleKickMs?: number;
  readonly taskTiming?: TaskTiming;
  readonly islandDrillMinMs?: Readonly<Record<IslandDrillKind, number>>;
  readonly ceremonyTiming?: CeremonyTiming;
  readonly councilTiming?: CouncilTiming;
  readonly sabotageTiming?: SabotageTiming;
  readonly pacing?: Pacing;
  readonly resultMs?: number;
  // Plain-text Bitcoin tip height endpoint; null or absent uses a clock estimate.
  readonly chainTipUrl?: string | null;
  readonly profiles?: ProfileServices | null;
  // Where the limits live; local to this process when omitted.
  readonly scaling?: Scaling;
}

let current: RoomPolicy | null = null;

export function configureRoomPolicy(options: RoomPolicyOptions = {}): RoomPolicy {
  current?.matchmake.stop();
  current?.reservations.stop();
  void current?.ipSlots.stop();
  current?.chain.stop();
  const scaling = options.scaling ?? createScaling();
  current = {
    ipSlots: scaling.seatCounter(options.maxSeatsPerIp ?? 16),
    matchmake: scaling.rateLimiter('matchmake', options.matchmakePerMinute ?? 30, 60_000),
    reservations: scaling.rateLimiter('reservations', options.reservationsPerWindow ?? 6, 8_000),
    reconnectSeconds: options.reconnectSeconds ?? 30,
    idleKickMs: options.idleKickMs ?? 10 * 60_000,
    taskTiming: options.taskTiming ?? TASK_TIMING,
    islandDrillMinMs: options.islandDrillMinMs ?? ISLAND_DRILL_MIN_MS,
    ceremonyTiming: options.ceremonyTiming ?? CEREMONY_TIMING,
    councilTiming: options.councilTiming ?? COUNCIL_TIMING,
    sabotageTiming: options.sabotageTiming ?? SABOTAGE_TIMING,
    pacing: options.pacing ?? PACING,
    resultMs: options.resultMs ?? 12_000,
    chain: new ChainTipSource({ url: options.chainTipUrl ?? null }),
    profiles: options.profiles ?? null,
  };
  return current;
}

export function roomPolicy(): RoomPolicy {
  return current ?? configureRoomPolicy();
}
