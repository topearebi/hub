/**
 * Hub Scratchpad Drawer (Google Keep pattern)
 * -------------------------------------------
 * Right productivity pane. A "Take a note…" quick-capture box, PINNED/OTHERS
 * sections, warm pastel cards with a hover toolbar (color, pin, copy, delete),
 * and a click-to-edit modal. Content renders as raw text (never HTML).
 */

import { buildDrawerShell } from './drawer';
import { clearChildren, el, svg } from '../utils/dom';
import { newId } from '../utils/crypto';
import { showToast } from './toast';
import { NOTE_COLORS, NoteEditor, normalizeNoteColor } from './note-editor';
import type { NoteColor } from './note-editor';
import type { NoteItem } from '../types/schemas';

const ICON_TRASH =
  'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6';
const ICON_COPY =
  'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1';
const ICON_PIN =
  'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';
const ICON_PALETTE =
  'M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.5A4.5 4.5 0 0 0 22 11 9 9 0 0 0 12 2zM6.5 13a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z';

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Order notes: pinned first, then by `order` ascending, then newest first. */
export function sortNotes(notes: readonly NoteItem[]): NoteItem[] {
  return [...notes].sort((a, b) => {
    const pinned = Number(b.is_pinned === true) - Number(a.is_pinned === true);
    if (pinned !== 0) {
      return pinned;
    }
    return (a.order ?? 0) - (b.order ?? 0) || b.updated_at - a.updated_at;
  });
}

/** Map a color tag to a safe CSS class (legacy `'neutral'` -> `'default'`). */
export function noteColorClass(tag: string | undefined): string {
  return `note--${normalizeNoteColor(tag)}`;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface NotesStore {
  readonly activeNotes: NoteItem[];
  readonly activeProfileId: string | null;
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
  private readonly captureEl: HTMLElement;
  private readonly captureTitle: HTMLInputElement;
  private readonly captureContent: HTMLTextAreaElement;
  private readonly captureColors: HTMLElement;
  private readonly capturePin: HTMLButtonElement;
  private readonly editor: NoteEditor;

  private captureColor: NoteColor = 'default';
  private capturePinned = false;

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

    /* ---- Quick capture ---- */
    this.captureTitle = el('input', {
      className: 'note-capture__title',
      attrs: { type: 'text', placeholder: 'Title', 'aria-label': 'Note title' },
    });
    this.captureContent = el('textarea', {
      className: 'note-capture__content',
      attrs: { placeholder: 'Take a note…', 'aria-label': 'Note content', rows: '3' },
    });
    this.captureColors = el('div', {
      className: 'note-capture__colors',
      attrs: { role: 'radiogroup', 'aria-label': 'Note color' },
    });
    this.capturePin = el('button', {
      className: 'icon-button note-capture__pin',
      attrs: { type: 'button', 'aria-label': 'Pin note', 'aria-pressed': 'false' },
    });
    this.capturePin.appendChild(svg(ICON_PIN));
    this.capturePin.addEventListener('click', () => {
      this.capturePinned = !this.capturePinned;
      this.capturePin.setAttribute('aria-pressed', this.capturePinned ? 'true' : 'false');
      this.capturePin.classList.toggle('is-active', this.capturePinned);
    });

    const closeButton = el('button', {
      className: 'button',
      text: 'Close',
      attrs: { type: 'button' },
    });
    closeButton.addEventListener('click', () => this.closeCapture());

    const saveButton = el('button', {
      className: 'button button--primary',
      text: 'Save',
      attrs: { type: 'button' },
    });
    saveButton.addEventListener('click', () => {
      void this.saveCapture();
    });

    const captureActions = el('div', {
      className: 'note-capture__actions',
      children: [this.capturePin, closeButton, saveButton],
    });

    this.captureEl = el('div', {
      className: 'note-capture',
      children: [this.captureTitle, this.captureContent, this.captureColors, captureActions],
    });
    this.captureEl.hidden = true;

    const captureTrigger = el('button', {
      className: 'note-capture-trigger',
      text: 'Take a note…',
      attrs: { type: 'button' },
    });
    captureTrigger.addEventListener('click', () => this.openCapture());

    this.listEl = el('div', { className: 'note-list' });

    shell.body.appendChild(captureTrigger);
    shell.body.appendChild(this.captureEl);
    shell.body.appendChild(this.listEl);

    /* ---- Edit modal ---- */
    this.editor = new NoteEditor({
      onSave: (note) => this.store.upsertNote(note),
      onDelete: (id) => this.store.softDeleteNote(id),
    });
    document.body.appendChild(this.editor.element);

    this.renderCaptureColors();
  }

  /** Rebuild the note list from current store state. */
  render(): void {
    clearChildren(this.listEl);

    const notes = sortNotes(this.store.activeNotes);
    if (notes.length === 0) {
      this.listEl.appendChild(
        el('p', {
          className: 'empty-state',
          text: "Scratchpad is empty. Click 'Take a note…' to capture something.",
        }),
      );
      return;
    }

    const pinned = notes.filter((note) => note.is_pinned === true);
    const others = notes.filter((note) => note.is_pinned !== true);

    if (pinned.length > 0) {
      this.listEl.appendChild(this.renderSection('Pinned', pinned));
      if (others.length > 0) {
        this.listEl.appendChild(this.renderSection('Others', others));
      }
      return;
    }

    for (const note of others) {
      this.listEl.appendChild(this.renderNote(note));
    }
  }

  /** Open the quick-capture box and focus the title (app shortcut). */
  focusInput(): void {
    this.openCapture();
  }

  setPinned(pinned: boolean): void {
    this.element.setAttribute('data-pinned', pinned ? 'true' : 'false');
  }

  setOpen(open: boolean): void {
    this.element.setAttribute('data-open', open ? 'true' : 'false');
  }

  destroy(): void {
    this.editor.element.remove();
    this.element.remove();
  }

  /* ---------------------------------------------------------------- */
  /* Quick capture                                                    */
  /* ---------------------------------------------------------------- */

  private renderCaptureColors(): void {
    this.captureColors.replaceChildren();
    for (const color of NOTE_COLORS) {
      const swatch = el('button', {
        className: `note-swatch note-swatch--${color}${color === this.captureColor ? ' is-active' : ''}`,
        attrs: {
          type: 'button',
          role: 'radio',
          'aria-checked': color === this.captureColor ? 'true' : 'false',
          'aria-label': color,
        },
      });
      swatch.addEventListener('click', () => {
        this.captureColor = color;
        this.renderCaptureColors();
      });
      this.captureColors.appendChild(swatch);
    }
  }

  private openCapture(): void {
    this.captureEl.hidden = false;
    this.captureTitle.focus();
  }

  private closeCapture(): void {
    this.captureEl.hidden = true;
    this.captureTitle.value = '';
    this.captureContent.value = '';
    this.captureColor = 'default';
    this.capturePinned = false;
    this.capturePin.setAttribute('aria-pressed', 'false');
    this.capturePin.classList.remove('is-active');
    this.renderCaptureColors();
  }

  private async saveCapture(): Promise<void> {
    const title = this.captureTitle.value.trim();
    const content = this.captureContent.value;
    if (title.length === 0 && content.trim().length === 0) {
      return;
    }
    const now = Date.now();
    const note: NoteItem = {
      id: newId(),
      created_at: now,
      updated_at: now,
      profile_id: this.store.activeProfileId ?? '',
      title: title.length > 0 ? title : 'Untitled',
      content,
      is_pinned: this.capturePinned,
      color_tag: this.captureColor,
      order: 0,
    };
    this.closeCapture();
    await this.store.upsertNote(note);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  private renderSection(label: string, notes: readonly NoteItem[]): HTMLElement {
    const section = el('section', { className: 'note-section' });
    section.appendChild(el('h3', { className: 'note-section__title', text: label }));
    const grid = el('div', { className: 'note-grid' });
    for (const note of notes) {
      grid.appendChild(this.renderNote(note));
    }
    section.appendChild(grid);
    return section;
  }

  private renderNote(note: NoteItem): HTMLElement {
    const card = el('article', {
      className: `note ${noteColorClass(note.color_tag)}`,
      attrs: { tabindex: '0', role: 'button', 'aria-label': `Edit ${note.title}` },
    });

    if (note.title.trim().length > 0) {
      card.appendChild(el('h4', { className: 'note__title', text: note.title }));
    }
    if (note.content.trim().length > 0) {
      card.appendChild(el('pre', { className: 'note__content', text: note.content }));
    }

    const toolbar = el('div', { className: 'note__toolbar' });
    toolbar.appendChild(
      this.toolbarButton(ICON_PALETTE, 'Change color', () => this.cycleColor(note)),
    );
    toolbar.appendChild(
      this.toolbarButton(ICON_PIN, note.is_pinned ? 'Unpin' : 'Pin', () => this.togglePin(note)),
    );
    toolbar.appendChild(this.toolbarButton(ICON_COPY, 'Copy', () => void this.copyNote(note)));
    toolbar.appendChild(
      this.toolbarButton(ICON_TRASH, 'Delete', () => void this.store.softDeleteNote(note.id)),
    );
    card.appendChild(toolbar);

    const openEditor = (): void => this.editor.open(note);
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.note__toolbar')) {
        return;
      }
      openEditor();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openEditor();
      }
    });

    return card;
  }

  private toolbarButton(icon: string, label: string, onClick: () => void): HTMLElement {
    const button = el('button', {
      className: 'icon-button note__action',
      attrs: { type: 'button', 'aria-label': label, title: label },
    });
    button.appendChild(svg(icon, { size: 16 }));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private async cycleColor(note: NoteItem): Promise<void> {
    const current = normalizeNoteColor(note.color_tag);
    const index = NOTE_COLORS.indexOf(current);
    const next = NOTE_COLORS[(index + 1) % NOTE_COLORS.length] ?? 'default';
    await this.store.upsertNote({ ...note, color_tag: next, updated_at: Date.now() });
  }

  private async togglePin(note: NoteItem): Promise<void> {
    await this.store.upsertNote({
      ...note,
      is_pinned: note.is_pinned !== true,
      updated_at: Date.now(),
    });
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
