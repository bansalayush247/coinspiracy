// Plumbing every browser check shares: a production client build served by vite preview, headless Brave,
// page-error collection and pass/fail counting.
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build, preview, type PreviewServer } from 'vite';

/** The client app the checks build. */
export const CLIENT_ROOT = fileURLToPath(new URL('../apps/client', import.meta.url));
/** Where screenshots land; the ones worth keeping are also written to production/qa/evidence/. */
export const SHOTS = fileURLToPath(new URL('../.scratch/e2e/', import.meta.url));
/** The browser the checks drive; BRAVE_PATH overrides it. */
export const BRAVE = process.env['BRAVE_PATH'] ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

let failures = 0;

/** Prints one check, counting it when it failed. */
export function check(ok: boolean, label: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

/** Passes when no page error or console error was collected. */
export function checkNoErrors(errors: readonly string[]): void {
  check(errors.length === 0, `no console errors${errors.length > 0 ? `: ${errors.join(' | ')}` : ''}`);
}

/** Ends the run: exit code 1 when any check failed. */
export function finish(name: string): never {
  if (failures > 0) {
    console.log(`${String(failures)} check(s) failed`);
    process.exit(1);
  }
  console.log(`${name}: ok`);
  process.exit(0);
}

/** Collects a page's uncaught errors and console errors, prefixed with a name when one is given. */
export function collectErrors(page: Page, errors: string[], name?: string): void {
  const tag = name === undefined ? '' : `${name}: `;
  page.on('pageerror', (e) => errors.push(`${tag}${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${tag}${m.text()}`);
  });
}

/** A served client build and a browser, closed together. */
export interface Rig {
  readonly web: string;
  readonly browser: Browser;
  close(): Promise<void>;
}

/** What to build the client against. */
export interface RigOptions {
  /** Build folder under apps/client; removed on close. */
  readonly outDir: string;
  readonly webPort: number;
  /** The game server the built client connects to. */
  readonly serverUrl: string;
  /** Turns on the client's test hooks (default true). */
  readonly e2e?: boolean;
}

/** Builds the client, serves it on 127.0.0.1 and launches headless Brave; cleans up after itself if any step fails. */
export async function openRig(opts: RigOptions): Promise<Rig> {
  process.env['VITE_SERVER_URL'] = opts.serverUrl;
  if (opts.e2e ?? true) process.env['VITE_E2E'] = '1';
  else delete process.env['VITE_E2E'];
  let web: PreviewServer | undefined;
  let browser: Browser | undefined;
  const close = async (): Promise<void> => {
    await browser?.close();
    await web?.close();
    await rm(`${CLIENT_ROOT}/${opts.outDir}`, { recursive: true, force: true });
  };
  try {
    await build({ root: CLIENT_ROOT, logLevel: 'warn', build: { outDir: opts.outDir, emptyOutDir: true } });
    web = await preview({ root: CLIENT_ROOT, logLevel: 'warn', build: { outDir: opts.outDir }, preview: { host: '127.0.0.1', port: opts.webPort, strictPort: true } });
    browser = await chromium.launch({ executablePath: BRAVE, headless: true, chromiumSandbox: true, timeout: 30_000 });
    await mkdir(SHOTS, { recursive: true });
    return { web: `http://127.0.0.1:${String(opts.webPort)}`, browser, close };
  } catch (error) {
    await close();
    throw error;
  }
}
