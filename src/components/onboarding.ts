/**
 * Hub First-Run Onboarding Card (G-39, DESIGN.md §7)
 * --------------------------------------------------
 * The first load must never be a bare empty page. This card sits over the empty
 * launchpad and offers the three primary ways to get started (add a link,
 * import, connect sync) plus an optional, clearly-labelled sample set and a
 * short install tip. Completing or skipping persists `onboarding_completed`
 * (SCHEMAS.md §3.3) so the card never returns.
 *
 * Built only with the XSS-safe `el()` helper; no `innerHTML`.
 */

import { el, svg } from '../utils/dom';

const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_IMPORT = 'M12 3v12M7 10l5 5 5-5M5 21h14';
const ICON_SYNC = 'M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M3 16v-4h4M21 8V4h-4';
const ICON_SPARKLE = 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z';

export interface OnboardingCallbacks {
  /** Open the bookmark editor to add the first link. */
  onAddBookmark: () => void;
  /** Open the import file picker. */
  onImport: () => void;
  /** Open Settings focused on the sync section. */
  onConnectSync: () => void;
  /** Seed the optional, removable sample set. */
  onTrySample: () => void;
  /** Show platform install guidance. */
  onInstall: () => void;
  /** Persist `onboarding_completed` and hide the card. */
  onComplete: () => void;
}

export class OnboardingCard {
  readonly element: HTMLElement;

  constructor(private readonly callbacks: OnboardingCallbacks) {
    this.element = this.build();
  }

  /** Reveal the card (idempotent). */
  show(): void {
    this.element.hidden = false;
  }

  /** Hide the card without persisting (used when data already exists). */
  hide(): void {
    this.element.hidden = true;
  }

  isVisible(): boolean {
    return !this.element.hidden;
  }

  destroy(): void {
    this.element.remove();
  }

  private build(): HTMLElement {
    const card = el('section', {
      className: 'onboarding',
      attrs: { 'aria-labelledby': 'onboarding-title' },
    });

    card.appendChild(
      el('h2', {
        className: 'onboarding__title',
        attrs: { id: 'onboarding-title' },
        text: 'Welcome to Hub',
      }),
    );
    card.appendChild(
      el('p', {
        className: 'onboarding__lead',
        text: 'Your links, tasks and notes — saved on this device, available offline.',
      }),
    );

    const primary = this.action('Add your first link', ICON_PLUS, 'button--primary', () =>
      this.callbacks.onAddBookmark(),
    );
    const importButton = this.action('Import links', ICON_IMPORT, '', () =>
      this.callbacks.onImport(),
    );
    const syncButton = this.action('Connect sync', ICON_SYNC, '', () =>
      this.callbacks.onConnectSync(),
    );
    const sampleButton = this.action('Try a sample set', ICON_SPARKLE, '', () =>
      this.callbacks.onTrySample(),
    );

    card.appendChild(el('div', { className: 'onboarding__actions', children: [primary] }));
    card.appendChild(
      el('div', { className: 'onboarding__actions', children: [importButton, syncButton] }),
    );
    card.appendChild(el('div', { className: 'onboarding__actions', children: [sampleButton] }));

    const installButton = el('button', {
      className: 'onboarding__link',
      text: 'How to install',
      attrs: { type: 'button' },
    });
    installButton.addEventListener('click', () => this.callbacks.onInstall());

    const skipButton = el('button', {
      className: 'onboarding__link',
      text: 'Skip',
      attrs: { type: 'button' },
    });
    skipButton.addEventListener('click', () => this.complete());

    const tip = el('div', { className: 'onboarding__tip' });
    tip.appendChild(el('span', { text: 'Tip: Install Hub for one-tap access.' }));
    tip.appendChild(installButton);
    tip.appendChild(skipButton);
    card.appendChild(tip);

    return card;
  }

  private action(
    label: string,
    icon: string,
    extraClass: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = el('button', {
      className: `button onboarding__action${extraClass ? ` ${extraClass}` : ''}`,
      attrs: { type: 'button' },
    });
    button.appendChild(svg(icon, { size: 16 }));
    button.appendChild(el('span', { text: label }));
    button.addEventListener('click', onClick);
    return button;
  }

  /** Persist completion and hide. */
  private complete(): void {
    this.hide();
    this.callbacks.onComplete();
  }
}
