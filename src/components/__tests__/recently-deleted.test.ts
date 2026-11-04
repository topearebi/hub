import { describe, expect, it, vi } from 'vitest';

import { RecentlyDeleted, daysRemaining, daysSince } from '../recently-deleted';
import { TOMBSTONE_GRACE_MS } from '../../core/store';
import type { DeletedItems, DeletedProfileEntry } from '../../core/store';

const DAY = 86_400_000;

describe('daysSince / daysRemaining (DESIGN.md §9.1)', () => {
  it('counts whole days since deletion', () => {
    const now = 10 * DAY;
    expect(daysSince(now - 2 * DAY, now)).toBe(2);
    expect(daysSince(now + DAY, now)).toBe(0);
  });

  it('counts whole days remaining in the 30-day window', () => {
    const now = 10 * DAY;
    expect(daysRemaining(now, now)).toBe(30);
    expect(daysRemaining(now - 10 * DAY, now)).toBe(20);
    expect(daysRemaining(now - TOMBSTONE_GRACE_MS - DAY, now)).toBe(0);
  });
});

function makeStore(overrides: {
  deletedProfiles?: DeletedProfileEntry[];
  deletedItems?: DeletedItems;
}) {
  return {
    deletedProfiles: overrides.deletedProfiles ?? [],
    deletedItems: overrides.deletedItems ?? { bookmarks: [], tasks: [], notes: [] },
    restoreProfile: vi.fn(async () => undefined),
    permanentlyDeleteProfile: vi.fn(async () => undefined),
    restoreBookmark: vi.fn(async () => undefined),
    restoreTask: vi.fn(async () => undefined),
    restoreNote: vi.fn(async () => undefined),
    permanentlyDeleteItem: vi.fn(async () => undefined),
  };
}

describe('RecentlyDeleted (G-40)', () => {
  it('shows an empty state when nothing is deleted', () => {
    const store = makeStore({});
    const view = new RecentlyDeleted(store, { onClose: vi.fn(), onChanged: vi.fn() });
    document.body.appendChild(view.element);
    view.open();

    expect(view.element.textContent).toContain('Nothing here');
    view.destroy();
  });

  it('lists deleted profiles with item counts and restores them', async () => {
    const now = Date.now();
    const store = makeStore({
      deletedProfiles: [
        {
          profile: { id: 'p2', created_at: now, updated_at: now, name: 'Work', is_deleted: true },
          counts: { bookmarks: 14, tasks: 3, notes: 2, categories: 1 },
        },
      ],
    });
    const onChanged = vi.fn();
    const view = new RecentlyDeleted(store, { onClose: vi.fn(), onChanged });
    document.body.appendChild(view.element);
    view.open();

    expect(view.element.textContent).toContain('Work');
    expect(view.element.textContent).toContain('14 links, 3 tasks, 2 notes');

    const restore = Array.from(view.element.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Restore',
    );
    restore?.click();
    await Promise.resolve();
    expect(store.restoreProfile).toHaveBeenCalledWith('p2');

    view.destroy();
  });

  it('lists individually deleted items with a restore action', async () => {
    const now = Date.now();
    const store = makeStore({
      deletedItems: {
        bookmarks: [
          {
            id: 'b1',
            created_at: now,
            updated_at: now,
            profile_id: 'p1',
            title: 'Old link',
            url: 'https://old.test',
            category_id: 'c1',
            is_deleted: true,
          },
        ],
        tasks: [],
        notes: [],
      },
    });
    const view = new RecentlyDeleted(store, { onClose: vi.fn(), onChanged: vi.fn() });
    document.body.appendChild(view.element);
    view.open();

    expect(view.element.textContent).toContain('Old link');
    const restore = Array.from(view.element.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Restore',
    );
    restore?.click();
    await Promise.resolve();
    expect(store.restoreBookmark).toHaveBeenCalledWith('b1');

    view.destroy();
  });
});
