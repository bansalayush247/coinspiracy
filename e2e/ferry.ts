// The ferry end to end: production build, real server, headless Brave. A guest walks onto the Port Concord ferry
// pier, is told Beach Town is still locked, opens it, sails across, lands at the Beach Town pier and sails back,
// skipping the second crossing. A phone sails too, and a guest who prefers reduced motion sees the short card instead.
// Run: npx tsx --conditions=source e2e/ferry.ts
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { matchMaker } from '@colyseus/core';
import type { Browser, Page } from 'playwright-core';
import { createGameServer } from '../apps/server/src/app.js';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../apps/server/src/profile/store.js';
import { FERRY_TUNING } from '../packages/shared/src/city/ferry.js';
import { SHOTS, check, checkNoErrors, collectErrors, finish, openRig, type Rig } from './harness.js';

const GAME_PORT = 3962;
const WEB_PORT = 3963;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const OUT = 'dist-ferry';
const EVIDENCE = fileURLToPath(new URL('../production/qa/evidence/ferry/', import.meta.url));

class SwitchableStore extends MemoryProfileStore {
  opened = false;

  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) => fn(this.opened ? { ...data, progress: { ...data.progress, academy: data.progress.academy.map((_, i) => (i < 2 ? 2 : 0)) } } : data));
  }
}

type Pos = { x: number; y: number } | null;
type Ferry = { from: string; to: string; progress: number; reduced: boolean } | null;
const cityPos = (page: Page): Promise<Pos> => page.evaluate(() => (window as unknown as { __bcCityPos?: () => Pos }).__bcCityPos?.() ?? null);
const beachPos = (page: Page): Promise<Pos> => page.evaluate(() => (window as unknown as { __bcBeachPos?: () => Pos }).__bcBeachPos?.() ?? null);
const ferryState = (page: Page): Promise<Ferry> => page.evaluate(() => (window as unknown as { __bcFerry?: () => Ferry }).__bcFerry?.() ?? null);
const sailing = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.dataset['ferry'] === 'sailing');
const near = (p: Pos, q: { x: number; y: number }, within = 0.6): boolean => p !== null && Math.hypot(p.x - q.x, p.y - q.y) < within;

interface Body {
  x: number;
  y: number;
}

async function body(roomName: 'city' | 'beach', name: string): Promise<Body | undefined> {
  for (const listing of await matchMaker.query({ name: roomName })) {
    const room = matchMaker.getLocalRoomById(listing.roomId) as { state: { players: Map<string, Body & { name: string }> } } | undefined;
    const found = [...(room?.state.players.values() ?? [])].find((p) => p.name === name);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function enterCity(browser: Browser, name: string, options: Parameters<Browser['newPage']>[0], errors: string[]): Promise<Page> {
  const page = await browser.newPage({ locale: 'en-US', ...options });
  collectErrors(page, errors, name);
  await page.goto(`${WEB}/`);
  await page.locator('#open-city').waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.locator('#nickname').fill(name);
  await page.click('#open-city');
  await page.locator('#city-hud').waitFor({ state: 'visible', timeout: 15_000 });
  return page;
}

// Puts a guardian on an island's ferry stop and waits for the HUD to offer the ferry.
async function toPier(page: Page, island: 'city' | 'beach', name: string): Promise<boolean> {
  const me = await body(island, name);
  if (me === undefined) return false;
  const at = FERRY_TUNING.stops[island].at;
  me.x = at.x;
  me.y = at.y;
  return page
    .locator(island === 'city' ? '#city-ferry' : '#beach-ferry')
    .waitFor({ state: 'visible', timeout: 6_000 })
    .then(() => true)
    .catch(() => false);
}

async function landed(page: Page, hud: string, timeout = 20_000): Promise<boolean> {
  return page
    .waitForFunction((sel) => document.documentElement.dataset['ferry'] === undefined && document.querySelector(sel)?.hasAttribute('hidden') === false, hud, { timeout })
    .then(() => true)
    .catch(() => false);
}

async function main(): Promise<void> {
  const store = new SwitchableStore();
  const game = createGameServer({
    allowedOrigins: new Set([WEB]),
    ipPolicy: { trustedProxies: new Set() },
    maxSeatsPerIp: 16,
    gracefullyShutdown: false,
    profiles: { store, keys: { current: randomBytes(32), previous: null, secure: false } },
  });
  let rig: Rig | undefined;
  try {
    await game.listen(GAME_PORT, '127.0.0.1');
    rig = await openRig({ outDir: OUT, webPort: WEB_PORT, serverUrl: `http://127.0.0.1:${String(GAME_PORT)}` });
    await mkdir(EVIDENCE, { recursive: true });
    const { browser } = rig;
    const errors: string[] = [];
    const page = await enterCity(browser, 'Mara', { viewport: { width: 1280, height: 800 } }, errors);

    check(await toPier(page, 'city', 'Mara'), 'standing on the Port Concord pier offers the ferry');
    check(((await page.textContent('#city-ferry')) ?? '').startsWith('Ferry to Beach Town'), 'the button names Beach Town');
    check(((await page.textContent('#city-ferry small')) ?? '').startsWith('Locked'), 'while Beach Town is shut, the button says it is locked');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${EVIDENCE}pier-city.png` });
    await page.keyboard.press('e');
    const told = await page.waitForFunction(() => document.body.textContent.includes('The ferry to Beach Town sails once the island opens'), undefined, { timeout: 5_000 }).then(() => true).catch(() => false);
    check(told, 'boarding while locked explains what opens Beach Town');
    check(!(await sailing(page)), 'a locked ferry does not sail');
    await page.screenshot({ path: `${EVIDENCE}locked-city.png` });

    store.opened = true;
    await page.waitForTimeout(800);
    await page.keyboard.press('e');
    const left = await page.waitForFunction(() => document.documentElement.dataset['ferry'] === 'sailing', undefined, { timeout: 8_000 }).then(() => true).catch(() => false);
    check(left, 'once Beach Town is open, E boards the ferry');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${EVIDENCE}crossing-to-beach-start.png` });
    await page.waitForTimeout(1_600);
    const crossing = await ferryState(page);
    check(crossing?.from === 'city' && crossing.to === 'beach' && crossing.progress > 0.15 && crossing.progress < 0.8, `the crossing plays (${JSON.stringify(crossing)})`);
    check(((await page.textContent('.ferry-card')) ?? '').includes('Sailing to Beach Town'), 'the card names where the ferry is going');
    await page.screenshot({ path: `${EVIDENCE}crossing-to-beach.png` });
    await page.waitForTimeout(2_400);
    await page.screenshot({ path: `${EVIDENCE}crossing-to-beach-late.png` });
    check(await landed(page, '#beach-hud'), 'the ferry lands in Beach Town');
    const arrival = await beachPos(page);
    check(near(arrival, FERRY_TUNING.stops.beach.arrive), `the guardian steps off at the Beach Town pier (${JSON.stringify(arrival)})`);
    check(await page.isHidden('#city-hud'), 'the city HUD is gone');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${EVIDENCE}arrival-beach.png` });

    check(await toPier(page, 'beach', 'Mara'), 'the Beach Town pier offers the ferry back');
    check(((await page.textContent('#beach-ferry')) ?? '').startsWith('Ferry to Port Concord'), 'the button names Port Concord');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${EVIDENCE}pier-beach.png` });
    await page.click('#beach-ferry');
    await page.waitForFunction(() => document.documentElement.dataset['ferry'] === 'sailing', undefined, { timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
    check((await ferryState(page))?.progress !== 1, 'the crossing cannot be skipped in its first second');
    await page.waitForTimeout(1_800);
    await page.screenshot({ path: `${EVIDENCE}crossing-to-city.png` });
    const skippedAt = Date.now();
    await page.keyboard.press('e');
    check(await landed(page, '#city-hud', 6_000), `skipping lands the ferry early (${String(Date.now() - skippedAt)} ms)`);
    const home = await cityPos(page);
    check(near(home, FERRY_TUNING.stops.city.arrive), `back in Port Concord at the ferry dock (${JSON.stringify(home)})`);
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: `${EVIDENCE}arrival-city.png` });
    check(await page.isHidden('#beach-hud'), 'the Beach Town HUD is gone');

    const phone = await enterCity(browser, 'Teo', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, errors);
    check(await toPier(phone, 'city', 'Teo'), 'a phone sees the ferry button on the pier');
    await phone.waitForTimeout(1_500);
    await phone.screenshot({ path: `${EVIDENCE}phone-pier.png` });
    await phone.tap('#city-ferry');
    await phone.waitForTimeout(3_000);
    check((await ferryState(phone))?.to === 'beach', 'tapping the button sails a phone too');
    await phone.screenshot({ path: `${EVIDENCE}phone-crossing.png` });
    check(await landed(phone, '#beach-hud'), 'the phone lands in Beach Town');

    const calm = await enterCity(browser, 'Ivy', { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }, errors);
    check(await toPier(calm, 'city', 'Ivy'), 'the reduced-motion guest reaches the pier');
    await calm.keyboard.press('e');
    await calm.waitForTimeout(700);
    const still = await ferryState(calm);
    check(still?.reduced === true, 'with reduced motion the crossing is a short still card');
    await calm.screenshot({ path: `${EVIDENCE}reduced-card.png` });
    const quick = Date.now();
    check(await landed(calm, '#beach-hud', 8_000), `the short card lands without the full crossing (${String(Date.now() - quick + 700)} ms)`);
    checkNoErrors(errors);
    await page.screenshot({ path: `${SHOTS}ferry-final.png` });
  } finally {
    await rig?.close();
    await game.server.gracefullyShutdown(false).catch(() => undefined);
  }
  finish('ferry');
}

await main();
