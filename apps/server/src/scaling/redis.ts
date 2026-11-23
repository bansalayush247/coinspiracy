// The narrow Redis surface this lane uses, the ioredis adapter, and safe connection settings.
import { isIP } from 'node:net';
import type { Redis, RedisOptions } from 'ioredis';
import { z } from 'zod';

export type RedisArg = string | number;
export type RedisCommand = readonly [name: string, ...args: RedisArg[]];

// Every Redis call the lane makes goes through this, so tests can run it on an in-memory fake.
export interface CommandRunner {
  // MULTI/EXEC: applied atomically; rejects if the transaction or any command in it fails.
  multi(commands: readonly RedisCommand[]): Promise<unknown[]>;
  // Pipelined in order, not atomic; rejects if any command fails.
  pipeline(commands: readonly RedisCommand[]): Promise<unknown[]>;
}

type ExecResult = [error: Error | null, result: unknown][] | null;

function unwrap(results: ExecResult): unknown[] {
  if (results === null) throw new Error('redis transaction aborted');
  return results.map(([error, value]) => {
    if (error !== null) throw error;
    return value;
  });
}

export function ioredisRunner(client: Redis): CommandRunner {
  return {
    multi: async (commands) => unwrap(await client.multi(commands.map((c) => [...c])).exec()),
    pipeline: async (commands) => unwrap(await client.pipeline(commands.map((c) => [...c])).exec()),
  };
}

// HGETALL arrives as an object from ioredis and as a flat list from raw RESP2; both become a Map.
const HashObject = z.record(z.string(), z.string());
const HashList = z.array(z.string()).refine((list) => list.length % 2 === 0, 'odd field list');
export const MAX_HASH_FIELDS = 10_000;

export function parseHash(reply: unknown): Map<string, string> {
  const list = HashList.safeParse(reply);
  const entries: [string, string][] = [];
  if (list.success) {
    for (let i = 0; i + 1 < list.data.length; i += 2) entries.push([list.data[i] ?? '', list.data[i + 1] ?? '']);
  } else {
    entries.push(...Object.entries(HashObject.parse(reply)));
  }
  if (entries.length > MAX_HASH_FIELDS) throw new Error('redis hash too large');
  return new Map(entries);
}

const COUNT_PATTERN = /^\d{1,15}$/;

// A non-negative integer from a reply or a stored string; null for anything else.
export function parseCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && COUNT_PATTERN.test(value)) return Number(value);
  return null;
}

export interface RedisEndpoint {
  readonly host: string;
  readonly port: number;
  readonly db: number;
  readonly tls: boolean;
  readonly username?: string;
  readonly password?: string;
}

// Parsed here, never by ioredis: its URL parser turns query items into client options.
export function parseRedisUrl(raw: string): RedisEndpoint {
  if (raw.length > 2048) throw new Error('REDIS_URL is too long');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('REDIS_URL is not a valid URL');
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') throw new Error('REDIS_URL must use redis:// or rediss://');
  if (url.search !== '' || url.hash !== '') throw new Error('REDIS_URL must not have a query or fragment');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === '') throw new Error('REDIS_URL needs a host');
  const port = url.port === '' ? 6379 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('REDIS_URL port is out of range');
  const dbText = url.pathname.replace(/^\//, '');
  if (dbText !== '' && !/^\d{1,2}$/.test(dbText)) throw new Error('REDIS_URL path must be a database number');
  const db = dbText === '' ? 0 : Number(dbText);
  if (db > 15) throw new Error('REDIS_URL database must be 0-15');
  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error('REDIS_URL credentials are not valid percent-encoding');
  }
  if (username.length > 256 || password.length > 1024) throw new Error('REDIS_URL credentials are too long');
  return {
    host,
    port,
    db,
    tls: url.protocol === 'rediss:',
    ...(username === '' ? {} : { username }),
    ...(password === '' ? {} : { password }),
  };
}

export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  return isIP(host) === 4 && host.startsWith('127.');
}

export type RedisRole = 'commands' | 'presence' | 'driver';

export interface ConnectionTuning {
  // Limit and seat commands give up after this; the caller then uses the local fallback.
  readonly commandTimeoutMs: number;
  readonly connectTimeoutMs: number;
}

export const DEFAULT_TUNING: ConnectionTuning = Object.freeze({ commandTimeoutMs: 500, connectTimeoutMs: 5_000 });

// Reconnects forever with capped backoff: 200 ms, 400 ms, ... up to 2 s.
export function retryDelay(times: number): number {
  return Math.min(100 * 2 ** Math.min(Math.max(times, 1), 5), 2_000);
}

// Lazy: nothing connects until start(). The lane's own client fails fast instead of queueing.
export function redisOptions(endpoint: RedisEndpoint, role: RedisRole, tuning: ConnectionTuning = DEFAULT_TUNING): RedisOptions {
  const base: RedisOptions = {
    host: endpoint.host,
    port: endpoint.port,
    db: endpoint.db,
    ...(endpoint.username === undefined ? {} : { username: endpoint.username }),
    ...(endpoint.password === undefined ? {} : { password: endpoint.password }),
    // Node verifies the certificate against the host name and its CA store (NODE_EXTRA_CA_CERTS for private CAs).
    ...(endpoint.tls ? { tls: {} } : {}),
    connectionName: `bc-${role}`,
    lazyConnect: true,
    connectTimeout: tuning.connectTimeoutMs,
    retryStrategy: retryDelay,
    // Colyseus calls queue briefly across a reconnect, then fail instead of hanging matchmaking.
    maxRetriesPerRequest: 3,
  };
  if (role !== 'commands') return base;
  // A resent INCR would count twice, and an answer after the timeout is no longer wanted.
  return { ...base, enableOfflineQueue: false, commandTimeout: tuning.commandTimeoutMs, autoResendUnfulfilledCommands: false, maxRetriesPerRequest: 0 };
}

// The class name of an error, for logs: never its message, which can carry command arguments.
export function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : 'NonError';
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : 'Error';
}
