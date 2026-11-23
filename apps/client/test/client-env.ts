import type { Environment } from 'vitest/runtime';

// Runs pure-logic tests through Vite's client environment (browser resolve conditions) without a DOM.
export default {
  name: 'client-logic',
  viteEnvironment: 'client',
  setup() {
    return {
      teardown() {
        // nothing to tear down
      },
    };
  },
} satisfies Environment;
