/**
 * Hub Profile Popover
 * -------------------
 * Dropdown anchored to the header's profile control. Lists profiles for quick
 * switching and exposes actions to add a profile, edit the active profile, or
 * open global app settings.
 */

import { clearChildren, el } from '../utils/dom';
import type { ProfileItem } from '../types/schemas';

export interface ProfilePopoverStore {
  readonly profiles: ProfileItem[];
  readonly activeProfile: ProfileItem | null;
}

export interface ProfilePopoverCallbacks {
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onEditProfile: () => void;
  onOpenSettings: () => void;
}

export class ProfilePopover {
  readonly element: HTMLElement;

  private isOpen = false;

  constructor(
    private readonly store: ProfilePopoverStore,
    private readonly callbacks: ProfilePopoverCallbacks,
  ) {
    this.element = el('div', {
      className: 'profile-popover',
      attrs: { role: 'menu', 'aria-label': 'Profiles' },
    });

    document.addEventListener('mousedown', (event) => {
      if (this.isOpen && !this.element.contains(event.target as Node)) {
        this.close();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.close();
      }
    });
  }

  /** Toggle the popover, anchored beneath `anchor`. */
  toggle(anchor: HTMLElement): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.show(anchor);
  }

  show(anchor: HTMLElement): void {
    this.render();
    const rect = anchor.getBoundingClientRect();
    this.element.style.setProperty('--popover-top', `${rect.bottom + 8}px`);
    this.element.style.setProperty(
      '--popover-right',
      `${Math.max(8, window.innerWidth - rect.right)}px`,
    );
    this.element.classList.add('is-open');
    this.isOpen = true;
  }

  close(): void {
    this.element.classList.remove('is-open');
    this.isOpen = false;
  }

  /** True when the popover is currently visible. */
  isVisible(): boolean {
    return this.isOpen;
  }

  private render(): void {
    clearChildren(this.element);
    const activeId = this.store.activeProfile?.id;

    for (const profile of this.store.profiles) {
      const item = el('button', {
        className: `profile-popover__item${profile.id === activeId ? ' is-active' : ''}`,
        attrs: { type: 'button', role: 'menuitem' },
      });
      item.appendChild(
        el('span', {
          className: 'profile-popover__avatar',
          text: (profile.name.trim().charAt(0) || 'H').toUpperCase(),
        }),
      );
      item.appendChild(el('span', { className: 'profile-popover__name', text: profile.name }));
      item.addEventListener('click', () => {
        this.callbacks.onSwitch(profile.id);
        this.close();
      });
      this.element.appendChild(item);
    }

    this.element.appendChild(el('div', { className: 'profile-popover__divider' }));
    this.element.appendChild(
      this.action('Add profile', () => {
        this.callbacks.onAdd();
        this.close();
      }),
    );
    this.element.appendChild(
      this.action('Profile settings', () => {
        this.callbacks.onEditProfile();
        this.close();
      }),
    );
    this.element.appendChild(
      this.action('App settings', () => {
        this.callbacks.onOpenSettings();
        this.close();
      }),
    );
  }

  private action(label: string, handler: () => void): HTMLElement {
    const button = el('button', {
      className: 'profile-popover__action',
      text: label,
      attrs: { type: 'button', role: 'menuitem' },
    });
    button.addEventListener('click', handler);
    return button;
  }
}
