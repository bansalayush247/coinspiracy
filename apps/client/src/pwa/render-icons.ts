/* eslint-disable no-restricted-imports, no-restricted-globals -- Node script run with tsx; the browser bundle never imports it */
// Renders the PWA icons from public/favicon.svg with headless Brave: npx tsx apps/client/src/pwa/render-icons.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { pngSize } from './shell.js';

const BRAVE = process.env['BRAVE_PATH'] ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));

interface IconSpec {
  readonly file: string;
  readonly size: number;
  // "tile" has rounded transparent corners; "full" is full-bleed for launchers that apply their own mask.
  readonly shape: 'tile' | 'full';
  // Width of the favicon art as a share of the icon.
  readonly art: number;
  // Maskable icons: the art must stay inside this radius (a share of the size); launchers crop the rest.
  readonly safeRadius?: number;
}

const ICONS: readonly IconSpec[] = [
  { file: 'icon-192.png', size: 192, shape: 'tile', art: 0.66 },
  { file: 'icon-512.png', size: 512, shape: 'tile', art: 0.66 },
  { file: 'icon-maskable-512.png', size: 512, shape: 'full', art: 0.72, safeRadius: 0.4 },
  { file: 'apple-touch-icon.png', size: 180, shape: 'full', art: 0.74 },
];

// Dusk plum from the palette behind the gold seal; the page background is #2a1a33.
function page(svg: string, spec: IconSpec): string {
  const s = spec.size;
  const radius = spec.shape === 'tile' ? Math.round(s * 0.22) : 0;
  const art = Math.round(s * spec.art);
  return `<!doctype html><html><head><style>
html, body { margin: 0; background: transparent; }
.tile { width: ${String(s)}px; height: ${String(s)}px; display: grid; place-items: center; overflow: hidden;
  border-radius: ${String(radius)}px; background: radial-gradient(circle at 50% 40%, #7d62c4 0%, #553a86 30%, #3a2452 62%, #2a1a33 100%); }
.tile svg { width: ${String(art)}px; height: ${String(art)}px; filter: drop-shadow(0 ${String(Math.round(s * 0.02))}px ${String(Math.round(s * 0.03))}px rgba(16, 8, 24, 0.5)); }
</style></head><body><div class="tile">${svg}</div></body></html>`;
}

// Runs in the page: the farthest point of any favicon path from the icon's centre, sampled along each outline.
function artReach(size: number): number {
  let reach = 0;
  for (const shape of Array.from(document.querySelectorAll('svg path'))) {
    if (!(shape instanceof SVGGeometryElement)) continue;
    const matrix = shape.getScreenCTM();
    if (matrix === null) continue;
    const length = shape.getTotalLength();
    for (let i = 0; i <= 400; i++) {
      const p = shape.getPointAtLength((length * i) / 400).matrixTransform(matrix);
      reach = Math.max(reach, Math.hypot(p.x - size / 2, p.y - size / 2));
    }
  }
  return reach;
}

async function main(): Promise<void> {
  const svg = (await readFile(path.join(publicDir, 'favicon.svg'), 'utf8')).trim();
  if (!svg.startsWith('<svg') || /<script|on[a-z]+=/i.test(svg)) throw new Error('favicon.svg must be a plain SVG');
  const browser = await chromium.launch({ executablePath: BRAVE, headless: true, chromiumSandbox: true, timeout: 30_000 });
  try {
    for (const spec of ICONS) {
      const context = await browser.newContext({ viewport: { width: spec.size, height: spec.size }, deviceScaleFactor: 1 });
      const tab = await context.newPage();
      await tab.setContent(page(svg, spec), { waitUntil: 'load' });
      if (spec.safeRadius !== undefined) {
        const reach = await tab.evaluate(artReach, spec.size);
        if (reach > spec.safeRadius * spec.size) throw new Error(`${spec.file}: art reaches ${reach.toFixed(1)}px from the centre, outside the safe zone`);
      }
      const out = path.join(publicDir, 'icons', spec.file);
      await tab.screenshot({ path: out, omitBackground: spec.shape === 'tile', clip: { x: 0, y: 0, width: spec.size, height: spec.size } });
      await context.close();
      const size = pngSize(new Uint8Array(await readFile(out)));
      if (size?.width !== spec.size || size.height !== spec.size) throw new Error(`${spec.file} came out wrong`);
      console.log(`wrote public/icons/${spec.file} (${String(spec.size)}x${String(spec.size)})`);
    }
  } finally {
    await browser.close();
  }
}

await main();
