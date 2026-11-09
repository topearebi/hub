import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookmarksView } from '../bookmarks';
import { expectNoA11yViolations } from '../../test/axe';
import type { BookmarkItem, CategoryItem } from '../../types/schemas';

const category: CategoryItem = {
  id: 'c',
  profile_id: 'p',
  name: 'Links',
  order: 0,
  created_at: 1,
  updated_at: 1,
};
const first: BookmarkItem = {
  id: 'a',
  profile_id: 'p',
  category_id: 'c',
  title: 'Alpha',
  url: 'https://alpha.test',
  created_at: 1,
  updated_at: 1,
  order: 0,
  alternate_urls: ['https://mirror.test'],
};
const second: BookmarkItem = { ...first, id: 'b', title: 'Beta', order: 1 };
let view: BookmarksView;
function setup(items = [first, second], categories = [category]) {
  const callbacks = {
    onActivate: vi.fn(),
    onOpenAlternate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onAddBookmark: vi.fn(),
    onImport: vi.fn(),
    onManageCategories: vi.fn(),
    onReorderBookmarks: vi.fn(),
  };
  view = new BookmarksView(
    {
      activeBookmarks: items,
      sortedCategories: categories,
      getRecentBookmarks: () => [],
      getBookmarksByCategory: (id) => items.filter((item) => item.category_id === id),
    },
    callbacks,
  );
  document.body.appendChild(view.element);
  view.render();
  return callbacks;
}
function arrange() {
  view.element.querySelector<HTMLButtonElement>('.tile__more')!.click();
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (node) => node.textContent === 'Arrange bookmarks',
  );
  item!.click();
}
function pointer(target: Element, type: string, x = 10, y = 10) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y });
  target.dispatchEvent(event);
}
afterEach(() => {
  view?.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Bookmark card touch parity (G-22, G-23, G-33)', () => {
  it.each(['small', 'wide', 'large'] as const)(
    'preserves local alternate icons on %s cards alongside custom card images',
    (size) => {
      const callbacks = setup([
        { ...first, card_size: size, icon: 'https://external.test/icon.png' },
      ]);
      expect(view.element.querySelector('img')?.getAttribute('src')).toBe(
        'https://external.test/icon.png',
      );
      const mirror = view.element.querySelector<HTMLButtonElement>('.tile__mirror-icon')!;
      expect(mirror.getAttribute('aria-label')).toContain('mirror.test');
      mirror.click();
      expect(callbacks.onOpenAlternate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
        'https://mirror.test',
      );
    },
  );
  it('keeps browsing scrollable and activates normally before arranging', () => {
    const callbacks = setup();
    const open = view.element.querySelector<HTMLButtonElement>('.tile__open')!;
    pointer(open, 'pointerdown');
    pointer(open, 'pointermove', 50);
    pointer(open, 'pointerup', 50);
    expect(view.element.querySelector('.is-dragging')).toBeNull();
    open.click();
    expect(callbacks.onActivate).toHaveBeenCalledTimes(1);
  });
  it('suppresses navigation in Arrange mode and exits with Escape or Done', () => {
    const callbacks = setup();
    arrange();
    view.element.querySelector<HTMLButtonElement>('.tile__open')!.click();
    view.element.querySelector<HTMLButtonElement>('.tile__mirror-icon')!.click();
    expect(callbacks.onActivate).not.toHaveBeenCalled();
    expect(callbacks.onOpenAlternate).not.toHaveBeenCalled();
    view.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.element.classList.contains('bookmarks--arranging')).toBe(false);
    arrange();
    view.element.querySelector<HTMLButtonElement>('.bookmarks__arrange-bar button')!.click();
    expect(view.element.querySelector('.bookmarks__arrange-bar')).toBeNull();
  });
  it('drags from the card body and persists the move without activating', async () => {
    const callbacks = setup();
    arrange();
    const tiles = view.element.querySelectorAll<HTMLElement>('.tile');
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => tiles[1]),
    });
    pointer(tiles[0]!.querySelector('.tile__title')!, 'pointerdown');
    pointer(tiles[0]!, 'pointermove', 100);
    expect(tiles[0]!.classList.contains('is-dragging')).toBe(true);
    pointer(tiles[0]!, 'pointerup', 100);
    tiles[0]!.querySelector<HTMLButtonElement>('.tile__open')!.click();
    expect(callbacks.onReorderBookmarks).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'a', order: 1 })]),
    );
    expect(callbacks.onActivate).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(document.body.textContent).toContain('Bookmark moved');
  });
  it('excludes action buttons and clears drag state on cancellation', () => {
    setup();
    arrange();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
    const tile = view.element.querySelector<HTMLElement>('.tile')!;
    pointer(tile.querySelector('.tile__more')!, 'pointerdown');
    pointer(tile, 'pointermove', 100);
    expect(tile.classList.contains('is-dragging')).toBe(false);
    pointer(tile, 'pointerdown');
    pointer(tile, 'pointermove', 100);
    pointer(tile, 'pointercancel');
    expect(tile.classList.contains('is-dragging')).toBe(false);
  });
  it('shows a retry action when move persistence fails', async () => {
    const callbacks = setup();
    callbacks.onReorderBookmarks.mockImplementation(() => {
      throw new Error('storage');
    });
    view.element.querySelector<HTMLButtonElement>('.tile__more')!.click();
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((node) => node.textContent === 'Move down')!
      .click();
    await Promise.resolve();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not move bookmark',
    );
    expect(document.body.textContent).toContain('Retry');
  });
  it('reveals empty category targets and supports cross-category drops', () => {
    const callbacks = setup([first], [category, { ...category, id: 'other', name: 'Other' }]);
    arrange();
    const target = view.element.querySelector<HTMLElement>('[data-category-id="other"]')!;
    expect(target).not.toBeNull();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => target,
    });
    const tile = view.element.querySelector('.tile')!;
    pointer(tile, 'pointerdown');
    pointer(tile, 'pointermove', 100);
    pointer(tile, 'pointerup', 100);
    expect(callbacks.onReorderBookmarks).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'a', category_id: 'other' })]),
    );
  });

  it('auto-expands collapsed drop targets without losing the captured source', () => {
    vi.useFakeTimers();
    const callbacks = setup(
      [first, { ...second, category_id: 'other' }],
      [category, { ...category, id: 'other', name: 'Other', collapsed: true }],
    );
    arrange();
    const target = view.element.querySelector<HTMLElement>('[data-category-id="other"]')!;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => target,
    });
    const tile = view.element.querySelector('.tile')!;
    pointer(tile, 'pointerdown');
    pointer(tile, 'pointermove', 100);
    vi.advanceTimersByTime(601);
    expect(target.querySelector<HTMLElement>('.tile-grid')!.hidden).toBe(false);
    expect(tile.classList.contains('is-dragging')).toBe(true);
    pointer(tile, 'pointerup', 100);
    expect(callbacks.onReorderBookmarks).toHaveBeenCalled();
  });

  it('scrolls near the viewport edge and stops its animation on cancellation', () => {
    setup();
    arrange();
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
    );
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const scroll = vi.fn();
    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      value: { scrollBy: scroll },
    });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
    const tile = view.element.querySelector('.tile')!;
    pointer(tile, 'pointerdown');
    pointer(tile, 'pointermove', 100, window.innerHeight - 1);
    frame!(0);
    expect(scroll).toHaveBeenCalledWith({ top: 12 });
    pointer(tile, 'pointercancel');
    expect(cancel).toHaveBeenCalled();
  });
  it('keeps Arrange and alternate-link controls accessible', async () => {
    setup();
    arrange();
    await expectNoA11yViolations(view.element);
  });
});
