// The notices pinned on Port Concord's boards, in the player's language. English is bundled; another language's
// notices load when that language is picked, and any notice it lacks reads in English.
import { z } from 'zod';
import english from './notices.en.json' with { type: 'json' };
import { getLocale, onLocaleChange, type Locale } from './index.js';

/** The kinds of board a notice can be pinned on. */
export const NOTICE_BOARDS = ['cityHall', 'office', 'mintHall'] as const;
/** A kind of notice board. */
export type NoticeBoard = (typeof NOTICE_BOARDS)[number];

const WordsSchema = z.strictObject({
  title: z.string().min(1).max(60),
  body: z.string().min(1).max(400),
  from: z.string().min(1).max(50),
});
/** One notice's words: its heading, what it says, and who pinned it up. */
export type NoticeWords = z.infer<typeof WordsSchema>;

const EnglishSchema = z.record(z.string().regex(/^[a-zA-Z0-9]+$/), WordsSchema.extend({ board: z.enum(NOTICE_BOARDS) }));
const TranslationSchema = z.record(z.string(), WordsSchema);
type Translation = z.infer<typeof TranslationSchema>;

const ENGLISH = EnglishSchema.parse(english);

/** Every notice's id, by the board it belongs on, in a fixed order. */
export const NOTICES_BY_BOARD: Readonly<Record<NoticeBoard, readonly string[]>> = Object.freeze({
  cityHall: Object.keys(ENGLISH).filter((id) => ENGLISH[id]?.board === 'cityHall'),
  office: Object.keys(ENGLISH).filter((id) => ENGLISH[id]?.board === 'office'),
  mintHall: Object.keys(ENGLISH).filter((id) => ENGLISH[id]?.board === 'mintHall'),
});

const LOADERS: Readonly<Partial<Record<Locale, () => Promise<unknown>>>> = {
  es: async () => (await import('./notices.es.json', { with: { type: 'json' } })).default,
  fr: async () => (await import('./notices.fr.json', { with: { type: 'json' } })).default,
  sw: async () => (await import('./notices.sw.json', { with: { type: 'json' } })).default,
  ha: async () => (await import('./notices.ha.json', { with: { type: 'json' } })).default,
  zu: async () => (await import('./notices.zu.json', { with: { type: 'json' } })).default,
  hi: async () => (await import('./notices.hi.json', { with: { type: 'json' } })).default,
};

const loaded = new Map<Locale, Translation>();
const loading = new Map<Locale, Promise<void>>();

/** Loads a language's notices, once; resolves at once for English, a language already in, or one that failed to load. */
export function loadNotices(locale: Locale = getLocale()): Promise<void> {
  const load = LOADERS[locale];
  if (load === undefined || loaded.has(locale)) return Promise.resolve();
  let pending = loading.get(locale);
  if (pending === undefined) {
    pending = load()
      .then((raw) => {
        const words = TranslationSchema.safeParse(raw);
        loaded.set(locale, words.success ? words.data : {});
      })
      .catch(() => {
        loading.delete(locale);
      });
    loading.set(locale, pending);
  }
  return pending;
}

/** A notice in the player's language, or in English if that language does not have it yet; null for an unknown id. */
export function noticeText(id: string): NoticeWords | null {
  return loaded.get(getLocale())?.[id] ?? ENGLISH[id] ?? null;
}

onLocaleChange(() => {
  void loadNotices();
});
