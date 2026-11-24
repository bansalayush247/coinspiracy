import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CITY_MAP,
  CaughtLineSchema,
  DANI_SPOT,
  DUMP_REWARD_SATS,
  GATE_SPOT,
  GUITAR,
  HEAPS,
  JUNK,
  MISSION_MESSAGES,
  MISSION_ROOM,
  MissionResultSchema,
  MissionState,
  canDig,
  type CaughtLine,
  type MissionResult,
} from '@byzantine-council/shared/city';
import { canStand } from '@byzantine-council/shared/pathfinding';
import type { MissionRoom } from '../src/city/MissionRoom.js';
import { MemoryProfileStore } from '../src/profile/store.js';
import { COOKIE_NAME, type SessionKeys } from '../src/profile/session.js';
import { ORIGIN, freshIp, sdk, sleep, startServer, waitFor } from './helpers.js';

const PORT = 3898;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const keys: SessionKeys = { current: Buffer.from('m'.repeat(32)), previous: null, secure: false };
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, profiles: { store: new MemoryProfileStore(), keys } }));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

async function guest(): Promise<string> {
  const res = await fetch(`${BASE}/api/session`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': freshIp() }, body: '{}' });
  const value = /bc_guest=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return `${COOKIE_NAME}=${value}`;
}

async function balance(cookie: string): Promise<number> {
  const res = await fetch(`${BASE}/api/profile`, { headers: { origin: ORIGIN, 'x-real-ip': freshIp(), cookie } });
  return ((await res.json()) as { balance: number }).balance;
}

type MissionClient = Awaited<ReturnType<typeof begin>>['client'];

async function begin(cookie: string | null, quiet = true) {
  const client = await sdk(PORT, cookie === null ? {} : { cookie }).create<MissionState>(MISSION_ROOM, { nickname: 'Rook' }, MissionState);
  await waitFor(() => client.state.players.has(client.sessionId), 'joined');
  const room = colyseus.getRoomById<MissionRoom>(client.roomId);
  if (quiet) room.quietNight();
  const results: MissionResult[] = [];
  const caught: CaughtLine[] = [];
  client.onMessage(MISSION_MESSAGES.RESULT, (m: unknown) => results.push(MissionResultSchema.parse(m)));
  client.onMessage(MISSION_MESSAGES.CAUGHT, (m: unknown) => caught.push(CaughtLineSchema.parse(m)));
  client.onMessage(MISSION_MESSAGES.DUNCAN, () => undefined);
  return { client, room, results, caught };
}

// Answers a choice once its node is on screen, or reads a node through once it has been up a moment.
async function say(client: MissionClient, node: string, choice?: string): Promise<void> {
  await waitFor(() => client.state.node === node, `scene ${node}`, 8000);
  if (choice !== undefined) {
    client.send('choose', { node, choice });
    return;
  }
  await sleep(350);
  client.send('advance', { node });
}

const digSpot = (heap: number) => {
  const h = HEAPS[heap];
  if (h === undefined) throw new Error('heap');
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const p = { x: h.tile[0] + dc + 0.5, y: h.tile[1] + dr + 0.5 };
    if (canStand(CITY_MAP, p) && canDig(p, h)) return p;
  }
  throw new Error('no spot');
};

async function toTheTip(client: MissionClient, room: MissionRoom, magsChoice: string): Promise<void> {
  await say(client, 'pell', 'promise');
  await say(client, 'pellPromise');
  await say(client, 'pellEnd');
  await waitFor(() => client.state.step === 'toDani', 'off to Dani');
  room.teleport(DANI_SPOT.x, DANI_SPOT.y);
  await say(client, 'dani', 'straight');
  await say(client, 'daniStraight');
  await say(client, 'reveal', 'calm');
  await say(client, 'daniCalm');
  await say(client, 'hook');
  await waitFor(() => client.state.step === 'toTip', 'off to the tip');
  room.teleport(GATE_SPOT.x, GATE_SPOT.y);
  await say(client, 'mags', magsChoice);
}

async function dig(client: MissionClient, room: MissionRoom, heap: number): Promise<void> {
  const spot = digSpot(heap);
  room.teleport(spot.x, spot.y);
  await sleep(60);
  client.send('dig', { heap });
  await waitFor(() => client.state.heaps[heap]?.dug === true, `dug ${String(heap)}`);
}

async function finish(client: MissionClient, room: MissionRoom): Promise<void> {
  await dig(client, room, room.deviceHeap);
  await waitFor(() => client.state.step === 'found', 'found it');
  await say(client, 'crushed', 'keep');
  await say(client, 'crushedKeep');
  await say(client, 'slip');
  await say(client, 'ask', 'demand');
  await say(client, 'askDemand');
  await say(client, 'ask', 'nice');
  await say(client, 'given');
  await say(client, 'selfie');
  await waitFor(() => client.state.step === 'done', 'the end');
}

describe('act one: The Dump', () => {
  it('plays from Pell’s call to the last line, remembers the choices, and pays the first finish once', async () => {
    const cookie = await guest();
    const run = async (): Promise<MissionResult> => {
      const { client, room, results } = await begin(cookie);
      await toTheTip(client, room, 'pay');
      await say(client, 'magsPay');
      await say(client, 'magsWinter');
      await say(client, 'magsRules');
      await waitFor(() => client.state.step === 'dig', 'digging');
      expect(client.state.npcs.get('dani')?.shown).toBe(false);
      await finish(client, room);
      await waitFor(() => results.length === 1, 'result');
      expect([...client.state.marks]).toEqual(['promisedPell', 'honestDani', 'clueWinter', 'paidMags', 'clueSkip', 'keptDevice', 'askedOnce', 'apologised']);
      await client.leave();
      return results[0] ?? { reason: 'error', paid: 0, honest: false };
    };
    expect(await run()).toEqual({ reason: 'paid', paid: DUMP_REWARD_SATS, honest: true });
    expect(await balance(cookie)).toBe(500 + DUMP_REWARD_SATS);
    expect(await run()).toEqual({ reason: 'replay', paid: 0, honest: true });
    expect(await balance(cookie)).toBe(500 + DUMP_REWARD_SATS);
  }, 60_000);

  it('never tells the client where the device is, and wrong heaps turn up junk and the old guitar', async () => {
    const { client, room } = await begin(null);
    await toTheTip(client, room, 'truth');
    await say(client, 'magsTruth');
    await say(client, 'magsRules');
    await waitFor(() => client.state.step === 'dig', 'digging');
    const json = JSON.stringify(client.state.toJSON());
    expect(json).not.toContain('device');
    const wrongWinter = HEAPS.findIndex((h, i) => h.winter && !h.bySkip && i !== room.deviceHeap);
    await dig(client, room, wrongWinter);
    expect(client.state.heaps[wrongWinter]?.found).toBe(GUITAR);
    const plain = HEAPS.findIndex((h) => !h.winter);
    await dig(client, room, plain);
    expect(client.state.heaps[plain]?.found).toBe(JUNK[0]);
    expect(client.state.step).toBe('dig');
    for (const [i, heap] of client.state.heaps.entries()) if (!heap.dug) expect(heap.found, String(i)).toBe('');
  }, 30_000);

  it('a guest finishes without a profile and is told nothing was saved', async () => {
    const { client, room, results } = await begin(null);
    await toTheTip(client, room, 'charm');
    await say(client, 'magsCharm');
    await say(client, 'magsRules');
    await finish(client, room);
    await waitFor(() => results.length === 1, 'result');
    expect(results[0]).toEqual({ reason: 'noProfile', paid: 0, honest: true });
  }, 30_000);

  it('ignores choices for another node, unknown choices, digs out of turn and digs out of reach', async () => {
    const { client, room } = await begin(null);
    await waitFor(() => client.state.node === 'pell', 'pell');
    client.send('choose', { node: 'dani', choice: 'straight' });
    client.send('choose', { node: 'pell', choice: 'nope' });
    client.send('advance', { node: 'pell' });
    client.send('dig', { heap: room.deviceHeap });
    await sleep(200);
    expect(client.state.node).toBe('pell');
    expect(client.state.digging).toBe(-1);
    expect([...client.state.marks]).toEqual([]);
    room.runOutClock();
    await waitFor(() => client.state.node === 'pellSilence', 'silence is an answer');
  }, 30_000);

  it('Ivor’s torch and Duncan’s nose send you back to the gate; a bluff lets Duncan out at once', async () => {
    const { client, room, caught } = await begin(null, false);
    await toTheTip(client, room, 'bluff');
    await say(client, 'magsBluff');
    await say(client, 'magsRules');
    await waitFor(() => client.state.step === 'dig', 'digging');
    const guard = client.state.npcs.get('guard');
    if (guard === undefined) throw new Error('guard');
    let lit = false;
    for (let d = 1.5; d <= 3 && !lit; d += 0.5) {
      const p = { x: guard.x + Math.cos(guard.facing) * d, y: guard.y + Math.sin(guard.facing) * d };
      if (canStand(CITY_MAP, p)) {
        room.teleport(p.x, p.y);
        lit = true;
      }
    }
    expect(lit).toBe(true);
    await waitFor(() => caught.length === 1, 'caught by Ivor');
    expect(caught[0]).toEqual({ by: 'guard', count: 1 });
    const me = client.state.players.get(client.sessionId);
    await waitFor(() => me !== undefined && Math.hypot(me.x - GATE_SPOT.x, me.y - GATE_SPOT.y) < 0.5, 'back at the gate');
    await sleep(1600);
    room.teleport(GATE_SPOT.x - 7, GATE_SPOT.y + 0.5);
    await waitFor(() => caught.length === 2, 'caught by Duncan', 8000);
    expect(caught[1]).toEqual({ by: 'duncan', count: 2 });
  }, 40_000);
});
