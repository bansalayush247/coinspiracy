// Act one, The Dump, end to end: production build, real server, headless Brave. A guest opens the story from the
// menu, answers Mr Pell, Dani and Mags with the keyboard, digs the right heap at Gullmoor tip at night, asks Dani
// nicely, and reaches the end card with the reward. Then a friend joins a crew from its invite link and the two
// split a vote, act two is played from the call to the lighthouse, and act three from the leak to Teo's confession
// and the council finale, act four to the season's end, all four acts of season two, season three's first act, and two side cases from the casebook. The server
// is only used to skip the walks.
// Run: npx tsx --conditions=source e2e/story.ts
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { matchMaker } from '@colyseus/core';
import { type Browser, type Page } from 'playwright-core';
import { BOOK_POSTS, READING_TABLE, VOTE_S, DEE_SHOP, DESKS, OLIVE_SHOP, WATCH_AT, WATCH_RANGE, DOORS, AERIAL, HATCH, BOATS, COOP_YARD, HARBOUR_OFFICE, HALL_STEPS, SHOPKEEPERS, MARKET_MIDDLE, STALLS, BENNY_DOOR, BINS, KENNEL_SPOT, MARCO_DOOR, POPCORN_ACT, TOPPINGS, BREAKWATER, CITY_MAP, GENERATORS, MAST_SPOT, NONCE_SPOT, TERMINALS, TOWER_SPOT, DANI_SPOT, GATE_SPOT, GUARDIANS, HEAPS, IVY_SPOT, LIGHTHOUSE_DOOR, canDig } from '@byzantine-council/shared/city';
import { canStand, findPath } from '@byzantine-council/shared/pathfinding';
import { ROOM_NAME } from '@byzantine-council/shared';
import { createGameServer } from '../apps/server/src/app.js';
import { memoryFeedbackSink } from '../apps/server/src/feedback.js';
import type { MissionRoom } from '../apps/server/src/city/MissionRoom.js';
import { OverflowRules } from '../apps/server/src/city/acts/overflowRules.js';
import { MemoryProfileStore } from '../apps/server/src/profile/store.js';
import { SHOTS, check, checkNoErrors, collectErrors, finish, openRig, type Rig } from './harness.js';

const evidence = fileURLToPath(new URL('../production/qa/evidence/', import.meta.url));
const GAME_PORT = 3958;
const WEB_PORT = 3959;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const OUT = 'dist-story';

let latestCouncils = 0;

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
  const page = await browser.newPage({ viewport, locale: 'en-US' });
  collectErrors(page, errors, name);
  await page.goto(`${WEB}/`);
  await page.locator('#open-story').waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.locator('#nickname').fill(name);
  const before = new Set((await matchMaker.query({ name: 'mission' })).map((r) => r.roomId));
  await page.click(tile);
  if (caseTitle !== undefined) {
    await page.locator('#cases').waitFor({ state: 'visible', timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}casebook.png` });
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

// Reads a scene line by line with Space, as a player would, until its choices come up.
async function reachChoices(page: Page, timeoutMs = 20_000): Promise<void> {
  const choice = page.locator('.story-choice').first();
  const end = Date.now() + timeoutMs;
  while (!(await choice.isVisible()) && Date.now() < end) {
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
  }
  await choice.waitFor({ state: 'visible', timeout: 1_000 });
}

// Reads up to the choices, then picks one by its number key.
async function answer(page: Page, room: MissionRoom, node: string, key: number): Promise<void> {
  await until(() => room.state.node === node, node);
  await reachChoices(page);
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
  const feedback = memoryFeedbackSink();
  const game = createGameServer({ feedback: { sink: feedback }, allowedOrigins: new Set([WEB]), ipPolicy: { trustedProxies: new Set() }, maxSeatsPerIp: 16, gracefullyShutdown: false, profiles: { store: new MemoryProfileStore(), keys: { current: randomBytes(32), previous: null, secure: false } } });
  let rig: Rig | undefined;
  try {
    await game.listen(GAME_PORT, '127.0.0.1');
    rig = await openRig({ outDir: OUT, webPort: WEB_PORT, serverUrl: `http://127.0.0.1:${String(GAME_PORT)}` });
    const { browser } = rig;
    await mkdir(`${evidence}dust/`, { recursive: true });
    await mkdir(`${evidence}dialogue/`, { recursive: true });
    await mkdir(`${evidence}envelope/`, { recursive: true });
    await mkdir(`${evidence}feedback/`, { recursive: true });
    await mkdir(`${evidence}clock/`, { recursive: true });
    await mkdir(`${evidence}book/`, { recursive: true });
    const errors: string[] = [];

    const { page, room } = await open(browser, 'Rook', { width: 1280, height: 800 }, errors);
    await until(() => room.state.node === 'pell', 'Pell calls');
    await page.locator('#story-face-them svg').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(4_000);
    check(((await page.textContent('#story-now')) ?? '').startsWith('A phone buzzes'), 'the scene opens on its stage direction');
    check((await page.textContent('#story-log'))?.includes('Forty thousand by Friday') === false, 'the next line waits until Rook reads on');
    check(!room.state.answering, 'the choice clock waits while Rook is still reading');
    for (let i = 0; i < 6 && ((await page.textContent('#story-name')) ?? '') !== 'Mr Pell'; i++) {
      await page.keyboard.press(' ');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(2_500);
    check((await page.locator('#story-face-them.speaking svg').count()) === 1, 'Mr Pell’s portrait lights up while he speaks');
    check((await page.locator('#story-face-rook:not(.speaking) svg').count()) === 1, 'Rook waits, dimmed, across from him');
    await page.screenshot({ path: `${evidence}dialogue/pell-speaks.png` });
    await page.click('#story-voice');
    const beepsOff = (await page.getAttribute('#story-voice', 'aria-pressed')) === 'false' && (await page.evaluate(() => localStorage.getItem('bc.story') ?? '')).includes('"voice":false');
    await page.click('#story-voice');
    check(beepsOff && (await page.getAttribute('#story-voice', 'aria-pressed')) === 'true', 'the talking beeps turn off and back on, and are remembered');
    await reachChoices(page);
    check((await page.textContent('#story-log'))?.includes('Forty thousand by Friday') === true, 'Mr Pell rings with the deadline');
    check(await until(() => room.state.answering, 'the choice clock'), 'the choice clock starts once Rook has read up to it');
    await page.screenshot({ path: `${SHOTS}story-call.png` });
    await page.screenshot({ path: `${evidence}dialogue/pell-choices.png` });
    await page.click('#story-history');
    check(((await page.textContent('#story-log')) ?? '').includes('A phone buzzes') && (await page.isVisible('#story-log')), 'History shows every line said so far');
    await page.screenshot({ path: `${evidence}dialogue/history.png` });
    await page.click('#story-history');
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
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowUp');
    await page.screenshot({ path: `${SHOTS}story-night.png` });

    room.teleport(DANI_SPOT.x, DANI_SPOT.y + 1);
    await answer(page, room, 'dani', 2);
    await read(page, room, 'daniStraight');
    await answer(page, room, 'reveal', 1);
    await until(() => room.state.node === 'daniCalm', 'calm');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}story-dani.png` });
    await page.screenshot({ path: `${evidence}dialogue/dani-talking.png` });
    check(((await page.textContent('#story-clues')) ?? '').includes('winter 2013'), 'the winter clue is written down');
    await read(page, room, 'daniCalm');
    await read(page, room, 'hook');
    await until(() => room.state.step === 'toTip', 'off to the tip');

    room.teleport(GATE_SPOT.x, GATE_SPOT.y + 1);
    await until(() => room.state.node === 'mags', 'Mags');
    await reachChoices(page, 20_000);
    await page.screenshot({ path: `${SHOTS}story-mags.png` });
    await answer(page, room, 'mags', 3);
    await read(page, room, 'magsPay');
    await read(page, room, 'magsWinter');
    await read(page, room, 'magsRules');
    await until(() => room.state.step === 'dig', 'digging');
    room.teleport(20.5, 29.5);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}story-patrol.png` });
    check(room.state.caught === 0, 'watching the patrol from the edge of the yard is safe');
    room.quietNight();
    const spot = digSpot(room.secretSpot);
    room.teleport(spot.x, spot.y);
    await page.locator('#story-dig').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(await page.isVisible('#story-dig'), 'a dig button appears beside a heap');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}story-tip.png` });
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
    await page.screenshot({ path: `${SHOTS}story-call-back.png` });
    await read(page, room, 'selfie');
    await page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(await page.isVisible('#story-end'), 'the end card appears');
    check(((await page.textContent('#story-reward')) ?? '').includes('+250 play sats'), `the first finish pays (${(await page.textContent('#story-reward')) ?? ''})`);
    check(((await page.textContent('#story-remembers')) ?? '').includes('Dani remembers'), 'the end card lists what Dani remembers');
    await page.screenshot({ path: `${SHOTS}story-end.png` });
    await page.click('#story-end-leave');
    await page.locator('#menu').waitFor({ state: 'visible', timeout: 10_000 });
    check(true, 'back to the menu after the story');

    const phone = await open(browser, 'Ivy', { width: 390, height: 844 }, errors);
    await until(() => phone.room.state.node === 'pell', 'Pell calls on the phone');
    await reachChoices(phone.page, 20_000);
    await phone.page.screenshot({ path: `${SHOTS}story-phone.png` });
    check(true, 'the story plays on a phone screen');
    await phone.page.click('#story-leave');
    await phone.page.locator('#menu').waitFor({ state: 'visible', timeout: 10_000 });

    const lead = await open(browser, 'Ana', { width: 1280, height: 800 }, errors);
    await until(() => lead.room.state.code !== '', 'a crew code');
    const code = lead.room.state.code;
    await lead.page.waitForFunction((c) => document.getElementById('story-code')?.textContent.replace('-', '') === c, code, { timeout: 10_000 }).catch(() => undefined);
    check(((await lead.page.textContent('#story-code')) ?? '').replace('-', '') === code, 'the story bar shows the crew code');
    const friend = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    collectErrors(friend, errors, 'Bo');
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
    await reachChoices(lead.page, 20_000);
    await reachChoices(friend, 20_000);
    await lead.page.keyboard.press('1');
    await until(() => lead.room.state.votes.size === 1, 'the lead votes');
    await friend.waitForFunction(() => document.querySelector('.story-choice.voted') === null && (document.querySelector('.story-votes')?.textContent ?? '') !== '', undefined, { timeout: 5_000 }).catch(() => undefined);
    await friend.screenshot({ path: `${SHOTS}story-crew-vote.png` });
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
    await reachChoices(two.page, 20_000);
    check(((await two.page.textContent('#story-eyebrow')) ?? '').includes('Act two'), 'the story bar names act two');
    await two.page.screenshot({ path: `${SHOTS}ransom-call.png` });
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
        await two.page.screenshot({ path: `${SHOTS}ransom-mint.png` });
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
    await two.page.screenshot({ path: `${SHOTS}ransom-breakwater.png` });
    two.room.teleport(LIGHTHOUSE_DOOR.x, LIGHTHOUSE_DOOR.y);
    await answer(two.page, two.room, 'door', 3);
    await read(two.page, two.room, 'doorLook');
    await until(() => two.room.state.node === 'brannDoor', 'Brannigan');
    await two.page.waitForTimeout(3000);
    await two.page.screenshot({ path: `${SHOTS}ransom-door.png` });
    await read(two.page, two.room, 'brannDoor');
    await two.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await two.page.textContent('#story-end-title')) ?? '') === 'The Ransom Call', 'the end card is act two’s');
    check(((await two.page.textContent('#story-reward')) ?? '').includes('+300 play sats'), `act two pays its first finish (${(await two.page.textContent('#story-reward')) ?? ''})`);
    await two.page.screenshot({ path: `${SHOTS}ransom-end.png` });
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
    await reachChoices(three.page, 20_000);
    await three.page.screenshot({ path: `${SHOTS}insider-nonce.png` });
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
    await three.page.screenshot({ path: `${SHOTS}insider-tower.png` });
    await three.page.keyboard.press('e');
    await until(() => three.room.state.node === 'account', 'Teo’s account');
    check(three.room.state.node === 'account', 'the right terminal shows Teo’s frozen account');
    await reachChoices(three.page, 30_000);
    await three.page.screenshot({ path: `${SHOTS}insider-teo.png` });
    await answer(three.page, three.room, 'account', 1);
    await read(three.page, three.room, 'teoTalk');
    await read(three.page, three.room, 'teoEnd');
    await three.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await three.page.textContent('#story-end-title')) ?? '') === 'The Insider', 'the end card is act three’s');
    check(((await three.page.textContent('#story-reward')) ?? '').includes('+350 play sats'), `act three pays its first finish (${(await three.page.textContent('#story-reward')) ?? ''})`);
    check(await three.page.isVisible('#story-finale'), 'the end card offers the signing ceremony');
    await three.page.screenshot({ path: `${SHOTS}insider-end.png` });
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
        await four.page.screenshot({ path: `${SHOTS}founder-blackout.png` });
      }
      await four.page.keyboard.press('e');
      await until(() => four.room.state.spots[i]?.done === true, `restarted ${g.label}`);
    }
    await until(() => four.room.state.node === 'onAir', 'on air');
    check(four.room.state.node === 'onAir', 'three generators put the station back on air');
    await read(four.page, four.room, 'onAir');
    await read(four.page, four.room, 'nineMinutes');
    await until(() => four.room.state.node === 'theChoice', 'the choice');
    await reachChoices(four.page, 30_000);
    check((await four.page.locator('.story-choice').count()) === 2, 'a crew that never asked for a cut sees only the Guardian and Burn endings');
    await four.page.screenshot({ path: `${SHOTS}founder-choice.png` });
    await answer(four.page, four.room, 'theChoice', 2);
    await read(four.page, four.room, 'endBurn');
    await read(four.page, four.room, 'burnDani');
    await read(four.page, four.room, 'dawn');
    await until(() => four.room.state.node === 'voicemail', 'the voicemail');
    await four.page.waitForTimeout(4000);
    await four.page.screenshot({ path: `${SHOTS}founder-voicemail.png` });
    await read(four.page, four.room, 'voicemail');
    await four.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await four.page.textContent('#story-end-title')) ?? '') === 'The Founder’s Coins', 'the end card is act four’s');
    check(((await four.page.textContent('#story-reward')) ?? '').includes('+500 play sats'), `the season finale pays its first finish (${(await four.page.textContent('#story-reward')) ?? ''})`);
    await four.page.screenshot({ path: `${SHOTS}founder-end.png` });

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
    await tin.page.screenshot({ path: `${SHOTS}popcorn-yard.png` });
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
    await tin.page.screenshot({ path: `${SHOTS}popcorn-end.png` });
    await tin.page.click('#story-end-leave');
    await tin.page.locator('#open-cases').waitFor({ state: 'visible', timeout: 10_000 });
    await tin.page.click('#open-cases');
    await tin.page.locator('.cases-list .case.solved').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await tin.page.locator('.cases-list .case.solved').first().textContent()) ?? '').includes('The Popcorn Tin'), 'the casebook marks the case solved');
    check((await tin.page.locator('.cases-list .case').count()) === 6, 'the casebook lists six side cases');

    await tin.page.close();
    const pizza = await open(browser, 'Rook', { width: 390, height: 844 }, errors, '#open-cases', 'Pizza Night');
    await until(() => pizza.room.state.node === 'notice', 'notice');
    await pizza.page.keyboard.press(' ');
    await pizza.page.waitForTimeout(400);
    await pizza.page.keyboard.press(' ');
    await pizza.page.waitForTimeout(2_000);
    const talk = await pizza.page.locator('#story-talk').boundingBox();
    check(talk !== null && talk.x >= 0 && talk.x + talk.width <= 390, 'the story panel fits a phone, portraits and all');
    await pizza.page.screenshot({ path: `${evidence}dialogue/phone.png` });
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
    await pizza.page.screenshot({ path: `${SHOTS}pizza-gulls.png` });
    pizza.room.teleport(BENNY_DOOR.x, BENNY_DOOR.y);
    await answer(pizza.page, pizza.room, 'benny', 1);
    await read(pizza.page, pizza.room, 'bennyCoins');
    await read(pizza.page, pizza.room, 'later');
    await pizza.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await pizza.page.textContent('#story-end-title')) ?? '') === 'Pizza Night', 'Pizza Night plays to its end card on a phone');
    await pizza.page.screenshot({ path: `${SHOTS}pizza-end.png` });

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
    await s2.page.screenshot({ path: `${SHOTS}overflow-chase.png` });
    const ozzy = s2.room.state.npcs.get('ozzy');
    s2.room.teleport(ozzy?.x ?? MARKET_MIDDLE.x, ozzy?.y ?? MARKET_MIDDLE.y);
    await until(() => s2.room.state.step === 'caught', 'caught up with Ozzy');
    await answer(s2.page, s2.room, 'caught', 1);
    await read(s2.page, s2.room, 'caughtReport');
    await read(s2.page, s2.room, 'fixed');
    await s2.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await s2.page.textContent('#story-end-title')) ?? '') === 'The Overflow', 'catching Ozzy and fixing the Mint ends season two’s first act');
    check(((await s2.page.textContent('#story-reward')) ?? '').includes('+300 play sats'), `it pays its first finish (${(await s2.page.textContent('#story-reward')) ?? ''})`);
    await s2.page.screenshot({ path: `${SHOTS}overflow-end.png` });

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
        await split.page.screenshot({ path: `${SHOTS}split-canvass.png` });
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
    await tide.page.screenshot({ path: `${SHOTS}receipt-jetty.png` });
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
      if (i === Math.floor(hops.length / 2)) await last.page.screenshot({ path: `${SHOTS}alert-escort.png` });
    }
    await until(() => last.room.state.step === 'aerial', 'the aerial');
    check(last.room.state.step === 'aerial', 'Mags follows the lead across the tip to the old aerial');
    await answer(last.page, last.room, 'aerial', 1);
    for (const node of ['aerialRead', 'aerialRex', 'dawn']) await read(last.page, last.room, node);
    await last.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await last.page.textContent('#story-end-title')) ?? '') === 'The Last Alert', 'Mags reads the key out and season two ends');
    check(((await last.page.textContent('#story-reward')) ?? '').includes('+600 play sats'), `it pays its first finish (${(await last.page.textContent('#story-reward')) ?? ''})`);
    await last.page.close();

    const dust = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-dust');
    check(dust.room.state.act === 'dust', 'the next tile opens season three: The Dust');
    await answer(dust.page, dust.room, 'dust', 1);
    await read(dust.page, dust.room, 'dustKind');
    await read(dust.page, dust.room, 'dustGo');
    await until(() => dust.room.state.step === 'warn', 'knocking on doors');
    for (const i of [0, 1, 2]) {
      const door = DOORS[i];
      if (door === undefined) throw new Error('door');
      dust.room.teleport(door.at.x, door.at.y);
      await dust.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Knock at ${label}`) === true, door.label, { timeout: 10_000 }).catch(() => undefined);
      await dust.page.keyboard.press('e');
      await until(() => dust.room.state.spots[i]?.done === true, `door ${String(i)}`);
    }
    await until(() => dust.room.state.step === 'toShop', 'off to the shop');
    check(dust.room.state.marks.includes('clueGreyCoat'), 'Mr Adeyemi saw who takes the receipts');
    dust.room.teleport(DEE_SHOP.x, DEE_SHOP.y);
    await answer(dust.page, dust.room, 'shop', 1);
    for (let i = 0; i < 200 && dust.room.state.step !== 'tail'; i++) {
      await dust.page.keyboard.press(' ');
      await dust.page.waitForTimeout(150);
    }
    await until(() => dust.room.state.step === 'tail', 'the tail');
    dust.room.quietNight();
    const fennick = (): { x: number; y: number; chasing: boolean } => dust.room.state.npcs.get('fennick') ?? { x: 0, y: 0, chasing: false };
    let glanced = false;
    for (let i = 0; i < 400 && dust.room.state.step === 'tail'; i++) {
      const f = fennick();
      if (f.chasing && !glanced) {
        dust.room.teleport(f.x + 6, f.y);
        await dust.page.waitForTimeout(250);
        await dust.page.screenshot({ path: `${evidence}dust/tail-glance.png` });
        glanced = true;
      } else dust.room.teleport(f.x, f.y);
      await dust.page.waitForTimeout(150);
    }
    check(glanced, 'Mr Fennick looks back at a corner');
    await answer(dust.page, dust.room, 'office', 1);
    for (const node of ['officePrivacy', 'officeIvy']) await read(dust.page, dust.room, node);
    await dust.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await dust.page.textContent('#story-end-title')) ?? '') === 'The Dust', 'the tail ends at Glasshouse and season three begins');
    check(((await dust.page.textContent('#story-reward')) ?? '').includes('+350 play sats'), `it pays its first finish (${(await dust.page.textContent('#story-reward')) ?? ''})`);
    await dust.page.close();

    const env = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-envelope');
    check(env.room.state.act === 'envelope', 'the next tile opens season three, act two: The Envelope');
    await answer(env.page, env.room, 'steps', 1);
    for (const node of ['stepsTime', 'stepsGo']) await read(env.page, env.room, node);
    await until(() => env.room.state.step === 'seal', 'sealing envelopes');
    env.room.quietNight();
    for (const i of [0, 1, 2]) {
      const desk = DESKS[i];
      if (desk === undefined) throw new Error('desk');
      env.room.teleport(desk.at.x, desk.at.y);
      await env.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Write and seal at ${label}`) === true, desk.label, { timeout: 10_000 }).catch(() => undefined);
      if (i === 1) {
        await until(() => env.room.state.npcs.get('lumley')?.chasing === true, 'the camera sweeping');
        await env.page.waitForTimeout(1500);
        await env.page.screenshot({ path: `${evidence}envelope/camera-sweep.png` });
      }
      await env.page.keyboard.press('e');
      await until(() => env.room.state.spots[i]?.done === true, `desk ${String(i)}`);
    }
    await answer(env.page, env.room, 'counter', 1);
    check(env.room.state.marks.includes('clueCarbon'), 'the Mint signs three envelopes without opening one');
    for (const node of ['counterOkafor', 'counterGo']) await read(env.page, env.room, node);
    await until(() => env.room.state.step === 'toShop', 'off to spend it');
    env.room.teleport(DEE_SHOP.x, DEE_SHOP.y);
    await answer(env.page, env.room, 'till', 1);
    for (const node of ['tillPolite', 'tillIvy']) await read(env.page, env.room, node);
    await env.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await env.page.textContent('#story-end-title')) ?? '') === 'The Envelope', 'the note is spent and Glasshouse can’t join it up');
    check(((await env.page.textContent('#story-reward')) ?? '').includes('+400 play sats'), `it pays its first finish (${(await env.page.textContent('#story-reward')) ?? ''})`);
    await env.page.close();

    const clk = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-clock');
    check(clk.room.state.act === 'clock', 'the next tile opens season three, act three: The Clock');
    await answer(clk.page, clk.room, 'clock', 1);
    for (const node of ['clockWait', 'clockGo']) await read(clk.page, clk.room, node);
    await until(() => clk.room.state.step === 'blend', 'waiting for the chime');
    const crowdMiddle = (): { x: number; y: number } => {
      const all = [...clk.room.state.npcs.entries()].filter(([id]) => id.startsWith('shopper')).map(([, n]) => n);
      return { x: all.reduce((a, n) => a + n.x, 0) / all.length, y: all.reduce((a, n) => a + n.y, 0) / all.length };
    };
    let ringShot = false;
    for (let i = 0; i < 400 && clk.room.state.step === 'blend'; i++) {
      const m = crowdMiddle();
      clk.room.teleport(m.x, m.y);
      if (!ringShot && Math.hypot(m.x - WATCH_AT.x, m.y - WATCH_AT.y) < WATCH_RANGE - 1) {
        await clk.page.waitForTimeout(300);
        await clk.page.screenshot({ path: `${evidence}clock/crowd-ring.png` });
        ringShot = true;
      }
      if (Math.hypot(m.x - OLIVE_SHOP.x, m.y - OLIVE_SHOP.y) < 3.5) clk.room.teleport(OLIVE_SHOP.x, OLIVE_SHOP.y);
      await clk.page.waitForTimeout(150);
    }
    check(ringShot && clk.room.state.caught === 0, 'Rook walks into the Saltmarket inside the crowd and Mr Fennick clocks nobody');
    await answer(clk.page, clk.room, 'market', 1);
    for (const node of ['marketNo', 'marketIvy']) await read(clk.page, clk.room, node);
    await clk.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await clk.page.textContent('#story-end-title')) ?? '') === 'The Clock', 'Glasshouse loses Rook in the crowd and writes to the guardians');
    check(((await clk.page.textContent('#story-reward')) ?? '').includes('+450 play sats'), `it pays its first finish (${(await clk.page.textContent('#story-reward')) ?? ''})`);
    await clk.page.close();

    const book = await open(browser, 'Rook', { width: 1280, height: 800 }, errors, '#open-book');
    check(book.room.state.act === 'book', 'the next tile opens season three, act four: The Little Book');
    await answer(book.page, book.room, 'letter', 1);
    for (const node of ['letterTogether', 'letterGo']) await read(book.page, book.room, node);
    await until(() => book.room.state.step === 'letters', 'Mr Varnish on his rounds');
    book.room.quietNight();
    await until(() => book.room.state.spots.some((s) => !s.done), 'a letter handed over', 15_000);
    const held = book.room.state.spots.findIndex((s) => !s.done);
    const post = BOOK_POSTS[held];
    if (post === undefined) throw new Error('post');
    book.room.teleport(post.at.x, post.at.y);
    await book.page.waitForFunction((label) => document.getElementById('story-dig')?.textContent.includes(`Take ${label}’s letter`) === true, post.label, { timeout: 10_000 }).catch(() => undefined);
    await until(() => book.room.state.spots.filter((s) => !s.done).length >= 2, 'a second letter out', 15_000);
    await book.page.waitForTimeout(300);
    await book.page.screenshot({ path: `${evidence}book/letters.png` });
    await book.page.keyboard.press('e');
    await until(() => book.room.state.spots[held]?.done === true, 'the letter taken');
    book.room.teleport(READING_TABLE.x, READING_TABLE.y);
    await until(() => book.room.state.marks.includes('clueTogether'), 'read out at the table');
    check(book.room.state.marks.includes('clueTogether'), 'a letter read out at the table is the same letter every guardian got');
    await until(() => book.room.state.step === 'vote', 'the vote at noon', (VOTE_S + 10) * 1000);
    await answer(book.page, book.room, 'vote', 1);
    await read(book.page, book.room, 'voteThank');
    await answer(book.page, book.room, 'farewell', 1);
    for (const node of ['farewellKind', 'closing']) await read(book.page, book.room, node);
    await book.page.locator('#story-end').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    check(((await book.page.textContent('#story-end-title')) ?? '') === 'The Little Book', 'the guardians hold together and season three ends');
    check(((await book.page.textContent('#story-reward')) ?? '').includes('+600 play sats'), `it pays its first finish (${(await book.page.textContent('#story-reward')) ?? ''})`);
    await book.page.click('#story-feedback');
    await book.page.locator('#feedback').waitFor({ state: 'visible', timeout: 10_000 });
    await book.page.click('#feedback-send');
    check(((await book.page.textContent('#feedback-status')) ?? '') === 'Pick how fun it was first.', 'feedback asks for a rating before sending');
    await book.page.locator('#feedback-fun button', { hasText: '4' }).click();
    await book.page.fill('#feedback-text', 'The letters were fun. Varnish could walk faster.');
    await book.page.screenshot({ path: `${evidence}feedback/form.png` });
    await book.page.click('#feedback-send');
    await book.page.waitForFunction(() => document.getElementById('feedback-status')?.textContent === 'Thank you! That really helps.', undefined, { timeout: 10_000 }).catch(() => undefined);
    const note = feedback.records.at(-1);
    check(note?.fun === 4 && note.where === 'story:book' && note.text === 'The letters were fun. Varnish could walk faster.' && note.locale === 'en', `the note reaches the server tagged with the act and nothing about the player (${JSON.stringify(note)})`);
    await book.page.close();

    checkNoErrors(errors);
  } finally {
    await rig?.close();
    await game.server.gracefullyShutdown(false).catch(() => undefined);
  }
  finish('story');
}

await main();
