import { describe, expect, it } from 'vitest';
import {
  ALL_TASKS,
  MAX_TASK_RETRY_MS,
  TASK_KINDS,
  TASK_TIMING,
  TaskIdSchema,
  TaskResultSchema,
  solveChallenge,
  stationCenter,
  taskBit,
  type TaskAnswer,
  type TaskChallenge,
  type TaskKind,
  type TaskTiming,
  type Vec2,
} from '@byzantine-council/shared';
import { Match, type OpenOutcome } from '../src/match.js';

const IDS = ['player-aa', 'player-bb', 'player-cc', 'player-dd', 'player-ee'];
const TIP = 925_104;
const T0 = 1_000_000;

// Next to the station, inside range.
function at(kind: TaskKind): Vec2 {
  const c = stationCenter(kind);
  return { x: c.x, y: c.y + 1 };
}

function opened(outcome: OpenOutcome): { id: string; challenge: TaskChallenge } {
  if (!outcome.ok) throw new Error(`open refused: ${outcome.reason}`);
  return outcome;
}

function wrong(challenge: TaskChallenge): TaskAnswer {
  switch (challenge.kind) {
    case 'deposit':
      return { kind: 'deposit', notes: [] };
    case 'ledger':
      return { kind: 'ledger', reject: [0, 0] };
    case 'route':
      return { kind: 'route', path: [7, 7, 7, 7, 7] };
    case 'watchtower':
      return { kind: 'watchtower', height: 0 };
  }
}

function setup() {
  const match = new Match(IDS, TASK_TIMING);
  const honest = IDS.filter((id) => match.role(id) === 'honest');
  const [byzantine] = match.byzantines();
  if (byzantine === undefined || honest.length !== 4) throw new Error('bad deal');
  return { match, honest, byzantine };
}

// Opens and correctly answers one task, respecting the minimum solve time.
function solve(match: Match, id: string, kind: TaskKind, now: number) {
  const { id: taskId, challenge } = opened(match.openTask(id, kind, at(kind), now, TIP));
  return match.answer(id, taskId, solveChallenge(challenge), at(kind), now + TASK_TIMING.minSolveMs[kind]);
}

describe('Match setup', () => {
  it('deals one Byzantine in five and gives everyone every task', () => {
    const { match, honest, byzantine } = setup();
    expect(match.byzantines()).toStrictEqual([byzantine]);
    for (const id of IDS) {
      expect(match.assigned(id)).toBe(ALL_TASKS);
      expect(match.done(id)).toBe(0);
    }
    expect(honest).not.toContain(byzantine);
    expect(match.consensus()).toBe(0);
    expect(match.winner()).toBeNull();
  });
});

describe('Match.openTask', () => {
  it('opens a challenge with a fresh id when the player stands at the station', () => {
    const { match, honest } = setup();
    const [id = ''] = honest;
    const first = opened(match.openTask(id, 'ledger', at('ledger'), T0, TIP));
    expect(TaskIdSchema.safeParse(first.id).success).toBe(true);
    expect(first.challenge.kind).toBe('ledger');
    expect(match.hasOpenTask(id)).toBe(true);
  });

  it('refuses from out of range, while busy, during the cooldown and for unknown players', () => {
    const { match, honest } = setup();
    const [id = ''] = honest;
    expect(match.openTask(id, 'ledger', { x: 15, y: 15 }, T0, TIP)).toStrictEqual({ ok: false, reason: 'outOfRange' });
    opened(match.openTask(id, 'ledger', at('ledger'), T0, TIP));
    expect(match.openTask(id, 'route', at('route'), T0 + 10, TIP)).toStrictEqual({ ok: false, reason: 'busy' });
    match.closeTask(id);
    expect(match.openTask(id, 'ledger', at('ledger'), T0 + 100, TIP)).toStrictEqual({
      ok: false,
      reason: 'retryLater',
      retryInMs: TASK_TIMING.openCooldownMs - 100,
    });
    expect(match.openTask('stranger1', 'ledger', at('ledger'), T0, TIP)).toStrictEqual({ ok: false, reason: 'unavailable' });
  });

  it('refuses a task that is already done', () => {
    const { match, honest } = setup();
    const [id = ''] = honest;
    expect(solve(match, id, 'deposit', T0).ok).toBe(true);
    expect(match.openTask(id, 'deposit', at('deposit'), T0 + 10_000, TIP)).toStrictEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('Match.answer', () => {
  it('counts an honest task toward consensus and records it as done', () => {
    const { match, honest } = setup();
    const [id = ''] = honest;
    const result = solve(match, id, 'watchtower', T0);
    expect(result).toStrictEqual({ ok: true, counted: true, done: taskBit('watchtower') });
    expect(match.done(id)).toBe(taskBit('watchtower'));
    expect(match.consensus()).toBe(6);
    expect(match.hasOpenTask(id)).toBe(false);
  });

  it('lets a Byzantine fake a task without moving the consensus bar', () => {
    const { match, byzantine } = setup();
    expect(solve(match, byzantine, 'route', T0)).toStrictEqual({ ok: true, counted: false, done: taskBit('route') });
    expect(match.consensus()).toBe(0);
  });

  it('locks the player out after a wrong answer', () => {
    const { match, honest } = setup();
    const [id = ''] = honest;
    const { id: taskId, challenge } = opened(match.openTask(id, 'ledger', at('ledger'), T0, TIP));
    const late = T0 + TASK_TIMING.minSolveMs.ledger;
    expect(match.answer(id, taskId, wrong(challenge), at('ledger'), late)).toStrictEqual({
      ok: false,
      reason: 'wrong',
      retryInMs: TASK_TIMING.retryMs,
    });
    expect(match.hasOpenTask(id)).toBe(false);
    const retry = match.openTask(id, 'ledger', at('ledger'), late + 1000, TIP);
    expect(retry).toStrictEqual({ ok: false, reason: 'retryLater', retryInMs: TASK_TIMING.retryMs - 1000 });
    expect(match.openTask(id, 'ledger', at('ledger'), late + TASK_TIMING.retryMs, TIP).ok).toBe(true);
  });

  it('clamps retry hints to what the client schema accepts', () => {
    const slow: TaskTiming = { ...TASK_TIMING, retryMs: 10 * MAX_TASK_RETRY_MS };
    const match = new Match(IDS, slow);
    const [id = ''] = IDS;
    const { id: taskId, challenge } = opened(match.openTask(id, 'ledger', at('ledger'), T0, TIP));
    const late = T0 + slow.minSolveMs.ledger;
    const result = match.answer(id, taskId, wrong(challenge), at('ledger'), late);
    expect(result).toStrictEqual({ ok: false, reason: 'wrong', retryInMs: MAX_TASK_RETRY_MS });
    const refusal = match.openTask(id, 'ledger', at('ledger'), late + 1, TIP);
    expect(refusal).toStrictEqual({ ok: false, reason: 'retryLater', retryInMs: MAX_TASK_RETRY_MS });
    expect(TaskResultSchema.safeParse({ id: taskId, ok: false, retryInMs: MAX_TASK_RETRY_MS }).success).toBe(true);
  });

  it('ignores answers that come too fast, keeping the challenge open', () => {
    const { match, honest } = setup();
    const [id = ''] = honest;
    const { id: taskId, challenge } = opened(match.openTask(id, 'deposit', at('deposit'), T0, TIP));
    const early = T0 + TASK_TIMING.minSolveMs.deposit - 1;
    expect(match.answer(id, taskId, solveChallenge(challenge), at('deposit'), early)).toStrictEqual({ ok: false, reason: 'ignored' });
    expect(match.hasOpenTask(id)).toBe(true);
    expect(match.answer(id, taskId, solveChallenge(challenge), at('deposit'), early + 1).ok).toBe(true);
  });

  it('ignores a stale id, another player’s id and an answer of the wrong kind', () => {
    const { match, honest } = setup();
    const [a = '', b = ''] = honest;
    const first = opened(match.openTask(a, 'ledger', at('ledger'), T0, TIP));
    const late = T0 + 5000;
    expect(match.answer(a, 'notTheTaskId', solveChallenge(first.challenge), at('ledger'), late)).toStrictEqual({ ok: false, reason: 'ignored' });
    expect(match.answer(b, first.id, solveChallenge(first.challenge), at('ledger'), late)).toStrictEqual({ ok: false, reason: 'ignored' });
    expect(match.answer(a, first.id, { kind: 'watchtower', height: TIP }, at('ledger'), late)).toStrictEqual({ ok: false, reason: 'ignored' });
    expect(match.hasOpenTask(a)).toBe(true);
  });

  it('closes instead of counting when the player walked off or took too long', () => {
    const { match, honest } = setup();
    const [a = '', b = ''] = honest;
    const one = opened(match.openTask(a, 'route', at('route'), T0, TIP));
    expect(match.answer(a, one.id, solveChallenge(one.challenge), { x: 15, y: 15 }, T0 + 5000)).toStrictEqual({ ok: false, reason: 'moved' });
    const two = opened(match.openTask(b, 'route', at('route'), T0, TIP));
    expect(match.answer(b, two.id, solveChallenge(two.challenge), at('route'), T0 + TASK_TIMING.expireMs)).toStrictEqual({
      ok: false,
      reason: 'expired',
    });
    expect(match.consensus()).toBe(0);
  });
});

describe('Match.sweep', () => {
  it('closes challenges whose player left range, dropped, or ran out of time', () => {
    const { match, honest } = setup();
    const [a = '', b = '', c = '', d = ''] = honest;
    for (const id of [a, b, c, d]) opened(match.openTask(id, 'ledger', at('ledger'), T0, TIP));
    const positions = new Map<string, Vec2>([
      [a, at('ledger')],
      [b, { x: 15, y: 15 }],
      [d, at('ledger')],
    ]);
    expect(match.sweep(T0 + 1000, (id) => positions.get(id))).toStrictEqual([
      { id: b, reason: 'moved' },
      { id: c, reason: 'moved' },
    ]);
    expect(match.sweep(T0 + TASK_TIMING.expireMs, (id) => positions.get(id))).toStrictEqual([
      { id: a, reason: 'expired' },
      { id: d, reason: 'expired' },
    ]);
  });
});

describe('Match winner', () => {
  it('ends with an honest win once every honest task is done', () => {
    const { match, honest, byzantine } = setup();
    let now = T0;
    for (const id of honest) {
      for (const kind of TASK_KINDS) {
        expect(match.winner()).toBeNull();
        expect(solve(match, id, kind, now).ok).toBe(true);
        now += 10_000;
      }
    }
    expect(match.consensus()).toBe(100);
    expect(match.winner()).toStrictEqual({ side: 'honest', reason: 'consensusReached' });
    expect(match.done(byzantine)).toBe(0);
  });

  it('gives the honest side the win when the only Byzantine leaves', () => {
    const { match, byzantine } = setup();
    match.leave(byzantine);
    expect(match.winner()).toStrictEqual({ side: 'honest', reason: 'allByzantineRotatedOut' });
  });

  it('halts the federation when enough honest guardians leave', () => {
    const { match, honest } = setup();
    const [a = '', b = ''] = honest;
    match.leave(a);
    expect(match.winner()).toBeNull();
    match.leave(b);
    expect(match.winner()).toStrictEqual({ side: 'byzantine', reason: 'federationHalted' });
  });

  it('keeps the work of honest players who left in the consensus bar', () => {
    const { match, honest } = setup();
    const [a = ''] = honest;
    expect(solve(match, a, 'deposit', T0).ok).toBe(true);
    expect(match.consensus()).toBe(6);
    match.leave(a);
    expect(match.consensus()).toBe(6);
  });

  it('never moves the bar when someone leaves, so a departure reveals no role', () => {
    const ids = ['player-aa', 'player-bb', 'player-cc', 'player-dd', 'player-ee', 'player-ff', 'player-gg'];
    const match = new Match(ids, TASK_TIMING);
    const honest = ids.filter((id) => match.role(id) === 'honest');
    const byzantines = match.byzantines();
    const [worker = '', idle = ''] = honest;
    expect(byzantines).toHaveLength(2);
    expect(solve(match, worker, 'ledger', T0).ok).toBe(true);
    // One of 20 honest tasks.
    expect(match.consensus()).toBe(5);
    match.leave(idle);
    expect(match.consensus()).toBe(5);
    match.leave(byzantines[0] ?? '');
    expect(match.consensus()).toBe(5);
    match.leave(worker);
    expect(match.consensus()).toBe(5);
    expect(match.winner()).toBeNull();
  });

  it('reaches consensus once every honest guardian still in the federation is done', () => {
    const { match, honest } = setup();
    const [leaver = '', ...rest] = honest;
    match.leave(leaver);
    let now = T0;
    for (const id of rest) {
      for (const kind of TASK_KINDS) {
        expect(match.consensusReached()).toBe(false);
        expect(solve(match, id, kind, now).ok).toBe(true);
        now += 10_000;
      }
    }
    // The leaver's four tasks can never be done, so the bar stops at 12 of 16.
    expect(match.consensus()).toBe(75);
    expect(match.consensusReached()).toBe(true);
    expect(match.winner()).toStrictEqual({ side: 'honest', reason: 'consensusReached' });
  });

  it('is not reached while no honest guardian is left', () => {
    const { match, honest } = setup();
    for (const id of honest) match.leave(id);
    expect(match.consensusReached()).toBe(false);
    expect(match.winner()).toStrictEqual({ side: 'byzantine', reason: 'federationHalted' });
  });

  it('drops open challenges and refuses further play once finished', () => {
    const { match, honest } = setup();
    const [a = ''] = honest;
    const { id, challenge } = opened(match.openTask(a, 'ledger', at('ledger'), T0, TIP));
    expect(match.finish()).toStrictEqual([a]);
    expect(match.finished).toBe(true);
    expect(match.answer(a, id, solveChallenge(challenge), at('ledger'), T0 + 5000)).toStrictEqual({ ok: false, reason: 'ignored' });
    expect(match.openTask(a, 'route', at('route'), T0 + 5000, TIP)).toStrictEqual({ ok: false, reason: 'unavailable' });
  });
});
