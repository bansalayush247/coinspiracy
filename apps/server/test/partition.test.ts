import type { Room } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CEREMONY_TIMING,
  CeremonyRefusedSchema,
  RELAYS,
  SABOTAGE_TIMING,
  SERVER_MESSAGES,
  SabotageReadySchema,
  SabotageRefusedSchema,
  TaskClosedSchema,
  TaskOpenedSchema,
  stationCenter,
  type SabotageTiming,
  type Vec2,
} from '@byzantine-council/shared';
import type { CitadelRoom } from '../src/CitadelRoom.js';
import { createRoom, joinRoom, sdk, sleep, startServer, waitFor, type CitadelTestRoom } from './helpers.js';

const PORT = 3868;
const TIMING: SabotageTiming = { ...SABOTAGE_TIMING, openingMs: 0, partitionMs: 1500, partitionCooldownMs: 0, repairMs: 300, freezeMs: 1200, freezeCooldownMs: 0 };
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, {
    maxSeatsPerIp: 64,
    reconnectSeconds: 5,
    sabotageTiming: TIMING,
    ceremonyTiming: { ...CEREMONY_TIMING, firstProposalMs: 0, spawnMinMs: 600_000, spawnMaxMs: 600_000, ttlMs: 600_000 },
    resultMs: 500,
  }));
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

const client = () => sdk(PORT);

interface Table {
  readonly rooms: CitadelTestRoom[];
  readonly byz: CitadelTestRoom;
  readonly honest: CitadelTestRoom[];
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

async function started(): Promise<Table> {
  const host = await createRoom(client(), { nickname: 'Host', private: true });
  const rooms = [host];
  for (let i = 1; i < 5; i++) rooms.push(await joinRoom(client(), host.roomId, { nickname: `Guardian ${String(i)}` }));
  await waitFor(() => rooms.every((r) => r.state.players.size === 5), 'everyone synced');
  // Readiness is sent at the start, so listen before starting.
  const ready = rooms.map((r) => {
    const seen: unknown[] = [];
    r.onMessage(SERVER_MESSAGES.SABOTAGE_READY, (p: unknown) => seen.push(p));
    return seen;
  });
  host.send('startMatch');
  await waitFor(() => rooms.every((r) => r.state.players.get(r.sessionId)?.role !== undefined), 'roles dealt');
  const i = rooms.findIndex((r) => r.state.players.get(r.sessionId)?.role === 'byzantine');
  const byz = rooms[i];
  if (byz === undefined) throw new Error('no Byzantine');
  await waitFor(() => (ready[i]?.length ?? 0) > 0, 'readiness sent');
  expect(SabotageReadySchema.parse(ready[i]?.[0])).toEqual({ partitionInMs: 0, freezeInMs: 0 });
  expect(ready.filter((_, j) => j !== i).flat()).toEqual([]);
  return { rooms, byz, honest: rooms.filter((r) => r !== byz) };
}

async function place(room: CitadelTestRoom, pos: Vec2): Promise<void> {
  const p = colyseus.getRoomById<CitadelRoom>(room.roomId).state.players.get(room.sessionId);
  if (p === undefined) throw new Error('player missing');
  p.x = pos.x;
  p.y = pos.y;
  await waitFor(() => room.state.players.get(room.sessionId)?.x === pos.x, 'position synced');
}

describe('network partitions', () => {
  it('block signing for everyone until two guardians hold both relays', async () => {
    const t = await started();
    await waitFor(() => t.byz.state.proposals.length === 1, 'a withdrawal is open');
    t.byz.send('partition');
    await waitFor(() => t.rooms.every((r) => r.state.partition > 0), 'partition visible');
    const [a, b] = t.honest;
    if (a === undefined || b === undefined) throw new Error('no honest players');
    const refused = nextMessage(a, SERVER_MESSAGES.CEREMONY_REFUSED);
    a.send('signProposal', { proposalId: '1' });
    expect(CeremonyRefusedSchema.parse(await refused)).toEqual({ reason: 'partitioned' });

    await place(a, RELAYS[0] ?? { x: 0, y: 0 });
    await waitFor(() => t.byz.state.relays === 0b01, 'one relay held');
    await place(b, RELAYS[1] ?? { x: 0, y: 0 });
    await waitFor(() => t.rooms.every((r) => r.state.partition === 0), 'repaired');
    expect(t.byz.state.outages).toBe(0);
    a.send('signProposal', { proposalId: '1' });
    await waitFor(() => t.byz.state.proposals.at(0).signers.length === 1, 'signing works again');
  });

  it('cost liveness when they run out, and three outages end the match', async () => {
    const t = await started();
    for (let i = 1; i <= 3; i++) {
      t.byz.send('partition');
      await waitFor(() => t.byz.state.partition > 0 || t.byz.state.phase !== 'playing', `partition ${String(i)}`);
      await waitFor(() => t.byz.state.outages === i || t.byz.state.phase !== 'playing', `outage ${String(i)}`, 5000);
      if (i < 3) expect(t.byz.state.livenessStrikes).toBe(i);
    }
    await waitFor(() => t.rooms.every((r) => r.state.phase === 'ended'), 'ended');
    expect(t.byz.state.winner).toBe('byzantine');
    expect(t.byz.state.winReason).toBe('livenessLost');
  });

  it('are refused to honest guardians without telling them anything else', async () => {
    const t = await started();
    const [a] = t.honest;
    if (a === undefined) throw new Error('no honest player');
    const refused = nextMessage(a, SERVER_MESSAGES.SABOTAGE_REFUSED);
    a.send('partition');
    expect(SabotageRefusedSchema.parse(await refused)).toEqual({ reason: 'cannotAct' });
    await sleep(100);
    expect(t.byz.state.partition).toBe(0);
  });
});

describe('freezing a guardian', () => {
  it('stops them in place and drops their task, then thaws', async () => {
    const t = await started();
    const [victim] = t.honest;
    if (victim === undefined) throw new Error('no honest player');
    const desk = stationCenter('ledger');
    await place(victim, { x: desk.x, y: desk.y + 1 });
    const opened = nextMessage(victim, SERVER_MESSAGES.TASK_OPENED);
    victim.send('openTask', { kind: 'ledger' });
    TaskOpenedSchema.parse(await opened);

    const closed = nextMessage(victim, SERVER_MESSAGES.TASK_CLOSED);
    await place(t.byz, { x: desk.x + 0.8, y: desk.y + 1 });
    t.byz.send('freeze', { targetId: victim.sessionId });
    expect(TaskClosedSchema.parse(await closed)).toEqual({ reason: 'frozen' });
    await waitFor(() => t.rooms.every((r) => (r.state.players.get(victim.sessionId)?.frozen ?? 0) > 0), 'frozen for everyone');

    const before = victim.state.players.get(victim.sessionId)?.x;
    for (let seq = 1; seq <= 6; seq++) victim.send('move', { seq, dx: -1, dy: 0 });
    await waitFor(() => victim.state.players.get(victim.sessionId)?.ack === 6, 'inputs acknowledged');
    expect(victim.state.players.get(victim.sessionId)?.x).toBe(before);

    await waitFor(() => victim.state.players.get(victim.sessionId)?.frozen === 0, 'thawed', 4000);
  });

  it('needs the Byzantine to stand next to the target', async () => {
    const t = await started();
    const [victim] = t.honest;
    if (victim === undefined) throw new Error('no honest player');
    await place(victim, { x: 15, y: 15 });
    await place(t.byz, { x: 20, y: 15 });
    const refused = nextMessage(t.byz, SERVER_MESSAGES.SABOTAGE_REFUSED);
    t.byz.send('freeze', { targetId: victim.sessionId });
    expect(SabotageRefusedSchema.parse(await refused)).toEqual({ reason: 'notHere' });
  });
});
