/**
 * Hub Bookmark Editor
 * -------------------
 * Modal for creating and editing bookmarks. Covers the full `BookmarkItem`
 * field set: title, primary URL, alternate/mirror URLs, category (with an
 * inline "new category" affordance), optional icon, and an `Alt + [1-9]` hotkey
 * slot.
 *
 * Following the NoteEditor pattern, the modal is built exclusively with the
 * XSS-safe `el()`/`svg()` helpers. The parsing and validation logic lives in
 * exported pure functions so it can be unit-tested without a DOM.
 */

import { btn, el, field, iconBtn, ICON_CLOSE } from '../utils/dom';
import { confirmDialog, Dialog } from '../utils/dialog';
import { t } from '../utils/i18n';
import { hostnameOf } from '../core/fallback';
import { newId } from '../utils/crypto';
import { isUrlLike, normalizeUrl } from './omnibar';
import { applyBookmarkWidgetStyles } from './bookmarks';
import type { BookmarkCardSize, BookmarkItem, CategoryItem } from '../types/schemas';

let bookmarkDialogSeq = 0;
/** Sentinel select value that reveals the inline new-category input. */
export const NEW_CATEGORY = '__new__';

/** Valid `Alt + [1-9]` hotkey slots (mirrors `BookmarkItem.hotkey`). */
export const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export type Hotkey = (typeof HOTKEYS)[number];

export const CARD_SIZES: readonly BookmarkCardSize[] = ['small', 'wide', 'large'] as const;

export interface WidgetPreset {
  id: string;
  nameKey: string;
  bg?: string | undefined;
  textColor?: string | undefined;
  border?: string | undefined;
}

const p = (
  id: string,
  nameKey: string,
  bg?: string,
  textColor?: string,
  border?: string,
): WidgetPreset => ({ id, nameKey, bg, textColor, border });

const cm = (pct: number) => `color-mix(in srgb, var(--text-main) ${pct}%, transparent)`;

export const WIDGET_PRESETS: readonly WidgetPreset[] = [
  p('default', 'bookmarkEditor.presetDefault'),
  p('slate', 'bookmarkEditor.presetSlate', '#1e293b', '#f8fafc', '#334155'),
  p(
    'sunset',
    'bookmarkEditor.presetSunset',
    'linear-gradient(135deg, #7c2d12, #9a3412)',
    '#ffffff',
    '#ea580c',
  ),
  p('sage', 'bookmarkEditor.presetSage', '#233831', '#e8f2ec', '#4f7565'),
  p('cyber', 'bookmarkEditor.presetCyber', '#0d1117', '#58a6ff', '#388bfd'),
  p('frost', 'bookmarkEditor.presetFrost', cm(6), 'inherit', cm(25)),
];

/** Coerce a card size value to a valid BookmarkCardSize, defaulting to 'small'. */
export function normalizeCardSize(value: string | undefined): BookmarkCardSize {
  return value === 'wide' || value === 'large' ? value : 'small';
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** Split a textarea of URLs into a clean, order-preserving, de-duplicated list. */
export function parseAlternateUrls(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const url = raw.trim();
    if (url.length === 0 || seen.has(url)) {
      continue;
    }
    seen.add(url);
    result.push(url);
  }
  return result;
}

/** Coerce a select value into a valid hotkey slot, or `undefined` (no hotkey). */
export function normalizeHotkey(value: string): Hotkey | undefined {
  return (HOTKEYS as readonly string[]).includes(value) ? (value as Hotkey) : undefined;
}

/** True when another live bookmark already owns the hotkey slot. */
export function isHotkeyTaken(
  hotkey: Hotkey,
  bookmarks: readonly BookmarkItem[],
  excludeId?: string,
): boolean {
  return bookmarks.some(
    (bookmark) =>
      bookmark.hotkey === hotkey && bookmark.id !== excludeId && bookmark.is_deleted !== true,
  );
}

export interface BookmarkFormInput {
  title: string;
  url: string;
  alternateText: string;
  descriptionText?: string;
  cardSize?: BookmarkCardSize | string;
  hotkey: string;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
}

export interface BookmarkValidationContext {
  bookmarks: readonly BookmarkItem[];
  /** Id of the bookmark being edited, so its own hotkey is not a conflict. */
  excludeId?: string | undefined;
}

export interface BookmarkValidation {
  ok: boolean;
  error?: string | undefined;
  /** Normalised fields, present only when `ok` is true. */
  title?: string | undefined;
  url?: string | undefined;
  alternateUrls?: string[] | undefined;
  description?: string | undefined;
  cardSize?: BookmarkCardSize | undefined;
  hotkey?: Hotkey | undefined;
  bgColor?: string | undefined;
  textColor?: string | undefined;
  borderColor?: string | undefined;
}

/**
 * Validate and normalise the editor's form values. Category selection is
 * resolved separately (it may require creating a category first).
 */
export function validateBookmarkForm(
  input: BookmarkFormInput,
  context: BookmarkValidationContext,
): BookmarkValidation {
  const rawUrl = input.url.trim();
  if (rawUrl.length === 0) {
    return { ok: false, error: t('bookmarkEditor.errorUrlRequired') };
  }
  if (!isUrlLike(rawUrl)) {
    return { ok: false, error: t('bookmarkEditor.errorUrlInvalid') };
  }

  const url = normalizeUrl(rawUrl);

  // Normalise each mirror URL, drop duplicates and any entry that simply
  // repeats the primary URL (a self-mirror is meaningless).
  const alternateUrls = parseAlternateUrls(input.alternateText)
    .map((entry) => (isUrlLike(entry) ? normalizeUrl(entry) : entry))
    .filter((entry, index, list) => entry !== url && list.indexOf(entry) === index);

  const hotkey = normalizeHotkey(input.hotkey);
  if (hotkey && isHotkeyTaken(hotkey, context.bookmarks, context.excludeId)) {
    return { ok: false, error: t('bookmarkEditor.errorHotkeyTaken', { key: hotkey }) };
  }

  const title = input.title.trim() || hostnameOf(url) || url;
  const cardSize = input.cardSize ? normalizeCardSize(input.cardSize) : 'small';
  const val = (s?: string) => {
    const t = s?.trim();
    return t && t.length > 0 ? t : undefined;
  };

  return {
    ok: true,
    title,
    url,
    alternateUrls,
    description: val(input.descriptionText),
    cardSize,
    hotkey,
    bgColor: val(input.bgColor),
    textColor: val(input.textColor),
    borderColor: val(input.borderColor),
  };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/** Read-only slice of the store the editor depends on (keeps it testable). */
export interface BookmarkEditorStore {
  readonly sortedCategories: CategoryItem[];
  readonly activeBookmarks: BookmarkItem[];
  readonly activeProfileId: string | null;
}

export interface BookmarkEditorCallbacks {
  onSave: (bookmark: BookmarkItem) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  /** Persist a new category and return it (the editor selects it on success). */
  onCreateCategory: (name: string) => Promise<CategoryItem>;
}

export class BookmarkEditor {
  readonly element: HTMLElement;

  private readonly dialog: Dialog;
  private readonly titleId: string;
  private readonly statusId: string;
  private readonly titleEl: HTMLElement;
  private readonly titleInput: HTMLInputElement;
  private readonly urlInput: HTMLInputElement;
  private readonly altInput: HTMLTextAreaElement;
  private readonly descriptionInput: HTMLTextAreaElement;
  private readonly cardSizeSelect: HTMLSelectElement;
  private readonly categorySelect: HTMLSelectElement;
  private readonly newCategoryInput: HTMLInputElement;
  private readonly newCategoryRow: HTMLElement;
  private readonly iconInput: HTMLInputElement;
  private readonly hotkeySelect: HTMLSelectElement;
  private readonly bgInput: HTMLInputElement;
  private readonly textInput: HTMLInputElement;
  private readonly borderInput: HTMLInputElement;
  private readonly previewCard: HTMLElement;
  private readonly previewTitle: HTMLElement;
  private readonly previewHotkey: HTMLElement;
  private readonly previewDesc: HTMLElement;
  private readonly previewIcon: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly deleteButton: HTMLButtonElement;

  private editing: BookmarkItem | null = null;
  private initialSnapshot = '';

  constructor(
    private readonly store: BookmarkEditorStore,
    private readonly callbacks: BookmarkEditorCallbacks,
  ) {
    const textDrawerInput = (ph: string, aria: string) =>
      el('input', {
        className: 'drawer__input',
        attrs: { type: 'text', placeholder: t(ph), 'aria-label': t(aria) },
      });
    const textarea = (ph: string, aria: string, rows = '2') =>
      el('textarea', {
        className: 'drawer__textarea',
        attrs: { placeholder: t(ph), 'aria-label': t(aria), rows },
      });

    this.titleInput = textDrawerInput(
      'bookmarkEditor.titlePlaceholder',
      'bookmarkEditor.titleAria',
    );
    this.urlInput = el('input', {
      className: 'drawer__input',
      attrs: {
        type: 'url',
        inputmode: 'url',
        placeholder: t('bookmarkEditor.urlPlaceholder'),
        'aria-label': t('bookmarkEditor.urlAria'),
        required: '',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
        enterkeyhint: 'go',
      },
    });
    this.altInput = textarea('bookmarkEditor.altPlaceholder', 'bookmarkEditor.altAria', '3');
    this.descriptionInput = textarea(
      'bookmarkEditor.descriptionPlaceholder',
      'bookmarkEditor.descriptionAria',
    );
    const sizeKeys: Record<BookmarkCardSize, string> = {
      small: 'bookmarkEditor.sizeSmall',
      wide: 'bookmarkEditor.sizeWide',
      large: 'bookmarkEditor.sizeLarge',
    };
    this.cardSizeSelect = el('select', {
      className: 'drawer__select',
      attrs: { 'aria-label': t('bookmarkEditor.cardSizeAria') },
      children: CARD_SIZES.map((sz) =>
        el('option', { text: t(sizeKeys[sz]), attrs: { value: sz } }),
      ),
    });
    this.categorySelect = el('select', {
      className: 'drawer__select',
      attrs: { 'aria-label': t('bookmarkEditor.categoryAria') },
    });
    this.newCategoryInput = textDrawerInput(
      'bookmarkEditor.newCategoryPlaceholder',
      'bookmarkEditor.newCategoryAria',
    );
    this.newCategoryRow = el('div', {
      className: 'bookmark-editor__new-category',
      children: [this.newCategoryInput],
    });
    this.newCategoryRow.hidden = true;
    this.iconInput = textDrawerInput('bookmarkEditor.iconPlaceholder', 'bookmarkEditor.iconAria');
    this.hotkeySelect = el('select', {
      className: 'drawer__select',
      attrs: { 'aria-label': t('bookmarkEditor.hotkeyAria') },
      children: [
        el('option', { text: t('common.none'), attrs: { value: '' } }),
        ...HOTKEYS.map((k) =>
          el('option', { text: t('bookmarkEditor.hotkeyOption', { key: k }), attrs: { value: k } }),
        ),
      ],
    });
    this.bgInput = textDrawerInput('bookmarkEditor.bgPlaceholder', 'bookmarkEditor.fieldBgColor');
    this.textInput = textDrawerInput(
      'bookmarkEditor.textPlaceholder',
      'bookmarkEditor.fieldTextColor',
    );
    this.borderInput = textDrawerInput(
      'bookmarkEditor.borderPlaceholder',
      'bookmarkEditor.fieldBorderColor',
    );

    this.previewTitle = el('span', {
      className: 'tile__title',
      text: t('bookmarkEditor.fieldTitle'),
    });
    this.previewHotkey = el('kbd', { className: 'tile__hotkey' });
    this.previewDesc = el('p', { className: 'tile__description' });
    this.previewIcon = el('span', { className: 'tile__icon tile__icon--fallback' });
    this.previewIcon.textContent = '★';
    const previewOpen = el('div', {
      className: 'tile__open',
      children: [this.previewIcon, this.previewTitle, this.previewHotkey, this.previewDesc],
    });
    this.previewCard = el('div', {
      className: 'tile tile--preview tile--size-small',
      attrs: { 'aria-hidden': 'true' },
      children: [previewOpen],
    });

    for (const ctrl of [
      this.titleInput,
      this.descriptionInput,
      this.bgInput,
      this.textInput,
      this.borderInput,
    ]) {
      ctrl.addEventListener('input', () => this.updateLivePreview());
    }
    this.cardSizeSelect.addEventListener('change', () => this.updateLivePreview());
    this.hotkeySelect.addEventListener('change', () => this.updateLivePreview());

    this.statusId = `dlg-status-be-${bookmarkDialogSeq}`;
    this.statusEl = el('p', {
      className: 'settings-status',
      attrs: { id: this.statusId, role: 'status', 'aria-live': 'polite' },
    });
    this.urlInput.setAttribute('aria-describedby', this.statusId);

    this.deleteButton = btn(t('common.delete'), { onClick: () => this.handleDelete() });

    bookmarkDialogSeq += 1;
    this.titleId = `dlg-title-be-${bookmarkDialogSeq}`;
    this.dialog = new Dialog({
      labelledBy: this.titleId,
      sheet: true,
      onRequestClose: () => this.requestClose(),
    });

    this.titleEl = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: t('bookmarkEditor.addHeading'),
    });

    this.element = this.build();
    this.categorySelect.addEventListener('change', () => this.syncNewCategoryVisibility());
  }

  /**
   * Open the editor. Passing a bookmark switches to edit mode; otherwise a new
   * bookmark is created, optionally prefilled with a URL/title.
   */
  open(bookmark?: BookmarkItem, prefill?: { url?: string; title?: string }): void {
    this.editing = bookmark ?? null;
    this.titleEl.textContent = bookmark
      ? t('bookmarkEditor.editHeading')
      : t('bookmarkEditor.addHeading');
    this.titleInput.value = bookmark?.title ?? prefill?.title ?? '';
    this.urlInput.value = bookmark?.url ?? prefill?.url ?? '';
    this.altInput.value = (bookmark?.alternate_urls ?? []).join('\n');
    this.descriptionInput.value = bookmark?.description ?? '';
    this.cardSizeSelect.value = bookmark?.card_size ?? 'small';
    this.iconInput.value = bookmark?.icon ?? '';
    this.hotkeySelect.value = bookmark?.hotkey ?? '';
    this.bgInput.value = bookmark?.bg_color ?? '';
    this.textInput.value = bookmark?.text_color ?? '';
    this.borderInput.value = bookmark?.border_color ?? '';
    this.updateLivePreview();
    this.newCategoryInput.value = '';
    this.statusEl.textContent = '';
    this.deleteButton.hidden = bookmark === undefined;
    this.renderCategories(
      bookmark?.category_id ?? this.store.sortedCategories[0]?.id ?? NEW_CATEGORY,
    );
    this.urlInput.removeAttribute('aria-invalid');
    this.dialog.open(bookmark ? this.titleInput : this.urlInput);
    this.initialSnapshot = this.snapshot();
  }

  private updateLivePreview(): void {
    const size = normalizeCardSize(this.cardSizeSelect.value);
    this.previewCard.className = `tile tile--preview tile--size-${size}`;
    this.previewCard.removeAttribute('style');

    applyBookmarkWidgetStyles(this.previewCard, {
      bg_color: this.bgInput.value.trim() || undefined,
      text_color: this.textInput.value.trim() || undefined,
      border_color: this.borderInput.value.trim() || undefined,
    });

    this.previewTitle.textContent = this.titleInput.value.trim() || t('bookmarkEditor.fieldTitle');
    const hk = this.hotkeySelect.value;
    this.previewHotkey.textContent = hk;
    this.previewHotkey.hidden = !hk;
    const desc = this.descriptionInput.value.trim();
    this.previewDesc.textContent = desc;
    this.previewDesc.hidden = !desc || size === 'small';
  }

  /** Serialise the editable fields for dirty-checking. */
  private snapshot(): string {
    return [
      this.titleInput,
      this.urlInput,
      this.altInput,
      this.descriptionInput,
      this.cardSizeSelect,
      this.iconInput,
      this.hotkeySelect,
      this.categorySelect,
      this.bgInput,
      this.textInput,
      this.borderInput,
    ]
      .map((i) => i.value)
      .join('\u0000');
  }

  private isDirty(): boolean {
    return this.snapshot() !== this.initialSnapshot;
  }

  /** Close, guarding unsaved edits (G-40). */
  private requestClose(): void {
    if (!this.isDirty()) {
      this.close();
      return;
    }
    void confirmDialog({
      title: t('common.discardChangesTitle'),
      message: t('common.discardChangesMessage'),
      confirmLabel: t('common.discard'),
      danger: true,
    }).then((ok) => {
      if (ok) {
        this.close();
      }
    });
  }

  close(): void {
    this.dialog.close();
    this.editing = null;
  }

  isOpen(): boolean {
    return this.dialog.isOpen();
  }

  /* ---------------------------------------------------------------- */
  /* DOM construction                                                 */
  /* ---------------------------------------------------------------- */

  private build(): HTMLElement {
    const closeButton = iconBtn(
      ICON_CLOSE,
      t('bookmarkEditor.closeAria'),
      () => this.requestClose(),
      'icon-button modal__close',
    );

    const header = el('header', {
      className: 'modal__header',
      children: [this.titleEl, closeButton],
    });

    // Category field: a <select> plus a hidden inline "new category" input.
    const categoryLabel = el('label', {
      className: 'field',
      children: [
        el('span', { className: 'field__label', text: t('bookmarkEditor.fieldCategory') }),
        this.categorySelect,
        this.newCategoryRow,
      ],
    });

    const saveButton = btn(t('common.save'), {
      className: 'button--primary',
      submit: true,
      onClick: (event) => {
        event.preventDefault();
        void this.save();
      },
    });

    const presetsRow = el('div', {
      className: 'preset-chips',
      children: WIDGET_PRESETS.map((preset) => {
        const b = el('button', {
          className: 'widget-preset-btn',
          attrs: { type: 'button' },
          text: t(preset.nameKey),
        });
        b.addEventListener('click', () => {
          this.bgInput.value = preset.bg ?? '';
          this.textInput.value = preset.textColor ?? '';
          this.borderInput.value = preset.border ?? '';
          this.updateLivePreview();
        });
        return b;
      }),
    });

    const previewSection = el('div', {
      className: 'preview-section',
      children: [
        el('span', { className: 'field__label', text: t('bookmarkEditor.livePreview') }),
        this.previewCard,
      ],
    });

    const actions = el('div', {
      className: 'settings-actions',
      children: [this.deleteButton, saveButton],
    });

    const form = el('form', { className: 'modal__body', attrs: { novalidate: '' } });
    form.append(
      field(t('bookmarkEditor.fieldTitle'), this.titleInput),
      field(t('bookmarkEditor.fieldUrl'), this.urlInput),
      field(t('bookmarkEditor.fieldDescription'), this.descriptionInput),
      field(t('bookmarkEditor.fieldCardSize'), this.cardSizeSelect),
      previewSection,
      field(t('bookmarkEditor.presets'), presetsRow),
      field(t('bookmarkEditor.fieldBgColor'), this.bgInput),
      field(t('bookmarkEditor.fieldTextColor'), this.textInput),
      field(t('bookmarkEditor.fieldBorderColor'), this.borderInput),
      field(t('bookmarkEditor.fieldAlt'), this.altInput),
      categoryLabel,
      field(t('bookmarkEditor.fieldIcon'), this.iconInput),
      field(t('bookmarkEditor.fieldHotkey'), this.hotkeySelect),
      this.statusEl,
      actions,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.save();
    });

    this.dialog.content.appendChild(header);
    this.dialog.content.appendChild(form);
    return this.dialog.overlay;
  }

  /* ---------------------------------------------------------------- */
  /* Behaviour                                                        */
  /* ---------------------------------------------------------------- */

  /** Rebuild the category select, selecting `selectedId` when present. */
  private renderCategories(selectedId: string): void {
    const categories = this.store.sortedCategories;
    this.categorySelect.replaceChildren();
    for (const category of categories) {
      this.categorySelect.appendChild(
        el('option', { text: category.name, attrs: { value: category.id } }),
      );
    }
    this.categorySelect.appendChild(
      el('option', { text: t('bookmarkEditor.newCategoryOption'), attrs: { value: NEW_CATEGORY } }),
    );
    // Fall back to the first category when `selectedId` no longer exists (e.g.
    // its category was deleted) rather than leaving the select blank.
    const isKnown =
      selectedId === NEW_CATEGORY || categories.some((category) => category.id === selectedId);
    this.categorySelect.value = isKnown ? selectedId : (categories[0]?.id ?? NEW_CATEGORY);
    this.syncNewCategoryVisibility();
  }

  private syncNewCategoryVisibility(): void {
    const isNew = this.categorySelect.value === NEW_CATEGORY;
    this.newCategoryRow.hidden = !isNew;
    if (isNew) {
      this.newCategoryInput.focus();
    }
  }

  /** Resolve the chosen category id, creating a new category when requested. */
  private async resolveCategoryId(): Promise<string | null> {
    if (this.categorySelect.value !== NEW_CATEGORY) {
      return this.categorySelect.value || (this.store.sortedCategories[0]?.id ?? '');
    }

    const name = this.newCategoryInput.value.trim();
    if (name.length === 0) {
      this.statusEl.textContent = t('bookmarkEditor.errorNewCategoryName');
      this.newCategoryInput.focus();
      return null;
    }

    const category = await this.callbacks.onCreateCategory(name);
    this.renderCategories(category.id);
    return category.id;
  }

  private async save(): Promise<void> {
    const validation = validateBookmarkForm(
      {
        title: this.titleInput.value,
        url: this.urlInput.value,
        alternateText: this.altInput.value,
        descriptionText: this.descriptionInput.value,
        cardSize: this.cardSizeSelect.value,
        hotkey: this.hotkeySelect.value,
        bgColor: this.bgInput.value,
        textColor: this.textInput.value,
        borderColor: this.borderInput.value,
      },
      { bookmarks: this.store.activeBookmarks, excludeId: this.editing?.id },
    );

    if (!validation.ok || validation.title === undefined || validation.url === undefined) {
      this.statusEl.textContent = validation.error ?? t('bookmarkEditor.errorGeneric');
      this.urlInput.setAttribute('aria-invalid', 'true');
      this.urlInput.focus();
      return;
    }

    const categoryId = await this.resolveCategoryId();
    if (categoryId === null) {
      return;
    }

    const now = Date.now();
    const bookmark: BookmarkItem = {
      ...(this.editing ?? {
        id: newId(),
        created_at: now,
        profile_id: this.store.activeProfileId ?? '',
      }),
      updated_at: now,
      title: validation.title,
      url: validation.url,
      category_id: categoryId,
    };

    const v = validation;
    const target = bookmark as unknown as Record<string, unknown>;
    const optionalFields: Array<[keyof BookmarkItem, unknown]> = [
      ['description', v.description],
      ['card_size', v.cardSize !== 'small' ? v.cardSize : undefined],
      ['alternate_urls', v.alternateUrls?.length ? v.alternateUrls : undefined],
      ['icon', this.iconInput.value.trim() || undefined],
      ['hotkey', v.hotkey],
      ['bg_color', v.bgColor],
      ['text_color', v.textColor],
      ['border_color', v.borderColor],
    ];
    for (const [k, val] of optionalFields) {
      if (val !== undefined && val !== null && val !== '') {
        target[k] = val;
      } else {
        delete target[k];
      }
    }

    await this.callbacks.onSave(bookmark);
    this.close();
  }

  private handleDelete(): void {
    if (!this.editing) {
      return;
    }
    void this.callbacks.onDelete(this.editing.id);
    this.close();
  }
}
