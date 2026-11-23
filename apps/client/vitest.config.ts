import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    // Node-environment resolution goes through Vite's ssr environment, which ignores resolve.conditions.
    ssr: { resolve: { conditions: ['source'] } },
    test: {
      name: 'client',
      environment: './test/client-env.ts',
      include: ['test/**/*.test.ts'],
    },
  }),
);
