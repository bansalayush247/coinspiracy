import { LocalPresence, type Presence } from '@colyseus/core';
import { describe, expect, it } from 'vitest';
import { ROOM_CODE_TTL_SECONDS, claimRoomCode, heldRoomCodes, refreshRoomCodes, releaseRoomCode, roomIdForCode } from '../src/roomCodes.js';

class SharedPresence {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly expiresAt = new Map<string, number>();
  readonly keysSeen: string[] = [];
  now = 0;

  #live(key: string): Map<string, string> | undefined {
    this.keysSeen.push(key);
    const at = this.expiresAt.get(key);
    if (at !== undefined && at <= this.now) {
      this.hashes.delete(key);
      this.expiresAt.delete(key);
    }
    return this.hashes.get(key);
  }

  hincrbyex(key: string, field: string, by: number, seconds: number): Promise<number> {
    const hash = this.#live(key) ?? new Map<string, string>();
    const value = Number(hash.get(field) ?? '0') + by;
    hash.set(field, String(value));
    this.hashes.set(key, hash);
    this.expiresAt.set(key, this.now + seconds * 1000);
    return Promise.resolve(value);
  }

  hincrby(): Promise<number> {
    return Promise.reject(new Error('shared presence must expire'));
  }

  hset(key: string, field: string, value: string): Promise<boolean> {
    const hash = this.#live(key) ?? new Map<string, string>();
    hash.set(field, value);
    this.hashes.set(key, hash);
    return Promise.resolve(true);
  }

  hget(key: string, field: string): Promise<string | null> {
    return Promise.resolve(this.#live(key)?.get(field) ?? null);
  }

  del(key: string): void {
    this.hashes.delete(key);
    this.expiresAt.delete(key);
  }

  asPresence(): Presence {
    return this as unknown as Presence;
  }
}

const TTL_MS = ROOM_CODE_TTL_SECONDS * 1000;

describe('room codes', () => {
  it('gives concurrent claimers of the same code different codes', async () => {
    const presence = new LocalPresence();
    const sequence = (codes: string[]) => () => codes.shift() ?? 'ZZZZZZ';
    const [a, b] = await Promise.all([
      claimRoomCode(presence, 'room-a', sequence(['AAAAAA'])),
      claimRoomCode(presence, 'room-b', sequence(['AAAAAA', 'BBBBBB'])),
    ]);
    expect(new Set([a, b])).toStrictEqual(new Set(['AAAAAA', 'BBBBBB']));
    expect(await roomIdForCode(presence, a)).toBe('room-a');
    expect(await roomIdForCode(presence, b)).toBe('room-b');
  });

  it('frees a code on release so it can be claimed again, but only by its owner', async () => {
    const presence = new LocalPresence();
    const code = await claimRoomCode(presence, 'room-a', () => 'CCCCCC');
    await releaseRoomCode(presence, code, 'room-b');
    expect(await roomIdForCode(presence, code)).toBe('room-a');
    await releaseRoomCode(presence, code, 'room-a');
    expect(await roomIdForCode(presence, code)).toBeNull();
    expect(await claimRoomCode(presence, 'room-c', () => 'CCCCCC')).toBe('CCCCCC');
  });

  it('gives up after repeated collisions instead of looping forever', async () => {
    const presence = new LocalPresence();
    await claimRoomCode(presence, 'room-a', () => 'DDDDDD');
    await expect(claimRoomCode(presence, 'room-b', () => 'DDDDDD')).rejects.toThrow(/exhausted/);
    expect(await roomIdForCode(presence, 'DDDDDD')).toBe('room-a');
  });

  it('keeps 2000 concurrent random claims unique', async () => {
    const presence = new LocalPresence();
    const codes = await Promise.all(Array.from({ length: 2000 }, (_, i) => claimRoomCode(presence, `room-${String(i)}`)));
    expect(new Set(codes).size).toBe(2000);
  });

  it('expires codes on shared presence unless the owning process keeps refreshing them', async () => {
    const shared = new SharedPresence();
    const presence = shared.asPresence();
    const code = await claimRoomCode(presence, 'room-a', () => 'EEEEEE');
    expect(heldRoomCodes()).toBe(1);
    expect(shared.expiresAt.get('code:EEEEEE')).toBe(TTL_MS);
    shared.now = TTL_MS - 1;
    await refreshRoomCodes();
    shared.now = 2 * TTL_MS - 2;
    expect(await roomIdForCode(presence, code)).toBe('room-a');
    await releaseRoomCode(presence, code, 'room-a');
    expect(heldRoomCodes()).toBe(0);
    const orphan = await claimRoomCode(presence, 'room-b', () => 'FFFFFF');
    await releaseRoomCode(new SharedPresence().asPresence(), orphan, 'room-b');
    shared.now += TTL_MS;
    expect(await roomIdForCode(presence, orphan)).toBeNull();
    expect(await claimRoomCode(presence, 'room-c', () => 'FFFFFF')).toBe('FFFFFF');
    await releaseRoomCode(presence, 'FFFFFF', 'room-c');
  });

  it('claims a code back after an outage outlived its TTL, unless another room took it', async () => {
    const shared = new SharedPresence();
    const presence = shared.asPresence();
    await claimRoomCode(presence, 'room-a', () => 'GGGGGG');
    await claimRoomCode(presence, 'room-b', () => 'HHHHHH');
    shared.now = TTL_MS + 1;
    expect(await claimRoomCode(presence, 'room-x', () => 'HHHHHH')).toBe('HHHHHH');
    await refreshRoomCodes();
    expect(await roomIdForCode(presence, 'GGGGGG')).toBe('room-a');
    expect(await roomIdForCode(presence, 'HHHHHH')).toBe('room-x');
    expect(heldRoomCodes()).toBe(2);
    await releaseRoomCode(presence, 'GGGGGG', 'room-a');
    await releaseRoomCode(presence, 'HHHHHH', 'room-x');
    expect(heldRoomCodes()).toBe(0);
  });

  it('never builds a key from anything but a well-formed code', async () => {
    const shared = new SharedPresence();
    const presence = shared.asPresence();
    for (const raw of ['../roomcaches', 'abcdef', 'AAAAAA*', '', 'AAAAAAA']) {
      expect(await roomIdForCode(presence, raw)).toBeNull();
      await releaseRoomCode(presence, raw, 'room-a');
    }
    await expect(claimRoomCode(presence, 'room-a', () => 'bad code')).rejects.toThrow(RangeError);
    await expect(claimRoomCode(presence, 'room a', () => 'JJJJJJ')).rejects.toThrow(RangeError);
    expect(shared.keysSeen).toEqual([]);
  });
});
