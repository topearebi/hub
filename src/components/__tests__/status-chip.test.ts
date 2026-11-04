import { describe, expect, it, vi } from 'vitest';

import { StatusChip, relativeTime, statusChipLabel } from '../status-chip';

describe('relativeTime', () => {
  it('reports "just now" for very recent times', () => {
    expect(relativeTime(1000, 1000 + 10_000)).toBe('just now');
  });

  it('reports minutes, hours and days', () => {
    const now = 10_000_000_000;
    expect(relativeTime(now - 2 * 60_000, now)).toBe('2 min ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 d ago');
  });
});

describe('statusChipLabel (G-44)', () => {
  it('describes each state in words, not colour alone', () => {
    expect(statusChipLabel('local')).toBe('Saved on this device');
    expect(statusChipLabel('syncing')).toBe('Syncing…');
    expect(statusChipLabel('offline')).toBe('Offline — changes saved locally');
    expect(statusChipLabel('error')).toBe('Sync failed — Retry');
  });

  it('includes the relative sync time and pending count', () => {
    const now = 10_000_000_000;
    expect(statusChipLabel('synced', { syncedAt: now - 2 * 60_000, now })).toBe('Synced 2 min ago');
    expect(statusChipLabel('synced', { syncedAt: now - 60_000, now, pending: 3 })).toBe(
      'Synced 1 min ago · 3 waiting',
    );
  });
});

describe('StatusChip', () => {
  it('renders an icon and text and updates on state change', () => {
    const chip = new StatusChip({ onActivate: vi.fn() });
    expect(chip.element.getAttribute('data-state')).toBe('local');
    expect(chip.element.textContent).toContain('Saved on this device');

    chip.setState('offline');
    expect(chip.element.getAttribute('data-state')).toBe('offline');
    expect(chip.element.textContent).toContain('Offline');
    expect(chip.getState()).toBe('offline');
  });

  it('invokes onActivate when clicked', () => {
    const onActivate = vi.fn();
    const chip = new StatusChip({ onActivate });
    chip.element.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
