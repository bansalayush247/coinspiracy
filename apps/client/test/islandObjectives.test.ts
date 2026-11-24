import { describe, expect, it } from 'vitest';
import { ISLAND_OBJECTIVES, islandObjectiveProgress, nearbyObjectivePoint } from '../src/explore/islandObjectives.js';

describe('island objectives', () => {
  it('gives every preview island a completable objective with unique points', () => {
    expect(Object.keys(ISLAND_OBJECTIVES)).toEqual(['mint', 'signing', 'council', 'watchtower', 'reef']);
    for (const objective of Object.values(ISLAND_OBJECTIVES)) {
      expect(objective.target).toBeGreaterThan(0);
      expect(objective.target).toBeLessThanOrEqual(objective.points.length);
      expect(new Set(objective.points.map((point) => point.id)).size).toBe(objective.points.length);
    }
  });

  it('selects the closest unfinished point in interaction range', () => {
    const objective = ISLAND_OBJECTIVES.reef;
    expect(nearbyObjectivePoint(objective, new Set(), { x: 10.5, y: 12.5 })?.id).toBe('middle-channel');
    expect(nearbyObjectivePoint(objective, new Set(['middle-channel']), { x: 10.5, y: 12.5 })).toBeNull();
    expect(nearbyObjectivePoint(objective, new Set(), { x: 0, y: 0 })).toBeNull();
  });

  it('completes signing at three guardians without requiring all four', () => {
    const objective = ISLAND_OBJECTIVES.signing;
    const progress = islandObjectiveProgress(objective, new Set(['key-1', 'key-2', 'key-3']), { x: 0, y: 0 });
    expect(progress).toMatchObject({ progress: 3, total: 3, complete: true, canInteract: false });
    expect(progress.prompt).toContain('Threshold reached');
  });

  it('reports the nearby action before completion', () => {
    const objective = ISLAND_OBJECTIVES.watchtower;
    const progress = islandObjectiveProgress(objective, new Set(), { x: 5.2, y: 10.4 });
    expect(progress).toMatchObject({ progress: 0, total: 2, complete: false, canInteract: true, action: 'Repair west relay' });
  });
});
