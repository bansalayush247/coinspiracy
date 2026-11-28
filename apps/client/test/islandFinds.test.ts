import { describe, expect, it } from 'vitest';
import { BEACH_LANDMARKS, BEACH_MAP, BEACH_SPAWNS } from '@byzantine-council/shared/hub';
import { FERRY_TUNING } from '@byzantine-council/shared/city';
import { findPath } from '@byzantine-council/shared/pathfinding';
import { ISLAND_FINDS, IslandFinds } from '../src/explore/islandFinds.js';

describe('island finds', () => {
  it('requires the right island, rank and distance, and remembers a find only once', () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); },
    };
    const journal = new IslandFinds(storage);
    const lens = journal.entries('beach').find((find) => find.id === 'lens');
    expect(lens).toBeDefined();
    if (lens === undefined) return;
    expect(journal.search('beach', lens.at, 49)).toBeNull();
    expect(journal.search('mint', lens.at, 50)).toBeNull();
    expect(journal.search('beach', { x: 15, y: 9 }, 50)).toBeNull();
    expect(journal.search('beach', lens.at, 50)).toBe(lens);
    expect(journal.search('beach', lens.at, 50)).toBeNull();
    expect(new IslandFinds(storage).has(lens)).toBe(true);
  });

  it('keeps every Beach Town landmark, find and ferry boarding spot reachable', () => {
    const { beach } = FERRY_TUNING.stops;
    const spawn = BEACH_SPAWNS[0] ?? beach.arrive;
    expect(findPath(BEACH_MAP, spawn, beach.at).ok).toBe(true);
    for (const site of BEACH_LANDMARKS) expect(findPath(BEACH_MAP, beach.arrive, site.approach).ok, site.id).toBe(true);
    for (const find of ISLAND_FINDS.filter((find) => find.island === 'beach')) {
      expect(findPath(BEACH_MAP, beach.arrive, find.at).ok, find.id).toBe(true);
    }
  });
});
