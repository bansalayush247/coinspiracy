import { describe, expect, it } from 'vitest';
import {
  CITY_MAP,
  CLOCK_ACT,
  CLOCK_SCRIPT,
  CLOCK_TUNING,
  CROWD_CYCLE_S,
  CROWD_ROUTE,
  ClockTuningSchema,
  FENNICK_SEAT,
  GATHER_S,
  MINT_DOOR,
  OLIVE_SHOP,
  SPEAKERS,
  STORY_ACTS,
  WALK_S,
  WATCH_AT,
  WATCH_RANGE,
  carriedMarks,
  clocked,
  crowdAt,
  districtAt,
  honestIn,
  sceneStarts,
  scriptProblems,
} from '../src/city/index.js';
import { canStand, findPath, isClearSegment } from '../src/pathfinding.js';

const DT = 0.05;
const middle = (t: number): { x: number; y: number } => {
  const m = crowdAt(t).members;
  return { x: m.reduce((a, b) => a + b.x, 0) / m.length, y: m.reduce((a, b) => a + b.y, 0) / m.length };
};

describe('season three, act three: The Clock', () => {
  it('follows The Envelope, with a sound script and every speaker and mark known', () => {
    expect(Object.keys(STORY_ACTS).slice(9, 11)).toEqual(['envelope', 'clock']);
    expect(scriptProblems(CLOCK_SCRIPT, sceneStarts(CLOCK_ACT), CLOCK_ACT.steps)).toEqual([]);
    const marks = Object.keys(CLOCK_ACT.marks);
    for (const node of Object.values(CLOCK_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(marks).toContain(m);
      }
      for (const m of [node.mark, node.jump?.if, ...(node.choices ?? []).flatMap((c) => [c.mark, c.if])]) if (m !== undefined) expect(marks).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
    }
    expect(Object.keys(CLOCK_ACT.objectives)).toEqual([...CLOCK_ACT.steps]);
    expect(CLOCK_SCRIPT['marketIvy']?.then).toBe('done');
    expect(honestIn(CLOCK_ACT, ['waitedChime'])).toBe(true);
    expect(honestIn(CLOCK_ACT, ['boastedFast', 'luckySeventeen', 'joinedQueue'])).toBe(false);
  });

  it('lets Perpetua Glass remember how Rook spoke to her in The Envelope', () => {
    expect(carriedMarks({ envelope: { marks: ['politeGlass'] } })).toEqual(['pastPolite']);
    expect(carriedMarks({ envelope: { marks: ['gloatedGlass'] } })).toEqual(['pastGloated']);
    expect(carriedMarks({ envelope: { marks: ['askedGlassNext'] } })).toEqual([]);
  });

  it('reads its places and numbers from the tuning file, and refuses a broken one', () => {
    expect(CLOCK_ACT.rewardSats).toBe(CLOCK_TUNING.rewardSats);
    expect(crowdAt(0).members).toHaveLength(CLOCK_TUNING.crowd.size);
    expect(ClockTuningSchema.safeParse({ ...CLOCK_TUNING, extra: 1 }).success).toBe(false);
    expect(ClockTuningSchema.safeParse({ ...CLOCK_TUNING, crowd: { ...CLOCK_TUNING.crowd, size: 0 } }).success).toBe(false);
    expect(ClockTuningSchema.safeParse({ ...CLOCK_TUNING, watch: { ...CLOCK_TUNING.watch, range: -1 } }).success).toBe(false);
  });

  it('walks the crowd from the Mint to the Saltmarket on clear streets the crew can use', () => {
    for (const p of [CLOCK_ACT.start, MINT_DOOR, OLIVE_SHOP, FENNICK_SEAT, ...CROWD_ROUTE]) {
      expect(canStand(CITY_MAP, p), JSON.stringify(p)).toBe(true);
      expect(findPath(CITY_MAP, CLOCK_ACT.start, p).ok, JSON.stringify(p)).toBe(true);
    }
    for (let i = 1; i < CROWD_ROUTE.length; i++) expect(isClearSegment(CITY_MAP, CROWD_ROUTE[i - 1] ?? MINT_DOOR, CROWD_ROUTE[i] ?? MINT_DOOR)).toBe(true);
    expect(districtAt(CLOCK_ACT.start)?.id).toBe('mint');
    expect(districtAt(OLIVE_SHOP)?.id).toBe('saltmarket');
    expect(Math.hypot(OLIVE_SHOP.x - WATCH_AT.x, OLIVE_SHOP.y - WATCH_AT.y) + (CLOCK_ACT.arrivals['blend']?.range ?? Infinity)).toBeLessThan(WATCH_RANGE);
    expect(crowdAt(1).phase).toBe('gather');
    expect(crowdAt(GATHER_S + 1).phase).toBe('walk');
    expect(crowdAt(GATHER_S + WALK_S + 1).phase).toBe('linger');
    expect(crowdAt(GATHER_S - 3).leaveIn).toBeCloseTo(3);
  });

  it('never clocks someone walking in the middle of the crowd, and lets them step up to the shop while it lingers', () => {
    for (let t = 0; t < CROWD_CYCLE_S; t += DT) expect(clocked(crowdAt(t), middle(t)), `t=${t.toFixed(2)}`).toBe(false);
    for (let t = GATHER_S + WALK_S; t < CROWD_CYCLE_S; t += DT) expect(clocked(crowdAt(t), OLIVE_SHOP)).toBe(false);
  });

  it('clocks anyone in the ring alone, or running well ahead of the crowd, but nobody outside it', () => {
    expect(clocked(crowdAt(1), OLIVE_SHOP)).toBe(true);
    expect(clocked(crowdAt(1), WATCH_AT)).toBe(true);
    expect(clocked(crowdAt(1), { x: WATCH_AT.x, y: WATCH_AT.y - WATCH_RANGE - 0.1 })).toBe(false);
    let ahead = false;
    for (let t = GATHER_S; t < GATHER_S + WALK_S && !ahead; t += DT) {
      const front = crowdAt(t).members[0];
      if (front === undefined) break;
      ahead = clocked(crowdAt(t), { x: front.x + Math.cos(front.facing) * 4, y: front.y + Math.sin(front.facing) * 4 });
    }
    expect(ahead).toBe(true);
  });
});
