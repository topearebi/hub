/**
 * Hub application entrypoint.
 *
 * Boots the reactive store, builds the launchpad shell, and mounts the omnibar
 * and bookmark grid. All bookmark activations flow through the fallback engine
 * so mirrors are used automatically when a primary URL is unreachable.
 */

import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';

import { store } from './core/store';
import { resolveBookmarkUrl } from './core/fallback';
import { Omnibar } from './components/omnibar';
import { BookmarksView } from './components/bookmarks';
import { showToast } from './components/toast';
import { el, svg } from './utils/dom';
import type { BookmarkItem } from './types/schemas';

/** Feather-style settings gear (local inline SVG, no CDN). */
const ICON_SETTINGS =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z';

/**
 * Activate a bookmark: record the local visit, resolve the best reachable URL
 * (primary or mirror), surface a toast when a mirror is used, then navigate the
 * current tab (PRD §5.1 navigation mandate).
 */
async function activateBookmark(bookmark: BookmarkItem): Promise<void> {
  await store.recordVisit(bookmark.id);

  const result = await resolveBookmarkUrl(bookmark);
  if (result.usedAlternate) {
    showToast(`Primary URL unreachable. Routed to mirror: ${result.hostname}`, {
      variant: 'warning',
    });
  }

  window.location.href = result.url;
}

/** Navigate the current tab to an arbitrary URL. */
function navigate(url: string): void {
  window.location.href = url;
}

/** Build the static launchpad shell and return the component mount points. */
function buildShell(root: HTMLElement): { omnibarHost: HTMLElement; bookmarksHost: HTMLElement } {
  const brand = el('span', { className: 'brand', text: 'Hub' });

  const settingsButton = el('button', {
    className: 'icon-button',
    attrs: { type: 'button', 'aria-label': 'Settings' },
  });
  settingsButton.appendChild(svg(ICON_SETTINGS));
  settingsButton.addEventListener('click', () => {
    showToast('Settings arrive in a later phase.', { variant: 'info' });
  });

  const topbar = el('header', {
    className: 'launchpad__topbar',
    children: [brand, settingsButton],
  });

  const omnibarHost = el('div', { className: 'launchpad__omnibar' });
  const bookmarksHost = el('div', { className: 'launchpad__bookmarks' });
  const center = el('div', {
    className: 'launchpad__center',
    children: [omnibarHost, bookmarksHost],
  });
  const launchpad = el('main', { className: 'launchpad', children: [topbar, center] });
  const shell = el('div', { className: 'app-shell', children: [launchpad] });

  root.appendChild(shell);
  return { omnibarHost, bookmarksHost };
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  // Hydrate RAM from IndexedDB before the first render.
  await store.init();

  const { omnibarHost, bookmarksHost } = buildShell(root);

  const omnibar = new Omnibar(store, {
    onActivateBookmark: (bookmark) => {
      void activateBookmark(bookmark);
    },
    onNavigate: navigate,
  });
  omnibarHost.appendChild(omnibar.element);
  omnibar.attachGlobalHotkeys();

  const bookmarksView = new BookmarksView(store, {
    onActivate: (bookmark) => {
      void activateBookmark(bookmark);
    },
    onOpenAlternate: (_bookmark, url) => {
      navigate(url);
    },
  });
  bookmarksHost.appendChild(bookmarksView.element);
  bookmarksView.render();

  // Re-render the grid whenever the underlying collections change.
  store.subscribe('bookmarks', () => bookmarksView.render());
  store.subscribe('categories', () => bookmarksView.render());
  store.subscribe('metrics', () => bookmarksView.render());

  // Instant typing: focus the omnibar on boot.
  omnibar.focus();
}

void bootstrap();
