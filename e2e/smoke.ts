// End-to-end smoke test: the real game server and a production client build, five players in
// headless Brave (one on a phone-sized screen) playing through a match. Every minigame is solved
// by mouse, by keyboard alone and by touch alone. Exits 1 on any failed check, console error, CSP
// violation or failed request.
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchMaker } from '@colyseus/core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build, preview, type PreviewServer } from 'vite';
import { CEREMONY_TIMING, COUNCIL_SEAL, COUNCIL_TIMING, RELAYS, ROUTE_PATHS, SABOTAGE_TIMING, TASK_KINDS, isValidRoute, median, stationCenter, threshold, toDenominations, type TaskKind, type Vec2 } from '../packages/shared/src/index.js';
import { CitadelRoom } from '../apps/server/src/CitadelRoom.js';
import { createGameServer } from '../apps/server/src/app.js';
import { MemoryProfileStore } from '../apps/server/src/profile/store.js';
import { keysVector } from '../apps/client/src/game/stick.js';
import { screenDirToWorld } from '../apps/client/src/game/iso.js';

interface SmokePlayer {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly status: string;
}
interface SmokeApi {
  me(): string;
  server(): SmokePlayer[];
  predicted(): { x: number; y: number } | null;
  phase(): string;
  consensus(): number;
  roles(): { id: string; role: string | null }[];
}
declare global {
  interface Window {
    __bcSmoke?: SmokeApi;
  }
}

const BRAVE = process.env['BRAVE_PATH'] ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const GAME_PORT = Number(process.env['SMOKE_GAME_PORT'] ?? '3871');
const WEB_PORT = Number(process.env['SMOKE_WEB_PORT'] ?? '3872');
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;
const repo = fileURLToPath(new URL('..', import.meta.url));
const clientRoot = path.join(repo, 'apps/client');
const shots = path.join(repo, '.scratch/e2e');

// How a player drives the minigames: a desktop mouse, the keyboard alone, or a touch screen.
type InputMode = 'mouse' | 'keyboard' | 'touch';

interface Player {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
}

const problems: string[] = [];
const passed: string[] = [];
let currentStep = 'starting';
const open: Player[] = [];

function check(ok: boolean, label: string): void {
  if (ok) passed.push(label);
  else problems.push(`check failed: ${label}`);
}

// Names the stage a fatal error happened in.
function step(label: string): void {
  currentStep = label;
}

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } as const;
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } as const;

async function openPlayer(browser: Browser, name: string, url: string, device: typeof PHONE | typeof DESKTOP = DESKTOP): Promise<Player> {
  const context = await browser.newContext({ ...device, locale: 'en-US' });
  // CSP violations are not console calls, so surface them as console errors.
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.effectiveDirective} blocked ${e.blockedURI}`);
    });
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[${name}] console: ${msg.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`[${name}] page error: ${error.message}`));
  page.on('requestfailed', (req) => problems.push(`[${name}] request failed: ${req.url()} ${req.failure()?.errorText ?? ''}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`[${name}] HTTP ${String(res.status())} ${res.url()}`);
  });
  const res = await page.goto(url, { waitUntil: 'load' });
  check(res?.headers()['content-security-policy']?.includes("script-src 'self'") === true, `${name}: page is served with the strict CSP`);
  await page.locator('#menu-form').waitFor({ state: 'visible', timeout: 15_000 });
  const player = { name, context, page };
  open.push(player);
  return player;
}

async function shoot(p: Player, file: string): Promise<void> {
  await p.page.screenshot({ path: path.join(shots, file) });
}

async function inRoom(p: Player): Promise<void> {
  await p.page.locator('#hud .room-card').waitFor({ state: 'visible', timeout: 15_000 });
}

async function rosterSize(p: Player, size: number): Promise<void> {
  await p.page.waitForFunction((n) => document.querySelectorAll('#roster li').length === n, size, { timeout: 10_000 });
}

async function serverView(p: Player): Promise<SmokePlayer[]> {
  return p.page.evaluate(() => window.__bcSmoke?.server() ?? []);
}

async function joinByLink(browser: Browser, name: string, code: string, device: typeof PHONE | typeof DESKTOP = DESKTOP): Promise<Player> {
  const p = await openPlayer(browser, name.toLowerCase(), `${WEB}/#join=${code}`, device);
  await p.page.fill('#nickname', name);
  await p.page.click('button[data-action="join"]');
  await inRoom(p);
  return p;
}

// The roles this browser decoded: its own id and every non-empty role it was sent.
async function knownRoles(p: Player): Promise<{ me: string; roles: { id: string; role: string | null }[] }> {
  return p.page.evaluate(() => ({ me: window.__bcSmoke?.me() ?? '', roles: window.__bcSmoke?.roles() ?? [] }));
}

// The eight key combinations as world directions, the way the client maps them.
const COMBOS = [
  ['ArrowUp'], ['ArrowDown'], ['ArrowLeft'], ['ArrowRight'],
  ['ArrowUp', 'ArrowLeft'], ['ArrowUp', 'ArrowRight'], ['ArrowDown', 'ArrowLeft'], ['ArrowDown', 'ArrowRight'],
].map((keys) => {
  const k = keysVector(keys.includes('ArrowUp'), keys.includes('ArrowDown'), keys.includes('ArrowLeft'), keys.includes('ArrowRight'));
  return { keys, dir: screenDirToWorld(k.dx, k.dy) };
});

// Steers with the arrow keys along each leg, reading the predicted position as it goes. It aims at a
// point a little ahead on the leg (pure pursuit), so the eight key directions cannot drift far off it.
const LOOKAHEAD = 0.7;
async function walkTo(p: Player, waypoints: readonly { x: number; y: number; within: number }[]): Promise<boolean> {
  const held = new Set<string>();
  const hold = async (keys: readonly string[]): Promise<void> => {
    for (const k of [...held]) if (!keys.includes(k)) {
      await p.page.keyboard.up(k);
      held.delete(k);
    }
    for (const k of keys) if (!held.has(k)) {
      await p.page.keyboard.down(k);
      held.add(k);
    }
  };
  const position = () => p.page.evaluate(() => window.__bcSmoke?.predicted() ?? null);
  const deadline = Date.now() + 30_000;
  try {
    let from = await position();
    if (from === null) return false;
    for (const target of waypoints) {
      const lx = target.x - from.x;
      const ly = target.y - from.y;
      const legLength = Math.hypot(lx, ly) || 1;
      for (;;) {
        const pos = await position();
        if (pos === null) return false;
        if (Date.now() > deadline) {
          problems.push(`[${p.name}] stuck at (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}) heading for (${String(target.x)}, ${String(target.y)})`);
          return false;
        }
        if (Math.hypot(target.x - pos.x, target.y - pos.y) <= target.within) {
          from = pos;
          break;
        }
        const along = Math.min(legLength, ((pos.x - from.x) * lx + (pos.y - from.y) * ly) / legLength + LOOKAHEAD);
        const aimX = from.x + (lx / legLength) * along - pos.x;
        const aimY = from.y + (ly / legLength) * along - pos.y;
        const aim = Math.hypot(aimX, aimY) || 1;
        let best = COMBOS[0];
        let bestDot = -Infinity;
        for (const combo of COMBOS) {
          const dot = (combo.dir.x * aimX + combo.dir.y * aimY) / aim;
          if (dot > bestDot) {
            best = combo;
            bestDot = dot;
          }
        }
        await hold(best?.keys ?? []);
        await p.page.waitForTimeout(30);
      }
    }
    return true;
  } finally {
    await hold([]);
  }
}

// A walkable tile next to each station, inside the range that offers it.
const STAND: Readonly<Record<TaskKind, { readonly dx: number; readonly dy: number }>> = {
  deposit: { dx: 1, dy: 0 },
  ledger: { dx: 0, dy: 1 },
  route: { dx: 0, dy: -1 },
  watchtower: { dx: 0, dy: 1 },
};

// Test setup only: puts a player somewhere on the server, which their client then follows.
async function placeOn(p: Player, pos: Vec2): Promise<void> {
  const id = await p.page.evaluate(() => window.__bcSmoke?.me() ?? '');
  const listing = (await matchMaker.query({}))[0];
  const room = listing === undefined ? undefined : matchMaker.getLocalRoomById(listing.roomId);
  const player = room instanceof CitadelRoom ? room.state.players.get(id) : undefined;
  if (player === undefined) throw new Error(`cannot place ${p.name}`);
  player.x = pos.x;
  player.y = pos.y;
}

async function placeAt(p: Player, kind: TaskKind): Promise<void> {
  const c = stationCenter(kind);
  await placeOn(p, { x: c.x + STAND[kind].dx, y: c.y + STAND[kind].dy });
}

// Clicks or taps a control on a withdrawal card.
async function onCard(p: Player, id: string, control: 'sign' | 'refuse' | 'audit'): Promise<void> {
  const selector = `.proposal[data-id="${id}"] button.${control}`;
  await p.page.locator(selector).waitFor({ state: 'visible', timeout: 5000 });
  if (p === smokePhone) await p.page.tap(selector);
  else await p.page.click(selector);
}

async function cardText(p: Player, id: string): Promise<string> {
  return (await p.page.textContent(`.proposal[data-id="${id}"]`)) ?? '';
}

async function cardShows(p: Player, id: string, text: string): Promise<void> {
  await p.page.waitForFunction(
    (want: { i: string; t: string }) => document.querySelector(`.proposal[data-id="${want.i}"]`)?.textContent.includes(want.t) === true,
    { i: id, t: text },
    { timeout: 8000 },
  );
}

let smokePhone: Player | undefined;

// Moves keyboard focus with Tab until it lands on `selector`; failing means the control is unreachable.
async function tabTo(p: Player, selector: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (await p.page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
    await p.page.keyboard.press('Tab');
  }
  throw new Error(`keyboard focus never reached ${selector}`);
}

// Presses a control the way the input mode would.
async function activate(p: Player, mode: InputMode, selector: string, key: 'Space' | 'Enter' = 'Enter'): Promise<void> {
  if (mode === 'keyboard') {
    await tabTo(p, selector);
    await p.page.keyboard.press(key);
  } else if (mode === 'touch') {
    await p.page.tap(selector);
  } else {
    await p.page.click(selector);
  }
}

// Presses and holds a control, then lets go: mouse button, Space, or a finger on the glass.
async function pressAndHold(p: Player, mode: InputMode, selector: string, ms: number): Promise<void> {
  if (mode === 'keyboard') {
    await tabTo(p, selector);
    await p.page.keyboard.down('Space');
    await p.page.waitForTimeout(ms);
    await p.page.keyboard.up('Space');
  } else if (mode === 'touch') {
    const box = await p.page.locator(selector).boundingBox();
    if (box === null) throw new Error(`${selector} has no box`);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await p.context.newCDPSession(p.page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await p.page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await p.page.hover(selector);
    await p.page.mouse.down();
    await p.page.waitForTimeout(ms);
    await p.page.mouse.up();
  }
}

const ACTION = '#task-body > button.cta';

// Deposit Gate: pick the power-of-two notes, blind, hold to sign, then unblind with a fresh press.
async function solveDeposit(p: Player, mode: InputMode, shot?: string, action = ACTION): Promise<void> {
  const amount = Number(await p.page.getAttribute('.chips', 'data-amount'));
  for (const note of toDenominations(amount)) await activate(p, mode, `.note-chip[data-value="${String(note)}"]`, 'Space');
  await activate(p, mode, action);
  await activate(p, mode, action);
  await pressAndHold(p, mode, action, 1500);
  await p.page.waitForFunction((sel) => document.querySelector(sel)?.textContent === 'Unblind', action, { timeout: 3000 });
  // The release that finished the hold must not also unblind and hand the answer in.
  if (action === ACTION) {
    const idle = await p.page.evaluate(() => document.getElementById('task-status')?.textContent === '' && !document.querySelector<HTMLButtonElement>('#task-body > button.cta')?.disabled);
    check(idle, `${p.name}: letting go of the ${mode} hold waits for a separate Unblind press`);
  }
  if (shot !== undefined) await shoot(p, shot);
  await activate(p, mode, action);
}

// Gateway Dock: read every channel's capacity and pick the one route that can carry the payment.
async function solveRoute(p: Player, mode: InputMode): Promise<void> {
  const amount = Number(await p.page.getAttribute('.route-map', 'data-amount'));
  const capacities = await p.page.evaluate(() =>
    Array.from(document.querySelectorAll<SVGElement>('.capacity'), (e) => Number(e.dataset['capacity'])),
  );
  const route = ROUTE_PATHS.find((candidate) => isValidRoute({ kind: 'route', amount, capacities }, candidate)) ?? [];
  for (const node of route.slice(1)) await activate(p, mode, `.node[data-node="${String(node)}"]`);
  await activate(p, mode, ACTION);
}

// Watchtower: pick the median report.
async function solveWatchtower(p: Player, mode: InputMode): Promise<void> {
  const heights = await p.page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.report'), (e) => Number(e.dataset['height'])));
  await activate(p, mode, `.report[data-height="${String(median(heights))}"]`, 'Space');
  await activate(p, mode, ACTION);
}

// Ledger Archive: read the panel like a player would and reject the two bad notes.
async function solveLedger(p: Player, mode: InputMode): Promise<void> {
  const bad = await p.page.evaluate(() => {
    const seal = document.querySelector<HTMLElement>('.ledger-ref .seal')?.dataset['glyphs'] ?? '';
    const spent = Array.from(document.querySelectorAll('.spent .serial'), (e) => e.textContent);
    return Array.from(document.querySelectorAll<HTMLElement>('.note-card'))
      .filter((card) => card.querySelector<HTMLElement>('.seal')?.dataset['glyphs'] !== seal || spent.includes(card.querySelector('.serial')?.textContent ?? ''))
      .map((card) => card.dataset['index'] ?? '');
  });
  for (const index of bad) await activate(p, mode, `.note-card[data-index="${index}"]`, 'Space');
  await activate(p, mode, ACTION);
}

async function solve(p: Player, mode: InputMode, kind: TaskKind, depositShot?: string): Promise<void> {
  if (kind === 'deposit') await solveDeposit(p, mode, depositShot);
  else if (kind === 'ledger') await solveLedger(p, mode);
  else if (kind === 'route') await solveRoute(p, mode);
  else await solveWatchtower(p, mode);
}

// The panel shows the server's verdict, the task list ticks it off, and the panel closes itself.
async function verdict(p: Player, kind: TaskKind): Promise<void> {
  await p.page.waitForFunction(() => document.getElementById('task-status')?.dataset['tone'] === 'good', undefined, { timeout: 8000 });
  await p.page.waitForSelector(`#task-list li.done[data-kind="${kind}"]`, { timeout: 5000 });
  await p.page.locator('#task').waitFor({ state: 'hidden', timeout: 5000 });
}

async function waitForPanel(p: Player): Promise<void> {
  await p.page.locator(`${ACTION}, #task-body .chips`).first().waitFor({ state: 'visible', timeout: 5000 });
}

// Walks to a station with the arrow keys, opens it with E, solves it by mouse.
async function walkAndSolve(p: Player, kind: TaskKind, waypoints: readonly { x: number; y: number; within: number }[]): Promise<boolean> {
  if (!(await walkTo(p, waypoints))) return false;
  await p.page.locator('#interact').waitFor({ state: 'visible', timeout: 5000 });
  if (kind === 'ledger') await shoot(p, 'station.png');
  await p.page.keyboard.press('KeyE');
  await waitForPanel(p);
  await shoot(p, `task-${kind}.png`);
  await solve(p, 'mouse', kind);
  await verdict(p, kind);
  return true;
}

// Opens every station and solves it with one input mode only; the player is placed beside each station.
async function playEveryStation(p: Player, mode: Exclude<InputMode, 'mouse'>): Promise<void> {
  for (const kind of TASK_KINDS) {
    step(`${p.name} solves ${kind} by ${mode}`);
    await placeAt(p, kind);
    await p.page.locator('#interact').waitFor({ state: 'visible', timeout: 5000 });
    if (mode === 'touch') await p.page.tap('#interact');
    else await p.page.keyboard.press('KeyE');
    await waitForPanel(p);
    if (mode === 'touch') await shoot(p, `phone-task-${kind}.png`);
    await solve(p, mode, kind, mode === 'touch' ? 'phone-deposit-signed.png' : undefined);
    await verdict(p, kind);
    check(true, `${p.name}: finishes the ${kind} task by ${mode} alone`);
  }
}

async function main(): Promise<void> {
  const game = createGameServer({
    allowedOrigins: new Set([WEB]),
    ipPolicy: { trustedProxies: new Set() },
    gracefullyShutdown: false,
    resultMs: 4000,
    // One real withdrawal opens a second in and stays open; later ones would only add noise.
    ceremonyTiming: { ...CEREMONY_TIMING, firstProposalMs: 1000, spawnMinMs: 3_600_000, spawnMaxMs: 3_600_000, ttlMs: 900_000, forgeCooldownMs: 1000, auditMs: 1500 },
    councilTiming: { ...COUNCIL_TIMING, openingMs: 0, resultMs: 2500 },
    sabotageTiming: { ...SABOTAGE_TIMING, openingMs: 0, partitionMs: 120_000, repairMs: 1500, freezeMs: 3000 },
    profiles: { store: new MemoryProfileStore(), keys: { current: randomBytes(32), previous: null, secure: false } },
    bots: {},
  });
  let web: PreviewServer | undefined;
  let browser: Browser | undefined;
  try {
    step('build and serve');
    await game.listen(GAME_PORT, '127.0.0.1');
    // Same settings the production build reads; VITE_E2E exposes read-only positions.
    process.env['VITE_SERVER_URL'] = `http://127.0.0.1:${String(GAME_PORT)}`;
    process.env['VITE_E2E'] = '1';
    await build({ root: clientRoot, logLevel: 'warn', build: { outDir: 'dist-e2e', emptyOutDir: true } });
    web = await preview({
      root: clientRoot,
      logLevel: 'warn',
      build: { outDir: 'dist-e2e' },
      preview: { host: '127.0.0.1', port: WEB_PORT, strictPort: true },
    });
    browser = await chromium.launch({ executablePath: BRAVE, headless: true, chromiumSandbox: true, timeout: 30_000 });
    await mkdir(shots, { recursive: true });

    step('alice creates a private room');
    const alice = await openPlayer(browser, 'alice', `${WEB}/`);
    await alice.page.locator('#open-progress').waitFor({ state: 'visible', timeout: 10_000 });
    check((await alice.page.textContent('#open-progress'))?.startsWith('Rank 1 · 500 sats') === true, 'alice: a guest profile starts at Rank 1 with 500 play sats');
    await shoot(alice, 'menu.png');

    // The solo Academy: level 1 is two blind-signed deposits, checked by the server.
    step('alice plays the Academy');
    await alice.page.click('#open-academy');
    await alice.page.locator('#academy .academy-levels').first().waitFor({ state: 'visible', timeout: 5000 });
    await shoot(alice, 'academy.png');
    await alice.page.click('#academy .level:first-child button');
    await alice.page.click('#academy .academy-actions button.cta');
    for (let drill = 0; drill < 2; drill++) {
      await alice.page.locator('#academy .academy-game .chips').waitFor({ state: 'visible', timeout: 8000 });
      await solveDeposit(alice, 'mouse', drill === 0 ? 'academy-drill.png' : undefined, '#academy .academy-game > button.cta');
      await alice.page.waitForFunction((n) => (document.querySelector('#academy .academy-drill .hint')?.textContent ?? '').startsWith(`Drill ${String(n + 2)}`) || document.querySelector('#academy .academy-stars') !== null, drill, { timeout: 8000 });
    }
    await alice.page.locator('#academy .academy-stars').waitFor({ state: 'visible', timeout: 8000 });
    check(((await alice.page.textContent('#academy .academy-stars')) ?? '').includes('★'), 'alice: clears Academy level 1 and earns stars');
    await shoot(alice, 'academy-done.png');
    await alice.page.click('#academy-close');
    await alice.page.waitForFunction(() => (document.getElementById('open-progress')?.textContent ?? '').startsWith('Rank 2'), undefined, { timeout: 8000 });
    check(true, 'alice: the first Academy clear is saved to her profile and ranks her up');
    await alice.page.fill('#nickname', 'Alice');
    await alice.page.click('button[data-action="create"]');
    await inRoom(alice);
    await alice.page.waitForFunction(() => /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(document.getElementById('room-code-text')?.textContent ?? ''));
    const shown = (await alice.page.textContent('#room-code-text')) ?? '';
    const code = shown.replace('-', '');
    check((await alice.page.textContent('#room-kind')) === 'Private room', 'alice: room is marked private');

    step('alice tries a practice bot');
    await alice.page.click('#add-bot');
    await alice.page.locator('#roster .tag.bot').waitFor({ state: 'visible', timeout: 8000 });
    check(true, 'alice: adds a practice bot, tagged Bot in the roster');
    await shoot(alice, 'lobby-bot.png');
    await alice.page.click('#roster .remove-bot');
    await alice.page.locator('#roster .tag.bot').waitFor({ state: 'detached', timeout: 8000 });
    check(true, 'alice: removes the bot again');

    step('bob follows the invite link');
    const bob = await openPlayer(browser, 'bob', `${WEB}/#join=${code}`);
    check((await bob.page.inputValue('#room-code')) === code, 'bob: invite link fills in the room code');
    await bob.page.fill('#nickname', 'Bob');
    await bob.page.click('button[data-action="join"]');
    await inRoom(bob);
    await rosterSize(alice, 2);
    await rosterSize(bob, 2);
    check((await bob.page.textContent('#room-code-text')) === shown, 'bob: sees the same room code');

    step('alice walks and bob watches');
    const aliceId = await alice.page.evaluate(() => window.__bcSmoke?.me() ?? '');
    const start = (await serverView(bob)).find((p) => p.id === aliceId);
    if (start === undefined) throw new Error('bob cannot see alice');
    await alice.page.keyboard.down('ArrowRight');
    await alice.page.waitForTimeout(700);
    await alice.page.keyboard.up('ArrowRight');
    await bob.page.waitForFunction(
      ([id, x]) => (window.__bcSmoke?.server() ?? []).some((p) => p.id === id && p.x !== x),
      [aliceId, start.x] as const,
      { timeout: 10_000 },
    );
    await alice.page.waitForTimeout(600);
    const end = (await serverView(bob)).find((p) => p.id === aliceId);
    const own = (await serverView(alice)).find((p) => p.id === aliceId);
    const predicted = await alice.page.evaluate(() => window.__bcSmoke?.predicted() ?? null);
    check(end !== undefined && end.x > start.x && end.y < start.y, 'bob: sees alice walk toward screen-right');
    check(end?.x === own?.x && end?.y === own?.y, 'both players agree on alice’s position');
    check(predicted?.x === own?.x && predicted?.y === own?.y, 'alice: prediction matches the server exactly once settled');
    await shoot(alice, 'alice.png');
    await shoot(bob, 'bob.png');

    step('bob reloads');
    const bobId = await bob.page.evaluate(() => window.__bcSmoke?.me() ?? '');
    await bob.page.reload({ waitUntil: 'load' });
    await inRoom(bob);
    const bobAgain = await bob.page.evaluate(() => window.__bcSmoke?.me() ?? '');
    check(bobAgain === bobId && bobId !== '', 'bob: reload rejoins the same seat');
    await rosterSize(alice, 2);

    step('three more guardians arrive');
    check(!(await alice.page.isHidden('#start-match')) && (await alice.page.isDisabled('#start-match')), 'alice: start is offered but waits for five guardians');
    check(await bob.page.isHidden('#start-match'), 'bob: only the host sees the start button');
    const cara = await joinByLink(browser, 'Cara', code);
    const dan = await joinByLink(browser, 'Dan', code);
    const eve = await joinByLink(browser, 'Eve', code, PHONE);
    const everyone = [alice, bob, cara, dan, eve];
    for (const p of everyone) await rosterSize(p, 5);
    step('the host picks the full council rules');
    check(((await bob.page.textContent('#tier-badge')) ?? '') === 'Apprentice rules', 'bob: new guardians start on apprentice rules');
    check(await bob.page.locator('#tier-choices button', { hasText: 'Full council' }).isDisabled(), 'bob: only the host picks the rules');
    await alice.page.locator('#tier-choices button', { hasText: 'Full council' }).click();
    await bob.page.waitForFunction(() => document.getElementById('tier-badge')?.textContent === 'Full council', undefined, { timeout: 10_000 });
    check(true, 'everyone sees the full council rules');
    await alice.page.waitForFunction(() => !(document.getElementById('start-match') as HTMLButtonElement | null)?.disabled, undefined, { timeout: 10_000 });
    await shoot(alice, 'lobby-ready.png');
    await alice.page.click('#start-match');

    step('roles are dealt');
    for (const p of everyone) await p.page.locator('#role-card').waitFor({ state: 'visible', timeout: 10_000 });
    const seen = await Promise.all(everyone.map(knownRoles));
    const dealt = seen.map((v) => v.roles.find((r) => r.id === v.me)?.role ?? null);
    check(dealt.filter((r) => r === 'byzantine').length === 1 && dealt.filter((r) => r === 'honest').length === 4, 'one Byzantine and four honest guardians were dealt');
    check(seen.every((v) => v.roles.filter((r) => r.role !== null).length === 1), 'every browser received only its own role');
    const byzIndex = dealt.indexOf('byzantine');
    const byz = everyone[byzIndex];
    const honest = everyone.filter((_, i) => i !== byzIndex);
    const [worker, watcher] = honest.filter((p) => p !== eve);
    if (byz === undefined || worker === undefined || watcher === undefined) throw new Error('could not pick players');
    check((await byz.page.textContent('#role-title'))?.includes('Byzantine') === true, `${byz.name}: role card says Byzantine`);
    await shoot(worker, 'role-honest.png');
    await shoot(byz, 'role-byzantine.png');
    await shoot(eve, 'phone-role.png');
    for (const p of everyone) await p.page.click('#role-ok');

    // An honest guardian walks to each station with the arrow keys and solves every minigame by mouse.
    step(`${worker.name} walks to the Ledger Archive`);
    const ledger = await walkAndSolve(worker, 'ledger', [
      { x: 17, y: 12, within: 0.3 },
      { x: 19.5, y: 8.6, within: 0.3 },
    ]);
    check(ledger, `${worker.name}: walks to the Ledger Archive and rejects the two bad notes`);
    await watcher.page.waitForFunction(() => (window.__bcSmoke?.consensus() ?? 0) > 0, undefined, { timeout: 5000 });
    const shownConsensus = await watcher.page.textContent('#consensus-value');
    check(shownConsensus === '6%', `${watcher.name}: the Consensus bar shows the honest task (${shownConsensus ?? ''})`);
    step(`${worker.name} walks to the Watchtower`);
    const watchtower = await walkAndSolve(worker, 'watchtower', [
      { x: 22.5, y: 8.4, within: 0.3 },
      { x: 24.5, y: 6.6, within: 0.3 },
    ]);
    check(watchtower, `${worker.name}: confirms the median block height at the Watchtower`);
    step(`${worker.name} walks to the Gateway Dock`);
    const route = await walkAndSolve(worker, 'route', [
      { x: 24.5, y: 8.0, within: 0.3 },
      { x: 24.5, y: 20.3, within: 0.3 },
      { x: 26.4, y: 21.3, within: 0.3 },
    ]);
    check(route, `${worker.name}: routes a Lightning payment at the Gateway Dock`);
    step(`${worker.name} walks to the Deposit Gate`);
    const deposit = await walkAndSolve(worker, 'deposit', [
      { x: 24, y: 21.3, within: 0.3 },
      { x: 21, y: 21.3, within: 0.3 },
      { x: 20, y: 24.5, within: 0.3 },
      { x: 14.8, y: 24.5, within: 0.25 },
      { x: 10.6, y: 24.5, within: 0.25 },
      { x: 8.6, y: 24.5, within: 0.3 },
      { x: 8.6, y: 26.4, within: 0.3 },
    ]);
    check(deposit, `${worker.name}: blind-signs a deposit at the Deposit Gate`);
    await watcher.page.waitForFunction(() => window.__bcSmoke?.consensus() === 25, undefined, { timeout: 5000 });
    check(true, `${watcher.name}: sees consensus reach 25% after four honest tasks`);
    await shoot(worker, 'match-hud.png');
    await shoot(eve, 'phone-match.png');

    // One guardian plays every station with the keyboard alone, the phone player with touch alone.
    step('keyboard and touch players solve every station');
    await Promise.all([playEveryStation(watcher, 'keyboard'), playEveryStation(eve, 'touch')]);
    const expected = Math.floor((100 * (8 + (byz === eve ? 0 : 4))) / 16);
    await worker.page.waitForFunction((n) => window.__bcSmoke?.consensus() === n, expected, { timeout: 5000 });
    check((await worker.page.textContent('#consensus-value')) === `${String(expected)}%`, `${worker.name}: the bar counts only honest tasks (${String(expected)}%)`);

    step('a reload mid-match');
    await watcher.page.reload({ waitUntil: 'load' });
    await inRoom(watcher);
    await watcher.page.waitForFunction(() => window.__bcSmoke?.phase() === 'playing', undefined, { timeout: 10_000 });
    const afterReload = await knownRoles(watcher);
    check(afterReload.roles.find((r) => r.id === afterReload.me)?.role === 'honest', `${watcher.name}: keeps their role after a reload`);

    // Signing ceremony: a forgery, an audit, refusals, and a real withdrawal signed to threshold.
    step('a signing ceremony');
    smokePhone = eve;
    for (const p of everyone) await p.page.locator('.proposal[data-id="1"]').waitFor({ state: 'visible', timeout: 10_000 });
    check(true, 'everyone sees the first real withdrawal');
    await placeOn(byz, { x: 3.5, y: 16.5 });
    await byz.page.waitForFunction(() => document.querySelector<HTMLButtonElement>('#forge')?.disabled === false, undefined, { timeout: 5000 });
    if (byz === eve) await byz.page.tap('#forge');
    else await byz.page.click('#forge');
    for (const p of everyone) await p.page.locator('.proposal[data-id="2"]').waitFor({ state: 'visible', timeout: 8000 });
    await cardShows(byz, '2', 'Your team’s forgery');
    const honestSee = await Promise.all(honest.map((p) => cardText(p, '2')));
    check(honestSee.every((t) => !t.includes('forgery')), `${byz.name}: forges in the Signing Hall, and only they know which one it is`);
    check(await honest[0]?.page.isHidden('#forge-box') ?? false, 'honest guardians get no forge control');

    await placeAt(worker, 'ledger');
    await onCard(worker, '2', 'audit');
    await cardShows(worker, '2', 'You checked: forged');
    check(!(await cardText(watcher, '2')).includes('You checked'), `${worker.name}: audits #2 at the Ledger Archive and alone learns it is forged`);
    await shoot(worker, 'proposals-audit.png');

    await onCard(worker, '2', 'refuse');
    await onCard(watcher, '2', 'refuse');
    for (const p of everyone) await cardShows(p, '2', 'Forged');
    check((await cardText(eve, '2')).includes('Blocked'), 'two refusals block the forgery and everyone sees it was forged');

    for (const p of honest.slice(0, threshold(5))) await onCard(p, '1', 'sign');
    for (const p of everyone) await cardShows(p, '1', 'Passed');
    check((await cardText(byz, '1')).includes('Real'), 'four honest signatures pass the real withdrawal');
    check((await watcher.page.locator('#liveness .pip.lost').count()) === 0, 'liveness is untouched');
    await shoot(watcher, 'proposals.png');
    await shoot(eve, 'phone-proposals.png');

    // A council: called from the seal, a quick-chat claim reaches everyone, and skips win.
    step('a council meeting');
    await placeOn(watcher, { x: COUNCIL_SEAL.x, y: COUNCIL_SEAL.y + 0.5 });
    await watcher.page.locator('#call-council').waitFor({ state: 'visible', timeout: 5000 });
    await watcher.page.click('#call-council');
    for (const p of everyone) await p.page.locator('#council').waitFor({ state: 'visible', timeout: 8000 });
    check(true, `${watcher.name}: calls a council from the seal and it opens for everyone`);
    await worker.page.selectOption('#chat-compose select[aria-label="Withdrawal"]', '2');
    await worker.page.click('#chat-compose button:text-is("I audited: forged")');
    for (const p of everyone) {
      await p.page.waitForFunction(() => document.getElementById('chat-log')?.textContent.includes('I audited #2: it’s forged.') === true, undefined, { timeout: 5000 });
    }
    check(true, `${worker.name}: a quick-chat claim reaches every guardian`);
    await shoot(watcher, 'council.png');
    await shoot(eve, 'phone-council.png');
    for (const p of everyone) {
      if (p === eve) await p.page.tap('#council-skip');
      else await p.page.click('#council-skip');
    }
    for (const p of everyone) await p.page.waitForFunction(() => document.getElementById('council-outcome')?.textContent === 'No key was rotated out.', undefined, { timeout: 8000 });
    check(true, 'everyone skips, and no key is rotated out');
    await shoot(watcher, 'council-result.png');
    for (const p of everyone) await p.page.locator('#council').waitFor({ state: 'hidden', timeout: 8000 });
    check((await watcher.page.evaluate(() => window.__bcSmoke?.phase())) === 'playing', 'play resumes after the council');

    // Sabotage: the Byzantine cuts the network, two guardians repair it at the relays, then a freeze.
    step('a network partition');
    await byz.page.waitForFunction(() => document.querySelector<HTMLButtonElement>('#cut')?.disabled === false, undefined, { timeout: 5000 });
    if (byz === eve) await byz.page.tap('#cut');
    else await byz.page.click('#cut');
    for (const p of everyone) await p.page.locator('#partition-banner').waitFor({ state: 'visible', timeout: 5000 });
    check(true, `${byz.name}: cuts the network and everyone sees the partition`);
    await shoot(worker, 'partition.png');
    await shoot(eve, 'phone-partition.png');
    const [relayA, relayB] = RELAYS;
    if (relayA === undefined || relayB === undefined) throw new Error('no relays');
    await placeOn(worker, relayA);
    await placeOn(watcher, relayB);
    for (const p of everyone) await p.page.locator('#partition-banner').waitFor({ state: 'hidden', timeout: 8000 });
    check((await worker.page.locator('#liveness .pip.lost').count()) === 0, 'two guardians on both relays repair the partition in time');

    step('a guardian is disconnected');
    await placeOn(byz, { x: relayB.x + 0.8, y: relayB.y });
    await byz.page.waitForFunction(() => document.querySelector<HTMLButtonElement>('#freeze')?.hidden === false, undefined, { timeout: 5000 });
    check((await byz.page.textContent('#freeze'))?.includes(watcher.name.charAt(0).toUpperCase() + watcher.name.slice(1)) === true, `${byz.name}: is offered to disconnect the guardian beside them`);
    if (byz === eve) await byz.page.tap('#freeze');
    else await byz.page.click('#freeze');
    await watcher.page.locator('#frozen-note').waitFor({ state: 'visible', timeout: 5000 });
    check(true, `${watcher.name}: is frozen and told so, without being told by whom`);
    check(!((await watcher.page.textContent('#frozen-note')) ?? '').includes(byz.name), 'the frozen guardian is not told who did it');
    await shoot(watcher, 'frozen.png');
    await watcher.page.locator('#frozen-note').waitFor({ state: 'hidden', timeout: 8000 });
    check(true, `${watcher.name}: thaws after the freeze`);

    // The phone player always stays to see the result: if they are the Byzantine, two honest
    // guardians walk out and the federation halts; otherwise the Byzantine walks out.
    step('the match ends');
    const leavers = byz === eve ? honest.filter((p) => p !== worker && p !== watcher) : [byz];
    for (const p of leavers) {
      await p.page.click('#leave');
      await p.page.locator('#menu-form').waitFor({ state: 'visible', timeout: 10_000 });
    }
    const stayed = everyone.filter((p) => !leavers.includes(p));
    for (const p of stayed) await p.page.locator('#result').waitFor({ state: 'visible', timeout: 10_000 });
    const title = await watcher.page.textContent('#result-title');
    const recapLeft = await watcher.page.locator('#result-roles .tag.left').count();
    const recapByzantine = await watcher.page.locator('#result-roles .tag.byzantine').count();
    const revealed = await knownRoles(watcher);
    if (byz === eve) {
      check(title === 'Byzantine guardians win', 'everyone left sees the federation halt');
      check(recapLeft === 2 && recapByzantine === 1, 'the recap lists both guardians who left and the Byzantine');
      check(revealed.roles.length === 3 && revealed.roles.filter((r) => r.role === 'byzantine').length === 1, 'roles are revealed once the match ends');
    } else {
      check(title === 'Honest guardians win', 'everyone left sees the honest win');
      check(recapLeft === 1 && recapByzantine === 1, 'the recap names the Byzantine who walked out');
      check(revealed.roles.length === 4 && revealed.roles.every((r) => r.role === 'honest'), 'roles are revealed once the match ends');
    }
    await worker.page.locator('#rewards-body .xp-lines').waitFor({ state: 'visible', timeout: 10_000 });
    check((await worker.page.textContent('#rewards-body'))?.includes('Your side won') === (title === 'Honest guardians win'), `${worker.name}: sees their XP lines in the result card`);
    check((await worker.page.locator('#rewards-body .seal-earned').count()) > 0, `${worker.name}: earns their first seals`);
    await shoot(worker, 'rewards.png');
    await shoot(watcher, 'result.png');
    await shoot(eve, 'phone-result.png');

    step('back in the lobby');
    const host = stayed.find((p) => p === alice) ?? stayed[0];
    if (host === undefined) throw new Error('nobody left');
    await host.page.locator('#result').waitFor({ state: 'hidden', timeout: 10_000 });
    const cleared = await knownRoles(host);
    check(cleared.roles.every((r) => r.role === null), 'roles are cleared back in the lobby');

    // Alice leaves if she is still here: someone else becomes host and Alice is back at the menu.
    step('the host leaves');
    if (stayed.includes(alice)) {
      await alice.page.click('#leave');
      await alice.page.locator('#menu-form').waitFor({ state: 'visible', timeout: 10_000 });
    }
    const remaining = stayed.filter((p) => p !== alice);
    for (const p of remaining) await rosterSize(p, remaining.length);
    const newHost = remaining[0];
    if (newHost === undefined) throw new Error('no one remains');
    await newHost.page.waitForFunction(() => document.querySelector('#roster li .tag.host') !== null, undefined, { timeout: 10_000 });
    check(true, 'a new host takes over after alice leaves');

    // Back at the menu, the progress page shows what the match paid for.
    step('the progress page');
    if (remaining.includes(worker)) {
      await worker.page.click('#leave');
      await worker.page.locator('#menu-form').waitFor({ state: 'visible', timeout: 10_000 });
    }
    await worker.page.waitForFunction(() => !(document.getElementById('open-progress')?.textContent ?? '').startsWith('Rank 1 '), undefined, { timeout: 10_000 });
    await worker.page.click('#open-progress');
    await worker.page.locator('#progress').waitFor({ state: 'visible', timeout: 5000 });
    check(/^Rank [2-9]/.test((await worker.page.textContent('#progress-title')) ?? ''), `${worker.name}: ranked up, and the progress page shows it`);
    await shoot(worker, 'progress-rank.png');
    await worker.page.click('.progress-tabs [data-tab="seals"]');
    check((await worker.page.locator('.seal-card.done').count()) > 0, `${worker.name}: the Seal Book shows the seals they earned`);
    await shoot(worker, 'progress-seals.png');
    await worker.page.click('.progress-tabs [data-tab="quests"]');
    await shoot(worker, 'progress-quests.png');
  } catch (error) {
    problems.push(`fatal during "${currentStep}": ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`);
    // What every page showed when it failed.
    for (const p of open) await shoot(p, `fatal-${p.name}.png`).catch(() => undefined);
  } finally {
    for (const p of open) await p.context.close().catch(() => undefined);
    await browser?.close();
    await web?.close();
    await game.server.gracefullyShutdown(false).catch(() => undefined);
  }
}

await main();
for (const label of passed) console.log(`ok   ${label}`);
for (const problem of problems) console.error(`FAIL ${problem}`);
console.log(problems.length === 0 ? `smoke: ok (${String(passed.length)} checks, screenshots in .scratch/e2e)` : `smoke: ${String(problems.length)} problem(s)`);
process.exitCode = problems.length === 0 ? 0 : 1;
