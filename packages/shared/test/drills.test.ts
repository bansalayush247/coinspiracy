import { describe, expect, it } from 'vitest';
import {
  DrillAnswerSchema,
  DrillChallengeSchema,
  ISLAND_DRILL_KINDS,
  checkDrill,
  councilSuspect,
  generateDrill,
  isTaskKind,
  safeRotations,
  signingSide,
  solveDrill,
  type CouncilChallenge,
  type DrillAnswer,
  type DrillChallenge,
} from '../src/drills.js';
import { isHalted, threshold } from '../src/federation.js';
import { cryptoRandom, type RandomSource } from '../src/roles.js';

const ctx = { tipHeight: 925_104 };
const RUNS = 500;
const always = (value: number): RandomSource => ({ int: (max) => Math.min(value, max - 1) });

function many(kind: (typeof ISLAND_DRILL_KINDS)[number], rng: RandomSource = cryptoRandom): DrillChallenge[] {
  return Array.from({ length: RUNS }, () => generateDrill(kind, rng, ctx));
}

describe('island drills', () => {
  it.each(ISLAND_DRILL_KINDS)('%s: every challenge parses, and its solution is the only right answer', (kind) => {
    for (const rng of [always(0), always(1000), cryptoRandom]) {
      for (const c of many(kind, rng).slice(0, rng === cryptoRandom ? RUNS : 3)) {
        expect(DrillChallengeSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
        const right = solveDrill(c);
        expect(DrillAnswerSchema.safeParse(right).success).toBe(true);
        expect(checkDrill(c, right)).toBe(true);
        // Any other value of the same answer is wrong.
        const wrong = { ...right } as Record<string, unknown>;
        const field = Object.keys(right).find((k) => k !== 'kind') ?? '';
        wrong[field] = (right as unknown as Record<string, number>)[field] === -1 ? 0 : -1;
        const parsed = DrillAnswerSchema.safeParse(wrong);
        if (parsed.success) expect(checkDrill(c, parsed.data)).toBe(false);
      }
    }
  });

  it('never accepts an answer of another kind', () => {
    const c = generateDrill('threshold', cryptoRandom, ctx);
    const answers: DrillAnswer[] = [
      { kind: 'quorum', rotations: 3 },
      { kind: 'council', suspect: 0 },
      { kind: 'partition', side: 0 },
      { kind: 'watchtower', height: 925_104 },
    ];
    for (const a of answers) expect(checkDrill(c, a)).toBe(false);
  });

  it('teaches the real threshold: n - floor((n - 1) / 3) signatures', () => {
    expect(threshold(4)).toBe(3);
    expect(threshold(7)).toBe(5);
    expect(threshold(10)).toBe(7);
    expect(checkDrill({ kind: 'threshold', guardians: 7 }, { kind: 'threshold', signatures: 5 })).toBe(true);
    expect(checkDrill({ kind: 'threshold', guardians: 7 }, { kind: 'threshold', signatures: 4 })).toBe(false);
  });

  it('counts how many honest keys can be lost before Byzantines are a third', () => {
    // 7 guardians, 1 Byzantine: 6, 5 and 4 active are fine; at 3 active the Byzantine is a third.
    expect(safeRotations(7, 1)).toBe(3);
    expect(safeRotations(5, 1)).toBe(1);
    expect(safeRotations(10, 3)).toBe(0);
    for (let n = 5; n <= 13; n++) {
      for (let b = 1; 3 * b < n; b++) {
        const k = safeRotations(n, b);
        expect(isHalted(b, n - k)).toBe(false);
        expect(isHalted(b, n - k - 1)).toBe(true);
      }
    }
  });

  it('finds the side of a split that can still sign, or none', () => {
    expect(signingSide(7, [5, 2])).toBe(0);
    expect(signingSide(7, [4, 3])).toBe(-1);
    expect(signingSide(7, [2, 5])).toBe(1);
    expect(signingSide(10, [3, 3, 4])).toBe(-1);
    for (const c of many('partition')) {
      if (c.kind !== 'partition') continue;
      expect(c.sides.reduce((a, b) => a + b, 0)).toBe(c.guardians);
      // At most one side can ever reach the threshold.
      expect(c.sides.filter((s) => s >= threshold(c.guardians)).length).toBeLessThanOrEqual(1);
    }
    const outcomes = many('partition').map((c) => (c.kind === 'partition' ? signingSide(c.guardians, c.sides) >= 0 : false));
    expect(outcomes.some(Boolean)).toBe(true);
    expect(outcomes.some((x) => !x)).toBe(true);
  });

  it('builds council evidence with one guardian proven, or none, and decoys who did only one thing', () => {
    let skips = 0;
    for (const c of many('council')) {
      if (c.kind !== 'council') continue;
      const suspect = councilSuspect(c);
      if (suspect === -1) skips++;
      else {
        expect(c.inHall).toContain(suspect);
        expect(c.signed).toContain(suspect);
      }
      // Nobody but the proven guardian is in both lists, and every seat is in the federation.
      expect(c.inHall.filter((s) => c.signed.includes(s)).length).toBeLessThanOrEqual(1);
      for (const s of [...c.inHall, ...c.signed]) expect(s).toBeLessThan(c.guardians);
    }
    expect(skips).toBeGreaterThan(0);
    expect(skips).toBeLessThan(RUNS / 2);
    const twoInBoth: CouncilChallenge = { kind: 'council', guardians: 5, forgery: 3, inHall: [0, 1], signed: [0, 1] };
    expect(councilSuspect(twoInBoth)).toBe(-1);
  });

  it('passes station kinds through to the task minigames', () => {
    expect(isTaskKind('route')).toBe(true);
    expect(isTaskKind('quorum')).toBe(false);
    const c = generateDrill('deposit', cryptoRandom, ctx);
    expect(c.kind).toBe('deposit');
    expect(checkDrill(c, solveDrill(c))).toBe(true);
  });
});
