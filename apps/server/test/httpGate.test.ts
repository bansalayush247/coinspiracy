import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { installHttpGate, type HttpGate } from '../src/httpGate.js';

const PORT = 3864;
const ORIGIN = 'http://127.0.0.1:5180';
let server: Server;
let wss: WebSocketServer;
let gate: HttpGate;

beforeAll(async () => {
  server = createServer();
  // Stands in for the Colyseus transport: accepts every upgrade and keeps it open.
  wss = new WebSocketServer({ server });
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  gate = installHttpGate(server, {
    ipPolicy: { trustedProxies: new Set(['127.0.0.1']) },
    allowedOrigins: new Set([ORIGIN]),
    maxMatchmakeBodyBytes: 2048,
    maxSocketsPerIp: 2,
  });
});

afterAll(async () => {
  for (const c of wss.clients) c.terminate();
  wss.close();
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
});

// Resolves with the open socket, or with the HTTP status the upgrade was refused with.
function connect(ip: string): Promise<WebSocket | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(PORT)}/any/room`, { headers: { Origin: ORIGIN, 'X-Real-IP': ip } });
    ws.once('open', () => { resolve(ws); });
    ws.once('unexpected-response', (_req, res) => { resolve(res.statusCode ?? 0); });
    ws.once('error', reject);
  });
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.once('close', () => { resolve(); });
    ws.close();
  });
}

describe('socket cap per network', () => {
  it('refuses upgrades past the cap, per network, and frees the slot when a socket closes', async () => {
    const a = await connect('203.0.113.1');
    const b = await connect('203.0.113.1');
    expect(a).toBeInstanceOf(WebSocket);
    expect(b).toBeInstanceOf(WebSocket);
    expect(await connect('203.0.113.1')).toBe(429);
    expect(gate.openSockets('203.0.113.1')).toBe(2);
    // Another network is unaffected.
    const other = await connect('203.0.113.2');
    expect(other).toBeInstanceOf(WebSocket);
    if (!(a instanceof WebSocket) || !(other instanceof WebSocket)) throw new Error('not connected');
    await closed(a);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gate.openSockets('203.0.113.1')).toBe(1);
    const again = await connect('203.0.113.1');
    expect(again).toBeInstanceOf(WebSocket);
    for (const ws of [b, other, again]) if (ws instanceof WebSocket) await closed(ws);
  });

  it('counts an IPv6 /64 as one network', async () => {
    const a = await connect('2001:db8:1:2::a');
    const b = await connect('2001:db8:1:2::b');
    expect(await connect('2001:db8:1:2::c')).toBe(429);
    for (const ws of [a, b]) if (ws instanceof WebSocket) await closed(ws);
  });
});
