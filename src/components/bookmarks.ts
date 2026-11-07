/**
 * Hub Bookmarks View
 * ------------------
 * Renders the categorized bookmark grid, a local-only "Recently Used" row, and
 * the empty state (PRD §5.2, §6.3). Tiles activate on click; right-click opens a
 * context menu listing the primary URL and any mirrors for direct override.
 */

import { clearChildren, el, svg } from '../utils/dom';
import { t } from '../utils/i18n';
import { Menu } from '../utils/menu';
import type { MenuItemSpec } from '../utils/menu';
import { canShare, share } from '../utils/share';
import { hostnameOf } from '../core/fallback';
import { initialOf } from '../utils/text';
import { showToast } from './toast';
import type { BookmarkCardSize, BookmarkItem, CategoryItem } from '../types/schemas';

const ICON_MORE = 'M12 6h.01M12 12h.01M12 18h.01';
const ICON_RESIZE = 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7';
/** Long-press duration (ms) that opens the tile menu on touch (G-23). */
const LONG_PRESS_MS = 500;

export const NEXT_CARD_SIZE: Record<BookmarkCardSize, BookmarkCardSize> = {
  small: 'wide',
  wide: 'large',
  large: 'small',
};

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
  /** Resize a bookmark tile card footprint. */
  onResize?: (bookmark: BookmarkItem, size: BookmarkCardSize) => void;
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
      this.element.appendChild(this.renderSection(t('bookmarks.recentlyUsed'), recents, true));
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
      this.element.appendChild(
        this.renderSection(t('bookmarks.uncategorized'), uncategorized, false),
      );
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
    wrap.appendChild(
      el('h2', { className: 'empty-state__title', text: t('bookmarks.emptyTitle') }),
    );
    wrap.appendChild(
      el('p', {
        className: 'empty-state__text',
        text: t('bookmarks.emptyText'),
      }),
    );

    const add = el('button', {
      className: 'button button--primary',
      text: t('bookmarks.addLink'),
      attrs: { type: 'button' },
    });
    add.addEventListener('click', () => this.callbacks.onAddBookmark());

    const importButton = el('button', {
      className: 'button',
      text: t('common.import'),
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
    const size: BookmarkCardSize = isRecents ? 'small' : (bookmark.card_size ?? 'small');
    const tile = el('li', {
      className: `tile tile--size-${size}${isRecents ? ' tile--recent' : ''}`,
    });

    const open = el('button', {
      className: 'tile__open',
      attrs: { type: 'button', title: bookmark.url },
    });
    // "Recently Used" duplicates are labelled and removed from the Tab order so
    // they do not create double Tab stops (G-42, DESIGN.md §6.3).
    if (isRecents) {
      open.setAttribute('aria-label', t('bookmarks.recentLabel', { title: bookmark.title }));
      open.setAttribute('tabindex', '-1');
    }

    if (size === 'wide') {
      const icon = this.renderIcon(bookmark);
      const content = el('div', { className: 'tile__body' });
      const row = el('div', { className: 'tile__header-row' });
      row.appendChild(el('span', { className: 'tile__title', text: bookmark.title }));
      if (bookmark.hotkey) {
        row.appendChild(el('kbd', { className: 'tile__hotkey', text: bookmark.hotkey }));
      }
      content.appendChild(row);
      if (bookmark.description) {
        content.appendChild(
          el('p', { className: 'tile__description', text: bookmark.description }),
        );
      }
      if (bookmark.alternate_urls && bookmark.alternate_urls.length > 0) {
        content.appendChild(
          el('span', {
            className: 'tile__badge tile__badge--mirrors',
            text: t('bookmarks.mirrorCount', { count: bookmark.alternate_urls.length }),
          }),
        );
      }
      open.appendChild(icon);
      open.appendChild(content);
    } else if (size === 'large') {
      const header = el('div', { className: 'tile__header' });
      const icon = this.renderIcon(bookmark);
      const titleCol = el('div', { className: 'tile__title-col' });
      titleCol.appendChild(el('span', { className: 'tile__title', text: bookmark.title }));
      const host = hostnameOf(bookmark.url);
      if (host) {
        titleCol.appendChild(el('span', { className: 'tile__host', text: host }));
      }
      header.appendChild(icon);
      header.appendChild(titleCol);
      if (bookmark.hotkey) {
        header.appendChild(el('kbd', { className: 'tile__hotkey', text: bookmark.hotkey }));
      }
      open.appendChild(header);

      if (bookmark.description) {
        open.appendChild(el('p', { className: 'tile__description', text: bookmark.description }));
      }
    } else {
      open.appendChild(this.renderIcon(bookmark));
      open.appendChild(el('span', { className: 'tile__title', text: bookmark.title }));
      if (bookmark.hotkey) {
        open.appendChild(el('kbd', { className: 'tile__hotkey', text: bookmark.hotkey }));
      }
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

    // Mirrors section for large tiles (dynamic content without nested buttons)
    let mirrorsContainer: HTMLElement | null = null;
    if (size === 'large' && bookmark.alternate_urls && bookmark.alternate_urls.length > 0) {
      mirrorsContainer = el('div', {
        className: 'tile__mirrors',
        attrs: { role: 'group', 'aria-label': t('bookmarkEditor.fieldAlt') },
      });
      const primaryChip = el('button', {
        className: 'tile__mirror-chip tile__mirror-chip--primary',
        text: t('bookmarks.openPrimary', { host: hostnameOf(bookmark.url) }),
        attrs: { type: 'button' },
      });
      primaryChip.addEventListener('click', (event) => {
        event.stopPropagation();
        this.callbacks.onActivate(bookmark);
      });
      mirrorsContainer.appendChild(primaryChip);

      for (const mirrorUrl of bookmark.alternate_urls) {
        const mirrorHost = hostnameOf(mirrorUrl);
        const mirrorChip = el('button', {
          className: 'tile__mirror-chip',
          text: t('bookmarks.openMirrorDirect', { host: mirrorHost }),
          attrs: { type: 'button' },
        });
        mirrorChip.addEventListener('click', (event) => {
          event.stopPropagation();
          this.callbacks.onOpenAlternate(bookmark, mirrorUrl);
        });
        mirrorsContainer.appendChild(mirrorChip);
      }
    }

    const actionsWrapper = el('div', { className: 'tile__actions' });

    // Cycle size button (only on non-recents)
    if (!isRecents) {
      const sizeLabels: Record<BookmarkCardSize, string> = {
        small: t('bookmarks.sizeSmall'),
        wide: t('bookmarks.sizeWide'),
        large: t('bookmarks.sizeLarge'),
      };
      const cycleButton = el('button', {
        className: 'icon-button tile__cycle-size',
        attrs: {
          type: 'button',
          'aria-label': t('bookmarks.cycleSize', { size: sizeLabels[size] }),
        },
      });
      cycleButton.appendChild(svg(ICON_RESIZE, { size: 14 }));
      cycleButton.addEventListener('click', (event) => {
        event.stopPropagation();
        this.callbacks.onResize?.(bookmark, NEXT_CARD_SIZE[size]);
      });
      actionsWrapper.appendChild(cycleButton);
    }

    // A visible, always-present "more" affordance (G-22, G-23).
    const moreButton = el('button', {
      className: 'icon-button tile__more',
      attrs: {
        type: 'button',
        'aria-label': t('common.actionsFor', { name: bookmark.title }),
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
    actionsWrapper.appendChild(moreButton);

    tile.appendChild(open);
    if (mirrorsContainer) {
      tile.appendChild(mirrorsContainer);
    }
    tile.appendChild(actionsWrapper);
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
      label:
        index === 0
          ? t('bookmarks.openPrimary', { host: hostnameOf(url) })
          : t('bookmarks.openMirror', { host: hostnameOf(url) }),
      onSelect: () => this.callbacks.onOpenAlternate(bookmark, url),
    }));

    if (this.callbacks.onResize) {
      items.push({
        label: t('bookmarks.sizeSmall'),
        separatorBefore: true,
        onSelect: () => this.callbacks.onResize?.(bookmark, 'small'),
      });
      items.push({
        label: t('bookmarks.sizeWide'),
        onSelect: () => this.callbacks.onResize?.(bookmark, 'wide'),
      });
      items.push({
        label: t('bookmarks.sizeLarge'),
        onSelect: () => this.callbacks.onResize?.(bookmark, 'large'),
      });
    }

    items.push({
      label: t('bookmarks.edit'),
      separatorBefore: true,
      onSelect: () => this.callbacks.onEdit(bookmark),
    });
    items.push({
      label: t('bookmarks.share'),
      onSelect: () => void this.shareBookmark(bookmark),
    });
    items.push({
      label: t('common.delete'),
      danger: true,
      onSelect: () => this.callbacks.onDelete(bookmark),
    });

    // The shared Menu handles roving focus, arrow/Home/End/Escape keys,
    // type-ahead and viewport clamping (DESIGN.md §6.8).
    this.contextMenu = new Menu({
      label: t('common.actionsFor', { name: bookmark.title }),
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

  /** Share a bookmark via the native share sheet, when available (G-53). */
  private async shareBookmark(bookmark: BookmarkItem): Promise<void> {
    const shared = await share({ title: bookmark.title, url: bookmark.url });
    if (!shared && !canShare()) {
      showToast(t('bookmarks.shareUnavailable'), { variant: 'warning' });
    }
  }
}
