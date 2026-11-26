import { describe, expect, it } from 'vitest';
import { BOOK_ALONE, DUMP_ACT, REX_NOTE, SHOPKEEPERS, STORY_TEMPLATES, workLabel } from '@byzantine-council/shared/city';
import es from '../src/i18n/story.es.json' with { type: 'json' };
import { translateStory, type StoryCatalog } from '../src/i18n/story.js';
import { ANIMAL_NAMES, LOOKS } from '../src/city/looks.js';
import { storyStrings } from './storyStrings.js';

const CATALOGS: Readonly<Record<string, StoryCatalog>> = { es };
const placeholders = (s: string): string[] => [...s.matchAll(/\{\w*\}/g)].map((m) => m[0]).sort();
const shown = new Set([...[...storyStrings().values()].flat(), ...Object.values(LOOKS).map((l) => l.name), ...Object.values(ANIMAL_NAMES)].filter((s) => s !== ''));

describe.each(Object.entries(CATALOGS))('the story in %s', (_, catalog) => {
  it('has every line the story can show', () => {
    const missing = [...shown].filter((s) => (catalog[s] ?? '').trim() === '');
    expect(missing).toEqual([]);
  });

  it('keeps no line the story no longer has', () => {
    expect(Object.keys(catalog).filter((s) => !shown.has(s))).toEqual([]);
  });

  it('keeps every placeholder', () => {
    const broken = Object.entries(catalog).filter(([en, tr]) => placeholders(en).join() !== placeholders(tr).join());
    expect(broken).toEqual([]);
  });

  it('translates a filled-in template, its label too', () => {
    const shop = SHOPKEEPERS[0]?.label ?? '';
    expect(translateStory(catalog, REX_NOTE(shop))).not.toBe(REX_NOTE(shop));
    expect(translateStory(catalog, REX_NOTE(shop))).toContain(catalog[shop] ?? shop);
    expect(translateStory(catalog, BOOK_ALONE('Osei', 3))).toContain('3');
    expect(Object.values(STORY_TEMPLATES).every((tpl) => catalog[tpl] !== undefined)).toBe(true);
  });

  it('builds a work button from the translated verb and label', () => {
    const spot = DUMP_ACT.spots[0];
    if (spot === undefined) throw new Error('spot');
    const label = workLabel(DUMP_ACT, spot, (s) => translateStory(catalog, s));
    expect(label).not.toContain('{}');
    expect(label).toContain(catalog[spot.label] ?? spot.label);
  });

  it('shows English for anything it does not know', () => {
    expect(translateStory(catalog, 'A line nobody wrote.')).toBe('A line nobody wrote.');
    expect(translateStory(undefined, 'Case closed.')).toBe('Case closed.');
  });
});
