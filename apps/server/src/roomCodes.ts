import type { Presence } from '@colyseus/core';
import { generateRoomCode } from '@byzantine-council/shared';

// Presence keys work on LocalPresence and RedisPresence alike.
const CLAIMS = 'bc:code-claims';
const ROOMS = 'bc:code-rooms';
const MAX_ATTEMPTS = 8;

// Atomically claims a fresh code for roomId; hincrby is atomic on every Presence.
export async function claimRoomCode(
  presence: Presence,
  roomId: string,
  generate: () => string = generateRoomCode,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generate();
    if ((await presence.hincrby(CLAIMS, code, 1)) === 1) {
      await presence.hset(ROOMS, code, roomId);
      return code;
    }
    await presence.hincrby(CLAIMS, code, -1);
  }
  throw new Error('room code space exhausted');
}

// Frees the code only if this room still owns it.
export async function releaseRoomCode(presence: Presence, code: string, roomId: string): Promise<void> {
  if ((await presence.hget(ROOMS, code)) !== roomId) return;
  await presence.hdel(ROOMS, code);
  await presence.hdel(CLAIMS, code);
}

export async function roomIdForCode(presence: Presence, code: string): Promise<string | null> {
  return (await presence.hget(ROOMS, code)) ?? null;
}
