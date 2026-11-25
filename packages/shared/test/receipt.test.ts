import { describe, expect, it } from 'vitest';
import {
  BOATS,
  BOAT_NOTES,
  CITY_MAP,
  COOP_YARD,
  DECKHAND_BACKS,
  DECKHAND_ROUTES,
  DECKHAND_SPEED,
  HARBOUR_OFFICE,
  JETTY_MARKS,
  RECEIPT_ACT,
  RECEIPT_SCRIPT,
  SPEAKERS,
  STORY_ACTS,
  TIDE_MS,
  districtAt,
  honestIn,
  inTorch,
  nextOf,
  sceneStarts,
  scriptProblems,
  walkRoute,
  type Walker,
} from '../src/city/index.js';
import type { Vec2 } from '../src/map.js';
import { PLAYER_SPEED } from '../src/movement.js';
import { canStand, findPath, isClearSegment, pathLength } from '../src/pathfinding.js';

const routes = DECKHAND_ROUTES.map((route) => ({ route, speed: DECKHAND_SPEED }));

// The longest stretch, in seconds over two minutes, that a spot spends out of every lantern.
function darkestStretch(spot: Vec2): number {
  const dt = 0.05;
  let walkers: Walker[] = routes.map((r) => ({ x: r.route[0]?.x ?? 0, y: r.route[0]?.y ?? 0, facing: 0, leg: 0 }));
  let unlit = 0;
  let best = 0;
  for (let t = 0; t < 120; t += dt) {
    walkers = walkers.map((w, i) => walkRoute(w, routes[i]?.route ?? [], routes[i]?.speed ?? 1, dt));
    unlit = walkers.some((w) => inTorch(w, w.facing, spot)) ? 0 : unlit + dt;
    best = Math.max(best, unlit);
  }
  return best;
}

const walk = (from: Vec2, to: Vec2): number => {
  const path = findPath(CITY_MAP, from, to);
  if (!path.ok) throw new Error('no path');
  return pathLength(from, path.value) / PLAYER_SPEED;
};

describe('season two, act three: The Old Receipt', () => {
  it('follows The Split, with a sound script, every speaker and mark known, and a clock', () => {
    expect(Object.keys(STORY_ACTS).slice(5, 7)).toEqual(['split', 'receipt']);
    expect(scriptProblems(RECEIPT_SCRIPT, sceneStarts(RECEIPT_ACT), RECEIPT_ACT.steps)).toEqual([]);
    const marks = Object.keys(RECEIPT_ACT.marks);
    for (const node of Object.values(RECEIPT_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(marks).toContain(m);
      }
      for (const m of [node.mark, node.jump?.if, ...(node.choices ?? []).map((c) => c.mark)]) if (m !== undefined) expect(marks).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
    }
    expect(RECEIPT_ACT.clockLabel).toBeDefined();
    expect(RECEIPT_SCRIPT['tideTurned']?.then).toBe('done');
    expect(honestIn(RECEIPT_ACT, ['calmedNell'])).toBe(true);
    expect(honestIn(RECEIPT_ACT, ['rushedNell', 'hurriedOzzy', 'gloated'])).toBe(false);
  });

  it('has Nell name the right jetty, whichever one it is, only when she is helped to remember', () => {
    const lineFor = (jetty: string): string => {
      const marks = new Set([jetty]);
      let id: string | undefined = 'coopCalm';
      const seen: string[] = [];
      while (id !== undefined && id !== 'coopEnd') {
        seen.push(id);
        const node: (typeof RECEIPT_SCRIPT)[string] | undefined = RECEIPT_SCRIPT[id];
        id = node === undefined ? undefined : nextOf(node, marks);
      }
      return seen.at(-1) ?? '';
    };
    expect(JETTY_MARKS.map(lineFor)).toEqual(['coopNorth', 'coopMiddleSaid', 'coopSouth']);
    const rush = RECEIPT_SCRIPT['coopRush'];
    expect(rush?.next).toBe('coopEnd');
    expect(new Set(BOATS.map((b) => b.jetty)).size).toBe(3);
    expect(BOAT_NOTES.length).toBeGreaterThanOrEqual(BOATS.length - 1);
  });

  it('puts the co-op, the boats and the harbour office on the docks, where the crew can walk', () => {
    for (const p of [RECEIPT_ACT.start, COOP_YARD, HARBOUR_OFFICE, ...BOATS.map((b) => b.at), ...DECKHAND_BACKS]) {
      expect(canStand(CITY_MAP, p), JSON.stringify(p)).toBe(true);
      expect(findPath(CITY_MAP, RECEIPT_ACT.start, p).ok, JSON.stringify(p)).toBe(true);
    }
    for (const p of [COOP_YARD, HARBOUR_OFFICE]) expect(districtAt(p)?.id).toBe('docks');
  });

  it('walks the deckhands on clear jetties, never lights the shore, and gives every boat time to be searched', () => {
    for (const route of DECKHAND_ROUTES) for (let i = 0; i < route.length; i++) expect(isClearSegment(CITY_MAP, route[i] ?? COOP_YARD, route[(i + 1) % route.length] ?? COOP_YARD)).toBe(true);
    for (const back of DECKHAND_BACKS) expect(darkestStretch(back), JSON.stringify(back)).toBeGreaterThan(119);
    for (const b of BOATS) expect(darkestStretch(b.at), b.label).toBeGreaterThan(RECEIPT_ACT.workMs / 1000 + 3);
  });

  it('gives a lone player time to search every boat and still beat the tide to the office', () => {
    let at = COOP_YARD;
    let seconds = 0;
    const left = [...BOATS];
    while (left.length > 0) {
      left.sort((a, b) => Math.hypot(a.at.x - at.x, a.at.y - at.y) - Math.hypot(b.at.x - at.x, b.at.y - at.y));
      const next = left.shift();
      if (next === undefined) break;
      seconds += walk(at, next.at) + RECEIPT_ACT.workMs / 1000;
      at = next.at;
    }
    seconds += walk(at, HARBOUR_OFFICE);
    expect(seconds).toBeLessThan((TIDE_MS / 1000) * 0.5);
  });
});
