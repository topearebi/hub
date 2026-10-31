/**
 * Hub Smart URL Fallback Engine
 * -----------------------------
 * Implements PRD §5.2: when a bookmark declares `alternate_urls`, Hub performs
 * an async pre-flight probe of the primary URL and, on failure, walks the
 * mirrors sequentially until one responds.
 *
 * Headless: no DOM imports. `fetch` is the only browser dependency and is
 * guarded so the module remains safe in non-browser test contexts.
 */

import type { BookmarkItem } from '../types/schemas';

export interface FallbackResult {
  /** The URL Hub should navigate to. */
  url: string;
  /** True when a mirror was selected instead of the primary URL. */
  usedAlternate: boolean;
  /** Hostname of the selected URL (used in the toast message). */
  hostname: string;
}

/** Extract a hostname for display, tolerating malformed URLs. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Probe a URL for reachability.
 *
 * Uses a `no-cors` GET so the browser does not require CORS headers; a resolved
 * promise means the host answered, a rejection (network error / timeout) means
 * it did not. When `fetch` is unavailable the URL is assumed reachable so the
 * app never blocks navigation on a missing API.
 *
 * Limitation (by design): a `no-cors` response is opaque, so its HTTP status is
 * not observable. Reachability therefore means "the host responded", not "the
 * page loaded successfully" — a server that is up but returns a 4xx/5xx status
 * is still treated as reachable. This is intentional: the fallback engine
 * targets genuinely unreachable hosts (DNS/TCP failures, timeouts), which
 * reject the request and correctly trigger mirror routing.
 */
export async function probeUrl(url: string, timeoutMs = 2500): Promise<boolean> {
  if (typeof fetch !== 'function') {
    return true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the best reachable URL for a bookmark.
 *
 * Short-circuits to the primary URL when no mirrors are configured, avoiding an
 * unnecessary network round-trip on the common path.
 */
export async function resolveBookmarkUrl(
  bookmark: BookmarkItem,
  timeoutMs = 2500,
): Promise<FallbackResult> {
  const alternates = bookmark.alternate_urls ?? [];

  if (alternates.length === 0) {
    return { url: bookmark.url, usedAlternate: false, hostname: hostnameOf(bookmark.url) };
  }

  if (await probeUrl(bookmark.url, timeoutMs)) {
    return { url: bookmark.url, usedAlternate: false, hostname: hostnameOf(bookmark.url) };
  }

  for (const alternate of alternates) {
    if (await probeUrl(alternate, timeoutMs)) {
      return { url: alternate, usedAlternate: true, hostname: hostnameOf(alternate) };
    }
  }

  // Every target failed: fall back to the primary so the user still lands
  // somewhere predictable rather than being stranded.
  return { url: bookmark.url, usedAlternate: false, hostname: hostnameOf(bookmark.url) };
}
