/**
 * Visual-viewport helpers (G-16).
 *
 * On phones the on-screen keyboard shrinks the *visual* viewport without
 * changing the layout viewport, so bottom-anchored UI (bottom sheets, the tab
 * bar, toasts) can end up hidden behind the keyboard. This module publishes the
 * keyboard height as the `--keyboard-inset` custom property on `:root` so the
 * stylesheet can reflow above it.
 *
 * The metric computation is a pure function so it can be unit-tested without a
 * browser; the binder is a thin, feature-detected wrapper around
 * `window.visualViewport` (absent in older browsers and in jsdom).
 */

/** Snapshot of the visual viewport relative to the layout viewport. */
export interface ViewportMetrics {
  /** Visible viewport height in CSS pixels. */
  height: number;
  /** Offset of the visual viewport from the layout viewport top. */
  offsetTop: number;
  /** Height of the on-screen keyboard (0 when closed). */
  keyboardInset: number;
}

/** Minimal shape of `window.visualViewport` used here. */
export interface VisualViewportLike {
  height: number;
  offsetTop: number;
}

/**
 * Derive the keyboard inset from the layout and visual viewport sizes.
 *
 * The keyboard occupies the space between the bottom of the visual viewport and
 * the bottom of the layout viewport, so the inset is
 * `layoutHeight - visual.height - visual.offsetTop`, clamped at zero (a visual
 * viewport taller than the layout viewport, e.g. during pinch-zoom, must never
 * produce a negative inset).
 */
export function computeViewportMetrics(
  layoutHeight: number,
  visual: VisualViewportLike,
): ViewportMetrics {
  const keyboardInset = Math.max(0, layoutHeight - visual.height - visual.offsetTop);
  return { height: visual.height, offsetTop: visual.offsetTop, keyboardInset };
}

/**
 * Subscribe to `visualViewport` changes and publish `--keyboard-inset` and
 * `--vvh` on `root`. Returns a disposer. No-ops (returning a no-op disposer)
 * when the API is unavailable, so callers need no feature detection.
 */
export function bindVisualViewport(
  root: HTMLElement = document.documentElement,
  onChange?: () => void,
): () => void {
  const visual = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!visual) {
    return () => undefined;
  }

  const apply = (): void => {
    const metrics = computeViewportMetrics(window.innerHeight, visual);
    root.style.setProperty('--keyboard-inset', `${metrics.keyboardInset}px`);
    root.style.setProperty('--vvh', `${metrics.height}px`);
    root.style.setProperty('--vvtop', `${metrics.offsetTop}px`);
    root.style.setProperty('--vvleft', `${visual.offsetLeft ?? 0}px`);
    root.style.setProperty('--vvw', `${visual.width ?? window.innerWidth}px`);
    onChange?.();
  };

  apply();
  visual.addEventListener('resize', apply);
  visual.addEventListener('scroll', apply);

  return () => {
    visual.removeEventListener('resize', apply);
    visual.removeEventListener('scroll', apply);
  };
}
