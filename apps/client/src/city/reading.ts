// What each building's bookshelf and notice board hold: a selection from themed pools picked by the building's
// seed, so every shelf and board in the city differs yet stays the same on every visit.
import type { RoomKind } from '@byzantine-council/shared/city';
import { CIVIC_BOOK_IDS, HOME_BOOK_IDS, OFFICE_BOOK_IDS, PRIMER_IDS, type BookId } from '../i18n/books.js';
import { NOTICES_BY_BOARD, type NoticeBoard } from '../i18n/notices.js';

const SHELF_SIZE = [4, 5] as const;
const BOARD_SIZE = [3, 4] as const;
const THEMES: Readonly<Partial<Record<RoomKind, readonly BookId[]>>> = {
  flat: HOME_BOOK_IDS,
  cityHall: CIVIC_BOOK_IDS,
  office: OFFICE_BOOK_IDS,
};

function seeded(seed: number, salt: number): () => number {
  let a = (seed ^ salt) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(pool: readonly T[], n: number, rand: () => number): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < n && left.length > 0) out.push(...left.splice(Math.floor(rand() * left.length), 1));
  return out;
}

/** The books on the shelf of the building with this seed: mostly its room's own kind of book, topped up with primers. */
export function shelfBooks(room: RoomKind, seed: number): BookId[] {
  const rand = seeded(seed, 0xb00c5);
  const size = SHELF_SIZE[0] + Math.floor(rand() * (SHELF_SIZE[1] - SHELF_SIZE[0] + 1));
  const theme = THEMES[room] ?? [];
  const own = pick(theme, Math.min(theme.length, 2 + Math.floor(rand() * 2)), rand);
  return pick([...own, ...pick(PRIMER_IDS, size - own.length, rand)], size, rand);
}

/** The board a room's notice board is, if it has one. */
export function boardOf(room: RoomKind): NoticeBoard | null {
  return room === 'cityHall' || room === 'office' || room === 'mintHall' ? room : null;
}

/** The notices pinned on the board of the building with this seed. */
export function boardNotices(board: NoticeBoard, seed: number): string[] {
  const rand = seeded(seed, 0x9071ce);
  const size = BOARD_SIZE[0] + Math.floor(rand() * (BOARD_SIZE[1] - BOARD_SIZE[0] + 1));
  return pick(NOTICES_BY_BOARD[board], size, rand);
}
