import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CODEX, CODEX_INDEX, CODEX_SLUGS, HOME, lastModifiedFor, pageSources } from '../src/data/pages.js';
import { SOURCES } from '../src/data/sources.js';
import { SCREENS } from '../src/data/screens.js';

const root = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url));
const all = [HOME, CODEX_INDEX, ...CODEX];

describe('page registry', () => {
  it('has unique titles of at most 60 characters and descriptions of 70 to 160', () => {
    expect(new Set(all.map((p) => p.title)).size).toBe(all.length);
    for (const p of all) {
      expect(p.title.length, p.title).toBeLessThanOrEqual(60);
      expect(p.description.length, p.title).toBeGreaterThanOrEqual(70);
      expect(p.description.length, p.title).toBeLessThanOrEqual(160);
    }
  });

  it('gives every Codex entry a page file, an OG card, sources, an FAQ and valid related links', () => {
    for (const page of CODEX) {
      expect(page.slug).toMatch(/^[a-z0-9-]+$/);
      expect(existsSync(root(`src/pages/codex/${page.slug}.astro`)), page.slug).toBe(true);
      expect(existsSync(root(`public/og/${page.slug}.png`)), page.slug).toBe(true);
      expect(page.faq.length).toBeGreaterThan(0);
      for (const r of page.related) expect(CODEX_SLUGS).toContain(r);
      expect(page.related).not.toContain(page.slug);
      expect(new Set(page.sources).size).toBe(page.sources.length);
    }
    for (const og of ['home', 'codex']) expect(existsSync(root(`public/og/${og}.png`))).toBe(true);
  });

  it('cites every listed source on the page, and nothing unlisted', () => {
    for (const page of CODEX) {
      const file = readFileSync(root(`src/pages/codex/${page.slug}.astro`), 'utf8');
      const cited = new Set(Array.from(file.matchAll(/<Cite page=\{page\} s="([a-zA-Z0-9]+)" \/>/g), (m) => m[1]));
      expect([...cited].sort(), page.slug).toEqual([...page.sources].sort());
    }
  });

  it('only links to https sources with unique anchors', () => {
    const sources = Object.values(SOURCES);
    expect(new Set(sources.map((s) => s.id)).size).toBe(sources.length);
    for (const s of sources) expect(s.url).toMatch(/^https:\/\//);
    for (const page of CODEX) expect(pageSources(page)).toHaveLength(page.sources.length);
  });

  it('serves sitemap dates for known pages only', () => {
    expect(lastModifiedFor('/')).toBe(HOME.modified);
    expect(lastModifiedFor('/codex/one-third-rule/')).toBe('2026-11-23');
    expect(lastModifiedFor('/codex/nope/')).toBeNull();
  });

  it('ships every screenshot it references', () => {
    for (const s of Object.values(SCREENS)) expect(existsSync(root(`public/screens/${s.name}.webp`)), s.name).toBe(true);
  });
});
