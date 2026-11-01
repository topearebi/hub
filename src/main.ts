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
import { ShareTargetPrompt } from './components/share-target';
import { LockScreen } from './components/lock-screen';
import { Header } from './components/header';
import { Brand } from './components/brand';
import { ProfilePopover } from './components/profile-popover';
import { ProfileEditor } from './components/profile-editor';
import { showToast } from './components/toast';
import { el, svg } from './utils/dom';
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

/** Import a JSON backup, replacing local collections. */
async function importJson(file: File): Promise<void> {
  try {
    const text = await file.text();
    const payload = parsePayload(text);
    await store.applyPayload(payload);
    showToast('Import complete.', { variant: 'success' });
  } catch {
    showToast('Import failed: invalid file.', { variant: 'error' });
  }
}

/** Ensure at least one category exists so new bookmarks have a home. */
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
    name: 'Shared',
    order: 0,
  };
  await store.upsertCategory(category);
  return category;
}

/** Show a nested confirmation dialog and resolve with the user's choice. */
function confirmDialog(message: string, confirmLabel: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const text = el('p', { className: 'modal__message', text: message });
    const cancelButton = el('button', {
      className: 'button',
      text: 'Cancel',
      attrs: { type: 'button' },
    });
    const confirmButton = el('button', {
      className: 'button button--primary',
      text: confirmLabel,
      attrs: { type: 'button' },
    });
    const actions = el('div', {
      className: 'modal__actions',
      children: [cancelButton, confirmButton],
    });
    const dialog = el('div', { className: 'modal modal--sm', children: [text, actions] });
    const overlay = el('div', {
      className: 'modal-overlay modal-overlay--nested',
      attrs: { role: 'alertdialog', 'aria-modal': 'true' },
      children: [dialog],
    });
    document.body.appendChild(overlay);

    const finish = (value: boolean): void => {
      overlay.remove();
      resolve(value);
    };
    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));
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

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  // Hydrate RAM from IndexedDB before the first render.
  await store.init();

  /* ---- Shell ---- */
  const shell = el('div', { className: 'app-shell', attrs: { 'data-view': 'bookmarks' } });

  /* ---- System header (telemetry + profile controls) ---- */
  const header = new Header({
    onToggleTasks: () => setOpen('tasks', !openState.tasks),
    onToggleNotes: () => setOpen('notes', !openState.notes),
    onOpenProfile: (anchor) => profilePopover.toggle(anchor),
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
    const confirmed = await confirmDialog(`Delete "${bookmark.title}"?`, 'Delete');
    if (!confirmed) {
      return;
    }
    await store.softDeleteBookmark(bookmark.id);
    showToast('Bookmark deleted.', { variant: 'info' });
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

  function updateSyncStatus(status: SyncStatus): void {
    header.setSyncStatus(status);
    if (status === 'error') {
      showToast('Sync failed. Check your GitHub settings.', { variant: 'error' });
    }
  }

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
  });
  document.body.appendChild(settings.element);

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
      if (current) {
        await store.softDeleteProfile(current.id);
      }
      applyProfile();
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
      button.classList.toggle('is-active', key === view);
    }
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

  store.subscribe('bookmarks', () => bookmarksView.render());
  store.subscribe('categories', () => bookmarksView.render());
  store.subscribe('metrics', () => bookmarksView.render());
  store.subscribe('tasks', () => tasksDrawer.render());
  store.subscribe('notes', () => notesDrawer.render());
  store.subscribe('profiles', () => applyProfile());

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

  // Load environment telemetry without blocking the UI.
  void telemetry.load().then((data) => header.telemetry.render(data));

  // Instant typing: focus the omnibar on boot.
  omnibar.focus();
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
