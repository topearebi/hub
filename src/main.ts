/**
 * Hub application entrypoint.
 *
 * Boots the reactive store, builds the tri-pane shell (Tasks drawer, launchpad,
 * Scratchpad drawer), and wires desktop pinning plus the mobile tab bar. All
 * bookmark activations flow through the fallback engine so mirrors are used
 * automatically when a primary URL is unreachable.
 */

import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';

import { store } from './core/store';
import { resolveBookmarkUrl } from './core/fallback';
import { Omnibar } from './components/omnibar';
import { BookmarksView } from './components/bookmarks';
import { TasksDrawer } from './components/tasks';
import { NotesDrawer } from './components/notes';
import { showToast } from './components/toast';
import { el, svg } from './utils/dom';
import type { BookmarkItem } from './types/schemas';

type DrawerKey = 'tasks' | 'notes';
type ViewKey = 'bookmarks' | 'tasks' | 'notes';

/** Local inline SVG icons (no CDN). */
const ICON_SETTINGS =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z';
const ICON_TASKS = 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11';
const ICON_NOTES =
  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8';

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

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  // Hydrate RAM from IndexedDB before the first render.
  await store.init();

  /* ---- Shell ---- */
  const shell = el('div', { className: 'app-shell', attrs: { 'data-view': 'bookmarks' } });

  /* ---- Launchpad ---- */
  const brand = el('span', { className: 'brand', text: 'Hub' });

  const tasksToggle = el('button', {
    className: 'icon-button drawer-toggle',
    attrs: { type: 'button', 'aria-label': 'Toggle tasks' },
  });
  tasksToggle.appendChild(svg(ICON_TASKS));

  const notesToggle = el('button', {
    className: 'icon-button drawer-toggle',
    attrs: { type: 'button', 'aria-label': 'Toggle scratchpad' },
  });
  notesToggle.appendChild(svg(ICON_NOTES));

  const settingsButton = el('button', {
    className: 'icon-button',
    attrs: { type: 'button', 'aria-label': 'Settings' },
  });
  settingsButton.appendChild(svg(ICON_SETTINGS));
  settingsButton.addEventListener('click', () => {
    showToast('Settings arrive in a later phase.', { variant: 'info' });
  });

  const actions = el('div', {
    className: 'launchpad__actions',
    children: [tasksToggle, notesToggle, settingsButton],
  });
  const topbar = el('header', { className: 'launchpad__topbar', children: [brand, actions] });

  const omnibarHost = el('div', { className: 'launchpad__omnibar' });
  const bookmarksHost = el('div', { className: 'launchpad__bookmarks' });
  const center = el('div', {
    className: 'launchpad__center',
    children: [omnibarHost, bookmarksHost],
  });
  const launchpad = el('main', { className: 'launchpad', children: [topbar, center] });

  /* ---- Drawers ---- */
  const tasksDrawer = new TasksDrawer(store, {
    onPinToggle: () => {
      void togglePin('tasks');
    },
    onClose: () => setOpen('tasks', false),
  });
  const notesDrawer = new NotesDrawer(store, {
    onPinToggle: () => {
      void togglePin('notes');
    },
    onClose: () => setOpen('notes', false),
  });

  shell.appendChild(tasksDrawer.element);
  shell.appendChild(launchpad);
  shell.appendChild(notesDrawer.element);

  /* ---- Mobile tab bar ---- */
  const tabDefs: ReadonlyArray<{ key: ViewKey; label: string }> = [
    { key: 'bookmarks', label: 'Bookmarks' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'notes', label: 'Notes' },
  ];
  const tabButtons = new Map<ViewKey, HTMLButtonElement>();
  const mobileTabs = el('nav', { className: 'mobile-tabs', attrs: { 'aria-label': 'Primary' } });
  for (const tab of tabDefs) {
    const button = el('button', {
      className: 'mobile-tabs__button',
      text: tab.label,
      attrs: { type: 'button' },
    });
    button.addEventListener('click', () => setView(tab.key));
    tabButtons.set(tab.key, button);
    mobileTabs.appendChild(button);
  }

  root.appendChild(shell);
  root.appendChild(mobileTabs);

  /* ---- Components ---- */
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

  /* ---- Drawer state helpers ---- */
  const openState: Record<DrawerKey, boolean> = { tasks: false, notes: false };

  function setOpen(key: DrawerKey, open: boolean): void {
    openState[key] = open;
    const drawer = key === 'tasks' ? tasksDrawer : notesDrawer;
    drawer.setOpen(open);
  }

  /** Reflect persisted pinning into the shell grid + drawer attributes. */
  function applyPinnedState(): void {
    const { tasks, notes } = store.appConfig.pinned_drawers;

    shell.classList.remove(
      'app-shell--tasks-pinned',
      'app-shell--notes-pinned',
      'app-shell--both-pinned',
    );
    if (tasks && notes) {
      shell.classList.add('app-shell--both-pinned');
    } else if (tasks) {
      shell.classList.add('app-shell--tasks-pinned');
    } else if (notes) {
      shell.classList.add('app-shell--notes-pinned');
    }

    tasksDrawer.setPinned(tasks);
    notesDrawer.setPinned(notes);

    // A pinned drawer is always visible.
    if (tasks) {
      setOpen('tasks', true);
    }
    if (notes) {
      setOpen('notes', true);
    }
  }

  async function togglePin(key: DrawerKey): Promise<void> {
    const current = store.appConfig.pinned_drawers;
    const next = {
      tasks: key === 'tasks' ? !current.tasks : current.tasks,
      notes: key === 'notes' ? !current.notes : current.notes,
    };
    await store.updateConfig({ pinned_drawers: next });
    applyPinnedState();
  }

  function setView(view: ViewKey): void {
    shell.setAttribute('data-view', view);
    for (const [key, button] of tabButtons) {
      button.classList.toggle('is-active', key === view);
    }
  }

  tasksToggle.addEventListener('click', () => setOpen('tasks', !openState.tasks));
  notesToggle.addEventListener('click', () => setOpen('notes', !openState.notes));

  /* ---- Initial render ---- */
  bookmarksView.render();
  tasksDrawer.render();
  notesDrawer.render();
  applyPinnedState();
  setView('bookmarks');

  store.subscribe('bookmarks', () => bookmarksView.render());
  store.subscribe('categories', () => bookmarksView.render());
  store.subscribe('metrics', () => bookmarksView.render());
  store.subscribe('tasks', () => tasksDrawer.render());
  store.subscribe('notes', () => notesDrawer.render());

  // Instant typing: focus the omnibar on boot.
  omnibar.focus();
}

void bootstrap();
