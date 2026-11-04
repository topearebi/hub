import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, '..');
const srcDir = join(here, '..', '..');

/**
 * Literal values that are legitimately not catalogue entries: a numeric
 * placeholder and the sample-set brand names (proper nouns, never translated).
 * Keep this list as small as possible.
 */
const ALLOWED = new Set(['0', 'Wikipedia', 'Hacker News', 'GitHub']);

/** Object keys whose literal string values are user-visible. */
const PATTERNS: RegExp[] = [
  /\btext:\s*(['"])(.*?)\1/g,
  /\bplaceholder:\s*(['"])(.*?)\1/g,
  /'aria-label':\s*(['"])(.*?)\1/g,
  /\bconfirmLabel:\s*(['"])(.*?)\1/g,
  /\bmessage:\s*(['"])(.*?)\1/g,
  /\blabel:\s*(['"])(.*?)\1/g,
  /\btitle:\s*(['"])(.*?)\1/g,
];

function scan(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const pattern of PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const value = match[2] ?? '';
      if (value.length > 0 && !ALLOWED.has(value)) {
        found.push(`${file.split('/').pop()}: ${value}`);
      }
    }
  }
  return found;
}

/**
 * Catalogue coverage (G-38): every literal user-visible string in the UI layer
 * must go through `t()`/`tp()`. This static scan fails if a component or the
 * entrypoint reintroduces a hard-coded string.
 */
describe('no hard-coded user-visible strings', () => {
  it('routes every literal UI string through the catalogue', () => {
    const componentFiles = readdirSync(componentsDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => join(componentsDir, name));
    const files = [...componentFiles, join(srcDir, 'main.ts')];
    const offenders = files.flatMap(scan);
    expect(offenders).toEqual([]);
  });
});
