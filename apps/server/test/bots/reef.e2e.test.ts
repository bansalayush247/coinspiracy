import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CEREMONY_TIMING, COUNCIL_TIMING, PEAKS, REEF, SABOTAGE_TIMING, type TaskTiming } from '@byzantine-council/shared';
import { BotProfileSchema } from '../../src/bots/profile.js';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../../src/profile/store.js';
import { COOKIE_NAME, newProfileId, signCookie, type SessionKeys } from '../../src/profile/session.js';
import { createRoom, sdk, startServer, waitFor, type CitadelTestRoom } from '../helpers.js';

const PORT = 3904;
const keys: SessionKeys = { current: Buffer.from('b'.repeat(32)), previous: null, secure: false };
const FAST_TASKS: TaskTiming = { minSolveMs: { deposit: 0, ledger: 0, route: 0, watchtower: 0 }, expireMs: 60_000, retryMs: 300, openCooldownMs: 0 };
const FAST_BOT = BotProfileSchema.parse({
  reactMs: [50, 100],
  settleMs: [50, 100],
  thinkMs: { deposit: [50, 100], ledger: [50, 100], route: [50, 100], watchtower: [50, 100] },
  lingerMs: [200, 400],
  lobbyStrollMs: [300, 600],
  afterTaskMs: [50, 100],
  mistakePercent: 0,
  detourPercent: 0,
  fakeAbandonPercent: 0,
  byzantineWanderPercent: 0,
});

// Every guest here has opened Lightning Reef.
class ReefStore extends MemoryProfileStore {
  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) => fn({ ...data, progress: { ...data.progress, academy: data.progress.academy.map((_, i) => (i < 4 ? 3 : 0)) } }));
  }
}

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, {
    maxSeatsPerIp: 16,
    taskTiming: FAST_TASKS,
    ceremonyTiming: { ...CEREMONY_TIMING, firstProposalMs: 300, spawnMinMs: 1500, spawnMaxMs: 2000, ttlMs: 20_000 },
    councilTiming: { ...COUNCIL_TIMING, openingMs: 60_000 },
    sabotageTiming: { ...SABOTAGE_TIMING, openingMs: 600_000 },
    bots: { profile: FAST_BOT },
    profiles: { store: new ReefStore(), keys },
  }));
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

const bots = (room: CitadelTestRoom): string[] => [...room.state.players].filter(([, p]) => p.bot).map(([id]) => id);

describe('practice bots on the island maps', () => {
  it('follow the lobby to the reef and do their tasks at its stations', async () => {
    const host = await createRoom(sdk(PORT, { Cookie: `${COOKIE_NAME}=${signCookie(keys, newProfileId(), Date.now())}` }), { nickname: 'Host', private: true });
    for (let i = 0; i < 4; i++) {
      host.send('addBot');
      await waitFor(() => bots(host).length === i + 1, `bot ${String(i + 1)}`, 8000);
    }
    await waitFor(() => host.state.reefOpen, 'reef open');
    // Let the bots stroll the Citadel first, so the switch happens under them.
    await new Promise((r) => setTimeout(r, 800));
    host.send('setArena', { arena: 'reef' });
    await waitFor(() => host.state.arena === 'reef', 'reef chosen');
    host.send('startMatch');
    await waitFor(() => host.state.phase === 'playing', 'match start');
    await waitFor(() => host.state.consensus > 0, 'bots finishing reef tasks', 30_000);
    // Every bot is somewhere walkable on the reef, never stuck in the Citadel's geometry.
    for (const id of bots(host)) {
      const p = host.state.players.get(id);
      const row = REEF.map.rows[Math.floor(p?.y ?? -1)] ?? '';
      expect(['.', '='], id).toContain(row[Math.floor(p?.x ?? -1)]);
    }
  }, 60_000);

  it('play Watchtower Peaks too', async () => {
    const host = await createRoom(sdk(PORT, { Cookie: `${COOKIE_NAME}=${signCookie(keys, newProfileId(), Date.now())}` }), { nickname: 'Host', private: true });
    await waitFor(() => host.state.peaksOpen, 'peaks open');
    host.send('setArena', { arena: 'peaks' });
    await waitFor(() => host.state.arena === 'peaks', 'peaks chosen');
    for (let i = 0; i < 4; i++) {
      host.send('addBot');
      await waitFor(() => bots(host).length === i + 1, `bot ${String(i + 1)}`, 8000);
    }
    host.send('startMatch');
    await waitFor(() => host.state.phase === 'playing', 'match start');
    await waitFor(() => host.state.consensus > 0, 'bots finishing peak tasks', 30_000);
    for (const id of bots(host)) {
      const p = host.state.players.get(id);
      const row = PEAKS.map.rows[Math.floor(p?.y ?? -1)] ?? '';
      expect(['.', '='], id).toContain(row[Math.floor(p?.x ?? -1)]);
    }
  }, 60_000);
});
