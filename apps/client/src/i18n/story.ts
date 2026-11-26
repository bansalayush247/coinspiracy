// The story's own words in the player's language. Story lines live in the shared story files in English, and the
// server sends some of them as notes, so each language keeps a catalog keyed by the English line. A language's
// catalog loads only when that language is picked; any line it lacks shows in English.
import { STORY_TEMPLATES, fillTemplate } from '@byzantine-council/shared/city';
import { getLocale, onLocaleChange, type Locale } from './index.js';

/** A story catalog: each English line to the same line in another language. */
export type StoryCatalog = Readonly<Record<string, string>>;

const LOADERS: Readonly<Partial<Record<Locale, () => Promise<StoryCatalog>>>> = {
  es: async () => (await import('./story.es.json', { with: { type: 'json' } })).default,
};

const loaded = new Map<Locale, StoryCatalog>();
const loading = new Map<Locale, Promise<void>>();

// Each template as a pattern that finds its placeholders' values in a filled-in English line.
const PATTERNS = Object.values(STORY_TEMPLATES).map((template) => {
  const names: string[] = [];
  const parts = template.split(/\{(\w+)\}/g).map((part, i) => {
    if (i % 2 === 0) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    names.push(part);
    return '(.+?)';
  });
  return { template, names, pattern: new RegExp(`^${parts.join('')}$`, 'u') };
});

/** Loads a language's story catalog, once; resolves at once for English or a catalog already in. */
export function loadStory(locale: Locale = getLocale()): Promise<void> {
  const load = LOADERS[locale];
  if (load === undefined || loaded.has(locale)) return Promise.resolve();
  let pending = loading.get(locale);
  if (pending === undefined) {
    pending = load()
      .then((catalog) => {
        loaded.set(locale, catalog);
      })
      .catch(() => {
        loading.delete(locale);
      });
    loading.set(locale, pending);
  }
  return pending;
}

/** Translates a story line using a catalog: the line itself, or a filled-in template, or the English as it is. */
export function translateStory(catalog: StoryCatalog | undefined, text: string): string {
  if (catalog === undefined || text === '') return text;
  const direct = catalog[text];
  if (direct !== undefined) return direct;
  for (const { template, names, pattern } of PATTERNS) {
    const found = pattern.exec(text);
    const into = catalog[template];
    if (found === null || into === undefined) continue;
    const params: Record<string, string> = {};
    names.forEach((name, i) => {
      const value = found[i + 1] ?? '';
      params[name] = catalog[value] ?? value;
    });
    return fillTemplate(into, params);
  }
  return text;
}

/** A story line in the language showing now. */
export function storyT(text: string): string {
  return translateStory(loaded.get(getLocale()), text);
}

/** Starts loading the story catalog for the starting language and for every language picked later. */
export function preloadStory(): void {
  void loadStory();
  onLocaleChange(() => {
    void loadStory();
  });
}
