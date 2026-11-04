/**
 * Hub Lock Screen
 * ---------------
 * A full-viewport overlay that gates the app until the WebAuthn platform
 * authenticator verifies the user (device screen lock / biometrics). Purely
 * presentational: the verification work is delegated to the injected callback.
 */

import { el, svg } from '../utils/dom';
import { setBackgroundInert, trapFocus } from '../utils/dialog';

const ICON_LOCK =
  'M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zM8 11V7a4 4 0 0 1 8 0v4';

/**
 * True while the lock overlay is showing. Global shortcut handlers consult this
 * so `/`, `Alt+digit` and app hotkeys cannot act behind the lock (G-29).
 */
export function isLockScreenOpen(): boolean {
  return document.querySelector('.lock-overlay.is-open') !== null;
}

export interface LockScreenOptions {
  /** Performs the WebAuthn assertion. Resolves true when unlocked. */
  verify: () => Promise<boolean>;
  /** Called after a successful verification. */
  onUnlocked: () => void;
}

export class LockScreen {
  readonly element: HTMLElement;

  private readonly statusEl: HTMLElement;
  private readonly button: HTMLButtonElement;
  private busy = false;
  private releaseTrap: (() => void) | null = null;
  private releaseInert: (() => void) | null = null;

  constructor(private readonly options: LockScreenOptions) {
    const icon = svg(ICON_LOCK, { className: 'lock__icon', size: 40 });
    const title = el('h2', { className: 'lock__title', text: 'Hub is locked' });
    const hint = el('p', {
      className: 'lock__hint',
      text: 'Unlock with your device screen lock or biometrics.',
    });
    this.statusEl = el('p', {
      className: 'lock__status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.button = el('button', {
      className: 'button button--primary',
      text: 'Unlock',
      attrs: { type: 'button' },
    });
    this.button.addEventListener('click', () => {
      void this.attempt();
    });

    const card = el('div', {
      className: 'lock__card',
      children: [icon, title, hint, this.statusEl, this.button],
    });
    this.element = el('div', {
      className: 'lock-overlay',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'App locked' },
      children: [card],
    });
  }

  open(): void {
    this.element.classList.add('is-open');
    // The lock blocks the whole app: trap focus inside the overlay and inert the
    // background. There is intentionally no Escape handler — only a successful
    // verification unlocks.
    this.releaseInert = setBackgroundInert(this.element);
    this.releaseTrap = trapFocus(this.element);
    this.button.focus();
  }

  close(): void {
    this.element.classList.remove('is-open');
    this.releaseTrap?.();
    this.releaseTrap = null;
    this.releaseInert?.();
    this.releaseInert = null;
  }

  private async attempt(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.button.disabled = true;
    this.statusEl.textContent = 'Verifying…';

    try {
      const unlocked = await this.options.verify();
      if (unlocked) {
        this.statusEl.textContent = '';
        this.close();
        this.options.onUnlocked();
      } else {
        this.statusEl.textContent = 'Not verified. Try again.';
      }
    } finally {
      this.busy = false;
      this.button.disabled = false;
    }
  }
}
