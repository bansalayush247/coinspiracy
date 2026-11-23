import type { Room } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  COUNCIL_SEAL,
  COUNCIL_TIMING,
  ChatLineSchema,
  CouncilRefusedSchema,
  SERVER_MESSAGES,
  SPAWN_POINTS,
  TaskClosedSchema,
  TaskOpenedSchema,
  stationCenter,
  type CouncilTiming,
  type Vec2,
} from '@byzantine-council/shared';
import type { CitadelRoom } from '../src/CitadelRoom.js';
import { createRoom, joinRoom, sdk, sleep, startServer, waitFor, type CitadelTestRoom } from './helpers.js';

const PORT = 3867;
const TIMING: CouncilTiming = { ...COUNCIL_TIMING, openingMs: 0, votingMs: 4000, resultMs: 400, cooldownMs: 300, perPlayer: 1, chatPerCouncil: 3, chatGapMs: 150 };
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, reconnectSeconds: 5, councilTiming: TIMING, resultMs: 500 }));
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

const client = () => sdk(PORT);

function serverRoom(room: Room): CitadelRoom {
  return colyseus.getRoomById<CitadelRoom>(room.roomId);
}

interface Table {
  readonly rooms: CitadelTestRoom[];
  readonly byz: CitadelTestRoom;
  readonly honest: CitadelTestRoom[];
}

async function lobby(n = 5): Promise<CitadelTestRoom[]> {
  const host = await createRoom(client(), { nickname: 'Host', private: true });
  const rooms = [host];
  for (let i = 1; i < n; i++) rooms.push(await joinRoom(client(), host.roomId, { nickname: `Guardian ${String(i)}` }));
  await waitFor(() => rooms.every((r) => r.state.players.size === n), 'everyone synced');
  return rooms;
}

async function started(n = 5): Promise<Table> {
  const rooms = await lobby(n);
  rooms[0]?.send('startMatch');
  await waitFor(() => rooms.every((r) => r.state.players.get(r.sessionId)?.role !== undefined), 'roles dealt');
  const byz = rooms.find((r) => r.state.players.get(r.sessionId)?.role === 'byzantine');
  if (byz === undefined) throw new Error('no Byzantine');
  return { rooms, byz, honest: rooms.filter((r) => r !== byz) };
}

async function place(room: CitadelTestRoom, pos: Vec2): Promise<void> {
  const p = serverRoom(room).state.players.get(room.sessionId);
  if (p === undefined) throw new Error('player missing');
  p.x = pos.x;
  p.y = pos.y;
  await waitFor(() => room.state.players.get(room.sessionId)?.x === pos.x, 'position synced');
}

function nextMessage(room: Room, type: string, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no ${type} message`));
    }, timeoutMs);
    const off = room.onMessage(type, (payload: unknown) => {
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });
}

async function call(t: Table, caller: CitadelTestRoom): Promise<void> {
  await place(caller, COUNCIL_SEAL);
  caller.send('callCouncil');
  await waitFor(() => t.rooms.every((r) => r.state.council.stage === 'voting'), 'council open');
}

function me(room: CitadelTestRoom) {
  const p = room.state.players.get(room.sessionId);
  if (p === undefined) throw new Error('player missing');
  return p;
}

describe('calling a council', () => {
  it('works only at the seal, and gathers everyone at their seats', async () => {
    const t = await started();
    const caller = t.honest[0];
    if (caller === undefined) throw new Error('no caller');
    await place(caller, stationCenter('ledger'));
    const refused = nextMessage(caller, SERVER_MESSAGES.COUNCIL_REFUSED);
    caller.send('callCouncil');
    expect(CouncilRefusedSchema.parse(await refused)).toEqual({ reason: 'notHere' });

    await call(t, caller);
    const c = t.byz.state.council;
    expect(c.calledBy).toBe(caller.sessionId);
    expect(c.number).toBe(1);
    expect(c.secondsLeft).toBeGreaterThan(0);
    for (const r of t.rooms) {
      const spawn = SPAWN_POINTS[me(r).seat];
      await waitFor(() => me(r).x === spawn?.x && me(r).y === spawn.y, 'gathered at the seal');
    }
  });

  it('closes open tasks and freezes movement while it runs', async () => {
    const t = await started();
    const worker = t.honest[1];
    const caller = t.honest[0];
    if (worker === undefined || caller === undefined) throw new Error('no players');
    await place(worker, { x: stationCenter('ledger').x, y: stationCenter('ledger').y + 1 });
    const opened = nextMessage(worker, SERVER_MESSAGES.TASK_OPENED);
    worker.send('openTask', { kind: 'ledger' });
    TaskOpenedSchema.parse(await opened);
    const closed = nextMessage(worker, SERVER_MESSAGES.TASK_CLOSED);
    await call(t, caller);
    expect(TaskClosedSchema.parse(await closed)).toEqual({ reason: 'council' });

    const before = { x: me(worker).x, y: me(worker).y };
    for (let seq = 1; seq <= 10; seq++) worker.send('move', { seq, dx: 1, dy: 0 });
    await waitFor(() => me(worker).ack === 10, 'inputs acknowledged');
    expect({ x: me(worker).x, y: me(worker).y }).toEqual(before);
  });
});

describe('voting', () => {
  it('hides choices until the result, then rotates out the Byzantine and the honest side wins', async () => {
    const t = await started();
    const [caller] = t.honest;
    if (caller === undefined) throw new Error('no caller');
    await call(t, caller);
    for (const r of t.honest) r.send('castVote', { target: t.byz.sessionId });
    await waitFor(() => t.byz.state.council.voted.length === 4, 'four voted');
    expect(t.byz.state.council.ballots.size).toBe(0);
    t.byz.send('castVote', { target: caller.sessionId });
    await waitFor(() => t.rooms.every((r) => r.state.council.stage === 'result'), 'result');
    const c = t.honest[1]?.state.council;
    expect(c?.ejected).toBe(t.byz.sessionId);
    expect(c?.ballots.get(t.byz.sessionId)).toBe(caller.sessionId);
    expect(c?.ballots.get(caller.sessionId)).toBe(t.byz.sessionId);
    expect(t.honest[1]?.state.players.get(t.byz.sessionId)?.out).toBe(true);
    // The role stays hidden until the match ends.
    expect(t.honest[1]?.state.players.get(t.byz.sessionId)?.role).toBeUndefined();
    await waitFor(() => t.rooms.every((r) => r.state.phase === 'ended'), 'ended');
    expect(t.byz.state.winner).toBe('honest');
    expect(t.byz.state.winReason).toBe('allByzantineRotatedOut');
  });

  it('ejects nobody when skips win, and play resumes', async () => {
    const t = await started();
    const [caller] = t.honest;
    if (caller === undefined) throw new Error('no caller');
    await call(t, caller);
    for (const r of t.rooms) r.send('castVote', { target: 'skip' });
    await waitFor(() => t.rooms.every((r) => r.state.council.stage === 'result'), 'result');
    expect(t.byz.state.council.ejected).toBe('');
    await waitFor(() => t.rooms.every((r) => r.state.council.stage === ''), 'resumed');
    expect(t.byz.state.phase).toBe('playing');
    expect([...t.byz.state.players.values()].every((p) => !p.out)).toBe(true);
  });

  it('turns a rotated-out honest guardian into a spectator who cannot act', async () => {
    const t = await started();
    const [caller, victim] = t.honest;
    if (caller === undefined || victim === undefined) throw new Error('no players');
    await call(t, caller);
    for (const r of t.rooms) if (r !== victim) r.send('castVote', { target: victim.sessionId });
    victim.send('castVote', { target: 'skip' });
    await waitFor(() => t.rooms.every((r) => r.state.council.stage === ''), 'resumed');
    expect(me(victim).out).toBe(true);
    expect(t.byz.state.phase).toBe('playing');
    await place(victim, { x: stationCenter('ledger').x, y: stationCenter('ledger').y + 1 });
    let opened = false;
    victim.onMessage(SERVER_MESSAGES.TASK_OPENED, () => {
      opened = true;
    });
    victim.send('openTask', { kind: 'ledger' });
    await sleep(200);
    expect(opened).toBe(false);
    await place(victim, COUNCIL_SEAL);
    const refused = nextMessage(victim, SERVER_MESSAGES.COUNCIL_REFUSED);
    victim.send('callCouncil');
    expect(CouncilRefusedSchema.parse(await refused)).toEqual({ reason: 'cannotAct' });
  });

  it('allows one call per guardian per match', async () => {
    const t = await started();
    const [caller] = t.honest;
    if (caller === undefined) throw new Error('no caller');
    await call(t, caller);
    for (const r of t.rooms) r.send('castVote', { target: 'skip' });
    await waitFor(() => t.rooms.every((r) => r.state.council.stage === ''), 'resumed');
    await sleep(TIMING.cooldownMs + 50);
    await place(caller, COUNCIL_SEAL);
    const refused = nextMessage(caller, SERVER_MESSAGES.COUNCIL_REFUSED);
    caller.send('callCouncil');
    expect(CouncilRefusedSchema.parse(await refused)).toEqual({ reason: 'usedUp' });
  });
});

describe('quick chat', () => {
  it('reaches everyone during a council, stamped with the sender', async () => {
    const t = await started();
    const [caller, other] = t.honest;
    if (caller === undefined || other === undefined) throw new Error('no players');
    await call(t, caller);
    const heard = nextMessage(other, SERVER_MESSAGES.CHAT);
    caller.send('quickChat', { chat: { phrase: 'suspect', playerId: t.byz.sessionId } });
    expect(ChatLineSchema.parse(await heard)).toEqual({ from: caller.sessionId, chat: { phrase: 'suspect', playerId: t.byz.sessionId } });
  });

  it('is refused outside councils during play, for unknown references, and when too fast', async () => {
    const t = await started();
    const [caller] = t.honest;
    if (caller === undefined) throw new Error('no caller');
    const silent = nextMessage(caller, SERVER_MESSAGES.COUNCIL_REFUSED);
    caller.send('quickChat', { chat: { phrase: 'iAgree' } });
    expect(CouncilRefusedSchema.parse(await silent)).toEqual({ reason: 'cannotAct' });

    await call(t, caller);
    const unknown = nextMessage(caller, SERVER_MESSAGES.COUNCIL_REFUSED);
    caller.send('quickChat', { chat: { phrase: 'suspect', playerId: 'nobody-here-01' } });
    expect(CouncilRefusedSchema.parse(await unknown)).toEqual({ reason: 'invalidTarget' });

    caller.send('quickChat', { chat: { phrase: 'iAgree' } });
    const fast = nextMessage(caller, SERVER_MESSAGES.COUNCIL_REFUSED);
    caller.send('quickChat', { chat: { phrase: 'iAgree' } });
    expect(CouncilRefusedSchema.parse(await fast).reason).toBe('chatLimit');
  });

  it('works in the lobby', async () => {
    const rooms = await lobby(2);
    const [a, b] = rooms;
    if (a === undefined || b === undefined) throw new Error('no rooms');
    const heard = nextMessage(b, SERVER_MESSAGES.CHAT);
    a.send('quickChat', { chat: { phrase: 'iAgree' } });
    expect(ChatLineSchema.parse(await heard)).toEqual({ from: a.sessionId, chat: { phrase: 'iAgree' } });
  });

  it('closes the socket for a malformed line', async () => {
    const rooms = await lobby(2);
    const [a] = rooms;
    if (a === undefined) throw new Error('no room');
    const closed = new Promise<number>((resolve) => {
      a.onLeave((code) => {
        resolve(code);
      });
    });
    a.send('quickChat', { chat: { phrase: 'freeText', text: 'hello' } });
    expect(await closed).toBe(4002);
  });
});
