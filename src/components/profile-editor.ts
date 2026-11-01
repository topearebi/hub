/**
 * Hub Profile Editor
 * ------------------
 * Modal for editing the active profile: name, custom Hub title, avatar, custom
 * logo, default search engine, and theme override. Uploaded images are scaled
 * and compressed client-side (see `core/image.ts`) before being stored.
 */

import { el, svg } from '../utils/dom';
import { compressImageFile } from '../core/image';
import type { AppConfig, ProfileItem } from '../types/schemas';

const ICON_CLOSE = 'M18 6 6 18M6 6l12 12';

export interface ProfileEditorStore {
  readonly activeProfile: ProfileItem | null;
  readonly appConfig: AppConfig;
}

export interface ProfileEditorCallbacks {
  onSave: (patch: Partial<ProfileItem>) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

/** Wrap an input in a labelled field. */
function field(labelText: string, input: HTMLElement): HTMLElement {
  const label = el('label', { className: 'field' });
  label.appendChild(el('span', { className: 'field__label', text: labelText }));
  label.appendChild(input);
  return label;
}

export class ProfileEditor {
  readonly element: HTMLElement;

  private readonly nameInput: HTMLInputElement;
  private readonly titleInput: HTMLInputElement;
  private readonly engineSelect: HTMLSelectElement;
  private readonly themeSelect: HTMLSelectElement;
  private readonly avatarInput: HTMLInputElement;
  private readonly logoInput: HTMLInputElement;
  private readonly avatarPreview: HTMLElement;
  private readonly logoPreview: HTMLElement;
  private readonly removeAvatarButton: HTMLButtonElement;
  private readonly removeLogoButton: HTMLButtonElement;
  private readonly statusEl: HTMLElement;

  private avatarData: string | undefined;
  private logoData: string | undefined;

  constructor(
    private readonly store: ProfileEditorStore,
    private readonly callbacks: ProfileEditorCallbacks,
  ) {
    this.nameInput = el('input', {
      attrs: { type: 'text', placeholder: 'Profile name', 'aria-label': 'Profile name' },
    });
    this.titleInput = el('input', {
      attrs: { type: 'text', placeholder: 'Hub title', 'aria-label': 'Hub title' },
    });
    this.engineSelect = el('select', { attrs: { 'aria-label': 'Default search engine' } });
    this.themeSelect = el('select', { attrs: { 'aria-label': 'Theme' } });
    for (const theme of ['auto', 'light', 'dark'] as const) {
      this.themeSelect.appendChild(el('option', { text: theme, attrs: { value: theme } }));
    }

    this.avatarInput = el('input', {
      attrs: { type: 'file', accept: 'image/*', 'aria-label': 'Upload avatar' },
    });
    this.logoInput = el('input', {
      attrs: { type: 'file', accept: 'image/*', 'aria-label': 'Upload logo' },
    });
    this.avatarPreview = el('span', { className: 'profile-editor__preview' });
    this.logoPreview = el('span', { className: 'profile-editor__preview' });

    // "Remove" controls let the user clear a previously stored image. They are
    // only shown while an image is present (see `updateRemoveButtons`).
    this.removeAvatarButton = el('button', {
      className: 'button',
      text: 'Remove',
      attrs: { type: 'button', 'aria-label': 'Remove avatar' },
    });
    this.removeAvatarButton.addEventListener('click', () => {
      this.avatarData = undefined;
      this.renderPreview(this.avatarPreview, undefined);
      this.updateRemoveButtons();
    });
    this.removeLogoButton = el('button', {
      className: 'button',
      text: 'Remove',
      attrs: { type: 'button', 'aria-label': 'Remove logo' },
    });
    this.removeLogoButton.addEventListener('click', () => {
      this.logoData = undefined;
      this.renderPreview(this.logoPreview, undefined);
      this.updateRemoveButtons();
    });

    this.statusEl = el('p', {
      className: 'settings-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    this.avatarInput.addEventListener('change', () => {
      void this.handleUpload(this.avatarInput, (data) => {
        this.avatarData = data;
        this.renderPreview(this.avatarPreview, data);
      });
    });
    this.logoInput.addEventListener('change', () => {
      void this.handleUpload(this.logoInput, (data) => {
        this.logoData = data;
        this.renderPreview(this.logoPreview, data);
      });
    });

    this.element = this.build();
  }

  open(): void {
    this.render();
    this.element.classList.add('is-open');
    this.nameInput.focus();
  }

  close(): void {
    this.element.classList.remove('is-open');
  }

  private build(): HTMLElement {
    const closeButton = el('button', {
      className: 'icon-button modal__close',
      attrs: { type: 'button', 'aria-label': 'Close profile editor' },
    });
    closeButton.appendChild(svg(ICON_CLOSE));
    closeButton.addEventListener('click', () => this.close());

    const title = el('h2', { className: 'modal__title', text: 'Profile settings' });
    const header = el('header', { className: 'modal__header', children: [title, closeButton] });

    const saveButton = el('button', {
      className: 'button button--primary',
      text: 'Save',
      attrs: { type: 'button' },
    });
    saveButton.addEventListener('click', () => {
      void this.handleSave();
    });

    const deleteButton = el('button', {
      className: 'button',
      text: 'Delete profile',
      attrs: { type: 'button' },
    });
    deleteButton.addEventListener('click', () => {
      void this.callbacks.onDelete();
      this.close();
    });

    const actions = el('div', {
      className: 'settings-actions',
      children: [deleteButton, saveButton],
    });

    const body = el('div', {
      className: 'modal__body',
      children: [
        field('Profile name', this.nameInput),
        field('Hub title', this.titleInput),
        field('Default search engine', this.engineSelect),
        field('Theme', this.themeSelect),
        field('Avatar', this.avatarInput),
        el('div', {
          className: 'profile-editor__preview-row',
          children: [this.avatarPreview, this.removeAvatarButton],
        }),
        field('Custom logo', this.logoInput),
        el('div', {
          className: 'profile-editor__preview-row',
          children: [this.logoPreview, this.removeLogoButton],
        }),
        this.statusEl,
        actions,
      ],
    });

    const dialog = el('div', {
      className: 'modal',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Profile settings' },
      children: [header, body],
    });
    const overlay = el('div', { className: 'modal-overlay', children: [dialog] });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.close();
      }
    });
    return overlay;
  }

  private render(): void {
    const profile = this.store.activeProfile;
    this.nameInput.value = profile?.name ?? '';
    this.titleInput.value = profile?.hub_title ?? '';
    this.avatarData = profile?.avatar;
    this.logoData = profile?.logo;
    this.renderPreview(this.avatarPreview, profile?.avatar);
    this.renderPreview(this.logoPreview, profile?.logo);
    this.updateRemoveButtons();

    this.engineSelect.replaceChildren();
    for (const provider of this.store.appConfig.search_providers) {
      this.engineSelect.appendChild(
        el('option', { text: provider.name, attrs: { value: provider.id } }),
      );
    }
    this.engineSelect.value = profile?.default_search_provider_id ?? '';
    this.themeSelect.value = profile?.theme ?? 'auto';
    this.statusEl.textContent = '';
  }

  private renderPreview(target: HTMLElement, data: string | undefined): void {
    target.replaceChildren();
    if (data) {
      target.appendChild(el('img', { attrs: { src: data, alt: '' } }));
    }
  }

  /** Show each "Remove" control only when its image is present. */
  private updateRemoveButtons(): void {
    this.removeAvatarButton.hidden = !this.avatarData;
    this.removeLogoButton.hidden = !this.logoData;
  }

  private async handleUpload(
    input: HTMLInputElement,
    apply: (data: string) => void,
  ): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    try {
      this.statusEl.textContent = 'Processing image…';
      const data = await compressImageFile(file);
      apply(data);
      this.statusEl.textContent = 'Image ready.';
    } catch {
      this.statusEl.textContent = 'Could not process that image.';
    }
  }

  private async handleSave(): Promise<void> {
    const patch: Partial<ProfileItem> = {
      name: this.nameInput.value.trim() || 'Profile',
      hub_title: this.titleInput.value.trim(),
      default_search_provider_id: this.engineSelect.value,
      theme: this.themeSelect.value as 'auto' | 'light' | 'dark',
    };
    // Always write the current value (including an empty string) so the
    // "Remove" control can clear a previously stored image.
    patch.avatar = this.avatarData ?? '';
    patch.logo = this.logoData ?? '';

    await this.callbacks.onSave(patch);
    this.statusEl.textContent = 'Profile saved.';
    this.close();
  }
}
