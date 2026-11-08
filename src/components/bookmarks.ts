/**
 * Hub Bookmarks View
 * ------------------
 * Renders the categorized bookmark grid, a local-only "Recently Used" row, and
 * the empty state (PRD §5.2, §6.3). Tiles activate on click; right-click opens a
 * context menu listing the primary URL and any mirrors for direct override.
 */

import { clearChildren, el, svg, ICON_CHEVRON, ICON_GRIP, ICON_MORE } from '../utils/dom';
import { t, tp } from '../utils/i18n';
import { Menu } from '../utils/menu';
import type { MenuItemSpec } from '../utils/menu';
import { canShare, share } from '../utils/share';
import { hostnameOf } from '../core/fallback';
import { initialOf } from '../utils/text';
import { showToast } from './toast';
import type { BookmarkCardSize, BookmarkItem, CategoryItem } from '../types/schemas';

const ICON_RESIZE = 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7';
/** Long-press duration (ms) that opens the tile menu on touch (G-23). */
const LONG_PRESS_MS = 500;

export const NEXT_CARD_SIZE: Record<BookmarkCardSize, BookmarkCardSize> = {
  small: 'wide',
  wide: 'large',
  large: 'small',
};

export type BookmarkDropPosition = 'before' | 'after';

/**
 * Pure helper to compute updated bookmark items when dragging `draggedId` onto
 * a target tile `targetId` (or dropping onto `targetCategoryId`).
 */
export function computeBookmarkMove(
  bookmarks: readonly BookmarkItem[],
  draggedId: string,
  targetId: string | null,
  targetCategoryId: string,
  position: BookmarkDropPosition = 'after',
  now: number = Date.now(),
): BookmarkItem[] | null {
  const dragged = bookmarks.find((b) => b.id === draggedId);
  if (!dragged || (targetId && draggedId === targetId)) {
    return null;
  }

  const isCrossCategory = dragged.category_id !== targetCategoryId;
  const filterSiblings = (catId: string) =>
    bookmarks
      .filter((b) => b.category_id === catId && b.id !== draggedId && !b.is_deleted)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created_at - b.created_at);

  const targetSiblings = filterSiblings(targetCategoryId);
  let insertIndex = targetSiblings.length;
  if (targetId) {
    const idx = targetSiblings.findIndex((b) => b.id === targetId);
    if (idx !== -1) insertIndex = position === 'before' ? idx : idx + 1;
  }

  const newTargetSiblings = [...targetSiblings];
  newTargetSiblings.splice(insertIndex, 0, {
    ...dragged,
    category_id: targetCategoryId,
    updated_at: now,
  });

  const orderMap = new Map<string, { order: number; category_id: string }>();
  newTargetSiblings.forEach((b, i) =>
    orderMap.set(b.id, { order: i, category_id: targetCategoryId }),
  );

  if (isCrossCategory) {
    filterSiblings(dragged.category_id).forEach((b, i) =>
      orderMap.set(b.id, { order: i, category_id: dragged.category_id }),
    );
  }

  let hasChange = false;
  const result = bookmarks.map((b) => {
    const update = orderMap.get(b.id);
    if (!update || (b.order === update.order && b.category_id === update.category_id)) {
      return b;
    }
    hasChange = true;
    return { ...b, order: update.order, category_id: update.category_id, updated_at: now };
  });

  return hasChange ? result : null;
}

/**
 * Pure helper to compute move up / move down within the current category.
 */
export function computeBookmarkMoveWithin(
  bookmarks: readonly BookmarkItem[],
  bookmarkId: string,
  direction: 'up' | 'down',
  now: number = Date.now(),
): BookmarkItem[] | null {
  const bookmark = bookmarks.find((b) => b.id === bookmarkId);
  if (!bookmark) {
    return null;
  }

  const siblings = bookmarks
    .filter((b) => b.category_id === bookmark.category_id && b.is_deleted !== true)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created_at - b.created_at);

  const idx = siblings.findIndex((b) => b.id === bookmarkId);
  if (idx === -1) {
    return null;
  }

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings.length) {
    return null;
  }

  const target = siblings[targetIdx];
  if (!target) {
    return null;
  }

  return computeBookmarkMove(
    bookmarks,
    bookmarkId,
    target.id,
    bookmark.category_id,
    direction === 'up' ? 'before' : 'after',
    now,
  );
}

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
  /** Toggle category collapsed state. */
  onToggleCategory?: (category: CategoryItem) => void;
  /** Reorder bookmarks in batch (drag-and-drop or move menu). */
  onReorderBookmarks?: (bookmarks: readonly BookmarkItem[]) => Promise<void> | void;
}

export class BookmarksView {
  readonly element: HTMLElement;

  private readonly disposers: Array<() => void> = [];
  private readonly tileNodes: HTMLElement[] = [];
  private contextMenu: Menu | null = null;
  private dragState: {
    id: string;
    tile: HTMLElement;
    pointerId: number;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null = null;
  private autoExpandTimer: ReturnType<typeof setTimeout> | null = null;

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
      this.element.appendChild(this.renderSection(category.name, items, false, category));
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
    this.clearAutoExpandTimer();
    this.clearDropIndicators();
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
    category?: CategoryItem,
  ): HTMLElement {
    const isCollapsed = Boolean(category?.collapsed);
    const gridId = category ? `category-grid-${category.id}` : undefined;
    const grid = el('ul', {
      className: `tile-grid${isCollapsed ? ' is-collapsed' : ''}`,
      attrs: gridId ? { id: gridId } : {},
    });

    let heading: HTMLElement;
    if (category) {
      const chevron = svg(ICON_CHEVRON, { className: 'section__chevron' });
      const titleEl = el('span', { className: 'section__title', text: title });
      const countBadge = el('span', {
        className: 'section__badge',
        text: tp('bookmarks.itemCount', items.length),
      });
      const toggleBtn = el('button', {
        className: 'section__header-toggle',
        attrs: {
          type: 'button',
          'aria-expanded': isCollapsed ? 'false' : 'true',
          'aria-controls': gridId!,
          'aria-label': isCollapsed
            ? t('bookmarks.expandCategory', { name: title })
            : t('bookmarks.collapseCategory', { name: title }),
        },
        children: [chevron, titleEl, countBadge],
      });
      toggleBtn.addEventListener('click', () => {
        this.callbacks.onToggleCategory?.(category);
      });
      heading = el('div', { className: 'section__header', children: [toggleBtn] });
    } else {
      heading = el('h2', { className: 'section__title', text: title });
    }

    if (isCollapsed) {
      grid.hidden = true;
    } else {
      for (const bookmark of items) {
        grid.appendChild(this.renderTile(bookmark, isRecents));
      }
    }

    return el('section', {
      className: `section${isCollapsed ? ' section--collapsed' : ''}`,
      attrs: category ? { 'data-category-id': category.id } : {},
      children: [heading, grid],
    });
  }

  private renderTile(bookmark: BookmarkItem, isRecents: boolean): HTMLElement {
    const size: BookmarkCardSize = isRecents ? 'small' : (bookmark.card_size ?? 'small');
    const tile = el('li', {
      className: `tile tile--size-${size}${isRecents ? ' tile--recent' : ''}`,
    });
    tile.dataset.bookmarkId = bookmark.id;
    tile.dataset.categoryId = bookmark.category_id;

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

    // Actions on non-recents: drag handle, cycle size
    if (!isRecents) {
      const dragLabel = t('bookmarks.dragAria', { title: bookmark.title });
      const dragHandle = el('button', {
        className: 'icon-button tile__drag',
        attrs: {
          type: 'button',
          'aria-label': dragLabel,
          title: dragLabel,
        },
      });
      dragHandle.appendChild(svg(ICON_GRIP, { size: 14 }));
      this.bindDragHandle(dragHandle, bookmark, tile);
      actionsWrapper.appendChild(dragHandle);

      const sizeKey =
        size === 'small'
          ? 'bookmarks.sizeSmall'
          : size === 'wide'
            ? 'bookmarks.sizeWide'
            : 'bookmarks.sizeLarge';
      const cycleLabel = t('bookmarks.cycleSize', { size: t(sizeKey) });
      const cycleButton = el('button', {
        className: 'icon-button tile__cycle-size',
        attrs: {
          type: 'button',
          'aria-label': cycleLabel,
          title: cycleLabel,
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

    if (this.callbacks.onReorderBookmarks) {
      const reorder = (dir: 'up' | 'down') => {
        const u = computeBookmarkMoveWithin(this.store.activeBookmarks, bookmark.id, dir);
        if (u) void this.callbacks.onReorderBookmarks?.(u);
      };
      items.push(
        { label: t('bookmarks.moveUp'), separatorBefore: true, onSelect: () => reorder('up') },
        { label: t('bookmarks.moveDown'), onSelect: () => reorder('down') },
      );
      for (const cat of this.store.sortedCategories) {
        if (cat.id !== bookmark.category_id) {
          items.push({
            label: `${t('bookmarks.moveToCategory')} ${cat.name}`,
            onSelect: () => {
              const u = computeBookmarkMove(
                this.store.activeBookmarks,
                bookmark.id,
                null,
                cat.id,
                'after',
              );
              if (u) void this.callbacks.onReorderBookmarks?.(u);
            },
          });
        }
      }
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

  private bindDragHandle(handle: HTMLElement, bookmark: BookmarkItem, tile: HTMLElement): void {
    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture?.(e.pointerId);
      this.dragState = {
        id: bookmark.id,
        tile,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
      };
    });

    handle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.dragState || e.pointerId !== this.dragState.pointerId) {
        return;
      }
      if (!this.dragState.isDragging) {
        if (Math.hypot(e.clientX - this.dragState.startX, e.clientY - this.dragState.startY) > 5) {
          this.dragState.isDragging = true;
          this.dragState.tile.classList.add('is-dragging');
        } else {
          return;
        }
      }

      this.clearDropIndicators();
      const elUnder = document.elementFromPoint(e.clientX, e.clientY);
      const targetTile = elUnder?.closest<HTMLElement>('.tile:not(.tile--recent)');
      if (targetTile && targetTile !== this.dragState.tile) {
        const rect = targetTile.getBoundingClientRect();
        const isAfter = e.clientX - rect.left > rect.width / 2;
        targetTile.classList.add(isAfter ? 'is-drop-after' : 'is-drop-before');
        return;
      }

      const targetSection = elUnder?.closest<HTMLElement>('.section');
      if (targetSection) {
        targetSection.classList.add('is-drop-target');
        if (targetSection.classList.contains('section--collapsed')) {
          const catId = targetSection.dataset.categoryId;
          if (catId && !this.autoExpandTimer) {
            this.autoExpandTimer = setTimeout(() => {
              const cat = this.store.sortedCategories.find((c) => c.id === catId);
              if (cat && cat.collapsed) {
                this.callbacks.onToggleCategory?.(cat);
              }
              this.autoExpandTimer = null;
            }, 600);
          }
        }
      }
    });

    handle.addEventListener('pointerup', (e: PointerEvent) => {
      const state = this.dragState;
      if (!state || e.pointerId !== state.pointerId) return;
      this.clearAutoExpandTimer();
      this.dragState = null;
      state.tile.classList.remove('is-dragging');
      if (!state.isDragging) return;

      const elUnder = document.elementFromPoint(e.clientX, e.clientY);
      this.clearDropIndicators();
      const targetTile = elUnder?.closest<HTMLElement>('.tile:not(.tile--recent)');
      const targetSection = elUnder?.closest<HTMLElement>('.section');

      let updated: BookmarkItem[] | null = null;
      if (targetTile && targetTile !== state.tile) {
        const { bookmarkId, categoryId } = targetTile.dataset;
        if (bookmarkId && categoryId) {
          const rect = targetTile.getBoundingClientRect();
          const position: BookmarkDropPosition =
            e.clientX - rect.left > rect.width / 2 ? 'after' : 'before';
          updated = computeBookmarkMove(
            this.store.activeBookmarks,
            state.id,
            bookmarkId,
            categoryId,
            position,
          );
        }
      } else if (targetSection?.dataset.categoryId) {
        updated = computeBookmarkMove(
          this.store.activeBookmarks,
          state.id,
          null,
          targetSection.dataset.categoryId,
          'after',
        );
      }

      if (updated) void this.callbacks.onReorderBookmarks?.(updated);
    });

    handle.addEventListener('pointercancel', () => {
      this.clearAutoExpandTimer();
      if (this.dragState) {
        this.dragState.tile.classList.remove('is-dragging');
        this.dragState = null;
      }
      this.clearDropIndicators();
    });
  }

  private clearDropIndicators(): void {
    this.element
      .querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-target')
      .forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-target'));
  }

  private clearAutoExpandTimer(): void {
    if (this.autoExpandTimer !== null) {
      clearTimeout(this.autoExpandTimer);
      this.autoExpandTimer = null;
    }
  }

  /** Share a bookmark via the native share sheet, when available (G-53). */
  private async shareBookmark(bookmark: BookmarkItem): Promise<void> {
    const shared = await share({ title: bookmark.title, url: bookmark.url });
    if (!shared && !canShare()) {
      showToast(t('bookmarks.shareUnavailable'), { variant: 'warning' });
    }
  }
}
