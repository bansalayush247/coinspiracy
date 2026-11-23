import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Node-environment tests resolve through Vite's ssr environment; top-level resolve.conditions does not reach it.
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // One process per file keeps the Colyseus matchMaker singleton isolated.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: { LOG_LEVEL: 'silent' },
  },
});
