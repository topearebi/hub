#!/usr/bin/env node
/**
 * Hub — token contrast verifier (roadmap Phase 2, DESIGN.md §2.3).
 *
 * Parses `src/styles/tokens.css`, resolves the light, dark and
 * `prefers-contrast: more` themes, and checks every colour pair listed in
 * DESIGN.md §2.3:
 *   - text pairs must reach >= 4.5:1 (WCAG 1.4.3)
 *   - control boundaries and focus indicators must reach >= 3:1 (WCAG 1.4.11/2.4.13)
 *
 * Exits non-zero if any pair fails, so CI can gate on it. No dependencies.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_PATH = join(ROOT, 'src', 'styles', 'tokens.css');

const TEXT_MIN = 4.5;
const CONTROL_MIN = 3;

/* ------------------------------------------------------------------ */
/* Minimal CSS parsing                                                 */
/* ------------------------------------------------------------------ */

/** Remove comments so they cannot corrupt declaration parsing. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Return every rule block as `{ selector, body }`, recursing into at-rules. */
function ruleBlocks(css) {
  const blocks = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    blocks.push({ selector, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return blocks;
}

/** Body of the first `@media` block whose query contains `needle`. */
function mediaBody(css, needle) {
  for (const block of ruleBlocks(css)) {
    if (block.selector.startsWith('@media') && block.selector.includes(needle)) {
      return block.body;
    }
  }
  return null;
}

/** Body of the first rule (searching into media blocks) whose selector matches. */
function findRule(css, predicate) {
  for (const block of ruleBlocks(css)) {
    if (block.selector.startsWith('@media')) {
      const inner = findRule(block.body, predicate);
      if (inner) return inner;
    } else if (predicate(block.selector)) {
      return block.body;
    }
  }
  return null;
}

/** Parse a declaration body into a `--token -> value` map. */
function parseDecls(body) {
  const map = {};
  for (const decl of (body ?? '').split(';')) {
    const match = decl.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (match) map[match[1]] = match[2];
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Colour maths (WCAG 2.x)                                             */
/* ------------------------------------------------------------------ */

function parseColour(value) {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((o) => parseInt(h.slice(o, o + 2), 16));
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map(Number);
  return null;
}

function luminance([r, g, b]) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Resolve `var()` references against a theme map (recursively). */
function resolve(map, value) {
  let out = value;
  for (let guard = 0; guard < 20 && out.includes('var('); guard += 1) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, ref, fallback) => {
      if (map[ref] !== undefined) return map[ref];
      if (fallback !== undefined) return fallback.trim();
      throw new Error(`Unresolved token ${ref}`);
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Theme assembly                                                      */
/* ------------------------------------------------------------------ */

const css = stripComments(readFileSync(TOKENS_PATH, 'utf8'));

const light = parseDecls(findRule(css, (s) => s === ':root'));

const darkFromMedia = parseDecls(findRule(css, (s) => s.includes(":root:not([data-theme='light'])")));
const darkFromAttr = parseDecls(findRule(css, (s) => s === "[data-theme='dark']"));

// DESIGN.md §2.1: the two dark declaration sets must be identical.
const darkKeys = new Set([...Object.keys(darkFromMedia), ...Object.keys(darkFromAttr)]);
const drift = [...darkKeys].filter((k) => darkFromMedia[k] !== darkFromAttr[k]);
if (drift.length > 0) {
  console.error(`✗ Dark blocks differ for: ${drift.join(', ')}`);
  process.exit(1);
}
const dark = darkFromAttr;

const pcBody = mediaBody(css, 'prefers-contrast: more') ?? '';
const pcLight = parseDecls(findRule(pcBody, (s) => s === ':root'));
const pcDark = parseDecls(findRule(pcBody, (s) => s.includes("[data-theme='dark']")));

const themes = {
  light,
  dark,
  'light-contrast': { ...light, ...pcLight },
  'dark-contrast': { ...dark, ...pcDark },
};

/* ------------------------------------------------------------------ */
/* Pair definitions (DESIGN.md §2.3)                                   */
/* ------------------------------------------------------------------ */

const SURFACES = ['--bg-app', '--bg-card', '--bg-subtle'];
const TEXT_TOKENS = [
  '--text-main',
  '--text-sub',
  '--text-faint',
  '--accent-terracotta-text',
  '--accent-sage-text',
  '--accent-amber-text',
];

/** Build the list of `{ fg, bg, min }` checks (theme-independent token names). */
function pairsFor() {
  const checks = [];
  for (const fg of TEXT_TOKENS) {
    for (const bg of SURFACES) checks.push({ fg, bg, min: TEXT_MIN });
  }
  checks.push({ fg: '--on-accent', bg: '--accent-terracotta', min: TEXT_MIN });
  checks.push({ fg: '--on-accent', bg: '--accent-sage', min: TEXT_MIN });
  for (const bg of SURFACES) {
    checks.push({ fg: '--border-control', bg, min: CONTROL_MIN });
    checks.push({ fg: '--focus-color', bg, min: CONTROL_MIN });
  }
  return checks;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

let failures = 0;
let checked = 0;

for (const [name, theme] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const { fg, bg, min } of pairsFor()) {
    const fgColour = parseColour(resolve(theme, theme[fg] ?? ''));
    const bgColour = parseColour(resolve(theme, theme[bg] ?? ''));
    if (!fgColour || !bgColour) {
      console.error(`  ? ${fg} on ${bg}: could not resolve colour`);
      failures += 1;
      continue;
    }
    const ratio = contrast(fgColour, bgColour);
    checked += 1;
    const ok = ratio + 1e-9 >= min;
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${fg} on ${bg}: ${ratio.toFixed(2)}:1 (min ${min})`);
  }
}

console.log(`\n${checked - failures}/${checked} pairs pass.`);
if (failures > 0) {
  console.error(`✗ ${failures} contrast pair(s) below threshold.`);
  process.exit(1);
}
console.log('✓ All contrast pairs meet their thresholds.');
