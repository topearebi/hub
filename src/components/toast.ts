/**
 * Hub Toast Dispatcher
 * --------------------
 * Non-blocking bottom notifications (PRD §5.2). A single container is lazily
 * created and reused; each toast animates in, auto-dismisses, and can be
 * dismissed early via the returned disposer.
 */

import { el } from '../utils/dom';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms (default 4000). */
  durationMs?: number;
}

let container: HTMLElement | null = null;

/** Lazily create the shared, accessible toast container. */
function getContainer(): HTMLElement {
  if (!container) {
    container = el('div', {
      className: 'toast-container',
      attrs: { role: 'status', 'aria-live': 'polite' },
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
  const durationMs = options.durationMs ?? 4000;

  const node = el('div', {
    className: `toast toast--${variant}`,
    text: message,
  });

  const host = getContainer();
  host.appendChild(node);

  // Trigger the enter transition on the next frame.
  requestAnimationFrame(() => node.classList.add('toast--visible'));

  let dismissed = false;
  const dismiss = (): void => {
    if (dismissed) {
      return;
    }
    dismissed = true;
    node.classList.remove('toast--visible');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    // Safety net in case the transition never fires (e.g. reduced motion).
    setTimeout(() => node.remove(), 300);
  };

  const timer = setTimeout(dismiss, durationMs);

  return () => {
    clearTimeout(timer);
    dismiss();
  };
}
