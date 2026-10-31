import { describe, expect, it } from 'vitest';

import { resolveDrawerOpen } from '../drawer';

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
