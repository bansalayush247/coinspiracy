import type { RoomId } from './constants.js';
import type { Vec2 } from './map.js';

// One task per station; the index in this list is the task's bit in a player's task mask.
export const TASK_KINDS = ['deposit', 'ledger', 'route', 'watchtower'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface TaskStation {
  readonly kind: TaskKind;
  readonly room: RoomId;
  // The blocking 'S' tile the station stands on.
  readonly col: number;
  readonly row: number;
}

export const TASK_STATIONS: Readonly<Record<TaskKind, TaskStation>> = Object.freeze({
  deposit: Object.freeze({ kind: 'deposit', room: 'depositGate', col: 7, row: 26 }),
  ledger: Object.freeze({ kind: 'ledger', room: 'ledgerArchive', col: 19, row: 7 }),
  route: Object.freeze({ kind: 'route', room: 'gatewayDock', col: 26, row: 22 }),
  watchtower: Object.freeze({ kind: 'watchtower', room: 'watchtower', col: 24, row: 5 }),
});

// Every player is dealt every task; Byzantine copies are fakes that add no consensus.
export const ALL_TASKS = (1 << TASK_KINDS.length) - 1;

export function taskBit(kind: TaskKind): number {
  return 1 << TASK_KINDS.indexOf(kind);
}

export function hasTask(mask: number, kind: TaskKind): boolean {
  return Number.isInteger(mask) && (mask & taskBit(kind)) !== 0;
}

export function countTasks(mask: number): number {
  return TASK_KINDS.filter((kind) => hasTask(mask, kind)).length;
}

// Server range from the station's centre; clients offer the button a little closer.
export const STATION_RANGE = 1.75;
export const STATION_PROMPT_RANGE = 1.5;

export function stationCenter(kind: TaskKind): Vec2 {
  const s = TASK_STATIONS[kind];
  return { x: s.col + 0.5, y: s.row + 0.5 };
}

export function inStationRange(pos: Vec2, kind: TaskKind, range = STATION_RANGE): boolean {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
  const c = stationCenter(kind);
  return Math.hypot(pos.x - c.x, pos.y - c.y) <= range;
}

// Closest station within range, if any.
export function stationNear(pos: Vec2, range = STATION_RANGE): TaskKind | null {
  let best: TaskKind | null = null;
  let bestDistance = Infinity;
  for (const kind of TASK_KINDS) {
    const c = stationCenter(kind);
    const d = Math.hypot(pos.x - c.x, pos.y - c.y);
    if (d <= range && d < bestDistance) {
      best = kind;
      bestDistance = d;
    }
  }
  return best;
}

export interface TaskTiming {
  // Fastest a challenge may be answered after it opens; bots answering instantly are refused.
  readonly minSolveMs: Readonly<Record<TaskKind, number>>;
  // An open challenge left this long is closed.
  readonly expireMs: number;
  // Lockout after a wrong answer, so guessing is slower than solving.
  readonly retryMs: number;
  // Gap between opening challenges, so nobody can fish for an easy one.
  readonly openCooldownMs: number;
}

export const TASK_TIMING: TaskTiming = Object.freeze({
  minSolveMs: Object.freeze({ deposit: 3000, ledger: 2000, route: 2000, watchtower: 1500 }),
  expireMs: 120_000,
  retryMs: 4000,
  openCooldownMs: 750,
});

// Whole percent of honest tasks done; 100 only when every one is.
export function consensusPercent(done: number, total: number): number {
  if (!Number.isSafeInteger(done) || !Number.isSafeInteger(total) || total <= 0 || done <= 0) return 0;
  return Math.min(100, Math.floor((100 * done) / total));
}
