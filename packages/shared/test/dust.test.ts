import { describe, expect, it } from 'vitest';
import {
  CITY_MAP,
  COURIER_ROUTE,
  DEE_SHOP,
  DOORS,
  DOORS_NEEDED,
  DOOR_NOTES,
  DUST_ACT,
  DUST_SCRIPT,
  DUST_TUNING,
  DustTuningSchema,
  GLANCE_RANGE,
  GLASSHOUSE_DOOR,
  LOSE_S,
  SPEAKERS,
  STORY_ACTS,
  TAIL_LOSE,
  courierArrived,
  courierAtStart,
  courierSees,
  courierStep,
  districtAt,
  honestIn,
  sceneStarts,
  scriptProblems,
} from '../src/city/index.js';
import type { Vec2 } from '../src/map.js';
import { canStand, findPath, isClearSegment } from '../src/pathfinding.js';

const DT = 0.05;
const legs = COURIER_ROUTE.slice(1).map((p, i) => Math.hypot(p.x - (COURIER_ROUTE[i]?.x ?? 0), p.y - (COURIER_ROUTE[i]?.y ?? 0)));

function along(s: number): Vec2 {
  let left = Math.max(0, s);
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i] ?? 0;
    const a = COURIER_ROUTE[i] ?? DEE_SHOP;
    const b = COURIER_ROUTE[i + 1] ?? a;
    if (left <= l) return { x: a.x + ((b.x - a.x) * left) / l, y: a.y + ((b.y - a.y) * left) / l };
    left -= l;
  }
  return GLASSHOUSE_DOOR;
}

function tail(lag: number): { outcome: 'arrived' | 'seen' | 'lost'; t: number } {
  let c = courierAtStart();
  let walked = 0;
  let far = 0;
  let t = 0;
  for (; t < 120 && !courierArrived(c); t += DT) {
    const before = c.walker;
    c = courierStep(c, DT);
    walked += Math.hypot(c.walker.x - before.x, c.walker.y - before.y);
    const me = along(walked - lag);
    if (courierSees(c, me)) return { outcome: 'seen', t };
    far = Math.hypot(me.x - c.walker.x, me.y - c.walker.y) > TAIL_LOSE ? far + DT : 0;
    if (far >= LOSE_S) return { outcome: 'lost', t };
  }
  return { outcome: courierArrived(c) ? 'arrived' : 'lost', t };
}

describe('season three, act one: The Dust', () => {
  it('opens season three after The Last Alert, with a sound script and every speaker and mark known', () => {
    expect(Object.keys(STORY_ACTS).slice(7, 9)).toEqual(['alert', 'dust']);
    expect(scriptProblems(DUST_SCRIPT, sceneStarts(DUST_ACT), DUST_ACT.steps)).toEqual([]);
    const marks = Object.keys(DUST_ACT.marks);
    for (const node of Object.values(DUST_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(marks).toContain(m);
      }
      for (const m of [node.mark, node.jump?.if, ...(node.choices ?? []).flatMap((c) => [c.mark, c.if])]) if (m !== undefined) expect(marks).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
    }
    expect(Object.keys(DUST_ACT.objectives)).toEqual([...DUST_ACT.steps]);
    expect(DUST_SCRIPT['officeIvy']?.then).toBe('done');
    expect(honestIn(DUST_ACT, ['defendedPrivacy'])).toBe(true);
    expect(honestIn(DUST_ACT, ['jokedDust', 'grabbedBag', 'askedJob'])).toBe(false);
  });

  it('reads its places and numbers from the tuning file, and refuses a broken one', () => {
    expect(DUST_ACT.rewardSats).toBe(DUST_TUNING.rewardSats);
    expect(DOORS).toHaveLength(DUST_TUNING.doors.length);
    expect(DOOR_NOTES).toHaveLength(DOORS.length);
    expect(DOORS_NEEDED).toBeLessThan(DOORS.length);
    expect(DustTuningSchema.safeParse({ ...DUST_TUNING, courierSpeed: -1 }).success).toBe(false);
    expect(DustTuningSchema.safeParse({ ...DUST_TUNING, extra: 1 }).success).toBe(false);
    expect(DustTuningSchema.safeParse({ ...DUST_TUNING, night: 2 }).success).toBe(false);
  });

  it('puts the doors and the shop in Low Tide and Glasshouse on Signet Row, all where the crew can walk', () => {
    for (const p of [DUST_ACT.start, DEE_SHOP, GLASSHOUSE_DOOR, ...DOORS.map((d) => d.at), ...COURIER_ROUTE]) {
      expect(canStand(CITY_MAP, p), JSON.stringify(p)).toBe(true);
      expect(findPath(CITY_MAP, DUST_ACT.start, p).ok, JSON.stringify(p)).toBe(true);
    }
    for (const p of [DEE_SHOP, ...DOORS.map((d) => d.at)]) expect(districtAt(p)?.id).toBe('lowtide');
    expect(districtAt(GLASSHOUSE_DOOR)?.id).toBe('signet');
    for (let i = 1; i < COURIER_ROUTE.length; i++) expect(isClearSegment(CITY_MAP, COURIER_ROUTE[i - 1] ?? DEE_SHOP, COURIER_ROUTE[i] ?? DEE_SHOP)).toBe(true);
  });

  it('has Mr Fennick look back from every corner after the first, the way he came, and only then', () => {
    let c = courierAtStart();
    const glances: number[] = [];
    for (let t = 0; t < 120 && !courierArrived(c); t += DT) {
      const was = c.glance;
      c = courierStep(c, DT);
      if (was === 0 && c.glance > 0) {
        glances.push(c.walker.leg);
        const back = COURIER_ROUTE[c.walker.leg - 1] ?? DEE_SHOP;
        expect(courierSees(c, { x: c.walker.x + (back.x - c.walker.x) * 0.3, y: c.walker.y + (back.y - c.walker.y) * 0.3 })).toBe(true);
      }
    }
    expect(glances).toEqual(Array.from({ length: COURIER_ROUTE.length - 3 }, (_, i) => i + 2));
    expect(courierSees(courierAtStart(), DEE_SHOP)).toBe(false);
  });

  it('can be tailed alone by keeping a steady distance, but not too close and not too far', () => {
    const clean = [8, 9, 10, 11].map(tail);
    for (const r of clean) expect(r.outcome).toBe('arrived');
    expect(Math.max(...clean.map((r) => r.t))).toBeLessThan(60);
    expect(tail(GLANCE_RANGE - 3).outcome).toBe('seen');
    expect(tail(TAIL_LOSE + 4).outcome).toBe('lost');
  });
});
