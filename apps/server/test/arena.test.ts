import type { Room } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ArenaRefusedSchema, PEAKS, REEF, ROUTE_EDGES, ROUTE_PATHS, SABOTAGE_TIMING, SERVER_MESSAGES, TaskOpenedSchema, isValidRoute, stationCenter, type JoinOptions } from '@byzantine-council/shared';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../src/profile/store.js';
import { COOKIE_NAME, newProfileId, signCookie, type SessionKeys } from '../src/profile/session.js';
import { createRoom, joinRoom, quickMatch, sdk, startServer, waitFor, type CitadelTestRoom } from './helpers.js';

const PORT = 3895;
const keys: SessionKeys = { current: Buffer.from('r'.repeat(32)), previous: null, secure: false };

// Profiles whose ids are in `reefers` arrive with twelve Academy stars, which opens Lightning Reef.
const reefers = new Set<string>();
class ReefStore extends MemoryProfileStore {
  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) =>
      fn(reefers.has(id) ? { ...data, progress: { ...data.progress, academy: data.progress.academy.map((_, i) => (i < 4 ? 3 : 0)) } } : data),
    );
  }
}

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  // Sabotage is ready at once, so the Peaks test can cut the network straight away.
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: 64, profiles: { store: new ReefStore(), keys }, sabotageTiming: { ...SABOTAGE_TIMING, openingMs: 0 } }));
});

afterEach(async () => {
  await colyseus.cleanup();
  reefers.clear();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function cookieFor(reef: boolean): string {
  const id = newProfileId();
  if (reef) reefers.add(id);
  return `${COOKIE_NAME}=${signCookie(keys, id, Date.now())}`;
}

function client(cookie?: string) {
  return sdk(PORT, cookie === undefined ? {} : { Cookie: cookie });
}

function create(options: JoinOptions, cookie?: string): Promise<CitadelTestRoom> {
  return createRoom(client(cookie), options);
}

function join(roomId: string, options: JoinOptions, cookie?: string): Promise<CitadelTestRoom> {
  return joinRoom(client(cookie), roomId, options);
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

async function refusal(room: CitadelTestRoom, arena: 'citadel' | 'reef'): Promise<string> {
  const reply = next(room, SERVER_MESSAGES.ARENA_REFUSED);
  room.send('setArena', { arena });
  return ArenaRefusedSchema.parse(await reply).reason;
}

describe('choosing the arena', () => {
  it('keeps Lightning Reef locked until someone in the room has opened it', async () => {
    const host = await create({ nickname: 'Host', private: true }, cookieFor(false));
    await waitFor(() => host.state.players.size === 1, 'host seated');
    expect(host.state.arena).toBe('citadel');
    expect(await refusal(host, 'reef')).toBe('locked');
    expect(host.state.arena).toBe('citadel');
  });

  it('opens it for the whole room when a guest who opened it joins, and moves everyone to the reef square', async () => {
    const host = await create({ nickname: 'Host', private: true }, cookieFor(false));
    const friend = await join(host.roomId, { nickname: 'Reefer' }, cookieFor(true));
    await waitFor(() => host.state.reefOpen, 'reef opened by the friend');
    // Only the host may pick.
    expect(await refusal(friend, 'reef')).toBe('notHost');
    host.send('setArena', { arena: 'reef' });
    await waitFor(() => host.state.arena === 'reef', 'arena changed');
    for (const room of [host, friend]) {
      const me = room.state.players.get(room.sessionId);
      const spawn = REEF.spawns[me?.seat ?? -1];
      expect(me?.x).toBeCloseTo(spawn?.x ?? NaN, 5);
      expect(me?.y).toBeCloseTo(spawn?.y ?? NaN, 5);
    }
    // When the only guest who opened it leaves, the lobby goes back to the Citadel.
    await friend.leave();
    await waitFor(() => host.state.arena === 'citadel' && !host.state.reefOpen, 'back to the citadel');
  });

  it('never changes a quick-match room, and only in the lobby', async () => {
    const host = await quickMatch(client(cookieFor(true)), { nickname: 'Quick' });
    await waitFor(() => host.state.reefOpen, 'reef open');
    expect(await refusal(host, 'reef')).toBe('notPrivate');
    expect(host.state.arena).toBe('citadel');
  });

  it('plays the match on the reef: spawns, stations and hard gateway routes', async () => {
    const host = await create({ nickname: 'Host', private: true }, cookieFor(true));
    await waitFor(() => host.state.reefOpen, 'reef open');
    const rooms = [host];
    for (let i = 1; i < 5; i++) rooms.push(await join(host.roomId, { nickname: `Guardian ${String(i)}` }, cookieFor(false)));
    await waitFor(() => rooms.every((r) => r.state.players.size === 5), 'everyone synced');
    host.send('setArena', { arena: 'reef' });
    await waitFor(() => rooms.every((r) => r.state.arena === 'reef'), 'reef chosen');
    host.send('startMatch');
    await waitFor(() => rooms.every((r) => r.state.phase === 'playing'), 'match started');
    expect(await refusal(host, 'citadel')).toBe('notLobby');
    // A Citadel station spot is out of range on the reef: the server checks the reef's stations.
    const me = host.state.players.get(host.sessionId);
    expect(me).toBeDefined();
    const refused = next(host, SERVER_MESSAGES.TASK_REFUSED);
    host.send('openTask', { kind: 'route' });
    expect(await refused).toMatchObject({ reason: 'outOfRange' });
    // Walk to the reef's gateway harbour along the planks, then open the route task there.
    const goal = stationCenter('route', REEF.stations);
    expect(goal.x).toBeGreaterThan(20);
    const opened = await walkAndOpen(host, 'route');
    const challenge = TaskOpenedSchema.parse(opened).challenge;
    if (challenge.kind !== 'route') throw new Error('expected a route');
    // Reef routes are hard: the one working path has 5 sats to spare at most.
    const path = ROUTE_PATHS.find((p) => isValidRoute(challenge, p)) ?? [];
    const caps = path.slice(1).map((to, i) => challenge.capacities[ROUTE_EDGES.findIndex(([a, b]) => (a === path[i] && b === to) || (b === path[i] && a === to))] ?? 0);
    expect(Math.min(...caps) - challenge.amount).toBeLessThanOrEqual(5);
  }, 30_000);
});

describe('Watchtower Peaks', () => {
  it('is offered to a room where someone opened it, and a partition takes its bridges down', async () => {
    const host = await create({ nickname: 'Host', private: true }, cookieFor(true));
    await waitFor(() => host.state.peaksOpen, 'peaks open');
    const rooms = [host];
    for (let i = 1; i < 5; i++) rooms.push(await join(host.roomId, { nickname: `Climber ${String(i)}` }, cookieFor(false)));
    await waitFor(() => rooms.every((r) => r.state.players.size === 5), 'everyone synced');
    host.send('setArena', { arena: 'peaks' });
    await waitFor(() => rooms.every((r) => r.state.arena === 'peaks'), 'peaks chosen');
    host.send('setTier', { tier: 'full' });
    await waitFor(() => rooms.every((r) => r.state.tier === 'full'), 'full rules picked');
    host.send('startMatch');
    await waitFor(() => rooms.every((r) => r.state.players.get(r.sessionId)?.role !== undefined), 'roles dealt');
    const byz = rooms.find((r) => r.state.players.get(r.sessionId)?.role === 'byzantine');
    const climber = rooms.find((r) => r.state.players.get(r.sessionId)?.role === 'honest');
    if (byz === undefined || climber === undefined) throw new Error('roles');
    byz.send('partition');
    await waitFor(() => climber.state.partition > 0, 'network cut', 5000);
    // Head north from Summit Square toward the Ledger Crag: the bridge between them is down.
    const me = (): { x: number; y: number } => {
      const p = climber.state.players.get(climber.sessionId);
      return { x: p?.x ?? 0, y: p?.y ?? 0 };
    };
    const { steerInput } = await import('@byzantine-council/shared/pathfinding');
    let seq = 0;
    const push = async (to: { x: number; y: number }, ticks: number): Promise<void> => {
      for (let i = 0; i < ticks; i++) {
        const dir = steerInput(me(), to);
        seq += 1;
        climber.send('move', { seq, dx: dir.x, dy: dir.y });
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    // Up the middle of the bridge between Summit Square and the Ledger Crag.
    const bridge = PEAKS.cutBridges[1];
    if (bridge === undefined) throw new Error('peaks must cut');
    const x = (bridge.c0 + bridge.c1 + 1) / 2;
    const below = { x, y: bridge.r1 + 2 };
    const above = { x, y: bridge.r0 - 2 };
    await push(below, 60);
    await push(above, 60);
    expect(me().y).toBeGreaterThan(bridge.r1);
    // The same walk is open on the whole map, so it was the cut that stopped them.
    const { findPath } = await import('@byzantine-council/shared/pathfinding');
    const cut = PEAKS.partitionMap;
    if (cut === null) throw new Error('peaks must cut');
    expect(findPath(PEAKS.map, below, above).ok).toBe(true);
    expect(findPath(cut, below, above).ok).toBe(false);
    expect(cut.rows[bridge.r0]?.[bridge.c0]).toBe('^');
  }, 30_000);
});

// Steers a guardian with move inputs along a planned path, then opens a task at the station.
async function walkAndOpen(room: CitadelTestRoom, kind: 'route'): Promise<unknown> {
  const { findPathNear, steerInput } = await import('@byzantine-council/shared/pathfinding');
  const { STATION_PROMPT_RANGE } = await import('@byzantine-council/shared');
  const me = (): { x: number; y: number } => {
    const p = room.state.players.get(room.sessionId);
    return { x: p?.x ?? 0, y: p?.y ?? 0 };
  };
  const route = findPathNear(REEF.map, me(), stationCenter(kind, REEF.stations), STATION_PROMPT_RANGE - 0.2);
  if (!route.ok) throw new Error('no path to the station');
  let seq = 0;
  for (const point of route.value) {
    for (let i = 0; i < 200 && Math.hypot(me().x - point.x, me().y - point.y) > 0.15; i++) {
      const dir = steerInput(me(), point);
      seq += 1;
      room.send('move', { seq, dx: dir.x, dy: dir.y });
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const reply = next(room, SERVER_MESSAGES.TASK_OPENED, 5000);
  room.send('openTask', { kind });
  return reply;
}
