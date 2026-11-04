/**
 * Hub Toast Dispatcher
 * --------------------
 * Non-blocking bottom notifications (PRD §5.6, DESIGN.md §6.10).
 *
 * Features (G-37):
 *   - variants with an icon-friendly colour;
 *   - `action` (e.g. Undo) and a dismiss button;
 *   - pause on hover/focus, so timed toasts never vanish mid-read;
 *   - errors/warnings are persistent and announced via `role="alert"`;
 *   - `dedupeKey` replaces an existing toast instead of stacking duplicates.
 *
 * A single container is lazily created and reused.
 */

import { el, svg } from '../utils/dom';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onSelect: () => void;
}

export interface ToastOptions {
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms (default 4000; ignored when persistent). */
  durationMs?: number;
  /** Inline action button (e.g. Undo). */
  action?: ToastAction;
  /** Never auto-dismiss. Defaults to true for warnings/errors. */
  persistent?: boolean;
  /** Show a dismiss button (default true). */
  dismissible?: boolean;
  /** Replace any existing toast with the same key instead of stacking. */
  dedupeKey?: string;
}

const ICON_CLOSE = 'M18 6 6 18M6 6l12 12';
const DEFAULT_DURATION = 4000;

let container: HTMLElement | null = null;
const activeByKey = new Map<string, () => void>();

/** Lazily create the shared toast container. */
function getContainer(): HTMLElement {
  if (!container || !container.isConnected) {
    container = el('div', {
      className: 'toast-container',
      attrs: { role: 'region', 'aria-label': 'Notifications' },
    });
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Display a toast message.
 *
 * @returns A disposer that dismisses the toast immediately.
 */
export function showToast(message: string, options: ToastOptions = {}): () => void {
  const variant = options.variant ?? 'info';
  const isError = variant === 'error' || variant === 'warning';
  const persistent = options.persistent ?? isError;
  const durationMs = options.durationMs ?? DEFAULT_DURATION;

  // Deduplicate: replace an existing toast with the same key.
  if (options.dedupeKey !== undefined) {
    activeByKey.get(options.dedupeKey)?.();
  }

  const node = el('div', {
    className: `toast toast--${variant}`,
    attrs: {
      role: isError ? 'alert' : 'status',
      'aria-live': isError ? 'assertive' : 'polite',
    },
  });

  node.appendChild(el('span', { className: 'toast__message', text: message }));

  let dismissed = false;
  const dismiss = (): void => {
    if (dismissed) {
      return;
    }
    dismissed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (options.dedupeKey !== undefined && activeByKey.get(options.dedupeKey) === disposer) {
      activeByKey.delete(options.dedupeKey);
    }
    node.classList.remove('toast--visible');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    // Safety net in case the transition never fires (e.g. reduced motion).
    setTimeout(() => node.remove(), 300);
  };

  if (options.action) {
    const actionButton = el('button', {
      className: 'toast__action',
      text: options.action.label,
      attrs: { type: 'button' },
    });
    actionButton.addEventListener('click', () => {
      options.action?.onSelect();
      dismiss();
    });
    node.appendChild(actionButton);
  }

  if (options.dismissible ?? true) {
    const dismissButton = el('button', {
      className: 'toast__dismiss',
      attrs: { type: 'button', 'aria-label': 'Dismiss notification' },
    });
    dismissButton.appendChild(svg(ICON_CLOSE, { size: 16 }));
    dismissButton.addEventListener('click', () => dismiss());
    node.appendChild(dismissButton);
  }

  getContainer().appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast--visible'));

  // Timed auto-dismiss with pause-on-hover/focus.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let remaining = durationMs;
  let startedAt = Date.now();
  const startTimer = (): void => {
    if (persistent || dismissed) {
      return;
    }
    startedAt = Date.now();
    timer = setTimeout(dismiss, remaining);
  };
  const pause = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      remaining -= Date.now() - startedAt;
    }
  };
  const resume = (): void => startTimer();

  startTimer();
  node.addEventListener('mouseenter', pause);
  node.addEventListener('mouseleave', resume);
  node.addEventListener('focusin', pause);
  node.addEventListener('focusout', resume);

  const disposer = (): void => dismiss();
  if (options.dedupeKey !== undefined) {
    activeByKey.set(options.dedupeKey, disposer);
  }
  return disposer;
}
