import { describe, expect, it } from 'vitest';
import {
  BAD_NOTES,
  BAD_STALLS,
  CITY_MAP,
  IVY_SPOT,
  MARKET_MIDDLE,
  OVERFLOW_ACT,
  OVERFLOW_SCRIPT,
  OZZY_LOOP,
  OZZY_REST_MS,
  OZZY_REST_SPEED,
  OZZY_SPRINT,
  OZZY_SPRINT_MS,
  SPEAKERS,
  STALLS,
  STORY_ACTS,
  carriedMarks,
  districtAt,
  honestIn,
  sceneStarts,
  scriptProblems,
} from '../src/city/index.js';
import { PLAYER_SPEED } from '../src/movement.js';
import { canStand, findPath, isClearSegment } from '../src/pathfinding.js';

describe('season two, act one: The Overflow', () => {
  it('follows the season-one acts and is labelled as season two', () => {
    expect(Object.keys(STORY_ACTS).slice(0, 5)).toEqual(['dump', 'ransom', 'insider', 'founder', 'overflow']);
    expect(OVERFLOW_ACT.kind).toBe('act');
    expect(OVERFLOW_ACT.number).toBe('Season two, act one');
  });

  it('has a sound script with every speaker and mark known', () => {
    expect(scriptProblems(OVERFLOW_SCRIPT, sceneStarts(OVERFLOW_ACT), OVERFLOW_ACT.steps)).toEqual([]);
    const marks = Object.keys(OVERFLOW_ACT.marks);
    for (const node of Object.values(OVERFLOW_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(marks).toContain(m);
      }
      for (const m of [node.mark, node.jump?.if, ...(node.choices ?? []).map((c) => c.mark)]) if (m !== undefined) expect(marks).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
    }
    expect(OVERFLOW_SCRIPT['fixed']?.then).toBe('done');
  });

  it('remembers honesty from the tip, and counts letting Mags keep her secret as honest', () => {
    expect(carriedMarks({ dump: { honest: true } })).toContain('pastHonest');
    expect(OVERFLOW_ACT.carries).toBe(true);
    expect(OVERFLOW_ACT.marks['pastHonest']).toBeDefined();
    expect(honestIn(OVERFLOW_ACT, ['leftMags'])).toBe(true);
    expect(honestIn(OVERFLOW_ACT, ['pressedMags', 'doubtedIvy', 'scoldedOzzy'])).toBe(false);
  });

  it('puts the Mint, the stalls and the market on open ground the crew can walk to', () => {
    for (const p of [OVERFLOW_ACT.start, IVY_SPOT, MARKET_MIDDLE, ...STALLS.map((s) => s.at), ...OZZY_LOOP]) {
      expect(canStand(CITY_MAP, p), JSON.stringify(p)).toBe(true);
      expect(findPath(CITY_MAP, OVERFLOW_ACT.start, p).ok, JSON.stringify(p)).toBe(true);
    }
    for (const s of STALLS) expect(districtAt(s.at)?.id).toBe('saltmarket');
    expect(BAD_NOTES).toHaveLength(STALLS.length);
    expect(BAD_STALLS).toBeLessThan(STALLS.length);
  });

  it('laps Ozzy round clear ground, and a lone runner gains on him over a sprint and a rest', () => {
    for (let i = 0; i < OZZY_LOOP.length; i++) expect(isClearSegment(CITY_MAP, OZZY_LOOP[i] ?? IVY_SPOT, OZZY_LOOP[(i + 1) % OZZY_LOOP.length] ?? IVY_SPOT), `leg ${String(i)}`).toBe(true);
    const gained = (PLAYER_SPEED - OZZY_SPRINT) * (OZZY_SPRINT_MS / 1000) + (PLAYER_SPEED - OZZY_REST_SPEED) * (OZZY_REST_MS / 1000);
    expect(gained).toBeGreaterThan(5);
  });
});
