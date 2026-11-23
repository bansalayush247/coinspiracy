// The block clock: a match runs on in-game blocks, in three acts. Councils stop the clock.
export const ACTS = ['calm', 'proposals', 'final'] as const;
export type Act = (typeof ACTS)[number];

export interface Pacing {
  readonly blockMs: number;
  readonly totalBlocks: number;
  // Tasks only: no withdrawals, no sabotage.
  readonly calmBlocks: number;
  // The countdown at the end, where withdrawals come faster.
  readonly finalBlocks: number;
}

export const PACING: Pacing = Object.freeze({ blockMs: 10_000, totalBlocks: 72, calmBlocks: 6, finalBlocks: 12 });

// Withdrawals arrive this much faster in the final blocks.
export const FINAL_SPAWN_FACTOR = 0.6;

export function blocksElapsed(elapsedMs: number, pacing: Pacing = PACING): number {
  return Math.max(0, Math.floor(elapsedMs / pacing.blockMs));
}

export function blocksLeft(elapsedMs: number, pacing: Pacing = PACING): number {
  return Math.max(0, pacing.totalBlocks - blocksElapsed(elapsedMs, pacing));
}

export function actAt(elapsedMs: number, pacing: Pacing = PACING): Act {
  const done = blocksElapsed(elapsedMs, pacing);
  if (done < pacing.calmBlocks) return 'calm';
  if (pacing.totalBlocks - done <= pacing.finalBlocks) return 'final';
  return 'proposals';
}
