// Port Concord end to end: production build, real server, headless Brave. Two guests enter the open city,
// see each other at the seafront, walk, stream in new chunks of the map, lose sight of each other far apart,
// then meet on the rough streets of Low Tide for a fight that ends in a knockout, and the winner vaults the coins.
// Run: npx tsx --conditions=source e2e/city.ts
import { randomBytes } from 'node:crypto';
import { type Browser, type Page } from 'playwright-core';
import { createGameServer } from '../apps/server/src/app.js';
import type { CityRoom } from '../apps/server/src/city/CityRoom.js';
import { CITY_MAP, PUNCH_COOLDOWN_MS, ROUGH_STREETS, VAULT_DOOR, districtAt } from '@byzantine-council/shared/city';
import { canStand } from '@byzantine-council/shared/pathfinding';
import { MemoryProfileStore } from '../apps/server/src/profile/store.js';
import { matchMaker } from '@colyseus/core';
import { SHOTS, check, checkNoErrors, collectErrors, finish, openRig, type Rig } from './harness.js';

const GAME_PORT = 3956;
const WEB_PORT = 3957;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const OUT = 'dist-city';


type Pos = { x: number; y: number } | null;
const pos = (page: Page): Promise<Pos> => page.evaluate(() => (window as unknown as { __bcCityPos?: () => Pos }).__bcCityPos?.() ?? null);
const chunks = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __bcCityChunks?: () => number }).__bcCityChunks?.() ?? 0);
const population = (page: Page): Promise<string> => page.textContent('#city-pop').then((t) => t ?? '');

async function enter(browser: Browser, name: string, viewport: { width: number; height: number }, errors: string[]): Promise<Page> {
  const page = await browser.newPage({ viewport, locale: 'en-US' });
  collectErrors(page, errors, name);
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
  let rig: Rig | undefined;
  try {
    await game.listen(GAME_PORT, '127.0.0.1');
    rig = await openRig({ outDir: OUT, webPort: WEB_PORT, serverUrl: `http://127.0.0.1:${String(GAME_PORT)}` });
    const { browser } = rig;
    const errors: string[] = [];
    const rook = await enter(browser, 'Rook', { width: 1280, height: 800 }, errors);
    const dani = await enter(browser, 'Dani', { width: 390, height: 844 }, errors);
    await rook.waitForFunction(() => (document.getElementById('city-pop')?.textContent ?? '').startsWith('2 in the city · 1 nearby'), undefined, { timeout: 10_000 });
    check(true, `both guardians arrive together (${await population(rook)})`);
    check(((await rook.textContent('#city-district')) ?? '') === 'Saltmarket', 'arrival is on the Saltmarket seafront');
    check((await chunks(rook)) >= 4, `map chunks streamed in around the camera (${String(await chunks(rook))})`);
    check(((await rook.textContent('#city-zone')) ?? '') === 'Safe streets' && (await rook.getAttribute('#city-punch', 'aria-disabled')) === 'true', 'the seafront is safe: no punching');
    await rook.keyboard.press('f');
    const told = await rook.waitForFunction(() => document.body.textContent.includes('Safe streets: no fighting here'), undefined, { timeout: 5_000 }).then(() => true).catch(() => false);
    check(told, 'punching on safe streets says where brawls happen');
    await rook.screenshot({ path: `${SHOTS}city-arrive.png` });
    await dani.screenshot({ path: `${SHOTS}city-phone.png` });
    // Walk up the screen (up and left together) into the city for a few seconds.
    const before = await pos(rook);
    await rook.keyboard.down('ArrowUp');
    await rook.keyboard.down('ArrowLeft');
    await rook.waitForTimeout(3500);
    await rook.keyboard.up('ArrowLeft');
    await rook.keyboard.up('ArrowUp');
    await rook.waitForTimeout(500);
    const after = await pos(rook);
    const moved = before !== null && after !== null ? Math.hypot(after.x - before.x, after.y - before.y) : 0;
    check(moved > 4, `walking moves the guardian through the streets (${moved.toFixed(1)} tiles)`);
    await rook.screenshot({ path: `${SHOTS}city-walk.png` });
    const harbourRoom = matchMaker.getLocalRoomById((await matchMaker.query({ name: 'city' }))[0]?.roomId ?? '') as CityRoom | undefined;
    const walker = [...(harbourRoom?.state.players.values() ?? [])].find((p) => p.name === 'Rook');
    type Snap = { ships: { kind: string; x: number; y: number; shown: boolean }[]; carsShown: number; carsMoving: number } | null;
    const traffic = (): Promise<Snap> => rook.evaluate(() => (window as unknown as { __bcTraffic?: () => Snap }).__bcTraffic?.() ?? null);
    const first = await traffic();
    check((first?.carsMoving ?? 0) > 10, `cars drive the roads (${String(first?.carsMoving ?? 0)} moving)`);
    const ferry = first?.ships.find((sh) => sh.kind === 'ferry');
    if (walker !== undefined && ferry !== undefined) {
      const x = Math.min(118, Math.max(46, Math.floor(ferry.x))) + 0.5;
      const shore = [102, 101, 100, 99, 98, 97, 96, 95, 94].map((y) => ({ x, y: y + 0.5 })).find((p) => canStand(CITY_MAP, p)) ?? { x: 61.5, y: 96.5 };
      walker.x = shore.x;
      walker.y = shore.y;
      await rook.waitForTimeout(2500);
      const later = (await traffic())?.ships.find((sh) => sh.kind === 'ferry');
      check(later !== undefined && later.shown && Math.hypot(later.x - ferry.x, later.y - ferry.y) > 1, 'the ferry sails past the seafront');
      await rook.screenshot({ path: `${SHOTS}city-harbour.png` });
      walker.x = 61.5;
      walker.y = 96.5;
      await rook.waitForTimeout(1500);
    }
    const parked = harbourRoom?.carList()[0];
    if (walker !== undefined && parked !== undefined) {
      const beside = [Math.PI / 2, -Math.PI / 2].map((a) => ({ x: parked.x + Math.cos(parked.heading + a), y: parked.y + Math.sin(parked.heading + a) })).find((p) => canStand(CITY_MAP, p)) ?? { x: parked.x, y: parked.y + 1 };
      walker.x = beside.x;
      walker.y = beside.y;
      await rook.locator('#city-ride').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
      check(await rook.isVisible('#city-ride'), 'a "Get in" button appears beside a parked car');
      await rook.keyboard.press('e');
      await rook.waitForFunction(() => document.getElementById('city-ride')?.textContent.startsWith('Get out') === true, undefined, { timeout: 5_000 }).catch(() => undefined);
      check(walker.car === parked.id, 'pressing E gets into the car');
      const from = { x: walker.x, y: walker.y };
      await rook.keyboard.down('ArrowUp');
      await rook.waitForTimeout(1400);
      await rook.screenshot({ path: `${SHOTS}city-drive.png` });
      await rook.waitForTimeout(1000);
      await rook.keyboard.up('ArrowUp');
      const drove = Math.hypot(walker.x - from.x, walker.y - from.y);
      check(drove > 3, `holding the gas drives the car down the street (${drove.toFixed(1)} tiles)`);
      await rook.waitForTimeout(1200);
      await rook.keyboard.press('e');
      await rook.waitForTimeout(400);
      check(walker.car === '', 'pressing E again gets out');
      walker.x = 61.5;
      walker.y = 96.5;
      await rook.waitForTimeout(1200);
    }
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
    await dani.screenshot({ path: `${SHOTS}city-heights.png` });
    const soloId = [...(room?.state.players.entries() ?? [])].find(([, p]) => p.name === 'Rook')?.[0];
    const solo = soloId === undefined ? undefined : room?.state.players.get(soloId);
    const tough = room?.toughs().find((t) => !t.bully);
    const toughBody = tough === undefined ? undefined : room?.state.players.get(tough.id);
    if (solo !== undefined && soloId !== undefined && toughBody !== undefined) {
      solo.x = toughBody.x;
      solo.y = toughBody.y + 0.6;
      room?.shieldOff(soloId);
      await rook.waitForTimeout(1200);
      for (let i = 0; i < 4; i++) {
        solo.x = toughBody.x;
        solo.y = toughBody.y + 0.6;
        await rook.keyboard.press('f');
        if (i === 2) await rook.screenshot({ path: `${SHOTS}city-tough.png` });
        await rook.waitForTimeout(PUNCH_COOLDOWN_MS + 80);
      }
    }
    const purse = await rook.waitForFunction(() => Number(document.getElementById('city-pocket')?.textContent ?? '0') > 0, undefined, { timeout: 5_000 }).then(() => true).catch(() => false);
    check(purse && toughBody?.down === true, `alone on the rough streets, a street tough goes down and drops a purse (${(await rook.textContent('#city-pocket')) ?? ''})`);
    room?.toughsOff();
    if (solo !== undefined) solo.pocket = 0;
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
    check((await rook.getAttribute('#city-punch', 'aria-disabled')) === 'false', `rough streets enable punching (${(await rook.textContent('#city-zone')) ?? ''})`);
    await rook.waitForTimeout(800);
    for (let i = 0; i < 4; i++) {
      await rook.keyboard.press('f');
      if (i === 1) await rook.screenshot({ path: `${SHOTS}city-fight.png` });
      await rook.waitForTimeout(PUNCH_COOLDOWN_MS + 80);
    }
    await dani.locator('#city-down').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    check(await dani.isVisible('#city-down'), 'four punches knock the other guardian out');
    await rook.waitForFunction(() => document.getElementById('city-pocket')?.textContent === '150', undefined, { timeout: 5_000 }).catch(() => undefined);
    check(((await rook.textContent('#city-pocket')) ?? '') === '150', `the winner scoops up the dropped pocket (${(await rook.textContent('#city-pocket')) ?? ''})`);
    await rook.screenshot({ path: `${SHOTS}city-knockout.png` });
    await dani.screenshot({ path: `${SHOTS}city-down-phone.png` });
    // Carry the winnings to the Mint Hall door and put them in the vault.
    if (me !== undefined) {
      me.x = VAULT_DOOR.x;
      me.y = VAULT_DOOR.y;
    }
    await rook.locator('#city-deposit').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(await rook.isVisible('#city-deposit'), 'the vault button appears at the Mint Hall door');
    await rook.waitForTimeout(1200);
    await rook.screenshot({ path: `${SHOTS}city-vault.png` });
    await rook.keyboard.press('e');
    await rook.waitForFunction(() => document.getElementById('city-pocket')?.textContent === '0', undefined, { timeout: 5_000 }).catch(() => undefined);
    check(((await rook.textContent('#city-pocket')) ?? '') === '0', 'vaulting empties the pocket');
    const vaulted = await rook.waitForFunction(() => document.body.textContent.includes('Vaulted 150 play sats'), undefined, { timeout: 5_000 }).then(() => true).catch(() => false);
    check(vaulted, 'the vault confirms the deposit into the wallet');
    await rook.click('#city-leave');
    await rook.locator('#menu').waitFor({ state: 'visible', timeout: 10_000 });
    check(true, 'back to the menu from the city');
    checkNoErrors(errors);
  } finally {
    await rig?.close();
    await game.server.gracefullyShutdown(false).catch(() => undefined);
  }
  finish('city');
}

await main();
