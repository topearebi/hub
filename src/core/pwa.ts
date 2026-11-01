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
