/**
 * Shared Drawer Shell
 * -------------------
 * Builds the common chrome for the Tasks and Scratchpad drawers: a header with
 * a title, a pin toggle, and a close button, plus a body mount point.
 *
 * Open/pin state is expressed as `data-*` attributes so all visual behaviour
 * (off-canvas slide, grid placement) lives in the stylesheet.
 */

import { el, svg } from '../utils/dom';

/** Feather-style pin icon (local inline SVG, no CDN). */
const ICON_PIN =
  'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';
const ICON_CLOSE = 'M18 6 6 18M6 6l12 12';

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

/** Build the shared drawer chrome. */
export function buildDrawerShell(options: DrawerShellOptions): DrawerShell {
  const pinButton = el('button', {
    className: 'icon-button drawer__pin',
    attrs: { type: 'button', 'aria-label': `Pin ${options.title}` },
  });
  pinButton.appendChild(svg(ICON_PIN));
  pinButton.addEventListener('click', options.onPinToggle);

  const closeButton = el('button', {
    className: 'icon-button drawer__close',
    attrs: { type: 'button', 'aria-label': `Close ${options.title}` },
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
