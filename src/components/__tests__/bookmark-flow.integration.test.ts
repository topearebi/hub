import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BookmarkEditor, NEW_CATEGORY } from '../bookmark-editor';
import { Omnibar } from '../omnibar';
import {
  applyBookmarkWidgetStyles,
  BookmarksView,
  computeBookmarkMove,
  computeBookmarkMoveWithin,
} from '../bookmarks';
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

  it('renders wide and large bookmark cards with dynamic descriptions and mirrors', () => {
    const wideBookmark = makeBookmark({
      id: 'b_wide',
      title: 'Wide App',
      url: 'https://wide.test',
      card_size: 'wide',
      description: 'Wide card description',
    });
    const largeBookmark = makeBookmark({
      id: 'b_large',
      title: 'Large App',
      url: 'https://large.test',
      card_size: 'large',
      description: 'Large card description',
      alternate_urls: ['https://mirror1.large.test', 'https://mirror2.large.test'],
    });

    const onActivate = vi.fn();
    const onOpenAlternate = vi.fn();
    const onResize = vi.fn();

    const view = new BookmarksView(
      {
        activeBookmarks: [wideBookmark, largeBookmark],
        sortedCategories: [CATEGORY],
        getRecentBookmarks: () => [],
        getBookmarksByCategory: () => [wideBookmark, largeBookmark],
      },
      {
        onActivate,
        onOpenAlternate,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onAddBookmark: vi.fn(),
        onImport: vi.fn(),
        onManageCategories: vi.fn(),
        onResize,
      },
    );
    document.body.appendChild(view.element);
    view.render();

    const wideTile = q<HTMLElement>(view.element, '.tile--size-wide');
    expect(wideTile).toBeDefined();
    expect(wideTile.textContent).toContain('Wide card description');

    const largeTile = q<HTMLElement>(view.element, '.tile--size-large');
    expect(largeTile).toBeDefined();
    expect(largeTile.textContent).toContain('Large card description');

    // Mirrors rendered on large card
    const mirrorChips = Array.from(
      largeTile.querySelectorAll<HTMLButtonElement>('.tile__mirror-chip'),
    );
    expect(mirrorChips).toHaveLength(3); // 1 primary + 2 mirrors

    // Click secondary mirror
    mirrorChips[1]?.click();
    expect(onOpenAlternate).toHaveBeenCalledWith(largeBookmark, 'https://mirror1.large.test');

    // Cycle size button on wide tile cycles to large
    const cycleBtn = q<HTMLButtonElement>(wideTile, '.tile__cycle-size');
    cycleBtn.click();
    expect(onResize).toHaveBeenCalledWith(wideBookmark, 'large');
  });

  it('renders collapsible category headers with link count and toggle persistence', () => {
    const b1 = makeBookmark({ id: 'b1', title: 'App 1', url: 'https://app1.test' });
    const b2 = makeBookmark({ id: 'b2', title: 'App 2', url: 'https://app2.test' });

    const onToggleCategory = vi.fn();
    const view = new BookmarksView(
      {
        activeBookmarks: [b1, b2],
        sortedCategories: [CATEGORY],
        getRecentBookmarks: () => [],
        getBookmarksByCategory: () => [b1, b2],
      },
      {
        onActivate: vi.fn(),
        onOpenAlternate: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onAddBookmark: vi.fn(),
        onImport: vi.fn(),
        onManageCategories: vi.fn(),
        onToggleCategory,
      },
    );
    document.body.appendChild(view.element);
    view.render();

    const toggleBtn = q<HTMLButtonElement>(view.element, '.section__header-toggle');
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(toggleBtn.getAttribute('aria-controls')).toBe('category-grid-c1');
    expect(toggleBtn.textContent).toContain('Shared');
    expect(toggleBtn.textContent).toContain('2 links');

    const grid = q<HTMLUListElement>(view.element, '#category-grid-c1');
    expect(grid.hidden).toBe(false);

    toggleBtn.click();
    expect(onToggleCategory).toHaveBeenCalledWith(CATEGORY);

    // Test with collapsed category
    const collapsedCategory: CategoryItem = { ...CATEGORY, id: 'c_col', collapsed: true };
    const collapsedView = new BookmarksView(
      {
        activeBookmarks: [b1],
        sortedCategories: [collapsedCategory],
        getRecentBookmarks: () => [],
        getBookmarksByCategory: () => [b1],
      },
      {
        onActivate: vi.fn(),
        onOpenAlternate: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onAddBookmark: vi.fn(),
        onImport: vi.fn(),
        onManageCategories: vi.fn(),
        onToggleCategory,
      },
    );
    document.body.appendChild(collapsedView.element);
    collapsedView.render();

    const colToggleBtn = q<HTMLButtonElement>(collapsedView.element, '.section__header-toggle');
    expect(colToggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(colToggleBtn.textContent).toContain('1 link');

    const colGrid = q<HTMLUListElement>(collapsedView.element, '#category-grid-c_col');
    expect(colGrid.hidden).toBe(true);
  });

  describe('Bookmark dragging & reordering (Phase 2)', () => {
    it('computeBookmarkMove reorders siblings within the same category', () => {
      const b1 = makeBookmark({ id: 'b1', title: 'B1', url: 'https://b1.test', order: 0 });
      const b2 = makeBookmark({ id: 'b2', title: 'B2', url: 'https://b2.test', order: 1 });
      const b3 = makeBookmark({ id: 'b3', title: 'B3', url: 'https://b3.test', order: 2 });
      const list = [b1, b2, b3];

      // Move b3 before b1
      const resBefore = computeBookmarkMove(list, 'b3', 'b1', 'c1', 'before');
      expect(resBefore).not.toBeNull();
      const mapBefore = new Map(resBefore!.map((b) => [b.id, b.order]));
      expect(mapBefore.get('b3')).toBe(0);
      expect(mapBefore.get('b1')).toBe(1);
      expect(mapBefore.get('b2')).toBe(2);

      // Move b1 after b3
      const resAfter = computeBookmarkMove(list, 'b1', 'b3', 'c1', 'after');
      expect(resAfter).not.toBeNull();
      const mapAfter = new Map(resAfter!.map((b) => [b.id, b.order]));
      expect(mapAfter.get('b2')).toBe(0);
      expect(mapAfter.get('b3')).toBe(1);
      expect(mapAfter.get('b1')).toBe(2);
    });

    it('computeBookmarkMove returns null for unchanged positions and self-drops', () => {
      const b1 = makeBookmark({ id: 'b1', title: 'B1', url: 'https://b1.test', order: 0 });
      const b2 = makeBookmark({ id: 'b2', title: 'B2', url: 'https://b2.test', order: 1 });
      const list = [b1, b2];

      // Drop on self
      expect(computeBookmarkMove(list, 'b1', 'b1', 'c1', 'before')).toBeNull();

      // Drop b1 before b2 (already before b2)
      expect(computeBookmarkMove(list, 'b1', 'b2', 'c1', 'before')).toBeNull();

      // Unknown id
      expect(computeBookmarkMove(list, 'unknown', 'b2', 'c1', 'before')).toBeNull();
    });

    it('computeBookmarkMove moves bookmark across categories and normalizes orders', () => {
      const b1 = makeBookmark({
        id: 'b1',
        category_id: 'c1',
        title: 'B1',
        url: 'https://b1.test',
        order: 0,
      });
      const b2 = makeBookmark({
        id: 'b2',
        category_id: 'c1',
        title: 'B2',
        url: 'https://b2.test',
        order: 1,
      });
      const b3 = makeBookmark({
        id: 'b3',
        category_id: 'c2',
        title: 'B3',
        url: 'https://b3.test',
        order: 0,
      });
      const list = [b1, b2, b3];

      // Move b1 from c1 to c2 before b3
      const moved = computeBookmarkMove(list, 'b1', 'b3', 'c2', 'before');
      expect(moved).not.toBeNull();
      const b1Updated = moved!.find((b) => b.id === 'b1');
      const b2Updated = moved!.find((b) => b.id === 'b2');
      const b3Updated = moved!.find((b) => b.id === 'b3');

      expect(b1Updated?.category_id).toBe('c2');
      expect(b1Updated?.order).toBe(0);
      expect(b3Updated?.order).toBe(1);
      // Source category c1 is normalized: b2 becomes order 0
      expect(b2Updated?.order).toBe(0);
    });

    it('computeBookmarkMove moves bookmark to empty category', () => {
      const b1 = makeBookmark({
        id: 'b1',
        category_id: 'c1',
        title: 'B1',
        url: 'https://b1.test',
        order: 0,
      });
      const moved = computeBookmarkMove([b1], 'b1', null, 'c_empty', 'after');
      expect(moved).not.toBeNull();
      expect(moved![0]?.category_id).toBe('c_empty');
      expect(moved![0]?.order).toBe(0);
    });

    it('computeBookmarkMoveWithin handles up/down reordering and boundaries', () => {
      const b1 = makeBookmark({ id: 'b1', title: 'B1', url: 'https://b1.test', order: 0 });
      const b2 = makeBookmark({ id: 'b2', title: 'B2', url: 'https://b2.test', order: 1 });
      const b3 = makeBookmark({ id: 'b3', title: 'B3', url: 'https://b3.test', order: 2 });
      const list = [b1, b2, b3];

      // Boundary: cannot move top item up
      expect(computeBookmarkMoveWithin(list, 'b1', 'up')).toBeNull();

      // Boundary: cannot move bottom item down
      expect(computeBookmarkMoveWithin(list, 'b3', 'down')).toBeNull();

      // Move b2 up (swaps with b1)
      const moveUp = computeBookmarkMoveWithin(list, 'b2', 'up');
      expect(moveUp).not.toBeNull();
      const mapUp = new Map(moveUp!.map((b) => [b.id, b.order]));
      expect(mapUp.get('b2')).toBe(0);
      expect(mapUp.get('b1')).toBe(1);

      // Move b2 down (swaps with b3)
      const moveDown = computeBookmarkMoveWithin(list, 'b2', 'down');
      expect(moveDown).not.toBeNull();
      const mapDown = new Map(moveDown!.map((b) => [b.id, b.order]));
      expect(mapDown.get('b3')).toBe(1);
      expect(mapDown.get('b2')).toBe(2);
    });

    it('renders drag handles and supports menu-based Move Up/Down/Category', async () => {
      const b1 = makeBookmark({
        id: 'b1',
        category_id: 'c1',
        title: 'Alpha',
        url: 'https://alpha.test',
        order: 0,
      });
      const b2 = makeBookmark({
        id: 'b2',
        category_id: 'c1',
        title: 'Beta',
        url: 'https://beta.test',
        order: 1,
      });
      const cat2: CategoryItem = { ...CATEGORY, id: 'c2', name: 'Other Category' };

      const onReorderBookmarks = vi.fn();
      const view = new BookmarksView(
        {
          activeBookmarks: [b1, b2],
          sortedCategories: [CATEGORY, cat2],
          getRecentBookmarks: () => [],
          getBookmarksByCategory: (catId) => (catId === 'c1' ? [b1, b2] : []),
        },
        {
          onActivate: vi.fn(),
          onOpenAlternate: vi.fn(),
          onEdit: vi.fn(),
          onDelete: vi.fn(),
          onAddBookmark: vi.fn(),
          onImport: vi.fn(),
          onManageCategories: vi.fn(),
          onReorderBookmarks,
        },
      );
      document.body.appendChild(view.element);
      view.render();

      const section = q<HTMLElement>(view.element, 'section[data-category-id="c1"]');
      expect(section).toBeDefined();

      const tileB1 = q<HTMLElement>(view.element, '.tile[data-bookmark-id="b1"]');
      expect(tileB1).toBeDefined();
      expect(tileB1.getAttribute('data-category-id')).toBe('c1');

      const dragHandle = q<HTMLButtonElement>(tileB1, '.tile__drag');
      expect(dragHandle).toBeDefined();
      expect(dragHandle.getAttribute('aria-label')).toContain('Alpha');

      // Test keyboard / more menu Move actions
      const moreBtn = q<HTMLButtonElement>(tileB1, '.tile__more');
      moreBtn.click();
      await flush();

      // Find the menu items
      const menuItems = Array.from(
        document.body.querySelectorAll<HTMLElement>('.context-menu__item'),
      );
      const moveDownItem = menuItems.find((it) => it.textContent?.includes('Move down'));
      expect(moveDownItem).toBeDefined();

      moveDownItem!.click();
      await flush();

      expect(onReorderBookmarks).toHaveBeenCalledTimes(1);
      const reordered = onReorderBookmarks.mock.calls[0]?.[0] as BookmarkItem[];
      const b1Reordered = reordered.find((b) => b.id === 'b1');
      const b2Reordered = reordered.find((b) => b.id === 'b2');
      expect(b1Reordered?.order).toBe(1);
      expect(b2Reordered?.order).toBe(0);

      // Open menu again to test Move to category
      moreBtn.click();
      await flush();

      const menuItems2 = Array.from(
        document.body.querySelectorAll<HTMLElement>('.context-menu__item'),
      );
      const moveToOtherCat = menuItems2.find((it) => it.textContent?.includes('Other Category'));
      expect(moveToOtherCat).toBeDefined();

      moveToOtherCat!.click();
      await flush();

      expect(onReorderBookmarks).toHaveBeenCalledTimes(2);
      const crossCatReordered = onReorderBookmarks.mock.calls[1]?.[0] as BookmarkItem[];
      const b1Cross = crossCatReordered.find((b) => b.id === 'b1');
      expect(b1Cross?.category_id).toBe('c2');
    });
  });

  describe('Bookmark Widget Styling (Phase 3)', () => {
    it('applies widget styling CSS custom properties to DOM elements', () => {
      const el = document.createElement('div');
      applyBookmarkWidgetStyles(el, {
        bg_color: '#1e293b',
        text_color: '#ffffff',
        border_color: '#334155',
      });

      expect(el.style.getPropertyValue('--tile-custom-bg')).toBe('#1e293b');
      expect(el.style.getPropertyValue('--tile-custom-color')).toBe('#ffffff');
      expect(el.style.getPropertyValue('--tile-custom-border')).toBe('#334155');
      expect(el.style.getPropertyValue('--tile-custom-color-faint')).toContain('color-mix');
    });

    it('renders bookmark cards with custom widget styles in BookmarksView', () => {
      const styledBookmark = makeBookmark({
        id: 'styled_1',
        title: 'Cyberpunk Hub',
        url: 'https://cyber.hub',
        bg_color: '#0d1117',
        text_color: '#58a6ff',
        border_color: '#388bfd',
      });

      const store = {
        activeBookmarks: [styledBookmark],
        sortedCategories: [CATEGORY],
        getRecentBookmarks: () => [],
        getBookmarksByCategory: () => [styledBookmark],
      };

      const view = new BookmarksView(store, {
        onActivate: vi.fn(),
        onOpenAlternate: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onAddBookmark: vi.fn(),
        onImport: vi.fn(),
        onManageCategories: vi.fn(),
      });

      view.render();
      document.body.appendChild(view.element);

      const tile = q<HTMLElement>(view.element, '.tile');
      expect(tile.style.getPropertyValue('--tile-custom-bg')).toBe('#0d1117');
      expect(tile.style.getPropertyValue('--tile-custom-color')).toBe('#58a6ff');
      expect(tile.style.getPropertyValue('--tile-custom-border')).toBe('#388bfd');

      view.destroy();
    });

    it('BookmarkEditor preset buttons update form values and live preview', () => {
      const store = {
        sortedCategories: [CATEGORY],
        activeBookmarks: [],
        activeProfileId: 'p1',
      };

      const editor = new BookmarkEditor(store, {
        onSave: vi.fn(),
        onDelete: vi.fn(),
        onCreateCategory: vi.fn(),
      });

      document.body.appendChild(editor.element);
      editor.open();

      // Live preview has aria-hidden for screen reader hygiene
      const previewCard = q<HTMLElement>(editor.element, '.tile--preview');
      expect(previewCard.getAttribute('aria-hidden')).toBe('true');

      // Find preset buttons
      const presetButtons = Array.from(
        editor.element.querySelectorAll<HTMLButtonElement>('.widget-preset-btn'),
      );
      const sunsetBtn = presetButtons.find((btn) => btn.textContent?.includes('Sunset'));
      expect(sunsetBtn).toBeDefined();

      sunsetBtn!.click();

      const bgInput = q<HTMLInputElement>(editor.element, '[aria-label="Card background"]');
      const textInput = q<HTMLInputElement>(editor.element, '[aria-label="Text color"]');
      const borderInput = q<HTMLInputElement>(editor.element, '[aria-label="Border color"]');

      expect(bgInput.value).toContain('linear-gradient');
      expect(textInput.value).toBe('#ffffff');
      expect(borderInput.value).toBe('#ea580c');

      // Live preview reflects the preset style
      expect(previewCard.style.getPropertyValue('--tile-custom-bg')).toContain('linear-gradient');
      expect(previewCard.style.getPropertyValue('--tile-custom-color')).toBe('#ffffff');
      expect(previewCard.style.getPropertyValue('--tile-custom-border')).toBe('#ea580c');

      editor.close();
      editor.element.remove();
    });
  });
});
