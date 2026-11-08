/**
 * Shared Drawer Shell
 * -------------------
 * Builds the common chrome for the Tasks and Scratchpad drawers: a header with
 * a title, a pin toggle, and a close button, plus a body mount point.
 *
 * Open/pin state is expressed as `data-*` attributes so all visual behaviour
 * (off-canvas slide, grid placement) lives in the stylesheet.
 */

import { el, svg, ICON_CLOSE, ICON_PIN } from '../utils/dom';
import { t } from '../utils/i18n';

export interface DrawerShellOptions {
  /** Drawer identity, used for the `drawer--{variant}` class. */
  variant: 'tasks' | 'notes';
  /** Human-readable title shown in the header. */
  title: string;
  /** Invoked when the pin toggle is clicked. */
  onPinToggle: () => void;
  /** Invoked when the close button is clicked. */
  onClose: () => void;
}

export interface DrawerShell {
  /** The `<aside>` root element. */
  element: HTMLElement;
  /** Mount point for drawer content. */
  body: HTMLElement;
  pinButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
}

/**
 * Compute a drawer's open state after a pin-state change.
 *
 * Pinned drawers are always open (they live in the grid flow). A drawer that
 * was *just* unpinned must be closed, otherwise it lingers as a fixed
 * off-canvas overlay over the launchpad. A drawer that was already unpinned
 * keeps whatever open/closed state the user manually toggled.
 *
 * @param pinned     The drawer's new persisted pin flag.
 * @param wasPinned  The drawer's previous pin flag.
 * @param wasOpen    The drawer's current open state.
 */
export function resolveDrawerOpen(pinned: boolean, wasPinned: boolean, wasOpen: boolean): boolean {
  if (pinned) {
    return true;
  }
  if (wasPinned) {
    return false;
  }
  return wasOpen;
}

/**
 * How many drawers may be pinned at a given viewport width (DESIGN.md §3).
 *
 * Pinning is a desktop affordance: it is disabled on phones and tablets
 * (< 1024px), limited to one drawer on laptops (1024–1439px) and allows both
 * drawers only on wide displays (>= 1440px).
 */
export function maxPinnedDrawers(viewportWidth: number): number {
  if (viewportWidth >= 1440) {
    return 2;
  }
  if (viewportWidth >= 1024) {
    return 1;
  }
  return 0;
}

/** Build the shared drawer chrome. */
export function buildDrawerShell(options: DrawerShellOptions): DrawerShell {
  const pinButton = el('button', {
    className: 'icon-button drawer__pin',
    attrs: { type: 'button', 'aria-label': t('drawer.pin', { title: options.title }) },
  });
  pinButton.appendChild(svg(ICON_PIN));
  pinButton.addEventListener('click', options.onPinToggle);

  const closeButton = el('button', {
    className: 'icon-button drawer__close',
    attrs: { type: 'button', 'aria-label': t('drawer.close', { title: options.title }) },
  });
  closeButton.appendChild(svg(ICON_CLOSE));
  closeButton.addEventListener('click', options.onClose);

  const title = el('h2', { className: 'drawer__title', text: options.title });
  const actions = el('div', { className: 'drawer__actions', children: [pinButton, closeButton] });
  const header = el('header', { className: 'drawer__header', children: [title, actions] });
  const body = el('div', { className: 'drawer__body' });

  const element = el('aside', {
    className: `drawer drawer--${options.variant}`,
    attrs: {
      'data-pinned': 'false',
      'data-open': 'false',
      'aria-label': options.title,
    },
    children: [header, body],
  });

  return { element, body, pinButton, closeButton };
}
