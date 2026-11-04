/**
 * Swipe gestures (progressive enhancement, G-25)
 * ----------------------------------------------
 * Pointer-based horizontal swipe detection for touch. Attaches to an element
 * and invokes `onSwipeLeft` / `onSwipeRight` when the pointer travels past a
 * threshold horizontally with limited vertical drift. Mouse pointers are
 * ignored so desktop behaviour is unchanged, and the gesture is purely additive
 * (every action it triggers is also reachable by touch and keyboard elsewhere).
 */

export interface SwipeOptions {
  /** Minimum horizontal travel (px) to count as a swipe. Default 64. */
  threshold?: number;
  /** Maximum vertical drift (px) allowed. Default 48. */
  maxVertical?: number;
  /** CSS selector for descendants that must not start a swipe (e.g. drag handles). */
  ignoreSelector?: string;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

export interface SwipeController {
  /** Remove the listeners. */
  destroy(): void;
}

/** Attach horizontal swipe detection to `element`. */
export function attachSwipe(element: HTMLElement, options: SwipeOptions = {}): SwipeController {
  const threshold = options.threshold ?? 64;
  const maxVertical = options.maxVertical ?? 48;
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') {
      return;
    }
    if (
      options.ignoreSelector &&
      event.target instanceof Element &&
      event.target.closest(options.ignoreSelector)
    ) {
      return;
    }
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
  };

  const onUp = (event: PointerEvent): void => {
    if (!tracking) {
      return;
    }
    tracking = false;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dy) > maxVertical || Math.abs(dx) < threshold) {
      return;
    }
    if (dx < 0) {
      options.onSwipeLeft?.();
    } else {
      options.onSwipeRight?.();
    }
  };

  const onCancel = (): void => {
    tracking = false;
  };

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onCancel);

  return {
    destroy(): void {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
    },
  };
}
