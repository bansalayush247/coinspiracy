import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig, loadEnv, type Plugin } from 'vite';
import { renderHeadersFile, securityHeaders } from './csp.js';
import { parseFrameAncestors } from './src/platform/frameAncestors.js';
import { pwa } from './src/pwa/vitePlugin.js';
import { DEV_SERVER_PATH, resolveServerEndpoint } from './src/serverUrl.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const sharedDir = fileURLToPath(new URL('../../packages/shared', import.meta.url));
// 5199 is taken on the dev machine; the game server's dev allowlist expects 5180.
const DEV_PORT = 5180;
const PREVIEW_PORT = 4180;
const LOCAL_GAME_SERVER = 'http://127.0.0.1:2567';

// Static hosts read dist/_headers; it matches what `vite preview` sends.
function headersFile(headers: Readonly<Record<string, string>>): Plugin {
  let outDir = '';
  return {
    name: 'byzantine-council-headers',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await writeFile(path.join(outDir, '_headers'), renderHeadersFile(headers));
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, root, ['VITE_', 'FRAME_ANCESTORS']);
  // Builds and previews must name their server; dev and tests fall back to the proxy path.
  const strict = command === 'build' || mode === 'production';
  const server = resolveServerEndpoint(env['VITE_SERVER_URL'], !strict);
  // Portal builds (`--mode portal` or VITE_PLATFORM=portal) are hosted by the portal: relative assets, no PWA, an absolute server.
  const portal = mode === 'portal' || env['VITE_PLATFORM'] === 'portal';
  if (portal && strict && server.connectSources.length === 0) throw new Error('portal builds need an absolute VITE_SERVER_URL (https://…), since the portal hosts the files');
  const headers = securityHeaders(server, parseFrameAncestors(env['FRAME_ANCESTORS']));
  return {
    root,
    envPrefix: 'VITE_',
    ...(portal ? { base: './', define: { 'import.meta.env.VITE_PLATFORM': JSON.stringify('portal') } } : {}),
    resolve: { conditions: ['source', ...defaultClientConditions] },
    plugins: portal ? [headersFile(headers)] : [headersFile(headers), ...pwa()],
    server: {
      host: '127.0.0.1',
      port: DEV_PORT,
      strictPort: true,
      fs: { strict: true, allow: [root, sharedDir] },
      proxy: {
        [DEV_SERVER_PATH]: {
          target: LOCAL_GAME_SERVER,
          ws: true,
          rewrite: (p: string) => p.slice(DEV_SERVER_PATH.length) || '/',
        },
      },
    },
    preview: { host: '127.0.0.1', port: PREVIEW_PORT, strictPort: true, headers },
    build: {
      target: 'baseline-widely-available',
      // Maps would publish the full source next to the bundle.
      sourcemap: false,
      assetsInlineLimit: 0,
      // Phaser alone is about 1.3 MB minified; it gets its own long-cached chunk.
      chunkSizeWarningLimit: 1500,
      rolldownOptions: {
        output: { codeSplitting: { groups: [{ name: 'phaser', test: /node_modules[\\/]phaser[\\/]/ }] } },
      },
    },
  };
});
