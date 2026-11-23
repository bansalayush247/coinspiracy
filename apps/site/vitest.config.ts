import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: { resolve: { conditions: ['source'] } },
  test: { name: 'site', environment: 'node', include: ['test/**/*.test.ts'] },
});
