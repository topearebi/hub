import { describe, expect, it, vi } from 'vitest';

import { CategoryManager } from '../category-manager';
import type { BookmarkItem, CategoryItem } from '../../types/schemas';

/** In-memory store double for the category manager. */
function makeStore() {
  const categories: CategoryItem[] = [
    { id: 'c1', created_at: 1, updated_at: 1, profile_id: 'p1', name: 'Links', order: 0 },
    { id: 'c2', created_at: 2, updated_at: 2, profile_id: 'p1', name: 'Work', order: 1 },
  ];
  const bookmarks: BookmarkItem[] = [
    {
      id: 'b1',
      created_at: 1,
      updated_at: 1,
      profile_id: 'p1',
      title: 'A',
      url: 'https://a.test',
      category_id: 'c2',
    },
  ];

  return {
    categories,
    bookmarks,
    get sortedCategories(): CategoryItem[] {
      return [...categories].sort((a, b) => a.order - b.order);
    },
    activeProfileId: 'p1',
    getBookmarksByCategory: (id: string): BookmarkItem[] =>
      bookmarks.filter((b) => b.category_id === id),
    upsertCategory: async (item: CategoryItem): Promise<void> => {
      const index = categories.findIndex((c) => c.id === item.id);
      if (index >= 0) {
        categories[index] = item;
      } else {
        categories.push(item);
      }
    },
    upsertCategories: async (items: readonly CategoryItem[]): Promise<void> => {
      for (const item of items) {
        const index = categories.findIndex((c) => c.id === item.id);
        if (index >= 0) {
          categories[index] = item;
        }
      }
    },
    renameCategory: async (id: string, name: string): Promise<void> => {
      const category = categories.find((c) => c.id === id);
      if (category) {
        category.name = name;
      }
    },
    deleteCategory: async (
      id: string,
      targetCategoryId: string,
    ): Promise<{ category: CategoryItem; bookmarks: BookmarkItem[] } | null> => {
      const category = categories.find((c) => c.id === id);
      if (!category) {
        return null;
      }
      const affected = bookmarks.filter((b) => b.category_id === id);
      for (const bookmark of affected) {
        bookmark.category_id = targetCategoryId;
      }
      category.is_deleted = true;
      return { category, bookmarks: affected };
    },
    restoreCategory: async (): Promise<void> => undefined,
  };
}

describe('CategoryManager (G-39)', () => {
  it('renders a row per category', () => {
    const store = makeStore();
    const manager = new CategoryManager(store, { onClose: vi.fn(), onChanged: vi.fn() });
    document.body.appendChild(manager.element);
    manager.open();

    const inputs = manager.element.querySelectorAll<HTMLInputElement>('.category-manager__input');
    // Two category rows plus the "add" input.
    expect(inputs.length).toBe(3);
    expect(Array.from(inputs).some((input) => input.value === 'Links')).toBe(true);

    manager.destroy();
  });

  it('adds a new category', async () => {
    const store = makeStore();
    const onChanged = vi.fn();
    const manager = new CategoryManager(store, { onClose: vi.fn(), onChanged });
    document.body.appendChild(manager.element);
    manager.open();

    const addInput = manager.element.querySelector<HTMLInputElement>(
      '.category-manager__add .category-manager__input',
    );
    expect(addInput).not.toBeNull();
    if (addInput) {
      addInput.value = 'Media';
    }
    const addButton = manager.element.querySelector<HTMLButtonElement>(
      '.category-manager__add .button',
    );
    addButton?.click();
    await Promise.resolve();

    expect(store.categories.some((c) => c.name === 'Media')).toBe(true);
    expect(onChanged).toHaveBeenCalled();

    manager.destroy();
  });

  it('reorders categories with the move-down control', async () => {
    const store = makeStore();
    const manager = new CategoryManager(store, { onClose: vi.fn(), onChanged: vi.fn() });
    document.body.appendChild(manager.element);
    manager.open();

    // The first row's "move down" button is the second action button.
    const firstRow = manager.element.querySelector<HTMLElement>('.category-manager__row');
    const actions = firstRow?.querySelectorAll<HTMLButtonElement>('.category-manager__action');
    actions?.[1]?.click();
    await Promise.resolve();

    expect(store.sortedCategories.map((c) => c.id)).toEqual(['c2', 'c1']);

    manager.destroy();
  });

  it('deletes an empty category', async () => {
    const store = makeStore();
    const manager = new CategoryManager(store, { onClose: vi.fn(), onChanged: vi.fn() });
    document.body.appendChild(manager.element);
    manager.open();

    // "Links" (c1) is empty, so deletion needs no confirmation.
    const firstRow = manager.element.querySelector<HTMLElement>('.category-manager__row');
    const actions = firstRow?.querySelectorAll<HTMLButtonElement>('.category-manager__action');
    actions?.[2]?.click();
    await Promise.resolve();

    expect(store.categories.find((c) => c.id === 'c1')?.is_deleted).toBe(true);

    manager.destroy();
  });
});
