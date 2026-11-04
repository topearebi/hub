#!/usr/bin/env node
/**
 * Hub — gzip bundle-size budget gate (roadmap Phase 11, G-56; PRD §3.1).
 *
 * Sums the gzip size of the built initial JS + CSS assets in `dist/assets` and
 * fails when the total exceeds the budget recorded in
 * `plans/production-readiness.md` §6 (< 60 KB gzip). The Vite
 * `chunkSizeWarningLimit` guards the *raw* entry chunk; this gate enforces the
 * *gzip* budget that actually ships over the wire.
 *
 * No dependencies: uses `node:zlib`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'dist', 'assets');
const BUDGET_KB = 60;

/** Gzip size in bytes at maximum compression (matches the recorded metric). */
function gzipSize(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

const kb = (bytes) => (bytes / 1024).toFixed(2);

let files;
try {
  files = readdirSync(ASSETS);
} catch {
  console.error('✗ dist/assets not found — run `npm run build` first.');
  process.exit(1);
}

const assets = files.filter((file) => file.endsWith('.js') || file.endsWith('.css'));
if (assets.length === 0) {
  console.error('✗ No JS/CSS assets found in dist/assets.');
  process.exit(1);
}

let total = 0;
for (const file of assets.sort()) {
  const bytes = gzipSize(join(ASSETS, file));
  total += bytes;
  console.log(`  ${file.padEnd(44)} ${kb(bytes).padStart(8)} kB gzip`);
}
console.log(`  ${'TOTAL (JS + CSS)'.padEnd(44)} ${kb(total).padStart(8)} kB gzip`);

if (total > BUDGET_KB * 1024) {
  console.error(`\n✗ Bundle budget exceeded: ${kb(total)} kB > ${BUDGET_KB} kB gzip.`);
  process.exit(1);
}
console.log(`\n✓ Bundle within budget (${kb(total)} kB ≤ ${BUDGET_KB} kB gzip).`);
