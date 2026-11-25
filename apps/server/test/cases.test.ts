import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cryptoRandom, type Vec2 } from '@byzantine-council/shared';
import {
  BENCHES,
  BINS,
  BISCUIT_REFUSES,
  BRANNIGAN_NOTE,
  BRANNIGAN_ROUNDS,
  CaughtLineSchema,
  COINS_START,
  DEADMAN_REWARD_SATS,
  DETAILS,
  GULLS,
  JAR_FOUND,
  JAR_NOTES,
  KENNEL_SPOT,
  KIT_FLAT,
  LYCHGATE,
  MARCO_DOOR,
  MEMORIES,
  MISSION_MESSAGES,
  MISSION_ROOM,
  MissionNoteSchema,
  MissionResultSchema,
  MissionSpot,
  MissionState,
  NUMBER_REWARD_SATS,
  PASSWORD_REWARD_SATS,
  PIZZA_REWARD_SATS,
  POPCORN_ACT,
  POPCORN_REWARD_SATS,
  QUAYEX_DOOR,
  SHOP_DOOR,
  STORY_ACTS,
  STUDIO_DOOR,
  TIP_JARS,
  TOPPINGS,
  BENNY_DOOR,
  CLEAN_NOTE,
  COINS_REWARD_SATS,
  IVY_SPOT,
  OVERFLOW_ACT,
  OVERFLOW_REWARD_SATS,
  OZZY_LOOP,
  HALL_STEPS,
  SHOPKEEPERS,
  SIGNALS_NEEDED,
  SPLIT_ACT,
  SPLIT_REWARD_SATS,
  WON_FIRM_MS,
  visibleChoices,
  type ActId,
  type CaughtLine,
  type MissionNote,
  type MissionResult,
} from '@byzantine-council/shared/city';
import type { MissionRoom } from '../src/city/MissionRoom.js';
import { OverflowRules } from '../src/city/acts/overflowRules.js';
import { PopcornRules } from '../src/city/acts/popcornRules.js';
import { SplitRules } from '../src/city/acts/splitRules.js';
import type { ActContext, CrewMember } from '../src/city/acts/rules.js';
import { MemoryProfileStore } from '../src/profile/store.js';
import { COOKIE_NAME, type SessionKeys } from '../src/profile/session.js';
import { ORIGIN, freshIp, sdk, sleep, startServer, waitFor } from './helpers.js';

const PORT = 3899;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const keys: SessionKeys = { current: Buffer.from('c'.repeat(32)), previous: null, secure: false };
const store = new MemoryProfileStore();
let colyseus: ColyseusTestServer;

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

async function begin(act: ActId, quiet = true) {
  const client = await sdk(PORT, { cookie: await guest() }).create<MissionState>(MISSION_ROOM, { nickname: 'Rook', act }, MissionState);
  await waitFor(() => client.state.players.has(client.sessionId), 'joined');
  const room = colyseus.getRoomById<MissionRoom>(client.roomId);
  if (quiet) room.quietNight();
  const results: MissionResult[] = [];
  const caught: CaughtLine[] = [];
  const notes: MissionNote[] = [];
  client.onMessage(MISSION_MESSAGES.RESULT, (m: unknown) => results.push(MissionResultSchema.parse(m)));
  client.onMessage(MISSION_MESSAGES.CAUGHT, (m: unknown) => caught.push(CaughtLineSchema.parse(m)));
  client.onMessage(MISSION_MESSAGES.NOTE, (m: unknown) => notes.push(MissionNoteSchema.parse(m)));
  return { client, room, results, caught, notes, act: STORY_ACTS[act] };
}
type Run = Awaited<ReturnType<typeof begin>>;

// Plays scenes as they come, answering with the given picks (else the first choice offered), until `stop` holds.
async function drive(run: Run, picks: Readonly<Record<string, string>>, stop: (s: MissionState) => boolean): Promise<void> {
  const { client, act } = run;
  for (let guard = 0; guard < 80 && !stop(client.state); guard++) {
    const node = client.state.node;
    if (node === '') {
      await waitFor(() => client.state.node !== '' || stop(client.state), `a scene in ${act.id} at ${client.state.step}`, 8000);
      continue;
    }
    const seq = client.state.seq;
    const scene = act.script[node];
    const offered = scene === undefined ? [] : visibleChoices(scene, new Set(client.state.marks));
    if (offered.length > 0) client.send('choose', { node, choice: picks[node] ?? offered[0]?.id ?? '' });
    else {
      await sleep(350);
      client.send('advance', { node });
    }
    await waitFor(() => client.state.seq !== seq || client.state.node !== node || stop(client.state), `past ${node}`, 8000);
  }
  expect(stop(client.state), `${act.id} stopped at ${client.state.step}/${client.state.node}`).toBe(true);
}

const atStep = (step: string) => (s: MissionState) => s.step === step && s.node === '';

async function work(run: Run, spot: number): Promise<void> {
  const at = run.act.spots[spot]?.at;
  if (at === undefined) throw new Error('spot');
  run.room.teleport(at.x, at.y);
  await sleep(80);
  run.client.send('work', { spot });
  await waitFor(() => run.client.state.spots[spot]?.done === true, `${run.act.id} spot ${String(spot)}`, 6000);
}

async function arrive(run: Run, at: Vec2, step: string): Promise<void> {
  run.room.teleport(at.x, at.y);
  await waitFor(() => run.client.state.step === step, `${run.act.id} ${step}`, 4000);
}

async function finish(run: Run, picks: Readonly<Record<string, string>>, sats: number): Promise<void> {
  await drive(run, picks, (s) => s.step === 'done');
  await waitFor(() => run.results.length > 0, 'paid', 6000);
  expect(run.results[0]).toEqual(expect.objectContaining({ reason: 'paid', paid: sats }));
}

async function caughtOn(run: Run, npcId: string, by: CaughtLine['by'], back: Vec2): Promise<void> {
  const n = run.client.state.npcs.get(npcId);
  if (n === undefined) throw new Error(npcId);
  run.room.teleport(n.x, n.y);
  await waitFor(() => run.caught.length > 0, `caught by ${npcId}`, 4000);
  expect(run.caught[0]?.by).toBe(by);
  const me = run.client.state.players.get(run.client.sessionId);
  expect(Math.hypot((me?.x ?? 0) - back.x, (me?.y ?? 0) - back.y)).toBeLessThan(2.5);
}

// An act's rules on their own, against a clock the test runs: no room, no network.
function fakeContext(state: MissionState, crew: CrewMember[] = []): ActContext {
  return {
    act: POPCORN_ACT,
    state,
    random: cryptoRandom,
    marks: new Set(),
    crew: () => crew,
    anchor: () => null,
    inScene: () => false,
    setStep: (step) => {
      state.step = step;
    },
    mark: () => undefined,
    catchMember: () => undefined,
    broadcast: () => undefined,
    moveCrew: () => undefined,
  };
}

describe('The Popcorn Tin', () => {
  it('keeps Biscuit on the kennel until the bins are rattled, then gives the tin to whoever searches it', async () => {
    const run = await begin('popcorn');
    await drive(run, { street: 'polite' }, atStep('search'));
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['politeOkafor', 'clueKennel', 'clueBins']));
    const kennel = POPCORN_ACT.spots[KENNEL_SPOT]?.at ?? COINS_START;
    run.room.teleport(kennel.x, kennel.y);
    await sleep(80);
    run.client.send('work', { spot: KENNEL_SPOT });
    await waitFor(() => run.notes.length > 0, 'refused');
    expect(run.notes[0]?.text).toBe(BISCUIT_REFUSES);
    expect(run.client.state.spots[KENNEL_SPOT]?.done).toBe(false);
    await work(run, BINS);
    await work(run, KENNEL_SPOT);
    expect(run.room.secretSpot).toBe(KENNEL_SPOT);
    await finish(run, { tin: 'hand' }, POPCORN_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['handedTin', 'beatBrannigan']));
  });

  it('has Brannigan search his rounds in order and take the tin himself if nobody beats him', () => {
    const state = new MissionState();
    for (let i = 0; i < POPCORN_ACT.spots.length; i++) state.spots.push(new MissionSpot());
    state.step = 'search';
    const notes: string[] = [];
    const ctx: ActContext = {
      ...fakeContext(state),
      act: POPCORN_ACT,
      broadcast: (_type, payload) => notes.push((payload as { text: string }).text),
    };
    const rules = new PopcornRules();
    rules.setup(ctx);
    const order: number[] = [];
    let now = 0;
    for (; now < 180_000 && state.step === 'search'; now += 50) {
      rules.tick(ctx, now);
      state.spots.forEach((s, i) => {
        if (s.done && !order.includes(i)) order.push(i);
      });
    }
    expect(state.step).toBe('beaten');
    expect(order).toEqual(BRANNIGAN_ROUNDS.map((r) => r.spot));
    expect(state.spots[0]?.note).toBe(BRANNIGAN_NOTE);
    expect(now).toBeGreaterThan(40_000);
    expect(notes.some((n) => n.includes('trots to the bins'))).toBe(true);
    expect(state.spots.every((s) => s.worker === '')).toBe(true);
  });
});

describe('Borrowed Number', () => {
  it('takes all three details to send the crew to the shop, where the clerk is a detective', async () => {
    const run = await begin('number');
    await drive(run, { pip: 'calm' }, atStep('gather'));
    for (let i = 0; i < DETAILS.length; i++) {
      expect(run.client.state.step).toBe('gather');
      await work(run, i);
    }
    await waitFor(() => run.client.state.step === 'toShop', 'to the shop');
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(DETAILS.map((d) => d.mark)));
    await arrive(run, SHOP_DOOR, 'shop');
    await finish(run, { shop: 'truth' }, NUMBER_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['calmedPip', 'truthJuno']));
  });
});

describe('Follow the Coins', () => {
  it('hides the reused address on one tip jar until it is scanned, then follows it to the studio', async () => {
    const run = await begin('coins');
    await drive(run, { chain: 'round', chainTwo: 'same' }, atStep('scan'));
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['missedChange', 'gotChange', 'gotCommon']));
    const secret = run.room.secretSpot;
    expect(secret).toBeGreaterThanOrEqual(0);
    expect(secret).toBeLessThan(TIP_JARS.length);
    const wrong = (secret + 1) % TIP_JARS.length;
    await work(run, wrong);
    expect(JAR_NOTES).toContain(run.client.state.spots[wrong]?.note);
    await work(run, secret);
    expect(run.client.state.spots[secret]?.note).toBe(JAR_FOUND);
    await drive(run, {}, atStep('toStudio'));
    await arrive(run, STUDIO_DOOR, 'studio');
    await finish(run, { studio: 'call' }, COINS_REWARD_SATS);
  });

  it('sends anyone caught in the ring light back to the top of the market', async () => {
    const run = await begin('coins', false);
    await drive(run, {}, atStep('scan'));
    await caughtOn(run, 'tiny', 'guard', COINS_START);
  });
});

describe('The Dead Man’s Vault', () => {
  it('opens on three shares, never counting a missing plaque', async () => {
    const run = await begin('deadman');
    await drive(run, { funeral: 'sorry' }, atStep('shares'));
    const missing = BENCHES.findIndex((b) => b.refuses === true);
    await work(run, missing);
    const shares = BENCHES.flatMap((b, i) => (b.refuses === true ? [] : [i]));
    for (const i of shares) {
      expect(run.client.state.step).toBe('shares');
      await work(run, i);
    }
    await waitFor(() => run.client.state.step === 'toVault', 'to the vault');
    await arrive(run, QUAYEX_DOOR, 'vault');
    await finish(run, { vault: 'books' }, DEADMAN_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['sorryPenrose', 'clueThreshold', 'checkedBooks']));
  });

  it('sends anyone caught in the lantern back to the lychgate', async () => {
    const run = await begin('deadman', false);
    await drive(run, {}, atStep('shares'));
    await caughtOn(run, 'keeper', 'keeper', LYCHGATE);
  });
});

describe('The Forgotten Password', () => {
  async function toTheDrive(run: Run): Promise<void> {
    await drive(run, { flat: 'listen' }, atStep('memories'));
    for (let i = 0; i < MEMORIES.length; i++) {
      await work(run, i);
      await drive(run, {}, i < MEMORIES.length - 1 ? atStep('memories') : atStep('toFlat'));
    }
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['clueBoat', 'clueYear', 'clueLower', 'allMemories']));
    await arrive(run, KIT_FLAT, 'guess');
  }

  it('plays a memory at each place, then opens the drive on the second guess', async () => {
    const run = await begin('password');
    await toTheDrive(run);
    await finish(run, { guess3: 'caps', guess2: 'exact' }, PASSWORD_REWARD_SATS);
    expect([...run.client.state.marks]).toContain('unlocked');
  });

  it('wipes the drive after three wrong guesses, and still closes the case', async () => {
    const run = await begin('password');
    await toTheDrive(run);
    await finish(run, { guess3: 'caps', guess2: 'boat', guess1: 'name' }, PASSWORD_REWARD_SATS);
    expect([...run.client.state.marks]).toContain('lockedOut');
  });
});

describe('Pizza Night', () => {
  it('takes three toppings (never anchovies) and a delivery across town', async () => {
    const run = await begin('pizza');
    await drive(run, { notice: 'deal' }, atStep('toppings'));
    const anchovies = TOPPINGS.findIndex((t) => t.refuses === true);
    await work(run, anchovies);
    const good = TOPPINGS.flatMap((t, i) => (t.refuses === true ? [] : [i])).slice(0, 3);
    for (const i of good) await work(run, i);
    await waitFor(() => run.client.state.step === 'toMarco', 'back to Marco');
    await arrive(run, MARCO_DOOR, 'oven');
    await drive(run, {}, atStep('deliver'));
    await arrive(run, BENNY_DOOR, 'benny');
    await finish(run, { benny: 'free' }, PIZZA_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['believedBenny', 'onTheHouse']));
  });

  it('lets a gull send a delivery back to the last corner', async () => {
    const run = await begin('pizza', false);
    await drive(run, {}, atStep('toppings'));
    for (const i of TOPPINGS.flatMap((t, j) => (t.refuses === true ? [] : [j])).slice(0, 3)) await work(run, i);
    await arrive(run, MARCO_DOOR, 'oven');
    await drive(run, {}, atStep('deliver'));
    await caughtOn(run, 'gull0', 'gull', GULLS[0]?.back ?? MARCO_DOOR);
  });
});

describe('season two, act one: The Overflow', () => {
  it('finds the three stalls that took a bad note, catches Ozzy, and fixes the Mint', async () => {
    const run = await begin('overflow', false);
    await drive(run, { hatch: 'leave' }, atStep('toMint'));
    await arrive(run, IVY_SPOT, 'mint');
    await drive(run, { mint: 'doubt' }, atStep('verify'));
    const rules = run.room.rules;
    if (!(rules instanceof OverflowRules)) throw new Error('not The Overflow');
    const bad = [...rules.bad];
    expect(bad).toHaveLength(3);
    const clean = OVERFLOW_ACT.spots.findIndex((_, i) => !rules.bad.has(i));
    await work(run, clean);
    expect(run.client.state.spots[clean]?.note).toBe(CLEAN_NOTE);
    expect(run.client.state.npcs.get('ozzy')?.shown).toBe(false);
    for (const i of bad) await work(run, i);
    await waitFor(() => run.client.state.step === 'chase', 'the chase');
    await waitFor(() => run.client.state.npcs.get('ozzy')?.shown === true, 'Ozzy shows up');
    const ozzy = run.client.state.npcs.get('ozzy');
    run.room.teleport(ozzy?.x ?? 0, ozzy?.y ?? 0);
    await waitFor(() => run.client.state.step === 'caught', 'caught up with Ozzy', 4000);
    await finish(run, { caught: 'report' }, OVERFLOW_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['leftMags', 'clueOverflow', 'doubtedIvy', 'clueHoodie', 'reportedBug']));
  });

  it('lets one runner catch Ozzy once he runs out of puff', () => {
    const state = new MissionState();
    for (let i = 0; i < OVERFLOW_ACT.spots.length; i++) state.spots.push(new MissionSpot());
    const start = OZZY_LOOP[0] ?? IVY_SPOT;
    const runner = { x: start.x, y: start.y - 7 };
    const crew = [{ id: 'rook', player: runner, caughtUntil: 0 }] as unknown as CrewMember[];
    const ctx = { ...fakeContext(state, crew), act: OVERFLOW_ACT };
    const rules = new OverflowRules();
    rules.setup(ctx);
    state.step = 'chase';
    rules.onStep(ctx, 'chase');
    let now = 0;
    for (; now < 60_000 && state.step === 'chase'; now += 50) {
      rules.tick(ctx, now);
      const o = state.npcs.get('ozzy');
      if (o === undefined) break;
      const d = Math.hypot(o.x - runner.x, o.y - runner.y);
      const step = Math.min(d, 3.5 * 0.05);
      runner.x += ((o.x - runner.x) / d) * step;
      runner.y += ((o.y - runner.y) / d) * step;
    }
    expect(state.step).toBe('caught');
    expect(now).toBeLessThan(30_000);
  });

  it('turns Ozzy back the other way from anyone coming at him from ahead', () => {
    const state = new MissionState();
    const start = OZZY_LOOP[0] ?? IVY_SPOT;
    const crew = [{ id: 'rook', player: { x: start.x, y: start.y + 3 }, caughtUntil: 0 }] as unknown as CrewMember[];
    const ctx = { ...fakeContext(state, crew), act: OVERFLOW_ACT };
    const rules = new OverflowRules();
    rules.setup(ctx);
    state.step = 'chase';
    rules.tick(ctx, 0);
    rules.tick(ctx, 50);
    const o = state.npcs.get('ozzy');
    expect(o?.chasing).toBe(true);
    expect(o?.y).toBe(start.y);
    expect(o?.x ?? 0).toBeGreaterThan(start.x);
  });
});

describe('season two, act two: The Split', () => {
  it('wins five shopkeepers round and lets Rex fork off', async () => {
    const run = await begin('split');
    await drive(run, {}, atStep('toHall'));
    await arrive(run, HALL_STEPS, 'hall');
    await drive(run, { hall: 'hear' }, atStep('canvass'));
    for (let i = 0; i < SIGNALS_NEEDED; i++) {
      expect(run.client.state.step).toBe('canvass');
      await work(run, i);
    }
    await waitFor(() => run.client.state.step === 'count', 'the count');
    await finish(run, { count: 'luck' }, SPLIT_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['clueRules', 'heardBoth', 'wishedRex']));
  });

  function canvass(crewAt: { x: number; y: number } | null) {
    const state = new MissionState();
    for (let i = 0; i < SPLIT_ACT.spots.length; i++) state.spots.push(new MissionSpot());
    const crew = crewAt === null ? [] : ([{ id: 'rook', player: crewAt, caughtUntil: 0 }] as unknown as CrewMember[]);
    const ctx = { ...fakeContext(state, crew), act: SPLIT_ACT };
    const rules = new SplitRules();
    rules.setup(ctx);
    state.step = 'canvass';
    const spot = state.spots[0];
    if (spot === undefined) throw new Error('spot');
    spot.done = true;
    rules.worked(ctx, 0, crew[0] as CrewMember, 0);
    let flippedAt = -1;
    for (let now = 0; now < 90_000 && flippedAt < 0; now += 50) {
      rules.tick(ctx, now);
      if (state.spots[0]?.done === false) flippedAt = now;
    }
    return { flippedAt, spot };
  }

  it('has Rex talk back a shopkeeper left alone, but only once they have had time to waver', () => {
    const { flippedAt, spot } = canvass(null);
    expect(flippedAt).toBeGreaterThanOrEqual(WON_FIRM_MS);
    expect(spot.note).toContain('Rex talked the baker round');
  });

  it('never lets Rex talk round a shopkeeper someone is standing with', () => {
    const at = SHOPKEEPERS[0]?.at ?? HALL_STEPS;
    expect(canvass({ x: at.x, y: at.y }).flippedAt).toBe(-1);
  });
});
