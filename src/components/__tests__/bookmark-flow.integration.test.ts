import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BookmarkEditor, NEW_CATEGORY } from '../bookmark-editor';
import { Omnibar } from '../omnibar';
import { BookmarksView } from '../bookmarks';
import { DEFAULT_APP_CONFIG } from '../../types/schemas';
import type { BookmarkItem, CategoryItem } from '../../types/schemas';

function makeBookmark(
  overrides: Partial<BookmarkItem> & Pick<BookmarkItem, 'id' | 'title' | 'url'>,
): BookmarkItem {
  return {
    created_at: 1,
    updated_at: 1,
    profile_id: 'p1',
    category_id: 'c1',
    ...overrides,
  };
}

const CATEGORY: CategoryItem = {
  id: 'c1',
  created_at: 1,
  updated_at: 1,
  profile_id: 'p1',
  name: 'Shared',
  order: 0,
};

/** Read a promise's resolution after flushing microtasks. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function q<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing element: ${selector}`);
  }
  return node;
}

function byLabel<T extends HTMLElement>(root: ParentNode, label: string): T {
  return q<T>(root, `[aria-label="${label}"]`);
}

describe('BookmarkEditor DOM flow', () => {
  let onSave: ReturnType<typeof vi.fn>;
  let onDelete: ReturnType<typeof vi.fn>;
  let onCreateCategory: ReturnType<typeof vi.fn>;
  let editor: BookmarkEditor;

  beforeEach(() => {
    onSave = vi.fn();
    onDelete = vi.fn();
    onCreateCategory = vi.fn(async (name: string) => ({
      ...CATEGORY,
      id: 'c2',
      name,
    }));
    editor = new BookmarkEditor(
      { sortedCategories: [CATEGORY], activeBookmarks: [], activeProfileId: 'p1' },
      { onSave, onDelete, onCreateCategory },
    );
    document.body.appendChild(editor.element);
  });

  it('opens in create mode, prefilled with a URL, and saves a normalised bookmark', async () => {
    editor.open(undefined, { url: 'example.com' });
    expect(editor.isOpen()).toBe(true);

    const urlInput = byLabel<HTMLInputElement>(editor.element, 'Bookmark URL');
    expect(urlInput.value).toBe('example.com');

    q<HTMLButtonElement>(editor.element, '.button--primary').click();
    await flush();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as BookmarkItem;
    expect(saved.url).toBe('https://example.com');
    expect(saved.title).toBe('example.com');
    expect(saved.category_id).toBe('c1');
    expect(saved.profile_id).toBe('p1');
    expect(saved.is_deleted).toBeUndefined();
  });

  it('wires the inline new-category flow', async () => {
    editor.open(undefined, { url: 'https://new.test' });
    const select = byLabel<HTMLSelectElement>(editor.element, 'Category');
    select.value = NEW_CATEGORY;
    select.dispatchEvent(new Event('change'));

    const newCategoryRow = q<HTMLElement>(editor.element, '.bookmark-editor__new-category');
    expect(newCategoryRow.hidden).toBe(false);

    byLabel<HTMLInputElement>(editor.element, 'New category name').value = 'Ops';
    q<HTMLButtonElement>(editor.element, '.button--primary').click();
    await flush();

    expect(onCreateCategory).toHaveBeenCalledWith('Ops');
    expect((onSave.mock.calls[0]?.[0] as BookmarkItem).category_id).toBe('c2');
  });

  it('blocks save on a hotkey conflict and shows a status message', async () => {
    const conflict = makeBookmark({
      id: 'b1',
      title: 'One',
      url: 'https://one.test',
      hotkey: '1',
    });
    const conflictEditor = new BookmarkEditor(
      { sortedCategories: [CATEGORY], activeBookmarks: [conflict], activeProfileId: 'p1' },
      { onSave, onDelete, onCreateCategory },
    );
    document.body.appendChild(conflictEditor.element);
    conflictEditor.open(undefined, { url: 'https://two.test' });

    byLabel<HTMLSelectElement>(conflictEditor.element, 'Hotkey slot').value = '1';
    q<HTMLButtonElement>(conflictEditor.element, '.button--primary').click();
    await flush();

    expect(onSave).not.toHaveBeenCalled();
    const status = q<HTMLElement>(conflictEditor.element, '.settings-status');
    expect(status.textContent).toMatch(/already assigned/);
  });

  it('shows Delete only in edit mode and wires it', async () => {
    const existing = makeBookmark({ id: 'b9', title: 'Existing', url: 'https://x.test' });
    editor.open(existing);

    const deleteButton = q<HTMLButtonElement>(editor.element, '.button');
    expect(deleteButton.hidden).toBe(false);
    deleteButton.click();
    expect(onDelete).toHaveBeenCalledWith('b9');
  });
});

describe('Omnibar DOM flow', () => {
  let onNavigate: ReturnType<typeof vi.fn>;
  let onAddBookmark: ReturnType<typeof vi.fn>;
  let omnibar: Omnibar;

  beforeEach(() => {
    onNavigate = vi.fn();
    onAddBookmark = vi.fn();
    omnibar = new Omnibar(
      {
        activeBookmarks: [],
        sortedCategories: [],
        appConfig: DEFAULT_APP_CONFIG,
        activeProfile: null,
        profiles: [],
        getRecentBookmarks: () => [],
        getBookmarksByCategory: () => [],
      },
      { onActivateBookmark: vi.fn(), onNavigate, onAddBookmark },
    );
    document.body.appendChild(omnibar.element);
  });

  function type(value: string): void {
    const input = q<HTMLInputElement>(omnibar.element, '.omnibar__input');
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function rows(): HTMLElement[] {
    return Array.from(omnibar.element.querySelectorAll<HTMLElement>('.omnibar__result'));
  }

  function keydown(key: string): void {
    q<HTMLInputElement>(omnibar.element, '.omnibar__input').dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true }),
    );
  }

  it('renders add + navigate rows and defaults selection to navigate', () => {
    type('example.com');
    const list = rows();
    expect(list).toHaveLength(2);
    expect(list[0]?.classList.contains('omnibar__result--add')).toBe(true);
    expect(list[1]?.classList.contains('omnibar__result--navigate')).toBe(true);
    // Default selection is the navigate row (index 1).
    expect(list[1]?.classList.contains('is-active')).toBe(true);
    expect(list[0]?.classList.contains('is-active')).toBe(false);
  });

  it('navigates on Enter by default', () => {
    type('example.com');
    keydown('Enter');
    expect(onNavigate).toHaveBeenCalledWith('https://example.com');
    expect(onAddBookmark).not.toHaveBeenCalled();
  });

  it('selects the add row with ArrowUp and opens the editor on Enter', () => {
    type('example.com');
    keydown('ArrowUp');
    expect(rows()[0]?.classList.contains('is-active')).toBe(true);
    keydown('Enter');
    expect(onAddBookmark).toHaveBeenCalledWith('https://example.com');
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('BookmarksView context menu', () => {
  it('fires onEdit and onDelete', () => {
    const bookmark = makeBookmark({ id: 'b1', title: 'GitHub', url: 'https://github.com' });
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const view = new BookmarksView(
      {
        activeBookmarks: [bookmark],
        sortedCategories: [],
        getRecentBookmarks: () => [],
        getBookmarksByCategory: () => [],
      },
      {
        onActivate: vi.fn(),
        onOpenAlternate: vi.fn(),
        onEdit,
        onDelete,
        onAddBookmark: vi.fn(),
        onImport: vi.fn(),
        onManageCategories: vi.fn(),
      },
    );
    document.body.appendChild(view.element);
    view.render();

    const tile = q<HTMLButtonElement>(view.element, '.tile__open');
    tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));

    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu__item'));
    const editItem = items.find((item) => item.textContent?.includes('Edit'));
    const deleteItem = items.find((item) => item.textContent?.includes('Delete'));
    expect(editItem).toBeDefined();
    expect(deleteItem).toBeDefined();

    editItem?.click();
    expect(onEdit).toHaveBeenCalledWith(bookmark);

    tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const delAgain = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.context-menu__item'),
    ).find((item) => item.textContent?.includes('Delete'));
    delAgain?.click();
    expect(onDelete).toHaveBeenCalledWith(bookmark);
  });
});
