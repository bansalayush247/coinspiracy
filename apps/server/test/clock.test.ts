import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COUNCIL_SEAL, COUNCIL_TIMING, type Pacing } from '@byzantine-council/shared';
import type { CitadelRoom } from '../src/CitadelRoom.js';
import { createRoom, joinRoom, sdk, sleep, startServer, waitFor, type CitadelTestRoom } from './helpers.js';

const PORT = 3869;
const PACE: Pacing = { blockMs: 250, totalBlocks: 8, calmBlocks: 2, finalBlocks: 3 };
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, {
    maxSeatsPerIp: 64,
    pacing: PACE,
    councilTiming: { ...COUNCIL_TIMING, openingMs: 0, votingMs: 1500, resultMs: 200 },
    resultMs: 400,
  }));
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

async function started(): Promise<CitadelTestRoom[]> {
  const client = () => sdk(PORT);
  const host = await createRoom(client(), { nickname: 'Host', private: true });
  const rooms = [host];
  for (let i = 1; i < 5; i++) rooms.push(await joinRoom(client(), host.roomId, { nickname: `Guardian ${String(i)}` }));
  await waitFor(() => rooms.every((r) => r.state.players.size === 5), 'everyone synced');
  host.send('startMatch');
  await waitFor(() => rooms.every((r) => r.state.phase === 'playing'), 'playing');
  return rooms;
}

describe('the block clock', () => {
  it('runs calm, proposals, final, then hands the Byzantines the match when time runs out', async () => {
    const rooms = await started();
    const [r] = rooms;
    if (r === undefined) throw new Error('no room');
    expect(r.state.act).toBe('calm');
    expect(r.state.blocksLeft).toBe(PACE.totalBlocks);
    const acts: string[] = [];
    const seen = setInterval(() => {
      if (acts.at(-1) !== r.state.act) acts.push(r.state.act);
    }, 20);
    await waitFor(() => r.state.phase === 'ended', 'ended', 5000);
    clearInterval(seen);
    expect(acts.slice(0, 3)).toEqual(['calm', 'proposals', 'final']);
    expect(r.state.winner).toBe('byzantine');
    expect(r.state.winReason).toBe('outOfTime');
    await waitFor(() => r.state.phase === 'lobby', 'lobby');
    expect(r.state.act).toBe('');
  });

  it('stops while a council runs', async () => {
    const rooms = await started();
    const [caller] = rooms;
    if (caller === undefined) throw new Error('no room');
    const p = colyseus.getRoomById<CitadelRoom>(caller.roomId).state.players.get(caller.sessionId);
    if (p === undefined) throw new Error('no player');
    p.x = COUNCIL_SEAL.x;
    p.y = COUNCIL_SEAL.y;
    await waitFor(() => caller.state.players.get(caller.sessionId)?.x === COUNCIL_SEAL.x, 'at the seal');
    caller.send('callCouncil');
    await waitFor(() => caller.state.council.stage === 'voting', 'council');
    const left = caller.state.blocksLeft;
    await sleep(1000);
    expect(caller.state.blocksLeft).toBe(left);
    expect(caller.state.phase).toBe('playing');
  });
});
