import { describe, expect, it } from 'vitest';
import {
  CITY_MAP,
  CITY_SPAWNS,
  DANI_SPOT,
  DEVICE_HEAPS,
  DUMP_MARKS,
  DUMP_SCENES,
  DUMP_SCRIPT,
  DUMP_START,
  DUMP_STEPS,
  GATE_SPOT,
  HEAPS,
  KENNEL,
  PATROL,
  SPEAKERS,
  TORCH_RANGE,
  canDig,
  districtAt,
  heapCentre,
  inTorch,
  inYard,
  isHonest,
  readMs,
  scriptProblems,
  visibleLines,
  type Script,
} from '../src/city/index.js';
import { tileAt } from '../src/map.js';
import { canStand, findPath, isClearSegment } from '../src/pathfinding.js';

describe('the story script engine', () => {
  it('finds broken links, dead ends and unreachable nodes', () => {
    const bad: Script = {
      a: { lines: [{ who: 'rook', text: 'hi' }], next: 'missing' },
      b: { lines: [{ who: 'rook', text: 'alone' }], then: 'nowhere' },
      c: { lines: [], choices: [{ id: 'x', tag: 'X', text: 'x', go: 'a' }], seconds: 3 },
    };
    const problems = scriptProblems(bad, ['a'], ['done']);
    expect(problems).toContain('a -> missing missing');
    expect(problems).toContain('b hands back to unknown step nowhere');
    expect(problems).toContain('b is unreachable');
    expect(problems.some((p) => p.startsWith('c has a clock without'))).toBe(true);
    expect(problems).toContain('c says nothing');
  });

  it('shows lines by what characters remember, and paces reading by length', () => {
    const node = DUMP_SCRIPT['ask'];
    if (node === undefined) throw new Error('ask');
    expect(visibleLines(node, new Set()).map((l) => l.text)).toEqual(['Ask me nicely.']);
    expect(visibleLines(node, new Set(['askedOnce'])).map((l) => l.text)).toEqual(['Again. Nicely.']);
    const given = DUMP_SCRIPT['given'];
    if (given === undefined) throw new Error('given');
    expect(readMs(given, new Set(['apologised', 'liedDani']))).toBeGreaterThan(readMs(given, new Set()));
    for (const n of Object.values(DUMP_SCRIPT)) expect(readMs(n, new Set())).toBeLessThanOrEqual(30_000);
  });
});

describe('act one: The Dump', () => {
  it('has a sound script: every node reachable, every choice leads somewhere, every scene hands back', () => {
    expect(scriptProblems(DUMP_SCRIPT, Object.values(DUMP_SCENES), DUMP_STEPS)).toEqual([]);
    for (const node of Object.values(DUMP_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(Object.keys(DUMP_MARKS)).toContain(m);
      }
      for (const m of [node.mark, ...(node.choices ?? []).map((c) => c.mark)]) if (m !== undefined) expect(Object.keys(DUMP_MARKS)).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
      if (node.seconds !== undefined) expect(node.seconds).toBeGreaterThanOrEqual(6);
    }
    expect(DUMP_SCRIPT['selfie']?.then).toBe('done');
  });

  it('gives the winter clue only to players who listened', () => {
    const marksAfter = (path: readonly string[]): string[] =>
      path.flatMap((id) => {
        const mark = DUMP_SCRIPT[id]?.mark;
        return mark === undefined ? [] : [mark];
      });
    expect(marksAfter(['daniCalm'])).toContain('clueWinter');
    expect(marksAfter(['daniSilence', 'daniWinter'])).toContain('clueWinter');
    expect(marksAfter(['daniAnger'])).not.toContain('clueWinter');
    expect(marksAfter(['magsPay', 'magsWinter'])).toEqual(['clueSkip', 'clueWinter']);
  });

  it('counts honesty from the honest choices only', () => {
    expect(isHonest(['honestDani'])).toBe(true);
    expect(isHonest(['apologised'])).toBe(true);
    expect(isHonest(['liedDani', 'bluffedMags', 'askedOnce'])).toBe(false);
  });

  it('puts every place on open ground the player can walk to', () => {
    const from = CITY_SPAWNS[0];
    if (from === undefined) throw new Error('spawn');
    for (const [name, spot] of Object.entries({ DUMP_START, DANI_SPOT, GATE_SPOT, KENNEL })) {
      expect(canStand(CITY_MAP, spot), name).toBe(true);
      expect(findPath(CITY_MAP, DUMP_START, spot).ok, name).toBe(true);
    }
    expect(districtAt(GATE_SPOT)?.id).toBe('gullmoor');
    expect(Math.hypot(DANI_SPOT.x - GATE_SPOT.x, DANI_SPOT.y - GATE_SPOT.y)).toBeGreaterThan(40);
  });

  it('buries the device in a winter 2013 heap that can be reached and dug', () => {
    expect(HEAPS.filter((h) => h.winter)).toHaveLength(3);
    expect(HEAPS.filter((h) => h.bySkip)).toHaveLength(1);
    expect(DEVICE_HEAPS).toHaveLength(2);
    for (const i of DEVICE_HEAPS) expect(HEAPS[i]?.bySkip).toBe(false);
    expect(new Set(HEAPS.map((h) => h.tile.join(','))).size).toBe(HEAPS.length);
    for (const h of HEAPS) {
      expect(tileAt(CITY_MAP, h.tile[0], h.tile[1]), h.label).toBe('M');
      expect(inYard(heapCentre(h))).toBe(true);
      const spots = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc = 0, dr = 0]) => ({ x: h.tile[0] + dc + 0.5, y: h.tile[1] + dr + 0.5 })).filter((p) => canStand(CITY_MAP, p) && canDig(p, h));
      expect(spots.length, h.label).toBeGreaterThan(0);
      expect(spots.some((p) => findPath(CITY_MAP, GATE_SPOT, p).ok), h.label).toBe(true);
    }
  });

  it('walks Ivor on clear ground, and his torch is a cone that heaps block', () => {
    for (let i = 0; i < PATROL.length; i++) {
      const a = PATROL[i];
      const b = PATROL[(i + 1) % PATROL.length];
      if (a === undefined || b === undefined) throw new Error('patrol');
      expect(isClearSegment(CITY_MAP, a, b), `leg ${String(i)}`).toBe(true);
      expect(inYard(a)).toBe(true);
    }
    const guard = { x: 13.5, y: 19.5 };
    expect(inTorch(guard, 0, { x: 16, y: 19.5 })).toBe(true);
    expect(inTorch(guard, Math.PI, { x: 16, y: 19.5 })).toBe(false);
    expect(inTorch(guard, 0, { x: 13.5 + TORCH_RANGE + 0.5, y: 19.5 })).toBe(false);
    expect(inTorch({ x: 11.5, y: 22.5 }, -Math.PI / 2, { x: 11.5, y: 19.5 })).toBe(false);
    expect(inTorch({ x: 12.5, y: 22.5 }, -Math.PI / 2, { x: 12.5, y: 19.5 })).toBe(true);
    for (const p of PATROL) expect(Math.hypot(p.x - GATE_SPOT.x, p.y - GATE_SPOT.y)).toBeGreaterThan(TORCH_RANGE + 1);
  });
});
