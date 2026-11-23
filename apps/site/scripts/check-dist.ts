// Checks every built page in dist/: CSP-safe markup, SEO basics, and that every local link and asset exists.
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSiteSettings } from '../src/config/env.js';
import { checkPage, fileForPath } from '../src/lib/distChecks.js';
import { cspFromHeadersFile, cspProblems } from '../src/lib/security.js';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const { site } = resolveSiteSettings(process.env, 'build');

async function htmlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);

async function main(): Promise<void> {
  const problems: string[] = [];
  if (await exists(path.join(dist, '.prerender'))) problems.push('dist/.prerender (server build output) was left in dist');
  const headers = await readFile(path.join(dist, '_headers'), 'utf8');
  for (const p of cspProblems(cspFromHeadersFile(headers))) problems.push(`_headers CSP: ${p}`);
  for (const required of ['robots.txt', 'sitemap-index.xml', 'sitemap-0.xml', '404.html', 'favicon.svg']) {
    if (!(await exists(path.join(dist, required)))) problems.push(`missing ${required}`);
  }
  const files = await htmlFiles(dist);
  const titles = new Map<string, string>();
  for (const file of files) {
    const rel = path.relative(dist, file);
    const html = await readFile(file, 'utf8');
    const facts = checkPage(html, site, rel === '404.html');
    for (const p of facts.problems) problems.push(`${rel}: ${p}`);
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    const other = titles.get(title);
    if (other !== undefined) problems.push(`${rel}: same <title> as ${other}`);
    titles.set(title, rel);
    for (const ref of new Set(facts.localRefs)) {
      if (!(await exists(path.join(dist, fileForPath(ref))))) problems.push(`${rel}: broken link ${ref}`);
    }
  }
  const sitemap = await readFile(path.join(dist, 'sitemap-0.xml'), 'utf8');
  for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const loc = m[1] ?? '';
    if (!loc.startsWith(`${site}/`)) problems.push(`sitemap: ${loc} is not on ${site}`);
    else if (!(await exists(path.join(dist, fileForPath(new URL(loc).pathname))))) problems.push(`sitemap: ${loc} has no page`);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log(`dist ok: ${String(files.length)} pages checked against ${site}`);
}

await main();
