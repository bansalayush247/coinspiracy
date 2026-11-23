import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '../src/constants.js';
import {
  JoinOptionsSchema,
  NicknameSchema,
  PLAYER_COLORS,
  NICKNAME_MAX_LENGTH,
  RESERVED_NICKNAMES,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomLookupSchema,
  formatRoomCode,
  generateRoomCode,
  isRoomCode,
  normalizeRoomCode,
  uniqueNickname,
} from '../src/lobby.js';
import type { RandomSource } from '../src/roles.js';

function scripted(values: readonly number[]): RandomSource {
  let i = 0;
  return {
    int: () => {
      const v = values[i % values.length];
      i++;
      if (v === undefined) throw new Error('empty script');
      return v;
    },
  };
}

describe('room codes', () => {
  it('uses a 31-character alphabet without look-alike characters', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(31);
    for (const banned of ['I', 'L', 'O', '0', '1']) expect(ROOM_CODE_ALPHABET).not.toContain(banned);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(31);
  });

  it('generates codes of the right length from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isRoomCode(code)).toBe(true);
    }
  });

  it('maps scripted draws to alphabet positions', () => {
    expect(generateRoomCode(scripted([0, 1, 2, 28, 29, 30]))).toBe('ABC789');
  });

  it.each([31, -1, 1.5])('throws when the rng returns %s', (bad) => {
    expect(() => generateRoomCode(scripted([bad]))).toThrow(RangeError);
  });

  it.each([
    { raw: 'k7qx9m', out: 'K7QX9M' },
    { raw: 'K7Q-X9M', out: 'K7QX9M' },
    { raw: ' k7q x9m ', out: 'K7QX9M' },
  ])('normalizes "$raw"', ({ raw, out }) => {
    expect(normalizeRoomCode(raw)).toBe(out);
  });

  it.each(['K7QX9', 'K7QX9MM', 'K7QX0M', 'K7QXIM', 'K7QXLM', 'K7QXOM', 'K7Q_X9M', '', 'é7QX9M'])(
    'rejects "%s"',
    (raw) => {
      expect(normalizeRoomCode(raw)).toBeNull();
    },
  );

  it.each([null, undefined, 42, {}, ['K7QX9M']])('rejects a non-string %s', (raw) => {
    expect(normalizeRoomCode(raw)).toBeNull();
    expect(isRoomCode(raw)).toBe(false);
  });

  it('rejects long input before normalizing it', () => {
    expect(normalizeRoomCode(`K7QX9M${' '.repeat(40)}`)).toBeNull();
  });

  it('formats codes for display and refuses non-codes', () => {
    expect(formatRoomCode('K7QX9M')).toBe('K7Q-X9M');
    expect(() => formatRoomCode('k7qx9m')).toThrow(RangeError);
  });
});

describe('NicknameSchema', () => {
  it.each([
    { raw: 'Nova', out: 'Nova' },
    { raw: '  Juno_7 ', out: 'Juno_7' },
    { raw: 'Kai  the   Bold', out: 'Kai the Bold' },
    { raw: 'a-b', out: 'a-b' },
    { raw: 'x'.repeat(16), out: 'x'.repeat(16) },
  ])('accepts "$raw" as "$out"', ({ raw, out }) => {
    expect(NicknameSchema.parse(raw)).toBe(out);
  });

  it.each([
    'A',
    '  B  ',
    'x'.repeat(17),
    'Növa',
    '<script>',
    'tab\tname',
    'new\nline',
    'emoji\u{1F600}',
    'zero​width',
    'x'.repeat(65),
  ])('rejects %j', (raw) => {
    expect(NicknameSchema.safeParse(raw).success).toBe(false);
  });

  it.each([...RESERVED_NICKNAMES, 'YOU', ' Server ', 'Byzantine'])('rejects reserved name %j', (raw) => {
    expect(NicknameSchema.safeParse(raw).success).toBe(false);
  });

  it.each([null, undefined, 7, { nickname: 'Nova' }])('rejects non-string %s', (raw) => {
    expect(NicknameSchema.safeParse(raw).success).toBe(false);
  });
});

describe('JoinOptionsSchema', () => {
  it('accepts a nickname with an optional private flag', () => {
    expect(JoinOptionsSchema.parse({ nickname: ' Nova ' })).toEqual({ nickname: 'Nova' });
    expect(JoinOptionsSchema.parse({ nickname: 'Nova', private: true })).toEqual({
      nickname: 'Nova',
      private: true,
    });
  });

  it.each([
    {},
    { nickname: 'Nova', role: 'byzantine' },
    { nickname: 'Nova', private: 'yes' },
    { nickname: 'Nova', __proto__: { admin: true } },
    JSON.parse('{"nickname":"Nova","__proto__":{"admin":true}}') as unknown,
  ])('rejects %j', (raw) => {
    expect(JoinOptionsSchema.safeParse(raw).success).toBe(false);
  });
});

describe('PLAYER_COLORS', () => {
  it('has a distinct RGB colour for every seat', () => {
    expect(PLAYER_COLORS.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
    expect(new Set(PLAYER_COLORS).size).toBe(PLAYER_COLORS.length);
    for (const c of PLAYER_COLORS) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe('uniqueNickname', () => {
  it('keeps a name nobody else uses', () => {
    expect(uniqueNickname('Ava', ['Ben', 'Cai'])).toBe('Ava');
    expect(uniqueNickname('Ava', [])).toBe('Ava');
  });

  it('adds the lowest free number when the name is taken, ignoring case', () => {
    expect(uniqueNickname('Ava', ['ava'])).toBe('Ava 2');
    expect(uniqueNickname('Ava', ['AVA', 'ava 2'])).toBe('Ava 3');
    expect(uniqueNickname('Ava', ['Ava', 'Ava 3'])).toBe('Ava 2');
  });

  it('trims a long name so the suffixed result still fits the length cap', () => {
    const long = 'Satoshi Nakamot'; // 15 characters
    const result = uniqueNickname(long, [long]);
    expect(result).toBe('Satoshi Nakamo 2');
    expect(result.length).toBeLessThanOrEqual(NICKNAME_MAX_LENGTH);
    expect(NicknameSchema.safeParse(result).success).toBe(true);
  });

  it('does not leave a double space when trimming lands on a space', () => {
    const name = 'Abcdefghijklm Z'; // the cut keeps 14 characters, ending on the space
    expect(uniqueNickname(name, [name])).toBe('Abcdefghijklm 2');
  });

  it('always finds a free name for a full room', () => {
    const taken = ['Ava', ...Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => `Ava ${String(i + 2)}`)];
    const result = uniqueNickname('Ava', taken);
    expect(taken.map((n) => n.toLowerCase())).not.toContain(result.toLowerCase());
    expect(NicknameSchema.safeParse(result).success).toBe(true);
  });
});

describe('RoomLookupSchema', () => {
  it('accepts a well-formed lookup reply', () => {
    const reply = { roomId: 'aB3_x-9Qz', players: 3, maxPlayers: MAX_PLAYERS };
    expect(RoomLookupSchema.parse(reply)).toStrictEqual(reply);
  });

  it.each([
    { label: 'a roomId with a slash', reply: { roomId: 'a/b', players: 1, maxPlayers: 9 } },
    { label: 'a roomId with a query', reply: { roomId: 'abc?x=1', players: 1, maxPlayers: 9 } },
    { label: 'an empty roomId', reply: { roomId: '', players: 1, maxPlayers: 9 } },
    { label: 'too many players', reply: { roomId: 'abc', players: MAX_PLAYERS + 1, maxPlayers: 9 } },
    { label: 'an extra key', reply: { roomId: 'abc', players: 1, maxPlayers: 9, admin: true } },
  ])('rejects $label', ({ reply }) => {
    expect(RoomLookupSchema.safeParse(reply).success).toBe(false);
  });
});
