// Island maps end to end: production build, real server, headless Brave. A guest whose profile has
// opened the islands creates a private room, picks the map, fills it with practice bots, and walks the
// bridges to the gateway, where the prompt and the task panel use that map's station name.
// Run: npx tsx --conditions=source e2e/reef.ts (ARENA=peaks for Watchtower Peaks)
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { build, preview, type PreviewServer } from 'vite';
import { createGameServer } from '../apps/server/src/app.js';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../apps/server/src/profile/store.js';
import { ARENAS, SABOTAGE_TIMING, STATION_PROMPT_RANGE, stationCenter } from '../packages/shared/src/index.js';
import { findPathNear } from '../packages/shared/src/pathfinding.js';

const clientRoot = fileURLToPath(new URL('../apps/client', import.meta.url));
const shots = fileURLToPath(new URL('../.scratch/e2e/', import.meta.url));
const ARENA = process.env['ARENA'] === 'peaks' ? ARENAS.peaks : ARENAS.reef;
// The gateway station's name on this map, as the prompt and the task panel show it.
const GATEWAY = ARENA.roomNames.gatewayDock.replace(/^the /, '');
const GAME_PORT = ARENA.id === 'peaks' ? 3952 : 3950;
const WEB_PORT = ARENA.id === 'peaks' ? 3953 : 3951;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const BRAVE = process.env['BRAVE_PATH'] ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const OUT = `dist-${ARENA.id}`;
const SHOT = (name: string): string => `${shots}${ARENA.id}-${name}`;

// Every guest arrives with twelve Academy stars, which opens Lightning Reef.
class ReefStore extends MemoryProfileStore {
  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) => fn({ ...data, progress: { ...data.progress, academy: data.progress.academy.map((_, i) => (i < 4 ? 3 : 0)) } }));
  }
}

let failures = 0;
function check(ok: boolean, label: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

interface Smoke {
  predicted(): { x: number; y: number } | null;
  phase(): string;
}

async function main(): Promise<void> {
  const game = createGameServer({
    allowedOrigins: new Set([WEB]),
    ipPolicy: { trustedProxies: new Set() },
    gracefullyShutdown: false,
    maxSeatsPerIp: 16,
    bots: {},
    // On the Peaks, sabotage is ready at once, so a Byzantine bot soon cuts the network and the bridges fall.
    ...(ARENA.id === 'peaks' ? { sabotageTiming: { ...SABOTAGE_TIMING, openingMs: 0, partitionCooldownMs: 0 } } : {}),
    profiles: { store: new ReefStore(), keys: { current: randomBytes(32), previous: null, secure: false } },
  });
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`${WEB}/`);
    await page.locator('#open-progress').waitFor({ state: 'visible', timeout: 10_000 });
    await page.fill('#nickname', 'Mara');
    await page.click('button[data-action="create"]');
    await page.locator('#hud .room-card').waitFor({ state: 'visible', timeout: 15_000 });

    const pickButton = page.locator(`#arena-pick button[data-arena="${ARENA.id}"]`);
    await pickButton.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction((id) => document.querySelector<HTMLButtonElement>(`#arena-pick button[data-arena="${id}"]`)?.disabled === false, ARENA.id, { timeout: 10_000 });
    check(true, `the private lobby offers ${ARENA.name} to a guest who has opened it`);
    await pickButton.click();
    await page.waitForFunction((id) => document.querySelector(`#arena-pick button[data-arena="${id}"]`)?.getAttribute('aria-pressed') === 'true', ARENA.id, { timeout: 5000 });
    check(true, `picking ${ARENA.name} moves the lobby there`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: SHOT('lobby.png') });

    for (let i = 0; i < 4; i++) {
      await page.click('#add-bot');
      await page.waitForFunction((n) => document.querySelectorAll('#roster .tag.bot').length === n, i + 1, { timeout: 10_000 });
    }
    check(true, 'four practice bots join the lobby');
    await page.waitForFunction(() => !(document.getElementById('start-match') as HTMLButtonElement | null)?.disabled, undefined, { timeout: 10_000 });
    await page.click('#start-match');
    await page.locator('#role-card').waitFor({ state: 'visible', timeout: 10_000 });
    await page.click('#role-ok');
    check(await page.locator('#arena-pick').isHidden(), 'the map picker hides once the match starts');

    // Walk the bridges to the Gateway Harbour, steering toward each waypoint with the arrow keys.
    const where = (): Promise<{ x: number; y: number } | null> => page.evaluate(() => (window as unknown as { __bcSmoke?: Smoke }).__bcSmoke?.predicted() ?? null);
    const harbour = stationCenter('route', ARENA.stations);
    let arrived = false;
    for (let i = 0; i < 260 && !arrived; i++) {
      const pos = await where();
      if (pos === null) break;
      const route = findPathNear(ARENA.map, pos, harbour, STATION_PROMPT_RANGE - 0.3);
      const next = (route.ok ? route.value : []).find((p) => Math.hypot(p.x - pos.x, p.y - pos.y) > 0.35) ?? harbour;
      const sx = next.x - pos.x - (next.y - pos.y);
      const sy = (next.x - pos.x + next.y - pos.y) / 2;
      const len = Math.hypot(sx, sy) || 1;
      const keys = [...(Math.abs(sx) / len > 0.38 ? [sx > 0 ? 'ArrowRight' : 'ArrowLeft'] : []), ...(Math.abs(sy) / len > 0.38 ? [sy > 0 ? 'ArrowDown' : 'ArrowUp'] : [])];
      for (const k of keys) await page.keyboard.down(k);
      await page.waitForTimeout(110);
      for (const k of keys) await page.keyboard.up(k);
      arrived = (await page.locator('#interact').isVisible()) && ((await page.textContent('#interact')) ?? '').includes(GATEWAY);
      if (i === 30) await page.screenshot({ path: SHOT('bridges.png') });
    }
    check(arrived, `walking the bridges reaches the ${GATEWAY}, and the prompt uses the map's name`);
    await page.screenshot({ path: SHOT('gateway.png') });
    await page.click('#interact');
    await page.waitForFunction((name) => document.getElementById('task-station')?.textContent === name, GATEWAY, { timeout: 5000 });
    check(true, 'the task panel names the station');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: SHOT('route.png') });
    await page.keyboard.press('Escape');

    if (ARENA.id === 'peaks') {
      // Wait for a Byzantine bot to cut the network (or this guest, if they were dealt Byzantine).
      const cut = page.locator('#cut');
      if (await cut.isVisible()) await cut.click();
      await page.locator('#partition-banner').waitFor({ state: 'visible', timeout: 60_000 });
      // Zoom out so the broken bridge between Summit Square and the Gateway Ridge is in view.
      await page.mouse.move(640, 400);
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300);
      await page.waitForTimeout(800);
      await page.screenshot({ path: SHOT('partition.png') });
      check(true, 'a partition on the Peaks shows the banner, with the bridges between the ranges down');
    }

    await page.click('#leave');
    await page.locator('#menu').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: SHOT('menu-after.png') });
    check(true, 'leaving returns to the menu over the Citadel');
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
  console.log(`${ARENA.id}: ok`);
  process.exit(0);
}

await main();
