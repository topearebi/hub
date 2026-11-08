/**
 * Hub Search Engine Manager
 * -------------------------
 * Dialog allowing users to view, add, edit, and delete search engine providers,
 * or select the default search engine. Built on the shared `Dialog` primitive
 * (focus trap, background inert, Escape, focus restore).
 *
 * All icons and presets are offline/local (PRD §2, AGENTS.md §1).
 */

import { clearChildren, el, svg, ICON_CLOSE, ICON_PLUS, ICON_TRASH } from '../utils/dom';
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
    this.titleId = `search-engines-title-${searchEngineDialogSeq}`;

    this.dialog = new Dialog({
      labelledBy: this.titleId,
      onRequestClose: () => this.close(),
    });

    this.headerTitleEl = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: t('searchEngines.title'),
    });

    const closeBtn = el('button', {
      className: 'icon-button',
      attrs: {
        type: 'button',
        'aria-label': t('searchEngines.closeAria'),
      },
      children: [svg(ICON_CLOSE, { size: 18 })],
    });
    closeBtn.addEventListener('click', () => this.close());

    const header = el('header', {
      className: 'modal__header',
      children: [this.headerTitleEl, closeBtn],
    });

    // List view container
    this.listContainer = el('div', { className: 'search-engine-manager__list-view' });

    // Form view container
    this.formContainer = el('div', { className: 'search-engine-manager__form-view' });
    this.formContainer.hidden = true;

    // Build form view fields
    this.formTitleEl = el('h3', { className: 'search-engine-form__title' });

    this.presetSelect = el('select', {
      className: 'drawer__select',
      attrs: { 'aria-label': t('searchEngines.preset') },
    });
    this.presetSelect.appendChild(
      el('option', { text: t('searchEngines.choosePreset'), attrs: { value: '' } }),
    );
    for (const preset of SEARCH_PRESETS) {
      this.presetSelect.appendChild(
        el('option', { text: preset.name, attrs: { value: preset.id } }),
      );
    }
    this.presetSelect.appendChild(
      el('option', { text: t('searchEngines.custom'), attrs: { value: 'custom' } }),
    );

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

    this.iconPreview = el('div', { className: 'search-engine-form__icon-preview' });

    this.fileInput = el('input', {
      className: 'sr-only',
      attrs: {
        type: 'file',
        accept: 'image/png, image/jpeg, image/svg+xml, image/webp',
      },
    });
    this.fileInput.addEventListener('change', () => void this.onFileSelected());

    const uploadBtn = el('button', {
      className: 'button button--subtle',
      attrs: { type: 'button' },
      text: t('searchEngines.uploadIcon'),
    });
    uploadBtn.addEventListener('click', () => this.fileInput.click());

    this.removeIconBtn = el('button', {
      className: 'button button--subtle',
      attrs: { type: 'button' },
      text: t('searchEngines.removeIcon'),
    });
    this.removeIconBtn.addEventListener('click', () => {
      this.currentIcon = undefined;
      this.updateIconPreview();
    });

    const iconControls = el('div', {
      className: 'search-engine-form__icon-controls',
      children: [this.iconPreview, uploadBtn, this.removeIconBtn, this.fileInput],
    });

    this.defaultCheckbox = el('input', {
      className: 'search-engine-form__checkbox',
      attrs: { type: 'checkbox' },
    });
    const defaultLabel = el('label', {
      className: 'search-engine-form__checkbox-label',
      children: [this.defaultCheckbox, el('span', { text: t('searchEngines.isDefault') })],
    });

    this.statusEl = el('p', {
      className: 'settings-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const cancelBtn = el('button', {
      className: 'button button--subtle',
      attrs: { type: 'button' },
      text: t('common.cancel'),
    });
    cancelBtn.addEventListener('click', () => this.showList());

    const saveBtn = el('button', {
      className: 'button button--primary',
      attrs: { type: 'button' },
      text: t('common.save'),
    });
    saveBtn.addEventListener('click', () => void this.saveEngine());

    const formButtons = el('div', {
      className: 'search-engine-form__buttons',
      children: [cancelBtn, saveBtn],
    });

    const urlHint = el('p', {
      className: 'field__hint',
      text: t('searchEngines.queryUrlHint'),
    });

    const formFields = el('div', {
      className: 'search-engine-form__fields',
      children: [
        this.formTitleEl,
        this.wrapField(t('searchEngines.preset'), this.presetSelect),
        this.wrapField(t('searchEngines.name'), this.nameInput),
        this.wrapField(
          t('searchEngines.queryUrl'),
          el('div', { children: [this.urlInput, urlHint] }),
        ),
        this.wrapField(t('searchEngines.icon'), iconControls),
        defaultLabel,
        this.statusEl,
        formButtons,
      ],
    });
    this.formContainer.appendChild(formFields);

    const body = el('div', {
      className: 'modal__body search-engine-manager__body',
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

    const addBtn = el('button', {
      className: 'button button--primary search-engine-manager__add-btn',
      attrs: { type: 'button' },
      children: [svg(ICON_PLUS, { size: 16 }), el('span', { text: t('searchEngines.add') })],
    });
    addBtn.addEventListener('click', () => this.showAddForm());

    const topBar = el('div', {
      className: 'search-engine-manager__top-bar',
      children: [subtitle, addBtn],
    });

    const list = el('div', { className: 'search-engine-manager__list' });

    for (const provider of providers) {
      const row = this.renderProviderRow(provider, providers.length);
      list.appendChild(row);
    }

    this.listContainer.appendChild(topBar);
    this.listContainer.appendChild(list);
  }

  private renderProviderRow(provider: SearchProvider, totalCount: number): HTMLElement {
    const row = el('div', { className: 'search-engine-row' });

    const iconWrap = el('div', {
      className: 'search-engine-row__icon',
      children: [renderSearchEngineIcon(provider, 24)],
    });

    const info = el('div', { className: 'search-engine-row__info' });
    const nameLine = el('div', { className: 'search-engine-row__name-line' });
    nameLine.appendChild(el('span', { className: 'search-engine-row__name', text: provider.name }));

    if (provider.is_default) {
      nameLine.appendChild(
        el('span', {
          className: 'search-engine-row__badge',
          text: t('searchEngines.isDefault'),
        }),
      );
    }

    const urlSnippet = el('div', {
      className: 'search-engine-row__url',
      text: provider.query_url,
    });

    info.appendChild(nameLine);
    info.appendChild(urlSnippet);

    const actions = el('div', { className: 'search-engine-row__actions' });

    if (!provider.is_default) {
      const makeDefaultBtn = el('button', {
        className: 'button button--subtle search-engine-row__default-btn',
        attrs: { type: 'button' },
        text: t('searchEngines.makeDefault'),
      });
      makeDefaultBtn.addEventListener('click', () => void this.setDefault(provider.id));
      actions.appendChild(makeDefaultBtn);
    }

    const editBtn = el('button', {
      className: 'icon-button',
      attrs: {
        type: 'button',
        'aria-label': t('searchEngines.editAria', { name: provider.name }),
      },
      children: [svg(ICON_EDIT, { size: 16 })],
    });
    editBtn.addEventListener('click', () => this.showEditForm(provider));
    actions.appendChild(editBtn);

    const deleteBtn = el('button', {
      className: 'icon-button icon-button--danger',
      attrs: {
        type: 'button',
        'aria-label': t('searchEngines.deleteAria', { name: provider.name }),
      },
      children: [svg(ICON_TRASH, { size: 16 })],
    });
    if (totalCount <= 1) {
      deleteBtn.disabled = true;
      deleteBtn.title = t('searchEngines.needsOne');
    } else {
      deleteBtn.addEventListener('click', () => void this.deleteEngine(provider));
    }
    actions.appendChild(deleteBtn);

    row.appendChild(iconWrap);
    row.appendChild(info);
    row.appendChild(actions);

    return row;
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

  private wrapField(labelText: string, control: HTMLElement): HTMLElement {
    const label = el('label', { className: 'field' });
    label.appendChild(el('span', { className: 'field__label', text: labelText }));
    label.appendChild(control);
    return label;
  }
}
