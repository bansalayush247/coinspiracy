import { describe, expect, it } from 'vitest';
import {
  GLYPH_COUNT,
  LEDGER_NOTES,
  NOTE_DENOMINATIONS,
  ROUTE_EDGES,
  ROUTE_PATHS,
  TaskAnswerSchema,
  TaskChallengeSchema,
  WATCHTOWER_REPORTS,
  badLedgerNotes,
  checkAnswer,
  generateChallenge,
  isValidRoute,
  median,
  solveChallenge,
  type LedgerChallenge,
  type RouteChallenge,
  type TaskAnswer,
  type TaskChallenge,
} from '../src/minigames.js';
import { cryptoRandom, type RandomSource } from '../src/roles.js';
import { TASK_KINDS, type TaskKind } from '../src/tasks.js';

const TIP = 925_104;
const RUNS = 400;
const ctx = { tipHeight: TIP };

function many<K extends TaskKind>(kind: K): Extract<TaskChallenge, { kind: K }>[] {
  return Array.from({ length: RUNS }, () => generateChallenge(kind, cryptoRandom, ctx) as Extract<TaskChallenge, { kind: K }>);
}

const always = (value: number): RandomSource => ({ int: (max) => Math.min(value, max - 1) });

describe('generateChallenge', () => {
  it.each(TASK_KINDS)('makes %s challenges that pass the wire schema and their own solution', (kind) => {
    for (const challenge of many(kind)) {
      expect(TaskChallengeSchema.safeParse(challenge).success).toBe(true);
      const answer = solveChallenge(challenge);
      expect(TaskAnswerSchema.safeParse(answer).success).toBe(true);
      expect(checkAnswer(challenge, answer)).toBe(true);
    }
  });

  it.each(TASK_KINDS)('survives a degenerate random source for %s, or fails closed', (kind) => {
    for (const value of [0, 1, 1_000_000]) {
      try {
        const challenge = generateChallenge(kind, always(value), ctx);
        expect(checkAnswer(challenge, solveChallenge(challenge))).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }
  });

  it('rejects a random source that answers out of range', () => {
    const broken: RandomSource = { int: (max) => max };
    for (const kind of TASK_KINDS) expect(() => generateChallenge(kind, broken, ctx)).toThrow(RangeError);
  });
});

describe('deposit', () => {
  it('always needs at least two notes', () => {
    for (const c of many('deposit')) expect(Number.isInteger(Math.log2(c.amount))).toBe(false);
  });

  it('accepts the notes in any order and nothing else', () => {
    const c: TaskChallenge = { kind: 'deposit', amount: 13 };
    const ok = (notes: number[]) => checkAnswer(c, { kind: 'deposit', notes });
    expect(ok([8, 4, 1])).toBe(true);
    expect(ok([1, 8, 4])).toBe(true);
    expect(ok([8, 4])).toBe(false);
    expect(ok([8, 4, 1, 1])).toBe(false);
    expect(ok([8, 2, 2, 1])).toBe(false);
    expect(ok([])).toBe(false);
  });

  it('offers every power of two up to 64', () => {
    expect([...NOTE_DENOMINATIONS]).toStrictEqual([64, 32, 16, 8, 4, 2, 1]);
  });
});

describe('ledger', () => {
  it('hides exactly one forged seal and one double spend', () => {
    for (const c of many('ledger')) {
      const bad = badLedgerNotes(c);
      expect(bad).toHaveLength(2);
      const forged = c.notes.filter((n) => n.seal.some((g, i) => g !== c.seal[i]));
      const spent = c.notes.filter((n) => c.spent.includes(n.serial));
      expect(forged).toHaveLength(1);
      expect(spent).toHaveLength(1);
      expect(forged[0]).not.toBe(spent[0]);
      // One glyph off, so the forgery takes a careful look.
      expect(forged[0]?.seal.filter((g, i) => g !== c.seal[i])).toHaveLength(1);
    }
  });

  it('uses distinct serials and decoys that never match a note', () => {
    for (const c of many('ledger')) {
      const serials = c.notes.map((n) => n.serial);
      expect(new Set(serials).size).toBe(LEDGER_NOTES);
      expect(new Set(c.spent).size).toBe(c.spent.length);
      expect(c.spent.filter((s) => serials.includes(s))).toHaveLength(1);
      expect(new Set(c.seal).size).toBe(c.seal.length);
      for (const g of c.seal) expect(g).toBeLessThan(GLYPH_COUNT);
    }
  });

  it('accepts only the bad pair, in either order', () => {
    const [c] = many('ledger');
    if (c === undefined) throw new Error('no challenge');
    const [a = -1, b = -1] = badLedgerNotes(c);
    const ok = (reject: number[]) => checkAnswer(c, { kind: 'ledger', reject });
    expect(ok([a, b])).toBe(true);
    expect(ok([b, a])).toBe(true);
    expect(ok([a, a])).toBe(false);
    for (let i = 0; i < LEDGER_NOTES; i++) {
      for (let j = i + 1; j < LEDGER_NOTES; j++) {
        if ((i === a && j === b) || (i === b && j === a)) continue;
        expect(ok([i, j])).toBe(false);
      }
    }
  });

  it('refuses a challenge with the wrong number of bad notes', () => {
    const [c] = many('ledger');
    if (c === undefined) throw new Error('no challenge');
    const clean: LedgerChallenge = { ...c, notes: c.notes.map((n) => ({ ...n, seal: [...c.seal] })), spent: c.spent.map(() => 'ZZZZ') };
    expect(checkAnswer(clean, { kind: 'ledger', reject: [0, 1] })).toBe(false);
  });
});

describe('route', () => {
  it('leaves exactly one path that can carry the payment', () => {
    for (const c of many('route')) {
      expect(ROUTE_PATHS.filter((p) => isValidRoute(c, p))).toHaveLength(1);
      expect(c.capacities).toHaveLength(ROUTE_EDGES.length);
    }
  });

  it('on Lightning Reef, leaves one path with a thin margin and decoys that miss by a few sats', () => {
    const hard = (rng: RandomSource): RouteChallenge => generateChallenge('route', rng, { tipHeight: TIP, hardRoutes: true }) as RouteChallenge;
    const extremes: RandomSource[] = [always(0), always(1_000), cryptoRandom];
    for (const rng of [...extremes, ...Array.from({ length: RUNS }, () => cryptoRandom)]) {
      const c = hard(rng);
      expect(TaskChallengeSchema.safeParse(c).success).toBe(true);
      const valid = ROUTE_PATHS.filter((p) => isValidRoute(c, p));
      expect(valid).toHaveLength(1);
      // The working route never has more than 5 sats to spare on its tightest channel.
      const route = valid[0] ?? [];
      const spare = Math.min(...route.slice(1).map((to, i) => (c.capacities[ROUTE_EDGES.findIndex(([a, b]) => (a === route[i] && b === to) || (b === route[i] && a === to))] ?? 0) - c.amount));
      expect(spare).toBeGreaterThanOrEqual(0);
      expect(spare).toBeLessThanOrEqual(5);
      // Every decoy's tightest channel is short, by 8 sats at most.
      for (const p of ROUTE_PATHS.filter((x) => x !== route)) {
        const caps = p.slice(1).map((to, i) => c.capacities[ROUTE_EDGES.findIndex(([a, b]) => (a === p[i] && b === to) || (b === p[i] && a === to))] ?? 0);
        const worst = Math.min(...caps);
        expect(worst).toBeLessThan(c.amount);
        expect(c.amount - worst).toBeLessThanOrEqual(8);
      }
      expect(checkAnswer(c, solveChallenge(c))).toBe(true);
    }
  });

  it('rejects paths that skip a hop, run backwards or start elsewhere', () => {
    const c: RouteChallenge = { kind: 'route', amount: 40, capacities: ROUTE_EDGES.map(() => 100) };
    expect(isValidRoute(c, [0, 1, 3, 5, 7])).toBe(true);
    expect(isValidRoute(c, [0, 3, 1, 5, 7])).toBe(false);
    expect(isValidRoute(c, [0, 1, 1, 5, 7])).toBe(false);
    expect(isValidRoute(c, [7, 5, 3, 1, 0])).toBe(false);
    expect(isValidRoute(c, [1, 3, 5, 7, 7])).toBe(false);
    expect(isValidRoute(c, [0, 1, 3, 5])).toBe(false);
  });

  it('rejects a path with one channel too small, and accepts one exactly at the amount', () => {
    const capacities = ROUTE_EDGES.map(() => 100);
    capacities[ROUTE_EDGES.findIndex(([a, b]) => a === 3 && b === 5)] = 39;
    capacities[ROUTE_EDGES.findIndex(([a, b]) => a === 4 && b === 6)] = 40;
    const c: RouteChallenge = { kind: 'route', amount: 40, capacities };
    expect(isValidRoute(c, [0, 1, 3, 5, 7])).toBe(false);
    expect(isValidRoute(c, [0, 2, 4, 6, 7])).toBe(true);
  });
});

describe('watchtower', () => {
  it('puts the median inside the honest range whatever the faulty guardians say', () => {
    for (const c of many('watchtower')) {
      expect(c.reports).toHaveLength(WATCHTOWER_REPORTS);
      const m = median(c.reports);
      expect(m).toBeGreaterThanOrEqual(TIP - 3);
      expect(m).toBeLessThanOrEqual(TIP);
      expect(c.reports.filter((r) => r >= TIP - 3 && r <= TIP)).toHaveLength(5);
    }
  });

  it('accepts only the median', () => {
    const c: TaskChallenge = { kind: 'watchtower', reports: [12, TIP - 2, TIP, TIP + 900, TIP - 1, TIP - 1, TIP] };
    expect(checkAnswer(c, { kind: 'watchtower', height: TIP - 1 })).toBe(true);
    expect(checkAnswer(c, { kind: 'watchtower', height: TIP })).toBe(false);
    expect(checkAnswer(c, { kind: 'watchtower', height: TIP + 900 })).toBe(false);
  });

  it.each([0, 59_999, 1.5, Number.NaN, 99_999_999])('refuses a tip height of %s', (tipHeight) => {
    expect(() => generateChallenge('watchtower', cryptoRandom, { tipHeight })).toThrow(RangeError);
  });

  it('throws on an empty median rather than inventing one', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('checkAnswer', () => {
  it('rejects an answer for a different kind of task', () => {
    const answers: Record<TaskKind, TaskAnswer> = {
      deposit: { kind: 'deposit', notes: [8, 4, 1] },
      ledger: { kind: 'ledger', reject: [0, 1] },
      route: { kind: 'route', path: [0, 1, 3, 5, 7] },
      watchtower: { kind: 'watchtower', height: TIP },
    };
    for (const kind of TASK_KINDS) {
      const challenge = generateChallenge(kind, cryptoRandom, ctx);
      for (const other of TASK_KINDS) if (other !== kind) expect(checkAnswer(challenge, answers[other])).toBe(false);
    }
  });
});

describe('TaskAnswerSchema', () => {
  it.each([
    { kind: 'deposit', notes: [3] },
    { kind: 'deposit', notes: [128] },
    { kind: 'deposit', notes: [64, 32, 16, 8, 4, 2, 1, 1] },
    { kind: 'ledger', reject: [0] },
    { kind: 'ledger', reject: [0, 6] },
    { kind: 'ledger', reject: [0, 1, 2] },
    { kind: 'route', path: [0, 1, 3, 5] },
    { kind: 'route', path: [0, 1, 3, 5, 8] },
    { kind: 'watchtower', height: -1 },
    { kind: 'watchtower', height: 1.5 },
    { kind: 'watchtower', height: 925_104, extra: true },
    { kind: 'unknown' },
  ])('rejects %o', (answer) => {
    expect(TaskAnswerSchema.safeParse(answer).success).toBe(false);
  });
});
