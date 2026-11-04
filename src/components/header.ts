/**
 * Hub System Header
 * -----------------
 * Edge-to-edge header with two clusters:
 *   - Left: environment telemetry (IP / location / weather).
 *   - Right: sync status, drawer toggles, and the active-profile control.
 *
 * The profile control opens the profile popover (wired by `main.ts`).
 */

import { el, svg } from '../utils/dom';
import { initialOf, safeCssUrl } from '../utils/text';
import { TelemetryBadge } from './telemetry-badge';
import { StatusChip } from './status-chip';
import type { StatusChipState } from './status-chip';
import type { ProfileItem } from '../types/schemas';
import type { SyncStatus } from '../core/sync';

const ICON_TASKS = 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11';
const ICON_NOTES =
  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8';

export interface HeaderCallbacks {
  onToggleTasks: () => void;
  onToggleNotes: () => void;
  onOpenProfile: (anchor: HTMLElement) => void;
  /** Open sync details / retry (status chip activation). */
  onOpenSync: () => void;
}

export class Header {
  readonly element: HTMLElement;
  readonly telemetry: TelemetryBadge;
  readonly statusChip: StatusChip;

  private readonly tasksToggle: HTMLButtonElement;
  private readonly notesToggle: HTMLButtonElement;
  private readonly avatar: HTMLElement;
  private readonly profileName: HTMLElement;
  private readonly profileButton: HTMLButtonElement;

  constructor(private readonly callbacks: HeaderCallbacks) {
    this.telemetry = new TelemetryBadge();

    // A single icon + text status chip replaces the colour-only dot (G-44).
    this.statusChip = new StatusChip({ onActivate: () => this.callbacks.onOpenSync() });

    this.tasksToggle = el('button', {
      className: 'icon-button drawer-toggle',
      attrs: { type: 'button', 'aria-label': 'Toggle tasks', 'aria-expanded': 'false' },
    });
    this.tasksToggle.appendChild(svg(ICON_TASKS));
    this.tasksToggle.addEventListener('click', () => this.callbacks.onToggleTasks());

    this.notesToggle = el('button', {
      className: 'icon-button drawer-toggle',
      attrs: { type: 'button', 'aria-label': 'Toggle scratchpad', 'aria-expanded': 'false' },
    });
    this.notesToggle.appendChild(svg(ICON_NOTES));
    this.notesToggle.addEventListener('click', () => this.callbacks.onToggleNotes());

    this.avatar = el('span', { className: 'profile-button__avatar' });
    this.profileName = el('span', { className: 'profile-button__name', text: 'Profile' });
    this.profileButton = el('button', {
      className: 'profile-button',
      attrs: { type: 'button', 'aria-label': 'Profile menu', 'aria-haspopup': 'menu' },
      children: [this.avatar, this.profileName],
    });
    this.profileButton.addEventListener('click', () =>
      this.callbacks.onOpenProfile(this.profileButton),
    );

    const left = el('div', {
      className: 'system-header__left',
      children: [this.telemetry.element],
    });
    const right = el('div', {
      className: 'system-header__right',
      children: [this.statusChip.element, this.tasksToggle, this.notesToggle, this.profileButton],
    });

    this.element = el('header', { className: 'system-header', children: [left, right] });
  }

  /** Update the status chip from a sync status (icon + text cue — G-44). */
  setSyncStatus(status: SyncStatus): void {
    const map: Record<SyncStatus, StatusChipState> = {
      idle: 'local',
      syncing: 'syncing',
      synced: 'synced',
      error: 'error',
    };
    this.statusChip.setState(map[status] ?? 'local');
  }

  /** Set the chip directly (e.g. the offline state, which sync does not emit). */
  setStatusState(state: StatusChipState, options?: { syncedAt?: number; pending?: number }): void {
    this.statusChip.setState(state, options);
  }

  /** Reflect a drawer's open state on its toggle (G-31). */
  setDrawerExpanded(key: 'tasks' | 'notes', expanded: boolean): void {
    const toggle = key === 'tasks' ? this.tasksToggle : this.notesToggle;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  /** Reflect the active profile in the profile control. */
  renderProfile(profile: ProfileItem | null): void {
    this.profileName.textContent = profile?.name?.trim() || 'Profile';

    // Validate/escape the avatar before interpolating it into a `url("…")`
    // token so a crafted value can never break out of the CSS string (G-55).
    const avatarUrl = profile?.avatar ? safeCssUrl(profile.avatar) : '';

    if (avatarUrl) {
      this.avatar.textContent = '';
      this.avatar.style.backgroundImage = `url("${avatarUrl}")`;
      this.avatar.classList.add('profile-button__avatar--image');
    } else {
      this.avatar.style.backgroundImage = '';
      this.avatar.classList.remove('profile-button__avatar--image');
      this.avatar.textContent = initialOf(profile?.name, 'H');
    }
  }
}
