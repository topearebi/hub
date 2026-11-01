/**
 * Hub Bookmarks View
 * ------------------
 * Renders the categorized bookmark grid, a local-only "Recently Used" row, and
 * the empty state (PRD §5.2, §6.3). Tiles activate on click; right-click opens a
 * context menu listing the primary URL and any mirrors for direct override.
 */

import { clearChildren, el, on } from '../utils/dom';
import { hostnameOf } from '../core/fallback';
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
}

export class BookmarksView {
  readonly element: HTMLElement;

  private readonly disposers: Array<() => void> = [];
  private readonly menuDisposers: Array<() => void> = [];
  private contextMenu: HTMLElement | null = null;

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

  private renderEmpty(): HTMLElement {
    return el('p', {
      className: 'empty-state',
      text: "No links added yet. Press '+' or use Settings to import your links.",
    });
  }

  private renderSection(
    title: string,
    items: readonly BookmarkItem[],
    isRecents: boolean,
  ): HTMLElement {
    const heading = el('h2', { className: 'section__title', text: title });
    const grid = el('div', { className: 'tile-grid' });
    for (const bookmark of items) {
      grid.appendChild(this.renderTile(bookmark, isRecents));
    }
    return el('section', { className: 'section', children: [heading, grid] });
  }

  private renderTile(bookmark: BookmarkItem, isRecents: boolean): HTMLElement {
    const tile = el('button', {
      className: `tile${isRecents ? ' tile--recent' : ''}`,
      attrs: { type: 'button', title: bookmark.url },
    });

    tile.appendChild(this.renderIcon(bookmark));
    tile.appendChild(el('span', { className: 'tile__title', text: bookmark.title }));
    if (bookmark.hotkey) {
      tile.appendChild(el('kbd', { className: 'tile__hotkey', text: bookmark.hotkey }));
    }

    tile.addEventListener('click', () => this.callbacks.onActivate(bookmark));
    tile.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      this.openContextMenu(bookmark, event.clientX, event.clientY);
    });

    return tile;
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
    const letter = (title.trim().charAt(0) || '?').toUpperCase();
    return el('span', { className: 'tile__icon tile__icon--fallback', text: letter });
  }

  /* ---------------------------------------------------------------- */
  /* Context menu (direct mirror override, PRD §5.2.5)                */
  /* ---------------------------------------------------------------- */

  private openContextMenu(bookmark: BookmarkItem, x: number, y: number): void {
    this.closeContextMenu();

    const menu = el('div', { className: 'context-menu', attrs: { role: 'menu' } });
    const targets = [bookmark.url, ...(bookmark.alternate_urls ?? [])];

    targets.forEach((url, index) => {
      const label =
        index === 0 ? `Open primary (${hostnameOf(url)})` : `Open mirror (${hostnameOf(url)})`;
      const item = el('button', {
        className: 'context-menu__item',
        text: label,
        attrs: { type: 'button', role: 'menuitem' },
      });
      item.addEventListener('click', () => {
        this.closeContextMenu();
        this.callbacks.onOpenAlternate(bookmark, url);
      });
      menu.appendChild(item);
    });

    // Management actions: edit the bookmark or soft-delete it.
    menu.appendChild(el('div', { className: 'context-menu__separator' }));

    const editItem = el('button', {
      className: 'context-menu__item',
      text: 'Edit bookmark',
      attrs: { type: 'button', role: 'menuitem' },
    });
    editItem.addEventListener('click', () => {
      this.closeContextMenu();
      this.callbacks.onEdit(bookmark);
    });
    menu.appendChild(editItem);

    const deleteItem = el('button', {
      className: 'context-menu__item context-menu__item--danger',
      text: 'Delete',
      attrs: { type: 'button', role: 'menuitem' },
    });
    deleteItem.addEventListener('click', () => {
      this.closeContextMenu();
      this.callbacks.onDelete(bookmark);
    });
    menu.appendChild(deleteItem);

    // Coordinates are passed as CSS custom properties so all visual styling
    // stays in the stylesheet (AGENTS.md: no inline CSS).
    menu.style.setProperty('--menu-x', `${x}px`);
    menu.style.setProperty('--menu-y', `${y}px`);
    document.body.appendChild(menu);
    this.contextMenu = menu;

    this.menuDisposers.push(
      on(document, 'mousedown', (event: Event) => {
        if (this.contextMenu && !this.contextMenu.contains(event.target as Node)) {
          this.closeContextMenu();
        }
      }),
    );
    this.menuDisposers.push(
      on(document, 'keydown', (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          this.closeContextMenu();
        }
      }),
    );
  }

  private closeContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    for (const dispose of this.menuDisposers) {
      dispose();
    }
    this.menuDisposers.length = 0;
  }
}
