/**
 * Hub Scratchpad Drawer
 * ---------------------
 * Right productivity pane (PRD §5.3). A zero-friction plain-text pastebin:
 * cards render raw text inside `<pre>` (never parsed as Markdown/HTML), carry a
 * color badge, and offer one-click clipboard copy.
 */

import { buildDrawerShell } from './drawer';
import { clearChildren, el, svg } from '../utils/dom';
import { newId } from '../utils/crypto';
import { showToast } from './toast';
import type { NoteItem } from '../types/schemas';

const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_TRASH =
  'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6';
const ICON_COPY =
  'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1';

/** Allowed color tags (SCHEMAS.md §2.3C). */
export const NOTE_COLORS = ['terracotta', 'sage', 'amber', 'neutral'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** Order notes by most recently updated first. Pure and unit-tested. */
export function sortNotes(notes: readonly NoteItem[]): NoteItem[] {
  return [...notes].sort((a, b) => b.updated_at - a.updated_at);
}

/** Map a color tag to a safe CSS class, defaulting to neutral. */
export function noteColorClass(tag: string | undefined): string {
  const value = tag && (NOTE_COLORS as readonly string[]).includes(tag) ? tag : 'neutral';
  return `note--${value}`;
}

export interface NotesStore {
  readonly activeNotes: NoteItem[];
  upsertNote(item: NoteItem): Promise<void>;
  softDeleteNote(id: string): Promise<void>;
}

export interface NotesCallbacks {
  onPinToggle: () => void;
  onClose: () => void;
}

export class NotesDrawer {
  readonly element: HTMLElement;

  private readonly listEl: HTMLElement;
  private readonly titleInput: HTMLInputElement;
  private readonly contentInput: HTMLTextAreaElement;
  private readonly colorSelect: HTMLSelectElement;

  constructor(
    private readonly store: NotesStore,
    callbacks: NotesCallbacks,
  ) {
    const shell = buildDrawerShell({
      variant: 'notes',
      title: 'Scratchpad',
      onPinToggle: callbacks.onPinToggle,
      onClose: callbacks.onClose,
    });
    this.element = shell.element;

    this.titleInput = el('input', {
      className: 'drawer__input',
      attrs: { type: 'text', placeholder: 'Note title…', 'aria-label': 'Note title' },
    });

    this.contentInput = el('textarea', {
      className: 'drawer__textarea',
      attrs: { placeholder: 'Paste or type anything…', 'aria-label': 'Note content', rows: '3' },
    });

    this.colorSelect = el('select', {
      className: 'drawer__select',
      attrs: { 'aria-label': 'Note color' },
    });
    for (const color of NOTE_COLORS) {
      this.colorSelect.appendChild(el('option', { text: color, attrs: { value: color } }));
    }

    const addButton = el('button', {
      className: 'icon-button',
      attrs: { type: 'button', 'aria-label': 'Add note' },
    });
    addButton.appendChild(svg(ICON_PLUS));

    const controls = el('div', {
      className: 'drawer__controls',
      children: [this.colorSelect, addButton],
    });
    const form = el('form', {
      className: 'drawer__form drawer__form--stacked',
      children: [this.titleInput, this.contentInput, controls],
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.addNote();
    });

    this.listEl = el('div', { className: 'note-list' });

    shell.body.appendChild(form);
    shell.body.appendChild(this.listEl);
  }

  /** Rebuild the note list from current store state. */
  render(): void {
    clearChildren(this.listEl);

    const notes = sortNotes(this.store.activeNotes);
    if (notes.length === 0) {
      this.listEl.appendChild(
        el('p', {
          className: 'empty-state',
          text: "Scratchpad is empty. Click '+ Note' to paste temporary information.",
        }),
      );
      return;
    }

    for (const note of notes) {
      this.listEl.appendChild(this.renderNote(note));
    }
  }

  /** Focus the note title input (used by the "New Note" app shortcut). */
  focusInput(): void {
    this.titleInput.focus();
  }

  setPinned(pinned: boolean): void {
    this.element.setAttribute('data-pinned', pinned ? 'true' : 'false');
  }

  setOpen(open: boolean): void {
    this.element.setAttribute('data-open', open ? 'true' : 'false');
  }

  destroy(): void {
    this.element.remove();
  }

  private async addNote(): Promise<void> {
    const title = this.titleInput.value.trim();
    const content = this.contentInput.value;
    if (title.length === 0 && content.trim().length === 0) {
      return;
    }
    const now = Date.now();
    const note: NoteItem = {
      id: newId(),
      created_at: now,
      updated_at: now,
      title: title.length > 0 ? title : 'Untitled',
      content,
      color_tag: this.colorSelect.value,
    };
    this.titleInput.value = '';
    this.contentInput.value = '';
    await this.store.upsertNote(note);
  }

  private renderNote(note: NoteItem): HTMLElement {
    const card = el('article', { className: `note ${noteColorClass(note.color_tag)}` });

    const title = el('h3', { className: 'note__title', text: note.title });
    const badge = el('span', { className: 'note__badge', text: note.color_tag ?? 'neutral' });

    const copyButton = el('button', {
      className: 'icon-button note__action',
      attrs: { type: 'button', 'aria-label': `Copy ${note.title}` },
    });
    copyButton.appendChild(svg(ICON_COPY));
    copyButton.addEventListener('click', () => {
      void this.copyNote(note);
    });

    const deleteButton = el('button', {
      className: 'icon-button note__action',
      attrs: { type: 'button', 'aria-label': `Delete ${note.title}` },
    });
    deleteButton.appendChild(svg(ICON_TRASH));
    deleteButton.addEventListener('click', () => {
      void this.store.softDeleteNote(note.id);
    });

    const header = el('header', {
      className: 'note__header',
      children: [title, badge, copyButton, deleteButton],
    });
    const content = el('pre', { className: 'note__content', text: note.content });

    card.appendChild(header);
    card.appendChild(content);
    return card;
  }

  private async copyNote(note: NoteItem): Promise<void> {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      showToast('Clipboard is unavailable in this browser.', { variant: 'warning' });
      return;
    }
    try {
      await clipboard.writeText(note.content);
      showToast('Copied to clipboard.', { variant: 'success' });
    } catch {
      showToast('Copy failed.', { variant: 'error' });
    }
  }
}
