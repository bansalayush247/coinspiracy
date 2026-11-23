import sitemap from '@astrojs/sitemap';
import { createRequire } from 'node:module';
import { defineConfig } from 'astro/config';
import { siteConfig } from './src/config/integration.js';
import { lastModifiedFor } from './src/data/pages.js';

const astroCookie = createRequire(createRequire(import.meta.url).resolve('astro/package.json')).resolve('cookie');

// 3930/3931 keep clear of the game (5180, 2567) and the other local services.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  server: { host: '127.0.0.1', port: 3930 },
  devToolbar: { enabled: false },
  // Compression drops the space between a line break and an inline element ("from<em>n</em>").
  compressHTML: false,
  build: { format: 'directory', inlineStylesheets: 'never' },
  // The CSP forbids inline scripts, so Astro must not add any.
  prefetch: false,
  integrations: [
    siteConfig(),
    sitemap({
      filter: (page) => !page.endsWith('/404/'),
      serialize: (item) => {
        const lastmod = lastModifiedFor(new URL(item.url).pathname);
        return lastmod === null ? item : { ...item, lastmod };
      },
    }),
  ],
  // The hoisted cookie at the repo root is express's CommonJS 0.7; point Astro at its own 2.x copy.
  vite: { resolve: { conditions: ['source'], alias: { cookie: astroCookie } }, build: { assetsInlineLimit: 0 } },
});
