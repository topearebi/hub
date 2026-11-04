/**
 * Hub Bookmarks View
 * ------------------
 * Renders the categorized bookmark grid, a local-only "Recently Used" row, and
 * the empty state (PRD §5.2, §6.3). Tiles activate on click; right-click opens a
 * context menu listing the primary URL and any mirrors for direct override.
 */

import { clearChildren, el, svg } from '../utils/dom';
import { Menu } from '../utils/menu';
import type { MenuItemSpec } from '../utils/menu';
import { hostnameOf } from '../core/fallback';
import { initialOf } from '../utils/text';

const ICON_MORE = 'M12 6h.01M12 12h.01M12 18h.01';
/** Long-press duration (ms) that opens the tile menu on touch (G-23). */
const LONG_PRESS_MS = 500;
import type { BookmarkItem, CategoryItem } from '../types/schemas';

export interface BookmarksStore {
  readonly activeBookmarks: BookmarkItem[];
  readonly sortedCategories: CategoryItem[];
  getRecentBookmarks(limit?: number): BookmarkItem[];
  getBookmarksByCategory(categoryId: string): BookmarkItem[];
}

export interface BookmarksCallbacks {
  onActivate: (bookmark: BookmarkItem) => void;
  onOpenAlternate: (bookmark: BookmarkItem, url: string) => void;
  /** Open the editor for an existing bookmark. */
  onEdit: (bookmark: BookmarkItem) => void;
  /** Soft-delete a bookmark (host confirms before persisting). */
  onDelete: (bookmark: BookmarkItem) => void;
  /** Open the bookmark editor to add a new link (guided empty state). */
  onAddBookmark: () => void;
  /** Open the import file picker (guided empty state). */
  onImport: () => void;
  /** Open the category manager. */
  onManageCategories: () => void;
}

export class BookmarksView {
  readonly element: HTMLElement;

  private readonly disposers: Array<() => void> = [];
  private readonly tileNodes: HTMLElement[] = [];
  private contextMenu: Menu | null = null;

  constructor(
    private readonly store: BookmarksStore,
    private readonly callbacks: BookmarksCallbacks,
  ) {
    this.element = el('div', { className: 'bookmarks' });
  }

  /** Rebuild the entire view from current store state. */
  render(): void {
    this.closeContextMenu();
    clearChildren(this.element);
    this.tileNodes.length = 0;

    const bookmarks = this.store.activeBookmarks;
    if (bookmarks.length === 0) {
      this.element.appendChild(this.renderEmpty());
      return;
    }

    const recents = this.store.getRecentBookmarks(6);
    if (recents.length > 0) {
      this.element.appendChild(this.renderSection('Recently Used', recents, true));
    }

    const categories = this.store.sortedCategories;
    const knownCategoryIds = new Set(categories.map((c) => c.id));
    for (const category of categories) {
      const items = this.store.getBookmarksByCategory(category.id);
      if (items.length === 0) {
        continue;
      }
      this.element.appendChild(this.renderSection(category.name, items, false));
    }

    const uncategorized = bookmarks.filter((b) => !knownCategoryIds.has(b.category_id));
    if (uncategorized.length > 0) {
      this.element.appendChild(this.renderSection('Uncategorized', uncategorized, false));
    }

    // Roving tabindex: only the first tile is in the Tab order (G-33).
    this.applyRovingTabindex();
  }

  destroy(): void {
    this.closeContextMenu();
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
    this.element.remove();
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Guided empty state (G-39, G-60, DESIGN.md §8): a heading, one explanatory
   * sentence and primary actions — never a bare sentence referencing a key that
   * does not exist.
   */
  private renderEmpty(): HTMLElement {
    const wrap = el('div', { className: 'empty-state empty-state--guided' });
    wrap.appendChild(el('h2', { className: 'empty-state__title', text: 'Nothing here yet.' }));
    wrap.appendChild(
      el('p', {
        className: 'empty-state__text',
        text: 'Add your first link, or import your bookmarks.',
      }),
    );

    const add = el('button', {
      className: 'button button--primary',
      text: 'Add link',
      attrs: { type: 'button' },
    });
    add.addEventListener('click', () => this.callbacks.onAddBookmark());

    const importButton = el('button', {
      className: 'button',
      text: 'Import',
      attrs: { type: 'button' },
    });
    importButton.addEventListener('click', () => this.callbacks.onImport());

    wrap.appendChild(
      el('div', { className: 'empty-state__actions', children: [add, importButton] }),
    );
    return wrap;
  }

  private renderSection(
    title: string,
    items: readonly BookmarkItem[],
    isRecents: boolean,
  ): HTMLElement {
    const heading = el('h2', { className: 'section__title', text: title });
    const grid = el('ul', { className: 'tile-grid' });
    for (const bookmark of items) {
      grid.appendChild(this.renderTile(bookmark, isRecents));
    }
    return el('section', { className: 'section', children: [heading, grid] });
  }

  private renderTile(bookmark: BookmarkItem, isRecents: boolean): HTMLElement {
    const tile = el('li', { className: `tile${isRecents ? ' tile--recent' : ''}` });

    const open = el('button', {
      className: 'tile__open',
      attrs: { type: 'button', title: bookmark.url },
    });
    // "Recently Used" duplicates are labelled and removed from the Tab order so
    // they do not create double Tab stops (G-42, DESIGN.md §6.3).
    if (isRecents) {
      open.setAttribute('aria-label', `Recent: ${bookmark.title}`);
      open.setAttribute('tabindex', '-1');
    }
    open.appendChild(this.renderIcon(bookmark));
    open.appendChild(el('span', { className: 'tile__title', text: bookmark.title }));
    if (bookmark.hotkey) {
      open.appendChild(el('kbd', { className: 'tile__hotkey', text: bookmark.hotkey }));
    }

    // Long-press (touch) opens the menu; a subsequent click is suppressed.
    let longPressed = false;
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    const clearPress = (): void => {
      if (pressTimer !== null) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    open.addEventListener('click', (event) => {
      if (longPressed) {
        event.preventDefault();
        longPressed = false;
        return;
      }
      this.callbacks.onActivate(bookmark);
    });
    open.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      this.openContextMenu(bookmark, event.clientX, event.clientY);
    });
    open.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        return;
      }
      longPressed = false;
      pressTimer = setTimeout(() => {
        longPressed = true;
        this.openContextMenu(bookmark, event.clientX, event.clientY);
      }, LONG_PRESS_MS);
    });
    open.addEventListener('pointerup', clearPress);
    open.addEventListener('pointercancel', clearPress);
    open.addEventListener('pointerleave', clearPress);
    open.addEventListener('keydown', (event: KeyboardEvent) =>
      this.handleTileKeydown(event, open, bookmark),
    );

    // A visible, always-present "more" affordance (G-22, G-23).
    const moreButton = el('button', {
      className: 'icon-button tile__more',
      attrs: {
        type: 'button',
        'aria-label': `Actions for ${bookmark.title}`,
        'aria-haspopup': 'menu',
      },
    });
    moreButton.appendChild(svg(ICON_MORE, { size: 16 }));
    if (isRecents) {
      moreButton.setAttribute('tabindex', '-1');
    }
    moreButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = moreButton.getBoundingClientRect();
      this.openContextMenu(bookmark, rect.left, rect.bottom);
    });

    tile.appendChild(open);
    tile.appendChild(moreButton);
    // Only category tiles participate in the roving-tabindex grid; recents are
    // duplicates and stay out of the Tab order (G-42).
    if (!isRecents) {
      this.tileNodes.push(open);
    }
    return tile;
  }

  /** Keyboard: menu key / Shift+F10 opens actions; arrows rove the grid (G-33). */
  private handleTileKeydown(event: KeyboardEvent, open: HTMLElement, bookmark: BookmarkItem): void {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = open.getBoundingClientRect();
      this.openContextMenu(bookmark, rect.left, rect.bottom);
      return;
    }

    const count = this.tileNodes.length;
    if (count === 0) {
      return;
    }
    const current = this.tileNodes.indexOf(open);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = current + 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = current - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = count - 1;
    } else {
      return;
    }
    event.preventDefault();
    this.focusTile(((next % count) + count) % count);
  }

  private focusTile(index: number): void {
    this.tileNodes.forEach((node, i) => node.setAttribute('tabindex', i === index ? '0' : '-1'));
    this.tileNodes[index]?.focus();
  }

  private applyRovingTabindex(): void {
    this.tileNodes.forEach((node, i) => node.setAttribute('tabindex', i === 0 ? '0' : '-1'));
  }

  /**
   * Render the bookmark icon. Per SCHEMAS.md §2.3 the fallback is the favicon
   * service; on any load error we swap to a fully-local letter avatar so the
   * app degrades gracefully when offline (AGENTS.md air-gap mandate).
   */
  private renderIcon(bookmark: BookmarkItem): HTMLElement {
    const host = hostnameOf(bookmark.url);
    const src =
      bookmark.icon && bookmark.icon.length > 0
        ? bookmark.icon
        : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

    const img = el('img', {
      className: 'tile__icon',
      attrs: {
        src,
        alt: '',
        width: '24',
        height: '24',
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
      },
    });
    img.addEventListener(
      'error',
      () => {
        img.replaceWith(this.renderLetterAvatar(bookmark.title));
      },
      { once: true },
    );
    return img;
  }

  private renderLetterAvatar(title: string): HTMLElement {
    const letter = initialOf(title, '?');
    return el('span', { className: 'tile__icon tile__icon--fallback', text: letter });
  }

  /* ---------------------------------------------------------------- */
  /* Context menu (direct mirror override, PRD §5.2.5)                */
  /* ---------------------------------------------------------------- */

  private openContextMenu(bookmark: BookmarkItem, x: number, y: number): void {
    this.closeContextMenu();

    const targets = [bookmark.url, ...(bookmark.alternate_urls ?? [])];
    const items: MenuItemSpec[] = targets.map((url, index) => ({
      label: index === 0 ? `Open primary (${hostnameOf(url)})` : `Open mirror (${hostnameOf(url)})`,
      onSelect: () => this.callbacks.onOpenAlternate(bookmark, url),
    }));
    items.push({
      label: 'Edit bookmark',
      separatorBefore: true,
      onSelect: () => this.callbacks.onEdit(bookmark),
    });
    items.push({
      label: 'Delete',
      danger: true,
      onSelect: () => this.callbacks.onDelete(bookmark),
    });

    // The shared Menu handles roving focus, arrow/Home/End/Escape keys,
    // type-ahead and viewport clamping (DESIGN.md §6.8).
    this.contextMenu = new Menu({
      label: `Actions for ${bookmark.title}`,
      className: 'context-menu',
      itemClassName: 'context-menu__item',
      separatorClassName: 'context-menu__separator',
      items,
      onClose: () => {
        this.contextMenu = null;
      },
    });
    this.contextMenu.openAt(x, y);
  }

  private closeContextMenu(): void {
    this.contextMenu?.destroy();
    this.contextMenu = null;
  }
}
