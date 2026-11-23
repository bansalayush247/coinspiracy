import type { Room } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { solveChallenge, type TaskChallenge, type TaskTiming } from '@byzantine-council/shared';
import { ACADEMY_MESSAGES, ACADEMY_RETRY_MS, ACADEMY_ROOM, AcademyDoneSchema, AcademyDrillSchema, AcademyRefusedSchema, AcademyResultSchema } from '@byzantine-council/shared/progression';
import { MemoryProfileStore } from '../src/profile/store.js';
import { COOKIE_NAME, newProfileId, signCookie, type SessionKeys } from '../src/profile/session.js';
import { sdk, startServer } from './helpers.js';

const PORT = 3891;
const keys: SessionKeys = { current: Buffer.from('q'.repeat(32)), previous: null, secure: false };
const FAST: TaskTiming = { minSolveMs: { deposit: 0, ledger: 0, route: 0, watchtower: 0 }, expireMs: 60_000, retryMs: 300, openCooldownMs: 0 };
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, taskTiming: FAST, profiles: { store: new MemoryProfileStore(), keys } }));
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function next(room: Room, type: string, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no ${type}`));
    }, timeoutMs);
    const off = room.onMessage(type, (p: unknown) => {
      clearTimeout(timer);
      off();
      resolve(p);
    });
  });
}

function open(cookie?: string): Promise<Room> {
  return sdk(PORT, cookie === undefined ? {} : { Cookie: cookie }).create(ACADEMY_ROOM, {});
}

function wrongAnswer(c: TaskChallenge) {
  const right = solveChallenge(c);
  if (right.kind === 'watchtower') return { kind: 'watchtower' as const, height: right.height + 1 };
  if (right.kind === 'deposit') return { kind: 'deposit' as const, notes: [1] };
  if (right.kind === 'ledger') return { kind: 'ledger' as const, reject: [] };
  return { kind: 'route' as const, path: [0, 7] };
}

// Answers every drill of a level correctly and returns the done message.
async function clear(room: Room, level: number) {
  let drill = next(room, ACADEMY_MESSAGES.DRILL);
  room.send('start', { level });
  for (;;) {
    const d = AcademyDrillSchema.parse(await drill);
    const doneOrDrill = Promise.race([next(room, ACADEMY_MESSAGES.DONE).then((p) => ({ done: p })), next(room, ACADEMY_MESSAGES.DRILL).then((p) => ({ drill: p }))]);
    room.send('answer', { id: d.id, answer: solveChallenge(d.challenge) });
    const r = await doneOrDrill;
    if ('done' in r) return AcademyDoneSchema.parse(r.done);
    drill = Promise.resolve(r.drill);
  }
}

describe('the Academy', () => {
  it('runs a level for a guest without a profile and scores three stars, saving nothing', async () => {
    const room = await open();
    const done = await clear(room, 1);
    expect(done).toMatchObject({ level: 1, stars: 3, mistakes: 0, award: null });
  });

  it('counts a wrong answer, locks out briefly, then serves a fresh drill', async () => {
    const room = await open();
    const first = next(room, ACADEMY_MESSAGES.DRILL);
    room.send('start', { level: 4 });
    const d = AcademyDrillSchema.parse(await first);
    const result = next(room, ACADEMY_MESSAGES.RESULT);
    const fresh = next(room, ACADEMY_MESSAGES.DRILL, ACADEMY_RETRY_MS + 1500);
    room.send('answer', { id: d.id, answer: wrongAnswer(d.challenge) });
    expect(AcademyResultSchema.parse(await result)).toEqual({ id: d.id, ok: false, retryInMs: ACADEMY_RETRY_MS });
    const again = AcademyDrillSchema.parse(await fresh);
    expect(again.id).not.toBe(d.id);
    expect(again.index).toBe(0);
    // The old drill is gone: answering it does nothing.
    room.send('answer', { id: d.id, answer: solveChallenge(d.challenge) });
    const rest = next(room, ACADEMY_MESSAGES.DRILL);
    room.send('answer', { id: again.id, answer: solveChallenge(again.challenge) });
    const second = AcademyDrillSchema.parse(await rest);
    const done = next(room, ACADEMY_MESSAGES.DONE);
    room.send('answer', { id: second.id, answer: solveChallenge(second.challenge) });
    expect(AcademyDoneSchema.parse(await done)).toMatchObject({ level: 4, stars: 2, mistakes: 1 });
  });

  it('opens levels in order for a guest with a profile, and pays the first clear once', async () => {
    const cookie = `${COOKIE_NAME}=${signCookie(keys, newProfileId(), Date.now())}`;
    const room = await open(cookie);
    const refused = next(room, ACADEMY_MESSAGES.REFUSED);
    room.send('start', { level: 2 });
    expect(AcademyRefusedSchema.parse(await refused)).toEqual({ reason: 'locked' });
    const first = await clear(room, 1);
    expect(first.award?.sats).toBeGreaterThanOrEqual(100);
    expect(first.award?.seals).toContain('academy1');
    const replay = await clear(room, 1);
    expect(replay.award?.xpAfter).toBe(replay.award?.xpBefore);
    const second = await clear(room, 2);
    expect(second.level).toBe(2);
  });

  it('refuses unknown levels and closes the socket on malformed answers', async () => {
    const room = await open();
    const refused = next(room, ACADEMY_MESSAGES.REFUSED);
    room.send('start', { level: 42 });
    expect(AcademyRefusedSchema.parse(await refused)).toEqual({ reason: 'unknownLevel' });
    const closed = new Promise<number>((resolve) => {
      room.onLeave((code) => {
        resolve(code);
      });
    });
    room.send('answer', { id: 'not-an-id!', answer: 5 });
    expect(await closed).toBe(4002);
  });

  it('is a solo room that nobody else can join', async () => {
    const room = await open();
    await expect(sdk(PORT).joinById(room.roomId, {})).rejects.toThrow();
  });
});
