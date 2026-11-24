// Task minigames: challenge generators, the wire schemas, and answer checks.
// Every answer is derivable from its challenge, so the server only keeps the challenge it issued.
import { z } from 'zod';
import { ROOM_CODE_ALPHABET } from './lobby.js';
import { toDenominations } from './notes.js';
import type { RandomSource } from './roles.js';
import type { TaskKind } from './tasks.js';

// Deposit Gate: the note buttons on offer, largest first.
export const NOTE_DENOMINATIONS = Object.freeze([64, 32, 16, 8, 4, 2, 1] as const);
export const DEPOSIT_MIN = 3;
export const DEPOSIT_MAX = 127;

// Ledger Archive: seal glyphs, notes on the desk and serials on the spent list.
export const GLYPH_COUNT = 6;
export const SEAL_LENGTH = 3;
export const LEDGER_NOTES = 6;
export const LEDGER_SPENT = 3;
export const SERIAL_LENGTH = 4;

// Gateway Dock: gateway, three columns of two nodes, then the recipient.
export const ROUTE_NODES = 8;
export const ROUTE_SOURCE = 0;
export const ROUTE_TARGET = 7;
export const ROUTE_PATH_LENGTH = 5;
export const ROUTE_EDGES: readonly (readonly [number, number])[] = Object.freeze([
  [0, 1], [0, 2],
  [1, 3], [1, 4], [2, 3], [2, 4],
  [3, 5], [3, 6], [4, 5], [4, 6],
  [5, 7], [6, 7],
] as const);
export const ROUTE_MAX_CAPACITY = 200;

// Watchtower: one block-height report per guardian of a seven-guardian federation.
export const WATCHTOWER_REPORTS = 7;
export const MAX_BLOCK_HEIGHT = 100_000_000;

// ASCII only, so splitting into characters is safe.
const SERIAL_CHARS: readonly string[] = Object.freeze(Array.from(ROOM_CODE_ALPHABET));
const SERIAL = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${String(SERIAL_LENGTH)}}$`);
const Serial = z.string().regex(SERIAL);
const Glyph = z.number().int().min(0).max(GLYPH_COUNT - 1);
const Seal = z.array(Glyph).length(SEAL_LENGTH);
const Denomination = z.number().int().refine((n) => (NOTE_DENOMINATIONS as readonly number[]).includes(n));
const Height = z.number().int().min(0).max(MAX_BLOCK_HEIGHT);

export const DepositChallengeSchema = z.strictObject({
  kind: z.literal('deposit'),
  amount: z.number().int().min(DEPOSIT_MIN).max(DEPOSIT_MAX),
});
export const LedgerChallengeSchema = z.strictObject({
  kind: z.literal('ledger'),
  seal: Seal,
  spent: z.array(Serial).length(LEDGER_SPENT),
  notes: z.array(z.strictObject({ serial: Serial, amount: Denomination, seal: Seal })).length(LEDGER_NOTES),
});
export const RouteChallengeSchema = z.strictObject({
  kind: z.literal('route'),
  amount: z.number().int().min(1).max(ROUTE_MAX_CAPACITY),
  capacities: z.array(z.number().int().min(0).max(ROUTE_MAX_CAPACITY)).length(ROUTE_EDGES.length),
});
export const WatchtowerChallengeSchema = z.strictObject({
  kind: z.literal('watchtower'),
  reports: z.array(Height).length(WATCHTOWER_REPORTS),
});
export const TaskChallengeSchema = z.discriminatedUnion('kind', [
  DepositChallengeSchema,
  LedgerChallengeSchema,
  RouteChallengeSchema,
  WatchtowerChallengeSchema,
]);
export type DepositChallenge = z.infer<typeof DepositChallengeSchema>;
export type LedgerChallenge = z.infer<typeof LedgerChallengeSchema>;
export type RouteChallenge = z.infer<typeof RouteChallengeSchema>;
export type WatchtowerChallenge = z.infer<typeof WatchtowerChallengeSchema>;
export type TaskChallenge = z.infer<typeof TaskChallengeSchema>;

export const TaskAnswerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('deposit'), notes: z.array(Denomination).max(NOTE_DENOMINATIONS.length) }),
  z.strictObject({ kind: z.literal('ledger'), reject: z.array(z.number().int().min(0).max(LEDGER_NOTES - 1)).length(2) }),
  z.strictObject({ kind: z.literal('route'), path: z.array(z.number().int().min(0).max(ROUTE_NODES - 1)).length(ROUTE_PATH_LENGTH) }),
  z.strictObject({ kind: z.literal('watchtower'), height: Height }),
]);
export type TaskAnswer = z.infer<typeof TaskAnswerSchema>;

export interface TaskContext {
  // Current Bitcoin chain tip, used as the honest watchtower reading.
  readonly tipHeight: number;
  // Lightning Reef: decoy routes miss the amount by only a few sats.
  readonly hardRoutes?: boolean;
}

function pick<T>(items: readonly T[], rng: RandomSource): T {
  const item = items[rng.int(items.length)];
  if (item === undefined) throw new RangeError('RandomSource out of range');
  return item;
}

function shuffled<T>(items: readonly T[], rng: RandomSource): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) throw new RangeError('RandomSource out of range');
    out[i] = b;
    out[j] = a;
  }
  return out;
}

function popcount(n: number): number {
  let count = 0;
  for (let v = n; v > 0; v >>= 1) count += v & 1;
  return count;
}

// Amounts that need at least two notes.
const DEPOSIT_AMOUNTS = Object.freeze(
  Array.from({ length: DEPOSIT_MAX - DEPOSIT_MIN + 1 }, (_, i) => i + DEPOSIT_MIN).filter((n) => popcount(n) >= 2),
);

function generateDeposit(rng: RandomSource): DepositChallenge {
  return { kind: 'deposit', amount: pick(DEPOSIT_AMOUNTS, rng) };
}

function randomSerial(rng: RandomSource): string {
  let serial = '';
  for (let i = 0; i < SERIAL_LENGTH; i++) serial += pick(SERIAL_CHARS, rng);
  return serial;
}

// A near miss of `serial`: one character changed, so the spent list needs a careful read.
function nearSerial(serial: string, rng: RandomSource): string {
  const at = rng.int(SERIAL_LENGTH);
  const others = SERIAL_CHARS.filter((c) => c !== serial[at]);
  return serial.slice(0, at) + pick(others, rng) + serial.slice(at + 1);
}

function sameSeal(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((g, i) => g === b[i]);
}

// Indexes of notes the archive must reject: a seal that is not the federation's, or a spent serial.
export function badLedgerNotes(c: LedgerChallenge): number[] {
  const spent = new Set(c.spent);
  return c.notes.flatMap((note, i) => (!sameSeal(note.seal, c.seal) || spent.has(note.serial) ? [i] : []));
}

function generateLedger(rng: RandomSource): LedgerChallenge {
  const seal = shuffled(Array.from({ length: GLYPH_COUNT }, (_, i) => i), rng).slice(0, SEAL_LENGTH);
  const serials = new Set<string>();
  for (let tries = 0; serials.size < LEDGER_NOTES; tries++) {
    if (tries > 100) throw new Error('could not draw distinct serials');
    serials.add(randomSerial(rng));
  }
  const noteSerials = [...serials];
  const forged = rng.int(LEDGER_NOTES);
  const doubleSpent = (forged + 1 + rng.int(LEDGER_NOTES - 1)) % LEDGER_NOTES;
  const notes = noteSerials.map((serial, i) => {
    const noteSeal = [...seal];
    if (i === forged) {
      const at = rng.int(SEAL_LENGTH);
      noteSeal[at] = pick(
        Array.from({ length: GLYPH_COUNT }, (_, g) => g).filter((g) => g !== seal[at]),
        rng,
      );
    }
    return { serial, amount: pick(NOTE_DENOMINATIONS, rng), seal: noteSeal };
  });
  const spent = [noteSerials[doubleSpent] ?? ''];
  for (let tries = 0; spent.length < LEDGER_SPENT; tries++) {
    if (tries > 100) throw new Error('could not draw decoy serials');
    const decoy = nearSerial(pick(noteSerials, rng), rng);
    if (!serials.has(decoy) && !spent.includes(decoy)) spent.push(decoy);
  }
  return { kind: 'ledger', seal, spent: shuffled(spent, rng), notes };
}

function edgeIndex(from: number, to: number): number {
  return ROUTE_EDGES.findIndex(([a, b]) => a === from && b === to);
}

// Every gateway-to-recipient path through the three columns.
export const ROUTE_PATHS: readonly (readonly number[])[] = Object.freeze(
  [1, 2].flatMap((a) => [3, 4].flatMap((b) => [5, 6].map((c) => Object.freeze([ROUTE_SOURCE, a, b, c, ROUTE_TARGET])))),
);

// A path is valid when it follows channels end to end and each one can carry the amount.
export function isValidRoute(c: RouteChallenge, path: readonly number[]): boolean {
  if (path.length !== ROUTE_PATH_LENGTH || path[0] !== ROUTE_SOURCE || path[ROUTE_PATH_LENGTH - 1] !== ROUTE_TARGET) return false;
  for (let i = 0; i + 1 < path.length; i++) {
    const edge = edgeIndex(path[i] ?? -1, path[i + 1] ?? -1);
    if (edge < 0 || (c.capacities[edge] ?? 0) < c.amount) return false;
  }
  return true;
}

// Exactly one path can carry the payment; the others each have a channel that is too small.
// Hard routes leave thin margins: the working path fits by 5 sats at most, and decoys fall at most 8 short.
function generateRoute(rng: RandomSource, hard = false): RouteChallenge {
  const amount = hard ? 7 + 3 * rng.int(60) : 5 * (6 + rng.int(13));
  const chosen = pick(ROUTE_PATHS, rng);
  const onChosen = new Set(chosen.slice(1).map((to, i) => edgeIndex(chosen[i] ?? -1, to)));
  const capacities = ROUTE_EDGES.map((_, edge) =>
    onChosen.has(edge) ? amount + rng.int(hard ? 6 : 41) : hard ? Math.max(1, amount - 8 + rng.int(17)) : Math.max(5, amount - 30) + rng.int(66),
  );
  const challenge: RouteChallenge = { kind: 'route', amount, capacities };
  for (const path of ROUTE_PATHS) {
    if (path === chosen || !isValidRoute(challenge, path)) continue;
    const own = path.slice(1).map((to, i) => edgeIndex(path[i] ?? -1, to)).filter((e) => !onChosen.has(e));
    capacities[pick(own, rng)] = Math.max(1, amount - 1 - rng.int(hard ? 3 : 20));
  }
  return challenge;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  if (mid === undefined) throw new RangeError('median of nothing');
  return mid;
}

// Five honest guardians lag the tip by up to three blocks; two faulty ones report wild heights.
function generateWatchtower(rng: RandomSource, ctx: TaskContext): WatchtowerChallenge {
  const tip = ctx.tipHeight;
  if (!Number.isSafeInteger(tip) || tip < 60_000 || tip > MAX_BLOCK_HEIGHT - 10_000) {
    throw new RangeError('tipHeight out of range');
  }
  const honest = Array.from({ length: WATCHTOWER_REPORTS - 2 }, () => tip - rng.int(4));
  const high = (): number => tip + 50 + rng.int(4951);
  const low = (): number => tip - 50 - rng.int(50_000);
  const pattern = rng.int(3);
  const faulty = pattern === 0 ? [high(), high()] : pattern === 1 ? [low(), low()] : [high(), low()];
  return { kind: 'watchtower', reports: shuffled([...honest, ...faulty], rng) };
}

export function generateChallenge(kind: TaskKind, rng: RandomSource, ctx: TaskContext): TaskChallenge {
  switch (kind) {
    case 'deposit':
      return generateDeposit(rng);
    case 'ledger':
      return generateLedger(rng);
    case 'route':
      return generateRoute(rng, ctx.hardRoutes === true);
    case 'watchtower':
      return generateWatchtower(rng, ctx);
  }
}

export function checkAnswer(c: TaskChallenge, answer: TaskAnswer): boolean {
  switch (c.kind) {
    case 'deposit': {
      if (answer.kind !== 'deposit') return false;
      const want = toDenominations(c.amount);
      const got = [...answer.notes].sort((a, b) => b - a);
      return got.length === want.length && got.every((n, i) => n === want[i]);
    }
    case 'ledger': {
      if (answer.kind !== 'ledger') return false;
      const want = badLedgerNotes(c);
      const got = new Set(answer.reject);
      return want.length === 2 && got.size === 2 && want.every((i) => got.has(i));
    }
    case 'route':
      return answer.kind === 'route' && isValidRoute(c, answer.path);
    case 'watchtower':
      return answer.kind === 'watchtower' && answer.height === median(c.reports);
  }
}

// The correct answer, for tests and the practice bots planned for later.
export function solveChallenge(c: TaskChallenge): TaskAnswer {
  switch (c.kind) {
    case 'deposit':
      return { kind: 'deposit', notes: toDenominations(c.amount) };
    case 'ledger': {
      const [a = 0, b = 0] = badLedgerNotes(c);
      return { kind: 'ledger', reject: [a, b] };
    }
    case 'route':
      return { kind: 'route', path: [...(ROUTE_PATHS.find((p) => isValidRoute(c, p)) ?? [])] };
    case 'watchtower':
      return { kind: 'watchtower', height: median(c.reports) };
  }
}
