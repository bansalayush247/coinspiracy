// Scaling settings from the environment. Errors name the variable, never its value.
import { z } from 'zod';
import { MAX_KEY_SECRET_LENGTH, MIN_KEY_SECRET_LENGTH } from './keys.js';
import { isLoopbackHost, parseRedisUrl } from './redis.js';

// host[:port] plus optional path segments, no scheme: what the SDK puts before /<processId>/<roomId>.
const PUBLIC_ADDRESS = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?(?:\/[A-Za-z0-9_-]{1,64}){0,4}$/;

export function isPublicAddress(value: string): boolean {
  if (value.length > 255 || !PUBLIC_ADDRESS.test(value)) return false;
  const port = /^(?:[^/]*\]|[^/:]*):(\d+)/.exec(value)?.[1];
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65_535);
}

const optional = z
  .string()
  .max(4096)
  .transform((v) => v.trim())
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

const EnvSchema = z.object({
  REDIS_URL: optional,
  SCALING_KEY_SECRET: optional,
  PUBLIC_ADDRESS: optional,
});

export interface ScalingConfig {
  // null keeps everything in this process (today's behaviour).
  readonly redisUrl: string | null;
  readonly keySecret: string | null;
  readonly publicAddress: string | undefined;
  readonly production: boolean;
}

function fail(variable: string, problem: string): never {
  throw new Error(`invalid scaling environment: ${variable}: ${problem}`);
}

export function loadScalingConfig(env: NodeJS.ProcessEnv, production: boolean): ScalingConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) fail(parsed.error.issues[0]?.path.join('.') ?? 'environment', 'must be a string of at most 4096 characters');
  const { REDIS_URL: redisUrl, SCALING_KEY_SECRET: keySecret, PUBLIC_ADDRESS: publicAddress } = parsed.data;
  if (publicAddress !== undefined && !isPublicAddress(publicAddress)) {
    fail('PUBLIC_ADDRESS', 'must be host[:port][/path] without a scheme, e.g. game.example.com/s1');
  }
  if (redisUrl === undefined) {
    if (keySecret !== undefined) fail('SCALING_KEY_SECRET', 'is set but REDIS_URL is not');
    return { redisUrl: null, keySecret: null, publicAddress, production };
  }
  let tls = false;
  let loopback = false;
  try {
    const endpoint = parseRedisUrl(redisUrl);
    tls = endpoint.tls;
    loopback = isLoopbackHost(endpoint.host);
  } catch (error) {
    fail('REDIS_URL', error instanceof Error ? error.message.replace(/^REDIS_URL /, '') : 'is invalid');
  }
  // Plain-text Redis would expose its password and every key on the network.
  if (production && !tls && !loopback) fail('REDIS_URL', 'must use rediss:// unless Redis is on loopback');
  if (keySecret === undefined) fail('SCALING_KEY_SECRET', 'is required with REDIS_URL');
  if (keySecret.length < MIN_KEY_SECRET_LENGTH || keySecret.length > MAX_KEY_SECRET_LENGTH) {
    fail('SCALING_KEY_SECRET', `must be ${String(MIN_KEY_SECRET_LENGTH)}-${String(MAX_KEY_SECRET_LENGTH)} characters`);
  }
  // Several processes share Redis, and each must route its own rooms' sockets.
  if (production && publicAddress === undefined) fail('PUBLIC_ADDRESS', 'is required in production with REDIS_URL');
  return { redisUrl, keySecret, publicAddress, production };
}
