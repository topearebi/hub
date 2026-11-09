/**
 * Shared dialog primitive (G-28).
 *
 * Every modal in Hub goes through this helper so focus management, background
 * `inert`, Escape handling, backdrop dismissal and focus restoration are
 * consistent and correct:
 *   - on open: move focus inside, mark the rest of the page `inert`;
 *   - while open: trap Tab/Shift+Tab within the dialog, Escape requests close;
 *   - on close: release `inert`, restore focus to the invoker (or its nearest
 *     surviving ancestor).
 *
 * Built only with the XSS-safe `el()` helper; no `innerHTML`.
 */

import { el } from './dom';
import { bindVisualViewport } from './viewport';

/** Selector for natively focusable elements. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Focusable descendants of `container`, excluding hidden ones. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (node) => !node.hasAttribute('hidden') && node.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Trap Tab/Shift+Tab within `container` and optionally handle Escape. Returns a
 * disposer. The listener is registered in the capture phase so it wins over
 * component-level handlers.
 */
export function trapFocus(container: HTMLElement, onEscape?: () => void): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (onEscape) {
        event.preventDefault();
        onEscape();
      }
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const focusables = getFocusable(container);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) {
      event.preventDefault();
      container.focus();
      return;
    }

    const active = document.activeElement;
    const inside = active instanceof Node && container.contains(active);
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', handler, true);
  return () => container.removeEventListener('keydown', handler, true);
}

/**
 * Mark every body child except the active overlay `inert`, so assistive tech and
 * Tab cannot reach the page behind a modal. Returns a disposer that restores the
 * previous state.
 */
export function setBackgroundInert(active: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    if (child === active || child.contains(active)) {
      continue;
    }
    if (!child.hasAttribute('inert')) {
      child.setAttribute('inert', '');
      changed.push(child);
    }
  }
  return () => {
    for (const node of changed) {
      node.removeAttribute('inert');
    }
  };
}

export interface DialogOptions {
  /** `dialog` (default) or `alertdialog` for confirmations. */
  role?: 'dialog' | 'alertdialog';
  /** id of the visible title element used for `aria-labelledby`. */
  labelledBy?: string;
  /** Fallback accessible name when there is no title element. */
  label?: string;
  /** id of the element describing the dialog (`aria-describedby`). */
  describedBy?: string;
  /** Overlay class (default `modal-overlay`). */
  overlayClassName?: string;
  /** Content class (default `modal`). */
  contentClassName?: string;
  /** Render above another modal (`modal-overlay--nested`). */
  nested?: boolean;
  /** Bottom-sheet presentation on phones. */
  sheet?: boolean;
  /** Dismiss when the backdrop is clicked (default true). */
  dismissOnBackdrop?: boolean;
  /** Called for Escape / backdrop / close requests. */
  onRequestClose?: () => void;
  /** Element to focus when the dialog closes; defaults to the invoker. */
  restoreFocus?: HTMLElement | null;
}

export class Dialog {
  readonly overlay: HTMLElement;
  /** The `.modal` element consumers append their header/body to. */
  readonly content: HTMLElement;

  private opened = false;
  private releaseViewport: (() => void) | null = null;
  private releaseTrap: (() => void) | null = null;
  private releaseInert: (() => void) | null = null;
  private restoreTarget: HTMLElement | null = null;

  constructor(private readonly options: DialogOptions = {}) {
    const contentClasses = [options.contentClassName ?? 'modal'];
    if (options.sheet) {
      contentClasses.push('modal--sheet');
    }
    this.content = el('div', {
      className: contentClasses.join(' '),
      attrs: { role: options.role ?? 'dialog', 'aria-modal': 'true' },
    });
    if (options.labelledBy !== undefined) {
      this.content.setAttribute('aria-labelledby', options.labelledBy);
    } else {
      this.content.setAttribute('aria-label', options.label ?? 'Dialog');
    }
    if (options.describedBy !== undefined) {
      this.content.setAttribute('aria-describedby', options.describedBy);
    }

    const overlayClasses = [options.overlayClassName ?? 'modal-overlay'];
    if (options.nested) {
      overlayClasses.push('modal-overlay--nested');
    }
    this.overlay = el('div', { className: overlayClasses.join(' '), children: [this.content] });

    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay && (this.options.dismissOnBackdrop ?? true)) {
        this.requestClose();
      }
    });
  }

  /** Reveal the dialog, trap focus and inert the background. */
  open(initialFocus?: HTMLElement | null): void {
    if (this.opened) {
      return;
    }
    this.opened = true;
    const releaseMetrics = bindVisualViewport(this.overlay);
    const revealField = (): void => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        this.content.contains(active) &&
        active.matches('input, textarea, select')
      ) {
        active.scrollIntoView?.({ block: 'nearest' });
      }
    };
    this.content.addEventListener('focusin', revealField);
    window.visualViewport?.addEventListener('resize', revealField);
    this.releaseViewport = () => {
      releaseMetrics();
      this.content.removeEventListener('focusin', revealField);
      window.visualViewport?.removeEventListener('resize', revealField);
    };

    if (!this.overlay.isConnected) {
      document.body.appendChild(this.overlay);
    }

    const active = document.activeElement;
    this.restoreTarget =
      this.options.restoreFocus ?? (active instanceof HTMLElement ? active : null);

    this.overlay.classList.add('is-open');
    this.releaseInert = setBackgroundInert(this.overlay);
    this.releaseTrap = trapFocus(
      this.overlay,
      this.options.onRequestClose ? () => this.requestClose() : undefined,
    );

    const target = initialFocus ?? getFocusable(this.content)[0] ?? this.content;
    if (target === this.content && !this.content.hasAttribute('tabindex')) {
      this.content.setAttribute('tabindex', '-1');
    }
    target.focus();
  }

  /** Close the dialog and restore focus. Safe to call when already closed. */
  close(): void {
    if (!this.opened) {
      return;
    }
    this.opened = false;
    this.releaseViewport?.();
    this.releaseViewport = null;

    this.releaseTrap?.();
    this.releaseTrap = null;
    this.releaseInert?.();
    this.releaseInert = null;
    this.overlay.classList.remove('is-open');

    // Restore focus to the invoker, or its nearest surviving ancestor, so focus
    // never falls to <body> (DESIGN.md §3.2).
    let target = this.restoreTarget;
    while (target && !target.isConnected) {
      target = target.parentElement;
    }
    const fallback = getFocusable(document.body)[0] ?? null;
    const finalTarget = target ?? fallback;
    if (finalTarget && finalTarget.isConnected) {
      finalTarget.focus();
    }
    this.restoreTarget = null;
  }

  /** Ask the host to close (Escape / backdrop). Falls back to `close()`. */
  requestClose(): void {
    if (this.options.onRequestClose) {
      this.options.onRequestClose();
    } else {
      this.close();
    }
  }

  isOpen(): boolean {
    return this.opened;
  }

  /** Remove the overlay from the DOM entirely (used by transient dialogs). */
  destroy(): void {
    this.close();
    this.overlay.remove();
  }
}

export interface ConfirmDialogOptions {
  /** Visible title (recommended for a11y). */
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive and focus Cancel first. */
  danger?: boolean;
  /** Render above another modal. */
  nested?: boolean;
}

let confirmSeq = 0;

/**
 * Show a modal confirmation and resolve with the user's choice. Escape and
 * backdrop dismissal resolve `false`. Focus starts on Cancel for destructive
 * actions, otherwise on Confirm.
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    confirmSeq += 1;
    const titleId = `confirm-title-${confirmSeq}`;
    const messageId = `confirm-message-${confirmSeq}`;

    let settled = false;
    const dialogOptions: DialogOptions = {
      role: 'alertdialog',
      describedBy: messageId,
      nested: options.nested ?? true,
      dismissOnBackdrop: true,
      onRequestClose: () => finish(false),
    };
    if (options.title) {
      dialogOptions.labelledBy = titleId;
    } else {
      dialogOptions.label = 'Confirm';
    }
    const dialog = new Dialog(dialogOptions);

    const header = options.title
      ? el('h2', { className: 'modal__title', attrs: { id: titleId }, text: options.title })
      : null;
    const message = el('p', {
      className: 'modal__message',
      attrs: { id: messageId },
      text: options.message,
    });

    const cancelButton = el('button', {
      className: 'button',
      text: options.cancelLabel ?? 'Cancel',
      attrs: { type: 'button' },
    });
    const confirmButton = el('button', {
      className: `button button--primary${options.danger ? ' button--danger' : ''}`,
      text: options.confirmLabel,
      attrs: { type: 'button' },
    });
    const actions = el('div', {
      className: 'modal__actions',
      children: [cancelButton, confirmButton],
    });

    const body = el('div', {
      className: 'modal__body',
      children: header ? [header, message, actions] : [message, actions],
    });
    dialog.content.appendChild(body);

    const finish = (value: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      dialog.destroy();
      resolve(value);
    };
    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));

    dialog.open(options.danger ? cancelButton : confirmButton);
  });
}
