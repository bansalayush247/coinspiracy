// Act one, The Dump, end to end: production build, real server, headless Brave. A guest opens the story from the
// menu, answers Mr Pell, Dani and Mags with the keyboard, digs the right heap at Gullmoor tip at night, asks Dani
// nicely, and reaches the end card with the reward. The server is only used to skip the long walks.
// Run: npx tsx --conditions=source e2e/story.ts
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { matchMaker } from '@colyseus/core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build, preview, type PreviewServer } from 'vite';
import { CITY_MAP, DANI_SPOT, GATE_SPOT, HEAPS, canDig } from '@byzantine-council/shared/city';
import { canStand } from '@byzantine-council/shared/pathfinding';
import { createGameServer } from '../apps/server/src/app.js';
import type { MissionRoom } from '../apps/server/src/city/MissionRoom.js';
import { MemoryProfileStore } from '../apps/server/src/profile/store.js';

const clientRoot = fileURLToPath(new URL('../apps/client', import.meta.url));
const shots = fileURLToPath(new URL('../.scratch/e2e/', import.meta.url));
const GAME_PORT = 3958;
const WEB_PORT = 3959;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const BRAVE = process.env['BRAVE_PATH'] ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const OUT = 'dist-story';

let failures = 0;
function check(ok: boolean, label: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

async function until(test: () => boolean, label: string, timeoutMs = 20_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (test()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`  (timed out waiting for ${label})`);
  return false;
}

async function open(browser: Browser, name: string, viewport: { width: number; height: number }, errors: string[]): Promise<{ page: Page; room: MissionRoom }> {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  await page.goto(`${WEB}/`);
  await page.locator('#open-story').waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.locator('#nickname').fill(name);
  const before = new Set((await matchMaker.query({ name: 'mission' })).map((r) => r.roomId));
  await page.click('#open-story');
  await page.locator('#story-hud').waitFor({ state: 'visible', timeout: 15_000 });
  let room: MissionRoom | undefined;
  await until(() => {
    void matchMaker.query({ name: 'mission' }).then((list) => {
      const id = list.find((r) => !before.has(r.roomId))?.roomId;
      if (id !== undefined) room = matchMaker.getLocalRoomById(id) as MissionRoom | undefined;
    });
    return room !== undefined;
  }, 'the mission room');
  if (room === undefined) throw new Error('no mission room');
  return { page, room };
}

async function answer(page: Page, room: MissionRoom, node: string, key: number): Promise<void> {
  await until(() => room.state.node === node, node);
  await page.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.keyboard.press(String(key));
}

// Presses Space until the scene moves past this node.
async function read(page: Page, room: MissionRoom, node: string): Promise<void> {
  await until(() => room.state.node === node, node);
  const seq = room.state.seq;
  for (let i = 0; i < 80 && room.state.seq === seq && room.state.node === node; i++) {
    await page.keyboard.press(' ');
    await page.waitForTimeout(150);
  }
}

const digSpot = (heap: number): { x: number; y: number } => {
  const h = HEAPS[heap];
  if (h === undefined) throw new Error('heap');
  for (const [dc, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
    const p = { x: h.tile[0] + dc + 0.5, y: h.tile[1] + dr + 0.5 };
    if (canStand(CITY_MAP, p) && canDig(p, h)) return p;
  }
  throw new Error('no spot');
};

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

    const { page, room } = await open(browser, 'Rook', { width: 1280, height: 800 }, errors);
    await until(() => room.state.node === 'pell', 'Pell calls');
    await page.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 20_000 });
    check((await page.textContent('#story-log'))?.includes('Forty thousand by Friday') === true, 'Mr Pell rings with the deadline');
    await page.screenshot({ path: `${shots}story-call.png` });
    await answer(page, room, 'pell', 2);
    const remembered = await page.waitForFunction(() => document.getElementById('story-log')?.textContent.includes('Mr Pell will remember that.') === true, undefined, { timeout: 10_000 }).then(() => true).catch(() => false);
    check(remembered, 'Pell will remember the promise');
    await read(page, room, 'pellPromise');
    await read(page, room, 'pellEnd');
    await until(() => room.state.step === 'toDani', 'off to Dani');
    await page.waitForTimeout(600);
    check(((await page.textContent('#story-objective')) ?? '').includes('Hospital'), 'the objective sends Rook to the hospital');
    check(await page.isHidden('#story-talk'), 'the story panel closes between scenes');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowUp');
    await page.screenshot({ path: `${shots}story-night.png` });

    room.teleport(DANI_SPOT.x, DANI_SPOT.y + 1);
    await answer(page, room, 'dani', 2);
    await read(page, room, 'daniStraight');
    await answer(page, room, 'reveal', 1);
    await until(() => room.state.node === 'daniCalm', 'calm');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shots}story-dani.png` });
    check(((await page.textContent('#story-clues')) ?? '').includes('winter 2013'), 'the winter clue is written down');
    await read(page, room, 'daniCalm');
    await read(page, room, 'hook');
    await until(() => room.state.step === 'toTip', 'off to the tip');

    room.teleport(GATE_SPOT.x, GATE_SPOT.y + 1);
    await until(() => room.state.node === 'mags', 'Mags');
    await page.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 20_000 });
    await page.screenshot({ path: `${shots}story-mags.png` });
    await answer(page, room, 'mags', 3);
    await read(page, room, 'magsPay');
    await read(page, room, 'magsWinter');
    await read(page, room, 'magsRules');
    await until(() => room.state.step === 'dig', 'digging');
    room.teleport(20.5, 29.5);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shots}story-patrol.png` });
    check(room.state.caught === 0, 'watching the patrol from the edge of the yard is safe');
    room.quietNight();
    const spot = digSpot(room.deviceHeap);
    room.teleport(spot.x, spot.y);
    await page.locator('#story-dig').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(await page.isVisible('#story-dig'), 'a dig button appears beside a heap');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${shots}story-tip.png` });
    await page.keyboard.press('e');
    await until(() => room.state.step === 'found', 'the device');
    check(room.state.step === 'found', 'digging the right heap finds the device');

    await answer(page, room, 'crushed', 1);
    await read(page, room, 'crushedKeep');
    await read(page, room, 'slip');
    await answer(page, room, 'ask', 2);
    await read(page, room, 'askDemand');
    await answer(page, room, 'ask', 1);
    await read(page, room, 'given');
    await until(() => room.state.node === 'selfie', 'selfie');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${shots}story-call-back.png` });
    await read(page, room, 'selfie');
    await page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(await page.isVisible('#story-end'), 'the end card appears');
    check(((await page.textContent('#story-reward')) ?? '').includes('+250 play sats'), `the first finish pays (${(await page.textContent('#story-reward')) ?? ''})`);
    check(((await page.textContent('#story-remembers')) ?? '').includes('Dani remembers'), 'the end card lists what Dani remembers');
    await page.screenshot({ path: `${shots}story-end.png` });
    await page.click('#story-end-leave');
    await page.locator('#menu').waitFor({ state: 'visible', timeout: 10_000 });
    check(true, 'back to the menu after the story');

    const phone = await open(browser, 'Ivy', { width: 390, height: 844 }, errors);
    await until(() => phone.room.state.node === 'pell', 'Pell calls on the phone');
    await phone.page.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 20_000 });
    await phone.page.screenshot({ path: `${shots}story-phone.png` });
    check(true, 'the story plays on a phone screen');
    await phone.page.click('#story-leave');
    await phone.page.locator('#menu').waitFor({ state: 'visible', timeout: 10_000 });

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
  console.log('story: ok');
  process.exit(0);
}

await main();
