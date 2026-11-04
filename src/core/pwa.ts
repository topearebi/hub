/**
 * Hub PWA Helpers
 * ---------------
 * Headless utilities for the installer surface: launch-intent parsing (app
 * shortcuts), share-target parsing, and app badging. Pure functions are
 * exported so they can be unit-tested without a DOM.
 *
 * All browser APIs are feature-detected so the module degrades gracefully in
 * older browsers and in test environments (AGENTS.md air-gap mandate).
 */

/** App shortcut actions declared in `manifest.json`. */
export type LaunchAction = 'new-bookmark' | 'new-task' | 'new-note';

const LAUNCH_ACTIONS: readonly LaunchAction[] = ['new-bookmark', 'new-task', 'new-note'];

/** Raw data delivered by the Web Share Target API (GET params). */
export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

/** The launch context the app should act on during boot. */
export interface LaunchIntent {
  action: LaunchAction | null;
  share: SharePayload | null;
}

/** The editable draft derived from a shared payload. */
export interface ShareDraft {
  kind: 'bookmark' | 'note';
  title: string;
  url?: string;
  content: string;
}

/* ------------------------------------------------------------------ */
/* Pure parsing                                                        */
/* ------------------------------------------------------------------ */

/** Parse the `action` query param into a known shortcut action, if any. */
export function parseLaunchAction(search: string): LaunchAction | null {
  const action = new URLSearchParams(search).get('action');
  return action && (LAUNCH_ACTIONS as readonly string[]).includes(action)
    ? (action as LaunchAction)
    : null;
}

/** Parse the share-target params, returning `null` when nothing was shared. */
export function parseShareTarget(search: string): SharePayload | null {
  const params = new URLSearchParams(search);
  const title = (params.get('title') ?? '').trim();
  const text = (params.get('text') ?? '').trim();
  const url = (params.get('url') ?? '').trim();
  if (title.length === 0 && text.length === 0 && url.length === 0) {
    return null;
  }
  return { title, text, url };
}

/** Resolve the combined launch intent from a query string. */
export function parseLaunchIntent(search: string): LaunchIntent {
  return { action: parseLaunchAction(search), share: parseShareTarget(search) };
}

/**
 * Extract a navigable URL from arbitrary shared text.
 *
 * Prefers an explicit `http(s)://` URL anywhere in the text; otherwise accepts
 * a bare domain like `example.com/path` and normalises it to HTTPS.
 */
export function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const explicit = trimmed.match(/https?:\/\/[^\s]+/i);
  if (explicit) {
    return explicit[0];
  }

  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}

/**
 * Turn a shared payload into an editable draft. When the payload contains a
 * URL, a bookmark is proposed; otherwise the shared text becomes a note.
 */
export function draftFromShare(share: SharePayload): ShareDraft {
  const url = extractUrl(share.url) ?? extractUrl(share.text);

  if (url) {
    const title =
      share.title.trim().length > 0 ? share.title.trim() : share.text.trim().slice(0, 80) || url;
    return { kind: 'bookmark', title, url, content: share.text.trim() };
  }

  const content = [share.title, share.text, share.url]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n');

  return { kind: 'note', title: share.title.trim() || 'Shared note', content };
}

/* ------------------------------------------------------------------ */
/* Window Controls Overlay (installed desktop apps)                    */
/* ------------------------------------------------------------------ */

/** The subset of `DOMRect` the WCO layout needs (kept DOM-free for tests). */
export interface WcoGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** CSS custom properties published on `:root` while WCO is active. */
export interface WcoCssVars {
  '--wco-x': string;
  '--wco-y': string;
  '--wco-w': string;
  '--wco-h': string;
}

/**
 * Map a `titlebar-area` rect to the `--wco-*` custom properties (DESIGN.md §3.1).
 * Values are rounded to whole pixels so sub-pixel jitter never causes layout
 * thrash. Pure and unit-tested.
 */
export function wcoCssVars(rect: WcoGeometry): WcoCssVars {
  const px = (value: number): string => `${Math.round(value)}px`;
  return {
    '--wco-x': px(rect.x),
    '--wco-y': px(rect.y),
    '--wco-w': px(rect.width),
    '--wco-h': px(rect.height),
  };
}

/** Which header elements stay visible at a given window width (DESIGN.md §3.1). */
export interface WcoNarrowing {
  /** Show the profile name (false = avatar-only). */
  profileName: boolean;
  /** Show the status chip text (false = icon-only, accessible name unchanged). */
  statusText: boolean;
  /** Show the Home label (false = icon-only). */
  homeLabel: boolean;
}

/**
 * Graceful-narrowing breakpoints for the WCO title bar. Collapse order is
 * profile name → status text → Home label, so the drag region keeps ≥ 48 px of
 * free width at every size. Pure and unit-tested.
 */
export function wcoNarrowing(width: number): WcoNarrowing {
  return {
    profileName: width >= 480,
    statusText: width >= 400,
    homeLabel: width >= 360,
  };
}

/* ------------------------------------------------------------------ */
/* Install prompt                                                      */
/* ------------------------------------------------------------------ */

/** Cool-down before the install prompt may reappear after a dismissal. */
export const INSTALL_PROMPT_COOLDOWN_MS = 14 * 86_400_000;

/**
 * Whether the non-intrusive install prompt should be offered. Suppressed while
 * inside the cool-down window after a dismissal (SCHEMAS.md §3.3). Pure.
 */
export function shouldShowInstallPrompt(
  dismissedAt: string | undefined,
  now: number,
  cooldownMs: number = INSTALL_PROMPT_COOLDOWN_MS,
): boolean {
  if (!dismissedAt) {
    return true;
  }
  const dismissed = Date.parse(dismissedAt);
  if (Number.isNaN(dismissed)) {
    return true;
  }
  return now - dismissed >= cooldownMs;
}

/* ------------------------------------------------------------------ */
/* Storage persistence & quota                                         */
/* ------------------------------------------------------------------ */

/** A human-readable byte size (e.g. `1.2 MB`). Pure and unit-tested. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const rounded = exponent === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[exponent]}`;
}

/** Feature-detected shape of the Storage API on `navigator`. */
interface StorageApi {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

function storageApi(): StorageApi | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const candidate = (navigator as unknown as { storage?: StorageApi }).storage;
  return candidate ?? null;
}

/**
 * Request durable storage so the browser is far less likely to evict Hub's
 * IndexedDB (G-52). Returns the granted state, or `false` when unsupported.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const api = storageApi();
  if (!api?.persist) {
    return false;
  }
  try {
    return await api.persist();
  } catch {
    return false;
  }
}

/** Read the current persistence state without prompting. */
export async function isStoragePersisted(): Promise<boolean> {
  const api = storageApi();
  if (!api?.persisted) {
    return false;
  }
  try {
    return await api.persisted();
  } catch {
    return false;
  }
}

/** Read the storage usage/quota estimate, or `null` when unsupported. */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  const api = storageApi();
  if (!api?.estimate) {
    return null;
  }
  try {
    const estimate = await api.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* App badging                                                         */
/* ------------------------------------------------------------------ */

/** Feature-detected shape of the Badging API on `navigator`. */
interface BadgeApi {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/**
 * Reflect the open-task count on the installed app icon using the Badging API.
 * A count of zero (or fewer) clears the badge. Silently no-ops when the API or
 * `navigator` is unavailable.
 */
export function updateAppBadge(count: number): void {
  if (typeof navigator === 'undefined') {
    return;
  }
  const badgeNavigator = navigator as unknown as BadgeApi;

  if (count > 0 && typeof badgeNavigator.setAppBadge === 'function') {
    void badgeNavigator.setAppBadge(count).catch(() => undefined);
    return;
  }

  if (typeof badgeNavigator.clearAppBadge === 'function') {
    void badgeNavigator.clearAppBadge().catch(() => undefined);
  }
}
