import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guards the token layer (DESIGN.md §2.1). The dark palette is declared twice —
 * once for the auto theme (media query) and once for the explicit override —
 * because CSS cannot share one block between the two. These tests fail the build
 * if the duplicates ever drift or if legacy aliases creep back in.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, '..', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Block {
  selector: string;
  body: string;
}

/** Split a stylesheet into `{ selector, body }` blocks, recursing into at-rules. */
function ruleBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{', i);
    if (open === -1) break;
    const selector = source.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') depth -= 1;
      j += 1;
    }
    blocks.push({ selector, body: source.slice(open + 1, j - 1) });
    i = j;
  }
  return blocks;
}

/** Body of the first rule (searching into `@media`) whose selector matches. */
function findRule(source: string, predicate: (selector: string) => boolean): string | null {
  for (const block of ruleBlocks(source)) {
    if (block.selector.startsWith('@media')) {
      const inner = findRule(block.body, predicate);
      if (inner) return inner;
    } else if (predicate(block.selector)) {
      return block.body;
    }
  }
  return null;
}

/** Parse `--token: value` declarations from a rule body. */
function parseDecls(body: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const match = decl.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (match && match[1] !== undefined && match[2] !== undefined) {
      map[match[1]] = match[2];
    }
  }
  return map;
}

const darkFromMedia = parseDecls(
  findRule(CSS, (s) => s.includes(":root:not([data-theme='light'])")) ?? '',
);
const darkFromAttr = parseDecls(findRule(CSS, (s) => s === "[data-theme='dark']") ?? '');

describe('tokens.css dark declarations', () => {
  it('declares a non-empty dark set in both places', () => {
    expect(Object.keys(darkFromMedia).length).toBeGreaterThan(0);
    expect(Object.keys(darkFromAttr).length).toBeGreaterThan(0);
  });

  it('keeps the media-query and attribute dark sets identical (DESIGN.md §2.1)', () => {
    expect(darkFromAttr).toEqual(darkFromMedia);
  });
});

describe('tokens.css palette integrity', () => {
  it('defines the control-boundary and focus tokens (G-03, G-04)', () => {
    const root = parseDecls(findRule(CSS, (s) => s === ':root') ?? '');
    expect(root['--border-control']).toBeDefined();
    expect(root['--focus-color']).toBeDefined();
    expect(root['--focus-ring']).toContain('--focus-color');
  });

  it('sets color-scheme for the root and both explicit themes (G-05)', () => {
    expect(findRule(CSS, (s) => s === ':root')).toContain('color-scheme: light dark');
    expect(findRule(CSS, (s) => s === "[data-theme='light']")).toContain('color-scheme: light');
    expect(findRule(CSS, (s) => s === "[data-theme='dark']")).toContain('color-scheme: dark');
  });

  it('removes every legacy alias (G-05)', () => {
    const legacy = [
      '--bg-primary',
      '--bg-surface',
      '--bg-surface-elevated',
      '--border-subtle',
      '--border-active',
      '--border-focus',
      '--text-primary',
      '--text-secondary',
      '--text-muted',
      '--accent-warm',
      '--radius-card',
      '--radius-input',
      '--shadow-subtle',
      '--shadow-elevated',
      '--shadow-sm',
      '--shadow-md',
      '--shadow-lg',
      '--transition-speed',
      '--font-family-legacy',
    ];
    for (const token of legacy) {
      expect(CSS).not.toContain(`${token}:`);
    }
  });
});
