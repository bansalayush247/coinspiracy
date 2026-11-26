// Island Academy end to end: production build, real server, headless Brave. A guest who has opened every
// island plays one level each of Signing Isle, Council Isle and Watchtower Peaks, reading each drill off the
// screen and answering it with the shared rules, as a careful player would.
// Run: npx tsx --conditions=source e2e/academy.ts
import { randomBytes } from 'node:crypto';
import { type Page } from 'playwright-core';
import { createGameServer } from '../apps/server/src/app.js';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../apps/server/src/profile/store.js';
import { COUNCIL_NAMES, safeRotations, signingSide, threshold } from '../packages/shared/src/index.js';
import { SHOTS, check, checkNoErrors, collectErrors, finish, openRig, type Rig } from './harness.js';

const GAME_PORT = 3954;
const WEB_PORT = 3955;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const OUT = 'dist-academy';

// Every guest has cleared Mint Island's levels with three stars each: 15 stars opens every island.
class OpenStore extends MemoryProfileStore {
  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) => fn(data.progress.academy[0] === 3 ? data : { ...data, progress: { ...data.progress, academy: data.progress.academy.map((s, i) => (i < 5 ? 3 : s)) } }));
  }
}


const num = (text: string, re: RegExp): number => Number(re.exec(text)?.[1] ?? NaN);

// Reads the drill on screen and returns the label of the right option.
async function answerFor(page: Page): Promise<string> {
  const prompt = (await page.textContent('#academy-body .prompt')) ?? '';
  if (prompt.startsWith('A federation of')) return String(threshold(num(prompt, /A federation of (\d+)/)));
  if (prompt.includes('secretly Byzantine')) return String(safeRotations(num(prompt, /^(\d+) guardians/), num(prompt, /and (\d+) of them/)));
  if (prompt.startsWith('A partition')) {
    const guardians = num(prompt, /federation of (\d+)/);
    const sides = await page.locator('#academy-body .drill-side b').allTextContents();
    const side = signingSide(guardians, sides.map((t) => num(t, /· (\d+) guardian/)));
    return side === -1 ? 'No side can' : `Side ${'ABC'[side] ?? '?'}`;
  }
  // Council evidence: the one guardian both seen in the hall and signing the forgery.
  const rows = await page.locator('#academy-body .drill-evidence li').allTextContents();
  const proven = rows.filter((r) => r.includes('Signing Hall') && r.includes('signed #'));
  const name = COUNCIL_NAMES.find((n) => proven.length === 1 && proven[0]?.includes(n));
  return name === undefined ? 'Skip the vote' : `Rotate out ${name}`;
}

async function playLevel(page: Page, level: number, label: string): Promise<void> {
  await page.click(`#academy button[aria-label^="Play level ${String(level)},"]`);
  await page.click('#academy .academy-actions button.cta');
  for (let drill = 0; drill < 6; drill++) {
    const done = page.locator('#academy .academy-stars');
    await page.locator('#academy-body .drill-options, #academy .academy-stars').first().waitFor({ state: 'visible', timeout: 10_000 });
    if (await done.isVisible()) break;
    if (drill === 0) await page.screenshot({ path: `${SHOTS}academy-${label}.png` });
    const answer = await answerFor(page);
    await page.locator('#academy-body .drill-options button', { hasText: new RegExp(`^${answer}$`) }).click();
    await page.click('#academy-body > .task-body > button.cta');
    await page.waitForFunction(() => {
      const s = document.getElementById('academy-status')?.textContent ?? '';
      return s === 'Correct!' || s.startsWith('Not quite') || s.startsWith('Perfect') || s.startsWith('Cleared');
    }, undefined, { timeout: 10_000 });
    const status = (await page.textContent('#academy-status')) ?? '';
    if (status.startsWith('Not quite')) {
      check(false, `${label}: drill ${String(drill + 1)} answered "${answer}"`);
      return;
    }
    await page.waitForTimeout(300);
  }
  await page.locator('#academy .academy-stars').waitFor({ state: 'visible', timeout: 10_000 });
  check(((await page.textContent('#academy .academy-stars')) ?? '').startsWith('★'), `${label}: level ${String(level)} cleared from what the screen shows`);
  await page.click('#academy .academy-actions button:has-text("Back to levels")');
}

async function main(): Promise<void> {
  const game = createGameServer({
    allowedOrigins: new Set([WEB]),
    ipPolicy: { trustedProxies: new Set() },
    gracefullyShutdown: false,
    profiles: { store: new OpenStore(), keys: { current: randomBytes(32), previous: null, secure: false } },
  });
  let rig: Rig | undefined;
  try {
    await game.listen(GAME_PORT, '127.0.0.1');
    rig = await openRig({ outDir: OUT, webPort: WEB_PORT, serverUrl: `http://127.0.0.1:${String(GAME_PORT)}` });
    const { browser } = rig;
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'en-US' });
    const errors: string[] = [];
    collectErrors(page, errors);
    await page.goto(`${WEB}/`);
    await page.locator('#open-progress').waitFor({ state: 'visible', timeout: 10_000 });
    await page.click('#open-academy');
    await page.locator('#academy').waitFor({ state: 'visible' });
    const headings = await page.locator('#academy .academy-island').allTextContents();
    check(headings.join(',') === 'Mint Island,Signing Isle,Council Isle,Watchtower Peaks,Lightning Reef', `levels are grouped by island in world-map order (${headings.join(', ')})`);
    await page.screenshot({ path: `${SHOTS}academy-islands.png` });
    await playLevel(page, 8, 'threshold');
    await playLevel(page, 10, 'quorum');
    await playLevel(page, 11, 'council');
    await playLevel(page, 12, 'partition');
    checkNoErrors(errors);
  } finally {
    await rig?.close();
    await game.server.gracefullyShutdown(false).catch(() => undefined);
  }
  finish('academy');
}

await main();
