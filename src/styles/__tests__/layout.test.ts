import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guards the responsive-tier layer (DESIGN.md §3, Phase 7). These tests fail the
 * build if a tier query, the container-query grid cap, the bottom-sheet
 * behaviour or the keyboard-reflow plumbing is removed or renamed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(HERE, '..', name), 'utf8');

const TOKENS = read('tokens.css');
const LAYOUT = read('layout.css');
const COMPONENTS = read('components.css');

describe('tokens.css responsive tokens (DESIGN.md §3)', () => {
  it('defines the tier sizing tokens', () => {
    for (const token of [
      '--tile-min',
      '--content-max-width',
      '--content-max-width-wide',
      '--side-rail-w',
      '--keyboard-inset',
    ]) {
      expect(TOKENS).toContain(`${token}:`);
    }
  });
});

describe('layout.css responsive tiers (DESIGN.md §3)', () => {
  it('implements all six tier queries', () => {
    expect(LAYOUT).toContain('(orientation: landscape) and (max-height: 500px)'); // B
    expect(LAYOUT).toContain('(min-width: 768px)'); // C
    expect(LAYOUT).toContain('(min-width: 1024px)'); // D
    expect(LAYOUT).toContain('(min-width: 1440px)'); // E
    expect(LAYOUT).toContain('(horizontal-viewport-segments: 2)'); // F
  });

  it('uses 100dvh with a 100vh fallback (G-13)', () => {
    expect(LAYOUT).toContain('min-height: 100vh');
    expect(LAYOUT).toContain('min-height: 100dvh');
  });

  it('turns the tab bar into a side rail in landscape-short (tier B)', () => {
    expect(LAYOUT).toContain('--side-rail-w');
    expect(LAYOUT).toContain('.mobile-tabs__label');
  });

  it('pins both drawers only at the wide tier (tier E)', () => {
    const wide = LAYOUT.slice(LAYOUT.indexOf('(min-width: 1440px)'));
    expect(wide).toContain('.app-shell--both-pinned');
  });
});

describe('components.css responsive behaviour', () => {
  it('drives the tile grid from --tile-min with a container-query cap (G-10)', () => {
    expect(COMPONENTS).toContain('minmax(var(--tile-min), 1fr)');
    expect(COMPONENTS).toContain('@container');
    expect(COMPONENTS).toContain('container-type: inline-size');
  });

  it('renders dialogs as bottom sheets on phones (G-18)', () => {
    expect(COMPONENTS).toContain('@media (max-width: 767.98px)');
    expect(COMPONENTS).toContain('align-items: flex-end');
  });

  it('reflows sheets and toasts above the keyboard (G-16)', () => {
    expect(COMPONENTS).toContain('var(--keyboard-inset)');
  });

  it('provides a drawer scrim for overlay drawers (G-09)', () => {
    expect(COMPONENTS).toContain('.drawer-scrim');
    expect(COMPONENTS).toContain('var(--bg-scrim)');
  });
});
