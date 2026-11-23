// Converts the e2e screenshots in .scratch/e2e/ to resized WebP files in public/screens/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SCREENS, type Screen } from '../src/data/screens.js';
import { launch } from './brave.js';

const from = fileURLToPath(new URL('../../../.scratch/e2e/', import.meta.url));
const to = fileURLToPath(new URL('../public/screens/', import.meta.url));
const SAFE = /^[a-z0-9-]+$/;
const QUALITY = 0.82;

async function main(): Promise<void> {
  await mkdir(to, { recursive: true });
  const browser = await launch();
  try {
    const page = await browser.newPage();
    for (const screen of Object.values(SCREENS) as Screen[]) {
      if (!SAFE.test(screen.name) || !/^[a-z0-9-]+\.png$/.test(screen.from)) throw new Error(`unsafe screen name ${screen.name}`);
      const png = await readFile(`${from}${screen.from}`);
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
      const webp = await page.evaluate(
        async ({ src, width, height, quality }) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx === null) throw new Error('no 2d context');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          return canvas.toDataURL('image/webp', quality);
        },
        { src: dataUrl, width: screen.width, height: screen.height, quality: QUALITY },
      );
      if (!webp.startsWith('data:image/webp;base64,')) throw new Error('the browser did not encode WebP');
      const bytes = Buffer.from(webp.slice('data:image/webp;base64,'.length), 'base64');
      await writeFile(`${to}${screen.name}.webp`, bytes);
      console.log(`screens/${screen.name}.webp ${String(Math.round(bytes.length / 1024))} KB`);
    }
  } finally {
    await browser.close();
  }
}

await main();
