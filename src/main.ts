/**
 * Hub application entrypoint.
 *
 * Boots the reactive store, builds the tri-pane shell (Tasks drawer, launchpad,
 * Scratchpad drawer), wires desktop pinning plus the mobile tab bar, and starts
 * the BYOS sync engine. All bookmark activations flow through the fallback
 * engine so mirrors are used automatically when a primary URL is unreachable.
 */

import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/print.css';

import { store } from './core/store';
import { resolveBookmarkUrl } from './core/fallback';
import {
  SyncEngine,
  cullPayloadTombstones,
  fetchRemoteFile,
  hasGitHubConfig,
  parsePayload,
  putRemoteFile,
  serializePayload,
  testConnection,
} from './core/sync';
import type { SyncStatus } from './core/sync';
import { Omnibar } from './components/omnibar';
import { BookmarksView } from './components/bookmarks';
import { BookmarkEditor } from './components/bookmark-editor';
import { TasksDrawer } from './components/tasks';
import { NotesDrawer } from './components/notes';
import { maxPinnedDrawers, resolveDrawerOpen } from './components/drawer';
import { SettingsModal } from './components/settings';
import { OnboardingCard } from './components/onboarding';
import { CategoryManager } from './components/category-manager';
import { SearchEngineManager } from './components/search-engine-manager';
import { RecentlyDeleted } from './components/recently-deleted';
import { ShareTargetPrompt } from './components/share-target';
import { isLockScreenOpen, LockScreen } from './components/lock-screen';
import { Header } from './components/header';
import { Brand } from './components/brand';
import { ProfilePopover } from './components/profile-popover';
import { ProfileEditor } from './components/profile-editor';
import { showToast } from './components/toast';
import { el, svg } from './utils/dom';
import { confirmDialog, Dialog } from './utils/dialog';
import { applyDocumentLocale, t } from './utils/i18n';
import { bindVisualViewport } from './utils/viewport';
import { newId } from './utils/crypto';
import {
  draftFromShare,
  estimateStorage,
  isStoragePersisted,
  parseLaunchIntent,
  requestBackgroundSync,
  requestPersistentStorage,
  shouldShowInstallPrompt,
  updateAppBadge,
  wcoCssVars,
  wcoNarrowing,
} from './core/pwa';
import { TokenVault } from './core/token';
import { tokenKeyStore } from './core/db';
import { NotificationManager } from './core/notifications';
import { GamepadNavigator, isGamepadSupported } from './core/gamepad';
import type { GamepadAction } from './core/gamepad';
import { purgeLegacyEnvironmentCache } from './core/legacy';
import {
  isWebAuthnAvailable,
  registerAppLock,
  resolveInitialLock,
  verifyAppLock,
} from './core/lock';
import type { BookmarkItem, CategoryItem, NoteItem, ProfileItem } from './types/schemas';

type DrawerKey = 'tasks' | 'notes';
type ViewKey = 'bookmarks' | 'tasks' | 'notes';

/** The non-standard `beforeinstallprompt` event (Chromium install prompt). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** The Window Controls Overlay API surface used by the binder (DESIGN.md §3.1). */
interface WindowControlsOverlayLike extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): { x: number; y: number; width: number; height: number };
}

/** A captured `beforeinstallprompt` event, consumed on the next user action. */
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

/** Whether the app is running as an installed/standalone window. */
function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Inline 'plus' icon for the add-bookmark control (no external icons). */
const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_TAB_BOOKMARKS = 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z';
const ICON_TAB_TASKS = 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11';
const ICON_TAB_NOTES = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6';

/**
 * Activate a bookmark: record the local visit, resolve the best reachable URL
 * (primary or mirror), surface a toast when a mirror is used, then navigate the
 * current tab (PRD §5.1 navigation mandate).
 */
async function activateBookmark(bookmark: BookmarkItem): Promise<void> {
  // Metrics are best-effort: a storage failure (e.g. private mode) must never
  // block navigation, otherwise the click would silently do nothing.
  try {
    await store.recordVisit(bookmark.id);
  } catch {
    // Ignore: the visit counter is non-essential.
  }

  // Busy feedback while probing the primary URL and its mirrors (G-41).
  const dismissBusy = showToast(t('app.opening'), {
    variant: 'info',
    persistent: true,
    dismissible: false,
    dedupeKey: 'opening',
  });

  let result: Awaited<ReturnType<typeof resolveBookmarkUrl>>;
  try {
    result = await resolveBookmarkUrl(bookmark);
  } catch {
    dismissBusy();
    showToast(t('app.openFailed'), { variant: 'error' });
    return;
  }
  dismissBusy();

  if (result.usedAlternate) {
    showToast(t('app.mirrorRouted', { host: result.hostname }), {
      variant: 'warning',
    });
  }

  window.location.href = result.url;
}

/** Navigate the current tab to an arbitrary URL. */
function navigate(url: string): void {
  window.location.href = url;
}

/** Download the current local data as a JSON file (air-gapped backup). */
function exportJson(): void {
  const payload = store.getPayload();
  const blob = new Blob([serializePayload(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = el('a', { attrs: { href: url, download: 'hub-data.json' } });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  showToast(t('app.exported'), { variant: 'success' });
}

/** Import a JSON backup, previewing and confirming before replacing data (G-40). */
async function importJson(file: File): Promise<void> {
  let payload: ReturnType<typeof parsePayload>;
  try {
    const text = await file.text();
    payload = parsePayload(text);
  } catch {
    showToast(t('app.importInvalid'), { variant: 'error' });
    return;
  }

  const confirmed = await confirmDialog({
    title: t('app.replaceTitle'),
    message: t('app.replaceMessage', {
      count: payload.bookmarks.length + payload.tasks.length + payload.notes.length,
    }),
    confirmLabel: t('app.replaceConfirm'),
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  try {
    await store.applyPayload(payload);
    showToast(t('app.importComplete'), { variant: 'success' });
  } catch {
    showToast(t('app.importSaveFailed'), { variant: 'error' });
  }
}

/**
 * Ensure at least one category exists so new bookmarks have a home. The
 * auto-created category is named "Links" (user-renamable) rather than the
 * opaque legacy "Shared" (G-39, DESIGN.md §7).
 */
async function ensureDefaultCategory(): Promise<CategoryItem> {
  const existing = store.sortedCategories[0];
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const category: CategoryItem = {
    id: newId(),
    created_at: now,
    updated_at: now,
    profile_id: store.activeProfileId ?? '',
    name: 'Links',
    order: 0,
  };
  await store.upsertCategory(category);
  return category;
}

/**
 * Seed the optional, clearly-labelled sample set (DESIGN.md §7). Removing the
 * "Sample links" category removes the samples in one action; nothing is ever
 * seeded silently.
 */
async function seedSampleSet(): Promise<void> {
  const now = Date.now();
  const category: CategoryItem = {
    id: newId(),
    created_at: now,
    updated_at: now,
    profile_id: store.activeProfileId ?? '',
    name: 'Sample links',
    order: store.sortedCategories.reduce((max, c) => Math.max(max, c.order), -1) + 1,
  };
  await store.upsertCategory(category);

  const samples: ReadonlyArray<{ title: string; url: string }> = [
    { title: 'Wikipedia', url: 'https://wikipedia.org' },
    { title: 'Hacker News', url: 'https://news.ycombinator.com' },
    { title: 'GitHub', url: 'https://github.com' },
  ];
  for (const sample of samples) {
    await store.upsertBookmark({
      id: newId(),
      created_at: now,
      updated_at: now,
      profile_id: store.activeProfileId ?? '',
      title: sample.title,
      url: sample.url,
      category_id: category.id,
    });
  }
  showToast(t('app.sampleAdded'), {
    variant: 'info',
  });
}

/** Create a scratchpad note from shared or manually entered input. */
async function createNote(title: string, content: string): Promise<void> {
  const now = Date.now();
  const note: NoteItem = {
    id: newId(),
    created_at: now,
    updated_at: now,
    profile_id: store.activeProfileId ?? '',
    title: title.trim() || 'Shared note',
    content,
    color_tag: 'terracotta',
  };
  await store.upsertNote(note);
  showToast(t('app.noteSaved'), { variant: 'success' });
}

/** Render a friendly, actionable screen when startup fails (G-41). */
function renderBootstrapError(root: HTMLElement): void {
  const card = el('div', { className: 'error-boundary' });
  card.appendChild(
    el('h1', { className: 'error-boundary__title', text: t('app.startFailedTitle') }),
  );
  card.appendChild(
    el('p', {
      text: t('app.startFailedMessage'),
    }),
  );
  const retry = el('button', {
    className: 'button button--primary',
    text: t('common.retry'),
    attrs: { type: 'button' },
  });
  retry.addEventListener('click', () => window.location.reload());
  card.appendChild(retry);
  root.replaceChildren(card);
}

/**
 * Publish Window Controls Overlay geometry as `--wco-*` custom properties and
 * keep the header's graceful-narrowing state in sync (DESIGN.md §3.1). A no-op
 * when the API is absent (phones, tablets, Safari, Firefox).
 */
function bindWindowControlsOverlay(header: Header): void {
  const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike })
    .windowControlsOverlay;
  if (!wco) {
    return;
  }
  const apply = (): void => {
    if (!wco.visible) {
      return;
    }
    for (const [name, value] of Object.entries(wcoCssVars(wco.getTitlebarAreaRect()))) {
      document.documentElement.style.setProperty(name, value);
    }
    header.setWcoNarrowing(wcoNarrowing(window.innerWidth));
  };
  wco.addEventListener('geometrychange', apply);
  window.addEventListener('resize', apply);
  apply();
}

/**
 * Offer platform-specific install guidance (DESIGN.md §7). Prefers the native
 * `beforeinstallprompt` flow on Chromium; falls back to an instructions sheet
 * (iOS cannot show a native prompt).
 */
async function showInstallGuidance(): Promise<void> {
  if (deferredInstallPrompt) {
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      showToast(t('app.installing'), { variant: 'info' });
    }
    return;
  }

  const dialog = new Dialog({
    label: t('app.installHub'),
    onRequestClose: () => dialog.close(),
  });
  const title = el('h2', { className: 'modal__title', text: t('app.installHub') });
  const body = el('div', { className: 'modal__body' });
  body.appendChild(title);

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const steps = isIos
    ? [t('app.installStepIos1'), t('app.installStepIos2'), t('app.installStepIos3')]
    : [t('app.installStepOther1'), t('app.installStepOther2'), t('app.installStepOther3')];
  const list = el('ol', { className: 'install-steps' });
  for (const step of steps) {
    list.appendChild(el('li', { text: step }));
  }
  body.appendChild(list);

  const close = el('button', {
    className: 'button button--primary',
    text: t('app.gotIt'),
    attrs: { type: 'button' },
  });
  close.addEventListener('click', () => dialog.close());
  body.appendChild(el('div', { className: 'modal__actions', children: [close] }));

  dialog.content.appendChild(body);
  dialog.open();
}

/**
 * Non-intrusive install offer shown once the browser signals installability
 * (G-50). Suppressed during the cool-down after a dismissal (SCHEMAS.md §3.3).
 */
function offerInstall(): void {
  if (!deferredInstallPrompt) {
    return;
  }
  if (!shouldShowInstallPrompt(store.appConfig.install_prompt_dismissed_at, Date.now())) {
    return;
  }
  showToast(t('app.installTip'), {
    variant: 'info',
    persistent: true,
    dedupeKey: 'install-prompt',
    action: {
      label: t('app.install'),
      onSelect: () => {
        void showInstallGuidance();
      },
    },
    onDismiss: () => {
      void store.updateConfig({ install_prompt_dismissed_at: new Date().toISOString() });
    },
  });
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  // One-time cleanup of caches written by removed features (SCHEMAS.md §3.4).
  purgeLegacyEnvironmentCache();

  // Reflect the active locale on <html lang> / <html dir> (G-38).
  applyDocumentLocale();

  // Loading skeleton while IndexedDB opens (G-41).
  const skeleton = el('div', { className: 'skeleton', attrs: { 'aria-busy': 'true' } });
  skeleton.appendChild(el('span', { className: 'sr-only', text: t('app.loading') }));
  root.replaceChildren(skeleton);

  // Hydrate RAM from IndexedDB before the first render.
  try {
    await store.init();
  } catch {
    renderBootstrapError(root);
    return;
  }
  root.replaceChildren();

  /* ---- Encrypted token vault (SCHEMAS.md §3.5) ---- */
  // Decrypt the stored GitHub token into memory, migrating legacy plaintext in
  // place. The ciphertext envelope is what lives in `github_pat`.
  const tokenVault = new TokenVault({ keyStore: tokenKeyStore });
  const tokenInit = await tokenVault.init(store.appConfig.github_pat);
  if (tokenInit.migratedEnvelope) {
    await store.updateConfig({ github_pat: tokenInit.migratedEnvelope });
  }
  if (
    tokenInit.status === 'needs-reentry' &&
    store.appConfig.sync_enabled &&
    Boolean(store.appConfig.github_owner)
  ) {
    // The key record is missing/undecryptable (G-55): treat sync as "not
    // configured" and ask the user to re-enter the token. No data is lost.
    showToast(t('app.tokenReentry'), {
      variant: 'warning',
      persistent: true,
      dedupeKey: 'token-reentry',
    });
  }

  /* ---- Standalone detection (back/home affordance — DESIGN.md §3) ---- */
  if (isStandaloneDisplay()) {
    document.documentElement.classList.add('is-standalone');
  }

  /* ---- Request durable storage so IndexedDB is not evicted (G-52) ---- */
  void (async () => {
    const persisted = await isStoragePersisted();
    if (persisted) {
      if (!store.appConfig.storage_persisted) {
        await store.updateConfig({ storage_persisted: true });
      }
      return;
    }
    const granted = await requestPersistentStorage();
    if (granted) {
      await store.updateConfig({ storage_persisted: true });
    }
  })();

  /* ---- Shell ---- */
  const shell = el('div', { className: 'app-shell', attrs: { 'data-view': 'bookmarks' } });

  /* ---- System header (status chip + profile controls) ---- */
  const header = new Header({
    onToggleTasks: () => setOpen('tasks', !openState.tasks),
    onToggleNotes: () => setOpen('notes', !openState.notes),
    onOpenProfile: (anchor) => profilePopover.toggle(anchor),
    onOpenSync: () => settings.open(),
    onHome: () => {
      setView('bookmarks');
      const isBase =
        window.location.pathname === import.meta.env.BASE_URL ||
        window.location.pathname === '/' ||
        window.location.href === new URL(import.meta.env.BASE_URL, window.location.origin).href;
      if (!isBase) {
        navigate(import.meta.env.BASE_URL);
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
  });
  bindWindowControlsOverlay(header);

  /* ---- Centered brand + launchpad ---- */
  const brand = new Brand();

  const omnibarHost = el('div', { className: 'launchpad__omnibar' });
  const bookmarksHost = el('div', { className: 'launchpad__bookmarks' });
  const center = el('div', {
    className: 'launchpad__center',
    children: [brand.element, omnibarHost, bookmarksHost],
  });
  const launchpad = el('main', { className: 'launchpad', children: [header.element, center] });

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

  // Scrim behind overlay drawers on tablet+ (G-09). Inserted before the drawers
  // so it shares their z-index but paints underneath them.
  const drawerScrim = el('div', { className: 'drawer-scrim' });
  shell.appendChild(drawerScrim);
  shell.appendChild(tasksDrawer.element);
  shell.appendChild(launchpad);
  shell.appendChild(notesDrawer.element);

  /* ---- Mobile tab bar (icon + label + open-task count) ---- */
  const tabDefs: ReadonlyArray<{ key: ViewKey; label: string; icon: string }> = [
    { key: 'tasks', label: t('app.tabTasks'), icon: ICON_TAB_TASKS },
    { key: 'bookmarks', label: t('app.tabBookmarks'), icon: ICON_TAB_BOOKMARKS },
    { key: 'notes', label: t('app.tabNotes'), icon: ICON_TAB_NOTES },
  ];
  const tabButtons = new Map<ViewKey, HTMLButtonElement>();
  const tabCounts = new Map<ViewKey, HTMLElement>();
  const mobileTabs = el('nav', {
    className: 'mobile-tabs',
    attrs: { 'aria-label': t('app.primaryNav') },
  });
  for (const tab of tabDefs) {
    const button = el('button', {
      className: 'mobile-tabs__button',
      attrs: { type: 'button' },
    });
    button.appendChild(svg(tab.icon, { className: 'mobile-tabs__icon', size: 20 }));
    button.appendChild(el('span', { className: 'mobile-tabs__label', text: tab.label }));
    if (tab.key === 'tasks') {
      const count = el('span', { className: 'mobile-tabs__count', text: '0' });
      count.hidden = true;
      button.appendChild(count);
      tabCounts.set('tasks', count);
    }
    button.addEventListener('click', () => setView(tab.key));
    tabButtons.set(tab.key, button);
    mobileTabs.appendChild(button);
  }

  root.appendChild(
    el('a', { className: 'skip-link', text: t('app.skipToContent'), attrs: { href: '#main' } }),
  );
  root.appendChild(shell);
  root.appendChild(mobileTabs);

  /* ---- Components ---- */
  const omnibar = new Omnibar(store, {
    onActivateBookmark: (bookmark) => {
      void activateBookmark(bookmark);
    },
    onNavigate: navigate,
    onAddBookmark: (url) => {
      void openBookmarkEditor(undefined, { url });
    },
    onSelectEngine: (providerId) => {
      const current = store.activeProfile;
      if (current) {
        void store.upsertProfile({
          ...current,
          default_search_provider_id: providerId,
          updated_at: Date.now(),
        });
      }
    },
    onManageEngines: () => searchEngineManager.open(),
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
    onEdit: (bookmark) => {
      void openBookmarkEditor(bookmark);
    },
    onDelete: (bookmark) => {
      void deleteBookmark(bookmark);
    },
    onAddBookmark: () => {
      void openBookmarkEditor();
    },
    onImport: () => settings.triggerImport(),
    onManageCategories: () => categoryManager.open(),
    onResize: async (bookmark, size) => {
      const updated: BookmarkItem = {
        ...bookmark,
        updated_at: Date.now(),
      };
      if (size !== 'small') {
        updated.card_size = size;
      } else {
        delete updated.card_size;
      }
      await store.upsertBookmark(updated);
    },
    onToggleCategory: async (category) => {
      await store.upsertCategory({
        ...category,
        collapsed: !category.collapsed,
        updated_at: Date.now(),
      });
    },
  });
  bookmarksHost.appendChild(bookmarksView.element);

  /* ---- Bookmark editor + add-bookmark control ---- */
  const bookmarkEditor = new BookmarkEditor(store, {
    onSave: async (bookmark) => {
      await store.upsertBookmark(bookmark);
      showToast(t('app.bookmarkSaved'), { variant: 'success' });
    },
    onDelete: (id) => {
      const bookmark = store.getBookmark(id);
      if (bookmark) {
        void deleteBookmark(bookmark);
      }
    },
    onCreateCategory: async (name) => {
      // New categories land at the end of the ordered list.
      const order = store.sortedCategories.reduce((max, c) => Math.max(max, c.order), -1) + 1;
      const now = Date.now();
      const category: CategoryItem = {
        id: newId(),
        created_at: now,
        updated_at: now,
        profile_id: store.activeProfileId ?? '',
        name,
        order,
      };
      await store.upsertCategory(category);
      return category;
    },
  });
  document.body.appendChild(bookmarkEditor.element);

  const addBookmarkButton = el('button', {
    className: 'button launchpad__add-bookmark',
    attrs: { type: 'button', 'aria-label': t('app.addBookmark') },
  });
  addBookmarkButton.appendChild(svg(ICON_PLUS, { size: 16 }));
  addBookmarkButton.appendChild(el('span', { text: t('app.addBookmark') }));
  addBookmarkButton.addEventListener('click', () => {
    void openBookmarkEditor();
  });
  bookmarksHost.insertBefore(
    el('div', { className: 'launchpad__bookmarks-actions', children: [addBookmarkButton] }),
    bookmarksView.element,
  );

  /* ---- First-run onboarding card (G-39, DESIGN.md §7) ---- */
  const onboarding = new OnboardingCard({
    onAddBookmark: () => {
      void openBookmarkEditor();
    },
    onImport: () => settings.triggerImport(),
    onConnectSync: () => settings.open(),
    onTrySample: () => {
      void seedSampleSet();
    },
    onInstall: () => {
      void showInstallGuidance();
    },
    onComplete: () => {
      void store.updateConfig({ onboarding_completed: true });
    },
  });
  bookmarksHost.insertBefore(onboarding.element, bookmarksHost.firstChild);

  /** Show the welcome card only on a fresh, empty install (G-39). */
  function updateOnboarding(): void {
    const show = !store.appConfig.onboarding_completed && store.activeBookmarks.length === 0;
    if (show) {
      onboarding.show();
    } else {
      onboarding.hide();
    }
  }

  /** Open the bookmark editor, ensuring a category exists for new bookmarks. */
  async function openBookmarkEditor(
    bookmark?: BookmarkItem,
    prefill?: { url?: string; title?: string },
  ): Promise<void> {
    if (!bookmark && store.sortedCategories.length === 0) {
      await ensureDefaultCategory();
    }
    bookmarkEditor.open(bookmark, prefill);
  }

  /** Confirm and soft-delete a bookmark. */
  async function deleteBookmark(bookmark: BookmarkItem): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('app.deleteBookmarkTitle'),
      message: t('app.deleteBookmarkMessage', { title: bookmark.title }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    await store.softDeleteBookmark(bookmark.id);
    showToast(t('app.bookmarkDeleted'), {
      variant: 'info',
      action: {
        label: t('common.undo'),
        onSelect: () => {
          void store.restoreBookmark(bookmark.id);
        },
      },
    });
  }

  /* ---- Share target prompt (shared text -> bookmark or note) ---- */
  const sharePrompt = new ShareTargetPrompt({
    onCreateNote: (draft) => createNote(draft.title, draft.content),
    onDismiss: () => undefined,
  });
  document.body.appendChild(sharePrompt.element);

  /* ---- App lock overlay (revealed only when locking is active) ---- */
  const lockScreen = new LockScreen({
    verify: () => verifyAppLock(store.appConfig.app_lock_credential_id ?? ''),
    onUnlocked: () => undefined,
  });
  document.body.appendChild(lockScreen.element);

  /* ---- Sync engine ---- */
  let suppressSync = false;
  let lastSyncStatus: SyncStatus = 'idle';

  function updateSyncStatus(status: SyncStatus): void {
    lastSyncStatus = status;
    // Offline takes precedence over the sync state in the status chip (G-44).
    if (!navigator.onLine) {
      header.setStatusState('offline');
    } else {
      header.setSyncStatus(status);
    }
    if (status === 'error') {
      showToast(t('app.syncFailed'), { variant: 'error' });
      // Ask the browser to retry when connectivity returns (G-53). A no-op
      // where Background Sync is unsupported (iOS Safari, Firefox).
      void requestBackgroundSync();
    }
  }

  /** Reflect connectivity in the status chip (G-44). */
  function updateOnlineStatus(): void {
    if (!navigator.onLine) {
      header.setStatusState('offline');
    } else {
      header.setSyncStatus(lastSyncStatus);
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  const syncEngine = new SyncEngine({
    getConfig: () => store.appConfig,
    getPayload: () => store.getPayload(),
    // The stored `github_pat` is an `enc1:` envelope; the vault holds the
    // decrypted token in memory only (SCHEMAS.md §3.5).
    getToken: () => tokenVault.token,
    applyRemote: async (payload) => {
      // Applying remote data emits collection events; suppress the resulting
      // debounced push to avoid a redundant commit loop.
      suppressSync = true;
      try {
        await store.applyPayload(payload);
      } finally {
        suppressSync = false;
      }
    },
    onStatus: updateSyncStatus,
    onSha: (sha) => {
      void store.updateConfig({ github_last_sha: sha });
    },
  });

  // Background Sync wake-up (G-53): the service worker relays the browser's
  // retry after a failed push while offline, and the page runs the sync.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if ((event.data as { type?: string } | null)?.type === 'HUB_BACKGROUND_SYNC') {
        void syncEngine.pullNow();
      }
    });
  }

  // Pull remote data on boot when sync is enabled, so a normal load shows the
  // latest data without requiring a manual refresh.
  if (store.appConfig.sync_enabled && hasGitHubConfig(store.appConfig, tokenVault.token)) {
    void syncEngine.pullNow();
  }

  /* ---- Settings modal ---- */
  const settings = new SettingsModal(store, {
    onClose: () => undefined,
    onExport: exportJson,
    onImport: (file) => {
      void importJson(file);
    },
    onTestConnection: (config) => testConnection(config),
    onCheckFile: async (config) => (await fetchRemoteFile(config)) !== null,
    onInitialize: async (config) => {
      const content = serializePayload(cullPayloadTombstones(store.getPayload()));
      const sha = await putRemoteFile(config, content, undefined, 'chore(hub): initialize data');
      await store.updateConfig({ github_last_sha: sha });
    },
    onRegisterLock: async () => {
      const credentialId = await registerAppLock('hub-user');
      if (!credentialId) {
        showToast(t('app.lockRegisterFailed'), { variant: 'warning' });
        return;
      }
      await store.updateConfig({ app_lock_enabled: true, app_lock_credential_id: credentialId });
      showToast(t('app.lockEnabled'), { variant: 'success' });
    },
    onDisableLock: async () => {
      await store.updateConfig({ app_lock_enabled: false, app_lock_credential_id: '' });
      showToast(t('app.lockDisabled'), { variant: 'info' });
    },
    /** Encrypt a newly entered token before it is persisted (SCHEMAS.md §3.5). */
    encryptToken: (plaintext) => tokenVault.setToken(plaintext),
    onSaved: () => {
      void syncEngine.pullNow();
      applyFeatureToggles();
    },
    onSyncNow: () => {
      void syncEngine.pullNow();
    },
    onOpenRecentlyDeleted: () => recentlyDeleted.open(),
    onOpenCategories: () => categoryManager.open(),
    onManageSearchEngines: () => searchEngineManager.open(),
    onInstall: () => {
      void showInstallGuidance();
    },
    onRequestPersist: async () => {
      const granted = await requestPersistentStorage();
      await store.updateConfig({ storage_persisted: granted });
    },
    onRefreshStorage: async () => {
      const persisted = await isStoragePersisted();
      if (persisted !== Boolean(store.appConfig.storage_persisted)) {
        await store.updateConfig({ storage_persisted: persisted });
      }
      return estimateStorage();
    },
  });
  document.body.appendChild(settings.element);

  /* ---- Category manager (G-39) ---- */
  const categoryManager = new CategoryManager(store, {
    onClose: () => undefined,
    onChanged: () => bookmarksView.render(),
  });
  document.body.appendChild(categoryManager.element);

  /* ---- Search engine manager ---- */
  const searchEngineManager = new SearchEngineManager(store, {
    onClose: () => undefined,
    onChanged: () => {
      omnibar.renderEngine();
    },
  });
  document.body.appendChild(searchEngineManager.element);

  /* ---- Recently deleted (G-40, DESIGN.md §9.1) ---- */
  const recentlyDeleted = new RecentlyDeleted(store, {
    onClose: () => undefined,
    onChanged: () => {
      bookmarksView.render();
      tasksDrawer.render();
      notesDrawer.render();
      applyProfile();
    },
  });
  document.body.appendChild(recentlyDeleted.element);

  /* ---- Profile popover + editor ---- */
  const profilePopover = new ProfilePopover(store, {
    onSwitch: (id) => {
      void switchProfile(id);
    },
    onAdd: () => {
      void addProfile();
    },
    onEditProfile: () => profileEditor.open(),
    onOpenSettings: () => settings.open(),
  });
  document.body.appendChild(profilePopover.element);

  const profileEditor = new ProfileEditor(store, {
    onSave: async (patch) => {
      const current = store.activeProfile;
      if (!current) {
        return;
      }
      await store.upsertProfile({ ...current, ...patch, updated_at: Date.now() });
      applyProfile();
    },
    onDelete: async () => {
      const current = store.activeProfile;
      if (!current) {
        return;
      }
      // Guard: never delete the last live profile (G-40).
      const live = store.profiles.filter((profile) => profile.is_deleted !== true);
      if (live.length <= 1) {
        showToast(t('app.needsOneProfile'), { variant: 'warning' });
        return;
      }
      const counts = {
        bookmarks: store.activeBookmarks.length,
        tasks: store.activeTasks.length,
        notes: store.activeNotes.length,
      };
      const confirmed = await confirmDialog({
        title: t('app.deleteProfileTitle'),
        message: t('app.deleteProfileMessage', {
          name: current.name,
          count: counts.bookmarks + counts.tasks + counts.notes,
        }),
        confirmLabel: t('app.deleteProfileConfirm'),
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      await store.softDeleteProfile(current.id);
      applyProfile();
      showToast(t('app.profileDeleted', { name: current.name }), {
        variant: 'info',
        action: {
          label: t('common.undo'),
          onSelect: () => {
            void store.restoreProfile(current.id).then(() => applyProfile());
          },
        },
      });
    },
  });
  document.body.appendChild(profileEditor.element);

  /* ---- Drawer state helpers ---- */
  const openState: Record<DrawerKey, boolean> = { tasks: false, notes: false };

  /** Whether a drawer is currently pinned (lives in the grid flow). */
  function isPinned(key: DrawerKey): boolean {
    const pinned = store.appConfig.pinned_drawers;
    return key === 'tasks' ? pinned.tasks : pinned.notes;
  }

  /** Show the scrim only while an unpinned (overlay) drawer is open (G-09). */
  function updateScrim(): void {
    const anyOpen =
      (openState.tasks && !isPinned('tasks')) || (openState.notes && !isPinned('notes'));
    drawerScrim.classList.toggle('is-open', anyOpen);
  }

  function setOpen(key: DrawerKey, open: boolean): void {
    openState[key] = open;
    const drawer = key === 'tasks' ? tasksDrawer : notesDrawer;
    drawer.setOpen(open);
    header.setDrawerExpanded(key, open);
    updateScrim();
  }

  // Tapping the scrim closes the open overlay drawer(s).
  drawerScrim.addEventListener('click', () => {
    if (openState.tasks && !isPinned('tasks')) {
      setOpen('tasks', false);
    }
    if (openState.notes && !isPinned('notes')) {
      setOpen('notes', false);
    }
  });

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

    // Capture the previous pin flags before overwriting the drawer attributes
    // so the pinned -> unpinned transition can be detected. Without this, an
    // unpinned drawer would remain `data-open="true"` and linger as a fixed
    // off-canvas overlay instead of collapsing to the minimal layout.
    const wasTasksPinned = tasksDrawer.element.getAttribute('data-pinned') === 'true';
    const wasNotesPinned = notesDrawer.element.getAttribute('data-pinned') === 'true';

    tasksDrawer.setPinned(tasks);
    notesDrawer.setPinned(notes);

    setOpen('tasks', resolveDrawerOpen(tasks, wasTasksPinned, openState.tasks));
    setOpen('notes', resolveDrawerOpen(notes, wasNotesPinned, openState.notes));
  }

  async function togglePin(key: DrawerKey): Promise<void> {
    const current = store.appConfig.pinned_drawers;
    const next = {
      tasks: key === 'tasks' ? !current.tasks : current.tasks,
      notes: key === 'notes' ? !current.notes : current.notes,
    };
    // Enforce the per-tier pin limit (DESIGN.md §3): pinning a second drawer on
    // a laptop unpins the other so only one stays pinned.
    const limit = maxPinnedDrawers(window.innerWidth);
    const pinnedCount = (next.tasks ? 1 : 0) + (next.notes ? 1 : 0);
    if (limit === 0) {
      next.tasks = false;
      next.notes = false;
    } else if (pinnedCount > limit) {
      if (key === 'tasks') {
        next.notes = false;
      } else {
        next.tasks = false;
      }
    }
    await store.updateConfig({ pinned_drawers: next });
    applyPinnedState();
  }

  /** Drop pins that exceed the current tier's limit after a resize. */
  function reconcilePins(): void {
    const limit = maxPinnedDrawers(window.innerWidth);
    const current = store.appConfig.pinned_drawers;
    const count = (current.tasks ? 1 : 0) + (current.notes ? 1 : 0);
    if (count <= limit) {
      return;
    }
    const next = {
      tasks: limit >= 1 ? current.tasks : false,
      notes: limit >= 2 ? current.notes : false,
    };
    void store.updateConfig({ pinned_drawers: next }).then(() => applyPinnedState());
  }
  window.addEventListener('resize', reconcilePins);

  function setView(view: ViewKey): void {
    shell.setAttribute('data-view', view);
    for (const [key, button] of tabButtons) {
      const active = key === view;
      button.classList.toggle('is-active', active);
      if (active) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }
  }

  /** Reflect the open-task count on the Tasks tab (hidden when zero). */
  function updateTabCounts(): void {
    const count = tabCounts.get('tasks');
    if (!count) {
      return;
    }
    const open = store.activeTasks.length;
    count.textContent = String(open);
    count.hidden = open === 0;
  }

  /* ---- Profile / theme helpers ---- */
  function applyTheme(theme: 'auto' | 'light' | 'dark'): void {
    document.documentElement.setAttribute('data-theme', theme);
    // Keep the browser-chrome `theme-color` in sync with the effective theme
    // (DESIGN.md §3.1, §10), so the installed title bar matches the in-app UI.
    const effective =
      theme === 'auto'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    const color = effective === 'dark' ? '#181716' : '#faf7f2';
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', color);
    }
  }

  /** Apply the active profile's branding, theme, and engine to the UI. */
  function applyProfile(): void {
    const profile = store.activeProfile;
    brand.render(profile);
    header.renderProfile(profile);
    omnibar.renderEngine();
    applyTheme(profile?.theme ?? store.appConfig.theme);
  }

  async function switchProfile(id: string): Promise<void> {
    await store.setActiveProfile(id);
    applyProfile();
  }

  async function addProfile(): Promise<void> {
    const now = Date.now();
    const profile: ProfileItem = {
      id: newId(),
      created_at: now,
      updated_at: now,
      name: t('app.defaultProfileName', { n: store.profiles.length + 1 }),
      hub_title: t('common.hub'),
    };
    await store.upsertProfile(profile);
    await store.setActiveProfile(profile.id);
    applyProfile();
    profileEditor.open();
  }

  /* ---- Initial render ---- */
  bookmarksView.render();
  tasksDrawer.render();
  notesDrawer.render();
  applyPinnedState();
  applyProfile();
  setView('bookmarks');
  updateTabCounts();
  updateOnboarding();

  store.subscribe('bookmarks', () => {
    bookmarksView.render();
    updateOnboarding();
  });
  store.subscribe('categories', () => bookmarksView.render());
  store.subscribe('metrics', () => bookmarksView.render());
  store.subscribe('tasks', () => {
    tasksDrawer.render();
    updateTabCounts();
  });
  store.subscribe('notes', () => notesDrawer.render());
  store.subscribe('profiles', () => applyProfile());
  store.subscribe('config', () => {
    updateOnboarding();
    omnibar.renderEngine();
  });

  // Debounced sync on any syncable mutation (event-driven, never polled).
  // `profiles` is included because profile branding/preferences are part of the
  // v2 sync payload; without it, profile edits would never reach the remote.
  for (const event of ['profiles', 'bookmarks', 'categories', 'tasks', 'notes'] as const) {
    store.subscribe(event, () => {
      if (!suppressSync) {
        syncEngine.schedule();
      }
    });
  }

  // Reconcile remote changes on focus / visibility (PRD §3.2 lifecycle hooks).
  window.addEventListener('focus', () => {
    void syncEngine.pullNow();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void syncEngine.pullNow();
    }
  });

  /* ---- PWA feature wiring (badge, notifications, gamepad, lock, share) ---- */

  const notifications = new NotificationManager({
    getTasks: () => store.activeTasks,
    onFire: (reminder) => {
      showToast(t('app.reminder', { title: reminder.title }), { variant: 'info' });
    },
  });

  const gamepad = new GamepadNavigator({ onAction: handleGamepadAction });

  /** Focusable elements currently visible inside the app shell. */
  function collectFocusables(): HTMLElement[] {
    const selector = 'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])';
    return Array.from(shell.querySelectorAll<HTMLElement>(selector)).filter(
      (element) => !element.hasAttribute('disabled') && element.offsetParent !== null,
    );
  }

  /** Move focus by `delta` steps through the visible focusables (wrapping). */
  function moveFocus(delta: number): void {
    const focusables = collectFocusables();
    if (focusables.length === 0) {
      return;
    }
    const current = document.activeElement as HTMLElement | null;
    const index = current ? focusables.indexOf(current) : -1;
    const next = index < 0 ? 0 : (index + delta + focusables.length) % focusables.length;
    focusables[next]?.focus();
  }

  /** Close the top-most layer (modal, drawer, or blur). */
  function closeTopLayer(): void {
    // While locked, nothing behind the overlay may be dismissed (G-29).
    if (isLockScreenOpen()) {
      return;
    }
    if (sharePrompt.element.classList.contains('is-open')) {
      sharePrompt.close();
      return;
    }
    if (searchEngineManager.isOpen()) {
      searchEngineManager.close();
      return;
    }
    if (settings.element.classList.contains('is-open')) {
      settings.close();
      return;
    }
    if (profileEditor.element.classList.contains('is-open')) {
      profileEditor.close();
      return;
    }
    if (bookmarkEditor.isOpen()) {
      bookmarkEditor.close();
      return;
    }
    if (notesDrawer.isEditorOpen()) {
      notesDrawer.closeEditor();
      return;
    }
    if (profilePopover.isVisible()) {
      profilePopover.close();
      return;
    }
    if (openState.notes) {
      setOpen('notes', false);
      return;
    }
    if (openState.tasks) {
      setOpen('tasks', false);
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur();
  }

  /** Translate a gamepad action into app navigation. */
  function handleGamepadAction(action: GamepadAction): void {
    if (isLockScreenOpen()) {
      return;
    }
    switch (action) {
      case 'omnibar':
        omnibar.focus();
        break;
      case 'toggle-tasks':
        setOpen('tasks', !openState.tasks);
        break;
      case 'toggle-notes':
        setOpen('notes', !openState.notes);
        break;
      case 'activate':
        (document.activeElement as HTMLElement | null)?.click();
        break;
      case 'back':
        closeTopLayer();
        break;
      case 'up':
      case 'left':
        moveFocus(-1);
        break;
      case 'down':
      case 'right':
        moveFocus(1);
        break;
      default:
        break;
    }
  }

  /** Apply persisted feature toggles (boot + after settings are saved). */
  function applyFeatureToggles(): void {
    if (store.appConfig.notifications_enabled && NotificationManager.isSupported()) {
      if (NotificationManager.permission() === 'granted') {
        notifications.start();
        void notifications.subscribeToPush(store.appConfig.vapid_public_key ?? '');
      } else if (NotificationManager.permission() !== 'denied') {
        void NotificationManager.requestPermission().then((permission) => {
          if (permission === 'granted') {
            notifications.start();
            void notifications.subscribeToPush(store.appConfig.vapid_public_key ?? '');
          }
        });
      }
    } else {
      notifications.stop();
    }

    if (store.appConfig.gamepad_enabled && isGamepadSupported()) {
      gamepad.start();
    } else {
      gamepad.stop();
    }

    updateAppBadge(store.activeTasks.length);
  }

  // Keep the installed-icon badge and due reminders in sync with tasks.
  store.subscribe('tasks', () => {
    updateAppBadge(store.activeTasks.length);
    if (store.appConfig.notifications_enabled) {
      void notifications.tick();
    }
  });

  applyFeatureToggles();

  // Publish the on-screen keyboard height so sheets and toasts reflow above it
  // (G-16). No-ops where the Visual Viewport API is unavailable.
  bindVisualViewport();

  // App lock: gate the UI before the user interacts.
  const lockPhase = resolveInitialLock(store.appConfig, isWebAuthnAvailable());
  if (lockPhase === 'locked') {
    lockScreen.open();
  } else if (lockPhase === 'unsupported') {
    showToast(t('app.lockUnsupported'), { variant: 'warning' });
  }

  // Launch intent: app shortcuts and the Web Share Target.
  const intent = parseLaunchIntent(window.location.search);
  if (intent.share) {
    const draft = draftFromShare(intent.share);
    // Bookmark shares open the dedicated editor; everything else is a note.
    if (draft.kind === 'bookmark') {
      void openBookmarkEditor(undefined, { url: draft.url ?? '', title: draft.title });
    } else {
      sharePrompt.open(draft);
    }
  } else if (intent.action === 'new-task') {
    setView('tasks');
    setOpen('tasks', true);
    tasksDrawer.focusInput();
  } else if (intent.action === 'new-note') {
    setView('notes');
    setOpen('notes', true);
    notesDrawer.focusInput();
  } else if (intent.action === 'new-bookmark') {
    void openBookmarkEditor();
  }
  if (intent.action !== null || intent.share !== null) {
    // Clear the launch query so a refresh does not replay the intent.
    window.history.replaceState(null, '', import.meta.env.BASE_URL);
  }

  /* ---- Install lifecycle (G-50) ---- */
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the browser's mini-infobar; Hub offers its own non-intrusive UI.
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    offerInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    showToast(t('app.installed'), {
      variant: 'success',
      dedupeKey: 'app-installed',
    });
  });

  /* ---- File handlers: JSON import via the Launch Queue API (G-47) ---- */
  interface LaunchParamsLike {
    files?: readonly FileSystemFileHandle[];
  }
  interface LaunchQueueLike {
    setConsumer(consumer: (params: LaunchParamsLike) => void): void;
  }
  const launchQueue = (window as Window & { launchQueue?: LaunchQueueLike }).launchQueue;
  if (launchQueue) {
    launchQueue.setConsumer((params) => {
      const handle = params.files?.[0];
      if (handle) {
        void handle.getFile().then((file) => importJson(file));
      }
    });
  }

  /* ---- Keyboard shortcuts overlay + non-Alt pinned shortcut (G-26) ---- */
  function showShortcuts(): void {
    const dialog = new Dialog({
      label: t('app.shortcuts'),
      onRequestClose: () => dialog.close(),
    });
    const title = el('h2', { className: 'modal__title', text: t('app.shortcuts') });
    const list = el('ul', { className: 'shortcuts-list' });
    const rows: ReadonlyArray<[string, string]> = [
      ['/', t('app.shortcutFocusSearch')],
      ['Alt+1–9 or g then 1–9', t('app.shortcutPinned')],
      ['t / m', t('app.shortcutTogglePanes')],
      ['Esc', t('app.shortcutCloseLayer')],
      ['?', t('app.shortcutShowHelp')],
    ];
    for (const [keys, description] of rows) {
      const item = el('li', { className: 'shortcuts-list__item' });
      item.appendChild(el('kbd', { className: 'shortcut-key', text: keys }));
      item.appendChild(el('span', { text: description }));
      list.appendChild(item);
    }
    dialog.content.appendChild(el('div', { className: 'modal__body', children: [title, list] }));
    dialog.open();
  }

  // `?` opens the help overlay; `g` then a digit is a modifier-free alternative
  // to `Alt + [1-9]` (which collides with browser tab shortcuts).
  let pendingG = false;
  let pendingGTimer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (isLockScreenOpen()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const editable =
      target !== null &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    if (editable || document.querySelector('.modal-overlay.is-open')) {
      return;
    }
    if (event.key === '?') {
      event.preventDefault();
      showShortcuts();
      return;
    }
    if (pendingG && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      pendingG = false;
      const bookmark = store.activeBookmarks.find((entry) => entry.hotkey === event.key);
      if (bookmark) {
        void activateBookmark(bookmark);
      }
      return;
    }
    if (event.key === 'g') {
      pendingG = true;
      if (pendingGTimer !== null) {
        clearTimeout(pendingGTimer);
      }
      pendingGTimer = setTimeout(() => {
        pendingG = false;
      }, 1500);
    }
  });

  // Instant typing: focus the omnibar on boot, unless locked or on a coarse
  // pointer (auto-focus would raise the phone keyboard — G-27).
  if (!isLockScreenOpen() && !window.matchMedia('(pointer: coarse)').matches) {
    omnibar.focus();
  }
}

/** Offer the user-controlled "Update available — Reload" flow (G-49). */
function promptUpdate(worker: ServiceWorker): void {
  showToast(t('app.updateReady'), {
    variant: 'info',
    persistent: true,
    dedupeKey: 'sw-update',
    action: {
      label: t('app.reload'),
      // Only the user's explicit action activates the new worker.
      onSelect: () => worker.postMessage({ type: 'SKIP_WAITING' }),
    },
  });
}

/**
 * Register the service worker for offline asset caching (PWA). Registration is
 * a progressive enhancement: failures are swallowed so the app still runs. A
 * new worker is never activated under a running page — the user chooses when to
 * reload (G-49).
 */
function registerServiceWorker(): void {
  // Only register in production: a dev-time service worker can serve stale
  // cached modules and mask live changes.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }

  // Reload once the newly activated worker takes control.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) {
      return;
    }
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((registration) => {
        // Immediately check for updates bypassing HTTP cache.
        void registration.update();

        // Check for updates when returning to the tab or app.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            void registration.update();
          }
        });
        window.addEventListener('focus', () => {
          void registration.update();
        });

        // If a worker is already waiting from a previous session or reload,
        // activate it so the page receives the updated bundle.
        if (registration.waiting && navigator.serviceWorker.controller) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) {
            return;
          }
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              promptUpdate(installing);
            }
          });
        });
      })
      .catch(() => {
        // Offline caching is optional; ignore registration failures.
      });
  });
}

void bootstrap();
registerServiceWorker();
