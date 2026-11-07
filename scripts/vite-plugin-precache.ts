/**
 * Hub precache Vite plugin
 * ------------------------
 * Build-time only (no runtime dependency). After Vite writes `dist`, it:
 *   1. collects every emitted file (hashed JS/CSS, `index.html`, icons, …);
 *   2. derives a content hash used as the cache version;
 *   3. injects the manifest + version into the `public/sw.js` template and
 *      writes the result to `dist/sw.js`.
 *
 * This closes the "install then go offline" gap (G-48): the service worker
 * precaches the exact hashed bundle the page will request, so a fresh install
 * works offline immediately. The plugin is a no-op in dev (`apply: 'build'`).
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

const SW_TEMPLATE = 'public/sw.js';
const SW_OUTPUT = 'sw.js';

/** Recursively list files under `dir`, as POSIX-style paths relative to `base`. */
function collectFiles(dir: string, base: string = dir): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full, base));
    } else {
      files.push(relative(base, full).split(/[\\/]/).join('/'));
    }
  }
  return files;
}

export function precachePlugin(): Plugin {
  let outDir = 'dist';

  return {
    name: 'hub-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const root = process.cwd();
      const distDir = resolve(root, outDir);

      // Every emitted asset except the service worker itself.
      const files = collectFiles(distDir).filter((file) => file !== SW_OUTPUT);
      const urls = files.map((file) => `./${file}`);

      const hasher = createHash('sha256');
      for (const file of files) {
        hasher.update(file);
        hasher.update(readFileSync(join(distDir, file)));
      }
      const version = hasher.digest('hex').slice(0, 12);

      const template = readFileSync(resolve(root, SW_TEMPLATE), 'utf8');
      const output = template
        .replaceAll('__CACHE_VERSION__', version)
        .replaceAll('__PRECACHE_MANIFEST__', JSON.stringify(urls, null, 2));

      writeFileSync(join(distDir, SW_OUTPUT), output);
    },
  };
}
