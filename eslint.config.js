import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

// Node-only globals that must never appear in code shipped to browsers.
const NODE_GLOBALS = ['process', 'Buffer', 'global', 'require', 'module', '__dirname', '__filename', 'setImmediate'];

export default defineConfig(
  { ignores: ['**/dist/**', '**/dist-e2e/**', '**/node_modules/**', '**/coverage/**', '.scratch/**', '**/.astro/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts'], defaultProject: 'tsconfig.base.json' },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // The browser bundle includes shared source, so both stay free of Node APIs and server packages.
    files: ['apps/client/src/**/*.ts', 'packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...NODE_GLOBALS],
      'no-restricted-imports': [
        'error',
        {
          // Bare builtins ('fs', 'fs/promises') bypass a 'node:*' pattern, and paths only match exact names.
          paths: builtinModules.map((name) => ({ name, message: 'Browser code cannot use Node built-ins.' })),
          patterns: [
            { group: ['node:*'], message: 'Browser code cannot use Node built-ins.' },
            {
              group: [
                '@colyseus/core',
                '@colyseus/core/*',
                '@colyseus/ws-transport',
                '@colyseus/ws-transport/*',
                '@colyseus/tools',
                '@colyseus/tools/*',
                'express',
                'express/*',
              ],
              message: 'Server-only package; keep it out of the client bundle.',
            },
          ],
        },
      ],
    },
  },
  { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },
);
