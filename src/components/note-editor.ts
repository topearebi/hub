/**
 * Hub Note Editor
 * ---------------
 * Modal for editing a scratchpad note: title, plain-text body, and a warm
 * pastel color. Keeps the drawer uncluttered and avoids layout jumps.
 */

import { el, svg } from '../utils/dom';
import { confirmDialog, Dialog } from '../utils/dialog';
import type { NoteItem } from '../types/schemas';

const ICON_CLOSE = 'M18 6 6 18M6 6l12 12';

let noteDialogSeq = 0;

/** Warm pastel color tokens (legacy `'neutral'` maps to `'default'`). */
export const NOTE_COLORS = ['default', 'burgundy', 'amber', 'sage', 'terracotta', 'slate'] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** Normalise an arbitrary color tag to a known token. */
export function normalizeNoteColor(tag: string | undefined): NoteColor {
  if (tag === 'neutral') {
    return 'default';
  }
  return tag && (NOTE_COLORS as readonly string[]).includes(tag) ? (tag as NoteColor) : 'default';
}

export interface NoteEditorCallbacks {
  onSave: (note: NoteItem) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}

export class NoteEditor {
  readonly element: HTMLElement;

  private readonly dialog: Dialog;
  private readonly titleId: string;
  private readonly statusId: string;
  private readonly titleInput: HTMLInputElement;
  private readonly contentInput: HTMLTextAreaElement;
  private readonly colorRow: HTMLElement;
  private readonly statusEl: HTMLElement;

  private note: NoteItem | null = null;
  private selectedColor: NoteColor = 'default';
  private initialSnapshot = '';

  constructor(private readonly callbacks: NoteEditorCallbacks) {
    noteDialogSeq += 1;
    this.titleId = `note-editor-title-${noteDialogSeq}`;
    this.dialog = new Dialog({
      labelledBy: this.titleId,
      sheet: true,
      onRequestClose: () => this.requestClose(),
    });

    this.titleInput = el('input', {
      className: 'note-editor__title',
      attrs: { type: 'text', placeholder: 'Title', 'aria-label': 'Note title' },
    });
    this.contentInput = el('textarea', {
      className: 'note-editor__content',
      attrs: { placeholder: 'Take a note…', 'aria-label': 'Note content', rows: '8' },
    });
    this.colorRow = el('div', {
      className: 'note-editor__colors',
      attrs: { role: 'radiogroup', 'aria-label': 'Note color' },
    });
    this.statusId = `note-editor-status-${noteDialogSeq}`;
    this.statusEl = el('p', {
      className: 'settings-status',
      attrs: { id: this.statusId, role: 'status', 'aria-live': 'polite' },
    });
    this.titleInput.setAttribute('aria-describedby', this.statusId);

    this.element = this.build();
  }

  open(note: NoteItem): void {
    this.note = note;
    this.titleInput.value = note.title;
    this.contentInput.value = note.content;
    this.selectedColor = normalizeNoteColor(note.color_tag);
    this.renderColors();
    this.statusEl.textContent = '';
    this.titleInput.removeAttribute('aria-invalid');
    this.dialog.open(this.titleInput);
    this.initialSnapshot = this.snapshot();
  }

  private snapshot(): string {
    return [this.titleInput.value, this.contentInput.value, this.selectedColor].join('\u0000');
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
      title: 'Discard changes?',
      message: 'You have unsaved changes. Discard them?',
      confirmLabel: 'Discard',
      danger: true,
    }).then((ok) => {
      if (ok) {
        this.close();
      }
    });
  }

  close(): void {
    this.dialog.close();
    this.note = null;
  }

  isOpen(): boolean {
    return this.dialog.isOpen();
  }

  private build(): HTMLElement {
    const closeButton = el('button', {
      className: 'icon-button modal__close',
      attrs: { type: 'button', 'aria-label': 'Close note editor' },
    });
    closeButton.appendChild(svg(ICON_CLOSE));
    closeButton.addEventListener('click', () => this.requestClose());

    const title = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: 'Edit note',
    });
    const header = el('header', { className: 'modal__header', children: [title, closeButton] });

    const saveButton = el('button', {
      className: 'button button--primary',
      text: 'Save',
      attrs: { type: 'submit' },
    });
    // `type=submit` gives Enter-to-submit; the click handler guarantees a save
    // even where implicit form submission is unavailable.
    saveButton.addEventListener('click', (event) => {
      event.preventDefault();
      void this.save();
    });

    const deleteButton = el('button', {
      className: 'button',
      text: 'Delete',
      attrs: { type: 'button' },
    });
    deleteButton.addEventListener('click', () => {
      if (this.note) {
        void this.callbacks.onDelete(this.note.id);
      }
      this.close();
    });

    const actions = el('div', {
      className: 'settings-actions',
      children: [deleteButton, saveButton],
    });

    const form = el('form', { className: 'modal__body', attrs: { novalidate: '' } });
    form.append(this.titleInput, this.contentInput, this.colorRow, this.statusEl, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.save();
    });

    this.dialog.content.appendChild(header);
    this.dialog.content.appendChild(form);
    return this.dialog.overlay;
  }

  private renderColors(): void {
    this.colorRow.replaceChildren();
    for (const color of NOTE_COLORS) {
      const swatch = el('button', {
        className: `note-swatch note-swatch--${color}${color === this.selectedColor ? ' is-active' : ''}`,
        attrs: {
          type: 'button',
          role: 'radio',
          'aria-checked': color === this.selectedColor ? 'true' : 'false',
          'aria-label': color,
        },
      });
      swatch.addEventListener('click', () => {
        this.selectedColor = color;
        this.renderColors();
      });
      this.colorRow.appendChild(swatch);
    }
  }

  private async save(): Promise<void> {
    if (!this.note) {
      return;
    }
    const title = this.titleInput.value.trim();
    const content = this.contentInput.value;
    if (title.length === 0 && content.trim().length === 0) {
      this.statusEl.textContent = 'Add a title or some content first.';
      this.titleInput.setAttribute('aria-invalid', 'true');
      this.titleInput.focus();
      return;
    }
    await this.callbacks.onSave({
      ...this.note,
      title: title.length > 0 ? title : 'Untitled',
      content,
      color_tag: this.selectedColor,
      updated_at: Date.now(),
    });
    this.close();
  }
}
