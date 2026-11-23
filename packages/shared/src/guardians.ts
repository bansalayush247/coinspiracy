import { err, ok, type Result } from './result.js';
import type { Guardian, PlayerId } from './types.js';

// Still part of the federation; frozen guardians count.
export function isMember(guardian: Guardian): boolean {
  return guardian.status !== 'rotatedOut';
}

// Can sign, vote and do tasks right now.
export function canAct(guardian: Guardian): boolean {
  return guardian.status === 'active';
}

export function findGuardian(
  guardians: readonly Guardian[],
  id: PlayerId,
): Guardian | undefined {
  return guardians.find((g) => g.id === id);
}

export function members(guardians: readonly Guardian[]): Guardian[] {
  return guardians.filter(isMember);
}

// Removes a guardian's key from the federation.
export function rotateOut(guardians: readonly Guardian[], id: PlayerId): Result<Guardian[]> {
  const target = findGuardian(guardians, id);
  if (target === undefined || !isMember(target)) return err('invalidTarget');
  return ok(guardians.map((g) => (g.id === id ? { ...g, status: 'rotatedOut' as const } : g)));
}

// Freezes or unfreezes a member; rotated-out guardians stay out.
export function setDisconnected(
  guardians: readonly Guardian[],
  id: PlayerId,
  disconnected: boolean,
): Result<Guardian[]> {
  const target = findGuardian(guardians, id);
  if (target === undefined || !isMember(target)) return err('invalidTarget');
  const status = disconnected ? ('disconnected' as const) : ('active' as const);
  return ok(guardians.map((g) => (g.id === id ? { ...g, status } : g)));
}
