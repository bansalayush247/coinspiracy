import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client, type SeatReservation } from '@colyseus/sdk';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CLOSE_CODES, ROOM_LOOKUP_PATH, RoomLookupSchema, type JoinOptions } from '@byzantine-council/shared';
import { CitadelState } from '@byzantine-council/shared/state';
import { createScaling } from '../../src/scaling/index.js';
import { COLYSEUS_KEY_PREFIX, NetworkKeys, rateKey } from '../../src/scaling/keys.js';
import { parseRedisUrl, redisOptions } from '../../src/scaling/redis.js';
import { ORIGIN, freshIp, waitFor, type CitadelTestRoom } from '../helpers.js';

const REDIS_URL = process.env['REDIS_URL'] ?? '';
const PORTS = [3881, 3882] as const;
const SECRET = randomBytes(36).toString('base64url');
const ReservationSchema = z.looseObject({ name: z.string(), roomId: z.string(), processId: z.string(), sessionId: z.string(), publicAddress: z.string().optional() });

const address = (port: number): string => `127.0.0.1:${String(port)}`;

function sdkAt(port: number, ip: string = freshIp()): Client {
  return new Client(`ws://${address(port)}`, { headers: { Origin: ORIGIN, 'X-Real-IP': ip } });
}

async function reserve(port: number, method: 'create' | 'joinById' | 'joinOrCreate', target: string, options: JoinOptions, ip: string) {
  const res = await fetch(`http://${address(port)}/matchmake/${method}/${target}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: ORIGIN, 'X-Real-IP': ip },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error(`matchmake ${method} answered ${String(res.status)}`);
  const body: unknown = await res.json();
  const parsed = ReservationSchema.parse(body);
  return { roomId: parsed.roomId, publicAddress: parsed.publicAddress, seat: body as SeatReservation };
}

function startProcess(port: number): ChildProcess {
  const child = fork(fileURLToPath(new URL('../../src/index.ts', import.meta.url)), [], {
    execArgv: ['--import', 'tsx', '--conditions=source'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      PATH: process.env['PATH'] ?? '',
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      ALLOWED_ORIGINS: ORIGIN,
      TRUSTED_PROXIES: '127.0.0.1',
      MAX_SEATS_PER_IP: '2',
      BOTS: 'off',
      BLOCK_HEIGHT_URL: 'off',
      LOG_LEVEL: 'warn',
      REDIS_URL,
      SCALING_KEY_SECRET: SECRET,
      PUBLIC_ADDRESS: address(port),
    },
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[${String(port)}] ${chunk.toString()}`);
  });
  return child;
}

async function healthy(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://${address(port)}/healthz`)).ok;
  } catch {
    return false;
  }
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
  await exited;
  clearTimeout(timer);
}

describe.skipIf(REDIS_URL === '')('scaling on a real Redis', () => {
  const children: ChildProcess[] = [];
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(redisOptions(parseRedisUrl(REDIS_URL), 'commands'));
    await redis.connect();
    for (const port of PORTS) children.push(startProcess(port));
    for (const port of PORTS) {
      const start = Date.now();
      while (!(await healthy(port))) {
        if (Date.now() - start > 30_000) throw new Error(`process on ${String(port)} never became healthy`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }, 45_000);

  afterAll(async () => {
    await Promise.all(children.map(stopProcess));
    redis.disconnect();
  }, 20_000);

  it('shares rate limits and seat counts between two scaling instances', async () => {
    const a = createScaling({ redisUrl: REDIS_URL, keySecret: SECRET, timing: { beatMs: 1_000, startTimeoutMs: 10_000 } });
    const b = createScaling({ redisUrl: REDIS_URL, keySecret: SECRET, timing: { beatMs: 1_000, startTimeoutMs: 10_000 } });
    await Promise.all([a.start(), b.start()]);
    const ip = freshIp();
    const limitA = a.rateLimiter('realTest', 2, 60_000);
    const limitB = b.rateLimiter('realTest', 2, 60_000);
    expect([await limitA.take(ip), await limitB.take(ip), await limitA.take(ip)]).toEqual([true, true, false]);
    const ttl = await redis.pttl(rateKey('realTest', new NetworkKeys(SECRET).token(ip)));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
    const seatsA = a.seatCounter(1);
    const seatsB = b.seatCounter(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await seatsA.tryAcquire(ip)).toBe(true);
    expect(await seatsB.tryAcquire(ip)).toBe(false);
    seatsA.release(ip);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await seatsB.tryAcquire(ip)).toBe(true);
    seatsB.release(ip);
    limitA.stop();
    limitB.stop();
    for (const scaling of [a, b]) {
      scaling.presence.shutdown();
      await scaling.driver.shutdown();
      await scaling.stop();
    }
  });

  it('creates a room by code on one process and joins it from the other', async () => {
    const owners = new Map<string, { roomId: string; code: string; port: number; host: CitadelTestRoom }>();
    for (let i = 0; i < 8 && owners.size < PORTS.length; i++) {
      const port = PORTS[i % PORTS.length] ?? PORTS[0];
      const ip = freshIp();
      const reservation = await reserve(port, 'create', 'citadel', { nickname: `Host${String(i)}`, private: true }, ip);
      const host: CitadelTestRoom = await sdkAt(port, ip).consumeSeatReservation(reservation.seat, CitadelState);
      await waitFor(() => host.state.code !== '', 'room code');
      const owner = reservation.publicAddress ?? address(port);
      if (owners.has(owner)) await host.leave();
      else owners.set(owner, { roomId: reservation.roomId, code: host.state.code, port, host });
    }
    expect([...owners.keys()].sort()).toEqual(PORTS.map(address).sort());
    for (const [owner, room] of owners) {
      const other = PORTS.find((p) => address(p) !== owner) ?? PORTS[0];
      const lookup = await fetch(`http://${address(other)}${ROOM_LOOKUP_PATH}/${room.code}`, { headers: { 'X-Real-IP': freshIp() } });
      expect(lookup.status).toBe(200);
      expect(RoomLookupSchema.parse(await lookup.json()).roomId).toBe(room.roomId);
      const ip = freshIp();
      const reservation = await reserve(other, 'joinById', room.roomId, { nickname: 'Guest' }, ip);
      expect(reservation.publicAddress).toBe(owner);
      const guest: CitadelTestRoom = await sdkAt(other, ip).consumeSeatReservation(reservation.seat, CitadelState);
      await waitFor(() => guest.state.players.size === 2 && room.host.state.players.size === 2, 'guest seen on both sides', 8_000);
      const keys = await redis.exists(`${COLYSEUS_KEY_PREFIX}code:${room.code}`, `${COLYSEUS_KEY_PREFIX}roomcaches`);
      expect(keys).toBe(2);
      expect(await redis.ttl(`${COLYSEUS_KEY_PREFIX}code:${room.code}`)).toBeGreaterThan(0);
      await guest.leave();
    }
    for (const room of owners.values()) await room.host.leave();
  }, 40_000);

  it('caps seats per network across both processes', async () => {
    const ip = freshIp();
    const first = await sdkAt(PORTS[0], ip).joinOrCreate('citadel', { nickname: 'Same1' }, CitadelState);
    const second = await sdkAt(PORTS[1], ip).create('citadel', { nickname: 'Same2', private: true }, CitadelState);
    const third = sdkAt(PORTS[1], ip).joinOrCreate('citadel', { nickname: 'Same3' }, CitadelState);
    await expect(third).rejects.toMatchObject({ code: CLOSE_CODES.TOO_MANY_CONNECTIONS });
    await first.leave();
    await second.leave();
  }, 20_000);
});
