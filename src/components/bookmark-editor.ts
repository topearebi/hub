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

import { el, svg, ICON_CLOSE } from '../utils/dom';
import { confirmDialog, Dialog } from '../utils/dialog';
import { t } from '../utils/i18n';
import { hostnameOf } from '../core/fallback';
import { newId } from '../utils/crypto';
import { isUrlLike, normalizeUrl } from './omnibar';
import type { BookmarkCardSize, BookmarkItem, CategoryItem } from '../types/schemas';

let bookmarkDialogSeq = 0;
/** Sentinel select value that reveals the inline new-category input. */
export const NEW_CATEGORY = '__new__';

/** Valid `Alt + [1-9]` hotkey slots (mirrors `BookmarkItem.hotkey`). */
export const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export type Hotkey = (typeof HOTKEYS)[number];

export const CARD_SIZES: readonly BookmarkCardSize[] = ['small', 'wide', 'large'] as const;

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
  const description = input.descriptionText ? input.descriptionText.trim() : undefined;
  const cardSize = input.cardSize ? normalizeCardSize(input.cardSize) : 'small';
  return {
    ok: true,
    title,
    url,
    alternateUrls,
    description: description && description.length > 0 ? description : undefined,
    cardSize,
    hotkey,
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

/** Wrap an input in a labelled field (mirrors the settings modal). */
function field(labelText: string, input: HTMLElement): HTMLElement {
  const label = el('label', { className: 'field' });
  label.appendChild(el('span', { className: 'field__label', text: labelText }));
  label.appendChild(input);
  return label;
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
  private readonly statusEl: HTMLElement;
  private readonly deleteButton: HTMLButtonElement;

  private editing: BookmarkItem | null = null;
  private initialSnapshot = '';

  constructor(
    private readonly store: BookmarkEditorStore,
    private readonly callbacks: BookmarkEditorCallbacks,
  ) {
    this.titleInput = el('input', {
      className: 'drawer__input',
      attrs: {
        type: 'text',
        placeholder: t('bookmarkEditor.titlePlaceholder'),
        'aria-label': t('bookmarkEditor.titleAria'),
      },
    });
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
    this.altInput = el('textarea', {
      className: 'drawer__textarea',
      attrs: {
        placeholder: t('bookmarkEditor.altPlaceholder'),
        'aria-label': t('bookmarkEditor.altAria'),
        rows: '3',
      },
    });
    this.descriptionInput = el('textarea', {
      className: 'drawer__textarea',
      attrs: {
        placeholder: t('bookmarkEditor.descriptionPlaceholder'),
        'aria-label': t('bookmarkEditor.descriptionAria'),
        rows: '2',
      },
    });
    this.cardSizeSelect = el('select', {
      className: 'drawer__select',
      attrs: { 'aria-label': t('bookmarkEditor.cardSizeAria') },
    });
    this.cardSizeSelect.appendChild(
      el('option', { text: t('bookmarkEditor.sizeSmall'), attrs: { value: 'small' } }),
    );
    this.cardSizeSelect.appendChild(
      el('option', { text: t('bookmarkEditor.sizeWide'), attrs: { value: 'wide' } }),
    );
    this.cardSizeSelect.appendChild(
      el('option', { text: t('bookmarkEditor.sizeLarge'), attrs: { value: 'large' } }),
    );
    this.categorySelect = el('select', {
      className: 'drawer__select',
      attrs: { 'aria-label': t('bookmarkEditor.categoryAria') },
    });
    this.newCategoryInput = el('input', {
      className: 'drawer__input',
      attrs: {
        type: 'text',
        placeholder: t('bookmarkEditor.newCategoryPlaceholder'),
        'aria-label': t('bookmarkEditor.newCategoryAria'),
      },
    });
    this.newCategoryRow = el('div', {
      className: 'bookmark-editor__new-category',
      children: [this.newCategoryInput],
    });
    this.newCategoryRow.hidden = true;
    this.iconInput = el('input', {
      className: 'drawer__input',
      attrs: {
        type: 'text',
        placeholder: t('bookmarkEditor.iconPlaceholder'),
        'aria-label': t('bookmarkEditor.iconAria'),
      },
    });
    this.hotkeySelect = el('select', {
      className: 'drawer__select',
      attrs: { 'aria-label': t('bookmarkEditor.hotkeyAria') },
    });
    this.hotkeySelect.appendChild(el('option', { text: t('common.none'), attrs: { value: '' } }));
    for (const hotkey of HOTKEYS) {
      this.hotkeySelect.appendChild(
        el('option', {
          text: t('bookmarkEditor.hotkeyOption', { key: hotkey }),
          attrs: { value: hotkey },
        }),
      );
    }
    this.statusId = `bookmark-editor-status-${bookmarkDialogSeq}`;
    this.statusEl = el('p', {
      className: 'settings-status',
      attrs: { id: this.statusId, role: 'status', 'aria-live': 'polite' },
    });
    this.urlInput.setAttribute('aria-describedby', this.statusId);

    this.deleteButton = el('button', {
      className: 'button',
      text: t('common.delete'),
      attrs: { type: 'button' },
    });
    this.deleteButton.addEventListener('click', () => this.handleDelete());

    bookmarkDialogSeq += 1;
    this.titleId = `bookmark-editor-title-${bookmarkDialogSeq}`;
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

  /** Serialise the editable fields for dirty-checking. */
  private snapshot(): string {
    return [
      this.titleInput.value,
      this.urlInput.value,
      this.altInput.value,
      this.descriptionInput.value,
      this.cardSizeSelect.value,
      this.iconInput.value,
      this.hotkeySelect.value,
      this.categorySelect.value,
    ].join('\u0000');
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
    const closeButton = el('button', {
      className: 'icon-button modal__close',
      attrs: { type: 'button', 'aria-label': t('bookmarkEditor.closeAria') },
    });
    closeButton.appendChild(svg(ICON_CLOSE));
    closeButton.addEventListener('click', () => this.requestClose());

    const header = el('header', {
      className: 'modal__header',
      children: [this.titleEl, closeButton],
    });

    // Category field: a <select> plus a hidden inline "new category" input.
    const categoryLabel = el('label', { className: 'field' });
    categoryLabel.appendChild(
      el('span', { className: 'field__label', text: t('bookmarkEditor.fieldCategory') }),
    );
    categoryLabel.appendChild(this.categorySelect);
    categoryLabel.appendChild(this.newCategoryRow);

    const saveButton = el('button', {
      className: 'button button--primary',
      text: t('common.save'),
      attrs: { type: 'submit' },
    });
    // `type=submit` gives Enter-to-submit; the click handler guarantees a save
    // even where implicit form submission is unavailable.
    saveButton.addEventListener('click', (event) => {
      event.preventDefault();
      void this.save();
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
    const bookmark: BookmarkItem = this.editing
      ? { ...this.editing, updated_at: now }
      : {
          id: newId(),
          created_at: now,
          updated_at: now,
          profile_id: this.store.activeProfileId ?? '',
          title: validation.title,
          url: validation.url,
          category_id: categoryId,
        };

    bookmark.title = validation.title;
    bookmark.url = validation.url;
    bookmark.category_id = categoryId;

    if (validation.description && validation.description.length > 0) {
      bookmark.description = validation.description;
    } else {
      delete bookmark.description;
    }

    if (validation.cardSize && validation.cardSize !== 'small') {
      bookmark.card_size = validation.cardSize;
    } else {
      delete bookmark.card_size;
    }

    // Optional fields are omitted entirely when cleared so tombstones/sync do
    // not carry stale empty values.
    if (validation.alternateUrls && validation.alternateUrls.length > 0) {
      bookmark.alternate_urls = validation.alternateUrls;
    } else {
      delete bookmark.alternate_urls;
    }

    const icon = this.iconInput.value.trim();
    if (icon.length > 0) {
      bookmark.icon = icon;
    } else {
      delete bookmark.icon;
    }

    if (validation.hotkey) {
      bookmark.hotkey = validation.hotkey;
    } else {
      delete bookmark.hotkey;
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
