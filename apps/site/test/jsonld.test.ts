import { describe, expect, it } from 'vitest';
import { article, breadcrumbList, faqPage, serializeJsonLd, videoGame } from '../src/lib/jsonld.js';

const publisher = { name: 'Byzantine Council', url: 'https://example.org/', logo: 'https://example.org/apple-touch-icon.png' };

describe('JSON-LD', () => {
  it('cannot close the script element or break the parser', () => {
    const out = serializeJsonLd({ text: '</script><script>alert(1)</script> & \u2028\u2029' });
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(out)).toEqual({ text: '</script><script>alert(1)</script> & \u2028\u2029' });
  });

  it('builds breadcrumbs, FAQs, articles and the game', () => {
    expect(breadcrumbList([{ name: 'Home', url: 'https://example.org/' }])).toMatchObject({ '@type': 'BreadcrumbList', itemListElement: [{ position: 1 }] });
    expect(faqPage('https://example.org/', [{ q: 'Q', a: 'A' }])).toMatchObject({ mainEntity: [{ name: 'Q', acceptedAnswer: { text: 'A' } }] });
    const a = article({ url: 'https://example.org/codex/x/', headline: 'X', description: 'd', image: 'i', published: '2026-11-23', modified: '2026-11-23', section: 'Codex', isPartOf: 'https://example.org/codex/', publisher, citations: [{ name: 'n', url: 'https://u' }], about: ['t'] });
    expect(a).toMatchObject({ '@type': 'Article', citation: [{ url: 'https://u' }], isAccessibleForFree: true });
    expect(videoGame({ url: 'u', playUrl: 'p', name: 'n', description: 'd', image: 'i', minPlayers: 5, maxPlayers: 9, publisher })).toMatchObject({ numberOfPlayers: { minValue: 5, maxValue: 9 }, offers: { price: 0 } });
  });
});
