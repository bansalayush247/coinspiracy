import { LocalPresence } from '@colyseus/core';
import { describe, expect, it } from 'vitest';
import { claimRoomCode, releaseRoomCode, roomIdForCode } from '../src/roomCodes.js';

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
});
