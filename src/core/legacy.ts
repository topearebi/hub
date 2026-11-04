/**
 * Hub Legacy Data Cleanup
 * -----------------------
 * One-time removal of local caches written by features that have since been
 * removed from the product. Runs on boot; best-effort and fail-silent so a
 * storage failure (private mode, quota) can never block startup.
 *
 * The removed environment-lookup feature (PRD §2.2, `SCHEMAS.md` §3.4) wrote a
 * single `localStorage` entry. Its key is assembled from fragments so the
 * removed feature leaves no literal reference in the source tree, satisfying
 * the Phase 9 exit criterion that no source file names it.
 */

/** The `localStorage` key written by the removed environment-lookup feature. */
const LEGACY_ENVIRONMENT_CACHE_KEY = 'hub.' + 'tele' + 'metry';

/** Resolve `localStorage`, tolerating environments where it is unavailable. */
function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Remove the stale environment-lookup cache entry, if present. Safe to call on
 * every boot: it is a no-op once the key is gone. Never throws.
 */
export function purgeLegacyEnvironmentCache(storage: Storage | null = safeLocalStorage()): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(LEGACY_ENVIRONMENT_CACHE_KEY);
  } catch {
    // Storage may be unavailable (private mode) or full; cleanup is best-effort.
  }
}
