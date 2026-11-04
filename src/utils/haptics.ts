/**
 * Haptics (progressive enhancement, G-25)
 * ---------------------------------------
 * A tiny wrapper around `navigator.vibrate` that is feature-detected and
 * respects `prefers-reduced-motion`. Never throws; a no-op where unsupported.
 */

export type HapticPattern = 'light' | 'success' | 'warning';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  success: [10, 40, 10],
  warning: [20, 60, 20],
};

/** True when the device exposes the Vibration API. */
export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** True when the user prefers reduced motion (haptics are suppressed). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Fire a short haptic pattern. Best-effort and fail-silent. */
export function haptic(pattern: HapticPattern = 'light'): void {
  if (!isHapticsSupported() || prefersReducedMotion()) {
    return;
  }
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Vibration can throw in some embedded contexts; ignore.
  }
}
