import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { matchMaker } from '@colyseus/core';
import { type Browser, type Page } from 'playwright-core';
import { DUMP_ACT } from '@byzantine-council/shared/city';
import { createGameServer } from '../apps/server/src/app.js';
import { memoryFeedbackSink } from '../apps/server/src/feedback.js';
import type { MissionRoom } from '../apps/server/src/city/MissionRoom.js';
import { MemoryProfileStore } from '../apps/server/src/profile/store.js';
import { intlTag, translate, type Locale } from '../apps/client/src/i18n/index.js';
import { translateStory, type StoryCatalog } from '../apps/client/src/i18n/story.js';
import es from '../apps/client/src/i18n/story.es.json' with { type: 'json' };
import fr from '../apps/client/src/i18n/story.fr.json' with { type: 'json' };
import ha from '../apps/client/src/i18n/story.ha.json' with { type: 'json' };
import hi from '../apps/client/src/i18n/story.hi.json' with { type: 'json' };
import sw from '../apps/client/src/i18n/story.sw.json' with { type: 'json' };
import zu from '../apps/client/src/i18n/story.zu.json' with { type: 'json' };
import { check, checkNoErrors, collectErrors, finish, openRig, type Rig } from './harness.js';

const evidence = fileURLToPath(new URL('../production/qa/evidence/languages/', import.meta.url));
const GAME_PORT = 3960;
const WEB_PORT = 3961;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const OUT = 'dist-languages';

const CASES: ReadonlyArray<{ readonly bcp47: string; readonly lang: Locale; readonly catalog: StoryCatalog }> = [
  { bcp47: 'es-MX', lang: 'es', catalog: es },
  { bcp47: 'fr-SN', lang: 'fr', catalog: fr },
  { bcp47: 'sw-KE', lang: 'sw', catalog: sw },
  { bcp47: 'ha-NG', lang: 'ha', catalog: ha },
  { bcp47: 'zu-ZA', lang: 'zu', catalog: zu },
  { bcp47: 'hi-IN', lang: 'hi', catalog: hi },
];

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
  locale: string,
  viewport: { width: number; height: number },
  errors: string[],
): Promise<{ page: Page; room: MissionRoom }> {
  const page = await browser.newPage({ viewport, locale });
  collectErrors(page, errors, locale);
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

async function main(): Promise<void> {
  const feedback = memoryFeedbackSink();
  const game = createGameServer({
    feedback: { sink: feedback },
    allowedOrigins: new Set([WEB]),
    ipPolicy: { trustedProxies: new Set() },
    maxSeatsPerIp: 16,
    gracefullyShutdown: false,
    profiles: { store: new MemoryProfileStore(), keys: { current: randomBytes(32), previous: null, secure: false } },
  });
  let rig: Rig | undefined;
  try {
    await game.listen(GAME_PORT, '127.0.0.1');
    rig = await openRig({ outDir: OUT, webPort: WEB_PORT, serverUrl: `http://127.0.0.1:${String(GAME_PORT)}` });
    const { browser } = rig;
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];
    const firstLine = DUMP_ACT.script['pell']?.lines[0]?.text;
    const callObjective = DUMP_ACT.objectives['call'];
    if (firstLine === undefined || callObjective === undefined) throw new Error('missing DUMP_ACT strings');

    for (const { bcp47, lang, catalog } of CASES) {
      const { page, room } = await open(browser, 'Rook', bcp47, { width: 1280, height: 800 }, errors);
      const htmlLang = await page.getAttribute('html', 'lang');
      check(htmlLang === intlTag(lang), `${bcp47}: <html lang> matches ${intlTag(lang)}`);
      await until(() => room.state.node === 'pell', `${bcp47} Pell calls`);
      check(room.state.act === 'dump', `${bcp47}: clicking #open-story starts act one`);
      const choice = page.locator('.story-choice').first();
      for (let i = 0; i < 80 && !(await choice.isVisible()); i++) {
        await page.keyboard.press(' ');
        await page.waitForTimeout(200);
      }
      await choice.waitFor({ state: 'visible', timeout: 1_000 });
      const eyebrow = translate(lang, 'mission.eyebrowAct', {
        number: translateStory(catalog, DUMP_ACT.number),
        title: translateStory(catalog, DUMP_ACT.title),
      });
      const translatedLine = translateStory(catalog, firstLine);
      const translatedObjective = translateStory(catalog, callObjective);
      check(((await page.textContent('#story-eyebrow')) ?? '') === eyebrow, `${bcp47}: #story-eyebrow matches translated mission.eyebrowAct`);
      check(((await page.textContent('#story-log')) ?? '').includes(translatedLine), `${bcp47}: #story-log contains translated first line`);
      check(((await page.textContent('#story-objective')) ?? '') === translatedObjective, `${bcp47}: #story-objective matches translated objective`);
      await page.screenshot({ path: `${evidence}${lang}-story.png` });
      await page.close();
    }

    checkNoErrors(errors);
  } finally {
    await rig?.close();
    await game.server.gracefullyShutdown(false).catch(() => undefined);
  }
  finish('languages');
}

await main();
