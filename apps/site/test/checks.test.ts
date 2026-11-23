import { describe, expect, it } from 'vitest';
import { checkPage, fileForPath } from '../src/lib/distChecks.js';
import { escapeHtml, ogCardHtml, ogFileName } from '../src/lib/og.js';

const SITE = 'https://example.org';
const good = `<html lang="en"><head><meta http-equiv="Content-Security-Policy" content="x"><title>A good title here</title>
<meta name="description" content="${'d'.repeat(80)}"><link rel="canonical" href="${SITE}/a/"><meta property="og:url" content="${SITE}/a/">
<meta property="og:image" content="${SITE}/og/a.png"><script type="application/ld+json">{}</script></head>
<body><h1 id="top">A</h1><a href="#top">up</a><a href="/codex/">c</a><a href="https://other.example/">x</a><img src="/s.webp" alt="" width="1" height="1"></body></html>`;

describe('dist checks', () => {
  it('passes a clean page and collects its local links', () => {
    const facts = checkPage(good, SITE);
    expect(facts.problems).toEqual([]);
    expect(facts.localRefs).toEqual(expect.arrayContaining(['/codex/', '/s.webp', '/og/a.png']));
  });

  it.each([
    ['<script>alert(1)</script>', 'inline <script>'],
    ['<style>p{}</style>', '<style> element'],
    ['<p style="color:red">x</p>', 'style attribute'],
    ['<img src="/x" alt="" width="1" height="1" onerror="x()">', 'event handler attribute'],
    ['<a href="#nowhere">x</a>', 'broken fragment #nowhere'],
    ['<h1>second</h1>', '2 <h1> elements'],
    ['<img src="/y.png" width="1" height="1">', 'image without alt'],
    ['<a href="http://plain.example/">x</a>', 'unexpected link http://plain.example/'],
  ])('flags %s', (snippet, problem) => {
    expect(checkPage(good.replace('</body>', `${snippet}</body>`), SITE).problems).toContain(problem);
  });

  it('flags canonical URLs on another origin', () => {
    expect(checkPage(good.replaceAll(SITE, 'https://evil.example'), SITE).problems.join(' ')).toContain('canonical');
  });

  it('maps paths to files without escaping dist', () => {
    expect(fileForPath('/codex/')).toBe('/codex/index.html');
    expect(fileForPath('/og/a.png')).toBe('/og/a.png');
    expect(() => fileForPath('/../etc/passwd')).toThrow();
  });
});

describe('OG cards', () => {
  it('escapes titles and rejects unsafe file names', () => {
    expect(escapeHtml('<b>"x" & \'y\'</b>')).not.toMatch(/[<>"'&](?!#)/);
    expect(ogCardHtml({ slug: 'a', eyebrow: 'e', title: '<script>', subtitle: 's' }, '<svg></svg>')).not.toContain('<script>');
    expect(ogFileName('one-third-rule')).toBe('one-third-rule.png');
    expect(() => ogFileName('../x')).toThrow();
  });
});
