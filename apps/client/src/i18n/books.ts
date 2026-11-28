// The books on Port Concord's shelves, in the player's language. English is bundled; another language's books load
// when that language is picked, and any book it lacks reads in English.
import { z } from 'zod';
import english from './books.en.json' with { type: 'json' };
import { getLocale, onLocaleChange, type Locale } from './index.js';

/** Every book a shelf can hold, in shelf order. */
export const BOOK_IDS = ['generals', 'third', 'blind', 'twice', 'powers', 'keepers'] as const;
/** A book on the shelves. */
export type BookId = (typeof BOOK_IDS)[number];

const BookSchema = z.strictObject({
  title: z.string().min(1).max(80),
  author: z.string().min(1).max(60),
  pages: z.array(z.string().min(1).max(600)).min(1).max(12),
});
/** One book's words: its title, who wrote it, and its pages. */
export type Book = z.infer<typeof BookSchema>;
type Shelf = Partial<Record<BookId, Book>>;

const ENGLISH: Readonly<Record<BookId, Book>> = z.record(z.enum(BOOK_IDS), BookSchema).parse(english);
const ShelfSchema = z.partialRecord(z.enum(BOOK_IDS), BookSchema);

/** Each book's cover colour on the shelf. */
export const BOOK_COLORS: Readonly<Record<BookId, string>> = {
  generals: '#b8564a',
  third: '#3f7f8a',
  blind: '#4a4e8f',
  twice: '#a8823a',
  powers: '#5f8f4e',
  keepers: '#7a4a7e',
};

const LOADERS: Readonly<Partial<Record<Locale, () => Promise<unknown>>>> = {
  es: async () => (await import('./books.es.json', { with: { type: 'json' } })).default,
  fr: async () => (await import('./books.fr.json', { with: { type: 'json' } })).default,
  sw: async () => (await import('./books.sw.json', { with: { type: 'json' } })).default,
  ha: async () => (await import('./books.ha.json', { with: { type: 'json' } })).default,
  zu: async () => (await import('./books.zu.json', { with: { type: 'json' } })).default,
  hi: async () => (await import('./books.hi.json', { with: { type: 'json' } })).default,
};

const loaded = new Map<Locale, Shelf>();
const loading = new Map<Locale, Promise<void>>();

/** Loads a language's books, once; resolves at once for English, a language already in, or one that failed to load. */
export function loadBooks(locale: Locale = getLocale()): Promise<void> {
  const load = LOADERS[locale];
  if (load === undefined || loaded.has(locale)) return Promise.resolve();
  let pending = loading.get(locale);
  if (pending === undefined) {
    pending = load()
      .then((raw) => {
        const shelf = ShelfSchema.safeParse(raw);
        loaded.set(locale, shelf.success ? shelf.data : {});
      })
      .catch(() => {
        loading.delete(locale);
      });
    loading.set(locale, pending);
  }
  return pending;
}

/** A book in the player's language, or in English if that language does not have it yet. */
export function bookText(id: BookId): Book {
  return loaded.get(getLocale())?.[id] ?? ENGLISH[id];
}

onLocaleChange(() => {
  void loadBooks();
});
