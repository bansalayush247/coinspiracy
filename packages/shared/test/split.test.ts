import { describe, expect, it } from 'vitest';
import {
  CITY_MAP,
  GUARD_RANGE,
  HALL_STEPS,
  REX_REACH,
  REX_SPEED,
  SHOPKEEPERS,
  SIGNALS_NEEDED,
  SPEAKERS,
  SPLIT_ACT,
  SPLIT_SCRIPT,
  STORY_ACTS,
  WON_FIRM_MS,
  WON_NOTES,
  districtAt,
  honestIn,
  sceneStarts,
  scriptProblems,
  rexTarget,
  walkPath,
  type Walker,
} from '../src/city/index.js';
import type { Vec2 } from '../src/map.js';
import { PLAYER_SPEED } from '../src/movement.js';
import { canStand, findPath } from '../src/pathfinding.js';

// A lone player winning the nearest shopkeeper not yet won, against Rex hunting the nearest unguarded one.
function race(speed = PLAYER_SPEED): { t: number; flips: number; won: number } {
  const dt = 0.05;
  const won = SHOPKEEPERS.map(() => false);
  const wonAt = SHOPKEEPERS.map(() => -Infinity);
  let rex: Walker = { x: HALL_STEPS.x + 1.4, y: HALL_STEPS.y - 0.6, facing: 0, leg: 0 };
  let rexPath: Vec2[] = [];
  let rexGoal = -2;
  let me: Walker = { x: HALL_STEPS.x, y: HALL_STEPS.y, facing: 0, leg: 0 };
  let path: Vec2[] = [];
  let talking = 0;
  let flips = 0;
  const route = (from: Vec2, to: Vec2): Vec2[] => {
    const found = findPath(CITY_MAP, from, to);
    if (!found.ok) throw new Error('no path');
    return [{ x: from.x, y: from.y }, ...found.value];
  };
  let t = 0;
  for (; t < 180 && won.filter(Boolean).length < SIGNALS_NEEDED; t += dt) {
    const guarded = SHOPKEEPERS.map((s, i) => Math.hypot(me.x - s.at.x, me.y - s.at.y) <= GUARD_RANGE || t * 1000 - (wonAt[i] ?? 0) < WON_FIRM_MS);
    const goal = rexTarget(rex, won, guarded);
    if (goal !== rexGoal) {
      rexGoal = goal;
      rexPath = route(rex, SHOPKEEPERS[goal]?.at ?? HALL_STEPS);
      rex = { ...rex, leg: 0 };
    }
    rex = walkPath(rex, rexPath, REX_SPEED, dt);
    const shop = SHOPKEEPERS[goal];
    if (shop !== undefined && Math.hypot(rex.x - shop.at.x, rex.y - shop.at.y) <= REX_REACH) {
      won[goal] = false;
      flips++;
    }
    if (talking > 0) {
      talking -= dt;
      const here = SHOPKEEPERS.findIndex((s) => Math.hypot(me.x - s.at.x, me.y - s.at.y) <= SPLIT_ACT.workReach);
      if (talking <= 0 && here >= 0) {
        won[here] = true;
        wonAt[here] = t * 1000;
      }
      continue;
    }
    if (me.leg >= path.length - 1) {
      const next = SHOPKEEPERS.map((s, i) => ({ i, d: won[i] === true ? Infinity : Math.hypot(s.at.x - me.x, s.at.y - me.y) })).sort((a, b) => a.d - b.d)[0];
      const target = next === undefined ? undefined : SHOPKEEPERS[next.i];
      if (target === undefined) continue;
      if ((next?.d ?? Infinity) <= SPLIT_ACT.workReach) {
        talking = SPLIT_ACT.workMs / 1000;
        continue;
      }
      path = route(me, target.at);
      me = { ...me, leg: 0 };
    }
    me = walkPath(me, path, speed, dt);
  }
  return { t, flips, won: won.filter(Boolean).length };
}

describe('season two, act two: The Split', () => {
  it('follows The Overflow, with a sound script and every speaker and mark known', () => {
    expect(Object.keys(STORY_ACTS).slice(4, 6)).toEqual(['overflow', 'split']);
    expect(scriptProblems(SPLIT_SCRIPT, sceneStarts(SPLIT_ACT), SPLIT_ACT.steps)).toEqual([]);
    const marks = Object.keys(SPLIT_ACT.marks);
    for (const node of Object.values(SPLIT_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(marks).toContain(m);
      }
      for (const m of [node.mark, ...(node.choices ?? []).map((c) => c.mark)]) if (m !== undefined) expect(marks).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
    }
    expect(honestIn(SPLIT_ACT, ['heardBoth'])).toBe(true);
    expect(honestIn(SPLIT_ACT, ['heckledRex', 'tempted', 'warnedRex', 'joinedRexFork'])).toBe(false);
    expect(SPLIT_ACT.badge).toBe('With us');
  });

  it('puts the hall and the shopkeepers on Council Hill, where the crew can walk', () => {
    for (const p of [SPLIT_ACT.start, HALL_STEPS, ...SHOPKEEPERS.map((s) => s.at)]) {
      expect(canStand(CITY_MAP, p), JSON.stringify(p)).toBe(true);
      expect(findPath(CITY_MAP, SPLIT_ACT.start, p).ok, JSON.stringify(p)).toBe(true);
    }
    for (const s of SHOPKEEPERS) expect(districtAt(s.at)?.id, s.label).toBe('council');
    expect(WON_NOTES).toHaveLength(SHOPKEEPERS.length);
    expect(SIGNALS_NEEDED).toBeLessThan(SHOPKEEPERS.length);
  });

  it('sends Rex for the nearest shopkeeper the crew has won and left alone', () => {
    const at = SHOPKEEPERS[2]?.at ?? HALL_STEPS;
    const none = SHOPKEEPERS.map(() => false);
    expect(rexTarget(at, none, none)).toBe(-1);
    expect(rexTarget(at, SHOPKEEPERS.map(() => true), none)).toBe(2);
    expect(rexTarget(at, SHOPKEEPERS.map(() => true), SHOPKEEPERS.map((_, i) => i === 2))).not.toBe(2);
    expect(rexTarget(at, SHOPKEEPERS.map(() => true), SHOPKEEPERS.map(() => true))).toBe(-1);
  });

  it('lets one quick player win them round at once before Rex can talk any back', () => {
    const { t, won } = race();
    expect(won).toBeGreaterThanOrEqual(SIGNALS_NEEDED);
    expect(t).toBeLessThan(60);
  });

  it('lets a slower player win too, though Rex talks some back first', () => {
    const { t, flips, won } = race(PLAYER_SPEED * 0.6);
    expect(won).toBeGreaterThanOrEqual(SIGNALS_NEEDED);
    expect(t).toBeLessThan(150);
    expect(flips).toBeGreaterThan(0);
  });
});
