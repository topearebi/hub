/**
 * Hub "Recently deleted" (G-40, DESIGN.md §9.1)
 * ---------------------------------------------
 * Lists soft-deleted profiles (with item counts) and individually deleted
 * bookmarks, tasks and notes still inside the 30-day recovery window. Each row
 * offers Restore and Delete now (permanent, confirmed). Backed by the store's
 * `deletedProfiles` / `deletedItems` getters and the cascade semantics in
 * SCHEMAS.md §5.4.
 *
 * Built on the shared `Dialog` primitive and the XSS-safe `el()` helper.
 */

import { clearChildren, el } from '../utils/dom';
import { confirmDialog, Dialog } from '../utils/dialog';
import { t, tp } from '../utils/i18n';
import { showToast } from './toast';
import { TOMBSTONE_GRACE_MS } from '../core/store';
import type { DeletedItems, DeletedProfileEntry } from '../core/store';

const DAY_MS = 86_400_000;

/** Whole days elapsed since `at` (never negative). Pure and unit-tested. */
export function daysSince(at: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

/** Whole days remaining before a tombstone is culled. Pure and unit-tested. */
export function daysRemaining(at: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((at + TOMBSTONE_GRACE_MS - now) / DAY_MS));
}

export interface RecentlyDeletedStore {
  readonly deletedProfiles: DeletedProfileEntry[];
  readonly deletedItems: DeletedItems;
  restoreProfile(id: string): Promise<void>;
  permanentlyDeleteProfile(id: string): Promise<void>;
  restoreBookmark(id: string): Promise<void>;
  restoreTask(id: string): Promise<void>;
  restoreNote(id: string): Promise<void>;
  permanentlyDeleteItem(storeName: 'bookmarks' | 'tasks' | 'notes', id: string): Promise<void>;
}

export interface RecentlyDeletedCallbacks {
  onClose: () => void;
  /** Invoked after any restore/permanent delete so the host can re-render. */
  onChanged: () => void;
}

let recentlyDeletedSeq = 0;

export class RecentlyDeleted {
  readonly element: HTMLElement;

  private readonly dialog: Dialog;
  private readonly titleId: string;
  private readonly bodyEl: HTMLElement;

  constructor(
    private readonly store: RecentlyDeletedStore,
    private readonly callbacks: RecentlyDeletedCallbacks,
  ) {
    recentlyDeletedSeq += 1;
    this.titleId = `recently-deleted-title-${recentlyDeletedSeq}`;
    this.dialog = new Dialog({
      labelledBy: this.titleId,
      onRequestClose: () => this.close(),
    });

    const title = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: t('recentlyDeleted.heading'),
    });
    const header = el('header', { className: 'modal__header', children: [title] });
    this.bodyEl = el('div', { className: 'modal__body' });

    this.dialog.content.appendChild(header);
    this.dialog.content.appendChild(this.bodyEl);
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
    clearChildren(this.bodyEl);
    const profiles = this.store.deletedProfiles;
    const items = this.store.deletedItems;
    const hasItems = items.bookmarks.length > 0 || items.tasks.length > 0 || items.notes.length > 0;

    if (profiles.length === 0 && !hasItems) {
      this.bodyEl.appendChild(
        el('p', {
          className: 'empty-state',
          text: t('recentlyDeleted.empty'),
        }),
      );
      return;
    }

    if (profiles.length > 0) {
      this.bodyEl.appendChild(
        this.section(
          t('recentlyDeleted.profiles'),
          profiles.map((p) => this.profileRow(p)),
        ),
      );
    }

    const itemRows: HTMLElement[] = [
      ...items.bookmarks.map((b) =>
        this.itemRow('bookmarks', b.id, b.title, t('recentlyDeleted.kind.link'), b.updated_at),
      ),
      ...items.tasks.map((task) =>
        this.itemRow('tasks', task.id, task.title, t('recentlyDeleted.kind.task'), task.updated_at),
      ),
      ...items.notes.map((n) =>
        this.itemRow('notes', n.id, n.title, t('recentlyDeleted.kind.note'), n.updated_at),
      ),
    ];
    if (itemRows.length > 0) {
      this.bodyEl.appendChild(this.section(t('recentlyDeleted.items'), itemRows));
    }
  }

  private section(title: string, rows: HTMLElement[]): HTMLElement {
    const section = el('section', { className: 'recently-deleted__section' });
    section.appendChild(el('h3', { className: 'settings-section__title', text: title }));
    for (const row of rows) {
      section.appendChild(row);
    }
    return section;
  }

  private profileRow(entry: DeletedProfileEntry): HTMLElement {
    const { profile, counts } = entry;
    const row = el('div', { className: 'recently-deleted__row' });

    const info = el('div', { className: 'recently-deleted__info' });
    info.appendChild(el('span', { className: 'recently-deleted__name', text: profile.name }));
    const summary = t('recentlyDeleted.summary', {
      links: tp('recentlyDeleted.linkCount', counts.bookmarks),
      tasks: tp('recentlyDeleted.taskCount', counts.tasks),
      notes: tp('recentlyDeleted.noteCount', counts.notes),
    });
    info.appendChild(el('span', { className: 'recently-deleted__meta', text: summary }));
    info.appendChild(
      el('span', {
        className: 'recently-deleted__meta',
        text: t('recentlyDeleted.deletedAgo', {
          days: daysSince(profile.updated_at),
          remaining: daysRemaining(profile.updated_at),
        }),
      }),
    );
    row.appendChild(info);

    const actions = el('div', { className: 'recently-deleted__actions' });
    actions.appendChild(
      this.button(t('common.restore'), 'button', () => {
        void this.store.restoreProfile(profile.id).then(() => this.afterChange());
      }),
    );
    actions.appendChild(
      this.button(t('recentlyDeleted.deleteNow'), 'button button--danger', () => {
        void this.confirmPermanent(
          t('recentlyDeleted.confirmProfile', { name: profile.name, summary }),
          () => this.store.permanentlyDeleteProfile(profile.id),
        );
      }),
    );
    row.appendChild(actions);
    return row;
  }

  private itemRow(
    storeName: 'bookmarks' | 'tasks' | 'notes',
    id: string,
    title: string,
    kind: string,
    updatedAt: number,
  ): HTMLElement {
    const row = el('div', { className: 'recently-deleted__row' });

    const info = el('div', { className: 'recently-deleted__info' });
    info.appendChild(
      el('span', { className: 'recently-deleted__name', text: title || t('common.untitled') }),
    );
    info.appendChild(
      el('span', {
        className: 'recently-deleted__meta',
        text: t('recentlyDeleted.itemMeta', {
          kind,
          days: daysSince(updatedAt),
          remaining: daysRemaining(updatedAt),
        }),
      }),
    );
    row.appendChild(info);

    const actions = el('div', { className: 'recently-deleted__actions' });
    actions.appendChild(
      this.button(t('common.restore'), 'button', () => {
        void this.restoreItem(storeName, id).then(() => this.afterChange());
      }),
    );
    actions.appendChild(
      this.button(t('recentlyDeleted.deleteNow'), 'button button--danger', () => {
        void this.confirmPermanent(
          t('recentlyDeleted.confirmItem', { name: title || t('common.untitled') }),
          () => this.store.permanentlyDeleteItem(storeName, id),
        );
      }),
    );
    row.appendChild(actions);
    return row;
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', { className, text: label, attrs: { type: 'button' } });
    button.addEventListener('click', onClick);
    return button;
  }

  private restoreItem(storeName: 'bookmarks' | 'tasks' | 'notes', id: string): Promise<void> {
    if (storeName === 'bookmarks') {
      return this.store.restoreBookmark(id);
    }
    if (storeName === 'tasks') {
      return this.store.restoreTask(id);
    }
    return this.store.restoreNote(id);
  }

  private async confirmPermanent(message: string, action: () => Promise<void>): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('common.deletePermanentlyTitle'),
      message,
      confirmLabel: t('common.deletePermanently'),
      danger: true,
      nested: true,
    });
    if (!confirmed) {
      return;
    }
    await action();
    showToast(t('common.permanentlyDeleted'), { variant: 'info' });
    this.afterChange();
  }

  private afterChange(): void {
    this.render();
    this.callbacks.onChanged();
  }
}
