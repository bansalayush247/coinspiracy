// Checks over one built HTML page: CSP-safe markup and the SEO basics. Regex-based; the input is our own build output.

export interface PageFacts {
  readonly problems: string[];
  // Same-site paths the page links to or loads, without fragments.
  readonly localRefs: string[];
  readonly fragments: string[];
  readonly ids: Set<string>;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag);
  return m?.[1] ?? null;
};

export function checkPage(html: string, site: string, isNotFound = false): PageFacts {
  const problems: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    const type = attr(tag, 'type');
    if (type === 'application/ld+json') continue;
    if (attr(tag, 'src') === null) problems.push('inline <script>');
  }
  if (/<style\b/i.test(html)) problems.push('<style> element');
  if (/\sstyle="/i.test(html)) problems.push('style attribute');
  if (/<[a-z][^>]*\son[a-z]+=/i.test(html)) problems.push('event handler attribute');
  if (/javascript:/i.test(html)) problems.push('javascript: URL');

  const h1s = html.match(/<h1\b/gi)?.length ?? 0;
  if (h1s !== 1) problems.push(`${String(h1s)} <h1> elements`);
  if (!/<title>[^<]{10,}<\/title>/.test(html)) problems.push('missing or short <title>');
  if (!/<meta name="description" content="[^"]{50,}"/.test(html)) problems.push('missing or short description');
  if (!/<meta http-equiv="Content-Security-Policy"/.test(html)) problems.push('missing CSP meta');
  if (!/<html lang="en"/.test(html)) problems.push('missing lang');
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  if (!isNotFound) {
    if (canonical === undefined) problems.push('missing canonical');
    else if (!canonical.startsWith(`${site}/`)) problems.push(`canonical ${canonical} is not on ${site}`);
    const ogUrl = /<meta property="og:url" content="([^"]+)"/.exec(html)?.[1];
    if (ogUrl !== canonical) problems.push('og:url differs from canonical');
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (attr(m[0], 'alt') === null) problems.push('image without alt');
    if (attr(m[0], 'width') === null || attr(m[0], 'height') === null) problems.push('image without size');
  }

  const localRefs: string[] = [];
  const fragments: string[] = [];
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/gi)) {
    const ref = m[1] ?? '';
    if (ref.startsWith('#')) fragments.push(ref.slice(1));
    else if (ref.startsWith('/') && !ref.startsWith('//')) localRefs.push(ref.split('#')[0] ?? ref);
    else if (ref.startsWith(`${site}/`)) localRefs.push(new URL(ref).pathname);
    else if (!/^https:\/\//.test(ref)) problems.push(`unexpected link ${ref}`);
  }
  for (const m of html.matchAll(/<meta property="og:image" content="([^"]+)"/g)) {
    const url = m[1] ?? '';
    if (url.startsWith(`${site}/`)) localRefs.push(new URL(url).pathname);
    else problems.push(`og:image ${url} is not on ${site}`);
  }
  const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (m) => m[1] ?? ''));
  for (const f of fragments) if (f !== '' && !ids.has(f)) problems.push(`broken fragment #${f}`);
  return { problems, localRefs, fragments, ids };
}

// The file in dist/ that serves a path, for trailingSlash 'always' and directory output.
export function fileForPath(path: string): string {
  const clean = decodeURIComponent(path.split('?')[0] ?? path);
  if (clean.split('/').some((p) => p === '..')) throw new Error(`path escapes dist: ${path}`);
  return clean.endsWith('/') ? `${clean}index.html` : clean;
}
