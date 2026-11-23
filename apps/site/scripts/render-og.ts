// Renders the 1200×630 share cards into public/og/ with headless Brave.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CODEX } from '../src/data/pages.js';
import { ogCardHtml, ogFileName, type OgCard } from '../src/lib/og.js';
import { OG_HEIGHT, OG_WIDTH } from '../src/lib/site.js';
import { launch } from './brave.js';

const out = fileURLToPath(new URL('../public/og/', import.meta.url));
const logo = await readFile(fileURLToPath(new URL('../public/favicon.svg', import.meta.url)), 'utf8');

const cards: OgCard[] = [
  { slug: 'home', eyebrow: 'Free browser game · 5 to 9 players', title: 'Guard the mint. Find the Byzantines.', subtitle: 'A social-deduction game about federated ecash.' },
  { slug: 'codex', eyebrow: 'The Codex', title: 'How federated ecash works', subtitle: 'Short, sourced lessons behind every task in the game.' },
  ...CODEX.map((p) => ({ slug: p.slug, eyebrow: 'Codex', title: p.h1, subtitle: `${p.inGame.split('. ')[0] ?? p.inGame}.` })),
];

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: OG_WIDTH, height: OG_HEIGHT }, deviceScaleFactor: 1 });
    // The card is self-contained; block every request so nothing outside it can load.
    await page.route('**/*', (route) => route.abort());
    for (const card of cards) {
      await page.setContent(ogCardHtml(card, logo), { waitUntil: 'load' });
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT } });
      await writeFile(`${out}${ogFileName(card.slug)}`, png);
      console.log(`og/${ogFileName(card.slug)}`);
    }
  } finally {
    await browser.close();
  }
}

await main();
