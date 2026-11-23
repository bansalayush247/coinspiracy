import { Client, type Room } from '@colyseus/sdk';
import { ColyseusTestServer } from '@colyseus/testing';
import { ROOM_NAME, type JoinOptions } from '@byzantine-council/shared';
import { CitadelState } from '@byzantine-council/shared/state';
import { createGameServer, type GameServerOptions } from '../src/app.js';

export const ORIGIN = 'http://127.0.0.1:5180';

let ipCounter = 0;
// Each SDK client gets its own address through X-Real-IP, which the test server trusts from loopback.
export function freshIp(): string {
  ipCounter += 1;
  return `198.18.${String(Math.floor(ipCounter / 250))}.${String((ipCounter % 250) + 1)}`;
}

export async function startServer(port: number, overrides: Partial<GameServerOptions> = {}) {
  const game = createGameServer({
    allowedOrigins: new Set([ORIGIN]),
    ipPolicy: { trustedProxies: new Set(['127.0.0.1']) },
    gracefullyShutdown: false,
    ...overrides,
  });
  await game.listen(port, '127.0.0.1');
  return { game, colyseus: new ColyseusTestServer(game.server) };
}

// Node's WebSocket sends no Origin, and the server allowlists Origin, so tests send one.
export function sdk(port: number, headers: Record<string, string> = {}): Client {
  return new Client(`ws://127.0.0.1:${String(port)}`, {
    headers: { Origin: ORIGIN, 'X-Real-IP': freshIp(), ...headers },
  });
}

// Typed by state only, the way the browser client joins; the room type stays the SDK's default.
export function quickMatch(client: Client, options: JoinOptions) {
  return client.joinOrCreate<CitadelState>(ROOM_NAME, options, CitadelState);
}

export function createRoom(client: Client, options: JoinOptions) {
  return client.create<CitadelState>(ROOM_NAME, options, CitadelState);
}

export function joinRoom(client: Client, roomId: string, options: JoinOptions) {
  return client.joinById<CitadelState>(roomId, options, CitadelState);
}

export type CitadelTestRoom = Awaited<ReturnType<typeof quickMatch>>;

export function leaveCode(room: Room): Promise<number> {
  return new Promise((resolve) => {
    room.onLeave((code) => {
      resolve(code);
    });
  });
}

export async function waitFor(check: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
