import { describe, expect, it } from 'vitest';
import { CITADEL_MAP, SPAWN_POINTS, isWalkableTile, type CitadelMap, type Vec2 } from '../src/map.js';
import { PLAYER_RADIUS, PLAYER_SPEED, TICK_SECONDS, stepMovement } from '../src/movement.js';
import {
  MAX_NEAR_RANGE,
  MAX_PATH_RADIUS,
  MAX_PATH_TILES,
  canStand,
  clearReaches,
  findPath,
  findPathNear,
  isClearSegment,
  pathLength,
  steerInput,
  type PathOptions,
  type PathResult,
} from '../src/pathfinding.js';
import { MovePayloadSchema } from '../src/schemas.js';
import { STATION_PROMPT_RANGE, STATION_RANGE, TASK_KINDS, TASK_STATIONS, stationCenter } from '../src/tasks.js';

const STEP = PLAYER_SPEED * TICK_SECONDS;

function testMap(rows: readonly string[]): CitadelMap {
  return { width: rows[0]?.length ?? 0, height: rows.length, rows };
}

function path(result: PathResult): Vec2[] {
  if (!result.ok) throw new Error(`no path: ${result.error}`);
  return result.value;
}

// Every point of the segment, sampled finely, fits the real footprint.
function walkableSegment(map: CitadelMap, a: Vec2, b: Vec2, options: PathOptions = {}): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.01));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (!canStand(map, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, { ...options, radius: PLAYER_RADIUS })) return false;
  }
  return true;
}

// Walks the waypoints with the real movement step, as a bot would; returns where it stopped.
function walk(map: CitadelMap, from: Vec2, waypoints: readonly Vec2[], maxTicks = 4000): { end: Vec2; ticks: number } {
  let pos = from;
  let ticks = 0;
  for (const wp of waypoints) {
    while (Math.hypot(wp.x - pos.x, wp.y - pos.y) > 1e-6) {
      const next = stepMovement(pos, steerInput(pos, wp), TICK_SECONDS, map);
      if (next.x === pos.x && next.y === pos.y) throw new Error(`stuck at ${String(pos.x)},${String(pos.y)}`);
      pos = next;
      ticks += 1;
      if (ticks > maxTicks) throw new Error('walk did not finish');
    }
  }
  return { end: pos, ticks };
}

function walkableTileCenters(map: CitadelMap): Vec2[] {
  const out: Vec2[] = [];
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) if (isWalkableTile(map, col, row)) out.push({ x: col + 0.5, y: row + 0.5 });
  }
  return out;
}

// Small deterministic generator so the sweep below is reproducible.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('findPathNear on the citadel', () => {
  it('reaches every task station from every spawn point', () => {
    for (const spawn of SPAWN_POINTS) {
      for (const kind of TASK_KINDS) {
        const station = stationCenter(kind);
        const waypoints = path(findPathNear(CITADEL_MAP, spawn, station, STATION_PROMPT_RANGE));
        expect(waypoints.length).toBeGreaterThan(0);
        const last = waypoints[waypoints.length - 1];
        if (last === undefined) throw new Error('empty path');
        expect(Math.hypot(last.x - station.x, last.y - station.y)).toBeLessThanOrEqual(STATION_PROMPT_RANGE);
        let at = spawn;
        for (const wp of waypoints) {
          expect(canStand(CITADEL_MAP, wp)).toBe(true);
          expect(walkableSegment(CITADEL_MAP, at, wp)).toBe(true);
          at = wp;
        }
      }
    }
  });

  it('gets a walker into server range of every station with the real movement step', () => {
    for (const spawn of SPAWN_POINTS) {
      for (const kind of TASK_KINDS) {
        const station = stationCenter(kind);
        const { end, ticks } = walk(CITADEL_MAP, spawn, path(findPathNear(CITADEL_MAP, spawn, station, STATION_PROMPT_RANGE)));
        expect(Math.hypot(end.x - station.x, end.y - station.y)).toBeLessThanOrEqual(STATION_RANGE);
        // Nothing on the map is more than about 25 seconds of walking away.
        expect(ticks).toBeLessThan(500);
      }
    }
  });

  it('never stands on a station tile, which blocks', () => {
    for (const kind of TASK_KINDS) {
      const s = TASK_STATIONS[kind];
      const waypoints = path(findPathNear(CITADEL_MAP, SPAWN_POINTS[0] ?? { x: 15, y: 15 }, stationCenter(kind), STATION_PROMPT_RANGE));
      for (const wp of waypoints) expect(Math.floor(wp.x) === s.col && Math.floor(wp.y) === s.row).toBe(false);
    }
  });

  it('returns an empty path when already in range', () => {
    const station = stationCenter('ledger');
    expect(findPathNear(CITADEL_MAP, { x: station.x, y: station.y + 1 }, station, STATION_PROMPT_RANGE)).toStrictEqual({ ok: true, value: [] });
  });

  it('refuses a target with no open tile in range', () => {
    expect(findPathNear(CITADEL_MAP, { x: 15, y: 15 }, { x: 0.5, y: 0.5 }, 0.6)).toStrictEqual({ ok: false, error: 'goalBlocked' });
  });
});

describe('findPath on the citadel', () => {
  it('walks between any two walkable tiles across the whole map', () => {
    const tiles = walkableTileCenters(CITADEL_MAP);
    const next = lcg(7);
    for (let i = 0; i < 250; i++) {
      const from = tiles[Math.floor(next() * tiles.length)];
      const to = tiles[Math.floor(next() * tiles.length)];
      if (from === undefined || to === undefined) throw new Error('no tiles');
      const { end } = walk(CITADEL_MAP, from, path(findPath(CITADEL_MAP, from, to)));
      expect(Math.hypot(end.x - to.x, end.y - to.y)).toBeLessThan(1e-6);
    }
  });

  it('starts from off-centre positions near walls', () => {
    // Flush against the left wall of the vault corridor and the bottom edge of the deposit gate.
    for (const from of [
      { x: 1 + PLAYER_RADIUS + 1e-6, y: 9.5 },
      { x: 3.5, y: 27 - PLAYER_RADIUS - 1e-6 },
      { x: 26.75, y: 21.2 },
    ]) {
      expect(canStand(CITADEL_MAP, from)).toBe(true);
      const to = { x: 20.5, y: 12.5 };
      const { end } = walk(CITADEL_MAP, from, path(findPath(CITADEL_MAP, from, to)));
      expect(Math.hypot(end.x - to.x, end.y - to.y)).toBeLessThan(1e-6);
    }
  });

  it('keeps smoothed segments clear of walls with margin', () => {
    const tiles = walkableTileCenters(CITADEL_MAP);
    const next = lcg(11);
    for (let i = 0; i < 100; i++) {
      const from = tiles[Math.floor(next() * tiles.length)];
      const to = tiles[Math.floor(next() * tiles.length)];
      if (from === undefined || to === undefined) throw new Error('no tiles');
      let at = from;
      for (const wp of path(findPath(CITADEL_MAP, from, to))) {
        expect(isClearSegment(CITADEL_MAP, at, wp)).toBe(true);
        at = wp;
      }
    }
  });

  it('is deterministic', () => {
    const run = (): PathResult[] =>
      SPAWN_POINTS.flatMap((spawn) => TASK_KINDS.map((kind) => findPathNear(CITADEL_MAP, spawn, stationCenter(kind), STATION_PROMPT_RANGE)));
    const first = run();
    findPath(CITADEL_MAP, { x: 2.5, y: 9.5 }, { x: 25.5, y: 6.5 });
    expect(run()).toStrictEqual(first);
  });

  it('returns an empty path from a point to itself and a single waypoint inside one tile', () => {
    expect(findPath(CITADEL_MAP, { x: 15.5, y: 15.5 }, { x: 15.5, y: 15.5 })).toStrictEqual({ ok: true, value: [] });
    expect(path(findPath(CITADEL_MAP, { x: 15.2, y: 15.5 }, { x: 15.7, y: 15.4 }))).toStrictEqual([{ x: 15.7, y: 15.4 }]);
  });

  it('never makes a smoothed path longer than the tile path', () => {
    const from = { x: 2.5, y: 25.5 };
    const to = { x: 25.5, y: 5.5 };
    const smooth = path(findPath(CITADEL_MAP, from, to));
    const tiles = path(findPath(CITADEL_MAP, from, to, { smooth: false }));
    expect(smooth.length).toBeLessThan(tiles.length);
    expect(pathLength(from, smooth)).toBeLessThanOrEqual(pathLength(from, tiles) + 1e-9);
  });
});

describe('grid rules', () => {
  it('takes the octile-optimal route and smooths open ground into one segment', () => {
    const rows = ['#'.repeat(20), ...Array.from({ length: 18 }, () => `#${'.'.repeat(18)}#`), '#'.repeat(20)];
    const open = testMap(rows);
    const from = { x: 1.5, y: 1.5 };
    const to = { x: 15.5, y: 8.5 };
    const tiles = path(findPath(open, from, to, { smooth: false }));
    // 7 diagonal and 7 straight steps; the last one ends on the goal point.
    expect(tiles).toHaveLength(14);
    expect(tiles[13]).toStrictEqual(to);
    expect(pathLength(from, tiles)).toBeCloseTo(7 * Math.SQRT2 + 7, 9);
    expect(path(findPath(open, from, to))).toStrictEqual([to]);
  });

  it('does not cut corners diagonally', () => {
    const map = testMap(['#####', '#.#.#', '#...#', '#####']);
    const tiles = path(findPath(map, { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }, { smooth: false }));
    expect(tiles.map((p) => [Math.floor(p.x), Math.floor(p.y)])).toStrictEqual([
      [1, 2],
      [2, 2],
      [3, 2],
      [3, 1],
    ]);
    const smooth = path(findPath(map, { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }));
    expect(smooth).toStrictEqual([
      { x: 1.5, y: 2.5 },
      { x: 3.5, y: 2.5 },
      { x: 3.5, y: 1.5 },
    ]);
    const { end } = walk(map, { x: 1.5, y: 1.5 }, smooth);
    expect(Math.hypot(end.x - 3.5, end.y - 1.5)).toBeLessThan(1e-6);
  });

  it('passes a one-tile corridor on its centre line', () => {
    const map = testMap(['#######', '#.....#', '###.###', '#.....#', '#######']);
    const from = { x: 1.5, y: 1.5 };
    const to = { x: 5.5, y: 3.5 };
    const { end } = walk(map, from, path(findPath(map, from, to)));
    expect(Math.hypot(end.x - to.x, end.y - to.y)).toBeLessThan(1e-6);
  });

  it('reports an unreachable goal', () => {
    const map = testMap(['#####', '#.#.#', '#####']);
    expect(findPath(map, { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 })).toStrictEqual({ ok: false, error: 'noPath' });
    expect(findPathNear(map, { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }, 0.5)).toStrictEqual({ ok: false, error: 'noPath' });
  });
});

describe('extra blocked tiles', () => {
  const corridor = testMap(['#######', '#.....#', '#######']);

  it('treats predicate tiles as walls and asks once per tile with integer coordinates', () => {
    const calls = new Map<string, number>();
    const door = (col: number, row: number): boolean => {
      expect(Number.isInteger(col) && Number.isInteger(row)).toBe(true);
      const key = `${String(col)},${String(row)}`;
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return col === 3;
    };
    expect(findPath(corridor, { x: 1.5, y: 1.5 }, { x: 5.5, y: 1.5 }, { blocked: door })).toStrictEqual({ ok: false, error: 'noPath' });
    expect([...calls.values()].every((n) => n === 1)).toBe(true);
    expect(path(findPath(corridor, { x: 1.5, y: 1.5 }, { x: 5.5, y: 1.5 }, { blocked: () => false }))).toStrictEqual([{ x: 5.5, y: 1.5 }]);
  });

  it('routes around a closed door on the citadel', () => {
    // Close the whole plaza crossing at column 14 except one gap at row 12.
    const blocked = (col: number, row: number): boolean => col === 14 && row !== 12;
    const from = { x: 11.5, y: 16.5 };
    const to = { x: 17.5, y: 16.5 };
    const waypoints = path(findPath(CITADEL_MAP, from, to, { blocked }));
    let at = from;
    for (const wp of waypoints) {
      expect(walkableSegment(CITADEL_MAP, at, wp, { blocked })).toBe(true);
      at = wp;
    }
    // Up four rows to the gap and back down: at least two 3-4-5 legs.
    expect(pathLength(from, waypoints)).toBeGreaterThan(9.9);
  });

  it('lets a walker leave a tile that has just been blocked under it', () => {
    const blocked = (col: number): boolean => col === 2;
    expect(path(findPath(corridor, { x: 2.5, y: 1.5 }, { x: 4.5, y: 1.5 }, { blocked }))).toStrictEqual([{ x: 4.5, y: 1.5 }]);
    expect(findPath(corridor, { x: 1.5, y: 1.5 }, { x: 4.5, y: 1.5 }, { blocked })).toStrictEqual({ ok: false, error: 'noPath' });
  });

  it('refuses a goal on a blocked tile', () => {
    expect(findPath(corridor, { x: 1.5, y: 1.5 }, { x: 4.5, y: 1.5 }, { blocked: (col) => col === 4 })).toStrictEqual({ ok: false, error: 'goalBlocked' });
  });
});

describe('bounds and bad input', () => {
  const from = { x: 15.5, y: 15.5 };
  const far = { x: 3.5, y: 26.5 };

  it('stops after the expansion budget', () => {
    expect(findPath(CITADEL_MAP, from, far, { maxExpansions: 5 })).toStrictEqual({ ok: false, error: 'searchLimit' });
    expect(findPath(CITADEL_MAP, from, far, { maxExpansions: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
  });

  it('refuses non-finite and off-grid points', () => {
    for (const bad of [
      { x: Number.NaN, y: 1 },
      { x: 1, y: Number.POSITIVE_INFINITY },
      { x: -0.5, y: 3.5 },
      { x: 3.5, y: CITADEL_MAP.height },
    ]) {
      expect(findPath(CITADEL_MAP, bad, from)).toStrictEqual({ ok: false, error: 'invalidInput' });
      expect(findPath(CITADEL_MAP, from, bad)).toStrictEqual({ ok: false, error: 'invalidInput' });
      expect(findPathNear(CITADEL_MAP, bad, from, 1)).toStrictEqual({ ok: false, error: 'invalidInput' });
      expect(canStand(CITADEL_MAP, bad)).toBe(false);
      expect(isClearSegment(CITADEL_MAP, bad, from)).toBe(false);
    }
    expect(findPathNear(CITADEL_MAP, from, { x: Number.NaN, y: 0 }, 1)).toStrictEqual({ ok: false, error: 'invalidInput' });
  });

  it('refuses bad options', () => {
    for (const options of [
      { radius: -0.1 },
      { radius: MAX_PATH_RADIUS + 0.01 },
      { radius: Number.NaN },
      { maxExpansions: 0 },
      { maxExpansions: 2.5 },
      { maxExpansions: Number.NaN },
    ] satisfies PathOptions[]) {
      expect(findPath(CITADEL_MAP, from, far, options)).toStrictEqual({ ok: false, error: 'invalidInput' });
    }
    for (const range of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_NEAR_RANGE + 0.1]) {
      expect(findPathNear(CITADEL_MAP, from, far, range)).toStrictEqual({ ok: false, error: 'invalidInput' });
    }
  });

  it('refuses malformed and oversized maps', () => {
    const huge = { width: 300, height: 300, rows: Array.from({ length: 300 }, () => '.'.repeat(300)) };
    expect(huge.width * huge.height).toBeGreaterThan(MAX_PATH_TILES);
    expect(findPath(huge, { x: 1.5, y: 1.5 }, { x: 2.5, y: 2.5 })).toStrictEqual({ ok: false, error: 'invalidInput' });
    expect(findPath({ width: 0, height: 0, rows: [] }, { x: 0, y: 0 }, { x: 0, y: 0 })).toStrictEqual({ ok: false, error: 'invalidInput' });
    expect(findPath({ width: 3, height: 2, rows: ['...'] }, { x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 })).toStrictEqual({ ok: false, error: 'invalidInput' });
  });

  it('separates a blocked start from a blocked goal', () => {
    expect(findPath(CITADEL_MAP, { x: 0.5, y: 0.5 }, from)).toStrictEqual({ ok: false, error: 'startBlocked' });
    expect(findPath(CITADEL_MAP, from, { x: 0.5, y: 0.5 })).toStrictEqual({ ok: false, error: 'goalBlocked' });
    // Inside a floor tile, but the footprint overlaps the wall to its left.
    expect(findPath(CITADEL_MAP, from, { x: 1.1, y: 9.5 })).toStrictEqual({ ok: false, error: 'goalBlocked' });
  });
});

describe('steerInput', () => {
  it('heads at full speed while far and lands exactly on the target', () => {
    const far = steerInput({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1, 12);
    const near = steerInput({ x: 5, y: 5 }, { x: 5 + STEP / 2, y: 5 });
    expect(near.x).toBeCloseTo(0.5, 12);
    const landed = stepMovement({ x: 15, y: 15 }, steerInput({ x: 15, y: 15 }, { x: 15.1, y: 15.05 }), TICK_SECONDS);
    expect(landed.x).toBeCloseTo(15.1, 12);
    expect(landed.y).toBeCloseTo(15.05, 12);
    expect(steerInput({ x: 2, y: 2 }, { x: 2, y: 2 })).toStrictEqual({ x: 0, y: 0 });
    expect(steerInput({ x: 2, y: 2 }, { x: Number.NaN, y: 2 })).toStrictEqual({ x: 0, y: 0 });
  });

  it('always produces a valid move payload', () => {
    const next = lcg(3);
    for (let i = 0; i < 2000; i++) {
      const a = { x: next() * 30, y: next() * 30 };
      const b = { x: a.x + (next() - 0.5) * 10 ** Math.floor(next() * 6 - 3), y: a.y + (next() - 0.5) * 10 ** Math.floor(next() * 6 - 3) };
      const input = steerInput(a, b);
      expect(MovePayloadSchema.safeParse({ seq: 1, dx: input.x, dy: input.y }).success).toBe(true);
    }
  });

  it('reaches along each ray exactly as far as a straight clear walk goes', () => {
    const max = 8;
    const angles = Array.from({ length: 48 }, (_, i) => (i * Math.PI) / 24);
    let cut = 0;
    for (const eye of SPAWN_POINTS) {
      const reach = clearReaches(CITADEL_MAP, eye, angles, max);
      angles.forEach((a, i) => {
        const r = reach[i] ?? -1;
        const at = (d: number): Vec2 => ({ x: eye.x + Math.cos(a) * d, y: eye.y + Math.sin(a) * d });
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(max);
        expect(isClearSegment(CITADEL_MAP, eye, at(Math.max(0, r - 0.1)))).toBe(true);
        if (r < max) {
          cut++;
          expect(isClearSegment(CITADEL_MAP, eye, at(r + 0.1))).toBe(false);
        }
      });
    }
    expect(cut).toBeGreaterThan(0);
    expect(clearReaches(CITADEL_MAP, { x: -1, y: -1 }, angles, max).every((r) => r === 0)).toBe(true);
    expect(clearReaches(CITADEL_MAP, SPAWN_POINTS[0] ?? { x: 0, y: 0 }, angles, Number.NaN).every((r) => r === 0)).toBe(true);
  });
});
