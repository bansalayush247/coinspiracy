import type { Room } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BotsRefusedSchema, CEREMONY_TIMING, COUNCIL_TIMING, SABOTAGE_TIMING, SERVER_MESSAGES, type CeremonyTiming, type TaskTiming } from '@byzantine-council/shared';
import { BotProfileSchema } from '../../src/bots/profile.js';
import { botManager } from '../../src/bots/index.js';
import { createRoom, freshIp, joinRoom, sdk, startServer, waitFor, type CitadelTestRoom } from '../helpers.js';

const PORT = 3900;
const FAST_TASKS: TaskTiming = { minSolveMs: { deposit: 0, ledger: 0, route: 0, watchtower: 0 }, expireMs: 60_000, retryMs: 300, openCooldownMs: 0 };
const FAST_CEREMONY: CeremonyTiming = { ...CEREMONY_TIMING, firstProposalMs: 300, spawnMinMs: 1500, spawnMaxMs: 2000, ttlMs: 20_000 };
const FAST_BOT = BotProfileSchema.parse({
  reactMs: [50, 100],
  settleMs: [50, 100],
  thinkMs: { deposit: [50, 100], ledger: [50, 100], route: [50, 100], watchtower: [50, 100] },
  lingerMs: [200, 400],
  lobbyStrollMs: [5000, 10_000],
  afterTaskMs: [50, 100],
  mistakePercent: 0,
  detourPercent: 0,
  fakeAbandonPercent: 0,
  byzantineWanderPercent: 0,
});
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, {
    maxSeatsPerIp: 16,
    taskTiming: FAST_TASKS,
    ceremonyTiming: FAST_CEREMONY,
    councilTiming: { ...COUNCIL_TIMING, openingMs: 60_000 },
    sabotageTiming: { ...SABOTAGE_TIMING, openingMs: 600_000 },
    bots: { profile: FAST_BOT },
  }));
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function refusal(room: Room): Promise<string> {
  return new Promise((resolve) => {
    room.onMessage(SERVER_MESSAGES.BOTS_REFUSED, (p: unknown) => {
      resolve(BotsRefusedSchema.parse(p).reason);
    });
  });
}

const bots = (room: CitadelTestRoom): string[] => [...room.state.players].filter(([, p]) => p.bot).map(([id]) => id);

async function hostWithBots(count: number): Promise<CitadelTestRoom> {
  const host = await createRoom(sdk(PORT), { nickname: 'Host', private: true });
  for (let i = 0; i < count; i++) {
    host.send('addBot');
    await waitFor(() => bots(host).length === i + 1, `bot ${String(i + 1)}`, 8000);
  }
  return host;
}

describe('practice bots', () => {
  it('lets only the host add and remove bots, which are marked as bots', async () => {
    const host = await hostWithBots(2);
    expect(host.state.hostId).toBe(host.sessionId);
    expect(host.state.players.get(host.sessionId)?.bot).toBe(false);
    const guest = await joinRoom(sdk(PORT), host.roomId, { nickname: 'Guest' });
    const refused = refusal(guest);
    guest.send('addBot');
    expect(await refused).toBe('notHost');
    const notBot = refusal(host);
    host.send('removeBot', { targetId: guest.sessionId });
    expect(await notBot).toBe('notABot');
    host.send('removeBot', { targetId: bots(host)[0] ?? '' });
    await waitFor(() => bots(host).length === 1, 'a bot removed', 4000);
  });

  it('plays a full match with one person: tasks fill the bar and withdrawals get answered', async () => {
    const host = await hostWithBots(4);
    host.send('startMatch');
    await waitFor(() => host.state.phase === 'playing', 'match start');
    await waitFor(() => host.state.consensus > 0, 'bots finishing tasks', 20_000);
    const botIds = new Set(bots(host));
    await waitFor(() => host.state.proposals.some((p) => [...p.signers, ...p.refusers].some((id) => botIds.has(id))), 'bots answering a withdrawal', 20_000);
  }, 45_000);

  it('reaches a result with bots doing all the work', async () => {
    const host = await hostWithBots(4);
    host.send('startMatch');
    await waitFor(() => host.state.phase === 'playing', 'match start');
    await waitFor(() => host.state.winner !== '', 'a winner', 100_000);
    expect(['consensusReached', 'forgedProposalPassed', 'livenessLost', 'federationHalted', 'allByzantineRotatedOut']).toContain(host.state.winReason);
  }, 120_000);

  it('sends the bots home when the last person leaves', async () => {
    const host = await hostWithBots(2);
    expect(botManager()?.count(host.roomId)).toBe(2);
    const roomId = host.roomId;
    await host.leave();
    await waitFor(() => botManager()?.count(roomId) === 0, 'bots leaving', 8000);
  });

  it('caps the bots one network can seat across its lobbies', async () => {
    const ip = freshIp();
    const a = await createRoom(sdk(PORT, { 'X-Real-IP': ip }), { nickname: 'HostA', private: true });
    const b = await createRoom(sdk(PORT, { 'X-Real-IP': ip }), { nickname: 'HostB', private: true });
    for (let i = 0; i < 4; i++) {
      a.send('addBot');
      await waitFor(() => bots(a).length === i + 1, `room A bot ${String(i + 1)}`, 8000);
      b.send('addBot');
      await waitFor(() => bots(b).length === i + 1, `room B bot ${String(i + 1)}`, 8000);
    }
    const refused = refusal(b);
    b.send('addBot');
    expect(await refused).toBe('limit');
    // Freeing a seat in one room lets the network add one again.
    a.send('removeBot', { targetId: bots(a)[0] ?? '' });
    await waitFor(() => bots(a).length === 3, 'a bot removed', 4000);
    b.send('addBot');
    await waitFor(() => bots(b).length === 5, 'room B gets another bot', 8000);
  }, 60_000);

  it('refuses bots once the match has started', async () => {
    const host = await hostWithBots(4);
    host.send('startMatch');
    await waitFor(() => host.state.phase === 'playing', 'match start');
    const refused = refusal(host);
    host.send('addBot');
    expect(await refused).toBe('notLobby');
  }, 30_000);
});
