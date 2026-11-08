/**
 * Hub Category Manager (G-39, DESIGN.md §7)
 * -----------------------------------------
 * A dialog for creating, renaming, reordering and deleting bookmark categories.
 * Deleting a non-empty category confirms first, moves its bookmarks to another
 * category, and offers an Undo toast (DESIGN.md §9). The last remaining category
 * cannot be deleted.
 *
 * Built on the shared `Dialog` primitive (focus trap, inert, Escape, restore)
 * and the XSS-safe `el()` helper.
 */

import { clearChildren, el, svg, ICON_DOWN, ICON_PLUS, ICON_TRASH, ICON_UP } from '../utils/dom';
import { confirmDialog, Dialog } from '../utils/dialog';
import { t } from '../utils/i18n';
import { showToast } from './toast';
import { newId } from '../utils/crypto';
import type { BookmarkItem, CategoryItem } from '../types/schemas';

export interface CategoryManagerStore {
  readonly sortedCategories: CategoryItem[];
  readonly activeProfileId: string | null;
  getBookmarksByCategory(categoryId: string): BookmarkItem[];
  upsertCategory(item: CategoryItem): Promise<void>;
  upsertCategories(items: readonly CategoryItem[]): Promise<void>;
  renameCategory(id: string, name: string): Promise<void>;
  deleteCategory(
    id: string,
    targetCategoryId: string,
  ): Promise<{ category: CategoryItem; bookmarks: BookmarkItem[] } | null>;
  restoreCategory(category: CategoryItem, bookmarks: readonly BookmarkItem[]): Promise<void>;
}

export interface CategoryManagerCallbacks {
  onClose: () => void;
  /** Invoked after any change so the host can re-render the bookmark grid. */
  onChanged: () => void;
}

let categoryDialogSeq = 0;

export class CategoryManager {
  readonly element: HTMLElement;

  private readonly dialog: Dialog;
  private readonly titleId: string;
  private readonly listEl: HTMLElement;

  constructor(
    private readonly store: CategoryManagerStore,
    private readonly callbacks: CategoryManagerCallbacks,
  ) {
    categoryDialogSeq += 1;
    this.titleId = `categories-title-${categoryDialogSeq}`;
    this.dialog = new Dialog({
      labelledBy: this.titleId,
      onRequestClose: () => this.close(),
    });

    const title = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: t('categoryManager.heading'),
    });
    const header = el('header', { className: 'modal__header', children: [title] });

    this.listEl = el('div', { className: 'category-manager__list' });

    const addInput = el('input', {
      className: 'category-manager__input',
      attrs: {
        type: 'text',
        placeholder: t('categoryManager.newPlaceholder'),
        'aria-label': t('categoryManager.newAria'),
      },
    });
    const addButton = el('button', {
      className: 'button',
      attrs: { type: 'button' },
    });
    addButton.appendChild(svg(ICON_PLUS, { size: 16 }));
    addButton.appendChild(el('span', { text: t('common.add') }));
    const addRow = el('div', {
      className: 'category-manager__add',
      children: [addInput, addButton],
    });

    const submitAdd = (): void => {
      void this.addCategory(addInput.value, addInput);
    };
    addButton.addEventListener('click', submitAdd);
    addInput.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        submitAdd();
      }
    });

    const body = el('div', {
      className: 'modal__body',
      children: [this.listEl, addRow],
    });

    this.dialog.content.appendChild(header);
    this.dialog.content.appendChild(body);
    this.element = this.dialog.overlay;
  }

  open(): void {
    this.render();
    this.dialog.open();
  }

  close(): void {
    this.dialog.close();
    this.callbacks.onClose();
  }

  isOpen(): boolean {
    return this.dialog.isOpen();
  }

  destroy(): void {
    this.dialog.destroy();
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  private render(): void {
    clearChildren(this.listEl);
    const categories = this.store.sortedCategories;

    if (categories.length === 0) {
      this.listEl.appendChild(
        el('p', { className: 'empty-state', text: t('categoryManager.empty') }),
      );
      return;
    }

    categories.forEach((category, index) => {
      this.listEl.appendChild(this.renderRow(category, index, categories.length));
    });
  }

  private renderRow(category: CategoryItem, index: number, total: number): HTMLElement {
    const row = el('div', { className: 'category-manager__row' });

    const nameInput = el('input', {
      className: 'category-manager__input',
      attrs: {
        type: 'text',
        'aria-label': t('categoryManager.renameAria', { name: category.name }),
      },
    });
    nameInput.value = category.name;
    nameInput.addEventListener('change', () => {
      const name = nameInput.value.trim();
      if (name.length === 0 || name === category.name) {
        nameInput.value = category.name;
        return;
      }
      void this.store.renameCategory(category.id, name).then(() => this.afterChange());
    });

    const up = this.iconButton(
      ICON_UP,
      t('categoryManager.moveUpAria', { name: category.name }),
      index === 0,
      () => this.move(index, -1),
    );
    const down = this.iconButton(
      ICON_DOWN,
      t('categoryManager.moveDownAria', { name: category.name }),
      index === total - 1,
      () => this.move(index, 1),
    );
    const remove = this.iconButton(
      ICON_TRASH,
      t('categoryManager.deleteAria', { name: category.name }),
      total <= 1,
      () => this.deleteCategory(category),
    );

    row.appendChild(nameInput);
    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(remove);
    return row;
  }

  private iconButton(
    icon: string,
    label: string,
    disabled: boolean,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = el('button', {
      className: 'icon-button category-manager__action',
      attrs: { type: 'button', 'aria-label': label },
    });
    button.appendChild(svg(icon, { size: 16 }));
    if (disabled) {
      button.disabled = true;
    } else {
      button.addEventListener('click', onClick);
    }
    return button;
  }

  /* ---------------------------------------------------------------- */
  /* Behaviour                                                        */
  /* ---------------------------------------------------------------- */

  private async addCategory(rawName: string, input: HTMLInputElement): Promise<void> {
    const name = rawName.trim();
    if (name.length === 0) {
      input.focus();
      return;
    }
    const order = this.store.sortedCategories.reduce((max, c) => Math.max(max, c.order), -1) + 1;
    const now = Date.now();
    const category: CategoryItem = {
      id: newId(),
      created_at: now,
      updated_at: now,
      profile_id: this.store.activeProfileId ?? '',
      name,
      order,
    };
    await this.store.upsertCategory(category);
    input.value = '';
    this.afterChange();
  }

  /** Swap a category with its neighbour and renumber the whole list. */
  private async move(index: number, delta: number): Promise<void> {
    const categories = this.store.sortedCategories;
    const target = index + delta;
    if (target < 0 || target >= categories.length) {
      return;
    }
    const reordered = [...categories];
    const [moved] = reordered.splice(index, 1);
    if (!moved) {
      return;
    }
    reordered.splice(target, 0, moved);
    const now = Date.now();
    const updated = reordered.map((category, order) => ({ ...category, order, updated_at: now }));
    await this.store.upsertCategories(updated);
    this.afterChange();
  }

  private async deleteCategory(category: CategoryItem): Promise<void> {
    const others = this.store.sortedCategories.filter((c) => c.id !== category.id);
    const target = others[0];
    if (!target) {
      showToast(t('categoryManager.needsOne'), { variant: 'warning' });
      return;
    }

    const count = this.store.getBookmarksByCategory(category.id).length;
    if (count > 0) {
      const confirmed = await confirmDialog({
        title: t('categoryManager.deleteTitle'),
        message: t('categoryManager.deleteMessage', {
          name: category.name,
          count,
          target: target.name,
        }),
        confirmLabel: t('categoryManager.deleteConfirm'),
        danger: true,
        nested: true,
      });
      if (!confirmed) {
        return;
      }
    }

    const result = await this.store.deleteCategory(category.id, target.id);
    if (!result) {
      return;
    }
    this.afterChange();
    showToast(t('categoryManager.deleted', { name: category.name }), {
      variant: 'info',
      action: {
        label: t('common.undo'),
        onSelect: () => {
          void this.store.restoreCategory(result.category, result.bookmarks).then(() => {
            this.afterChange();
          });
        },
      },
    });
  }

  private afterChange(): void {
    this.render();
    this.callbacks.onChanged();
  }
}
