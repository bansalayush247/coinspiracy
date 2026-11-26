// Offline and update check for the PWA: production build, vite preview, headless Brave.
// Run: npx tsx --conditions=source e2e/offline.ts
import { rm } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright-core';
import { build, preview, type PreviewServer } from 'vite';
import { BRAVE, CLIENT_ROOT, check, checkNoErrors, finish } from './harness.js';

const OUT = 'dist-offline';
const WEB_PORT = 3940;
const WEB = `http://127.0.0.1:${String(WEB_PORT)}`;

// Each build names a different (unreachable) game server, so the bundle and the worker version differ.
async function buildAndServe(serverPort: number): Promise<PreviewServer> {
  process.env['VITE_SERVER_URL'] = `http://127.0.0.1:${String(serverPort)}`;
  delete process.env['VITE_E2E'];
  await build({ root: CLIENT_ROOT, logLevel: 'warn', build: { outDir: OUT, emptyOutDir: true } });
  return preview({ root: CLIENT_ROOT, logLevel: 'warn', build: { outDir: OUT }, preview: { host: '127.0.0.1', port: WEB_PORT, strictPort: true } });
}

async function main(): Promise<void> {
  let web: PreviewServer | undefined;
  let browser: Browser | undefined;
  try {
    web = await buildAndServe(3941);
    browser = await chromium.launch({ executablePath: BRAVE, headless: true, chromiumSandbox: true, timeout: 30_000 });
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      // The game server is deliberately absent, and offline requests fail by design.
      if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text());
    });

    const headers = (await page.goto(`${WEB}/`))?.headers() ?? {};
    check((headers['content-security-policy'] ?? '').includes("worker-src 'self'"), 'the page CSP allows a same-origin worker');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    check(scope === `${WEB}/`, 'the service worker installs with scope /');
    check(await page.locator('link[rel="manifest"]').count() === 1, 'the page links the web app manifest');

    await page.reload();
    check(await page.evaluate(() => navigator.serviceWorker.controller !== null), 'a reload is controlled by the worker');

    await context.setOffline(true);
    await page.reload();
    await page.locator('#nickname').waitFor({ state: 'attached', timeout: 10_000 });
    check(true, 'offline: the menu loads from the cache');
    check(await page.evaluate(() => document.querySelectorAll('script[type="module"]').length > 0), 'offline: the entry script is served');
    await context.setOffline(false);

    await web.close();
    web = await buildAndServe(3942);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    await page.locator('#pwa-update').waitFor({ state: 'visible', timeout: 15_000 });
    check(true, 'a new version shows the update banner instead of reloading');
    const before = await page.evaluate(() => performance.timeOrigin);
    await page.locator('#pwa-update .pwa-update-reload').first().click();
    await page.waitForFunction((t) => performance.timeOrigin !== t, before, { timeout: 10_000 });
    check(true, 'choosing Reload switches to the new version');

    checkNoErrors(errors);
  } finally {
    await browser?.close();
    await web?.close();
    await rm(`${CLIENT_ROOT}/${OUT}`, { recursive: true, force: true });
  }
  finish('offline');
}

await main();
