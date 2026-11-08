/**
 * Hub Search Engine Manager
 * -------------------------
 * Dialog allowing users to view, add, edit, and delete search engine providers,
 * or select the default search engine. Built on the shared `Dialog` primitive
 * (focus trap, background inert, Escape, focus restore).
 *
 * All icons and presets are offline/local (PRD §2, AGENTS.md §1).
 */

import {
  btn,
  clearChildren,
  el,
  field,
  iconBtn,
  ICON_CLOSE,
  ICON_PLUS,
  ICON_TRASH,
} from '../utils/dom';
import { confirmDialog, Dialog } from '../utils/dialog';
import { t } from '../utils/i18n';
import { showToast } from './toast';
import { newId } from '../utils/crypto';
import { compressImageFile } from '../core/image';
import { matchPresetEngine, renderSearchEngineIcon, SEARCH_PRESETS } from '../utils/search-icons';
import type { AppConfig, SearchProvider } from '../types/schemas';

const ICON_EDIT = 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z';

export interface SearchEngineManagerStore {
  readonly appConfig: AppConfig;
  updateConfig(patch: Partial<AppConfig>): Promise<AppConfig | void>;
}

export interface SearchEngineManagerCallbacks {
  onClose?: () => void;
  onChanged?: () => void;
}

let searchEngineDialogSeq = 0;

/**
 * Pure validation helper for search provider name and query URL.
 */
export function validateSearchProvider(
  name: string,
  queryUrl: string,
): { valid: boolean; errorKey?: string } {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { valid: false, errorKey: 'searchEngines.nameRequired' };
  }
  const trimmedUrl = queryUrl.trim();
  if (!trimmedUrl.includes('%s')) {
    return { valid: false, errorKey: 'searchEngines.queryUrlInvalid' };
  }
  try {
    const parsed = new URL(trimmedUrl.replace(/%s/g, 'test'));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, errorKey: 'searchEngines.queryUrlInvalid' };
    }
  } catch {
    return { valid: false, errorKey: 'searchEngines.queryUrlInvalid' };
  }
  return { valid: true };
}

/**
 * Read and compress an uploaded icon file to a minimal local data URL.
 */
export async function processUploadedIcon(file: File): Promise<string> {
  if (file.type === 'image/svg+xml') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }
  return compressImageFile(file, { maxSize: 64 });
}

export class SearchEngineManager {
  readonly element: HTMLElement;

  private readonly dialog: Dialog;
  private readonly titleId: string;
  private readonly headerTitleEl: HTMLElement;
  private readonly listContainer: HTMLElement;
  private readonly formContainer: HTMLElement;

  // Form elements
  private readonly presetSelect: HTMLSelectElement;
  private readonly nameInput: HTMLInputElement;
  private readonly urlInput: HTMLInputElement;
  private readonly defaultCheckbox: HTMLInputElement;
  private readonly iconPreview: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly removeIconBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly formTitleEl: HTMLElement;

  private editingProvider: SearchProvider | null = null;
  private currentIcon: string | undefined = undefined;

  constructor(
    private readonly store: SearchEngineManagerStore,
    private readonly callbacks: SearchEngineManagerCallbacks = {},
  ) {
    searchEngineDialogSeq += 1;
    this.titleId = `dlg-title-se-${searchEngineDialogSeq}`;

    this.dialog = new Dialog({
      labelledBy: this.titleId,
      onRequestClose: () => this.close(),
    });

    this.headerTitleEl = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: t('searchEngines.title'),
    });

    const closeBtn = iconBtn(
      ICON_CLOSE,
      t('searchEngines.closeAria'),
      () => this.close(),
      'icon-button',
      18,
    );

    const header = el('header', {
      className: 'modal__header',
      children: [this.headerTitleEl, closeBtn],
    });

    this.listContainer = el('div');
    this.formContainer = el('div');
    this.formContainer.hidden = true;

    // Build form view fields
    this.formTitleEl = el('h3', { className: 'engine-form__title' });

    this.presetSelect = el('select', {
      className: 'drawer__select',
      attrs: { 'aria-label': t('searchEngines.preset') },
      children: [
        el('option', { text: t('searchEngines.choosePreset'), attrs: { value: '' } }),
        ...SEARCH_PRESETS.map((p) => el('option', { text: p.name, attrs: { value: p.id } })),
        el('option', { text: t('searchEngines.custom'), attrs: { value: 'custom' } }),
      ],
    });

    this.presetSelect.addEventListener('change', () => this.onPresetSelected());

    this.nameInput = el('input', {
      className: 'drawer__input',
      attrs: {
        type: 'text',
        placeholder: t('searchEngines.namePlaceholder'),
        'aria-label': t('searchEngines.name'),
        required: '',
      },
    });
    this.nameInput.addEventListener('input', () => this.updateIconPreview());

    this.urlInput = el('input', {
      className: 'drawer__input',
      attrs: {
        type: 'text',
        placeholder: t('searchEngines.queryUrlPlaceholder'),
        'aria-label': t('searchEngines.queryUrl'),
        required: '',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
    this.urlInput.addEventListener('input', () => this.updateIconPreview());

    this.iconPreview = el('div', { className: 'engine-form__preview' });

    this.fileInput = el('input', {
      className: 'sr-only',
      attrs: {
        type: 'file',
        accept: 'image/png, image/jpeg, image/svg+xml, image/webp',
      },
    });
    this.fileInput.addEventListener('change', () => void this.onFileSelected());

    const uploadBtn = btn(t('searchEngines.uploadIcon'), {
      className: 'button--subtle',
      onClick: () => this.fileInput.click(),
    });

    this.removeIconBtn = btn(t('searchEngines.removeIcon'), {
      className: 'button--subtle',
      onClick: () => {
        this.currentIcon = undefined;
        this.updateIconPreview();
      },
    });

    const iconControls = el('div', {
      className: 'engine-form__icons',
      children: [this.iconPreview, uploadBtn, this.removeIconBtn, this.fileInput],
    });

    this.defaultCheckbox = el('input', {
      className: 'engine-form__checkbox',
      attrs: { type: 'checkbox' },
    });
    const defaultLabel = el('label', {
      className: 'engine-form__check-label',
      children: [this.defaultCheckbox, el('span', { text: t('searchEngines.isDefault') })],
    });

    this.statusEl = el('p', {
      className: 'settings-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const cancelBtn = btn(t('common.cancel'), {
      className: 'button--subtle',
      onClick: () => this.showList(),
    });

    const saveBtn = btn(t('common.save'), {
      className: 'button--primary',
      onClick: () => void this.saveEngine(),
    });

    const formButtons = el('div', {
      className: 'engine-form__buttons',
      children: [cancelBtn, saveBtn],
    });

    const formFields = el('div', {
      className: 'engine-form__fields',
      children: [
        this.formTitleEl,
        field(t('searchEngines.preset'), this.presetSelect),
        field(t('searchEngines.name'), this.nameInput),
        field(
          t('searchEngines.queryUrl'),
          el('div', {
            children: [
              this.urlInput,
              el('p', { className: 'field__hint', text: t('searchEngines.queryUrlHint') }),
            ],
          }),
        ),
        field(t('searchEngines.icon'), iconControls),
        defaultLabel,
        this.statusEl,
        formButtons,
      ],
    });
    this.formContainer.appendChild(formFields);

    const body = el('div', {
      className: 'modal__body',
      children: [this.listContainer, this.formContainer],
    });

    this.dialog.content.appendChild(header);
    this.dialog.content.appendChild(body);
    this.element = this.dialog.overlay;
  }

  open(): void {
    this.showList();
    this.dialog.open();
  }

  close(): void {
    this.dialog.close();
    this.callbacks.onClose?.();
  }

  isOpen(): boolean {
    return this.dialog.isOpen();
  }

  destroy(): void {
    this.dialog.destroy();
  }

  /* ---------------------------------------------------------------- */
  /* List View                                                        */
  /* ---------------------------------------------------------------- */

  private showList(): void {
    this.headerTitleEl.textContent = t('searchEngines.title');
    this.formContainer.hidden = true;
    this.listContainer.hidden = false;
    this.renderList();
  }

  private renderList(): void {
    clearChildren(this.listContainer);
    const providers = this.store.appConfig.search_providers;

    const subtitle = el('p', {
      className: 'modal__subtitle',
      text: t('searchEngines.subtitle'),
    });

    const addBtn = btn(t('searchEngines.add'), {
      className: 'button--primary search-engine-manager__add-btn',
      icon: ICON_PLUS,
      onClick: () => this.showAddForm(),
    });

    const topBar = el('div', {
      className: 'engine-mgr__bar',
      children: [subtitle, addBtn],
    });

    const list = el('div', {
      className: 'engine-mgr__list',
      children: providers.map((provider) => this.renderProviderRow(provider, providers.length)),
    });

    this.listContainer.append(topBar, list);
  }

  private renderProviderRow(provider: SearchProvider, totalCount: number): HTMLElement {
    const isDef = provider.is_default;
    const nameLine = el('div', {
      className: 'engine-row__line',
      children: [
        el('span', { className: 'engine-row__name', text: provider.name }),
        ...(isDef
          ? [
              el('span', {
                className: 'search-engine-row__badge',
                text: t('searchEngines.isDefault'),
              }),
            ]
          : []),
      ],
    });

    const editBtn = iconBtn(
      ICON_EDIT,
      t('searchEngines.editAria', { name: provider.name }),
      () => this.showEditForm(provider),
      'icon-button',
      16,
    );

    const deleteBtn = iconBtn(
      ICON_TRASH,
      t('searchEngines.deleteAria', { name: provider.name }),
      totalCount <= 1 ? undefined : () => void this.deleteEngine(provider),
      'icon-button icon-button--danger',
      16,
    );
    if (totalCount <= 1) {
      deleteBtn.disabled = true;
      deleteBtn.title = t('searchEngines.needsOne');
    }

    const actionsChildren: HTMLElement[] = [];
    if (!isDef) {
      actionsChildren.push(
        btn(t('searchEngines.makeDefault'), {
          className: 'button--subtle search-engine-row__default-btn',
          onClick: () => void this.setDefault(provider.id),
        }),
      );
    }
    actionsChildren.push(editBtn, deleteBtn);

    return el('div', {
      className: 'search-engine-row',
      children: [
        el('div', {
          className: 'engine-row__icon',
          children: [renderSearchEngineIcon(provider, 24)],
        }),
        el('div', {
          className: 'engine-row__info',
          children: [
            nameLine,
            el('div', { className: 'engine-row__url', text: provider.query_url }),
          ],
        }),
        el('div', { className: 'engine-row__actions', children: actionsChildren }),
      ],
    });
  }

  private async setDefault(providerId: string): Promise<void> {
    const providers = this.store.appConfig.search_providers.map((p) => ({
      ...p,
      is_default: p.id === providerId,
    }));
    await this.store.updateConfig({ search_providers: providers });
    this.renderList();
    this.callbacks.onChanged?.();
  }

  private async deleteEngine(provider: SearchProvider): Promise<void> {
    const currentProviders = this.store.appConfig.search_providers;
    if (currentProviders.length <= 1) {
      showToast(t('searchEngines.needsOne'), { variant: 'warning' });
      return;
    }

    const confirmed = await confirmDialog({
      title: t('common.delete'),
      message: t('searchEngines.deleteConfirm', { name: provider.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    const newProviders: SearchProvider[] = currentProviders.filter((p) => p.id !== provider.id);
    const first = newProviders[0];
    if (provider.is_default && first) {
      newProviders[0] = { ...first, is_default: true };
    }

    await this.store.updateConfig({ search_providers: newProviders });
    this.renderList();
    this.callbacks.onChanged?.();

    showToast(t('searchEngines.deleted'), {
      variant: 'info',
      action: {
        label: t('common.undo'),
        onSelect: () => {
          void this.store.updateConfig({ search_providers: currentProviders }).then(() => {
            this.renderList();
            this.callbacks.onChanged?.();
          });
        },
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Form View                                                        */
  /* ---------------------------------------------------------------- */

  private showAddForm(): void {
    this.editingProvider = null;
    this.currentIcon = undefined;
    this.formTitleEl.textContent = t('searchEngines.add');
    this.presetSelect.value = '';
    this.nameInput.value = '';
    this.urlInput.value = '';
    this.defaultCheckbox.checked = false;
    this.statusEl.textContent = '';
    this.nameInput.removeAttribute('aria-invalid');
    this.urlInput.removeAttribute('aria-invalid');

    this.listContainer.hidden = true;
    this.formContainer.hidden = false;
    this.updateIconPreview();
    this.nameInput.focus();
  }

  private showEditForm(provider: SearchProvider): void {
    this.editingProvider = provider;
    this.currentIcon = provider.icon;
    this.formTitleEl.textContent = t('searchEngines.edit');

    const matchedPreset = SEARCH_PRESETS.find(
      (p) =>
        (p.icon ?? p.id) === provider.icon || p.name.toLowerCase() === provider.name.toLowerCase(),
    );
    this.presetSelect.value = matchedPreset ? matchedPreset.id : 'custom';

    this.nameInput.value = provider.name;
    this.urlInput.value = provider.query_url;
    this.defaultCheckbox.checked = provider.is_default;
    this.defaultCheckbox.disabled = provider.is_default; // Already default cannot be unchecked directly
    this.statusEl.textContent = '';
    this.nameInput.removeAttribute('aria-invalid');
    this.urlInput.removeAttribute('aria-invalid');

    this.listContainer.hidden = true;
    this.formContainer.hidden = false;
    this.updateIconPreview();
    this.nameInput.focus();
  }

  private onPresetSelected(): void {
    const presetId = this.presetSelect.value;
    if (!presetId || presetId === 'custom') {
      return;
    }
    const preset = SEARCH_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    this.nameInput.value = preset.name;
    this.urlInput.value = preset.query_url;
    this.currentIcon = preset.icon ?? preset.id;
    this.statusEl.textContent = '';
    this.updateIconPreview();
  }

  private async onFileSelected(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) {
      return;
    }
    try {
      this.currentIcon = await processUploadedIcon(file);
      this.presetSelect.value = 'custom';
      this.updateIconPreview();
    } catch {
      this.statusEl.textContent = 'Failed to load icon image';
    } finally {
      this.fileInput.value = '';
    }
  }

  private updateIconPreview(): void {
    clearChildren(this.iconPreview);
    const mockProvider: SearchProvider = {
      id: this.editingProvider?.id ?? 'preview',
      name: this.nameInput.value || '?',
      query_url: this.urlInput.value || '',
      is_default: false,
      ...(this.currentIcon ? { icon: this.currentIcon } : {}),
    };
    this.iconPreview.appendChild(renderSearchEngineIcon(mockProvider, 32));
    this.removeIconBtn.hidden = !this.currentIcon;
  }

  private async saveEngine(): Promise<void> {
    const name = this.nameInput.value.trim();
    const queryUrl = this.urlInput.value.trim();

    const validation = validateSearchProvider(name, queryUrl);
    if (!validation.valid && validation.errorKey) {
      this.statusEl.textContent = t(validation.errorKey);
      if (validation.errorKey === 'searchEngines.nameRequired') {
        this.nameInput.setAttribute('aria-invalid', 'true');
        this.nameInput.focus();
      } else {
        this.urlInput.setAttribute('aria-invalid', 'true');
        this.urlInput.focus();
      }
      return;
    }

    const providers: SearchProvider[] = [...this.store.appConfig.search_providers];
    const isDefault = this.defaultCheckbox.checked;

    const iconToSave = this.currentIcon || matchPresetEngine(name, queryUrl) || undefined;

    if (this.editingProvider) {
      const idx = providers.findIndex((p) => p.id === this.editingProvider?.id);
      const existing = providers[idx];
      if (idx >= 0 && existing) {
        providers[idx] = {
          id: existing.id,
          name,
          query_url: queryUrl,
          is_default: isDefault,
          ...(iconToSave ? { icon: iconToSave } : {}),
        };
      }
    } else {
      const newProvider: SearchProvider = {
        id: `sp_${newId()}`,
        name,
        query_url: queryUrl,
        is_default: isDefault || providers.length === 0,
        ...(iconToSave ? { icon: iconToSave } : {}),
      };
      providers.push(newProvider);
    }

    if (isDefault) {
      const targetId = this.editingProvider?.id ?? providers[providers.length - 1]?.id;
      for (let i = 0; i < providers.length; i += 1) {
        const p = providers[i];
        if (p) {
          providers[i] = {
            ...p,
            is_default: p.id === targetId,
          };
        }
      }
    }

    await this.store.updateConfig({ search_providers: providers });
    showToast(t('searchEngines.saved'), { variant: 'success' });
    this.callbacks.onChanged?.();
    this.showList();
  }
}
