import { describe, expect, it } from 'vitest';

import { maxPinnedDrawers, resolveDrawerOpen } from '../drawer';

describe('resolveDrawerOpen', () => {
  it('opens a pinned drawer regardless of prior state', () => {
    expect(resolveDrawerOpen(true, false, false)).toBe(true);
    expect(resolveDrawerOpen(true, false, true)).toBe(true);
    expect(resolveDrawerOpen(true, true, false)).toBe(true);
  });

  it('closes a drawer that was just unpinned', () => {
    // Regression: unpinning previously left `data-open="true"`, so the drawer
    // lingered as a fixed off-canvas overlay instead of collapsing.
    expect(resolveDrawerOpen(false, true, true)).toBe(false);
    expect(resolveDrawerOpen(false, true, false)).toBe(false);
  });

  it('preserves manual open state for an already-unpinned drawer', () => {
    expect(resolveDrawerOpen(false, false, true)).toBe(true);
    expect(resolveDrawerOpen(false, false, false)).toBe(false);
  });
});

describe('maxPinnedDrawers (DESIGN.md §3)', () => {
  it('disables pinning on phones and tablets (< 1024px)', () => {
    expect(maxPinnedDrawers(320)).toBe(0);
    expect(maxPinnedDrawers(768)).toBe(0);
    expect(maxPinnedDrawers(1023)).toBe(0);
  });

  it('allows one pinned drawer on laptops (1024–1439px)', () => {
    expect(maxPinnedDrawers(1024)).toBe(1);
    expect(maxPinnedDrawers(1280)).toBe(1);
    expect(maxPinnedDrawers(1439)).toBe(1);
  });

  it('allows both pinned drawers on wide displays (>= 1440px)', () => {
    expect(maxPinnedDrawers(1440)).toBe(2);
    expect(maxPinnedDrawers(2560)).toBe(2);
  });
});
