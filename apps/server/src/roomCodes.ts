// Room codes: six-character invites mapped to room ids through presence, so every process can resolve them.
import { LocalPresence, type Presence } from '@colyseus/core';
import { generateRoomCode, isRoomCode } from '@byzantine-council/shared';
import { log } from './logger.js';
import { errorName } from './scaling/redis.js';

const CLAIMS = 'claims';
const ROOM = 'room';
const MAX_ATTEMPTS = 8;
const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** How long a code on shared presence (Redis) outlives its last refresh, so a crashed process's codes free themselves. */
export const ROOM_CODE_TTL_SECONDS = 15 * 60;
/** How often this process refreshes the codes its rooms hold on shared presence. */
export const ROOM_CODE_REFRESH_MS = 60_000;

// Only a validated code ever becomes part of a key.
function codeKey(code: string): string {
  if (!isRoomCode(code)) throw new RangeError('not a room code');
  return `code:${code}`;
}

// In-process presence dies with the process; shared presence must expire on its own.
function expiring(presence: Presence): boolean {
  return !(presence instanceof LocalPresence);
}

interface Held {
  readonly presence: Presence;
  readonly roomId: string;
}

const held = new Map<string, Held>();
let timer: NodeJS.Timeout | null = null;
let refreshing = false;

function track(code: string, entry: Held): void {
  held.set(code, entry);
  if (timer !== null) return;
  timer = setInterval(() => {
    void refreshRoomCodes();
  }, ROOM_CODE_REFRESH_MS);
  timer.unref();
}

function untrack(code: string): void {
  held.delete(code);
  if (held.size > 0 || timer === null) return;
  clearInterval(timer);
  timer = null;
}

// Counts claim attempts per code (the first wins); on shared presence the same MULTI also re-arms the TTL.
function bump(presence: Presence, code: string, by: number): Promise<number> {
  return expiring(presence) ? presence.hincrbyex(codeKey(code), CLAIMS, by, ROOM_CODE_TTL_SECONDS) : presence.hincrby(codeKey(code), CLAIMS, by);
}

/** Atomically claims a fresh code for `roomId`; throws after repeated collisions instead of looping. */
export async function claimRoomCode(presence: Presence, roomId: string, generate: () => string = generateRoomCode): Promise<string> {
  if (!ROOM_ID.test(roomId)) throw new RangeError('invalid room id');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generate();
    if ((await bump(presence, code, 1)) !== 1) continue;
    await presence.hset(codeKey(code), ROOM, roomId);
    if (expiring(presence)) track(code, { presence, roomId });
    return code;
  }
  throw new Error('room code space exhausted');
}

/** Frees the code only if this room still owns it. */
export async function releaseRoomCode(presence: Presence, code: string, roomId: string): Promise<void> {
  if (!isRoomCode(code)) return;
  if (held.get(code)?.roomId === roomId) untrack(code);
  if ((await presence.hget(codeKey(code), ROOM)) !== roomId) return;
  await removeKey(presence, codeKey(code));
}

// Presence types del() as void, but RedisPresence returns a promise; waiting keeps a release ordered before a reclaim.
async function removeKey(presence: Presence, key: string): Promise<void> {
  const del: (key: string) => unknown = presence.del.bind(presence);
  const pending = del(key);
  if (pending instanceof Promise) await pending;
}

/** The room a code opens, or null; anything that is not a well-formed code never reaches presence. */
export async function roomIdForCode(presence: Presence, code: string): Promise<string | null> {
  if (!isRoomCode(code)) return null;
  return (await presence.hget(codeKey(code), ROOM)) ?? null;
}

/** Codes this process is keeping alive on shared presence. */
export function heldRoomCodes(): number {
  return held.size;
}

/**
 * Re-arms the TTL of every shared code this process holds. A code that expired during an outage is claimed
 * again if it is still free (never for a room released meanwhile); one another room took is dropped. Failures
 * are logged once per pass with the error class only. Runs on a timer; exposed for tests.
 */
export async function refreshRoomCodes(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  let failure: unknown = null;
  try {
    for (const [code, entry] of [...held]) {
      try {
        await bump(entry.presence, code, 0);
        const owner = await entry.presence.hget(codeKey(code), ROOM);
        if (owner === entry.roomId || held.get(code) !== entry) continue;
        if (owner === null && (await bump(entry.presence, code, 1)) === 1) {
          await entry.presence.hset(codeKey(code), ROOM, entry.roomId);
          continue;
        }
        if (held.get(code) === entry) untrack(code);
        log.warn('room code lost to another room after a presence outage', { roomId: entry.roomId });
      } catch (error) {
        failure = error;
      }
    }
  } finally {
    refreshing = false;
  }
  if (failure !== null) log.warn('room codes not refreshed', { error: errorName(failure) });
}
