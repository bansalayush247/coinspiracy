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
  BOATS,
  COOP_YARD,
  HARBOUR_OFFICE,
  JETTY_MARKS,
  RECEIPT_ACT,
  RECEIPT_FOUND,
  RECEIPT_REWARD_SATS,
  TIDE_MS,
  visibleChoices,
  type ActId,
  type CaughtLine,
  type MissionNote,
  type MissionResult,
  AERIAL,
  ALERT_ACT,
  DEE_SHOP,
  DOORS,
  DUST_ACT,
  DUST_LOST,
  DUST_REWARD_SATS,
  DESKS,
  ENVELOPE_ACT,
  ENVELOPE_REWARD_SATS,
  HALL_STEPS_EAST,
  CLOCK_ACT,
  CLOCK_REWARD_SATS,
  CROWD_CYCLE_S,
  MINT_DOOR,
  OLIVE_SHOP,
  BOOK_ACT,
  BOOK_HANDS_FULL,
  BOOK_POSTS,
  BOOK_READ,
  BOOK_RECALLED,
  BOOK_REWARD_SATS,
  MOTION_NEEDED,
  POST_NOTES,
  READING_TABLE,
  VOTE_S,
  CITY_MAP,
  walkPath,
  type Walker,
  ALERT_REWARD_SATS,
  GATE_SPOT,
  HATCH,
  MAGS_SPOTTED,
} from '@byzantine-council/shared/city';
import { findPath } from '@byzantine-council/shared/pathfinding';
import type { MissionRoom } from '../src/city/MissionRoom.js';
import { OverflowRules } from '../src/city/acts/overflowRules.js';
import { PopcornRules } from '../src/city/acts/popcornRules.js';
import { SplitRules } from '../src/city/acts/splitRules.js';
import { ReceiptRules } from '../src/city/acts/receiptRules.js';
import { AlertRules } from '../src/city/acts/alertRules.js';
import { DustRules } from '../src/city/acts/dustRules.js';
import { EnvelopeRules } from '../src/city/acts/envelopeRules.js';
import { ClockRules } from '../src/city/acts/clockRules.js';
import { BookRules } from '../src/city/acts/bookRules.js';
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

describe('season two, act three: The Old Receipt', () => {
  it('narrows the search to the right jetty for a kind crew, and beats the tide to the office', async () => {
    const run = await begin('receipt');
    await drive(run, { tower: 'thanks' }, atStep('toDocks'));
    await arrive(run, COOP_YARD, 'coop');
    await drive(run, { coop: 'calm' }, atStep('search'));
    const secret = run.room.secretSpot;
    const boat = BOATS[secret];
    if (boat === undefined) throw new Error('boat');
    const told = JETTY_MARKS.filter((m) => run.client.state.marks.includes(m));
    expect(told).toEqual([JETTY_MARKS[boat.jetty]]);
    expect(run.client.state.clock).toBe(TIDE_MS / 1000);
    await work(run, secret);
    expect(run.client.state.spots[secret]?.note).toBe(RECEIPT_FOUND);
    await waitFor(() => run.client.state.step === 'deliver', 'off to the office');
    await arrive(run, HARBOUR_OFFICE, 'office');
    await finish(run, { office: 'mercy' }, RECEIPT_REWARD_SATS);
    expect(run.client.state.clock).toBe(0);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['clueTab', 'thankedOzzy', 'calmedNell', 'beatTide', 'askedMercy']));
  });

  it('never tells a crew that rushed Nell which jetty it is', async () => {
    const run = await begin('receipt');
    await drive(run, {}, atStep('toDocks'));
    await arrive(run, COOP_YARD, 'coop');
    await drive(run, { coop: 'rush' }, atStep('search'));
    expect(JETTY_MARKS.filter((m) => run.client.state.marks.includes(m))).toEqual([]);
  });

  it('counts the tide down and lets the old receipt stand if it runs out', () => {
    const state = new MissionState();
    for (let i = 0; i < RECEIPT_ACT.spots.length; i++) state.spots.push(new MissionSpot());
    const ctx = { ...fakeContext(state), act: RECEIPT_ACT };
    const rules = new ReceiptRules();
    rules.setup(ctx);
    state.step = 'search';
    rules.onStep(ctx, 'search', 0);
    rules.tick(ctx, 10_000);
    expect(state.clock).toBe(TIDE_MS / 1000 - 10);
    let now = 10_000;
    for (; now <= TIDE_MS + 1000 && state.step === 'search'; now += 50) rules.tick(ctx, now);
    expect(state.step).toBe('missed');
    expect(now).toBeGreaterThanOrEqual(TIDE_MS);
    expect(state.clock).toBe(0);
  });
});

describe('season two, act four: The Last Alert', () => {
  it('walks Mags to the aerial, where she reads the key out and ends the season', async () => {
    const run = await begin('alert');
    await drive(run, { tower: 'risk' }, atStep('toTip'));
    await arrive(run, GATE_SPOT, 'hatch');
    await drive(run, { hatch: 'why' }, atStep('escort'));
    const found = findPath(CITY_MAP, HATCH, AERIAL);
    if (!found.ok) throw new Error('no path');
    const mags = () => run.client.state.npcs.get('mags') ?? { x: 0, y: 0 };
    let from: Vec2 = HATCH;
    const hops = found.value.flatMap((to) => {
      const n = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 3);
      const a = from;
      from = to;
      return Array.from({ length: n }, (_, i) => ({ x: a.x + ((to.x - a.x) * (i + 1)) / n, y: a.y + ((to.y - a.y) * (i + 1)) / n }));
    });
    for (const p of hops) {
      run.room.teleport(p.x, p.y);
      await waitFor(() => Math.hypot(mags().x - p.x, mags().y - p.y) <= 1.5 || run.client.state.step !== 'escort', 'Mags keeps up', 8000);
    }
    await waitFor(() => run.client.state.step === 'aerial', 'at the aerial', 8000);
    await finish(run, { aerial: 'publish' }, ALERT_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['clueAlert', 'sawRisk', 'askedWhy', 'publishedKey']));
  }, 60_000);

  it('keeps Mags at the hatch until someone comes for her, and sends her back there when a torch finds her', () => {
    const state = new MissionState();
    const notes: unknown[] = [];
    const rook = { x: HATCH.x + 20, y: HATCH.y };
    const crew = [{ id: 'rook', player: rook, caughtUntil: 0 }] as unknown as CrewMember[];
    const ctx = { ...fakeContext(state, crew), act: ALERT_ACT, broadcast: (_: string, payload: unknown) => notes.push(payload) };
    const rules = new AlertRules();
    rules.setup(ctx);
    state.step = 'escort';
    let now = 0;
    for (; now < 3000; now += 50) rules.move(ctx, now);
    expect(state.npcs.get('mags')?.x).toBe(HATCH.x);
    const lane = findPath(CITY_MAP, HATCH, { x: 39.5, y: 15 });
    if (!lane.ok) throw new Error('no path');
    let walker: Walker = { x: HATCH.x + 1, y: HATCH.y, facing: 0, leg: 0 };
    const path = [{ x: walker.x, y: walker.y }, ...lane.value];
    for (; now < 60_000 && rules.spotted === 0; now += 50) {
      const m = state.npcs.get('mags');
      if (Math.hypot((m?.x ?? 0) - walker.x, (m?.y ?? 0) - walker.y) < 4) walker = walkPath(walker, path, 3.5, 0.05);
      rook.x = walker.x;
      rook.y = walker.y;
      rules.move(ctx, now);
      rules.tick(ctx, now);
    }
    expect(rules.spotted).toBe(1);
    expect(notes).toEqual([{ text: MAGS_SPOTTED }]);
    expect(state.npcs.get('mags')?.x).toBe(HATCH.x);
    expect(state.step).toBe('escort');
  });
});

describe('season three, act one: The Dust', () => {
  it('warns the street, tails Mr Fennick to Glasshouse, and meets Perpetua Glass', async () => {
    const run = await begin('dust');
    await drive(run, { dust: 'kind' }, atStep('warn'));
    for (const i of [0, 1, 2]) await work(run, i);
    await waitFor(() => run.client.state.step === 'toShop', 'off to the shop');
    expect(run.client.state.marks).toContain('clueGreyCoat');
    await arrive(run, DEE_SHOP, 'shop');
    await drive(run, { shop: 'follow' }, atStep('tail'));
    const fennick = () => run.client.state.npcs.get('fennick') ?? { x: 0, y: 0 };
    await waitFor(() => {
      if (run.client.state.step === 'tail') run.room.teleport(fennick().x, fennick().y);
      return run.client.state.step !== 'tail';
    }, 'at Glasshouse', 60_000);
    expect(run.client.state.step).toBe('office');
    await finish(run, { office: 'privacy' }, DUST_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['clueDust', 'reassured', 'clueGreyCoat', 'quietTail', 'defendedPrivacy']));
  }, 90_000);

  it('starts the tail again from Dee’s when he catches someone looking, or the crew falls too far behind', () => {
    const run = (at: { x: number; y: number }) => {
      const state = new MissionState();
      for (let i = 0; i < DOORS.length; i++) state.spots.push(new MissionSpot());
      const notes: unknown[] = [];
      const caught: string[] = [];
      const crew = [{ id: 'rook', player: { ...at }, caughtUntil: 0 }] as unknown as CrewMember[];
      const ctx = {
        ...fakeContext(state, crew),
        act: DUST_ACT,
        broadcast: (_: string, payload: unknown) => notes.push(payload),
        catchMember: (_: CrewMember, by: string) => caught.push(by),
      };
      const rules = new DustRules();
      rules.setup(ctx);
      state.step = 'tail';
      rules.onStep(ctx, 'tail');
      for (let now = 0; now < 30_000 && rules.spotted + rules.lost === 0; now += 50) {
        rules.move(ctx, now);
        rules.tick(ctx, now);
      }
      const f = state.npcs.get('fennick');
      return { rules, notes, caught, back: Math.hypot((f?.x ?? 0) - DEE_SHOP.x, (f?.y ?? 0) - DEE_SHOP.y) };
    };
    const seen = run({ x: 96.5, y: 92.5 });
    expect(seen.rules.spotted).toBe(1);
    expect(seen.caught).toEqual(['courier']);
    expect(seen.back).toBeLessThan(0.01);
    const left = run(DEE_SHOP);
    expect(left.rules.lost).toBe(1);
    expect(left.notes).toEqual([{ text: DUST_LOST }]);
    expect(left.back).toBeLessThan(0.01);
  });
});

describe('season three, act two: The Envelope', () => {
  it('seals three envelopes, has them signed blind, and spends one under Perpetua Glass’s nose', async () => {
    const run = await begin('envelope');
    await drive(run, { steps: 'time' }, atStep('seal'));
    for (const i of [0, 1, 2]) await work(run, i);
    await drive(run, { counter: 'okafor' }, atStep('toShop'));
    expect(run.client.state.marks).toContain('clueCarbon');
    await arrive(run, DEE_SHOP, 'till');
    await finish(run, { till: 'polite' }, ENVELOPE_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['clueEnvelope', 'timedCamera', 'clueCarbon', 'spendForOkafor', 'politeGlass']));
  }, 90_000);

  it('snaps only someone writing in the camera’s view, and sends them back up the steps', () => {
    const run = (writing: boolean) => {
      const state = new MissionState();
      for (let i = 0; i < DESKS.length; i++) state.spots.push(new MissionSpot());
      const caught: { by: string; to: { x: number; y: number } }[] = [];
      const desk = DESKS[1]?.at ?? DEE_SHOP;
      const crew = [{ id: 'rook', player: { ...desk }, caughtUntil: 0 }] as unknown as CrewMember[];
      const ctx = { ...fakeContext(state, crew), act: ENVELOPE_ACT, catchMember: (_: CrewMember, by: string, to: { x: number; y: number }) => caught.push({ by, to }) };
      const rules = new EnvelopeRules();
      rules.setup(ctx);
      state.step = 'seal';
      const spot = state.spots[1];
      if (writing && spot !== undefined) spot.worker = 'rook';
      for (let now = 0; now < 20_000 && rules.snapped === 0; now += 50) {
        rules.move(ctx);
        rules.tick(ctx, now);
      }
      return { rules, caught, chasing: state.npcs.get('lumley')?.chasing };
    };
    const writer = run(true);
    expect(writer.rules.snapped).toBe(1);
    expect(writer.caught).toEqual([{ by: 'camera', to: HALL_STEPS_EAST }]);
    expect(writer.chasing).toBe(true);
    const idler = run(false);
    expect(idler.rules.snapped).toBe(0);
  });
});

describe('season three, act three: The Clock', () => {
  it('sends the crowd out at the chime, walks to the olive shop with it, and meets Glass at the market', async () => {
    const run = await begin('clock');
    await drive(run, { clock: 'wait' }, atStep('blend'));
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['clueAmounts', 'clueCrowd', 'waitedChime']));
    const start = run.client.state.npcs.get('shopper0');
    const from = { x: start?.x ?? 0, y: start?.y ?? 0 };
    await waitFor(() => run.client.state.clock > 0, 'the crowd clock runs');
    await waitFor(() => {
      const s = run.client.state.npcs.get('shopper0');
      return Math.hypot((s?.x ?? 0) - from.x, (s?.y ?? 0) - from.y) > 2;
    }, 'the crowd leaves at the chime', 15_000);
    await arrive(run, OLIVE_SHOP, 'market');
    await finish(run, { market: 'no' }, CLOCK_REWARD_SATS);
    expect(run.client.state.marks).toContain('refusedBook');
  }, 90_000);

  it('clocks someone alone at the shop, and never someone walking inside the crowd', () => {
    const run = (follow: boolean) => {
      const state = new MissionState();
      const caught: { by: string; to: { x: number; y: number } }[] = [];
      const me = { x: OLIVE_SHOP.x, y: OLIVE_SHOP.y };
      const crew = [{ id: 'rook', player: me, caughtUntil: 0 }] as unknown as CrewMember[];
      const ctx = { ...fakeContext(state, crew), act: CLOCK_ACT, catchMember: (_: CrewMember, by: string, to: { x: number; y: number }) => caught.push({ by, to }) };
      const rules = new ClockRules();
      rules.setup(ctx);
      state.step = 'blend';
      rules.onStep(ctx, 'blend');
      for (let now = 0; now < CROWD_CYCLE_S * 1000 && rules.clockedCount === 0; now += 50) {
        rules.move(ctx);
        if (follow) {
          const all = [...state.npcs.entries()].filter(([id]) => id.startsWith('shopper')).map(([, n]) => n);
          me.x = all.reduce((a, n) => a + n.x, 0) / all.length;
          me.y = all.reduce((a, n) => a + n.y, 0) / all.length;
        }
        rules.tick(ctx, now);
      }
      return { rules, caught, fennick: state.npcs.get('fennick')?.chasing, clock: state.clock };
    };
    const alone = run(false);
    expect(alone.rules.clockedCount).toBe(1);
    expect(alone.caught).toEqual([{ by: 'stopwatch', to: MINT_DOOR }]);
    expect(alone.fennick).toBe(true);
    expect(alone.clock).toBeGreaterThan(0);
    expect(run(true).rules.clockedCount).toBe(0);
  });
});

describe('season three, act four: The Little Book', () => {
  it('reads Mr Varnish’s letters out at the table until the vote, and ends season three', async () => {
    const run = await begin('book');
    await drive(run, { letter: 'together' }, atStep('letters'));
    await waitFor(() => run.client.state.clock > 0, 'the vote clock runs');
    await waitFor(() => run.client.state.spots.some((s) => !s.done), 'a letter handed over', 15_000);
    const i = run.client.state.spots.findIndex((s) => !s.done);
    await work(run, i);
    expect(run.client.state.spots[i]?.note).toBe(POST_NOTES[i]);
    expect(run.client.state.npcs.get(`letter${String(i)}`)?.shown).toBe(true);
    run.room.teleport(READING_TABLE.x, READING_TABLE.y);
    await waitFor(() => run.client.state.marks.includes('clueTogether'), 'read out at the table');
    expect(run.notes.map((n) => n.text)).toContain(BOOK_READ);
    await waitFor(() => run.client.state.step === 'vote', 'the vote at noon', (VOTE_S + 10) * 1000);
    await finish(run, { vote: 'thank', farewell: 'kind' }, BOOK_REWARD_SATS);
    expect([...run.client.state.marks]).toEqual(expect.arrayContaining(['clueThreshold', 'readTogether', 'clueTogether', 'clueNoNames', 'thankedGuardians', 'kindGlass']));
    expect(['handsNone', 'handsSome'].filter((m) => run.client.state.marks.includes(m))).toHaveLength(1);
  }, 120_000);

  it('calls the vote early once four guardians are alone with a letter, and starts the hall clock again', () => {
    const state = new MissionState();
    for (let i = 0; i < BOOK_POSTS.length; i++) state.spots.push(new MissionSpot());
    const notes: { text: string }[] = [];
    const crew = [{ id: 'rook', player: { ...READING_TABLE }, caughtUntil: 0 }] as unknown as CrewMember[];
    const ctx = { ...fakeContext(state, crew), act: BOOK_ACT, broadcast: (_: string, payload: unknown) => notes.push(payload as { text: string }) };
    const rules = new BookRules();
    rules.setup(ctx);
    expect(state.spots.every((s) => s.done)).toBe(true);
    state.step = 'letters';
    rules.onStep(ctx, 'letters');
    expect(state.clock).toBe(VOTE_S);
    for (let now = 0; now < VOTE_S * 1000 && rules.recalled === 0; now += 50) {
      rules.move(ctx, now);
      rules.tick(ctx);
    }
    expect(rules.recalled).toBe(1);
    expect(notes.filter((n) => n.text.includes('alone with a letter too long'))).toHaveLength(MOTION_NEEDED);
    expect(notes.at(-1)).toEqual({ text: BOOK_RECALLED });
    expect(state.step).toBe('letters');
    expect(state.clock).toBe(VOTE_S);
    expect(state.spots.every((s) => s.done)).toBe(true);
    expect([...state.npcs.entries()].filter(([id, n]) => id.startsWith('letter') && n.shown)).toEqual([]);
  });

  it('gives each of the crew one letter at a time, reads it at the table, and puts it back if they leave', () => {
    const state = new MissionState();
    for (let i = 0; i < BOOK_POSTS.length; i++) state.spots.push(new MissionSpot());
    const marks: string[] = [];
    const rook = { id: 'rook', player: { ...READING_TABLE }, caughtUntil: 0 } as unknown as CrewMember;
    const crew = [rook];
    const ctx = { ...fakeContext(state, crew), act: BOOK_ACT, mark: (m: string) => marks.push(m) };
    const rules = new BookRules();
    rules.setup(ctx);
    state.step = 'letters';
    rules.onStep(ctx, 'letters');
    let now = 0;
    const until = (done: () => boolean): void => {
      for (; now < VOTE_S * 1000 && !done(); now += 50) rules.move(ctx, now);
    };
    until(() => state.spots.some((s) => !s.done));
    const first = state.spots.findIndex((s) => !s.done);
    expect(rules.refuse(ctx, first, rook)).toBeNull();
    expect(rules.worked(ctx, first, rook)).toBe(POST_NOTES[first]);
    const player = rook.player as { x: number; y: number };
    player.x = READING_TABLE.x + 6;
    until(() => state.spots.filter((s) => !s.done).length > 0);
    expect(state.npcs.get(`letter${String(first)}`)?.x).toBe(player.x);
    expect(rules.refuse(ctx, state.spots.findIndex((s) => !s.done), rook)).toBe(BOOK_HANDS_FULL);
    player.x = READING_TABLE.x;
    rules.move(ctx, now);
    expect(rules.read).toBe(1);
    expect(marks).toEqual(['clueTogether']);
    const second = state.spots.findIndex((s) => !s.done);
    rules.worked(ctx, second, rook);
    player.x = READING_TABLE.x + 6;
    crew.length = 0;
    rules.move(ctx, now);
    expect(state.spots[second]?.done).toBe(false);
    until(() => state.step === 'vote');
    expect(state.step).toBe('vote');
    rules.onStep(ctx, 'vote');
    expect(marks.filter((m) => m === 'handsNone' || m === 'handsSome')).toHaveLength(1);
  });
});
