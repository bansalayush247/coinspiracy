export type PreviewIslandId = 'mint' | 'signing' | 'council' | 'watchtower' | 'reef';

export interface IslandProgress {
  readonly objective: string;
  readonly progress: number;
  readonly total: number;
  readonly complete: boolean;
  readonly prompt: string;
  readonly action: string | null;
  readonly canInteract: boolean;
}

export interface InteractionPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly action: string;
}

export interface IslandObjective {
  readonly title: string;
  readonly target: number;
  readonly complete: string;
  readonly points: readonly InteractionPoint[];
}

export const ISLAND_OBJECTIVES: Readonly<Record<PreviewIslandId, IslandObjective>> = {
  mint: {
    title: 'Prepare an ecash issuance batch',
    target: 3,
    complete: 'Batch ready: blinded notes verified and denominated.',
    points: [
      { id: 'pavilion', x: 5.1, y: 10.2, action: 'Verify blind signatures' },
      { id: 'vault', x: 10, y: 10.5, action: 'Authorize the mint batch' },
      { id: 'notes', x: 14.2, y: 10.2, action: 'Check note denominations' },
    ],
  },
  signing: {
    title: 'Reach the signing threshold',
    target: 3,
    complete: 'Threshold reached: the withdrawal can proceed.',
    points: [7.1, 9, 11, 12.9].map((x, index) => ({ id: `key-${String(index + 1)}`, x, y: 10.1, action: `Add guardian signature ${String(index + 1)}` })),
  },
  council: {
    title: 'Review evidence and cast a ballot',
    target: 3,
    complete: 'Ballot sealed: the council has recorded your decision.',
    points: [
      { id: 'honest-evidence', x: 5.2, y: 7.7, action: 'Review honest evidence' },
      { id: 'byzantine-evidence', x: 14.8, y: 7.7, action: 'Review Byzantine evidence' },
      { id: 'ballot', x: 10, y: 9, action: 'Seal your council ballot' },
    ],
  },
  watchtower: {
    title: 'Repair both network relays',
    target: 2,
    complete: 'Partition repaired: the federation can communicate again.',
    points: [
      { id: 'west-relay', x: 5.2, y: 10.4, action: 'Repair west relay' },
      { id: 'east-relay', x: 14.8, y: 10.4, action: 'Repair east relay' },
    ],
  },
  reef: {
    title: 'Open a Lightning route',
    target: 3,
    complete: 'Route open: the gateway has enough outbound liquidity.',
    points: [
      { id: 'entry-channel', x: 7.2, y: 11.4, action: 'Fund entry channel' },
      { id: 'middle-channel', x: 10.5, y: 12.5, action: 'Balance middle channel' },
      { id: 'exit-channel', x: 13.2, y: 11.8, action: 'Open exit channel' },
    ],
  },
};

export function nearbyObjectivePoint(
  objective: IslandObjective,
  completed: ReadonlySet<string>,
  position: Readonly<{ x: number; y: number }>,
  range = 1.55,
): InteractionPoint | null {
  if (completed.size >= objective.target) return null;
  let nearest: { point: InteractionPoint; distance: number } | null = null;
  for (const point of objective.points) {
    if (completed.has(point.id)) continue;
    const distance = Math.hypot(point.x - position.x, point.y - position.y);
    if (distance <= range && (nearest === null || distance < nearest.distance)) nearest = { point, distance };
  }
  return nearest?.point ?? null;
}

export function islandObjectiveProgress(
  objective: IslandObjective,
  completed: ReadonlySet<string>,
  position: Readonly<{ x: number; y: number }>,
): IslandProgress {
  const progress = Math.min(completed.size, objective.target);
  const complete = progress >= objective.target;
  const point = complete ? null : nearbyObjectivePoint(objective, completed, position);
  return {
    objective: objective.title,
    progress,
    total: objective.target,
    complete,
    prompt: complete ? objective.complete : point === null ? 'Follow a glowing marker, then interact.' : point.action,
    action: point?.action ?? null,
    canInteract: point !== null,
  };
}
