import type { Room } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditSchema,
  CEREMONY_TIMING,
  CeremonyRefusedSchema,
  ForgedSchema,
  SERVER_MESSAGES,
  stationCenter,
  threshold,
  type CeremonyTiming,
  type Vec2,
} from '@byzantine-council/shared';
import type { CitadelRoom } from '../src/CitadelRoom.js';
import { createRoom, joinRoom, sdk, sleep, startServer, waitFor, type CitadelTestRoom } from './helpers.js';

const PORT = 3866;
const TIMING: CeremonyTiming = {
  ...CEREMONY_TIMING,
  firstProposalMs: 200,
  spawnMinMs: 1500,
  spawnMaxMs: 1500,
  ttlMs: 30_000,
  maxOpen: 6,
  forgeCooldownMs: 300,
  auditMs: 250,
  auditCooldownMs: 0,
};
const HALL: Vec2 = { x: 3.5, y: 15.5 };
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, reconnectSeconds: 5, ceremonyTiming: TIMING, resultMs: 400 }));
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

async function started(n = 5): Promise<Table> {
  const host = await createRoom(client(), { nickname: 'Host', private: true });
  const rooms = [host];
  for (let i = 1; i < n; i++) rooms.push(await joinRoom(client(), host.roomId, { nickname: `Guardian ${String(i)}` }));
  await waitFor(() => rooms.every((r) => r.state.players.size === n), 'everyone synced');
  host.send('startMatch');
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

function proposal(room: CitadelTestRoom, id: string) {
  return room.state.proposals.find((p) => p.id === id);
}

// Collects every message of a type a room receives from now on.
function record(room: Room, type: string): unknown[] {
  const seen: unknown[] = [];
  room.onMessage(type, (payload: unknown) => seen.push(payload));
  return seen;
}

async function forge(t: Table): Promise<string> {
  // Forging opens with the first real withdrawal.
  await waitFor(() => proposal(t.byz, '1') !== undefined, 'proposals open');
  await place(t.byz, HALL);
  const notice = nextMessage(t.byz, SERVER_MESSAGES.FORGED);
  t.byz.send('forgeProposal');
  const { proposalId } = ForgedSchema.parse(await notice);
  await waitFor(() => t.rooms.every((r) => proposal(r, proposalId) !== undefined), 'forgery visible');
  return proposalId;
}

describe('real withdrawals', () => {
  it('appear for everyone after the opening and pass in public once enough guardians sign', async () => {
    const t = await started();
    await waitFor(() => t.rooms.every((r) => proposal(r, '1') !== undefined), 'first withdrawal');
    const first = proposal(t.rooms[0] ?? t.byz, '1');
    expect(first?.status).toBe('open');
    expect(first?.verdict).toBe('');
    expect(first?.secondsLeft).toBeGreaterThan(0);
    // Nothing on the synced object says who filed it or whether it is real.
    expect(Object.keys(first?.toJSON() ?? {}).sort()).toEqual(['amount', 'id', 'refusers', 'secondsLeft', 'signers', 'status', 'verdict']);
    expect(t.rooms[0]?.state.signaturesNeeded).toBe(threshold(5));

    const signers = t.honest.slice(0, threshold(5));
    for (const r of signers) r.send('signProposal', { proposalId: '1' });
    await waitFor(() => t.rooms.every((r) => proposal(r, '1')?.status === 'passed'), 'passed');
    const passed = proposal(t.byz, '1');
    expect(passed?.verdict).toBe('legit');
    expect([...(passed?.signers ?? [])].sort()).toEqual(signers.map((r) => r.sessionId).sort());
    expect(t.byz.state.livenessStrikes).toBe(0);
  });

  it('cost liveness when refused, and three failures hand the Byzantines the match', async () => {
    const t = await started();
    for (const id of ['1', '2', '3']) {
      await waitFor(() => proposal(t.byz, id) !== undefined, `withdrawal ${id}`);
      for (const r of t.honest.slice(0, 2)) r.send('refuseProposal', { proposalId: id });
      await waitFor(() => proposal(t.byz, id)?.status !== 'open', `withdrawal ${id} closed`);
      expect(proposal(t.byz, id)).toMatchObject({ status: 'rejected' });
    }
    await waitFor(() => t.rooms.every((r) => r.state.phase === 'ended'), 'ended');
    expect(t.byz.state.winner).toBe('byzantine');
    expect(t.byz.state.winReason).toBe('livenessLost');
    expect(t.byz.state.livenessStrikes).toBe(3);
  });
});

describe('forgeries', () => {
  it('tell only the Byzantines which proposal is forged', async () => {
    const t = await started(7);
    const fellow = t.rooms.find((r) => r !== t.byz && r.state.players.get(r.sessionId)?.role === 'byzantine');
    const honest = t.rooms.filter((r) => r.state.players.get(r.sessionId)?.role === 'honest');
    const honestNotices = honest.map((r) => record(r, SERVER_MESSAGES.FORGED));
    const fellowNotice = fellow === undefined ? null : nextMessage(fellow, SERVER_MESSAGES.FORGED);
    const id = await forge(t);
    expect(ForgedSchema.parse(await fellowNotice)).toEqual({ proposalId: id });
    await sleep(200);
    expect(honestNotices.flat()).toEqual([]);
    for (const r of t.rooms) expect(proposal(r, id)?.verdict).toBe('');
  });

  it('can only be filed by a Byzantine standing in the Signing Hall', async () => {
    const t = await started();
    await sleep(TIMING.firstProposalMs + 50);
    const plaza = nextMessage(t.byz, SERVER_MESSAGES.CEREMONY_REFUSED);
    t.byz.send('forgeProposal');
    expect(CeremonyRefusedSchema.parse(await plaza)).toEqual({ reason: 'notHere' });
    const honest = t.honest[0];
    if (honest === undefined) throw new Error('no honest player');
    await place(honest, HALL);
    const refused = nextMessage(honest, SERVER_MESSAGES.CEREMONY_REFUSED);
    honest.send('forgeProposal');
    expect(CeremonyRefusedSchema.parse(await refused)).toEqual({ reason: 'cannotAct' });
  });

  it('are revealed when refused, and the match goes on', async () => {
    const t = await started();
    const id = await forge(t);
    for (const r of t.honest.slice(0, 2)) r.send('refuseProposal', { proposalId: id });
    await waitFor(() => t.rooms.every((r) => proposal(r, id)?.status === 'rejected'), 'rejected');
    expect(proposal(t.honest[0] ?? t.byz, id)?.verdict).toBe('forged');
    expect(t.byz.state.livenessStrikes).toBe(0);
    expect(t.byz.state.phase).toBe('playing');
  });

  it('win the match for the Byzantines once they collect enough signatures', async () => {
    const t = await started();
    const id = await forge(t);
    t.byz.send('signProposal', { proposalId: id });
    for (const r of t.honest.slice(0, threshold(5) - 1)) r.send('signProposal', { proposalId: id });
    await waitFor(() => t.rooms.every((r) => r.state.phase === 'ended'), 'ended');
    expect(t.byz.state.winner).toBe('byzantine');
    expect(t.byz.state.winReason).toBe('forgedProposalPassed');
    expect(proposal(t.byz, id)?.verdict).toBe('forged');
  });

  it('refuse a second answer from the same guardian', async () => {
    const t = await started();
    const id = await forge(t);
    const r = t.honest[0];
    if (r === undefined) throw new Error('no honest player');
    r.send('signProposal', { proposalId: id });
    await waitFor(() => proposal(r, id)?.signers.length === 1, 'signed');
    const refused = nextMessage(r, SERVER_MESSAGES.CEREMONY_REFUSED);
    r.send('refuseProposal', { proposalId: id });
    expect(CeremonyRefusedSchema.parse(await refused)).toEqual({ reason: 'alreadyResponded' });
    expect(proposal(r, id)?.refusers.length).toBe(0);
  });
});

describe('audits', () => {
  it('show the truth to the auditor alone, at the Ledger Archive', async () => {
    const t = await started();
    const id = await forge(t);
    const [auditor, other] = t.honest;
    if (auditor === undefined || other === undefined) throw new Error('no honest players');
    const othersSee = record(other, SERVER_MESSAGES.AUDIT);
    const away = nextMessage(auditor, SERVER_MESSAGES.CEREMONY_REFUSED);
    auditor.send('auditProposal', { proposalId: id });
    expect(CeremonyRefusedSchema.parse(await away)).toEqual({ reason: 'notHere' });

    await place(auditor, stationCenter('ledger'));
    const started_ = nextMessage(auditor, SERVER_MESSAGES.AUDIT);
    auditor.send('auditProposal', { proposalId: id });
    expect(AuditSchema.parse(await started_)).toEqual({ status: 'started', proposalId: id, ms: TIMING.auditMs });
    const done = AuditSchema.parse(await nextMessage(auditor, SERVER_MESSAGES.AUDIT));
    expect(done).toEqual({ status: 'done', proposalId: id, forged: true });
    expect(othersSee).toEqual([]);
    expect(proposal(other, id)?.verdict).toBe('');
  });

  it('are cancelled when the auditor walks away', async () => {
    const t = await started();
    const id = await forge(t);
    const auditor = t.honest[0];
    if (auditor === undefined) throw new Error('no honest player');
    await place(auditor, stationCenter('ledger'));
    const begun = nextMessage(auditor, SERVER_MESSAGES.AUDIT);
    auditor.send('auditProposal', { proposalId: id });
    await begun;
    const cancelled = nextMessage(auditor, SERVER_MESSAGES.AUDIT);
    await place(auditor, { x: 15, y: 15 });
    expect(AuditSchema.parse(await cancelled)).toEqual({ status: 'cancelled', proposalId: id });
  });
});

describe('the lobby', () => {
  it('clears proposals after the match', async () => {
    const t = await started();
    const id = await forge(t);
    t.byz.send('signProposal', { proposalId: id });
    for (const r of t.honest.slice(0, threshold(5) - 1)) r.send('signProposal', { proposalId: id });
    await waitFor(() => t.rooms.every((r) => r.state.phase === 'lobby'), 'back in the lobby');
    expect(t.byz.state.proposals.length).toBe(0);
    expect(t.byz.state.signaturesNeeded).toBe(0);
  });
});
