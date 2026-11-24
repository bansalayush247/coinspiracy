// Port Concord end to end: production build, real server, headless Brave. Two guests enter the open city,
// see each other at the seafront, walk, stream in new chunks of the map, lose sight of each other far apart,
// then meet on the rough streets of Low Tide for a fight that ends in a knockout, and the winner vaults the coins.
// Run: npx tsx --conditions=source e2e/city.ts
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build, preview, type PreviewServer } from 'vite';
import { createGameServer } from '../apps/server/src/app.js';
import type { CityRoom } from '../apps/server/src/city/CityRoom.js';
import { PUNCH_COOLDOWN_MS, ROUGH_STREETS, VAULT_DOOR, districtAt } from '@byzantine-council/shared/city';
import { MemoryProfileStore } from '../apps/server/src/profile/store.js';
import { matchMaker } from '@colyseus/core';

const clientRoot = fileURLToPath(new URL('../apps/client', import.meta.url));
const shots = fileURLToPath(new URL('../.scratch/e2e/', import.meta.url));
const GAME_PORT = 3956;
const WEB_PORT = 3957;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const BRAVE = process.env['BRAVE_PATH'] ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const OUT = 'dist-city';

let failures = 0;
function check(ok: boolean, label: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

type Pos = { x: number; y: number } | null;
const pos = (page: Page): Promise<Pos> => page.evaluate(() => (window as unknown as { __bcCityPos?: () => Pos }).__bcCityPos?.() ?? null);
const chunks = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __bcCityChunks?: () => number }).__bcCityChunks?.() ?? 0);
const population = (page: Page): Promise<string> => page.textContent('#city-pop').then((t) => t ?? '');

async function enter(browser: Browser, name: string, viewport: { width: number; height: number }, errors: string[]): Promise<Page> {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  await page.goto(`${WEB}/`);
  await page.locator('#open-city').waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.locator('#nickname').fill(name);
  await page.click('#open-city');
  await page.locator('#city-hud').waitFor({ state: 'visible', timeout: 15_000 });
  return page;
}

async function main(): Promise<void> {
  const game = createGameServer({ allowedOrigins: new Set([WEB]), ipPolicy: { trustedProxies: new Set() }, maxSeatsPerIp: 16, gracefullyShutdown: false, profiles: { store: new MemoryProfileStore(), keys: { current: randomBytes(32), previous: null, secure: false } } });
  let web: PreviewServer | undefined;
  let browser: Browser | undefined;
  try {
    await game.listen(GAME_PORT, '127.0.0.1');
    process.env['VITE_SERVER_URL'] = `http://127.0.0.1:${String(GAME_PORT)}`;
    process.env['VITE_E2E'] = '1';
    await build({ root: clientRoot, logLevel: 'warn', build: { outDir: OUT, emptyOutDir: true } });
    web = await preview({ root: clientRoot, logLevel: 'warn', build: { outDir: OUT }, preview: { host: '127.0.0.1', port: WEB_PORT, strictPort: true } });
    browser = await chromium.launch({ executablePath: BRAVE, headless: true, chromiumSandbox: true, timeout: 30_000 });
    await mkdir(shots, { recursive: true });
    const errors: string[] = [];
    const rook = await enter(browser, 'Rook', { width: 1280, height: 800 }, errors);
    const dani = await enter(browser, 'Dani', { width: 390, height: 844 }, errors);
    await rook.waitForFunction(() => (document.getElementById('city-pop')?.textContent ?? '').startsWith('2 in the city · 1 nearby'), undefined, { timeout: 10_000 });
    check(true, `both guardians arrive together (${await population(rook)})`);
    check(((await rook.textContent('#city-district')) ?? '') === 'Saltmarket', 'arrival is on the Saltmarket seafront');
    check((await chunks(rook)) >= 4, `map chunks streamed in around the camera (${String(await chunks(rook))})`);
    check(((await rook.textContent('#city-zone')) ?? '') === 'Safe streets' && (await rook.isDisabled('#city-punch')), 'the seafront is safe: no punching');
    await rook.screenshot({ path: `${shots}city-arrive.png` });
    await dani.screenshot({ path: `${shots}city-phone.png` });
    // Walk north into the city for a few seconds.
    const before = await pos(rook);
    await rook.keyboard.down('ArrowUp');
    await rook.waitForTimeout(3500);
    await rook.keyboard.up('ArrowUp');
    await rook.waitForTimeout(500);
    const after = await pos(rook);
    const moved = before !== null && after !== null ? Math.hypot(after.x - before.x, after.y - before.y) : 0;
    check(moved > 4, `walking moves the guardian through the streets (${moved.toFixed(1)} tiles)`);
    await rook.screenshot({ path: `${shots}city-walk.png` });
    // Send Dani across the city on the server: Rook's client must stop receiving her.
    const listing = await matchMaker.query({ name: 'city' });
    const roomId = listing[0]?.roomId ?? '';
    const room = matchMaker.getLocalRoomById(roomId) as CityRoom | undefined;
    const daniId = [...(room?.state.players.entries() ?? [])].find(([, p]) => p.name === 'Dani')?.[0];
    const far = daniId === undefined ? undefined : room?.state.players.get(daniId);
    if (far !== undefined) {
      far.x = 120.5;
      far.y = 20.5;
    }
    await rook.waitForFunction(() => (document.getElementById('city-pop')?.textContent ?? '').endsWith('0 nearby'), undefined, { timeout: 10_000 }).catch(() => undefined);
    check((await population(rook)).startsWith('2 in the city · 0 nearby'), `far guardians are not sent (${await population(rook)})`);
    await dani.waitForFunction(() => (document.getElementById('city-district')?.textContent ?? '') === 'The Heights', undefined, { timeout: 10_000 }).catch(() => undefined);
    check(((await dani.textContent('#city-district')) ?? '') === 'The Heights', 'the HUD names the district you are in');
    await dani.waitForTimeout(1500);
    await dani.screenshot({ path: `${shots}city-heights.png` });
    // Both meet on a Low Tide street, where fights are allowed.
    const street = ROUGH_STREETS.find((p) => districtAt(p)?.id === 'lowtide' && ROUGH_STREETS.some((q) => q.x === p.x + 1 && q.y === p.y));
    const rookId = [...(room?.state.players.entries() ?? [])].find(([, p]) => p.name === 'Rook')?.[0];
    const me = rookId === undefined ? undefined : room?.state.players.get(rookId);
    if (street !== undefined && me !== undefined && far !== undefined && daniId !== undefined) {
      me.x = street.x;
      me.y = street.y;
      far.x = street.x + 0.7;
      far.y = street.y;
      far.pocket = 150;
      room?.shieldOff(daniId);
      const nearby = ROUGH_STREETS.find((q) => Math.hypot(q.x - street.x, q.y - street.y) > 1.4 && Math.hypot(q.x - street.x, q.y - street.y) < 2.6);
      if (nearby !== undefined) room?.dropCoins(nearby.x, nearby.y, 260);
    }
    await rook.waitForFunction(() => document.getElementById('city-zone')?.dataset['rough'] === 'true', undefined, { timeout: 10_000 }).catch(() => undefined);
    check(!(await rook.isDisabled('#city-punch')), `rough streets enable punching (${(await rook.textContent('#city-zone')) ?? ''})`);
    await rook.waitForTimeout(800);
    for (let i = 0; i < 4; i++) {
      await rook.keyboard.press('f');
      if (i === 1) await rook.screenshot({ path: `${shots}city-fight.png` });
      await rook.waitForTimeout(PUNCH_COOLDOWN_MS + 80);
    }
    await dani.locator('#city-down').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    check(await dani.isVisible('#city-down'), 'four punches knock the other guardian out');
    await rook.waitForFunction(() => document.getElementById('city-pocket')?.textContent === '150', undefined, { timeout: 5_000 }).catch(() => undefined);
    check(((await rook.textContent('#city-pocket')) ?? '') === '150', `the winner scoops up the dropped pocket (${(await rook.textContent('#city-pocket')) ?? ''})`);
    await rook.screenshot({ path: `${shots}city-knockout.png` });
    await dani.screenshot({ path: `${shots}city-down-phone.png` });
    // Carry the winnings to the Mint Hall door and put them in the vault.
    if (me !== undefined) {
      me.x = VAULT_DOOR.x;
      me.y = VAULT_DOOR.y;
    }
    await rook.locator('#city-deposit').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(await rook.isVisible('#city-deposit'), 'the vault button appears at the Mint Hall door');
    await rook.waitForTimeout(1200);
    await rook.screenshot({ path: `${shots}city-vault.png` });
    await rook.keyboard.press('e');
    await rook.waitForFunction(() => document.getElementById('city-pocket')?.textContent === '0', undefined, { timeout: 5_000 }).catch(() => undefined);
    check(((await rook.textContent('#city-pocket')) ?? '') === '0', 'vaulting empties the pocket');
    const vaulted = await rook.waitForFunction(() => document.body.textContent.includes('Vaulted 150 play sats'), undefined, { timeout: 5_000 }).then(() => true).catch(() => false);
    check(vaulted, 'the vault confirms the deposit into the wallet');
    await rook.click('#city-leave');
    await rook.locator('#menu').waitFor({ state: 'visible', timeout: 10_000 });
    check(true, 'back to the menu from the city');
    check(errors.length === 0, `no console errors${errors.length > 0 ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser?.close();
    await web?.close();
    await game.server.gracefullyShutdown(false).catch(() => undefined);
    await rm(`${clientRoot}/${OUT}`, { recursive: true, force: true });
  }
  if (failures > 0) {
    console.log(`${String(failures)} check(s) failed`);
    process.exit(1);
  }
  console.log('city: ok');
  process.exit(0);
}

await main();
