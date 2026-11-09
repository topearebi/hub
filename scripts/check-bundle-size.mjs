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

const manifest = JSON.parse(readFileSync(join(ROOT, 'dist', 'asset-manifest.json'), 'utf8'));
const initial = new Set();
const visited = new Set();
function visit(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  if (!chunk) throw new Error(`Missing manifest chunk: ${key}`);
  if (/\.(js|css)$/.test(chunk.file)) initial.add(chunk.file);
  for (const css of chunk.css ?? []) initial.add(css);
  for (const dependency of chunk.imports ?? []) visit(dependency);
}
for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key);
if (!initial.size) throw new Error('No initial assets in build manifest');
const initialBytes = [...initial].reduce(
  (sum, file) => sum + gzipSize(join(ROOT, 'dist', file)),
  0,
);
let total = 0;
for (const file of assets.sort()) {
  const bytes = gzipSize(join(ASSETS, file));
  total += bytes;
  console.log(
    `  ${file.padEnd(44)} ${kb(bytes).padStart(8)} kB gzip${initial.has(`assets/${file}`) ? ' (initial)' : ' (on demand)'}`,
  );
}
console.log(`  INITIAL JS + CSS: ${kb(initialBytes)} kB gzip`);
console.log(
  `  ALL JS + CSS:     ${kb(total)} kB gzip (includes offline-preloaded optional features)`,
);
if (initialBytes >= BUDGET_KB * 1024) {
  console.error(
    `\n✗ Initial bundle budget exceeded: ${kb(initialBytes)} kB >= ${BUDGET_KB} kB gzip.`,
  );
  process.exit(1);
}
console.log(`\n✓ Initial bundle within budget (${kb(initialBytes)} kB < ${BUDGET_KB} kB gzip).`);
