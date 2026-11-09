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
    manifest: true,
    // Build-only minification keeps the full touch UI inside the gzip budget.
    minify: 'terser',
    terserOptions: {
      ecma: 2020,
      safari10: false,
      compress: { passes: 3 },
      format: { comments: false, ascii_only: true },
    },
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
