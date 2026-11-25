import { describe, expect, it } from 'vitest';
import {
  AERIAL,
  AERIAL_REACH,
  ALERT_ACT,
  ALERT_SCRIPT,
  CITY_MAP,
  GATE_SPOT,
  HATCH,
  MAGS_GAP,
  MAGS_HEAR,
  MAGS_SPEED,
  SPEAKERS,
  STORY_ACTS,
  VOLUNTEER_ROUTES,
  VOLUNTEER_SPEED,
  carriedMarks,
  districtAt,
  follow,
  follower,
  honestIn,
  inTorch,
  sceneStarts,
  scriptProblems,
  walkPath,
  walkRoute,
  type Follower,
  type Walker,
} from '../src/city/index.js';
import type { Vec2 } from '../src/map.js';
import { PLAYER_SPEED } from '../src/movement.js';
import { canStand, findPath, isClearSegment } from '../src/pathfinding.js';

const HAVENS: readonly Vec2[] = [
  { x: 33.5, y: 27.5 },
  { x: 33.5, y: 17.5 },
  { x: 34.5, y: 4.5 },
  { x: 25.5, y: 3.5 },
  { x: 18.5, y: 3.5 },
];
const DT = 0.05;

interface World {
  readonly t: number;
  readonly volunteers: readonly Walker[];
  readonly mags: Follower;
  readonly me: Walker;
  readonly path: readonly Vec2[];
}

const lit = (w: World, p: Vec2): boolean => w.volunteers.some((v) => inTorch(v, v.facing, p));

function tick(w: World): World {
  const volunteers = w.volunteers.map((v, i) => walkRoute(v, VOLUNTEER_ROUTES[i] ?? [], VOLUNTEER_SPEED, DT));
  const lag = Math.hypot(w.mags.walker.x - w.me.x, w.mags.walker.y - w.me.y);
  const me = lag > 4 ? w.me : walkPath(w.me, w.path, PLAYER_SPEED, DT);
  return { ...w, t: w.t + DT, volunteers, me, mags: follow(w.mags, [me], DT, CITY_MAP) };
}

function leg(from: World, to: Vec2): World | null {
  const found = findPath(CITY_MAP, from.me, to);
  if (!found.ok) throw new Error('no path');
  let w: World = { ...from, me: { ...from.me, leg: 0 }, path: [{ x: from.me.x, y: from.me.y }, ...found.value] };
  for (let k = 0; k < 60 / DT; k++) {
    w = tick(w);
    if (lit(w, w.me) || lit(w, w.mags.walker)) return null;
    if (w.me.leg >= w.path.length - 1 && Math.hypot(w.mags.walker.x - w.me.x, w.mags.walker.y - w.me.y) <= MAGS_GAP + 0.05) return w;
  }
  return null;
}

const start = (): World => ({
  t: 0,
  volunteers: VOLUNTEER_ROUTES.map((r) => ({ x: r[0]?.x ?? 0, y: r[0]?.y ?? 0, facing: 0, leg: 0 })),
  mags: follower(HATCH),
  me: { x: HATCH.x + 1, y: HATCH.y, facing: 0, leg: 0 },
  path: [],
});

function escort(): { t: number; tight: number } {
  let w = start();
  let tight = 0;
  for (const to of [...HAVENS, AERIAL]) {
    let probe = w;
    let fails = 0;
    for (let s = 0; s < 40; s++) {
      if (leg(probe, to) === null) fails++;
      for (let k = 0; k < 0.5 / DT; k++) probe = { ...tick(probe), me: probe.me, mags: probe.mags };
    }
    if (fails > 0) tight++;
    let next = leg(w, to);
    for (let waited = 0; next === null && waited < 120; waited += DT) {
      w = { ...tick(w), me: w.me, mags: w.mags };
      expect(lit(w, w.me) || lit(w, w.mags.walker), `waiting at ${JSON.stringify(w.me)}`).toBe(false);
      next = leg(w, to);
    }
    if (next === null) throw new Error(`no way to ${JSON.stringify(to)}`);
    w = next;
  }
  expect(Math.hypot(w.mags.walker.x - AERIAL.x, w.mags.walker.y - AERIAL.y)).toBeLessThanOrEqual(AERIAL_REACH);
  return { t: w.t, tight };
}

describe('season two, act four: The Last Alert', () => {
  it('follows The Old Receipt, with a sound script and every speaker and mark known', () => {
    expect(Object.keys(STORY_ACTS).slice(6, 8)).toEqual(['receipt', 'alert']);
    expect(scriptProblems(ALERT_SCRIPT, sceneStarts(ALERT_ACT), ALERT_ACT.steps)).toEqual([]);
    const marks = Object.keys(ALERT_ACT.marks);
    for (const node of Object.values(ALERT_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(marks).toContain(m);
      }
      for (const m of [node.mark, node.jump?.if, ...(node.choices ?? []).flatMap((c) => [c.mark, c.if])]) if (m !== undefined) expect(marks).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
    }
    expect(Object.keys(ALERT_ACT.objectives)).toEqual([...ALERT_ACT.steps]);
    expect(ALERT_SCRIPT['dawn']?.then).toBe('done');
    expect(honestIn(ALERT_ACT, ['publishedKey'])).toBe(true);
    expect(honestIn(ALERT_ACT, ['eyedKey', 'askedForKey', 'usedOnce', 'beggedKey'])).toBe(false);
  });

  it('remembers how the crew treated Mags at the start of the season', () => {
    expect(carriedMarks({ overflow: { marks: ['leftMags'] } })).toEqual(['pastLeftMags']);
    expect(carriedMarks({ overflow: { marks: ['pressedMags'] } })).toEqual(['pastPressedMags']);
    expect(carriedMarks({ overflow: { marks: ['thankedMags'] } })).toEqual([]);
  });

  it('puts the hatch and the aerial on the tip, where Mags can walk', () => {
    for (const p of [ALERT_ACT.start, GATE_SPOT, HATCH, AERIAL, ...HAVENS]) {
      expect(canStand(CITY_MAP, p), JSON.stringify(p)).toBe(true);
      expect(findPath(CITY_MAP, ALERT_ACT.start, p).ok, JSON.stringify(p)).toBe(true);
    }
    for (const p of [HATCH, AERIAL]) expect(districtAt(p)?.id).toBe('gullmoor');
    for (const route of VOLUNTEER_ROUTES) for (let i = 0; i < route.length; i++) expect(isClearSegment(CITY_MAP, route[i] ?? AERIAL, route[(i + 1) % route.length] ?? AERIAL)).toBe(true);
  });

  it('never lights the hatch or the places to wait', () => {
    let w = start();
    for (let t = 0; t < 120; t += DT) {
      w = { ...tick(w), me: w.me, mags: w.mags };
      for (const p of [HATCH, ...HAVENS]) expect(lit(w, p), JSON.stringify(p)).toBe(false);
    }
  });

  it('has Mags follow the nearest within earshot, a step behind and slower, and wait for anyone out of it', () => {
    const near = { x: HATCH.x - 4, y: HATCH.y };
    const far = { x: HATCH.x + MAGS_HEAR + 2, y: HATCH.y };
    let f = follower(HATCH);
    expect(follow(f, [far], DT, CITY_MAP)).toBe(f);
    for (let k = 0; k < 40; k++) f = follow(f, [far, near], DT, CITY_MAP);
    const moved = HATCH.x - f.walker.x;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(MAGS_SPEED * 40 * DT + 1e-6);
    expect(MAGS_SPEED).toBeLessThan(PLAYER_SPEED);
    for (let k = 0; k < 100; k++) f = follow(f, [near], DT, CITY_MAP);
    expect(Math.hypot(f.walker.x - near.x, f.walker.y - near.y)).toBeLessThanOrEqual(MAGS_GAP);
  });

  it('lets one player walk Mags to the aerial unseen, though more than one crossing needs timing', () => {
    const { t, tight } = escort();
    expect(t).toBeLessThan(120);
    expect(tight).toBeGreaterThanOrEqual(2);
  });
});
