import { describe, expect, it } from 'vitest';
import { ARENAS, ARENA_IDS, CITADEL, REEF, arenaById, type Arena } from '../src/arena.js';
import { ROOMS } from '../src/constants.js';
import { inSigningHall, atAuditDesk } from '../src/ceremony.js';
import { isWalkableTile, roomAt, tileAt } from '../src/map.js';
import { PLAYER_RADIUS } from '../src/movement.js';
import { canStand, findPath, findPathNear } from '../src/pathfinding.js';
import { relayAt } from '../src/sabotage.js';
import { STATION_PROMPT_RANGE, STATION_RANGE, TASK_KINDS, inStationRange, stationCenter, stationNear } from '../src/tasks.js';

const ALL: Arena[] = ARENA_IDS.map((id) => ARENAS[id]);

function walkable(a: Arena): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < a.map.height; r++) for (let c = 0; c < a.map.width; c++) if (isWalkableTile(a.map, c, r)) out.push([c, r]);
  return out;
}

function component(a: Arena, from: [number, number]): Set<string> {
  const seen = new Set([`${String(from[0])},${String(from[1])}`]);
  const queue = [from];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const [c, r] = next;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${String(c + dc)},${String(r + dr)}`;
      if (!seen.has(key) && isWalkableTile(a.map, c + dc, r + dr)) {
        seen.add(key);
        queue.push([c + dc, r + dr]);
      }
    }
  }
  return seen;
}

describe.each(ALL.map((a) => [a.id, a] as const))('the %s arena', (_, arena) => {
  it('is a frozen grid of equal rows with a void rim', () => {
    expect(Object.isFrozen(arena.map.rows)).toBe(true);
    for (const row of arena.map.rows) expect(row).toHaveLength(arena.map.width);
    for (let c = 0; c < arena.map.width; c++) {
      expect(tileAt(arena.map, c, 0)).toBe('#');
      expect(tileAt(arena.map, c, arena.map.height - 1)).toBe('#');
    }
  });

  it('is one connected island: every walkable tile reaches every other', () => {
    const tiles = walkable(arena);
    const first = tiles[0];
    if (first === undefined) throw new Error('no walkable tiles');
    expect(component(arena, first).size).toBe(tiles.length);
  });

  it('spawns every seat on its own standable spot in the square', () => {
    expect(arena.spawns).toHaveLength(9);
    for (const s of arena.spawns) {
      expect(canStand(arena.map, s), `${String(s.x)},${String(s.y)}`).toBe(true);
      expect(roomAt(s, arena.regions)).toBe('plaza');
    }
    for (const [i, a] of arena.spawns.entries()) {
      for (const b of arena.spawns.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * PLAYER_RADIUS);
    }
  });

  it('puts each station in its own room, reachable from every spawn, with a standable spot in range', () => {
    for (const kind of TASK_KINDS) {
      const s = arena.stations[kind];
      expect(tileAt(arena.map, s.col, s.row)).toBe('S');
      const center = stationCenter(kind, arena.stations);
      expect(roomAt(center, arena.regions), kind).toBe(s.room);
      for (const spawn of arena.spawns) {
        const path = findPathNear(arena.map, spawn, center, STATION_PROMPT_RANGE);
        expect(path.ok, `${kind} from ${String(spawn.x)},${String(spawn.y)}`).toBe(true);
        if (!path.ok) continue;
        const end = path.value.at(-1) ?? spawn;
        expect(inStationRange(end, kind, STATION_RANGE, arena.stations)).toBe(true);
        expect(stationNear(end, STATION_PROMPT_RANGE + 0.01, arena.stations)).toBe(kind);
      }
    }
  });

  it('keeps the two relays far apart, standable and reachable', () => {
    expect(arena.relays).toHaveLength(2);
    const [a, b] = arena.relays;
    if (a === undefined || b === undefined) throw new Error('relays');
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(15);
    for (const [i, r] of arena.relays.entries()) {
      expect(canStand(arena.map, r)).toBe(true);
      expect(relayAt(r, arena.relays)).toBe(i);
      expect(findPath(arena.map, arena.spawns[0] ?? r, r).ok).toBe(true);
    }
  });

  it('has a standable spot in every room, and the signing and audit checks follow the arena', () => {
    for (const room of ROOMS) {
      const spot = walkable(arena).find(([c, r]) => roomAt({ x: c + 0.5, y: r + 0.5 }, arena.regions) === room && canStand(arena.map, { x: c + 0.5, y: r + 0.5 }));
      expect(spot, room).toBeDefined();
      expect(arena.roomNames[room].length).toBeGreaterThan(3);
    }
    const hall = walkable(arena).find(([c, r]) => roomAt({ x: c + 0.5, y: r + 0.5 }, arena.regions) === 'signingHall') ?? [0, 0];
    expect(inSigningHall({ x: hall[0] + 0.5, y: hall[1] + 0.5 }, arena.regions)).toBe(true);
    const ledger = stationCenter('ledger', arena.stations);
    expect(atAuditDesk({ x: ledger.x, y: ledger.y + 1 }, arena.stations)).toBe(true);
  });
});

describe('Lightning Reef', () => {
  it('is a different place from the Citadel, with hard routes at its gateway', () => {
    expect(REEF.map.rows).not.toEqual(CITADEL.map.rows);
    expect(REEF.hardRoutes).toBe(true);
    expect(CITADEL.hardRoutes).toBe(false);
  });

  it('falls back to the Citadel for an unknown arena id', () => {
    expect(arenaById('reef')).toBe(REEF);
    expect(arenaById('atlantis')).toBe(CITADEL);
    expect(arenaById(undefined)).toBe(CITADEL);
  });
});

describe('opening Lightning Reef', () => {
  it('follows the island rule: Rank 8 or 12 Academy stars', async () => {
    const { islandOpenFor } = await import('../src/progression/world.js');
    const { SetArenaPayloadSchema } = await import('../src/schemas.js');
    expect(islandOpenFor('reef', 0, [])).toBe(false);
    expect(islandOpenFor('reef', 0, [3, 3, 3, 3])).toBe(true);
    expect(islandOpenFor('reef', 0, [3, 3, 3, 2])).toBe(false);
    expect(islandOpenFor('reef', 1e9, [])).toBe(true);
    // Corrupt star counts never open anything.
    expect(islandOpenFor('reef', 0, [Number.NaN, -40, Number.POSITIVE_INFINITY])).toBe(false);
    expect(islandOpenFor('atlantis', 1e9, [])).toBe(false);
    expect(SetArenaPayloadSchema.safeParse({ arena: 'reef' }).success).toBe(true);
    expect(SetArenaPayloadSchema.safeParse({ arena: 'moon' }).success).toBe(false);
    expect(SetArenaPayloadSchema.safeParse({ arena: 'reef', extra: 1 }).success).toBe(false);
  });
});

describe('the council seal', () => {
  it.each(ALL.map((a) => [a.id, a] as const))('on %s is in the square and covers the spawn ring', async (_, arena) => {
    const { atCouncilSeal } = await import('../src/meeting.js');
    expect(roomAt(arena.seal, arena.regions)).toBe('plaza');
    for (const s of arena.spawns) expect(atCouncilSeal(s, arena.seal)).toBe(true);
  });
});

describe('Watchtower Peaks', () => {
  it('splits into exactly two ranges while a partition is on, each holding one relay', async () => {
    const { PEAKS, movementMap } = await import('../src/arena.js');
    const cut = PEAKS.partitionMap;
    if (cut === null) throw new Error('peaks must have a partition map');
    expect(movementMap(PEAKS, false)).toBe(PEAKS.map);
    expect(movementMap(PEAKS, true)).toBe(cut);
    const flood = (from: [number, number]): Set<string> => {
      const seen = new Set([`${String(from[0])},${String(from[1])}`]);
      const queue = [from];
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const [c, r] = next;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const key = `${String(c + dc)},${String(r + dr)}`;
          if (!seen.has(key) && isWalkableTile(cut, c + dc, r + dr)) {
            seen.add(key);
            queue.push([c + dc, r + dr]);
          }
        }
      }
      return seen;
    };
    const tile = (p: { x: number; y: number }): [number, number] => [Math.floor(p.x), Math.floor(p.y)];
    const [west, east] = PEAKS.relays;
    if (west === undefined || east === undefined) throw new Error('relays');
    const westSide = flood(tile(west));
    const eastSide = flood(tile(east));
    expect(westSide.has(tile(east).join(','))).toBe(false);
    // Every walkable tile is on one side or the other.
    let total = 0;
    for (let r = 0; r < cut.height; r++) for (let c = 0; c < cut.width; c++) if (isWalkableTile(cut, c, r)) total++;
    expect(westSide.size + eastSide.size).toBe(total);
    // The square and the seal are on the west range; the gateway is on the east.
    expect(westSide.has(tile(PEAKS.seal).join(','))).toBe(true);
    expect(eastSide.has(`${String(PEAKS.stations.route.col)},${String(PEAKS.stations.route.row - 1)}`)).toBe(true);
    // Only bridge tiles come down.
    for (let r = 0; r < cut.height; r++) {
      for (let c = 0; c < cut.width; c++) {
        const before = tileAt(PEAKS.map, c, r);
        if (before !== tileAt(cut, c, r)) expect(before).toBe('=');
      }
    }
  });

  it('leaves the other arenas whole during a partition', async () => {
    const { movementMap } = await import('../src/arena.js');
    expect(movementMap(CITADEL, true)).toBe(CITADEL.map);
    expect(movementMap(REEF, true)).toBe(REEF.map);
  });
});
