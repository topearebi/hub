/**
 * Web Share (progressive enhancement, G-53)
 * -----------------------------------------
 * A thin, feature-detected wrapper around `navigator.share`. Returns `false`
 * when the API is unavailable or the user cancels, so callers can fall back to
 * copying to the clipboard.
 */

export interface ShareData {
  title?: string;
  text?: string;
  url?: string;
}

/** True when the Web Share API is available. */
export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Invoke the native share sheet. Resolves `true` when the share completed and
 * `false` when it was unavailable, cancelled, or failed.
 */
export async function share(data: ShareData): Promise<boolean> {
  if (!canShare()) {
    return false;
  }
  try {
    await navigator.share(data);
    return true;
  } catch {
    // The user cancelled or the share failed; treat both as "not shared".
    return false;
  }
}
