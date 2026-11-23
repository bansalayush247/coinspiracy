import type { Room } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import {
  ALL_TASKS,
  CLOSE_CODES,
  ROOM_LOOKUP_PATH,
  SERVER_MESSAGES,
  TASK_KINDS,
  TaskClosedSchema,
  TaskOpenedSchema,
  TaskRefusedSchema,
  TaskResultSchema,
  solveChallenge,
  stationCenter,
  taskBit,
  type TaskKind,
  type TaskTiming,
} from '@byzantine-council/shared';
import type { CitadelRoom } from '../src/CitadelRoom.js';
import { createRoom, freshIp, joinRoom, sdk, sleep, startServer, waitFor, type CitadelTestRoom } from './helpers.js';
import { MatchMakeError } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { CitadelState } from '@byzantine-council/shared/state';

const PORT = 3865;
const RESULT_MS = 400;
const FAST: TaskTiming = {
  minSolveMs: { deposit: 0, ledger: 0, route: 0, watchtower: 0 },
  expireMs: 60_000,
  retryMs: 300,
  openCooldownMs: 0,
};
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, reconnectSeconds: 5, taskTiming: FAST, resultMs: RESULT_MS }));
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

// A private room with `n` players; the first one is the host.
async function lobby(n: number): Promise<CitadelTestRoom[]> {
  const host = await createRoom(client(), { nickname: 'Host', private: true });
  const rooms = [host];
  for (let i = 1; i < n; i++) rooms.push(await joinRoom(client(), host.roomId, { nickname: `Guardian ${String(i)}` }));
  await waitFor(() => rooms.every((r) => r.state.players.size === n), 'everyone synced');
  return rooms;
}

async function started(n: number): Promise<CitadelTestRoom[]> {
  const rooms = await lobby(n);
  rooms[0]?.send('startMatch');
  await waitFor(() => rooms.every((r) => r.state.phase === 'playing' && r.state.players.get(r.sessionId)?.role !== undefined), 'match started');
  return rooms;
}

function roleOf(room: CitadelTestRoom): string | undefined {
  return room.state.players.get(room.sessionId)?.role;
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

// Puts a player next to a station on the server, then waits for their own client to see it.
async function standAt(room: CitadelTestRoom, kind: TaskKind, offsetY = 1): Promise<void> {
  const c = stationCenter(kind);
  const p = serverRoom(room).state.players.get(room.sessionId);
  if (p === undefined) throw new Error('player missing');
  p.x = c.x;
  p.y = c.y + offsetY;
  await waitFor(() => room.state.players.get(room.sessionId)?.y === c.y + offsetY, 'position synced');
}

async function doTask(room: CitadelTestRoom, kind: TaskKind): Promise<void> {
  await standAt(room, kind);
  const opened = nextMessage(room, SERVER_MESSAGES.TASK_OPENED);
  room.send('openTask', { kind });
  const task = TaskOpenedSchema.parse(await opened);
  const result = nextMessage(room, SERVER_MESSAGES.TASK_RESULT);
  room.send('taskAnswer', { id: task.id, answer: solveChallenge(task.challenge) });
  expect(TaskResultSchema.parse(await result)).toStrictEqual({ id: task.id, ok: true });
}

describe('starting a match', () => {
  it('waits for the host and five connected guardians', async () => {
    const rooms = await lobby(4);
    const [host, guest] = rooms;
    if (host === undefined || guest === undefined) throw new Error('no rooms');
    host.send('startMatch');
    await sleep(150);
    expect(host.state.phase).toBe('lobby');
    const fifth = await joinRoom(client(), host.roomId, { nickname: 'Fifth' });
    rooms.push(fifth);
    await waitFor(() => host.state.players.size === 5, 'fifth synced');
    guest.send('startMatch');
    await sleep(150);
    expect(host.state.phase).toBe('lobby');
    host.send('startMatch');
    await waitFor(() => rooms.every((r) => r.state.phase === 'playing'), 'playing');
    expect(host.state.byzantines).toBe(1);
    expect(host.state.consensus).toBe(0);
  });

  it('tells each guardian only their own role and keeps task lists private', async () => {
    const rooms = await started(5);
    expect(rooms[0]?.state.recap.length).toBe(0);
    const roles = rooms.map(roleOf);
    expect(roles.filter((r) => r === 'byzantine')).toHaveLength(1);
    expect(roles.filter((r) => r === 'honest')).toHaveLength(4);
    for (const room of rooms) {
      for (const [id, p] of room.state.players) {
        if (id === room.sessionId) {
          expect(p.tasks).toBe(ALL_TASKS);
          expect(p.tasksDone).toBe(0);
        } else {
          expect(p.role).toBeUndefined();
          expect(p.tasks).toBeUndefined();
        }
      }
    }
  });

  it('shows Byzantines each other in a seven-player match, and nobody else', async () => {
    const rooms = await started(7);
    const byzantine = rooms.filter((r) => roleOf(r) === 'byzantine');
    expect(byzantine).toHaveLength(2);
    const ids = new Set(byzantine.map((r) => r.sessionId));
    for (const room of rooms) {
      const visible = [...room.state.players].filter(([, p]) => p.role !== undefined).map(([id]) => id);
      if (ids.has(room.sessionId)) expect(new Set(visible)).toEqual(ids);
      else expect(visible).toStrictEqual([room.sessionId]);
    }
  });

  it('moves everyone to their seat and locks the room against newcomers', async () => {
    const rooms = await started(5);
    const [host] = rooms;
    if (host === undefined) throw new Error('no host');
    const server = serverRoom(host);
    expect(server.locked).toBe(true);
    const res = await fetch(`http://127.0.0.1:${String(PORT)}${ROOM_LOOKUP_PATH}/${host.state.code}`, { headers: { 'X-Real-IP': freshIp() } });
    expect(res.status).toBe(409);
    await expect(client().joinById(host.roomId, { nickname: 'Late' })).rejects.toBeInstanceOf(MatchMakeError);
  });
});

describe('tasks', () => {
  it('fills the consensus bar for honest tasks and only the owner sees their progress', async () => {
    const rooms = await started(5);
    const honest = rooms.find((r) => roleOf(r) === 'honest');
    if (honest === undefined) throw new Error('no honest player');
    await doTask(honest, 'ledger');
    await waitFor(() => rooms.every((r) => r.state.consensus === 6), 'consensus synced');
    expect(honest.state.players.get(honest.sessionId)?.tasksDone).toBe(taskBit('ledger'));
  });

  it('lets a Byzantine fake a task without moving the bar', async () => {
    const rooms = await started(5);
    const byzantine = rooms.find((r) => roleOf(r) === 'byzantine');
    if (byzantine === undefined) throw new Error('no byzantine');
    await doTask(byzantine, 'watchtower');
    await sleep(100);
    expect(byzantine.state.consensus).toBe(0);
    expect(byzantine.state.players.get(byzantine.sessionId)?.tasksDone).toBe(taskBit('watchtower'));
  });

  it('refuses to open a station from across the map', async () => {
    const [host] = await started(5);
    if (host === undefined) throw new Error('no host');
    const refused = nextMessage(host, SERVER_MESSAGES.TASK_REFUSED);
    host.send('openTask', { kind: 'deposit' });
    expect(TaskRefusedSchema.parse(await refused)).toStrictEqual({ reason: 'outOfRange' });
  });

  it('locks a station briefly after a wrong answer', async () => {
    const [host] = await started(5);
    if (host === undefined) throw new Error('no host');
    await standAt(host, 'watchtower');
    const opened = nextMessage(host, SERVER_MESSAGES.TASK_OPENED);
    host.send('openTask', { kind: 'watchtower' });
    const task = TaskOpenedSchema.parse(await opened);
    const result = nextMessage(host, SERVER_MESSAGES.TASK_RESULT);
    host.send('taskAnswer', { id: task.id, answer: { kind: 'watchtower', height: 1 } });
    expect(TaskResultSchema.parse(await result)).toStrictEqual({ id: task.id, ok: false, retryInMs: FAST.retryMs });
    const refused = nextMessage(host, SERVER_MESSAGES.TASK_REFUSED);
    host.send('openTask', { kind: 'watchtower' });
    expect(TaskRefusedSchema.parse(await refused).reason).toBe('retryLater');
  });

  it('closes an open challenge when the player walks away', async () => {
    const [host] = await started(5);
    if (host === undefined) throw new Error('no host');
    await standAt(host, 'route');
    const opened = nextMessage(host, SERVER_MESSAGES.TASK_OPENED);
    host.send('openTask', { kind: 'route' });
    await opened;
    const closed = nextMessage(host, SERVER_MESSAGES.TASK_CLOSED);
    await standAt(host, 'route', 4);
    expect(TaskClosedSchema.parse(await closed)).toStrictEqual({ reason: 'moved' });
  });

  it('ignores task messages in the lobby and closes the socket on a malformed answer', async () => {
    const [host] = await lobby(2);
    if (host === undefined) throw new Error('no host');
    await standAt(host, 'ledger');
    host.send('openTask', { kind: 'ledger' });
    await sleep(150);
    expect(host.connection.isOpen).toBe(true);
    const left = new Promise<number>((resolve) => {
      host.onLeave((code) => {
        resolve(code);
      });
    });
    host.send('taskAnswer', { id: 'short', answer: { kind: 'ledger', reject: [9, 9] } });
    expect(await left).toBe(4002);
  });
});

describe('ending a match', () => {
  it('ends in an honest win at full consensus, reveals every role, then reopens the lobby', async () => {
    const rooms = await started(5);
    for (const room of rooms.filter((r) => roleOf(r) === 'honest')) {
      for (const kind of TASK_KINDS) await doTask(room, kind);
    }
    await waitFor(() => rooms.every((r) => r.state.phase === 'ended'), 'ended');
    for (const room of rooms) {
      expect(room.state.winner).toBe('honest');
      expect(room.state.winReason).toBe('consensusReached');
      expect(room.state.consensus).toBe(100);
      expect([...room.state.players.values()].every((p) => p.role !== undefined)).toBe(true);
    }
    expect(rooms[0]?.state.recap.length).toBe(5);
    await waitFor(() => rooms.every((r) => r.state.phase === 'lobby'), 'back in the lobby', RESULT_MS + 2000);
    for (const room of rooms) {
      expect(room.state.recap.length).toBe(0);
      expect(room.state.winner).toBe('');
      expect(room.state.consensus).toBe(0);
      for (const p of room.state.players.values()) {
        expect(p.role).toBeUndefined();
        expect(p.tasks).toBeUndefined();
      }
    }
    const [host] = rooms;
    if (host === undefined) throw new Error('no host');
    expect(serverRoom(host).locked).toBe(false);
    // And a second match deals fresh roles.
    host.send('startMatch');
    await waitFor(() => rooms.every((r) => roleOf(r) !== undefined), 'second match');
  });

  it('ends in an honest win when the only Byzantine leaves', async () => {
    const rooms = await started(5);
    const byzantine = rooms.find((r) => roleOf(r) === 'byzantine');
    if (byzantine === undefined) throw new Error('no byzantine');
    await byzantine.leave();
    const rest = rooms.filter((r) => r !== byzantine);
    await waitFor(() => rest.every((r) => r.state.phase === 'ended'), 'ended');
    expect(rest[0]?.state.winner).toBe('honest');
    expect(rest[0]?.state.winReason).toBe('allByzantineRotatedOut');
    // The recap names the Byzantine who walked out, so the reveal is complete.
    const recap = [...(rest[0]?.state.recap ?? [])];
    expect(recap).toHaveLength(5);
    expect(recap.filter((e) => e.left).map((e) => [e.id, e.role])).toStrictEqual([[byzantine.sessionId, 'byzantine']]);
  });

  it('keeps the consensus bar still when guardians leave, whatever their side', async () => {
    const rooms = await started(7);
    const honest = rooms.filter((r) => roleOf(r) === 'honest');
    const [byzantine] = rooms.filter((r) => roleOf(r) === 'byzantine');
    const [worker, idle] = honest;
    if (worker === undefined || idle === undefined || byzantine === undefined) throw new Error('bad deal');
    await doTask(worker, 'ledger');
    // One of twenty honest tasks.
    await waitFor(() => rooms.every((r) => r.state.consensus === 5), 'consensus synced');
    // Byzantine first: losing an honest guardian first would leave 2 of 6 and halt the federation.
    await byzantine.leave();
    await idle.leave();
    const rest = rooms.filter((r) => r !== idle && r !== byzantine);
    await waitFor(() => rest.every((r) => r.state.players.size === 5), 'departures synced');
    await sleep(150);
    for (const room of rest) {
      expect(room.state.phase).toBe('playing');
      expect(room.state.consensus).toBe(5);
    }
  });

  it('reaches consensus once every remaining honest guardian is done, even after one left', async () => {
    const rooms = await started(5);
    const [leaver, ...rest] = rooms.filter((r) => roleOf(r) === 'honest');
    if (leaver === undefined) throw new Error('no honest player');
    await leaver.leave();
    for (const room of rest) for (const kind of TASK_KINDS) await doTask(room, kind);
    const stayed = rooms.filter((r) => r !== leaver);
    await waitFor(() => stayed.every((r) => r.state.phase === 'ended'), 'ended');
    for (const room of stayed) {
      expect(room.state.winner).toBe('honest');
      expect(room.state.winReason).toBe('consensusReached');
      expect(room.state.consensus).toBe(100);
    }
  });

  it('keeps acking each player’s moves, and only to them, once the room is back in the lobby', async () => {
    const rooms = await started(5);
    const byzantine = rooms.find((r) => roleOf(r) === 'byzantine');
    if (byzantine === undefined) throw new Error('no byzantine');
    await byzantine.leave();
    const [mover, other] = rooms.filter((r) => r !== byzantine);
    if (mover === undefined || other === undefined) throw new Error('no players');
    await waitFor(() => mover.state.phase === 'lobby', 'back in the lobby', RESULT_MS + 2000);
    mover.send('move', { seq: 1, dx: 1, dy: 0 });
    await waitFor(() => mover.state.players.get(mover.sessionId)?.ack === 1, 'move acked');
    expect(other.state.players.get(mover.sessionId)?.ack).toBeUndefined();
    expect(mover.state.players.get(mover.sessionId)?.role).toBeUndefined();
  });

  it('halts the federation when too many honest guardians leave', async () => {
    const rooms = await started(5);
    const honest = rooms.filter((r) => roleOf(r) === 'honest');
    await honest[0]?.leave();
    await honest[1]?.leave();
    const rest = rooms.filter((r) => r !== honest[0] && r !== honest[1]);
    await waitFor(() => rest.every((r) => r.state.phase === 'ended'), 'ended');
    expect(rest[0]?.state.winner).toBe('byzantine');
    expect(rest[0]?.state.winReason).toBe('federationHalted');
  });

  it('keeps a dropped player’s role and progress across a reconnect', async () => {
    const rooms = await started(5);
    const honest = rooms.find((r) => roleOf(r) === 'honest');
    if (honest === undefined) throw new Error('no honest player');
    const result = nextMessage(honest, SERVER_MESSAGES.TASK_RESULT);
    await standAt(honest, 'deposit');
    const opened = nextMessage(honest, SERVER_MESSAGES.TASK_OPENED);
    honest.send('openTask', { kind: 'deposit' });
    const task = TaskOpenedSchema.parse(await opened);
    honest.send('taskAnswer', { id: task.id, answer: solveChallenge(task.challenge) });
    await result;
    honest.reconnection.minUptime = 0;
    const back = new Promise<void>((resolve) => {
      honest.onReconnect(() => {
        resolve();
      });
    });
    (serverRoom(honest).clients.get(honest.sessionId)?.ref as WebSocket | undefined)?.terminate();
    // The server already counts the task; the drop lands before the patch carrying it.
    await back;
    await waitFor(() => honest.state.players.get(honest.sessionId)?.tasksDone === taskBit('deposit'), 'progress restored by the resync');
    expect(roleOf(honest)).toBe('honest');
    expect(honest.state.players.get(honest.sessionId)?.status).toBe('active');
    await doTask(honest, 'route');
  });

  it('refuses a seat reserved just before the start once the match is on', async () => {
    const rooms = await lobby(5);
    const [host] = rooms;
    if (host === undefined) throw new Error('no host');
    const reservation = await matchMaker.joinById(host.roomId, { nickname: 'Sneaky' }, { ip: freshIp(), headers: new Headers() });
    host.send('startMatch');
    await waitFor(() => host.state.phase === 'playing', 'playing');
    await expect(client().consumeSeatReservation(reservation, CitadelState)).rejects.toMatchObject({ code: CLOSE_CODES.MATCH_IN_PROGRESS });
    expect(host.state.players.size).toBe(5);
  });
});
