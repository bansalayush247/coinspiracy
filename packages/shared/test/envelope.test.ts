import { describe, expect, it } from 'vitest';
import {
  CAMERA_AT,
  CITY_MAP,
  COUNTER,
  DEE_SHOP,
  DESKS,
  DESK_NOTES,
  ENVELOPES_NEEDED,
  ENVELOPE_ACT,
  ENVELOPE_SCRIPT,
  ENVELOPE_TUNING,
  EnvelopeTuningSchema,
  HALL_STEPS_EAST,
  SPEAKERS,
  STORY_ACTS,
  SWEEP_S,
  WRITE_MS,
  cameraFacing,
  cameraSees,
  carriedMarks,
  districtAt,
  honestIn,
  sceneStarts,
  scriptProblems,
} from '../src/city/index.js';
import { canStand, findPath } from '../src/pathfinding.js';

const DT = 0.05;
const times = Array.from({ length: Math.ceil(SWEEP_S / DT) }, (_, i) => i * DT);
const safeFrom = (desk: { x: number; y: number }, s: number): boolean => {
  for (let t = s; t <= s + WRITE_MS / 1000; t += DT) if (cameraSees(cameraFacing(t), desk)) return false;
  return true;
};

describe('season three, act two: The Envelope', () => {
  it('follows The Dust, with a sound script and every speaker and mark known', () => {
    expect(Object.keys(STORY_ACTS).slice(8, 10)).toEqual(['dust', 'envelope']);
    expect(scriptProblems(ENVELOPE_SCRIPT, sceneStarts(ENVELOPE_ACT), ENVELOPE_ACT.steps)).toEqual([]);
    const marks = Object.keys(ENVELOPE_ACT.marks);
    for (const node of Object.values(ENVELOPE_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(marks).toContain(m);
      }
      for (const m of [node.mark, node.jump?.if, ...(node.choices ?? []).flatMap((c) => [c.mark, c.if])]) if (m !== undefined) expect(marks).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
    }
    expect(Object.keys(ENVELOPE_ACT.objectives)).toEqual([...ENVELOPE_ACT.steps]);
    expect(ENVELOPE_SCRIPT['tillIvy']?.then).toBe('done');
    expect(honestIn(ENVELOPE_ACT, ['timedCamera'])).toBe(true);
    expect(honestIn(ENVELOPE_ACT, ['wavedCamera', 'showedCamera', 'gloatedGlass'])).toBe(false);
  });

  it('lets Perpetua Glass remember what Rook told her in The Dust', () => {
    expect(carriedMarks({ dust: { marks: ['defendedPrivacy'] } })).toEqual(['pastDefendedPrivacy']);
    expect(carriedMarks({ dust: { marks: ['askedJob'] } })).toEqual(['pastAskedJob']);
    expect(carriedMarks({ dust: { marks: ['askedClients'] } })).toEqual([]);
  });

  it('reads its places and numbers from the tuning file, and refuses a broken one', () => {
    expect(ENVELOPE_ACT.rewardSats).toBe(ENVELOPE_TUNING.rewardSats);
    expect(DESKS).toHaveLength(ENVELOPE_TUNING.desks.length);
    expect(DESK_NOTES).toHaveLength(DESKS.length);
    expect(ENVELOPES_NEEDED).toBeLessThanOrEqual(DESKS.length);
    expect(EnvelopeTuningSchema.safeParse({ ...ENVELOPE_TUNING, writeMs: 0 }).success).toBe(false);
    expect(EnvelopeTuningSchema.safeParse({ ...ENVELOPE_TUNING, extra: 1 }).success).toBe(false);
    expect(EnvelopeTuningSchema.safeParse({ ...ENVELOPE_TUNING, camera: { ...ENVELOPE_TUNING.camera, halfAngle: 3 } }).success).toBe(false);
  });

  it('puts the desks and the camera at Mint Hall and the till in Low Tide, all where the crew can walk', () => {
    for (const p of [ENVELOPE_ACT.start, COUNTER, CAMERA_AT, DEE_SHOP, ...DESKS.map((d) => d.at)]) {
      expect(canStand(CITY_MAP, p), JSON.stringify(p)).toBe(true);
      expect(findPath(CITY_MAP, ENVELOPE_ACT.start, p).ok, JSON.stringify(p)).toBe(true);
    }
    for (const p of [HALL_STEPS_EAST, COUNTER, ...DESKS.map((d) => d.at)]) expect(districtAt(p)?.id).toBe('mint');
    expect(districtAt(DEE_SHOP)?.id).toBe('lowtide');
  });

  it('sweeps the camera over every desk, and leaves each desk a window to write in, but never most of the time', () => {
    for (const desk of DESKS) {
      expect(times.some((t) => cameraSees(cameraFacing(t), desk.at)), desk.label).toBe(true);
      const safe = times.filter((s) => safeFrom(desk.at, s)).length / times.length;
      expect(safe, desk.label).toBeGreaterThan(0.2);
      expect(safe, desk.label).toBeLessThan(0.6);
    }
    expect(cameraSees(cameraFacing(0), HALL_STEPS_EAST)).toBe(false);
    expect(cameraFacing(SWEEP_S + 1.5)).toBeCloseTo(cameraFacing(1.5));
  });
});
