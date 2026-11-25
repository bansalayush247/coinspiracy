import { z } from 'zod';
import { MAX_PLAYERS } from './constants.js';
import { cryptoRandom, type RandomSource } from './roles.js';

// No I, L, O, 0 or 1, so codes read aloud or typed are not misread.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

// 31^6 ≈ 8.9e8 codes; the server must still rate-limit lookups.
export function generateRoomCode(rng: RandomSource = cryptoRandom): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = rng.int(ROOM_CODE_ALPHABET.length);
    const char = ROOM_CODE_ALPHABET[index];
    if (char === undefined) throw new RangeError('RandomSource out of range');
    code += char;
  }
  return code;
}

// Accepts "k7q-x9m" or "K7Q X9M"; returns the canonical code or null.
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

export function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && ROOM_CODE_PATTERN.test(value);
}

// Display form, e.g. K7Q-X9M.
export function formatRoomCode(code: string): string {
  if (!isRoomCode(code)) throw new RangeError('not a room code');
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

// Names that would let a player impersonate the UI or a role.
export const RESERVED_NICKNAMES: ReadonlySet<string> = new Set([
  'you',
  'server',
  'system',
  'admin',
  'moderator',
  'byzantine',
  'honest',
  'guardian',
  'skip',
]);

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;

// ASCII only for v1 so names cannot hide homoglyphs or control characters.
export const NicknameSchema = z
  .string()
  .max(64)
  .transform((s) => s.trim().replace(/ {2,}/g, ' '))
  .pipe(
    z
      .string()
      .min(NICKNAME_MIN_LENGTH)
      .max(NICKNAME_MAX_LENGTH)
      .regex(/^[A-Za-z0-9 _-]+$/)
      .refine((s) => !RESERVED_NICKNAMES.has(s.toLowerCase()), 'reserved nickname'),
  );

// Options a client may pass when creating or joining a room.
export const JoinOptionsSchema = z.strictObject({
  nickname: NicknameSchema,
  private: z.boolean().optional(),
  // A private room opened from the end of act three: the story's signing ceremony.
  ceremony: z.boolean().optional(),
});
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;

// Adds " 2", " 3"... so names in one room stay distinct, ignoring case, within the length cap.
export function uniqueNickname(name: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; n <= used.size + 1; n++) {
    const suffix = ` ${String(n)}`;
    const candidate = `${name.slice(0, NICKNAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw new RangeError('no free nickname');
}

// Room-code lookup route; the client validates the reply before putting roomId in a URL.
export const ROOM_LOOKUP_PATH = '/api/rooms';
// What a code opens: a council match, or a story crew.
export const ROOM_KINDS = ['council', 'story'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export const RoomLookupSchema = z.strictObject({
  kind: z.enum(ROOM_KINDS),
  roomId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  players: z.number().int().min(0).max(MAX_PLAYERS),
  maxPlayers: z.number().int().min(1).max(MAX_PLAYERS),
});
export type RoomLookup = z.infer<typeof RoomLookupSchema>;

// One colour per seat, matching the concept art; RGB integers for Phaser.
export const PLAYER_COLORS: readonly number[] = Object.freeze([
  0x5fa8ff, 0xa983ff, 0xffa45c, 0x5fd3b0, 0xff86b8, 0xffd45c, 0x8fd16a, 0xff6a5c, 0x7fd8ff,
]);
