/**
 * Hub Profile Popover
 * -------------------
 * Dropdown anchored to the header's profile control. Lists profiles for quick
 * switching and exposes actions to add a profile, edit the active profile, or
 * open global app settings.
 */

import { btn, clearChildren, el } from '../utils/dom';
import { t } from '../utils/i18n';
import { MenuKeyboard } from '../utils/menu';
import { initialOf } from '../utils/text';
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
  private anchor: HTMLElement | null = null;
  private readonly keyboard: MenuKeyboard;

  constructor(
    private readonly store: ProfilePopoverStore,
    private readonly callbacks: ProfilePopoverCallbacks,
  ) {
    this.element = el('div', {
      className: 'profile-popover',
      attrs: { role: 'menu', 'aria-label': t('profilePopover.aria') },
    });

    // Shared roving-tabindex keyboard behaviour (arrow/Home/End/Escape/type-ahead).
    this.keyboard = new MenuKeyboard(this.element, {
      getItems: () =>
        Array.from(
          this.element.querySelectorAll<HTMLElement>(
            '.profile-popover__item, .profile-popover__action',
          ),
        ),
      onClose: () => this.close(),
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
    this.anchor = anchor;
    const rect = anchor.getBoundingClientRect();
    this.element.style.setProperty('--popover-top', `${rect.bottom + 8}px`);
    this.element.style.setProperty(
      '--popover-right',
      `${Math.max(8, window.innerWidth - rect.right)}px`,
    );
    this.element.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
    this.isOpen = true;
    this.keyboard.activate('first');
  }

  close(): void {
    this.keyboard.deactivate();
    this.element.classList.remove('is-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
    this.anchor = null;
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
        children: [
          el('span', {
            className: 'profile-popover__avatar',
            text: initialOf(profile.name, 'H'),
          }),
          el('span', { className: 'profile-popover__name', text: profile.name }),
        ],
      });
      item.addEventListener('click', () => {
        this.callbacks.onSwitch(profile.id);
        this.close();
      });
      this.element.appendChild(item);
    }

    this.element.appendChild(el('div', { className: 'context-menu__separator' }));
    this.element.appendChild(
      this.action(t('profilePopover.add'), () => {
        this.callbacks.onAdd();
        this.close();
      }),
    );
    this.element.appendChild(
      this.action(t('profilePopover.settings'), () => {
        this.callbacks.onEditProfile();
        this.close();
      }),
    );
    this.element.appendChild(
      this.action(t('profilePopover.appSettings'), () => {
        this.callbacks.onOpenSettings();
        this.close();
      }),
    );
  }

  private action(label: string, handler: () => void): HTMLElement {
    return btn(label, {
      className: 'profile-popover__action',
      attrs: { role: 'menuitem' },
      onClick: handler,
    });
  }
}
