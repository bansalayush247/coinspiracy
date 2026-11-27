import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  FOUNDER_REWARD_SATS,
  GENERATORS,
  MAST_SPOT,
  INSIDER_REWARD_SATS,
  NONCE_SPOT,
  OTHER_ACCOUNTS,
  TEO_ACCOUNT,
  TERMINALS,
  TOWER_SPOT,
  BREAKWATER,
  CITY_MAP,
  GUARDIANS,
  LIGHTHOUSE_DOOR,
  LOOKOUT_ROUTES,
  RANSOM_REWARD_SATS,
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
  type ActId,
  type CaughtLine,
  type MissionResult,
} from '@byzantine-council/shared/city';
import { canStand } from '@byzantine-council/shared/pathfinding';
import type { MissionRoom } from '../src/city/MissionRoom.js';
import { MemoryProfileStore } from '../src/profile/store.js';
import { COOKIE_NAME, profileIdFromCookieHeader, type SessionKeys } from '../src/profile/session.js';
import { ORIGIN, freshIp, sdk, sleep, startServer, waitFor } from './helpers.js';

const PORT = 3898;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const keys: SessionKeys = { current: Buffer.from('m'.repeat(32)), previous: null, secure: false };
let colyseus: ColyseusTestServer;

const store = new MemoryProfileStore();

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, profiles: { store, keys } }));
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

async function begin(cookie: string | null, quiet = true, act?: ActId) {
  const client = await sdk(PORT, cookie === null ? {} : { cookie }).create<MissionState>(MISSION_ROOM, act === undefined ? { nickname: 'Rook' } : { nickname: 'Rook', act }, MissionState);
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
  client.send('work', { spot: heap });
  await waitFor(() => client.state.spots[heap]?.done === true, `dug ${String(heap)}`);
}

async function finish(client: MissionClient, room: MissionRoom): Promise<void> {
  await dig(client, room, room.secretSpot);
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
    const wrongWinter = HEAPS.findIndex((h, i) => h.winter && !h.bySkip && i !== room.secretSpot);
    await dig(client, room, wrongWinter);
    expect(client.state.spots[wrongWinter]?.note).toBe(GUITAR);
    const plain = HEAPS.findIndex((h) => !h.winter);
    await dig(client, room, plain);
    expect(client.state.spots[plain]?.note).toBe(JUNK[0]);
    expect(client.state.step).toBe('dig');
    for (const [i, heap] of client.state.spots.entries()) if (!heap.done) expect(heap.note, String(i)).toBe('');
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
    client.send('work', { spot: room.secretSpot });
    await sleep(200);
    expect(client.state.node).toBe('pell');
    expect(client.state.spots.every((h) => h.worker === '')).toBe(true);
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

async function joinCrew(roomId: string, cookie: string | null, nickname: string) {
  const client = await sdk(PORT, cookie === null ? {} : { cookie }).joinById<MissionState>(roomId, { nickname }, MissionState);
  await waitFor(() => client.state.players.has(client.sessionId), 'joined the crew');
  const results: MissionResult[] = [];
  const caught: CaughtLine[] = [];
  client.onMessage(MISSION_MESSAGES.RESULT, (m: unknown) => results.push(MissionResultSchema.parse(m)));
  client.onMessage(MISSION_MESSAGES.CAUGHT, (m: unknown) => caught.push(CaughtLineSchema.parse(m)));
  client.onMessage(MISSION_MESSAGES.DUNCAN, () => undefined);
  return { client, results, caught };
}

async function lookup(code: string): Promise<Response> {
  return fetch(`${BASE}/api/rooms/${code}`, { headers: { origin: ORIGIN, 'x-real-ip': freshIp() } });
}

async function readThrough(clients: readonly MissionClient[], node: string): Promise<void> {
  for (const c of clients) await waitFor(() => c.state.node === node, `scene ${node}`, 8000);
  await sleep(350);
  for (const c of clients) c.send('advance', { node });
}

describe('act one with a crew', () => {
  it('opens by code as a story, shows the crew to each other, and gives a clashing name a number', async () => {
    const { client: lead } = await begin(null);
    await waitFor(() => lead.state.code !== '', 'a crew code');
    const res = await lookup(lead.state.code);
    expect(await res.json()).toEqual({ kind: 'story', roomId: lead.roomId, players: 1, maxPlayers: 4 });
    const { client: friend } = await joinCrew(lead.roomId, null, 'Rook');
    await waitFor(() => lead.state.players.size === 2 && friend.state.players.size === 2, 'both see both');
    expect(friend.state.players.get(friend.sessionId)?.name).toBe('Rook 2');
    expect(friend.state.lead).toBe(lead.sessionId);
    expect(new Set([...lead.state.players.values()].map((p) => p.seat))).toEqual(new Set([0, 1]));
  }, 20_000);

  it('starts a choice’s clock only once the whole crew has read up to it', async () => {
    const { client: lead } = await begin(null);
    const { client: friend } = await joinCrew(lead.roomId, null, 'Ana');
    await waitFor(() => lead.state.node === 'pell', 'pell');
    expect(lead.state.answering).toBe(false);
    lead.send('advance', { node: 'pell' });
    await waitFor(() => lead.state.ready === 1, 'one has read');
    await sleep(150);
    expect(lead.state.answering).toBe(false);
    friend.send('advance', { node: 'pell' });
    await waitFor(() => lead.state.answering, 'the clock starts');
    expect(lead.state.node).toBe('pell');
  }, 20_000);

  it('waits for the whole crew, settles a split vote with the lead, and moves on when everyone has read', async () => {
    const { client: lead, room } = await begin(null);
    const { client: friend } = await joinCrew(lead.roomId, null, 'Ana');
    await waitFor(() => lead.state.node === 'pell', 'pell');
    friend.send('choose', { node: 'pell', choice: 'joke' });
    await waitFor(() => lead.state.votes.get(friend.sessionId) === 'joke', 'the vote shows');
    await sleep(150);
    expect(lead.state.node).toBe('pell');
    lead.send('choose', { node: 'pell', choice: 'promise' });
    await waitFor(() => lead.state.node === 'pellPromise', 'the lead breaks the tie');
    expect(lead.state.said).toBe('promise');
    expect([...lead.state.marks]).toContain('promisedPell');
    await sleep(350);
    lead.send('advance', { node: 'pellPromise' });
    await waitFor(() => lead.state.ready === 1, 'one ready');
    await sleep(150);
    expect(lead.state.node).toBe('pellPromise');
    friend.send('advance', { node: 'pellPromise' });
    await waitFor(() => lead.state.node === 'pellEnd', 'both ready');
    await readThrough([lead, friend], 'pellEnd');
    await waitFor(() => lead.state.step === 'toDani', 'off to Dani');
    room.teleport(DANI_SPOT.x, DANI_SPOT.y, friend.sessionId);
    await waitFor(() => lead.state.node === 'dani', 'the friend reaches Dani');
    const me = lead.state.players.get(lead.sessionId);
    await waitFor(() => me !== undefined && Math.hypot(me.x - DANI_SPOT.x, me.y - DANI_SPOT.y) < 4, 'the lead is brought to the scene');
    friend.send('choose', { node: 'dani', choice: 'straight' });
    await waitFor(() => lead.state.votes.size === 1, 'one vote in');
    room.runOutClock();
    await waitFor(() => lead.state.node === 'daniStraight', 'the votes cast so far decide once time is up');
  }, 30_000);

  it('pays everyone in the crew their own first finish, and nobody joins once the device is found', async () => {
    const leadCookie = await guest();
    const friendCookie = await guest();
    const { client: lead, room, results } = await begin(leadCookie);
    const { client: friend, results: friendResults } = await joinCrew(lead.roomId, friendCookie, 'Ana');
    const crew = [lead, friend];
    const vote = async (node: string, choice: string): Promise<void> => {
      for (const c of crew) await waitFor(() => c.state.node === node, `scene ${node}`, 8000);
      for (const c of crew) c.send('choose', { node, choice });
    };
    await vote('pell', 'promise');
    await readThrough(crew, 'pellPromise');
    await readThrough(crew, 'pellEnd');
    await waitFor(() => lead.state.step === 'toDani', 'off to Dani');
    room.teleport(DANI_SPOT.x, DANI_SPOT.y);
    await vote('dani', 'straight');
    await readThrough(crew, 'daniStraight');
    await vote('reveal', 'calm');
    await readThrough(crew, 'daniCalm');
    await readThrough(crew, 'hook');
    await waitFor(() => lead.state.step === 'toTip', 'off to the tip');
    room.teleport(GATE_SPOT.x, GATE_SPOT.y);
    await vote('mags', 'truth');
    await readThrough(crew, 'magsTruth');
    await readThrough(crew, 'magsRules');
    await waitFor(() => lead.state.step === 'dig', 'digging');
    const spot = digSpot(room.secretSpot);
    room.teleport(spot.x, spot.y, friend.sessionId);
    await sleep(60);
    friend.send('work', { spot: room.secretSpot });
    await waitFor(() => lead.state.spots[room.secretSpot]?.worker === friend.sessionId, 'the friend digs');
    await waitFor(() => lead.state.step === 'found', 'the friend finds it');
    expect((await lookup(lead.state.code)).status).toBe(409);
    await expect(joinCrew(lead.roomId, null, 'Late')).rejects.toThrow();
    await vote('crushed', 'keep');
    await readThrough(crew, 'crushedKeep');
    await readThrough(crew, 'slip');
    await vote('ask', 'nice');
    await readThrough(crew, 'given');
    await readThrough(crew, 'selfie');
    await waitFor(() => results.length === 1 && friendResults.length === 1, 'both results');
    expect(results[0]).toEqual({ reason: 'paid', paid: DUMP_REWARD_SATS, honest: true });
    expect(friendResults[0]).toEqual({ reason: 'paid', paid: DUMP_REWARD_SATS, honest: true });
    expect(await balance(leadCookie)).toBe(500 + DUMP_REWARD_SATS);
    expect(await balance(friendCookie)).toBe(500 + DUMP_REWARD_SATS);
  }, 60_000);

  it('tells the rest of the crew who Ivor caught', async () => {
    const { client: lead, room, caught } = await begin(null, false);
    const { client: friend, caught: friendCaught } = await joinCrew(lead.roomId, null, 'Ana');
    const crew = [lead, friend];
    const vote = async (node: string, choice: string): Promise<void> => {
      for (const c of crew) await waitFor(() => c.state.node === node, `scene ${node}`, 8000);
      for (const c of crew) c.send('choose', { node, choice });
    };
    await vote('pell', 'promise');
    await readThrough(crew, 'pellPromise');
    await readThrough(crew, 'pellEnd');
    await waitFor(() => lead.state.step === 'toDani', 'off to Dani');
    room.teleport(DANI_SPOT.x, DANI_SPOT.y);
    await vote('dani', 'straight');
    await readThrough(crew, 'daniStraight');
    await vote('reveal', 'calm');
    await readThrough(crew, 'daniCalm');
    await readThrough(crew, 'hook');
    await waitFor(() => lead.state.step === 'toTip', 'off to the tip');
    room.teleport(GATE_SPOT.x, GATE_SPOT.y);
    await vote('mags', 'truth');
    await readThrough(crew, 'magsTruth');
    await readThrough(crew, 'magsRules');
    await waitFor(() => lead.state.step === 'dig', 'digging');
    const guard = lead.state.npcs.get('guard');
    if (guard === undefined) throw new Error('guard');
    for (let d = 1.5; d <= 3; d += 0.5) {
      const p = { x: guard.x + Math.cos(guard.facing) * d, y: guard.y + Math.sin(guard.facing) * d };
      if (canStand(CITY_MAP, p)) {
        room.teleport(p.x, p.y, friend.sessionId);
        break;
      }
    }
    await waitFor(() => friendCaught.length === 1 && caught.length === 1, 'both hear about it');
    expect(friendCaught[0]).toEqual({ by: 'guard', count: 1 });
    expect(caught[0]).toEqual({ by: 'guard', count: 1, name: 'Ana' });
  }, 40_000);
});

describe('act two: The Ransom Call', () => {
  async function toTheMint(client: MissionClient, room: MissionRoom, catchIt: boolean): Promise<void> {
    await say(client, 'ransom', 'proof');
    await say(client, 'proof', 'again');
    await say(client, 'proofAgain', catchIt ? 'catch' : 'beg');
    await say(client, catchIt ? 'caught' : 'proofMissed');
    await say(client, 'callEnd');
    await waitFor(() => client.state.step === 'toIvy', 'off to the Mint');
    room.teleport(IVY.x, IVY.y);
    await say(client, 'ivy', 'ask');
    await say(client, 'ivyHow');
    await say(client, 'ivyPlan');
    await waitFor(() => client.state.step === 'sign', 'signing');
  }

  async function ask(client: MissionClient, room: MissionRoom, i: number): Promise<void> {
    const g = GUARDIANS[i];
    if (g === undefined) throw new Error('guardian');
    room.teleport(g.at.x, g.at.y + 1);
    await sleep(60);
    client.send('work', { spot: i });
    await waitFor(() => client.state.spots[i]?.done === true, `asked ${g.label}`);
  }

  const IVY = { x: 80, y: 28.5 };

  it('locks the words in with three signatures, follows the ferry horn to the lighthouse, and pays the first finish', async () => {
    const cookie = await guest();
    const { client, room, results } = await begin(cookie, true, 'ransom');
    expect(client.state.act).toBe('ransom');
    await toTheMint(client, room, true);
    const wren = GUARDIANS.findIndex((g) => g.refuses === true);
    await ask(client, room, wren);
    expect(client.state.step).toBe('sign');
    expect([...client.state.marks]).toContain('wrenRefused');
    const signers = GUARDIANS.flatMap((g, i) => (g.refuses === true ? [] : [i])).slice(0, 3);
    for (const i of signers) await ask(client, room, i);
    await waitFor(() => client.state.node === 'locked', 'locked in');
    await say(client, 'locked');
    await say(client, 'lockedClue');
    await waitFor(() => client.state.step === 'toLighthouse', 'off to the lighthouse');
    room.teleport(BREAKWATER.x, BREAKWATER.y);
    await say(client, 'breakwater');
    await waitFor(() => client.state.step === 'sneak', 'sneaking');
    expect(client.state.npcs.get('lookout0')?.shown).toBe(true);
    expect(client.state.npcs.get('lookout1')?.shown).toBe(false);
    room.teleport(LIGHTHOUSE_DOOR.x, LIGHTHOUSE_DOOR.y);
    await say(client, 'door', 'look');
    await say(client, 'doorLook');
    await say(client, 'brannDoor');
    await waitFor(() => results.length === 1, 'result');
    expect(results[0]).toEqual({ reason: 'paid', paid: RANSOM_REWARD_SATS, honest: true });
    expect(await balance(cookie)).toBe(500 + RANSOM_REWARD_SATS);
    expect([...client.state.marks]).toEqual(expect.arrayContaining(['clueRecording', 'askedIvy', 'wrenRefused', 'clueTwoForks']));
  }, 60_000);

  it('sends a crew that missed the recording through Brannigan, past two lookouts, and back to the breakwater when lit', async () => {
    const { client, room, caught } = await begin(null, false, 'ransom');
    await toTheMint(client, room, false);
    for (const i of [0, 1, 2]) await ask(client, room, i);
    await say(client, 'locked');
    await say(client, 'brannigan', 'thank');
    await say(client, 'branThank');
    await say(client, 'branEnd');
    await waitFor(() => client.state.step === 'toLighthouse', 'off to the lighthouse');
    room.teleport(BREAKWATER.x, BREAKWATER.y);
    await say(client, 'breakwater');
    await waitFor(() => client.state.step === 'sneak', 'sneaking');
    expect(client.state.npcs.get('lookout1')?.shown).toBe(true);
    const look = client.state.npcs.get('lookout0');
    if (look === undefined || LOOKOUT_ROUTES[0] === undefined) throw new Error('lookout');
    room.teleport(look.x + Math.cos(look.facing) * 1.5, look.y + Math.sin(look.facing) * 1.5);
    await waitFor(() => caught.length === 1, 'spotted');
    expect(caught[0]?.by).toBe('lookout');
    const me = client.state.players.get(client.sessionId);
    await waitFor(() => me !== undefined && Math.hypot(me.x - BREAKWATER.x, me.y - BREAKWATER.y) < 1.5, 'back at the breakwater');
  }, 60_000);

  it('only lets guardians be asked during the signing, and only from close by', async () => {
    const { client, room } = await begin(null, true, 'ransom');
    await waitFor(() => client.state.node === 'ransom', 'the call');
    client.send('work', { spot: 0 });
    await sleep(200);
    expect(client.state.spots[0]?.worker).toBe('');
    await say(client, 'ransom', 'deal');
    await say(client, 'ransomDeal');
    await say(client, 'callEnd');
    await waitFor(() => client.state.step === 'toIvy', 'off to the Mint');
    room.teleport(IVY.x, IVY.y);
    await say(client, 'ivy', 'pay');
    await say(client, 'ivyPay');
    await say(client, 'ivyPlan');
    await waitFor(() => client.state.step === 'sign', 'signing');
    client.send('work', { spot: 0 });
    await sleep(200);
    expect(client.state.spots[0]?.worker).toBe('');
  }, 30_000);
});

describe('act three: The Insider', () => {
  async function toTheTower(client: MissionClient, room: MissionRoom, nonceChoice: string): Promise<void> {
    await say(client, 'morning', 'go');
    await say(client, 'morningGo');
    await say(client, 'morningEnd');
    await waitFor(() => client.state.step === 'toNonce', 'off to Nonce');
    room.teleport(NONCE_SPOT.x, NONCE_SPOT.y + 0.5);
    await say(client, 'nonce', nonceChoice);
    if (nonceChoice === 'truth') {
      await say(client, 'nonceTruth');
      await say(client, 'nonceYacht');
    } else await say(client, nonceChoice === 'pay' ? 'noncePay' : 'noncePush');
    await say(client, 'nonceEnd');
    await waitFor(() => client.state.step === 'toTower', 'off to the tower');
    room.teleport(TOWER_SPOT.x, TOWER_SPOT.y);
    await say(client, 'tower');
    await waitFor(() => client.state.step === 'search', 'searching');
  }

  async function search(client: MissionClient, room: MissionRoom, i: number): Promise<void> {
    const t = TERMINALS[i];
    if (t === undefined) throw new Error('terminal');
    room.teleport(t.at.x + (t.at.x < 80 ? -0.1 : 0.1), t.at.y + 0.6);
    await sleep(60);
    client.send('work', { spot: i });
    await waitFor(() => client.state.spots[i]?.done === true, `searched ${t.label}`);
  }

  it('follows the leak to the east terminals, finds Teo’s account, and pays the first finish', async () => {
    const cookie = await guest();
    const { client, room, results } = await begin(cookie, true, 'insider');
    await toTheTower(client, room, 'truth');
    expect([...client.state.marks]).toEqual(expect.arrayContaining(['clueList', 'honestNonce', 'clueEast', 'clueYacht']));
    expect(TERMINALS[room.secretSpot]?.east).toBe(true);
    expect(JSON.stringify(client.state.toJSON())).not.toContain('DIAMONDHANDS');
    const wrong = TERMINALS.findIndex((t, i) => t.east && i !== room.secretSpot);
    await search(client, room, wrong);
    expect(client.state.spots[wrong]?.note).toBe(OTHER_ACCOUNTS[0]);
    expect(client.state.step).toBe('search');
    await search(client, room, room.secretSpot);
    expect(client.state.spots[room.secretSpot]?.note).toBe(TEO_ACCOUNT);
    await waitFor(() => client.state.node === 'account', 'Teo’s account');
    expect(client.state.npcs.get('teo')?.shown).toBe(true);
    await say(client, 'account', 'cut');
    await say(client, 'teoCut');
    await say(client, 'teoEnd');
    await waitFor(() => results.length === 1, 'result');
    expect(results[0]).toEqual({ reason: 'paid', paid: INSIDER_REWARD_SATS, honest: true });
    expect(await balance(cookie)).toBe(500 + INSIDER_REWARD_SATS);
    expect([...client.state.marks]).toContain('askedCut');
  }, 60_000);

  it('sends anyone Gus’s torch finds back to the front of the tower', async () => {
    const { client, room, caught } = await begin(null, false, 'insider');
    await toTheTower(client, room, 'push');
    expect([...client.state.marks]).not.toContain('clueEast');
    const gus = client.state.npcs.get('gus');
    if (gus === undefined) throw new Error('gus');
    let placed = false;
    for (let d = 1.5; d <= 3 && !placed; d += 0.5) {
      const p = { x: gus.x + Math.cos(gus.facing) * d, y: gus.y + Math.sin(gus.facing) * d };
      if (canStand(CITY_MAP, p)) {
        room.teleport(p.x, p.y);
        placed = true;
      }
    }
    expect(placed).toBe(true);
    await waitFor(() => caught.length === 1, 'caught by Gus');
    expect(caught[0]?.by).toBe('guard');
    const me = client.state.players.get(client.sessionId);
    await waitFor(() => me !== undefined && Math.hypot(me.x - TOWER_SPOT.x, me.y - TOWER_SPOT.y) < 1.5, 'back at the front');
  }, 60_000);
});

describe('act four: The Founder’s Coins', () => {
  async function remember(cookie: string, story: Record<string, unknown>): Promise<void> {
    const id = profileIdFromCookieHeader(keys, cookie, Date.now());
    if (id === null) throw new Error('profile');
    await store.change(id, `seed:${id}`, Date.now(), (data) => ({ data: { ...data, progress: { ...data.progress, story: { ...data.progress.story, ...story } } }, result: null }));
  }

  async function toTheMast(client: MissionClient, room: MissionRoom): Promise<void> {
    await say(client, 'stick');
    await say(client, 'quintCall', 'refuse');
    await say(client, 'quintRefuse');
    await say(client, 'sharpeRadio');
    await waitFor(() => client.state.step === 'toMast', 'off to the mast');
    room.teleport(MAST_SPOT.x, MAST_SPOT.y);
    await say(client, 'blackout');
    await waitFor(() => client.state.step === 'power', 'the generators');
  }

  async function restart(client: MissionClient, room: MissionRoom, i: number): Promise<void> {
    const g = GENERATORS[i];
    if (g === undefined) throw new Error('generator');
    room.teleport(g.at.x, g.at.y);
    await sleep(60);
    client.send('work', { spot: i });
    await waitFor(() => client.state.spots[i]?.done === true, `restarted ${g.label}`);
  }

  it('carries the lead’s history in, offers the Byzantine ending only to those who asked for a cut, and pays the season finale', async () => {
    const cookie = await guest();
    await remember(cookie, {
      dump: { done: true, honest: true, marks: [] },
      insider: { done: true, honest: false, marks: ['askedCut'] },
      ceremony: { done: true, honest: true, marks: ['satHonest'] },
    });
    const { client, room, results } = await begin(cookie, true, 'founder');
    await waitFor(() => client.state.marks.length >= 4, 'history carried in');
    expect([...client.state.marks]).toEqual(expect.arrayContaining(['pastHonest', 'pastCut', 'pastCeremony', 'pastCeremonyHeld']));
    await toTheMast(client, room);
    for (const i of [0, 1, 2]) await restart(client, room, i);
    await waitFor(() => client.state.node === 'onAir', 'on air');
    expect(client.state.npcs.get('sharpe')?.shown).toBe(true);
    await say(client, 'onAir');
    await say(client, 'nineMinutes');
    await say(client, 'theChoice', 'byzantine');
    await say(client, 'endByzantine');
    await waitFor(() => client.state.node === 'dawn', 'dawn');
    expect(client.state.npcs.get('mags')?.shown).toBe(true);
    const me = client.state.players.get(client.sessionId);
    expect(me !== undefined && Math.hypot(me.x - GATE_SPOT.x, me.y - GATE_SPOT.y) < 3).toBe(true);
    await say(client, 'dawn');
    await say(client, 'voicemail');
    await waitFor(() => results.length === 1, 'result');
    expect(results[0]).toEqual({ reason: 'paid', paid: FOUNDER_REWARD_SATS, honest: true });
    expect([...client.state.marks]).toContain('chosenByzantine');
  }, 60_000);

  it('ignores the Byzantine ending for a crew that never asked for a cut', async () => {
    const { client, room } = await begin(null, true, 'founder');
    await toTheMast(client, room);
    for (const i of [1, 2, 3]) await restart(client, room, i);
    await say(client, 'onAir');
    await say(client, 'nineMinutes');
    await waitFor(() => client.state.node === 'theChoice', 'the choice');
    client.send('choose', { node: 'theChoice', choice: 'byzantine' });
    await sleep(250);
    expect(client.state.node).toBe('theChoice');
    expect(client.state.votes.size).toBe(0);
    client.send('choose', { node: 'theChoice', choice: 'burn' });
    await waitFor(() => client.state.node === 'endBurn', 'the burn ending');
  }, 60_000);

  it('sends anyone a Choir runner lights up back to the road by the mast', async () => {
    const { client, room, caught } = await begin(null, false, 'founder');
    await toTheMast(client, room);
    const runner = client.state.npcs.get('choir0');
    if (runner === undefined) throw new Error('runner');
    let placed = false;
    for (let d = 1.2; d <= 3 && !placed; d += 0.4) {
      const p = { x: runner.x + Math.cos(runner.facing) * d, y: runner.y + Math.sin(runner.facing) * d };
      if (canStand(CITY_MAP, p)) {
        room.teleport(p.x, p.y);
        placed = true;
      }
    }
    expect(placed).toBe(true);
    await waitFor(() => caught.length === 1, 'caught by the Choir');
    expect(caught[0]?.by).toBe('choir');
    const me = client.state.players.get(client.sessionId);
    await waitFor(() => me !== undefined && Math.hypot(me.x - MAST_SPOT.x, me.y - MAST_SPOT.y) < 1.5, 'back on the road');
  }, 60_000);
});
