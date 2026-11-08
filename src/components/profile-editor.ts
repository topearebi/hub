/**
 * Hub Profile Editor
 * ------------------
 * Modal for editing the active profile: name, custom Hub title, avatar, custom
 * logo, default search engine, and theme override. Uploaded images are scaled
 * and compressed client-side (see `core/image.ts`) before being stored.
 */

import { el, svg, ICON_CLOSE } from '../utils/dom';
import { Dialog } from '../utils/dialog';
import { t } from '../utils/i18n';
import { compressImageFile } from '../core/image';
import type { AppConfig, ProfileItem } from '../types/schemas';

let profileDialogSeq = 0;

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

  private readonly dialog: Dialog;
  private readonly titleId: string;
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
    profileDialogSeq += 1;
    this.titleId = `profile-editor-title-${profileDialogSeq}`;
    this.dialog = new Dialog({
      labelledBy: this.titleId,
      sheet: true,
      onRequestClose: () => this.close(),
    });

    this.nameInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: t('profileEditor.namePlaceholder'),
        'aria-label': t('profileEditor.nameAria'),
      },
    });
    this.titleInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: t('profileEditor.hubTitlePlaceholder'),
        'aria-label': t('profileEditor.hubTitleAria'),
      },
    });
    this.engineSelect = el('select', { attrs: { 'aria-label': t('profileEditor.engineAria') } });
    this.themeSelect = el('select', { attrs: { 'aria-label': t('profileEditor.themeAria') } });
    for (const theme of ['auto', 'light', 'dark'] as const) {
      this.themeSelect.appendChild(
        el('option', { text: t(`theme.${theme}`), attrs: { value: theme } }),
      );
    }

    this.avatarInput = el('input', {
      attrs: { type: 'file', accept: 'image/*', 'aria-label': t('profileEditor.uploadAvatarAria') },
    });
    this.logoInput = el('input', {
      attrs: { type: 'file', accept: 'image/*', 'aria-label': t('profileEditor.uploadLogoAria') },
    });
    this.avatarPreview = el('span', { className: 'profile-editor__preview' });
    this.logoPreview = el('span', { className: 'profile-editor__preview' });

    // "Remove" controls let the user clear a previously stored image. They are
    // only shown while an image is present (see `updateRemoveButtons`).
    this.removeAvatarButton = el('button', {
      className: 'button',
      text: t('common.remove'),
      attrs: { type: 'button', 'aria-label': t('profileEditor.removeAvatarAria') },
    });
    this.removeAvatarButton.addEventListener('click', () => {
      this.avatarData = undefined;
      this.renderPreview(this.avatarPreview, undefined);
      this.updateRemoveButtons();
    });
    this.removeLogoButton = el('button', {
      className: 'button',
      text: t('common.remove'),
      attrs: { type: 'button', 'aria-label': t('profileEditor.removeLogoAria') },
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
    this.dialog.open(this.nameInput);
  }

  close(): void {
    this.dialog.close();
  }

  private build(): HTMLElement {
    const closeButton = el('button', {
      className: 'icon-button modal__close',
      attrs: { type: 'button', 'aria-label': t('profileEditor.closeAria') },
    });
    closeButton.appendChild(svg(ICON_CLOSE));
    closeButton.addEventListener('click', () => this.close());

    const title = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: t('profileEditor.heading'),
    });
    const header = el('header', { className: 'modal__header', children: [title, closeButton] });

    const saveButton = el('button', {
      className: 'button button--primary',
      text: t('common.save'),
      attrs: { type: 'button' },
    });
    saveButton.addEventListener('click', () => {
      void this.handleSave();
    });

    const deleteButton = el('button', {
      className: 'button button--danger',
      text: t('profileEditor.deleteProfile'),
      attrs: { type: 'button' },
    });
    deleteButton.addEventListener('click', () => {
      void this.handleDelete();
    });

    const actions = el('div', {
      className: 'settings-actions',
      children: [deleteButton, saveButton],
    });

    const body = el('div', {
      className: 'modal__body',
      children: [
        field(t('profileEditor.fieldName'), this.nameInput),
        field(t('profileEditor.fieldHubTitle'), this.titleInput),
        field(t('profileEditor.fieldEngine'), this.engineSelect),
        field(t('profileEditor.fieldTheme'), this.themeSelect),
        field(t('profileEditor.fieldAvatar'), this.avatarInput),
        el('div', {
          className: 'profile-editor__preview-row',
          children: [this.avatarPreview, this.removeAvatarButton],
        }),
        field(t('profileEditor.fieldLogo'), this.logoInput),
        el('div', {
          className: 'profile-editor__preview-row',
          children: [this.logoPreview, this.removeLogoButton],
        }),
        this.statusEl,
        actions,
      ],
    });

    this.dialog.content.appendChild(header);
    this.dialog.content.appendChild(body);
    return this.dialog.overlay;
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

  /** Delete the profile (the host confirms + guards the last profile), then close. */
  private async handleDelete(): Promise<void> {
    await this.callbacks.onDelete();
    this.close();
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
      this.statusEl.textContent = t('profileEditor.processing');
      const data = await compressImageFile(file);
      apply(data);
      this.statusEl.textContent = t('profileEditor.imageReady');
    } catch {
      this.statusEl.textContent = t('profileEditor.imageError');
    }
  }

  private async handleSave(): Promise<void> {
    const patch: Partial<ProfileItem> = {
      name: this.nameInput.value.trim() || t('profileEditor.defaultName'),
      hub_title: this.titleInput.value.trim(),
      default_search_provider_id: this.engineSelect.value,
      theme: this.themeSelect.value as 'auto' | 'light' | 'dark',
    };
    // Always write the current value (including an empty string) so the
    // "Remove" control can clear a previously stored image.
    patch.avatar = this.avatarData ?? '';
    patch.logo = this.logoData ?? '';

    await this.callbacks.onSave(patch);
    this.statusEl.textContent = t('profileEditor.saved');
    this.close();
  }
}
