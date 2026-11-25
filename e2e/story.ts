// Act one, The Dump, end to end: production build, real server, headless Brave. A guest opens the story from the
// menu, answers Mr Pell, Dani and Mags with the keyboard, digs the right heap at Gullmoor tip at night, asks Dani
// nicely, and reaches the end card with the reward. Then a friend joins a crew from its invite link and the two
// split a vote, act two is played from the call to the lighthouse, and act three from the leak to Teo's confession
// and the council finale, act four to the season's end, all four acts of season two, and two side cases from the casebook. The server
// is only used to skip the walks.
// Run: npx tsx --conditions=source e2e/story.ts
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { matchMaker } from '@colyseus/core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build, preview, type PreviewServer } from 'vite';
import { AERIAL, HATCH, BOATS, COOP_YARD, HARBOUR_OFFICE, HALL_STEPS, SHOPKEEPERS, MARKET_MIDDLE, STALLS, BENNY_DOOR, BINS, KENNEL_SPOT, MARCO_DOOR, POPCORN_ACT, TOPPINGS, BREAKWATER, CITY_MAP, GENERATORS, MAST_SPOT, NONCE_SPOT, TERMINALS, TOWER_SPOT, DANI_SPOT, GATE_SPOT, GUARDIANS, HEAPS, IVY_SPOT, LIGHTHOUSE_DOOR, canDig } from '@byzantine-council/shared/city';
import { canStand, findPath } from '@byzantine-council/shared/pathfinding';
import { ROOM_NAME } from '@byzantine-council/shared';
import { createGameServer } from '../apps/server/src/app.js';
import type { MissionRoom } from '../apps/server/src/city/MissionRoom.js';
import { OverflowRules } from '../apps/server/src/city/acts/overflowRules.js';
import { MemoryProfileStore } from '../apps/server/src/profile/store.js';

const clientRoot = fileURLToPath(new URL('../apps/client', import.meta.url));
const shots = fileURLToPath(new URL('../.scratch/e2e/', import.meta.url));
const GAME_PORT = 3958;
const WEB_PORT = 3959;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const BRAVE = process.env['BRAVE_PATH'] ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const OUT = 'dist-story';

let failures = 0;
let latestCouncils = 0;
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

async function open(
  browser: Browser,
  name: string,
  viewport: { width: number; height: number },
  errors: string[],
  tile = '#open-story',
  caseTitle?: string,
): Promise<{ page: Page; room: MissionRoom }> {
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
  await page.click(tile);
  if (caseTitle !== undefined) {
    await page.locator('#cases').waitFor({ state: 'visible', timeout: 10_000 });
    await page.screenshot({ path: `${shots}casebook.png` });
    await page.locator('.cases-list .case', { hasText: caseTitle }).locator('button').click();
  }
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

// Skips the typing with Space, as a player would, then picks a choice by its number key.
async function answer(page: Page, room: MissionRoom, node: string, key: number): Promise<void> {
  await until(() => room.state.node === node, node);
  const choice = page.locator('.story-choice').first();
  for (let i = 0; i < 60 && !(await choice.isVisible()); i++) {
    await page.keyboard.press(' ');
    await page.waitForTimeout(250);
  }
  await choice.waitFor({ state: 'visible', timeout: 20_000 });
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
    const spot = digSpot(room.secretSpot);
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

    const lead = await open(browser, 'Ana', { width: 1280, height: 800 }, errors);
    await until(() => lead.room.state.code !== '', 'a crew code');
    const code = lead.room.state.code;
    await lead.page.waitForFunction((c) => document.getElementById('story-code')?.textContent.replace('-', '') === c, code, { timeout: 10_000 }).catch(() => undefined);
    check(((await lead.page.textContent('#story-code')) ?? '').replace('-', '') === code, 'the story bar shows the crew code');
    const friend = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    friend.on('pageerror', (e) => errors.push(`Bo: ${String(e)}`));
    friend.on('console', (m) => {
      if (m.type() === 'error') errors.push(`Bo: ${m.text()}`);
    });
    await friend.goto(`${WEB}/#join=${code}`);
    await friend.locator('#open-story').waitFor({ state: 'visible', timeout: 10_000 });
    await friend.keyboard.press('Escape');
    await friend.locator('#nickname').fill('Bo');
    check((await friend.inputValue('#room-code')).replace('-', '') === code, 'the invite link fills in the code');
    await friend.click('button[data-action="join"]');
    await friend.locator('#story-hud').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    check(await friend.isVisible('#story-hud'), 'the code opens the crew’s story, not a council room');
    await until(() => lead.room.state.players.size === 2, 'two in the crew');
    await lead.page.waitForFunction(() => document.querySelectorAll('#story-crew li').length === 2, undefined, { timeout: 10_000 }).catch(() => undefined);
    check(((await lead.page.textContent('#story-crew')) ?? '').includes('Bo'), 'the lead sees Bo in the crew');
    await until(() => lead.room.state.node === 'pell', 'Pell calls the crew');
    await lead.page.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 20_000 });
    await friend.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 20_000 });
    await lead.page.keyboard.press('1');
    await until(() => lead.room.state.votes.size === 1, 'the lead votes');
    await friend.waitForFunction(() => document.querySelector('.story-choice.voted') === null && (document.querySelector('.story-votes')?.textContent ?? '') !== '', undefined, { timeout: 5_000 }).catch(() => undefined);
    await friend.screenshot({ path: `${shots}story-crew-vote.png` });
    check(((await friend.textContent('#story-choices')) ?? '').includes('Ana'), 'Bo sees which way Ana voted');
    await friend.keyboard.press('2');
    await until(() => lead.room.state.node === 'pellJoke', 'the tie goes to the lead');
    check(lead.room.state.node === 'pellJoke', 'a split vote goes the lead’s way');
    const said = await friend.waitForFunction(() => document.getElementById('story-log')?.textContent.includes('I’m budgeting') === true, undefined, { timeout: 10_000 }).then(() => true).catch(() => false);
    check(said, 'Bo’s story log shows the line the crew chose');
    await friend.click('#story-leave');
    await friend.locator('#menu').waitFor({ state: 'visible', timeout: 10_000 });
    await until(() => lead.room.state.players.size === 1, 'Bo left');
    await lead.page.click('#story-leave');
    await lead.page.locator('#menu').waitFor({ state: 'visible', timeout: 10_000 });

    await Promise.all([page.close(), phone.page.close(), lead.page.close(), friend.close()]);
    const two = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-ransom');
    await until(() => two.room.state.node === 'ransom', 'the ransom call');
    check(two.room.state.act === 'ransom', 'the act two tile opens The Ransom Call');
    await two.page.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 20_000 });
    check(((await two.page.textContent('#story-eyebrow')) ?? '').includes('Act two'), 'the story bar names act two');
    await two.page.screenshot({ path: `${shots}ransom-call.png` });
    await answer(two.page, two.room, 'ransom', 1);
    await answer(two.page, two.room, 'proof', 1);
    await answer(two.page, two.room, 'proofAgain', 1);
    const heard = await two.page.waitForFunction(() => document.getElementById('story-clues')?.textContent.includes('recording') === true, undefined, { timeout: 10_000 }).then(() => true).catch(() => false);
    check(heard, 'catching the recording writes down the ferry horn clue');
    await read(two.page, two.room, 'caught');
    await read(two.page, two.room, 'callEnd');
    await until(() => two.room.state.step === 'toIvy', 'off to the Mint');
    two.room.teleport(IVY_SPOT.x, IVY_SPOT.y + 1);
    await answer(two.page, two.room, 'ivy', 3);
    await read(two.page, two.room, 'ivyHow');
    await read(two.page, two.room, 'ivyPlan');
    await until(() => two.room.state.step === 'sign', 'signing');
    two.room.quietNight();
    for (const i of [4, 0, 1, 2]) {
      const g = GUARDIANS[i];
      if (g === undefined) throw new Error('guardian');
      two.room.teleport(g.at.x, g.at.y + 1);
      await two.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Ask ${label}`) === true, g.label, { timeout: 10_000 }).catch(() => undefined);
      if (i === 4) {
        check(((await two.page.textContent('#story-dig')) ?? '').includes('Ask Wren to sign'), 'the button asks the guardian by name');
        await two.page.waitForTimeout(700);
        await two.page.screenshot({ path: `${shots}ransom-mint.png` });
      }
      await two.page.keyboard.press('e');
      await until(() => two.room.state.spots[i]?.done === true, `asked ${g.label}`);
      if (i === 0) check(((await two.page.textContent('#story-goal')) ?? '').includes('1 of 3'), 'Wren’s refusal doesn’t count; Osei’s signature does');
    }
    await until(() => two.room.state.node === 'locked', 'locked in');
    check(two.room.state.node === 'locked', 'three signatures lock the words into the federation');
    await read(two.page, two.room, 'locked');
    await read(two.page, two.room, 'lockedClue');
    await until(() => two.room.state.step === 'toLighthouse', 'off to the lighthouse');
    two.room.teleport(BREAKWATER.x, BREAKWATER.y);
    await read(two.page, two.room, 'breakwater');
    await until(() => two.room.state.step === 'sneak', 'sneaking');
    check(two.room.state.npcs.get('lookout1')?.shown === false, 'hearing the horn gets the crew there before the second lookout');
    await two.page.waitForTimeout(1500);
    await two.page.screenshot({ path: `${shots}ransom-breakwater.png` });
    two.room.teleport(LIGHTHOUSE_DOOR.x, LIGHTHOUSE_DOOR.y);
    await answer(two.page, two.room, 'door', 3);
    await read(two.page, two.room, 'doorLook');
    await until(() => two.room.state.node === 'brannDoor', 'Brannigan');
    await two.page.waitForTimeout(3000);
    await two.page.screenshot({ path: `${shots}ransom-door.png` });
    await read(two.page, two.room, 'brannDoor');
    await two.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await two.page.textContent('#story-end-title')) ?? '') === 'The Ransom Call', 'the end card is act two’s');
    check(((await two.page.textContent('#story-reward')) ?? '').includes('+300 play sats'), `act two pays its first finish (${(await two.page.textContent('#story-reward')) ?? ''})`);
    await two.page.screenshot({ path: `${shots}ransom-end.png` });
    await two.page.click('#story-end-leave');
    await two.page.locator('#menu').waitFor({ state: 'visible', timeout: 10_000 });

    const three = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-insider');
    await until(() => three.room.state.node === 'morning', 'Brannigan rings');
    check(three.room.state.act === 'insider', 'the act three tile opens The Insider');
    await answer(three.page, three.room, 'morning', 2);
    await read(three.page, three.room, 'morningGo');
    await read(three.page, three.room, 'morningEnd');
    await until(() => three.room.state.step === 'toNonce', 'off to Nonce');
    three.room.teleport(NONCE_SPOT.x, NONCE_SPOT.y + 0.5);
    await until(() => three.room.state.node === 'nonce', 'Nonce');
    await three.page.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 20_000 });
    await three.page.screenshot({ path: `${shots}insider-nonce.png` });
    await answer(three.page, three.room, 'nonce', 3);
    await read(three.page, three.room, 'nonceTruth');
    await read(three.page, three.room, 'nonceYacht');
    await read(three.page, three.room, 'nonceEnd');
    await until(() => three.room.state.step === 'toTower', 'off to the tower');
    three.room.teleport(TOWER_SPOT.x, TOWER_SPOT.y);
    await read(three.page, three.room, 'tower');
    await until(() => three.room.state.step === 'search', 'searching');
    check(((await three.page.textContent('#story-clues')) ?? '').includes('east side'), 'telling Nonce the truth gets the east-side clue');
    three.room.quietNight();
    const term = TERMINALS[three.room.secretSpot];
    if (term === undefined) throw new Error('terminal');
    three.room.teleport(term.at.x + 0.1, term.at.y + 0.6);
    await three.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Search the ${label} terminal`) === true, term.label, { timeout: 10_000 }).catch(() => undefined);
    await three.page.waitForTimeout(600);
    await three.page.screenshot({ path: `${shots}insider-tower.png` });
    await three.page.keyboard.press('e');
    await until(() => three.room.state.node === 'account', 'Teo’s account');
    check(three.room.state.node === 'account', 'the right terminal shows Teo’s frozen account');
    await three.page.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 30_000 });
    await three.page.screenshot({ path: `${shots}insider-teo.png` });
    await answer(three.page, three.room, 'account', 1);
    await read(three.page, three.room, 'teoTalk');
    await read(three.page, three.room, 'teoEnd');
    await three.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await three.page.textContent('#story-end-title')) ?? '') === 'The Insider', 'the end card is act three’s');
    check(((await three.page.textContent('#story-reward')) ?? '').includes('+350 play sats'), `act three pays its first finish (${(await three.page.textContent('#story-reward')) ?? ''})`);
    check(await three.page.isVisible('#story-finale'), 'the end card offers the signing ceremony');
    await three.page.screenshot({ path: `${shots}insider-end.png` });
    const councils = (await matchMaker.query({ name: ROOM_NAME })).length;
    await three.page.click('#story-finale');
    const opened = await until(() => {
      void matchMaker.query({ name: ROOM_NAME }).then((list) => {
        latestCouncils = list.length;
      });
      return latestCouncils > councils;
    }, 'a council room for the ceremony');
    check(opened, 'the finale button opens a private council room');
    const ceremonyRoom = (await matchMaker.query({ name: ROOM_NAME })).map((r) => matchMaker.getLocalRoomById(r.roomId) as { state?: { ceremony?: boolean } } | undefined).find((r) => r?.state?.ceremony === true);
    check(ceremonyRoom !== undefined, 'that room is the story’s signing ceremony');
    await three.page.locator('.toast').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    check(((await three.page.textContent('#toasts')) ?? '').includes('signing ceremony'), 'the ceremony briefs everyone who joins');

    await Promise.all([two.page.close(), three.page.close()]);
    const four = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-founder');
    await until(() => four.room.state.node === 'stick', 'the stick');
    check(four.room.state.act === 'founder', 'the act four tile opens The Founder’s Coins');
    await read(four.page, four.room, 'stick');
    await answer(four.page, four.room, 'quintCall', 3);
    await read(four.page, four.room, 'quintAsk');
    await read(four.page, four.room, 'sharpeRadio');
    await until(() => four.room.state.step === 'toMast', 'off to the mast');
    four.room.teleport(MAST_SPOT.x, MAST_SPOT.y);
    await read(four.page, four.room, 'blackout');
    await until(() => four.room.state.step === 'power', 'the generators');
    four.room.quietNight();
    for (const i of [0, 1, 2]) {
      const g = GENERATORS[i];
      if (g === undefined) throw new Error('generator');
      four.room.teleport(g.at.x, g.at.y);
      await four.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Restart the ${label} generator`) === true, g.label, { timeout: 10_000 }).catch(() => undefined);
      if (i === 0) {
        await four.page.waitForTimeout(600);
        await four.page.screenshot({ path: `${shots}founder-blackout.png` });
      }
      await four.page.keyboard.press('e');
      await until(() => four.room.state.spots[i]?.done === true, `restarted ${g.label}`);
    }
    await until(() => four.room.state.node === 'onAir', 'on air');
    check(four.room.state.node === 'onAir', 'three generators put the station back on air');
    await read(four.page, four.room, 'onAir');
    await read(four.page, four.room, 'nineMinutes');
    await until(() => four.room.state.node === 'theChoice', 'the choice');
    await four.page.locator('.story-choice').first().waitFor({ state: 'visible', timeout: 30_000 });
    check((await four.page.locator('.story-choice').count()) === 2, 'a crew that never asked for a cut sees only the Guardian and Burn endings');
    await four.page.screenshot({ path: `${shots}founder-choice.png` });
    await answer(four.page, four.room, 'theChoice', 2);
    await read(four.page, four.room, 'endBurn');
    await read(four.page, four.room, 'burnDani');
    await read(four.page, four.room, 'dawn');
    await until(() => four.room.state.node === 'voicemail', 'the voicemail');
    await four.page.waitForTimeout(4000);
    await four.page.screenshot({ path: `${shots}founder-voicemail.png` });
    await read(four.page, four.room, 'voicemail');
    await four.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await four.page.textContent('#story-end-title')) ?? '') === 'The Founder’s Coins', 'the end card is act four’s');
    check(((await four.page.textContent('#story-reward')) ?? '').includes('+500 play sats'), `the season finale pays its first finish (${(await four.page.textContent('#story-reward')) ?? ''})`);
    await four.page.screenshot({ path: `${shots}founder-end.png` });

    await four.page.close();
    const tin = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-cases', 'The Popcorn Tin');
    check(tin.room.state.act === 'popcorn', 'the casebook opens The Popcorn Tin');
    check((await tin.page.textContent('#story-eyebrow'))?.startsWith('Ripped from the ledger') === true, 'a side case is labelled as one');
    await answer(tin.page, tin.room, 'street', 1);
    await read(tin.page, tin.room, 'okaforPolite');
    await read(tin.page, tin.room, 'okaforBins');
    await read(tin.page, tin.room, 'streetEnd');
    await until(() => tin.room.state.step === 'search', 'the search');
    tin.room.teleport(100.5, 84.5);
    await tin.page.waitForTimeout(1800);
    await tin.page.screenshot({ path: `${shots}popcorn-yard.png` });
    tin.room.quietNight();
    const kennel = POPCORN_ACT.spots[KENNEL_SPOT]?.at ?? MARCO_DOOR;
    tin.room.teleport(kennel.x, kennel.y);
    await tin.page.waitForFunction(() => document.getElementById('story-dig')?.textContent.includes('Search the kennel') === true, undefined, { timeout: 10_000 }).catch(() => undefined);
    await tin.page.keyboard.press('e');
    await tin.page.waitForFunction(() => document.getElementById('toasts')?.textContent.includes('Biscuit is asleep') === true, undefined, { timeout: 5_000 }).catch(() => undefined);
    check(((await tin.page.textContent('#toasts')) ?? '').includes('Biscuit is asleep'), 'Biscuit won’t budge off the kennel at first');
    for (const spot of [BINS, KENNEL_SPOT]) {
      const at = POPCORN_ACT.spots[spot]?.at ?? kennel;
      tin.room.teleport(at.x, at.y);
      await tin.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Search the ${label}`) === true, POPCORN_ACT.spots[spot]?.label ?? '', { timeout: 10_000 }).catch(() => undefined);
      await tin.page.keyboard.press('e');
      await until(() => tin.room.state.spots[spot]?.done === true, `searched ${String(spot)}`);
    }
    await answer(tin.page, tin.room, 'tin', 1);
    await read(tin.page, tin.room, 'tinHand');
    await read(tin.page, tin.room, 'tinEnd');
    await tin.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await tin.page.textContent('#story-end-eyebrow')) ?? '') === 'Case closed', 'a side case ends with “Case closed”');
    check(((await tin.page.textContent('#story-reward')) ?? '').includes('+150 play sats'), `the case pays its first solve (${(await tin.page.textContent('#story-reward')) ?? ''})`);
    await tin.page.screenshot({ path: `${shots}popcorn-end.png` });
    await tin.page.click('#story-end-leave');
    await tin.page.locator('#open-cases').waitFor({ state: 'visible', timeout: 10_000 });
    await tin.page.click('#open-cases');
    await tin.page.locator('.cases-list .case.solved').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await tin.page.locator('.cases-list .case.solved').first().textContent()) ?? '').includes('The Popcorn Tin'), 'the casebook marks the case solved');
    check((await tin.page.locator('.cases-list .case').count()) === 6, 'the casebook lists six side cases');

    await tin.page.close();
    const pizza = await open(browser, 'Rook', { width: 390, height: 844 }, errors, '#open-cases', 'Pizza Night');
    await answer(pizza.page, pizza.room, 'notice', 1);
    await read(pizza.page, pizza.room, 'noticeDeal');
    await read(pizza.page, pizza.room, 'noticeEnd');
    await until(() => pizza.room.state.step === 'toppings', 'the toppings');
    for (const i of [0, 2, 3]) {
      const t = TOPPINGS[i];
      if (t === undefined) throw new Error('topping');
      pizza.room.teleport(t.at.x, t.at.y);
      await pizza.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Buy from the ${label}`) === true, t.label, { timeout: 10_000 }).catch(() => undefined);
      await pizza.page.keyboard.press('e');
      await until(() => pizza.room.state.spots[i]?.done === true, `bought ${t.label}`);
    }
    await until(() => pizza.room.state.step === 'toMarco', 'back to Marco');
    pizza.room.teleport(MARCO_DOOR.x, MARCO_DOOR.y);
    await read(pizza.page, pizza.room, 'oven');
    await until(() => pizza.room.state.step === 'deliver', 'the delivery');
    pizza.room.quietNight();
    const gull = pizza.room.state.npcs.get('gull0');
    pizza.room.teleport(gull?.x ?? 70, (gull?.y ?? 60.5) < 61.5 ? 62.6 : 60.5);
    await pizza.page.waitForTimeout(1500);
    await pizza.page.screenshot({ path: `${shots}pizza-gulls.png` });
    pizza.room.teleport(BENNY_DOOR.x, BENNY_DOOR.y);
    await answer(pizza.page, pizza.room, 'benny', 1);
    await read(pizza.page, pizza.room, 'bennyCoins');
    await read(pizza.page, pizza.room, 'later');
    await pizza.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await pizza.page.textContent('#story-end-title')) ?? '') === 'Pizza Night', 'Pizza Night plays to its end card on a phone');
    await pizza.page.screenshot({ path: `${shots}pizza-end.png` });

    await pizza.page.close();
    const s2 = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-overflow');
    check(s2.room.state.act === 'overflow', 'the season two tile opens The Overflow');
    await answer(s2.page, s2.room, 'hatch', 2);
    await read(s2.page, s2.room, 'hatchLeave');
    await read(s2.page, s2.room, 'hatchPhone');
    await until(() => s2.room.state.step === 'toMint', 'off to the Mint');
    s2.room.teleport(IVY_SPOT.x, IVY_SPOT.y);
    await answer(s2.page, s2.room, 'mint', 3);
    await read(s2.page, s2.room, 'mintDoubt');
    await read(s2.page, s2.room, 'mintEnd');
    await until(() => s2.room.state.step === 'verify', 'the stalls');
    const overflow = s2.room.rules;
    if (!(overflow instanceof OverflowRules)) throw new Error('not The Overflow');
    for (const i of overflow.bad) {
      const stall = STALLS[i];
      if (stall === undefined) throw new Error('stall');
      s2.room.teleport(stall.at.x, stall.at.y);
      await s2.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Check the notes at the ${label}`) === true, stall.label, { timeout: 10_000 }).catch(() => undefined);
      await s2.page.keyboard.press('e');
      await until(() => s2.room.state.spots[i]?.done === true, `checked ${stall.label}`);
    }
    await until(() => s2.room.state.step === 'chase', 'the chase');
    check(s2.room.state.step === 'chase', 'three bad notes set Ozzy running');
    s2.room.teleport(MARKET_MIDDLE.x + 4, MARKET_MIDDLE.y);
    await s2.page.waitForTimeout(1500);
    await s2.page.screenshot({ path: `${shots}overflow-chase.png` });
    const ozzy = s2.room.state.npcs.get('ozzy');
    s2.room.teleport(ozzy?.x ?? MARKET_MIDDLE.x, ozzy?.y ?? MARKET_MIDDLE.y);
    await until(() => s2.room.state.step === 'caught', 'caught up with Ozzy');
    await answer(s2.page, s2.room, 'caught', 1);
    await read(s2.page, s2.room, 'caughtReport');
    await read(s2.page, s2.room, 'fixed');
    await s2.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await s2.page.textContent('#story-end-title')) ?? '') === 'The Overflow', 'catching Ozzy and fixing the Mint ends season two’s first act');
    check(((await s2.page.textContent('#story-reward')) ?? '').includes('+300 play sats'), `it pays its first finish (${(await s2.page.textContent('#story-reward')) ?? ''})`);
    await s2.page.screenshot({ path: `${shots}overflow-end.png` });

    await s2.page.close();
    const split = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-split');
    check(split.room.state.act === 'split', 'the next tile opens The Split');
    await read(split.page, split.room, 'radio');
    await until(() => split.room.state.step === 'toHall', 'off to City Hall');
    split.room.teleport(HALL_STEPS.x, HALL_STEPS.y);
    await answer(split.page, split.room, 'hall', 1);
    await read(split.page, split.room, 'hallHear');
    await read(split.page, split.room, 'hallEnd');
    await until(() => split.room.state.step === 'canvass', 'the canvass');
    split.room.quietNight();
    for (const i of [3, 2, 1, 0, 5]) {
      const shop = SHOPKEEPERS[i];
      if (shop === undefined) throw new Error('shopkeeper');
      split.room.teleport(shop.at.x, shop.at.y);
      await split.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Talk to ${label}`) === true, shop.label, { timeout: 10_000 }).catch(() => undefined);
      await split.page.keyboard.press('e');
      await until(() => split.room.state.spots[i]?.done === true || split.room.state.step !== 'canvass', `won ${shop.label}`);
      if (i === 2) {
        await split.page.waitForTimeout(800);
        await split.page.screenshot({ path: `${shots}split-canvass.png` });
      }
    }
    await until(() => split.room.state.step === 'count', 'the count');
    check(split.room.state.step === 'count', 'five shopkeepers at once settle it');
    await answer(split.page, split.room, 'count', 1);
    await read(split.page, split.room, 'countLuck');
    await read(split.page, split.room, 'countEnd');
    await split.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await split.page.textContent('#story-end-title')) ?? '') === 'The Split', 'Rex forks off and season two’s second act ends');
    check(((await split.page.textContent('#story-reward')) ?? '').includes('+350 play sats'), `it pays its first finish (${(await split.page.textContent('#story-reward')) ?? ''})`);

    await split.page.close();
    const tide = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-receipt');
    check(tide.room.state.act === 'receipt', 'the next tile opens The Old Receipt');
    await answer(tide.page, tide.room, 'tower', 1);
    await read(tide.page, tide.room, 'towerThanks');
    await until(() => tide.room.state.step === 'toDocks', 'off to the docks');
    tide.room.teleport(COOP_YARD.x, COOP_YARD.y);
    await answer(tide.page, tide.room, 'coop', 1);
    for (let i = 0; i < 200 && tide.room.state.step !== 'search'; i++) {
      await tide.page.keyboard.press(' ');
      await tide.page.waitForTimeout(150);
    }
    await until(() => tide.room.state.step === 'search', 'the search');
    await tide.page.waitForFunction(() => document.getElementById('story-clock')?.textContent.startsWith('Tide turns in') === true, undefined, { timeout: 5_000 }).catch(() => undefined);
    check(((await tide.page.textContent('#story-clock')) ?? '').startsWith('Tide turns in'), 'the tide clock is counting down');
    tide.room.teleport(BOATS[1]?.at.x ?? COOP_YARD.x, (BOATS[1]?.at.y ?? COOP_YARD.y) + 1.5);
    await tide.page.waitForTimeout(1500);
    await tide.page.screenshot({ path: `${shots}receipt-jetty.png` });
    tide.room.quietNight();
    const boat = BOATS[tide.room.secretSpot];
    if (boat === undefined) throw new Error('boat');
    tide.room.teleport(boat.at.x, boat.at.y);
    await tide.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Search the ${label}`) === true, boat.label, { timeout: 10_000 }).catch(() => undefined);
    await tide.page.keyboard.press('e');
    await until(() => tide.room.state.step === 'deliver', 'the receipt');
    tide.room.teleport(HARBOUR_OFFICE.x, HARBOUR_OFFICE.y);
    await answer(tide.page, tide.room, 'office', 1);
    await read(tide.page, tide.room, 'officeMercy');
    await read(tide.page, tide.room, 'officeEnd');
    await tide.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await tide.page.textContent('#story-end-title')) ?? '') === 'The Old Receipt', 'the newer receipt beats the tide and ends season two’s third act');
    check(((await tide.page.textContent('#story-clock')) ?? '') === '', 'the tide clock is gone once it’s settled');
    await tide.page.close();

    const last = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-alert');
    check(last.room.state.act === 'alert', 'the next tile opens The Last Alert');
    await answer(last.page, last.room, 'tower', 1);
    await read(last.page, last.room, 'towerRisk');
    await read(last.page, last.room, 'towerGo');
    await until(() => last.room.state.step === 'toTip', 'off to the tip');
    last.room.teleport(GATE_SPOT.x, GATE_SPOT.y);
    await answer(last.page, last.room, 'hatch', 1);
    for (let i = 0; i < 200 && last.room.state.step !== 'escort'; i++) {
      await last.page.keyboard.press(' ');
      await last.page.waitForTimeout(150);
    }
    await until(() => last.room.state.step === 'escort', 'the walk');
    last.room.quietNight();
    const route = findPath(CITY_MAP, HATCH, AERIAL);
    if (!route.ok) throw new Error('no route');
    let from = { x: HATCH.x, y: HATCH.y };
    const hops = route.value.flatMap((to) => {
      const n = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 3);
      const a = from;
      from = to;
      return Array.from({ length: n }, (_, i) => ({ x: a.x + ((to.x - a.x) * (i + 1)) / n, y: a.y + ((to.y - a.y) * (i + 1)) / n }));
    });
    const mags = (): { x: number; y: number } => last.room.state.npcs.get('mags') ?? { x: 0, y: 0 };
    for (const [i, p] of hops.entries()) {
      last.room.teleport(p.x, p.y);
      await until(() => Math.hypot(mags().x - p.x, mags().y - p.y) <= 1.5 || last.room.state.step !== 'escort', 'Mags keeps up', 10_000);
      if (i === Math.floor(hops.length / 2)) await last.page.screenshot({ path: `${shots}alert-escort.png` });
    }
    await until(() => last.room.state.step === 'aerial', 'the aerial');
    check(last.room.state.step === 'aerial', 'Mags follows the lead across the tip to the old aerial');
    await answer(last.page, last.room, 'aerial', 1);
    for (const node of ['aerialRead', 'aerialRex', 'dawn']) await read(last.page, last.room, node);
    await last.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await last.page.textContent('#story-end-title')) ?? '') === 'The Last Alert', 'Mags reads the key out and season two ends');
    check(((await last.page.textContent('#story-reward')) ?? '').includes('+600 play sats'), `it pays its first finish (${(await last.page.textContent('#story-reward')) ?? ''})`);
    await last.page.close();

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
