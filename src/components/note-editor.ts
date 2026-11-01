/**
 * Hub Note Editor
 * ---------------
 * Modal for editing a scratchpad note: title, plain-text body, and a warm
 * pastel color. Keeps the drawer uncluttered and avoids layout jumps.
 */

import { el, svg } from '../utils/dom';
import type { NoteItem } from '../types/schemas';

const ICON_CLOSE = 'M18 6 6 18M6 6l12 12';

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

  private readonly titleInput: HTMLInputElement;
  private readonly contentInput: HTMLTextAreaElement;
  private readonly colorRow: HTMLElement;
  private readonly statusEl: HTMLElement;

  private note: NoteItem | null = null;
  private selectedColor: NoteColor = 'default';

  constructor(private readonly callbacks: NoteEditorCallbacks) {
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
    this.statusEl = el('p', {
      className: 'settings-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    this.element = this.build();
  }

  open(note: NoteItem): void {
    this.note = note;
    this.titleInput.value = note.title;
    this.contentInput.value = note.content;
    this.selectedColor = normalizeNoteColor(note.color_tag);
    this.renderColors();
    this.statusEl.textContent = '';
    this.element.classList.add('is-open');
    this.titleInput.focus();
  }

  close(): void {
    this.element.classList.remove('is-open');
    this.note = null;
  }

  private build(): HTMLElement {
    const closeButton = el('button', {
      className: 'icon-button modal__close',
      attrs: { type: 'button', 'aria-label': 'Close note editor' },
    });
    closeButton.appendChild(svg(ICON_CLOSE));
    closeButton.addEventListener('click', () => this.close());

    const title = el('h2', { className: 'modal__title', text: 'Edit note' });
    const header = el('header', { className: 'modal__header', children: [title, closeButton] });

    const saveButton = el('button', {
      className: 'button button--primary',
      text: 'Save',
      attrs: { type: 'button' },
    });
    saveButton.addEventListener('click', () => {
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

    const body = el('div', {
      className: 'modal__body',
      children: [this.titleInput, this.contentInput, this.colorRow, this.statusEl, actions],
    });

    const dialog = el('div', {
      className: 'modal',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit note' },
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
