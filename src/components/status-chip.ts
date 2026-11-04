/**
 * Hub Status Chip (G-44, DESIGN.md §6.9)
 * --------------------------------------
 * A single header chip that replaces the colour-only sync dot. It always shows
 * an icon **and** text so the state is never carried by colour alone:
 *   - "Saved on this device" (local-only, no sync configured)
 *   - "Syncing…"
 *   - "Synced 2 min ago"
 *   - "Offline — changes saved locally"
 *   - "Sync failed — Retry"
 *
 * It is a `role="status"` region (polite) that announces state changes but never
 * repeats unchanged state, and a button that opens sync details / retries.
 */

import { el, svg } from '../utils/dom';

const ICON_LOCAL = 'M20 6 9 17l-5-5';
const ICON_SYNC = 'M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M3 16v-4h4M21 8V4h-4';
const ICON_OFFLINE = 'M1 1l22 22M16.7 11.7A11 11 0 0 0 5 5M8.5 8.5A6 6 0 0 0 5 12M12 20h.01';
const ICON_ERROR =
  'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z';

export type StatusChipState = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

export interface StatusChipOptions {
  /** Epoch ms of the last successful sync (for the "Synced N ago" label). */
  syncedAt?: number;
  /** Number of changes queued for the next sync. */
  pending?: number;
  /** Current time override (tests). */
  now?: number;
}

/** Human-readable relative time, e.g. "2 min ago". Pure and unit-tested. */
export function relativeTime(from: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 45) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/** Compute the chip's visible label for a state. Pure and unit-tested. */
export function statusChipLabel(state: StatusChipState, options: StatusChipOptions = {}): string {
  switch (state) {
    case 'syncing':
      return 'Syncing…';
    case 'synced': {
      const base = options.syncedAt
        ? `Synced ${relativeTime(options.syncedAt, options.now)}`
        : 'Synced';
      return options.pending && options.pending > 0 ? `${base} · ${options.pending} waiting` : base;
    }
    case 'offline':
      return 'Offline — changes saved locally';
    case 'error':
      return 'Sync failed — Retry';
    case 'local':
    default:
      return 'Saved on this device';
  }
}

export interface StatusChipCallbacks {
  /** Invoked when the chip is activated (open sync details / retry). */
  onActivate: () => void;
}

export class StatusChip {
  readonly element: HTMLButtonElement;

  private readonly icon: HTMLElement;
  private readonly label: HTMLElement;
  private state: StatusChipState = 'local';
  private lastLabel = '';

  constructor(private readonly callbacks: StatusChipCallbacks) {
    this.icon = el('span', { className: 'status-chip__icon' });
    this.label = el('span', { className: 'status-chip__label' });
    this.element = el('button', {
      className: 'status-chip',
      attrs: {
        type: 'button',
        role: 'status',
        'aria-live': 'polite',
        'data-state': 'local',
      },
      children: [this.icon, this.label],
    });
    this.element.addEventListener('click', () => this.callbacks.onActivate());
    this.render('local', {});
  }

  /** Update the chip. Unchanged states are not re-announced (DESIGN.md §6.9). */
  setState(state: StatusChipState, options: StatusChipOptions = {}): void {
    this.render(state, options);
  }

  getState(): StatusChipState {
    return this.state;
  }

  private render(state: StatusChipState, options: StatusChipOptions): void {
    this.state = state;
    const label = statusChipLabel(state, options);
    this.element.setAttribute('data-state', state);
    this.element.setAttribute('aria-label', `Status: ${label}`);

    // Only touch the live region when the text actually changes, so assistive
    // tech is not spammed with identical announcements.
    if (label !== this.lastLabel) {
      this.label.textContent = label;
      this.lastLabel = label;
    }

    this.icon.replaceChildren(svg(this.iconFor(state), { size: 16 }));
  }

  private iconFor(state: StatusChipState): string {
    switch (state) {
      case 'syncing':
      case 'synced':
        return ICON_SYNC;
      case 'offline':
        return ICON_OFFLINE;
      case 'error':
        return ICON_ERROR;
      case 'local':
      default:
        return ICON_LOCAL;
    }
  }
}
