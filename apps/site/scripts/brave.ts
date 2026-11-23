// Headless Brave for the asset scripts; override the path with BRAVE_PATH.
import { chromium, type Browser } from 'playwright-core';

export const BRAVE = process.env['BRAVE_PATH'] ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

export function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: BRAVE, headless: true, chromiumSandbox: true, timeout: 30_000 });
}
