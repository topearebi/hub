/**
 * Hub System Header
 * -----------------
 * Edge-to-edge header with two clusters (DESIGN.md §6.1):
 *   - Left: Hub app logo (functions as Home navigation) and the status chip.
 *   - Right: drawer toggles and the active-profile control.
 *
 * The profile control opens the profile popover (wired by `main.ts`).
 */

import { el, hubLogoSvg, svg } from '../utils/dom';
import { t } from '../utils/i18n';
import { initialOf, safeCssUrl } from '../utils/text';
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
  /** Return to the launchpad (Home affordance). */
  onHome: () => void;
}

export class Header {
  readonly element: HTMLElement;
  readonly statusChip: StatusChip;

  private readonly tasksToggle: HTMLButtonElement;
  private readonly notesToggle: HTMLButtonElement;
  private readonly homeButton: HTMLButtonElement;
  private readonly avatar: HTMLElement;
  private readonly profileName: HTMLElement;
  private readonly profileButton: HTMLButtonElement;

  constructor(private readonly callbacks: HeaderCallbacks) {
    // A single icon + text status chip replaces the colour-only dot (G-44).
    this.statusChip = new StatusChip({ onActivate: () => this.callbacks.onOpenSync() });

    this.tasksToggle = el('button', {
      className: 'icon-button drawer-toggle',
      attrs: { type: 'button', 'aria-label': t('header.toggleTasks'), 'aria-expanded': 'false' },
    });
    this.tasksToggle.appendChild(svg(ICON_TASKS));
    this.tasksToggle.addEventListener('click', () => this.callbacks.onToggleTasks());

    this.notesToggle = el('button', {
      className: 'icon-button drawer-toggle',
      attrs: {
        type: 'button',
        'aria-label': t('header.toggleScratchpad'),
        'aria-expanded': 'false',
      },
    });
    this.notesToggle.appendChild(svg(ICON_NOTES));
    this.notesToggle.addEventListener('click', () => this.callbacks.onToggleNotes());

    // App logo Home affordance (DESIGN.md §3, §6.1). Functions as home navigation.
    this.homeButton = el('button', {
      className: 'icon-button header-home',
      attrs: {
        type: 'button',
        'aria-label': t('header.home'),
        title: t('header.home'),
      },
    });
    this.homeButton.appendChild(
      hubLogoSvg({ size: 28, withBackground: true, className: 'header-home__logo' }),
    );
    this.homeButton.addEventListener('click', () => this.callbacks.onHome());

    this.avatar = el('span', { className: 'profile-button__avatar' });
    this.profileName = el('span', { className: 'profile-button__name', text: t('common.profile') });
    this.profileButton = el('button', {
      className: 'profile-button',
      attrs: { type: 'button', 'aria-label': t('header.profileMenu'), 'aria-haspopup': 'menu' },
      children: [this.avatar, this.profileName],
    });
    this.profileButton.addEventListener('click', () =>
      this.callbacks.onOpenProfile(this.profileButton),
    );

    const left = el('div', {
      className: 'system-header__left',
      children: [this.homeButton, this.statusChip.element],
    });
    const right = el('div', {
      className: 'system-header__right',
      children: [this.tasksToggle, this.notesToggle, this.profileButton],
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

  /**
   * Apply the Window Controls Overlay graceful-narrowing state (DESIGN.md
   * §3.1). Each flag, when false, collapses the corresponding element to its
   * icon-only form so the drag region keeps ≥ 48px of free width.
   */
  setWcoNarrowing(narrowing: {
    profileName: boolean;
    statusText: boolean;
    homeLabel: boolean;
  }): void {
    this.element.classList.toggle('is-wco-narrow-profile', !narrowing.profileName);
    this.element.classList.toggle('is-wco-narrow-status', !narrowing.statusText);
    this.element.classList.toggle('is-wco-narrow-home', !narrowing.homeLabel);
  }

  /** Reflect the active profile in the profile control. */
  renderProfile(profile: ProfileItem | null): void {
    this.profileName.textContent = profile?.name?.trim() || t('common.profile');

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
