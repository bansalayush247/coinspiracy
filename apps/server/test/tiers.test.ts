import type { Room } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CEREMONY_TIMING,
  CeremonyRefusedSchema,
  SABOTAGE_TIMING,
  SERVER_MESSAGES,
  SabotageRefusedSchema,
  TierRefusedSchema,
  type JoinOptions,
  type TierId,
} from '@byzantine-council/shared';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../src/profile/store.js';
import { COOKIE_NAME, newProfileId, signCookie, type SessionKeys } from '../src/profile/session.js';
import { createRoom, joinRoom, quickMatch, sdk, sleep, startServer, waitFor, type CitadelTestRoom } from './helpers.js';

const PORT = 3872;
const keys: SessionKeys = { current: Buffer.from('t'.repeat(32)), previous: null, secure: false };
const STARS: Readonly<Record<TierId, number>> = { apprentice: 0, journeyman: 3, full: 9 };

const learned = new Map<string, TierId>();
class TierStore extends MemoryProfileStore {
  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    const stars = STARS[learned.get(id) ?? 'apprentice'];
    return super.change(id, key, nowMs, (data) => fn({ ...data, progress: { ...data.progress, academy: data.progress.academy.map((_, i) => (i < stars / 3 ? 3 : 0)) } }));
  }
}

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, {
    maxSeatsPerIp: 64,
    profiles: { store: new TierStore(), keys },
    ceremonyTiming: { ...CEREMONY_TIMING, firstProposalMs: 0, spawnMinMs: 100, spawnMaxMs: 120 },
    sabotageTiming: { ...SABOTAGE_TIMING, openingMs: 0 },
  }));
});

afterEach(async () => {
  await colyseus.cleanup();
  learned.clear();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function cookie(tier: TierId | null): Record<string, string> {
  if (tier === null) return {};
  const id = newProfileId();
  learned.set(id, tier);
  return { Cookie: `${COOKIE_NAME}=${signCookie(keys, id, Date.now())}` };
}

function create(options: JoinOptions, tier: TierId | null): Promise<CitadelTestRoom> {
  return createRoom(sdk(PORT, cookie(tier)), options);
}

function join(roomId: string, nickname: string, tier: TierId | null): Promise<CitadelTestRoom> {
  return joinRoom(sdk(PORT, cookie(tier)), roomId, { nickname });
}

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

async function pick(room: CitadelTestRoom, tier: TierId): Promise<string> {
  const reply = next(room, SERVER_MESSAGES.TIER_REFUSED);
  room.send('setTier', { tier });
  return TierRefusedSchema.parse(await reply).reason;
}

async function table(tiers: readonly (TierId | null)[], hostPick: TierId | null): Promise<CitadelTestRoom[]> {
  const host = await create({ nickname: 'Host', private: true }, tiers[0] ?? null);
  const rooms = [host];
  for (let i = 1; i < tiers.length; i++) rooms.push(await join(host.roomId, `Guest ${String(i)}`, tiers[i] ?? null));
  await waitFor(() => host.state.players.size === tiers.length, 'everyone seated');
  if (hostPick !== null) {
    host.send('setTier', { tier: hostPick });
    await waitFor(() => host.state.tier === hostPick, 'tier picked');
  }
  return rooms;
}

async function startMatch(rooms: CitadelTestRoom[]): Promise<{ byzantine: CitadelTestRoom; honest: CitadelTestRoom }> {
  const host = rooms[0];
  if (host === undefined) throw new Error('no host');
  host.send('startMatch');
  await waitFor(() => rooms.every((r) => r.state.phase === 'playing' && r.state.players.get(r.sessionId)?.role !== undefined), 'match start');
  const byzantine = rooms.find((r) => r.state.players.get(r.sessionId)?.role === 'byzantine');
  const honest = rooms.find((r) => r.state.players.get(r.sessionId)?.role === 'honest');
  if (byzantine === undefined || honest === undefined) throw new Error('roles not dealt');
  return { byzantine, honest };
}

async function ceremonyRefusal(room: CitadelTestRoom, type: string, payload?: object): Promise<string> {
  const reply = next(room, SERVER_MESSAGES.CEREMONY_REFUSED);
  room.send(type, payload);
  return CeremonyRefusedSchema.parse(await reply).reason;
}

async function sabotageRefusal(room: CitadelTestRoom, type: string, payload?: object): Promise<string> {
  const reply = next(room, SERVER_MESSAGES.SABOTAGE_REFUSED);
  room.send(type, payload);
  return SabotageRefusedSchema.parse(await reply).reason;
}

describe('picking the rule tier', () => {
  it('follows the least experienced guardian in a quick match, and keeps full rules when nobody is known', async () => {
    const vet = await quickMatch(sdk(PORT, cookie('full')), { nickname: 'Veteran' });
    await waitFor(() => vet.state.tier === 'full', 'veteran alone plays full rules');
    const mid = await quickMatch(sdk(PORT, cookie('journeyman')), { nickname: 'Middle' });
    await waitFor(() => vet.state.tier === 'journeyman', 'journeyman joins');
    const newbie = await quickMatch(sdk(PORT, cookie('apprentice')), { nickname: 'Newbie' });
    await waitFor(() => vet.state.tier === 'apprentice', 'newcomer joins');
    expect(await pick(newbie, 'full')).toBe('notHost');
    expect(await pick(vet, 'full')).toBe('notPrivate');
    await newbie.leave();
    await waitFor(() => vet.state.tier === 'journeyman', 'newcomer left');
    await mid.leave();
    const stranger = await quickMatch(sdk(PORT), { nickname: 'Stranger' });
    await waitFor(() => stranger.state.players.size === 2, 'stranger seated');
    await sleep(100);
    expect(vet.state.tier).toBe('full');
  });

  it("lets a private host pick any tier, but never below a signing ceremony's floor or mid-match", async () => {
    const rooms = await table(['full', 'full', 'apprentice', null, null], null);
    const host = rooms[0] as CitadelTestRoom;
    await waitFor(() => host.state.tier === 'apprentice', 'auto tier');
    expect(await pick(rooms[1] as CitadelTestRoom, 'full')).toBe('notHost');
    host.send('setTier', { tier: 'full' });
    await waitFor(() => host.state.tier === 'full', 'host picked full');
    await startMatch(rooms);
    expect(await pick(host, 'apprentice')).toBe('notLobby');
    expect(host.state.tier).toBe('full');
    const story = await create({ nickname: 'Storyteller', ceremony: true }, 'apprentice');
    await waitFor(() => story.state.tier === 'journeyman', 'ceremony floor');
    expect(await pick(story, 'apprentice')).toBe('locked');
  });
});

describe('an Apprentice match', () => {
  it('files no withdrawals and refuses every ceremony and sabotage action server-side', async () => {
    const rooms = await table(['full', 'full', 'full', 'full', 'full'], 'apprentice');
    let readiness = 0;
    for (const r of rooms) r.onMessage(SERVER_MESSAGES.SABOTAGE_READY, () => (readiness += 1));
    const { byzantine, honest } = await startMatch(rooms);
    const victim = honest.sessionId;
    expect(await ceremonyRefusal(byzantine, 'forgeProposal')).toBe('offTier');
    expect(await sabotageRefusal(byzantine, 'partition')).toBe('offTier');
    expect(await sabotageRefusal(byzantine, 'freeze', { targetId: victim })).toBe('offTier');
    expect(await ceremonyRefusal(honest, 'auditProposal', { proposalId: '1' })).toBe('offTier');
    expect(await ceremonyRefusal(honest, 'signProposal', { proposalId: '1' })).toBe('offTier');
    expect(await ceremonyRefusal(byzantine, 'refuseProposal', { proposalId: '1' })).toBe('offTier');
    await sleep(400);
    expect(honest.state.proposals.length).toBe(0);
    expect(honest.state.partition).toBe(0);
    expect(readiness).toBe(0);
    expect(honest.state.phase).toBe('playing');
  });
});

describe('a Journeyman match', () => {
  it('runs signing ceremonies and forgeries but refuses sabotage', async () => {
    const rooms = await table(['journeyman', 'journeyman', 'full', 'full', 'journeyman'], null);
    const host = rooms[0] as CitadelTestRoom;
    await waitFor(() => host.state.tier === 'journeyman', 'auto journeyman');
    const { byzantine, honest } = await startMatch(rooms);
    await waitFor(() => honest.state.proposals.length > 0, 'a withdrawal appears');
    expect(await ceremonyRefusal(byzantine, 'forgeProposal')).toBe('notHere');
    expect(await sabotageRefusal(byzantine, 'partition')).toBe('offTier');
    expect(await sabotageRefusal(byzantine, 'freeze', { targetId: honest.sessionId })).toBe('offTier');
  });
});

describe('a Full match', () => {
  it('keeps every rule', async () => {
    const rooms = await table(['full', 'full', 'full', 'full', 'full'], null);
    const { byzantine, honest } = await startMatch(rooms);
    await waitFor(() => honest.state.proposals.length > 0, 'a withdrawal appears');
    byzantine.send('partition');
    await waitFor(() => honest.state.partition > 0, 'network cut');
  });
});
