/**
 * Hub Bookmarks View
 * ------------------
 * Renders the categorized bookmark grid, a local-only "Recently Used" row, and
 * the empty state (PRD §5.2, §6.3). Tiles activate on click; right-click opens a
 * context menu listing the primary URL and any mirrors for direct override.
 */

import { btn, clearChildren, el, iconBtn, svg, ICON_CHEVRON, ICON_MORE } from '../utils/dom';
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
 * Apply custom widget styling (scoped CSS custom properties) to a bookmark tile element.
 */
export function applyBookmarkWidgetStyles(
  element: HTMLElement,
  styling: {
    bg_color?: string | undefined;
    text_color?: string | undefined;
    border_color?: string | undefined;
  },
): void {
  const s = element.style;
  const set = (k: string, v?: string) => (v ? s.setProperty(k, v) : s.removeProperty(k));
  set('--tile-custom-bg', styling.bg_color);
  set('--tile-custom-color', styling.text_color);
  set('--tile-custom-border', styling.border_color);
  set(
    '--tile-custom-color-faint',
    styling.text_color ? `color-mix(in srgb, ${styling.text_color} 75%, transparent)` : undefined,
  );
}

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

type BookmarkContent = Pick<BookmarkItem, 'title' | 'url' | 'icon' | 'description' | 'hotkey'>;

/** Shared renderer keeps the live editor preview identical to saved card content. */
export function populateBookmarkContent(
  open: HTMLElement,
  bookmark: BookmarkContent,
  size: BookmarkCardSize,
): void {
  open.replaceChildren();
  const body = el('div', {
    className: 'tile__body',
    children: [el('span', { className: 'tile__title', text: bookmark.title })],
  });
  if (size !== 'small') {
    const host = hostnameOf(bookmark.url);
    if (host) body.appendChild(el('span', { className: 'tile__host', text: host }));
    if (bookmark.description)
      body.appendChild(el('p', { className: 'tile__description', text: bookmark.description }));
  }
  open.append(renderBookmarkIcon(bookmark), body);
  if (bookmark.hotkey)
    open.appendChild(el('kbd', { className: 'tile__hotkey', text: bookmark.hotkey }));
}

/** Custom image → site's favicon → local avatar, shared with the editor preview. */
function renderBookmarkIcon(bookmark: BookmarkContent): HTMLElement {
  const fallback = (): HTMLElement =>
    el('span', {
      className: 'tile__icon tile__icon--fallback',
      text: initialOf(bookmark.title, '?'),
    });
  const sources: string[] = [];
  const custom = bookmark.icon?.trim();
  if (custom) {
    try {
      const parsed = new URL(custom, window.location.href);
      if (['http:', 'https:', 'blob:'].includes(parsed.protocol) || /^data:image\//i.test(custom))
        sources.push(parsed.href);
    } catch {
      /* Invalid optional images must never prevent card rendering. */
    }
  }
  try {
    const address = bookmark.url.trim();
    const site = new URL(/^[a-z][a-z\d+.-]*:/i.test(address) ? address : `https://${address}`);
    if (['http:', 'https:'].includes(site.protocol))
      sources.push(new URL('/favicon.ico', site.origin).href);
  } catch {
    /* Imported invalid addresses still get a local avatar. */
  }
  const candidates = [...new Set(sources)];
  if (!candidates.length) return fallback();
  const img = el('img', {
    className: 'tile__icon',
    attrs: { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' },
  });
  let index = 0;
  img.addEventListener('error', () => {
    const next = candidates[++index];
    if (next) img.src = next;
    else img.replaceWith(fallback());
  });
  img.src = candidates[0]!;
  return img;
}

/** Local hostname avatars for both saved cards and their live preview. */
export function renderBookmarkMirrors(
  urls: readonly string[],
  onSelect?: (url: string) => void,
): HTMLElement {
  return el('div', {
    className: 'tile__mirrors',
    attrs: { role: 'group', 'aria-label': t('bookmarkEditor.fieldAlt') },
    children: urls.map((url) => {
      const host = hostnameOf(url);
      const label = t('bookmarks.openMirrorDirect', { host });
      const button = el('button', {
        className: 'tile__mirror-icon',
        attrs: { type: 'button', 'aria-label': label, title: label },
        children: [
          el('span', { text: initialOf(host, '↗'), attrs: { 'aria-hidden': 'true' } }),
          el('span', { className: 'tile__mirror-label', text: host }),
        ],
      });
      button.addEventListener('click', () => {
        onSelect?.(url);
      });
      if (!onSelect) button.tabIndex = -1;
      return button;
    }),
  });
}

export class BookmarksView {
  readonly element: HTMLElement;

  private readonly disposers: Array<() => void> = [];
  private readonly tileNodes: HTMLElement[] = [];
  private contextMenu: Menu | null = null;
  private arranging = false;
  private dragFrame: number | null = null;
  private pendingRender = false;
  private expandCategoryId: string | null = null;
  private dragY = 0;
  private dragX = 0;
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
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && this.arranging && !this.contextMenu) {
        event.preventDefault();
        this.setArranging(false);
      }
    };
    this.element.addEventListener('keydown', escape);
    this.disposers.push(() => this.element.removeEventListener('keydown', escape));
  }

  /** Rebuild the entire view from current store state. */
  render(): void {
    if (this.dragState) {
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;
    this.cancelDrag();
    this.closeContextMenu();
    clearChildren(this.element);
    this.element.classList.toggle('bookmarks--arranging', this.arranging);
    if (this.arranging) {
      this.element.appendChild(
        el('div', {
          className: 'bookmarks__arrange-bar',
          children: [
            el('p', { text: t('bookmarks.arrangeHelp'), attrs: { role: 'status' } }),
            btn(t('bookmarks.arrangeDone'), { onClick: () => this.setArranging(false) }),
          ],
        }),
      );
    }
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
      if (items.length === 0 && !this.arranging) {
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
    this.cancelDrag();
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
    const add = btn(t('bookmarks.addLink'), {
      className: 'button--primary',
      onClick: () => this.callbacks.onAddBookmark(),
    });
    const importButton = btn(t('common.import'), {
      onClick: () => this.callbacks.onImport(),
    });

    return el('div', {
      className: 'empty-state empty-state--guided',
      children: [
        el('h2', { className: 'empty-state__title', text: t('bookmarks.emptyTitle') }),
        el('p', { className: 'empty-state__text', text: t('bookmarks.emptyText') }),
        el('div', { className: 'empty-state__actions', children: [add, importButton] }),
      ],
    });
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
      grid.append(...items.map((b) => this.renderTile(b, isRecents)));
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
    applyBookmarkWidgetStyles(tile, bookmark);

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

    populateBookmarkContent(open, bookmark, size);

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
      if (this.arranging || longPressed) {
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
      if (this.arranging || event.pointerType === 'mouse') {
        return;
      }
      longPressed = false;
      pressTimer = setTimeout(() => {
        longPressed = true;
        this.openContextMenu(bookmark, event.clientX, event.clientY);
      }, LONG_PRESS_MS);
    });
    open.addEventListener('pointermove', clearPress);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((e) =>
      open.addEventListener(e, clearPress),
    );
    open.addEventListener('keydown', (event: KeyboardEvent) =>
      this.handleTileKeydown(event, open, bookmark),
    );

    const mirrorsContainer = bookmark.alternate_urls?.length
      ? renderBookmarkMirrors(bookmark.alternate_urls, (url) => {
          if (!this.arranging) this.callbacks.onOpenAlternate(bookmark, url);
        })
      : null;
    if (isRecents)
      mirrorsContainer?.querySelectorAll('button').forEach((button) => {
        button.tabIndex = -1;
      });

    const actionsWrapper = el('div', { className: 'tile__actions' });

    // Actions on non-recents: drag handle, cycle size
    if (!isRecents) {
      const sizeKey =
        size === 'small'
          ? 'bookmarks.sizeSmall'
          : size === 'wide'
            ? 'bookmarks.sizeWide'
            : 'bookmarks.sizeLarge';
      const cycleLabel = t('bookmarks.cycleSize', { size: t(sizeKey) });
      const cycleButton = iconBtn(
        ICON_RESIZE,
        cycleLabel,
        (event) => {
          event.stopPropagation();
          this.callbacks.onResize?.(bookmark, NEXT_CARD_SIZE[size]);
        },
        'icon-button tile__cycle-size',
        18,
      );
      cycleButton.title = cycleLabel;
      actionsWrapper.appendChild(cycleButton);
    }

    // A visible, always-present "more" affordance (G-22, G-23).
    const moreButton = iconBtn(
      ICON_MORE,
      t('common.actionsFor', { name: bookmark.title }),
      (event) => {
        event.stopPropagation();
        moreButton.focus();
        const rect = moreButton.getBoundingClientRect();
        this.openContextMenu(bookmark, rect.left, rect.bottom);
      },
      'icon-button tile__more',
      20,
    );
    moreButton.setAttribute('aria-haspopup', 'menu');
    moreButton.setAttribute('aria-expanded', 'false');
    if (isRecents) {
      moreButton.setAttribute('tabindex', '-1');
    }
    actionsWrapper.appendChild(moreButton);

    if (!isRecents) this.bindDragHandle(tile, bookmark, tile);
    tile.append(open, ...(mirrorsContainer ? [mirrorsContainer] : []), actionsWrapper);
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
      const sizes = [
        ['small', t('bookmarks.sizeSmall')],
        ['wide', t('bookmarks.sizeWide')],
        ['large', t('bookmarks.sizeLarge')],
      ] as const;
      for (let i = 0; i < sizes.length; i++) {
        const [sz, lbl] = sizes[i]!;
        items.push({
          label: lbl,
          separatorBefore: i === 0,
          onSelect: () => this.callbacks.onResize?.(bookmark, sz),
        });
      }
    }

    if (this.callbacks.onReorderBookmarks) {
      items.push({
        label: t('bookmarks.arrange'),
        separatorBefore: true,
        onSelect: () => this.setArranging(true),
      });
      const reorder = (dir: 'up' | 'down') => {
        const u = computeBookmarkMoveWithin(this.store.activeBookmarks, bookmark.id, dir);
        if (u) void this.persistMove(u);
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
              if (u) void this.persistMove(u);
            },
          });
        }
      }
    }

    items.push(
      {
        label: t('bookmarks.edit'),
        separatorBefore: true,
        onSelect: () => this.callbacks.onEdit(bookmark),
      },
      { label: t('bookmarks.share'), onSelect: () => void this.shareBookmark(bookmark) },
      {
        label: t('common.delete'),
        danger: true,
        onSelect: () => this.callbacks.onDelete(bookmark),
      },
    );

    // The shared Menu handles roving focus, arrow/Home/End/Escape keys,
    // type-ahead and viewport clamping (DESIGN.md §6.8).
    this.contextMenu = new Menu({
      label: t('common.actionsFor', { name: bookmark.title }),
      className: 'context-menu bookmark-menu',
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
      if (
        !this.arranging ||
        (e.target instanceof Element && e.target.closest('.tile__actions, .tile__mirrors'))
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture?.(e.pointerId);
      this.dragX = e.clientX;
      this.dragY = e.clientY;
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

      this.dragX = e.clientX;
      this.dragY = e.clientY;
      this.startEdgeScroll();
      this.updateDropTarget();
    });

    handle.addEventListener('pointerup', (e: PointerEvent) => {
      const state = this.dragState;
      if (!state || e.pointerId !== state.pointerId) return;
      const wasDragging = state.isDragging;
      this.cancelDrag();
      if (!wasDragging) return;

      const elUnder = document.elementFromPoint(e.clientX, e.clientY);
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

      if (this.pendingRender) this.render();
      if (updated) void this.persistMove(updated);
    });

    const cancel = (): void => {
      this.cancelDrag();
      if (this.pendingRender) this.render();
    };
    handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', () => {
      if (this.dragState) cancel();
    });
  }

  private setArranging(active: boolean): void {
    this.cancelDrag();
    this.arranging = active;
    this.render();
    const target = active
      ? this.element.querySelector<HTMLElement>('.bookmarks__arrange-bar button')
      : this.tileNodes[0];
    target?.focus();
  }

  private async persistMove(items: readonly BookmarkItem[]): Promise<void> {
    try {
      await this.callbacks.onReorderBookmarks?.(items);
      showToast(t('bookmarks.moved'));
    } catch {
      showToast(t('bookmarks.moveFailed'), {
        variant: 'error',
        action: { label: t('common.retry'), onSelect: () => void this.persistMove(items) },
      });
    }
  }

  private cancelDrag(): void {
    this.clearAutoExpandTimer();
    if (this.dragFrame !== null) cancelAnimationFrame(this.dragFrame);
    this.dragFrame = null;
    const state = this.dragState;
    this.dragState = null;
    if (state) {
      state.tile.classList.remove('is-dragging');
      if (state.tile.hasPointerCapture?.(state.pointerId)) {
        state.tile.releasePointerCapture(state.pointerId);
      }
    }
    this.clearDropIndicators();
  }

  private startEdgeScroll(): void {
    if (this.dragFrame !== null) return;
    const tick = (): void => {
      this.dragFrame = null;
      if (!this.dragState?.isDragging) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const delta = this.dragY < top + 64 ? -12 : this.dragY > bottom - 64 ? 12 : 0;
      if (delta) {
        const scroller = document.scrollingElement;
        scroller?.scrollBy?.({ top: delta });
        this.updateDropTarget();
      }
      this.dragFrame = requestAnimationFrame(tick);
    };
    this.dragFrame = requestAnimationFrame(tick);
  }

  private updateDropTarget(): void {
    if (!this.dragState) return;
    this.clearDropIndicators();
    const under = document.elementFromPoint(this.dragX, this.dragY);
    const tile = under?.closest<HTMLElement>('.tile:not(.tile--recent)');
    const section = under?.closest<HTMLElement>('.section');
    const catId = section?.dataset.categoryId;
    if (this.expandCategoryId !== catId) this.clearAutoExpandTimer();
    if (tile && tile !== this.dragState.tile) {
      const rect = tile.getBoundingClientRect();
      const after = this.dragX > rect.left + rect.width / 2;
      tile.classList.add(after ? 'is-drop-after' : 'is-drop-before');
    } else if (section) {
      section.classList.add('is-drop-target');
      if (catId && section.classList.contains('section--collapsed') && !this.autoExpandTimer) {
        this.expandCategoryId = catId;
        this.autoExpandTimer = setTimeout(() => {
          const category = this.store.sortedCategories.find((cat) => cat.id === catId);
          if (category?.collapsed) {
            this.callbacks.onToggleCategory?.(category);
            section.classList.remove('section--collapsed');
            section.querySelector('.section__header-toggle')?.setAttribute('aria-expanded', 'true');
            const grid = section.querySelector<HTMLElement>('.tile-grid');
            if (grid) {
              grid.hidden = false;
              grid.classList.remove('is-collapsed');
              grid.append(
                ...this.store
                  .getBookmarksByCategory(catId)
                  .map((item) => this.renderTile(item, false)),
              );
            }
          }
          this.autoExpandTimer = null;
        }, 600);
      }
    }
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
