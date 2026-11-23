// Serves dist/ with the headers from dist/_headers and loads every page in headless Brave at desktop and phone widths.
// Fails on console errors, CSP violations, failed requests and horizontal overflow. Screenshots go to .scratch/site/.
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor, parseHeadersFile, patternMatches } from '../src/lib/headers.js';
import { launch } from './brave.js';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const shots = fileURLToPath(new URL('../../../.scratch/site/', import.meta.url));
const PORT = 3932;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

function serve(rules: ReturnType<typeof parseHeadersFile>): Server {
  return createServer((req, res) => {
    void (async () => {
      const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const rel = urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath;
      const file = path.resolve(dist, `.${rel}`);
      // Never serve anything outside dist/.
      if (!file.startsWith(dist)) {
        res.writeHead(400).end();
        return;
      }
      const headers: Record<string, string> = {};
      for (const rule of rules) if (patternMatches(rule.pattern, urlPath)) Object.assign(headers, Object.fromEntries(rule.headers));
      try {
        const body = await readFile(file);
        res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
      } catch {
        res.writeHead(404, { ...headersFor(rules, '/*'), 'Content-Type': TYPES['.html'] ?? '' }).end(await readFile(path.join(dist, '404.html')));
      }
    })();
  }).listen(PORT, '127.0.0.1');
}

async function pages(dir: string, base = '/'): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== '_astro') out.push(...(await pages(path.join(dir, e.name), `${base}${e.name}/`)));
    else if (e.name === 'index.html') out.push(base);
  }
  return out;
}

async function main(): Promise<void> {
  // The local server is plain http, so HSTS and upgrade-insecure-requests are dropped here only.
  const text = (await readFile(path.join(dist, '_headers'), 'utf8')).replace(/; upgrade-insecure-requests/, '').replace(/^\s*Strict-Transport-Security:.*$/m, '');
  const server = serve(parseHeadersFile(text));
  await mkdir(shots, { recursive: true });
  const browser = await launch();
  const failures: string[] = [];
  try {
    for (const [label, width, height] of [['desktop', 1366, 900], ['phone', 390, 844]] as const) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      for (const route of [...(await pages(dist)), '/missing-page/']) {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('console', (m) => {
          if (m.type() === 'error' && !(route === '/missing-page/' && m.text().includes('404'))) errors.push(m.text());
        });
        page.on('requestfailed', (r) => errors.push(`request failed ${r.url()}`));
        await page.goto(`http://127.0.0.1:${String(PORT)}${route}`, { waitUntil: 'load' });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) errors.push(`scrolls sideways by ${String(overflow)}px`);
        const name = route === '/' ? 'home' : route.replace(/^\/|\/$/g, '').replace(/\//g, '_');
        await page.screenshot({ path: `${shots}${label}-${name}.png`, fullPage: route === '/' });
        for (const e of errors) failures.push(`${label} ${route}: ${e}`);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL ${f}`);
    process.exit(1);
  }
  console.log(`browser ok; screenshots in .scratch/site/`);
}

await main();
