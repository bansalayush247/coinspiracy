import { describe, expect, it } from 'vitest';
import { CITADEL_MAP, isBlocked, isWalkableTile, roomAt, tileAt } from '../src/map.js';
import { PLAYER_RADIUS } from '../src/movement.js';
import {
  ALL_TASKS,
  STATION_PROMPT_RANGE,
  STATION_RANGE,
  TASK_KINDS,
  TASK_STATIONS,
  TASK_TIMING,
  consensusPercent,
  countTasks,
  hasTask,
  inStationRange,
  stationCenter,
  stationNear,
  taskBit,
} from '../src/tasks.js';

describe('task stations', () => {
  it.each(TASK_KINDS)('puts the %s station on an S tile inside its room', (kind) => {
    const s = TASK_STATIONS[kind];
    expect(s.kind).toBe(kind);
    expect(tileAt(CITADEL_MAP, s.col, s.row)).toBe('S');
    expect(roomAt(stationCenter(kind))).toBe(s.room);
  });

  it('has an S tile for every station and no others', () => {
    let count = 0;
    for (const row of CITADEL_MAP.rows) count += row.split('S').length - 1;
    expect(count).toBe(TASK_KINDS.length);
  });

  it.each(TASK_KINDS)('leaves somewhere to stand in prompt range of the %s station', (kind) => {
    const s = TASK_STATIONS[kind];
    const spots = [
      [s.col + 1, s.row],
      [s.col - 1, s.row],
      [s.col, s.row + 1],
      [s.col, s.row - 1],
    ].filter(([c, r]) => isWalkableTile(CITADEL_MAP, c ?? -1, r ?? -1));
    const standable = spots.map(([c = 0, r = 0]) => ({ x: c + 0.5, y: r + 0.5 })).filter((p) => !isBlocked(CITADEL_MAP, p, PLAYER_RADIUS));
    expect(standable.length).toBeGreaterThan(0);
    for (const p of standable) expect(inStationRange(p, kind, STATION_PROMPT_RANGE)).toBe(true);
  });

  it('keeps the prompt range inside the server range, so the button never offers a refused open', () => {
    expect(STATION_PROMPT_RANGE).toBeLessThan(STATION_RANGE);
  });

  it('measures range from the station centre and rejects non-finite positions', () => {
    const c = stationCenter('ledger');
    expect(inStationRange({ x: c.x, y: c.y + STATION_RANGE }, 'ledger')).toBe(true);
    expect(inStationRange({ x: c.x, y: c.y + STATION_RANGE + 0.01 }, 'ledger')).toBe(false);
    expect(inStationRange({ x: Number.NaN, y: c.y }, 'ledger')).toBe(false);
    expect(inStationRange({ x: Infinity, y: c.y }, 'ledger')).toBe(false);
  });

  it('finds the nearest station in range, or none', () => {
    const c = stationCenter('watchtower');
    expect(stationNear({ x: c.x, y: c.y + 1 })).toBe('watchtower');
    expect(stationNear({ x: 15, y: 15 })).toBeNull();
    expect(stationNear({ x: c.x, y: c.y + 1.6 }, STATION_PROMPT_RANGE)).toBeNull();
  });

  it('keeps stations far enough apart that only one is ever in range', () => {
    for (const a of TASK_KINDS) {
      for (const b of TASK_KINDS) {
        if (a === b) continue;
        const ca = stationCenter(a);
        const cb = stationCenter(b);
        expect(Math.hypot(ca.x - cb.x, ca.y - cb.y)).toBeGreaterThan(2 * STATION_RANGE);
      }
    }
  });
});

describe('task masks', () => {
  it('gives every kind its own bit and ALL_TASKS all of them', () => {
    const bits = TASK_KINDS.map(taskBit);
    expect(new Set(bits).size).toBe(TASK_KINDS.length);
    expect(bits.reduce((a, b) => a | b, 0)).toBe(ALL_TASKS);
    expect(countTasks(ALL_TASKS)).toBe(TASK_KINDS.length);
  });

  it('reads bits and ignores junk masks', () => {
    expect(hasTask(taskBit('route'), 'route')).toBe(true);
    expect(hasTask(taskBit('route'), 'ledger')).toBe(false);
    expect(hasTask(1.5, 'deposit')).toBe(false);
    expect(hasTask(Number.NaN, 'deposit')).toBe(false);
    expect(countTasks(0)).toBe(0);
    expect(countTasks(taskBit('deposit') | taskBit('watchtower'))).toBe(2);
  });
});

describe('consensusPercent', () => {
  it.each([
    [0, 16, 0],
    [1, 16, 6],
    [15, 16, 93],
    [16, 16, 100],
    [17, 16, 100],
    [3, 0, 0],
    [-1, 16, 0],
    [1.5, 16, 0],
    [Number.NaN, 16, 0],
  ])('%s of %s tasks is %s%%', (done, total, percent) => {
    expect(consensusPercent(done, total)).toBe(percent);
  });

  it('reaches 100 only when every task is done', () => {
    for (let total = 1; total <= 36; total++) {
      for (let done = 0; done < total; done++) expect(consensusPercent(done, total)).toBeLessThan(100);
      expect(consensusPercent(total, total)).toBe(100);
    }
  });
});

describe('TASK_TIMING', () => {
  it('gives every task a minimum solve time well inside the expiry', () => {
    for (const kind of TASK_KINDS) {
      expect(TASK_TIMING.minSolveMs[kind]).toBeGreaterThan(0);
      expect(TASK_TIMING.minSolveMs[kind]).toBeLessThan(TASK_TIMING.expireMs / 10);
    }
    expect(TASK_TIMING.retryMs).toBeGreaterThan(0);
  });
});
