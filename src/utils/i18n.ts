/**
 * Hub Internationalisation (i18n)
 * -------------------------------
 * A dependency-free message catalogue with `{name}` interpolation, an ICU-style
 * plural helper, locale-aware date/time formatting, and a pseudo-locale mode for
 * smoke-testing that no user-visible string bypasses the catalogue (G-38).
 *
 * Design notes:
 *   - No runtime dependency (AGENTS.md zero-bloat mandate): `Intl` is built in.
 *   - The default locale is English; `t()` returns the exact English string so
 *     existing behaviour and tests are unchanged.
 *   - `setPseudoLocale(true)` wraps every message in `⟦…⟧` and accents its
 *     letters, so a rendered component that still shows plain English is a
 *     hard-coded string that escaped the catalogue.
 *   - `dirFor()` / `applyDocumentLocale()` drive `lang`/`dir` on `<html>` for
 *     RTL locales.
 */

/** Locales that read right-to-left. */
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ps', 'sd']);

/** The active BCP-47 locale tag (used for `Intl` formatting and `lang`). */
let activeLocale = 'en';

/** Whether the pseudo-locale transformation is active. */
let pseudoEnabled = false;

/* ------------------------------------------------------------------ */
/* Message catalogue                                                   */
/* ------------------------------------------------------------------ */

/**
 * The English message catalogue. Keys are dotted namespaces; `{name}` tokens are
 * interpolated by `t()`. Plural keys use the `.one` / `.other` suffixes read by
 * `tp()`.
 */
export const MESSAGES: Record<string, string> = {
  /* ---- Common ---- */
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.remove': 'Remove',
  'common.replace': 'Replace',
  'common.undo': 'Undo',
  'common.restore': 'Restore',
  'common.dismiss': 'Dismiss',
  'common.add': 'Add',
  'common.edit': 'Edit',
  'common.import': 'Import',
  'common.retry': 'Retry',
  'common.untitled': 'Untitled',
  'common.none': 'None',
  'common.title': 'Title',
  'common.profile': 'Profile',
  'common.hub': 'Hub',
  'common.discard': 'Discard',
  'common.discardChangesTitle': 'Discard changes?',
  'common.discardChangesMessage': 'You have unsaved changes. Discard them?',
  'common.deletePermanently': 'Delete permanently',
  'common.deletePermanentlyTitle': 'Delete permanently?',
  'common.permanentlyDeleted': 'Permanently deleted.',
  'common.actionsFor': 'Actions for {name}',

  /* ---- Relative time ---- */
  'time.justNow': 'just now',
  'time.minutesAgo.one': '{count} min ago',
  'time.minutesAgo.other': '{count} min ago',
  'time.hoursAgo.one': '{count} h ago',
  'time.hoursAgo.other': '{count} h ago',
  'time.daysAgo.one': '{count} d ago',
  'time.daysAgo.other': '{count} d ago',

  /* ---- Toast ---- */
  'toast.region': 'Notifications',
  'toast.dismiss': 'Dismiss notification',

  /* ---- Drawer ---- */
  'drawer.pin': 'Pin {title}',
  'drawer.close': 'Close {title}',

  /* ---- Header ---- */
  'header.toggleTasks': 'Toggle tasks',
  'header.toggleScratchpad': 'Toggle scratchpad',
  'header.home': 'Home',
  'header.profileMenu': 'Profile menu',

  /* ---- Status chip ---- */
  'status.local': 'Saved on this device',
  'status.syncing': 'Syncing…',
  'status.synced': 'Synced',
  'status.syncedAgo': 'Synced {time}',
  'status.waiting': '{base} · {count} waiting',
  'status.offline': 'Offline — changes saved locally',
  'status.error': 'Sync failed — Retry',
  'status.aria': 'Status: {label}',

  /* ---- Lock screen ---- */
  'lock.title': 'Hub is locked',
  'lock.hint': 'Unlock with your device screen lock or biometrics.',
  'lock.unlock': 'Unlock',
  'lock.verifying': 'Verifying…',
  'lock.notVerified': 'Not verified. Try again.',
  'lock.aria': 'App locked',

  /* ---- Share target ---- */
  'share.titlePlaceholder': 'Title',
  'share.titleAria': 'Share title',
  'share.contentPlaceholder': 'Text',
  'share.contentAria': 'Share content',
  'share.saveNote': 'Save note',
  'share.heading': 'Save shared note',
  'share.empty': 'Enter some text to save a note.',
  'share.saved': 'Note saved.',
  'share.defaultTitle': 'Shared note',

  /* ---- Profile popover ---- */
  'profilePopover.aria': 'Profiles',
  'profilePopover.add': 'Add profile',
  'profilePopover.settings': 'Profile settings',
  'profilePopover.appSettings': 'App settings',

  /* ---- Onboarding ---- */
  'onboarding.title': 'Welcome to Hub',
  'onboarding.lead': 'Your links, tasks and notes — saved on this device, available offline.',
  'onboarding.addFirst': 'Add your first link',
  'onboarding.import': 'Import links',
  'onboarding.connectSync': 'Connect sync',
  'onboarding.trySample': 'Try a sample set',
  'onboarding.howToInstall': 'How to install',
  'onboarding.skip': 'Skip',
  'onboarding.tip': 'Tip: Install Hub for one-tap access.',

  /* ---- Brand ---- */
  'brand.fallback': 'Hub',

  /* ---- Note editor ---- */
  'noteEditor.titlePlaceholder': 'Title',
  'noteEditor.titleAria': 'Note title',
  'noteEditor.contentPlaceholder': 'Take a note…',
  'noteEditor.contentAria': 'Note content',
  'noteEditor.colorAria': 'Note color',
  'noteEditor.closeAria': 'Close note editor',
  'noteEditor.heading': 'Edit note',
  'noteEditor.empty': 'Add a title or some content first.',
  'noteEditor.untitled': 'Untitled',
  'noteColor.default': 'Default',
  'noteColor.burgundy': 'Burgundy',
  'noteColor.amber': 'Amber',
  'noteColor.sage': 'Sage',
  'noteColor.terracotta': 'Terracotta',
  'noteColor.slate': 'Slate',

  /* ---- Recently deleted ---- */
  'recentlyDeleted.heading': 'Recently deleted',
  'recentlyDeleted.empty':
    'Nothing here. Deleted items are kept for 30 days before they are removed.',
  'recentlyDeleted.profiles': 'Profiles',
  'recentlyDeleted.items': 'Items',
  'recentlyDeleted.kind.link': 'Link',
  'recentlyDeleted.kind.task': 'Task',
  'recentlyDeleted.kind.note': 'Note',
  'recentlyDeleted.linkCount.one': '{count} link',
  'recentlyDeleted.linkCount.other': '{count} links',
  'recentlyDeleted.taskCount.one': '{count} task',
  'recentlyDeleted.taskCount.other': '{count} tasks',
  'recentlyDeleted.noteCount.one': '{count} note',
  'recentlyDeleted.noteCount.other': '{count} notes',
  'recentlyDeleted.summary': '{links}, {tasks}, {notes}',
  'recentlyDeleted.deletedAgo': 'Deleted {days} days ago · permanently removed in {remaining} days',
  'recentlyDeleted.itemMeta':
    '{kind} · deleted {days} days ago · permanently removed in {remaining} days',
  'recentlyDeleted.deleteNow': 'Delete now',
  'recentlyDeleted.confirmProfile':
    'Permanently delete “{name}” and its {summary}? This cannot be undone.',
  'recentlyDeleted.confirmItem': 'Permanently delete “{name}”?',

  /* ---- Profile editor ---- */
  'profileEditor.namePlaceholder': 'Profile name',
  'profileEditor.nameAria': 'Profile name',
  'profileEditor.hubTitlePlaceholder': 'Hub title',
  'profileEditor.hubTitleAria': 'Hub title',
  'profileEditor.engineAria': 'Default search engine',
  'profileEditor.themeAria': 'Theme',
  'profileEditor.uploadAvatarAria': 'Upload avatar',
  'profileEditor.uploadLogoAria': 'Upload logo',
  'profileEditor.removeAvatarAria': 'Remove avatar',
  'profileEditor.removeLogoAria': 'Remove logo',
  'profileEditor.closeAria': 'Close profile editor',
  'profileEditor.heading': 'Profile settings',
  'profileEditor.deleteProfile': 'Delete profile',
  'profileEditor.fieldName': 'Profile name',
  'profileEditor.fieldHubTitle': 'Hub title',
  'profileEditor.fieldEngine': 'Default search engine',
  'profileEditor.fieldTheme': 'Theme',
  'profileEditor.fieldAvatar': 'Avatar',
  'profileEditor.fieldLogo': 'Custom logo',
  'profileEditor.processing': 'Processing image…',
  'profileEditor.imageReady': 'Image ready.',
  'profileEditor.imageError': 'Could not process that image.',
  'profileEditor.saved': 'Profile saved.',
  'profileEditor.defaultName': 'Profile',
  'theme.auto': 'Auto (follow system)',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  /* ---- Category manager ---- */
  'categoryManager.heading': 'Manage categories',
  'categoryManager.newPlaceholder': 'New category name',
  'categoryManager.newAria': 'New category name',
  'categoryManager.empty': 'No categories yet. Add one below.',
  'categoryManager.renameAria': 'Rename {name}',
  'categoryManager.moveUpAria': 'Move {name} up',
  'categoryManager.moveDownAria': 'Move {name} down',
  'categoryManager.deleteAria': 'Delete {name}',
  'categoryManager.needsOne': 'Hub needs at least one category.',
  'categoryManager.deleteTitle': 'Delete category?',
  'categoryManager.deleteMessage': 'Delete “{name}”? Its {count} link(s) will move to “{target}”.',
  'categoryManager.deleteConfirm': 'Delete category',
  'categoryManager.deleted': 'Category “{name}” deleted.',

  /* ---- Bookmarks ---- */
  'bookmarks.recentlyUsed': 'Recently Used',
  'bookmarks.uncategorized': 'Uncategorized',
  'bookmarks.emptyTitle': 'Nothing here yet.',
  'bookmarks.emptyText': 'Add your first link, or import your bookmarks.',
  'bookmarks.addLink': 'Add link',
  'bookmarks.recentLabel': 'Recent: {title}',
  'bookmarks.openPrimary': 'Open primary ({host})',
  'bookmarks.openMirror': 'Open mirror ({host})',
  'bookmarks.edit': 'Edit bookmark',
  'bookmarks.share': 'Share',
  'bookmarks.shareUnavailable': 'Sharing is unavailable in this browser.',

  /* ---- Notes ---- */
  'notes.title': 'Scratchpad',
  'notes.captureTitlePlaceholder': 'Title',
  'notes.captureTitleAria': 'Note title',
  'notes.captureContentPlaceholder': 'Take a note…',
  'notes.captureContentAria': 'Note content',
  'notes.captureColorAria': 'Note color',
  'notes.pinAria': 'Pin note',
  'notes.captureTrigger': 'Take a note…',
  'notes.empty': "Scratchpad is empty. Click 'Take a note…' to capture something.",
  'notes.pinned': 'Pinned',
  'notes.others': 'Others',
  'notes.editAria': 'Edit {title}',
  'notes.changeColor': 'Change color',
  'notes.pin': 'Pin',
  'notes.unpin': 'Unpin',
  'notes.copy': 'Copy',
  'notes.share': 'Share',
  'notes.shareUnavailable': 'Sharing is unavailable in this browser.',
  'notes.deleted': 'Note deleted.',
  'notes.clipboardUnavailable': 'Clipboard is unavailable in this browser.',
  'notes.copied': 'Copied to clipboard.',
  'notes.copyFailed': 'Copy failed.',

  /* ---- Bookmark editor ---- */
  'bookmarkEditor.titlePlaceholder': 'Title',
  'bookmarkEditor.titleAria': 'Bookmark title',
  'bookmarkEditor.urlPlaceholder': 'https://…',
  'bookmarkEditor.urlAria': 'Bookmark URL',
  'bookmarkEditor.altPlaceholder': 'One mirror URL per line',
  'bookmarkEditor.altAria': 'Alternate URLs',
  'bookmarkEditor.categoryAria': 'Category',
  'bookmarkEditor.newCategoryPlaceholder': 'New category name',
  'bookmarkEditor.newCategoryAria': 'New category name',
  'bookmarkEditor.iconPlaceholder': 'Optional icon URL',
  'bookmarkEditor.iconAria': 'Icon URL',
  'bookmarkEditor.hotkeyAria': 'Hotkey slot',
  'bookmarkEditor.hotkeyOption': 'Alt + {key}',
  'bookmarkEditor.addHeading': 'Add bookmark',
  'bookmarkEditor.editHeading': 'Edit bookmark',
  'bookmarkEditor.closeAria': 'Close bookmark editor',
  'bookmarkEditor.fieldTitle': 'Title',
  'bookmarkEditor.fieldUrl': 'URL',
  'bookmarkEditor.fieldAlt': 'Alternate / mirror URLs',
  'bookmarkEditor.fieldCategory': 'Category',
  'bookmarkEditor.fieldIcon': 'Icon URL',
  'bookmarkEditor.fieldHotkey': 'Hotkey',
  'bookmarkEditor.newCategoryOption': 'New category…',
  'bookmarkEditor.errorUrlRequired': 'Enter a URL for this bookmark.',
  'bookmarkEditor.errorUrlInvalid': 'That does not look like a valid URL.',
  'bookmarkEditor.errorHotkeyTaken': 'Alt + {key} is already assigned to another bookmark.',
  'bookmarkEditor.errorNewCategoryName': 'Enter a name for the new category.',
  'bookmarkEditor.errorGeneric': 'Check the form and try again.',

  /* ---- Omnibar ---- */
  'omnibar.placeholder': 'Search bookmarks or enter a URL…',
  'omnibar.aria': 'Search bookmarks or enter a URL',
  'omnibar.engineAria': 'Search engine',
  'omnibar.enterHint': 'Enter',
  'omnibar.resultsAria': 'Search results',
  'omnibar.addToBookmarks': 'Add to bookmarks',
  'omnibar.goTo': 'Go to',
  'omnibar.search': 'Search',
  'omnibar.resultCount.one': '{count} result',
  'omnibar.resultCount.other': '{count} results',
  'omnibar.hotkey': 'Alt+{key}',

  /* ---- Settings ---- */
  'settings.heading': 'Settings',
  'settings.closeAria': 'Close settings',
  'settings.general': 'General',
  'settings.theme': 'Theme',
  'settings.saveGeneral': 'Save general',
  'settings.sync': 'Sync (GitHub)',
  'settings.testConnection': 'Test connection',
  'settings.saveSync': 'Save sync settings',
  'settings.syncNow': 'Sync now',
  'settings.tokenHelp':
    'Needs Contents: read & write on the sync repository only. Hub stores it encrypted on this device.',
  'settings.enableSync': 'Enable background sync',
  'settings.pat': 'GitHub token (PAT)',
  'settings.owner': 'Repository owner',
  'settings.repo': 'Repository name',
  'settings.branch': 'Branch',
  'settings.filePath': 'File path',
  'settings.notifications': 'Notifications & reminders',
  'settings.localNotifications': 'Local notifications & reminders',
  'settings.saveNotifications': 'Save notifications',
  'settings.security': 'Security',
  'settings.appLock': 'App lock (device screen lock / biometrics)',
  'settings.registerLock': 'Register app lock',
  'settings.reregisterLock': 'Re-register app lock',
  'settings.data': 'Data',
  'settings.exportJson': 'Export JSON',
  'settings.importJson': 'Import JSON',
  'settings.manageCategories': 'Manage categories',
  'settings.recentlyDeleted': 'Recently deleted',
  'settings.requestPersist': 'Request persistent storage',
  'settings.install': 'Install & updates',
  'settings.installHelp': 'Install Hub for one-tap access and offline use.',
  'settings.installHub': 'Install Hub',
  'settings.advanced': 'Advanced',
  'settings.saveAdvanced': 'Save advanced',
  'settings.vapid': 'Web Push public key (VAPID)',
  'settings.gamepad': 'Gamepad navigation',
  'settings.tokenSaved': 'Token saved',
  'settings.storagePersistent': 'Storage is persistent — your browser will not clear Hub’s data.',
  'settings.storageNotPersistent':
    'Storage is not yet persistent. Your browser may clear Hub’s data when space is low.',
  'settings.generalSaved': 'General settings saved.',
  'settings.syncSaved': 'Sync settings saved.',
  'settings.notificationsSaved': 'Notification settings saved.',
  'settings.advancedSaved': 'Advanced settings saved.',
  'settings.saveFailed': 'Could not save settings. Try again.',
  'settings.tokenRemoved': 'Token removed.',
  'settings.tokenRemoveFailed': 'Could not remove the token.',
  'settings.requestingPersist': 'Requesting persistent storage…',
  'settings.persistRequested': 'Persistent storage requested.',
  'settings.persistFailed': 'Could not request persistent storage.',
  'settings.quota': 'Using {usage} of {quota} available.',
  'settings.quotaNoTotal': 'Using {usage}.',
  'settings.lockFailed': 'Could not update the app lock.',
  'settings.enterDetails': 'Enter a token, owner, and repository first.',
  'settings.testing': 'Testing connection…',
  'settings.initRemote': 'Initializing remote file…',
  'settings.remoteInitialized': 'Remote file initialized.',
  'settings.testFailed': 'Connection test failed. Check your details.',
  'settings.confirmInit':
    'Target file not found in the remote repository. Do you want Hub to initialize it with your current local data?',
  'settings.confirmInitLabel': 'Confirm & Initialize',
  'settings.placeholderPat': 'ghp_…',
  'settings.placeholderOwner': 'username',
  'settings.placeholderRepo': 'my-hub-config',
  'settings.placeholderBranch': 'main',
  'settings.placeholderPath': '.hub/data.json',
  'settings.placeholderVapid': 'BEl62i…',

  /* ---- Tasks ---- */
  'tasks.title': 'My Tasks',
  'tasks.creatorTitlePlaceholder': 'Add a task',
  'tasks.creatorTitleAria': 'Task title',
  'tasks.creatorDetailsPlaceholder': 'Details',
  'tasks.creatorDetailsAria': 'Task details',
  'tasks.dueDateAria': 'Due date',
  'tasks.dueTimeAria': 'Due time',
  'tasks.today': 'Today',
  'tasks.tomorrow': 'Tomorrow',
  'tasks.dateTime': 'Date & Time',
  'tasks.repeat': 'Repeat',
  'tasks.repeats': 'Repeats {recurrence}',
  'tasks.addTask': 'Add a task',
  'tasks.empty': "All priorities cleared. Add a task to track today's focus.",
  'tasks.toggleAria': 'Toggle {title}',
  'tasks.addSubtask': 'Add subtask',
  'tasks.setDateTime': 'Set date/time',
  'tasks.moveUp': 'Move up',
  'tasks.moveDown': 'Move down',
  'tasks.indent': 'Indent',
  'tasks.outdent': 'Outdent',
  'tasks.dragAria': 'Drag to reorder',
  'tasks.deleted': 'Task deleted.',
  'tasks.completed': 'Completed ({count})',
  'tasks.completedAt': 'Completed: {date}',
  'tasks.recurrence.none': 'None',
  'tasks.recurrence.daily': 'Daily',
  'tasks.recurrence.weekly': 'Weekly',
  'tasks.recurrence.monthly': 'Monthly',
  'tasks.recurrence.yearly': 'Yearly',

  /* ---- App shell (main.ts) ---- */
  'app.opening': 'Opening…',
  'app.openFailed': 'Could not open that bookmark.',
  'app.mirrorRouted': 'Primary URL unreachable. Routed to mirror: {host}',
  'app.exported': 'Exported hub-data.json.',
  'app.importInvalid': 'Import failed: invalid file.',
  'app.replaceTitle': 'Replace local data?',
  'app.replaceMessage':
    'This file contains {count} items. It will replace your current local data.',
  'app.replaceConfirm': 'Replace data',
  'app.importComplete': 'Import complete.',
  'app.importSaveFailed': 'Import failed while saving.',
  'app.sampleAdded': 'Sample links added. Remove the “Sample links” category to clear them.',
  'app.noteSaved': 'Note saved.',
  'app.startFailedTitle': 'Hub could not start',
  'app.startFailedMessage':
    'Your browser blocked local storage. Private browsing or a disabled IndexedDB can cause this. Your data has not been changed.',
  'app.installing': 'Installing Hub…',
  'app.installHub': 'Install Hub',
  'app.gotIt': 'Got it',
  'app.installTip': 'Install Hub for one-tap access and offline use.',
  'app.install': 'Install',
  'app.loading': 'Loading your data',
  'app.tokenReentry':
    'Your saved GitHub token could not be read on this device. Re-enter it in Settings → Sync.',
  'app.tabBookmarks': 'Bookmarks',
  'app.tabTasks': 'Tasks',
  'app.tabNotes': 'Notes',
  'app.primaryNav': 'Primary',
  'app.skipToContent': 'Skip to content',
  'app.bookmarkSaved': 'Bookmark saved.',
  'app.addBookmark': 'Add bookmark',
  'app.deleteBookmarkTitle': 'Delete bookmark?',
  'app.deleteBookmarkMessage': 'Delete “{title}”?',
  'app.bookmarkDeleted': 'Bookmark deleted.',
  'app.syncFailed': 'Sync failed. Check your GitHub settings.',
  'app.lockRegisterFailed': 'App lock could not be registered on this device.',
  'app.lockEnabled': 'App lock enabled.',
  'app.lockDisabled': 'App lock disabled.',
  'app.needsOneProfile': 'Hub needs at least one profile.',
  'app.deleteProfileTitle': 'Delete profile?',
  'app.deleteProfileMessage':
    'This deletes “{name}” and its {count} items. You can restore it from Settings → Data → Recently deleted for 30 days.',
  'app.deleteProfileConfirm': 'Delete profile',
  'app.profileDeleted': 'Profile “{name}” deleted.',
  'app.defaultProfileName': 'Profile {n}',
  'app.reminder': 'Reminder: {title}',
  'app.lockUnsupported': 'App lock is on, but this device has no WebAuthn support.',
  'app.installed': 'Hub installed. Launch it from your home screen or app list.',
  'app.shortcuts': 'Keyboard shortcuts',
  'app.updateReady': 'A new version of Hub is ready.',
  'app.reload': 'Reload',
  'app.installStepIos1': 'Tap the Share button in Safari.',
  'app.installStepIos2': 'Choose “Add to Home Screen”.',
  'app.installStepIos3': 'Tap “Add”.',
  'app.installStepOther1': 'Open your browser menu.',
  'app.installStepOther2': 'Choose “Install app” or “Add to Home screen”.',
  'app.installStepOther3': 'Confirm to install.',
  'app.shortcutFocusSearch': 'Focus the search bar',
  'app.shortcutPinned': 'Open a pinned bookmark',
  'app.shortcutTogglePanes': 'Toggle Tasks / Notes',
  'app.shortcutCloseLayer': 'Close the current layer',
  'app.shortcutShowHelp': 'Show this help',
};

/* ------------------------------------------------------------------ */
/* Core API                                                            */
/* ------------------------------------------------------------------ */

/** Accent map used by the pseudo-locale transformation. */
const PSEUDO_MAP: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/** Wrap and accent a string for the pseudo-locale. */
export function pseudo(text: string): string {
  const mapped = text.replace(/[a-zA-Z]/g, (ch) => PSEUDO_MAP[ch] ?? ch);
  return `⟦${mapped}⟧`;
}

/** Interpolate `{name}` tokens, then apply the pseudo-locale when enabled. */
function render(template: string, params?: Record<string, string | number>): string {
  const text = template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params?.[name];
    return value === undefined ? match : String(value);
  });
  return pseudoEnabled ? pseudo(text) : text;
}

/** Look up a message by key and interpolate its `{name}` tokens. */
export function t(key: string, params?: Record<string, string | number>): string {
  return render(MESSAGES[key] ?? key, params);
}

/**
 * Plural-aware lookup. Reads `{key}.one` for a count of exactly 1 and
 * `{key}.other` otherwise, interpolating `{count}` plus any extra params.
 */
export function tp(key: string, count: number, params?: Record<string, string | number>): string {
  const suffix = count === 1 ? 'one' : 'other';
  const template = MESSAGES[`${key}.${suffix}`] ?? MESSAGES[`${key}.other`] ?? key;
  return render(template, { count, ...params });
}

/* ------------------------------------------------------------------ */
/* Locale + direction                                                  */
/* ------------------------------------------------------------------ */

/** The active locale tag. */
export function getLocale(): string {
  return activeLocale;
}

/** Set the active locale and reflect it on `<html lang>` / `<html dir>`. */
export function setLocale(locale: string): void {
  activeLocale = locale || 'en';
  applyDocumentLocale();
}

/** Enable or disable the pseudo-locale transformation. */
export function setPseudoLocale(enabled: boolean): void {
  pseudoEnabled = enabled;
}

/** Whether the pseudo-locale is active. */
export function isPseudoLocale(): boolean {
  return pseudoEnabled;
}

/** The writing direction for a locale tag. */
export function dirFor(locale: string): 'ltr' | 'rtl' {
  const base = locale.toLowerCase().split('-')[0] ?? '';
  return RTL_LOCALES.has(base) ? 'rtl' : 'ltr';
}

/** Reflect the active locale on the document root (`lang` + `dir`). */
export function applyDocumentLocale(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.lang = activeLocale;
  root.dir = dirFor(activeLocale);
}

/* ------------------------------------------------------------------ */
/* Locale-aware date/time                                              */
/* ------------------------------------------------------------------ */

/** Format a date with the active locale. */
export function formatDate(
  value: number | Date,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string {
  return new Intl.DateTimeFormat(activeLocale, options).format(value);
}

/** Format a time with the active locale. */
export function formatTime(
  value: number | Date,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string {
  return new Intl.DateTimeFormat(activeLocale, options).format(value);
}

/** Format a date and time with the active locale. */
export function formatDateTime(
  value: number | Date,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
): string {
  return new Intl.DateTimeFormat(activeLocale, options).format(value);
}

/** A short relative-time label ("just now", "2 min ago", …). */
export function formatRelativeTime(from: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 45) {
    return t('time.justNow');
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return tp('time.minutesAgo', minutes);
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return tp('time.hoursAgo', hours);
  }
  const days = Math.round(hours / 24);
  return tp('time.daysAgo', days);
}
