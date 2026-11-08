import { defineConfig } from 'vitest/config';

import { precachePlugin } from './scripts/vite-plugin-precache';

/**
 * Vite + Vitest configuration for Hub.
 *
 * `base: './'` emits relative asset URLs so the same build works when served
 * from a domain root, a GitHub Pages subpath, or a local static server.
 */
export default defineConfig({
  base: './',
  plugins: [precachePlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 60,
  },
  esbuild: {
    legalComments: 'none',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/core/**', 'src/utils/**', 'src/types/**'],
    },
  },
});
