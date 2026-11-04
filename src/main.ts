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
import { resolveDrawerOpen } from './components/drawer';
import { SettingsModal } from './components/settings';
import { OnboardingCard } from './components/onboarding';
import { CategoryManager } from './components/category-manager';
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
import { newId } from './utils/crypto';
import { draftFromShare, parseLaunchIntent, updateAppBadge } from './core/pwa';
import { NotificationManager } from './core/notifications';
import { GamepadNavigator, isGamepadSupported } from './core/gamepad';
import type { GamepadAction } from './core/gamepad';
import { TelemetryService } from './core/telemetry';
import {
  isWebAuthnAvailable,
  registerAppLock,
  resolveInitialLock,
  verifyAppLock,
} from './core/lock';
import type { BookmarkItem, CategoryItem, NoteItem, ProfileItem } from './types/schemas';

type DrawerKey = 'tasks' | 'notes';
type ViewKey = 'bookmarks' | 'tasks' | 'notes';

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
  const dismissBusy = showToast('Opening…', {
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
    showToast('Could not open that bookmark.', { variant: 'error' });
    return;
  }
  dismissBusy();

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

  showToast('Exported hub-data.json.', { variant: 'success' });
}

/** Import a JSON backup, previewing and confirming before replacing data (G-40). */
async function importJson(file: File): Promise<void> {
  let payload: ReturnType<typeof parsePayload>;
  try {
    const text = await file.text();
    payload = parsePayload(text);
  } catch {
    showToast('Import failed: invalid file.', { variant: 'error' });
    return;
  }

  const confirmed = await confirmDialog({
    title: 'Replace local data?',
    message:
      `This import contains ${payload.bookmarks.length} bookmarks, ` +
      `${payload.tasks.length} tasks and ${payload.notes.length} notes. ` +
      'It will replace your current local data.',
    confirmLabel: 'Replace data',
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  try {
    await store.applyPayload(payload);
    showToast('Import complete.', { variant: 'success' });
  } catch {
    showToast('Import failed while saving.', { variant: 'error' });
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
  showToast('Sample links added. Remove the “Sample links” category to clear them.', {
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
  showToast('Note saved.', { variant: 'success' });
}

/** Render a friendly, actionable screen when startup fails (G-41). */
function renderBootstrapError(root: HTMLElement): void {
  const card = el('div', { className: 'error-boundary' });
  card.appendChild(el('h1', { className: 'error-boundary__title', text: 'Hub could not start' }));
  card.appendChild(
    el('p', {
      text:
        'Your browser blocked local storage. Private browsing or a disabled IndexedDB can ' +
        'cause this. Your data has not been changed.',
    }),
  );
  const retry = el('button', {
    className: 'button button--primary',
    text: 'Retry',
    attrs: { type: 'button' },
  });
  retry.addEventListener('click', () => window.location.reload());
  card.appendChild(retry);
  root.replaceChildren(card);
}

/** Show platform-specific install guidance (DESIGN.md §7). */
function showInstallGuidance(): void {
  const dialog = new Dialog({
    label: 'Install Hub',
    onRequestClose: () => dialog.close(),
  });
  const title = el('h2', { className: 'modal__title', text: 'Install Hub' });
  const body = el('div', { className: 'modal__body' });
  body.appendChild(title);

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const steps = isIos
    ? ['Tap the Share button in Safari.', 'Choose “Add to Home Screen”.', 'Tap “Add”.']
    : [
        'Open your browser menu.',
        'Choose “Install app” or “Add to Home screen”.',
        'Confirm to install.',
      ];
  const list = el('ol', { className: 'install-steps' });
  for (const step of steps) {
    list.appendChild(el('li', { text: step }));
  }
  body.appendChild(list);

  const close = el('button', {
    className: 'button button--primary',
    text: 'Got it',
    attrs: { type: 'button' },
  });
  close.addEventListener('click', () => dialog.close());
  body.appendChild(el('div', { className: 'modal__actions', children: [close] }));

  dialog.content.appendChild(body);
  dialog.open();
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  // Loading skeleton while IndexedDB opens (G-41).
  const skeleton = el('div', { className: 'skeleton', attrs: { 'aria-busy': 'true' } });
  skeleton.appendChild(el('span', { className: 'sr-only', text: 'Loading your data' }));
  root.replaceChildren(skeleton);

  // Hydrate RAM from IndexedDB before the first render.
  try {
    await store.init();
  } catch {
    renderBootstrapError(root);
    return;
  }
  root.replaceChildren();

  /* ---- Shell ---- */
  const shell = el('div', { className: 'app-shell', attrs: { 'data-view': 'bookmarks' } });

  /* ---- System header (telemetry + profile controls) ---- */
  const header = new Header({
    onToggleTasks: () => setOpen('tasks', !openState.tasks),
    onToggleNotes: () => setOpen('notes', !openState.notes),
    onOpenProfile: (anchor) => profilePopover.toggle(anchor),
    onOpenSync: () => settings.open(),
  });

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

  shell.appendChild(tasksDrawer.element);
  shell.appendChild(launchpad);
  shell.appendChild(notesDrawer.element);

  /* ---- Mobile tab bar (icon + label + open-task count) ---- */
  const tabDefs: ReadonlyArray<{ key: ViewKey; label: string; icon: string }> = [
    { key: 'bookmarks', label: 'Bookmarks', icon: ICON_TAB_BOOKMARKS },
    { key: 'tasks', label: 'Tasks', icon: ICON_TAB_TASKS },
    { key: 'notes', label: 'Notes', icon: ICON_TAB_NOTES },
  ];
  const tabButtons = new Map<ViewKey, HTMLButtonElement>();
  const tabCounts = new Map<ViewKey, HTMLElement>();
  const mobileTabs = el('nav', { className: 'mobile-tabs', attrs: { 'aria-label': 'Primary' } });
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
    el('a', { className: 'skip-link', text: 'Skip to content', attrs: { href: '#main' } }),
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
  });
  bookmarksHost.appendChild(bookmarksView.element);

  /* ---- Bookmark editor + add-bookmark control ---- */
  const bookmarkEditor = new BookmarkEditor(store, {
    onSave: async (bookmark) => {
      await store.upsertBookmark(bookmark);
      showToast('Bookmark saved.', { variant: 'success' });
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
    attrs: { type: 'button', 'aria-label': 'Add bookmark' },
  });
  addBookmarkButton.appendChild(svg(ICON_PLUS, { size: 16 }));
  addBookmarkButton.appendChild(el('span', { text: 'Add bookmark' }));
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
    onInstall: () => showInstallGuidance(),
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
      title: 'Delete bookmark?',
      message: `Delete "${bookmark.title}"?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    await store.softDeleteBookmark(bookmark.id);
    showToast('Bookmark deleted.', {
      variant: 'info',
      action: {
        label: 'Undo',
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
      showToast('Sync failed. Check your GitHub settings.', { variant: 'error' });
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

  // Pull remote data on boot when sync is enabled, so a normal load shows the
  // latest data without requiring a manual refresh.
  if (store.appConfig.sync_enabled && hasGitHubConfig(store.appConfig)) {
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
        showToast('App lock could not be registered on this device.', { variant: 'warning' });
        return;
      }
      await store.updateConfig({ app_lock_enabled: true, app_lock_credential_id: credentialId });
      showToast('App lock enabled.', { variant: 'success' });
    },
    onDisableLock: async () => {
      await store.updateConfig({ app_lock_enabled: false, app_lock_credential_id: '' });
      showToast('App lock disabled.', { variant: 'info' });
    },
    onSaved: () => {
      void syncEngine.pullNow();
      applyFeatureToggles();
    },
    onSyncNow: () => {
      void syncEngine.pullNow();
    },
    onOpenRecentlyDeleted: () => recentlyDeleted.open(),
    onOpenCategories: () => categoryManager.open(),
    onInstall: () => showInstallGuidance(),
  });
  document.body.appendChild(settings.element);

  /* ---- Category manager (G-39) ---- */
  const categoryManager = new CategoryManager(store, {
    onClose: () => undefined,
    onChanged: () => bookmarksView.render(),
  });
  document.body.appendChild(categoryManager.element);

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
        showToast('Hub needs at least one profile.', { variant: 'warning' });
        return;
      }
      const counts = {
        bookmarks: store.activeBookmarks.length,
        tasks: store.activeTasks.length,
        notes: store.activeNotes.length,
      };
      const confirmed = await confirmDialog({
        title: 'Delete profile?',
        message:
          `Delete profile “${current.name}”? Its ${counts.bookmarks} links, ` +
          `${counts.tasks} tasks and ${counts.notes} notes will be removed. ` +
          'You can restore it from Settings → Data → Recently deleted for 30 days.',
        confirmLabel: 'Delete profile',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      await store.softDeleteProfile(current.id);
      applyProfile();
      showToast(`Profile “${current.name}” deleted.`, {
        variant: 'info',
        action: {
          label: 'Undo',
          onSelect: () => {
            void store.restoreProfile(current.id).then(() => applyProfile());
          },
        },
      });
    },
  });
  document.body.appendChild(profileEditor.element);

  /* ---- Environment telemetry (non-blocking) ---- */
  const telemetry = new TelemetryService();

  /* ---- Drawer state helpers ---- */
  const openState: Record<DrawerKey, boolean> = { tasks: false, notes: false };

  function setOpen(key: DrawerKey, open: boolean): void {
    openState[key] = open;
    const drawer = key === 'tasks' ? tasksDrawer : notesDrawer;
    drawer.setOpen(open);
    header.setDrawerExpanded(key, open);
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
    await store.updateConfig({ pinned_drawers: next });
    applyPinnedState();
  }

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
      name: `Profile ${store.profiles.length + 1}`,
      hub_title: 'Hub',
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
  store.subscribe('config', () => updateOnboarding());

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
      showToast(`Reminder: ${reminder.title}`, { variant: 'info' });
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

  // App lock: gate the UI before the user interacts.
  const lockPhase = resolveInitialLock(store.appConfig, isWebAuthnAvailable());
  if (lockPhase === 'locked') {
    lockScreen.open();
  } else if (lockPhase === 'unsupported') {
    showToast('App lock is on, but this device has no WebAuthn support.', { variant: 'warning' });
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

  /* ---- Keyboard shortcuts overlay + non-Alt pinned shortcut (G-26) ---- */
  function showShortcuts(): void {
    const dialog = new Dialog({
      label: 'Keyboard shortcuts',
      onRequestClose: () => dialog.close(),
    });
    const title = el('h2', { className: 'modal__title', text: 'Keyboard shortcuts' });
    const list = el('ul', { className: 'shortcuts-list' });
    const rows: ReadonlyArray<[string, string]> = [
      ['/', 'Focus the search bar'],
      ['Alt+1–9 or g then 1–9', 'Open a pinned bookmark'],
      ['t / m', 'Toggle Tasks / Notes'],
      ['Esc', 'Close the current layer'],
      ['?', 'Show this help'],
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

  // Load environment telemetry without blocking the UI.
  void telemetry.load().then((data) => header.telemetry.render(data));

  // Instant typing: focus the omnibar on boot, unless locked or on a coarse
  // pointer (auto-focus would raise the phone keyboard — G-27).
  if (!isLockScreenOpen() && !window.matchMedia('(pointer: coarse)').matches) {
    omnibar.focus();
  }
}

/**
 * Register the service worker for offline asset caching (PWA). Registration is
 * a progressive enhancement: failures are swallowed so the app still runs.
 */
function registerServiceWorker(): void {
  // Only register in production: a dev-time service worker can serve stale
  // cached modules and mask live changes.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline caching is optional; ignore registration failures.
    });
  });
}

void bootstrap();
registerServiceWorker();
