// Beach Town end to end: production build, real server, headless Brave. A guest whose profile has
// opened the island visits town, walks to a stall, buys a hat with chosen notes and takes a parcel.
// Run: npx tsx --conditions=source e2e/beach.ts
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../apps/server/src/app.js';
import { MemoryProfileStore, type ProfileData } from '../apps/server/src/profile/store.js';
import { findPath } from '../packages/shared/src/pathfinding.js';
import { BEACH_MAP, atHome, homeDoor } from '../packages/shared/src/hub/index.js';
import type { Change, ChangeOutcome } from '../apps/server/src/profile/store.js';
import { SHOTS, check, checkNoErrors, collectErrors, finish, openRig, type Rig } from './harness.js';

// BEACH_VIEWPORT=phone runs the same visit on a 390 px touch screen (its own ports and build folder).
const PHONE = process.env['BEACH_VIEWPORT'] === 'phone';
const GAME_PORT = PHONE ? 3948 : 3946;
const WEB_PORT = PHONE ? 3949 : 3947;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const OUT = PHONE ? 'dist-beach-phone' : 'dist-beach';
const EMOTE_SHOTS = fileURLToPath(new URL('../production/qa/evidence/emotes/', import.meta.url));
const SHOT = (name: string): string => `${SHOTS}${PHONE ? 'phone-' : ''}${name}`;

// Every guest arrives with four Academy stars, which opens Beach Town.
class OpenedStore extends MemoryProfileStore {
  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) => fn(data.progress.academy.some((s) => s > 0) ? data : { ...data, progress: { ...data.progress, academy: data.progress.academy.map((_, i) => (i < 2 ? 2 : 0)) } }));
  }
}


async function main(): Promise<void> {
  const game = createGameServer({
    allowedOrigins: new Set([WEB]),
    ipPolicy: { trustedProxies: new Set() },
    gracefullyShutdown: false,
    profiles: { store: new OpenedStore(), keys: { current: randomBytes(32), previous: null, secure: false } },
  });
  let rig: Rig | undefined;
  try {
    await game.listen(GAME_PORT, '127.0.0.1');
    rig = await openRig({ outDir: OUT, webPort: WEB_PORT, serverUrl: `http://127.0.0.1:${String(GAME_PORT)}` });
    const { browser } = rig;
    const page = await browser.newPage({ locale: 'en-US', ...(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } }) });
    const errors: string[] = [];
    collectErrors(page, errors);
    await page.goto(`${WEB}/`);
    await page.fill('#nickname', 'Mara');
    await page.locator('#open-progress').waitFor({ state: 'visible', timeout: 10_000 });
    // Open the island map, choose Beach Town, then visit.
    await page.click('#open-world');
    await page.locator('#world').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('.world-svg .island.open[aria-label^="Beach Town"]').click();
    const visit = page.locator('.world-visit');
    check(await visit.isVisible(), 'the Beach Town card offers a visit once the island is open');
    await visit.click();
    await page.locator('#beach-hud').waitFor({ state: 'visible', timeout: 10_000 });
    check(((await page.textContent('#beach-wallet')) ?? '').includes('500'), 'the wallet shows 500 play sats');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: SHOT('beach-town.png') });

    // Walk up the screen (up and left together) toward the Hats & Shades stall until its counter prompt shows.
    let atStall = false;
    for (let i = 0; i < 20 && !atStall; i++) {
      await page.keyboard.down('ArrowUp');
      await page.keyboard.down('ArrowLeft');
      await page.waitForTimeout(150);
      await page.keyboard.up('ArrowLeft');
      await page.keyboard.up('ArrowUp');
      atStall = await page.locator('#beach-prompt').isVisible();
    }
    check(atStall, 'walking to a stall shows its counter prompt');
    const stall = (await page.textContent('#beach-prompt-text')) ?? '';
    await page.screenshot({ path: SHOT('beach-stall.png') });

    await page.click('#beach-shop');
    await page.locator('#shop').waitFor({ state: 'visible' });
    const buy = page.locator('#shop-items .shop-item button.cta').first();
    check(await buy.isVisible(), `the ${stall.split(' · ')[0] ?? 'stall'} sells something`);
    await buy.click();
    // Pick notes largest first until the picker says they cover the price, as a player would.
    let status = '';
    const notes = page.locator('#shop-notes button');
    for (let i = 0; i < (await notes.count()); i++) {
      await notes.nth(i).click();
      status = (await page.textContent('#shop-pay-status')) ?? '';
      if (status.startsWith('That covers it') || status.startsWith('Exact')) break;
    }
    check(status.startsWith('That covers it') || status.startsWith('Exact'), `the note picker explains the payment (${status})`);
    await page.screenshot({ path: SHOT('beach-pay.png') });
    await page.click('#shop-pay-go');
    await page.waitForFunction(() => !(document.getElementById('beach-wallet')?.textContent ?? '').includes('500'), undefined, { timeout: 8000 });
    check(true, `buying spends notes and updates the wallet (${(await page.textContent('#beach-wallet')) ?? ''})`);
    await page.click('#shop-close');

    // Wear what was bought, right there in town.
    await page.click('#beach-wardrobe');
    await page.locator('#wardrobe').waitFor({ state: 'visible' });
    const hatChip = page.locator('#wardrobe .wardrobe-slot').first().locator('button.wardrobe-chip').nth(1);
    await hatChip.click();
    await page.waitForFunction(() => document.querySelector('#wardrobe .wardrobe-slot .wardrobe-chip.worn span:last-child')?.textContent !== 'Nothing', undefined, { timeout: 5000 });
    check(true, 'the new hat can be worn from the Beach Town wardrobe');
    await page.click('#wardrobe-close');
    await page.waitForTimeout(800);
    await page.screenshot({ path: SHOT('beach-hat.png') });

    await page.click('#beach-job-action');
    await page.waitForFunction(() => (document.getElementById('beach-job')?.textContent ?? '').startsWith('Carrying a parcel'), undefined, { timeout: 5000 });
    check(true, 'a courier job starts at the counter');
    await page.waitForTimeout(800);
    await page.screenshot({ path: SHOT('beach-parcel.png') });

    await mkdir(EMOTE_SHOTS, { recursive: true });
    for (const [key, name] of PHONE ? ([['2', 'cheer']] as const) : ([['1', 'wave'], ['2', 'cheer'], ['3', 'dance'], ['4', 'heart'], ['5', 'laugh'], ['6', 'shaka']] as const)) {
      await page.keyboard.press(key);
      await page.waitForTimeout(name === 'cheer' ? 350 : 600);
      if (!PHONE) await page.screenshot({ path: `${EMOTE_SHOTS}${name}.png`, clip: { x: 440, y: 160, width: 400, height: 300 } });
      await page.waitForTimeout(2_000);
    }
    await page.screenshot({ path: SHOT('beach-cheer.png') });
    check(true, 'each emote is acted out');

    // Walk down the shore to the guardian's own hut; its porch offers the wardrobe and the Chronicle.
    const homePrompt = async (): Promise<boolean> => (await page.locator('#beach-prompt').isVisible()) && ((await page.textContent('#beach-prompt-text')) ?? '').startsWith('Your hut');
    const where = (): Promise<{ x: number; y: number } | null> => page.evaluate(() => (window as unknown as { __bcBeachPos?: () => { x: number; y: number } | null }).__bcBeachPos?.() ?? null);
    let atHut = false;
    for (let i = 0; i < 120 && !atHut; i++) {
      const pos = await where();
      if (pos === null) break;
      // Steer along a real path: screen direction toward the next waypoint, as a player would with the arrows.
      const route = findPath(BEACH_MAP, pos, homeDoor());
      const next = (route.ok ? route.value : []).find((p) => Math.hypot(p.x - pos.x, p.y - pos.y) > 0.35) ?? homeDoor();
      // The arrow keys follow the world axes: right and left along x, down and up along y.
      const sx = next.x - pos.x;
      const sy = next.y - pos.y;
      const len = Math.hypot(sx, sy) || 1;
      const keys = [...(Math.abs(sx) / len > 0.38 ? [sx > 0 ? 'ArrowRight' : 'ArrowLeft'] : []), ...(Math.abs(sy) / len > 0.38 ? [sy > 0 ? 'ArrowDown' : 'ArrowUp'] : [])];
      for (const k of keys) await page.keyboard.down(k);
      await page.waitForTimeout(110);
      for (const k of keys) await page.keyboard.up(k);
      atHut = atHome(pos) && (await homePrompt());
    }
    if (!atHut) atHut = await homePrompt();
    check(atHut, 'walking to the hut porch shows the home prompt');
    await page.waitForTimeout(600);
    await page.screenshot({ path: SHOT('beach-hut.png') });
    await page.click('#beach-job-action');
    await page.locator('#story').waitFor({ state: 'visible', timeout: 5000 });
    check(true, 'the hut opens the Chronicle');
    await page.click('#story-close');
    await page.locator('#story').waitFor({ state: 'hidden', timeout: 5000 });

    await page.click('#beach-leave');
    await page.locator('#menu').waitFor({ state: 'visible', timeout: 5000 });
    check(true, 'leaving returns to the map');
    checkNoErrors(errors);
  } finally {
    await rig?.close();
    await game.server.gracefullyShutdown(false).catch(() => undefined);
  }
  finish('beach');
}

await main();
