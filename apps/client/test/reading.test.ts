// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BUILDING_DOORS } from '@byzantine-council/shared/city';
import { CIVIC_BOOK_IDS, HOME_BOOK_IDS, OFFICE_BOOK_IDS, PRIMER_IDS, bookText } from '../src/i18n/books.js';
import { NOTICES_BY_BOARD, noticeText } from '../src/i18n/notices.js';
import { boardNotices, boardOf, shelfBooks } from '../src/city/reading.js';

const seedsOf = (room: string): number[] => BUILDING_DOORS.filter((d) => d.room === room).map((d) => d.building.seed);

describe('what shelves and boards hold', () => {
  it('fills every home shelf with home books and primers, the same on every visit, and not the same in every home', () => {
    const shelves = seedsOf('flat').map((seed) => shelfBooks('flat', seed));
    for (const [i, seed] of seedsOf('flat').entries()) expect(shelfBooks('flat', seed)).toEqual(shelves[i]);
    for (const shelf of shelves) {
      expect(shelf.length).toBeGreaterThanOrEqual(4);
      expect(new Set(shelf).size).toBe(shelf.length);
      expect(shelf.every((id) => (HOME_BOOK_IDS as readonly string[]).includes(id) || (PRIMER_IDS as readonly string[]).includes(id))).toBe(true);
      expect(shelf.some((id) => (HOME_BOOK_IDS as readonly string[]).includes(id))).toBe(true);
    }
    expect(new Set(shelves.map((s) => s.join())).size).toBeGreaterThan(shelves.length / 2);
  });

  it('keeps civic books in City Hall and office books in offices', () => {
    for (const seed of seedsOf('cityHall')) expect(shelfBooks('cityHall', seed).some((id) => (CIVIC_BOOK_IDS as readonly string[]).includes(id))).toBe(true);
    for (const seed of seedsOf('office')) expect(shelfBooks('office', seed).some((id) => (OFFICE_BOOK_IDS as readonly string[]).includes(id))).toBe(true);
  });

  it('pins different notices on different office boards, all from the office pile', () => {
    const boards = seedsOf('office').map((seed) => boardNotices('office', seed));
    for (const board of boards) {
      expect(board.length).toBeGreaterThanOrEqual(3);
      expect(board.every((id) => NOTICES_BY_BOARD.office.includes(id))).toBe(true);
    }
    expect(new Set(boards.map((b) => b.join())).size).toBeGreaterThan(boards.length / 2);
  });

  it('gives a board only to City Hall, offices and the Mint Hall', () => {
    expect(boardOf('cityHall')).toBe('cityHall');
    expect(boardOf('office')).toBe('office');
    expect(boardOf('mintHall')).toBe('mintHall');
    expect(boardOf('flat')).toBeNull();
    expect(boardOf('mandir')).toBeNull();
  });

  it('has words for every book and at least eight notices for every board', () => {
    for (const id of [...PRIMER_IDS, ...HOME_BOOK_IDS, ...CIVIC_BOOK_IDS, ...OFFICE_BOOK_IDS]) expect(bookText(id).pages.length).toBeGreaterThan(0);
    for (const ids of Object.values(NOTICES_BY_BOARD)) {
      expect(ids.length).toBeGreaterThanOrEqual(8);
      for (const id of ids) expect(noticeText(id)?.body.length ?? 0).toBeGreaterThan(0);
    }
  });
});
