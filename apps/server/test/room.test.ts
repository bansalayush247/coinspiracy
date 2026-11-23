import { CloseCode } from '@colyseus/core';
import { MatchMakeError, type Room } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import {
  CLOSE_CODES,
  MAX_PLAYERS,
  ROOM_LOOKUP_PATH,
  ROOM_NAME,
  RoomLookupSchema,
  SPAWN_POINTS,
  TICK_SECONDS,
  formatRoomCode,
  stepMovement,
  type Vec2,
} from '@byzantine-council/shared';
import type { CitadelState } from '@byzantine-council/shared/state';
import type { CitadelRoom } from '../src/CitadelRoom.js';
import { ipKey } from '../src/clientIp.js';
import { roomPolicy } from '../src/policy.js';
import {
  createRoom,
  freshIp,
  leaveCode,
  quickMatch,
  sdk,
  sleep,
  startServer,
  waitFor,
  type CitadelTestRoom,
} from './helpers.js';

const PORT = 3861;
const SHARED_IP = '203.0.113.77';
const MAX_SEATS_PER_IP = 3;
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { maxSeatsPerIp: MAX_SEATS_PER_IP, reconnectSeconds: 5 }));
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

const client = (headers: Record<string, string> = {}) => sdk(PORT, headers);

function serverRoom(room: Room): CitadelRoom {
  return colyseus.getRoomById<CitadelRoom>(room.roomId);
}

function player(room: CitadelTestRoom, sessionId: string) {
  const p = room.state.players.get(sessionId);
  if (p === undefined) throw new Error(`player ${sessionId} missing`);
  return p;
}

// Replays inputs with the shared movement code, exactly as the server and client do.
function replay(from: Vec2, inputs: readonly Vec2[]): Vec2 {
  return inputs.reduce((pos, dir) => stepMovement(pos, dir, TICK_SECONDS), from);
}

async function lookup(code: string, ip = freshIp()): Promise<Response> {
  return fetch(`http://127.0.0.1:${String(PORT)}${ROOM_LOOKUP_PATH}/${encodeURIComponent(code)}`, {
    headers: { 'X-Real-IP': ip },
  });
}

describe('quick match', () => {
  it('seats two players in one room with distinct seats, spawn points and a host', async () => {
    const alice = await quickMatch(client(), { nickname: 'Alice' });
    const bob = await quickMatch(client(), { nickname: 'Bob' });
    expect(bob.roomId).toBe(alice.roomId);
    await waitFor(() => bob.state.players.size === 2 && alice.state.players.size === 2, 'both players synced');

    const a = player(bob, alice.sessionId);
    const b = player(bob, bob.sessionId);
    expect([a.name, a.seat, a.status]).toStrictEqual(['Alice', 0, 'active']);
    expect([b.name, b.seat]).toStrictEqual(['Bob', 1]);
    expect({ x: a.x, y: a.y }).toStrictEqual(SPAWN_POINTS[0]);
    expect({ x: b.x, y: b.y }).toStrictEqual(SPAWN_POINTS[1]);
    expect(bob.state.hostId).toBe(alice.sessionId);
    expect(bob.state.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(bob.state.isPrivate).toBe(false);
    expect(bob.state.phase).toBe('lobby');
  });

  it('gives a repeated nickname a number so every name in the room is distinct', async () => {
    const first = await quickMatch(client(), { nickname: 'Satoshi' });
    const second = await quickMatch(client(), { nickname: 'satoshi' });
    await waitFor(() => first.state.players.size === 2, 'second player synced');
    expect(player(first, second.sessionId).name).toBe('satoshi 2');
  });

  it('rejects an invalid nickname before any seat is reserved', async () => {
    await expect(quickMatch(client(), { nickname: 'x' })).rejects.toBeInstanceOf(MatchMakeError);
    await expect(quickMatch(client(), { nickname: 'admin' })).rejects.toBeInstanceOf(MatchMakeError);
    await expect(
      client().joinOrCreate(ROOM_NAME, { nickname: 'Valid', admin: true }),
    ).rejects.toBeInstanceOf(MatchMakeError);
  });

  it('opens a new room once one is full', async () => {
    const rooms = [];
    for (let i = 0; i < MAX_PLAYERS; i++) rooms.push(await quickMatch(client(), { nickname: `Guardian ${String(i)}` }));
    expect(new Set(rooms.map((r) => r.roomId)).size).toBe(1);
    const late = await quickMatch(client(), { nickname: 'Latecomer' });
    expect(late.roomId).not.toBe(rooms[0]?.roomId);
    const full = rooms[0];
    if (full === undefined) throw new Error('no room');
    await waitFor(() => full.state.code !== '', 'code synced');
    const res = await lookup(full.state.code);
    expect(res.status).toBe(409);
  });

  it('gives a freed seat to the next player', async () => {
    const alice = await quickMatch(client(), { nickname: 'Alice' });
    const bob = await quickMatch(client(), { nickname: 'Bob' });
    await waitFor(() => alice.state.players.size === 2, 'bob synced');
    await alice.leave();
    await waitFor(() => bob.state.players.size === 1, 'alice removed');
    const cara = await quickMatch(client(), { nickname: 'Cara' });
    await waitFor(() => bob.state.players.size === 2, 'cara synced');
    expect(player(bob, cara.sessionId).seat).toBe(0);
  });

  it('hands the host role to the next player when the host leaves', async () => {
    const alice = await quickMatch(client(), { nickname: 'Alice' });
    const bob = await quickMatch(client(), { nickname: 'Bob' });
    const cara = await quickMatch(client(), { nickname: 'Cara' });
    await waitFor(() => cara.state.players.size === 3, 'all synced');
    expect(cara.state.hostId).toBe(alice.sessionId);
    await alice.leave();
    await waitFor(() => cara.state.hostId === bob.sessionId, 'host moved to bob');
  });
});

describe('movement', () => {
  it('applies moves in order with the shared rules and acks them to the mover only', async () => {
    const alice = await quickMatch(client(), { nickname: 'Alice' });
    const bob = await quickMatch(client(), { nickname: 'Bob' });
    await waitFor(() => bob.state.players.size === 2 && alice.state.players.size === 2, 'synced');
    const start = { x: player(alice, alice.sessionId).x, y: player(alice, alice.sessionId).y };
    const dirs = [
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -0.6, y: 0.8 },
      { x: 0, y: -1 },
    ];
    dirs.forEach((d, i) => {
      alice.send('move', { seq: i + 1, dx: d.x, dy: d.y });
    });
    await waitFor(() => player(alice, alice.sessionId).ack === dirs.length, 'all moves acked');
    const expected = replay(start, dirs);
    await waitFor(() => player(bob, alice.sessionId).x === expected.x, 'bob sees the final x');
    expect({ x: player(alice, alice.sessionId).x, y: player(alice, alice.sessionId).y }).toStrictEqual(expected);
    expect(player(bob, alice.sessionId).y).toBe(expected.y);
    // The ack is an owner-only field.
    expect(player(bob, alice.sessionId).ack).toBeUndefined();
    expect(player(alice, bob.sessionId).ack).toBeUndefined();
    expect(player(bob, bob.sessionId).ack).toBe(0);
  });

  it('ignores a replayed sequence number', async () => {
    const alice = await quickMatch(client(), { nickname: 'Alice' });
    await waitFor(() => alice.state.players.size === 1, 'synced');
    const start = { x: player(alice, alice.sessionId).x, y: player(alice, alice.sessionId).y };
    alice.send('move', { seq: 7, dx: 1, dy: 0 });
    alice.send('move', { seq: 7, dx: 1, dy: 0 });
    alice.send('move', { seq: 3, dx: 1, dy: 0 });
    await waitFor(() => player(alice, alice.sessionId).ack === 7, 'seq 7 acked');
    await sleep(200);
    expect(player(alice, alice.sessionId).x).toBe(replay(start, [{ x: 1, y: 0 }]).x);
  });

  it('caps a burst of inputs instead of moving the sender faster', async () => {
    const alice = await quickMatch(client(), { nickname: 'Alice' });
    await waitFor(() => alice.state.players.size === 1, 'synced');
    const start = { x: player(alice, alice.sessionId).x, y: player(alice, alice.sessionId).y };
    for (let seq = 1; seq <= 30; seq++) alice.send('move', { seq, dx: 0, dy: 1 });
    await sleep(800);
    // Only the first eight fit the queue; the rest are refused, never applied, but still acked
    // so the sender's prediction drops them instead of waiting forever.
    expect(player(alice, alice.sessionId).ack).toBe(30);
    const expected = replay(start, Array.from({ length: 8 }, () => ({ x: 0, y: 1 })));
    expect(player(alice, alice.sessionId).y).toBe(expected.y);
  });

  it('stops a player at walls exactly as the shared rules do', async () => {
    const alice = await quickMatch(client(), { nickname: 'Alice' });
    await waitFor(() => alice.state.players.size === 1, 'synced');
    const start = { x: player(alice, alice.sessionId).x, y: player(alice, alice.sessionId).y };
    // Walk north long enough to hit the building line.
    const dirs = Array.from({ length: 8 }, () => ({ x: 0, y: -1 }));
    for (let round = 0; round < 6; round++) {
      dirs.forEach((d, i) => {
        alice.send('move', { seq: round * 8 + i + 1, dx: d.x, dy: d.y });
      });
      await waitFor(() => player(alice, alice.sessionId).ack === round * 8 + 8, `round ${String(round)} acked`);
    }
    const expected = replay(start, Array.from({ length: 48 }, () => ({ x: 0, y: -1 })));
    expect(player(alice, alice.sessionId).y).toBe(expected.y);
    expect(player(alice, alice.sessionId).y).toBeGreaterThan(0);
  });

  it('disconnects a client whose move fails the shared schema', async () => {
    const mallory = await quickMatch(client(), { nickname: 'Mallory' });
    const code = leaveCode(mallory);
    mallory.send('move', { seq: 1, dx: 99, dy: 0 });
    expect(await code).toBe(CloseCode.WITH_ERROR);
  });

  it('disconnects a client that leaves out the sequence number', async () => {
    const mallory = await quickMatch(client(), { nickname: 'Mallory' });
    const code = leaveCode(mallory);
    mallory.send('move', { dx: 1, dy: 0 });
    expect(await code).toBe(CloseCode.WITH_ERROR);
  });

  it('disconnects a client that sends a message type the room does not handle', async () => {
    const mallory = await quickMatch(client(), { nickname: 'Mallory' });
    const code = leaveCode(mallory);
    mallory.send('teleport', { x: 1, y: 1 });
    expect(await code).toBe(CloseCode.WITH_ERROR);
  });
});

describe('private rooms and codes', () => {
  it('keeps a private room out of quick match but lets a friend in with its code', async () => {
    const host = await createRoom(client(), { nickname: 'Host', private: true });
    await waitFor(() => host.state.code !== '', 'code synced');
    expect(host.state.isPrivate).toBe(true);
    const stranger = await quickMatch(client(), { nickname: 'Stranger' });
    expect(stranger.roomId).not.toBe(host.roomId);

    // Friends type codes in any case and with or without the dash.
    const res = await lookup(formatRoomCode(host.state.code).toLowerCase());
    expect(res.status).toBe(200);
    const reply = RoomLookupSchema.parse(await res.json());
    expect(reply).toStrictEqual({ roomId: host.roomId, players: 1, maxPlayers: MAX_PLAYERS });
    const friend = await client().joinById<CitadelState>(reply.roomId, { nickname: 'Friend' });
    expect(friend.roomId).toBe(host.roomId);
  });

  it('answers unknown and malformed codes without revealing anything', async () => {
    expect((await lookup('ABCDEF')).status).toBe(404);
    expect((await lookup('ABC')).status).toBe(400);
    expect((await lookup('ABCDE0')).status).toBe(400);
    expect((await lookup('x'.repeat(200))).status).toBe(400);
  });

  it('frees the code when the room closes', async () => {
    const host = await createRoom(client(), { nickname: 'Host', private: true });
    await waitFor(() => host.state.code !== '', 'code synced');
    const code = host.state.code;
    await host.leave();
    await sleep(150);
    expect((await lookup(code)).status).toBe(404);
  });

  it('rate-limits code lookups per network', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await lookup('ABCDEF', ip)).status);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect((await lookup('ABCDEF')).status).toBe(404);
  });
});

describe('connections', () => {
  it('holds the seat across an unexpected drop and reconnects the same session', async () => {
    const alice = await quickMatch(client(), { nickname: 'Wobbly' });
    alice.reconnection.minUptime = 0;
    const bob = await quickMatch(client(), { nickname: 'Watcher' });
    await waitFor(() => bob.state.players.size === 2, 'synced');
    const room = serverRoom(alice);
    const sessionId = alice.sessionId;
    const reconnected = new Promise<void>((resolve) => {
      alice.onReconnect(() => {
        resolve();
      });
    });
    (room.clients.get(sessionId)?.ref as WebSocket | undefined)?.terminate();
    await waitFor(() => player(bob, sessionId).status === 'disconnected', 'bob sees the drop');
    await reconnected;
    expect(alice.sessionId).toBe(sessionId);
    await waitFor(() => player(bob, sessionId).status === 'active', 'bob sees the return');
    expect(player(bob, sessionId).seat).toBe(0);
    // Moves work again with a fresh sequence after the reconnect.
    alice.send('move', { seq: 1, dx: 1, dy: 0 });
    await waitFor(() => player(alice, sessionId).ack === 1, 'move after reconnect acked');
  });

  it('kicks with an app close code and refuses the kicked token', async () => {
    const bystander = await quickMatch(client(), { nickname: 'Bystander' });
    const target = await quickMatch(client(), { nickname: 'Target' });
    expect(target.roomId).toBe(bystander.roomId);
    await waitFor(() => target.state.players.size === 2, 'synced');
    const room = serverRoom(target);
    const token = target.reconnectionToken;
    const code = leaveCode(target);
    const serverClient = room.clients.get(target.sessionId);
    if (serverClient === undefined) throw new Error('server client missing');
    room.kick(serverClient, CLOSE_CODES.KICKED, 'Removed by the server.');
    expect(await code).toBe(CLOSE_CODES.KICKED);
    await waitFor(() => bystander.state.players.size === 1, 'target removed');
    await expect(client().reconnect(token)).rejects.toMatchObject({ code: 524 });
  });

  it('closes only the broken room when its step loop throws', async () => {
    const unlucky = await quickMatch(client(), { nickname: 'Unlucky' });
    await waitFor(() => unlucky.state.players.size === 1, 'synced');
    const code = leaveCode(unlucky);
    // Fault injection: a non-finite position makes the shared movement code throw mid-step.
    const p = serverRoom(unlucky).state.players.get(unlucky.sessionId);
    if (p === undefined) throw new Error('player missing');
    p.x = Number.NaN;
    unlucky.send('move', { seq: 1, dx: 1, dy: 0 });
    expect(await code).toBe(CLOSE_CODES.ROOM_FAILED);
    const fresh = await quickMatch(client(), { nickname: 'Survivor' });
    expect(fresh.roomId).not.toBe(unlucky.roomId);
  });

  it('refuses WebSocket upgrades from an origin outside the allowlist', async () => {
    const attempt = quickMatch(client({ Origin: 'https://evil.example' }), { nickname: 'Evil' });
    await expect(attempt).rejects.toBeInstanceOf(MatchMakeError);
  });

  it('keeps a dropped player’s held seat counted against their network until they leave', async () => {
    const ip = freshIp();
    const key = ipKey(ip);
    const { ipSlots } = roomPolicy();
    const wobbly = await quickMatch(client({ 'X-Real-IP': ip }), { nickname: 'Wobbly' });
    wobbly.reconnection.enabled = false;
    const watcher = await quickMatch(client(), { nickname: 'Watcher' });
    await waitFor(() => watcher.state.players.size === 2, 'synced');
    expect(await ipSlots.count(key)).toBe(1);
    (serverRoom(wobbly).clients.get(wobbly.sessionId)?.ref as WebSocket | undefined)?.terminate();
    await waitFor(() => player(watcher, wobbly.sessionId).status === 'disconnected', 'drop seen');
    // The socket is gone but the held seat still counts.
    expect(await ipSlots.count(key)).toBe(1);
    // reconnectSeconds is 5 in this file: after the window the seat and its count are released.
    await waitFor(() => watcher.state.players.size === 1, 'seat released', 8000);
    expect(await ipSlots.count(key)).toBe(0);
  });

  it('caps concurrent seats from one network', async () => {
    const rooms = [];
    for (let i = 0; i < MAX_SEATS_PER_IP; i++) {
      rooms.push(await quickMatch(client({ 'X-Real-IP': SHARED_IP }), { nickname: `Home ${String(i)}` }));
    }
    await expect(
      quickMatch(client({ 'X-Real-IP': SHARED_IP }), { nickname: 'One too many' }),
    ).rejects.toMatchObject({ code: CLOSE_CODES.TOO_MANY_CONNECTIONS });
    // Leaving frees a slot for the same network.
    await rooms[0]?.leave();
    await sleep(100);
    const again = await quickMatch(client({ 'X-Real-IP': SHARED_IP }), { nickname: 'Back again' });
    expect(again.sessionId).not.toBe('');
  });
});
