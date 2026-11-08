/**
 * Hub Scratchpad Drawer (Google Keep pattern)
 * -------------------------------------------
 * Right productivity pane. A "Take a note…" quick-capture box, PINNED/OTHERS
 * sections, warm pastel cards with a hover toolbar (color, pin, copy, delete),
 * and a click-to-edit modal. Content renders as raw text (never HTML).
 */

import { buildDrawerShell } from './drawer';
import { btn, clearChildren, el, iconBtn, ICON_PIN, ICON_TRASH } from '../utils/dom';
import { haptic } from '../utils/haptics';
import { t } from '../utils/i18n';
import { canShare, share } from '../utils/share';
import { attachSwipe } from '../utils/swipe';
import { newId } from '../utils/crypto';
import { showToast } from './toast';
import { NOTE_COLORS, NoteEditor, normalizeNoteColor } from './note-editor';
import type { NoteColor } from './note-editor';
import type { NoteItem } from '../types/schemas';

const ICON_COPY =
  'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1';
const ICON_PALETTE =
  'M12 2C6.5 2 2 6.5 2 12s4.5 10 9.5 10c.8 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10z';
const ICON_SHARE = 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13';

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
  /** Restore a soft-deleted note (undo). */
  restoreNote?(id: string): Promise<void>;
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
      title: t('notes.title'),
      onPinToggle: callbacks.onPinToggle,
      onClose: callbacks.onClose,
    });
    this.element = shell.element;

    /* ---- Quick capture ---- */
    this.captureTitle = el('input', {
      className: 'note-capture__title',
      attrs: {
        type: 'text',
        placeholder: t('notes.captureTitlePlaceholder'),
        'aria-label': t('notes.captureTitleAria'),
      },
    });
    this.captureContent = el('textarea', {
      className: 'note-capture__content',
      attrs: {
        placeholder: t('notes.captureContentPlaceholder'),
        'aria-label': t('notes.captureContentAria'),
        rows: '3',
      },
    });
    this.captureColors = el('div', {
      className: 'note-capture__colors',
      attrs: { role: 'radiogroup', 'aria-label': t('notes.captureColorAria') },
    });
    this.capturePin = iconBtn(
      ICON_PIN,
      t('notes.pinAria'),
      () => {
        this.capturePinned = !this.capturePinned;
        this.capturePin.setAttribute('aria-pressed', this.capturePinned ? 'true' : 'false');
        this.capturePin.classList.toggle('is-active', this.capturePinned);
      },
      'icon-button note-capture__pin',
    );
    this.capturePin.setAttribute('aria-pressed', 'false');

    const closeButton = btn(t('common.close'), { onClick: () => this.closeCapture() });
    const saveButton = btn(t('common.save'), {
      className: 'button--primary',
      onClick: () => {
        void this.saveCapture();
      },
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
      text: t('notes.captureTrigger'),
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
      onDelete: (id) => this.deleteNote(id),
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
          text: t('notes.empty'),
        }),
      );
      return;
    }

    const pinned = notes.filter((note) => note.is_pinned === true);
    const others = notes.filter((note) => note.is_pinned !== true);

    if (pinned.length > 0) {
      this.listEl.appendChild(this.renderSection(t('notes.pinned'), pinned));
      if (others.length > 0) {
        this.listEl.appendChild(this.renderSection(t('notes.others'), others));
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

  /** True when the note edit modal is open. */
  isEditorOpen(): boolean {
    return this.editor.isOpen();
  }

  /** Close the note edit modal (used by the gamepad Back action). */
  closeEditor(): void {
    this.editor.close();
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
          'aria-label': t(`noteColor.${color}`),
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
      title: title.length > 0 ? title : t('common.untitled'),
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
    return el('section', {
      className: 'note-section',
      children: [
        el('h3', { className: 'note-section__title', text: label }),
        el('div', { className: 'note-grid', children: notes.map((n) => this.renderNote(n)) }),
      ],
    });
  }

  private renderNote(note: NoteItem): HTMLElement {
    const card = el('article', { className: `note ${noteColorClass(note.color_tag)}` });

    const openChildren: HTMLElement[] = [];
    if (note.title.trim().length > 0) {
      openChildren.push(el('h4', { className: 'note__title', text: note.title }));
    }
    if (note.content.trim().length > 0) {
      openChildren.push(el('pre', { className: 'note__content', text: note.content }));
    }
    const open = el('button', {
      className: 'note__open',
      attrs: { type: 'button', 'aria-label': t('notes.editAria', { title: note.title }) },
      children: openChildren,
    });
    open.addEventListener('click', () => this.editor.open(note));

    const actions: Array<[string, string, () => void]> = [
      [ICON_PALETTE, t('notes.changeColor'), () => this.cycleColor(note)],
      [ICON_PIN, note.is_pinned ? t('notes.unpin') : t('notes.pin'), () => this.togglePin(note)],
      [ICON_COPY, t('notes.copy'), () => void this.copyNote(note)],
      [ICON_SHARE, t('notes.share'), () => void this.shareNote(note)],
      [ICON_TRASH, t('common.delete'), () => void this.deleteNote(note.id)],
    ];
    const toolbar = el('div', {
      className: 'note__toolbar',
      attrs: { role: 'group', 'aria-label': t('common.actionsFor', { name: note.title }) },
      children: actions.map(([ic, lbl, fn]) => this.toolbarButton(ic, lbl, fn)),
    });

    card.appendChild(open);
    card.appendChild(toolbar);

    // Swipe left to delete (touch only, G-25). Delete stays reachable by touch
    // and keyboard via the toolbar button.
    let swiped = false;
    attachSwipe(card, {
      ignoreSelector: '.note__toolbar',
      onSwipeLeft: () => {
        swiped = true;
        window.setTimeout(() => {
          swiped = false;
        }, 500);
        haptic('warning');
        void this.deleteNote(note.id);
      },
    });
    open.addEventListener(
      'click',
      (event) => {
        if (swiped) {
          swiped = false;
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );
    return card;
  }

  /** Delete a note with an undo affordance (G-40). */
  private async deleteNote(id: string): Promise<void> {
    haptic('warning');
    await this.store.softDeleteNote(id);
    showToast(t('notes.deleted'), {
      variant: 'info',
      action: {
        label: t('common.undo'),
        onSelect: () => {
          void this.store.restoreNote?.(id);
        },
      },
    });
  }

  private toolbarButton(icon: string, label: string, onClick: () => void): HTMLElement {
    const b = iconBtn(
      icon,
      label,
      (e) => {
        e.stopPropagation();
        onClick();
      },
      'icon-button note__action',
      16,
    );
    b.title = label;
    return b;
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

  /** Share a note via the native share sheet, when available (G-53). */
  private async shareNote(note: NoteItem): Promise<void> {
    const shared = await share({ title: note.title, text: note.content });
    if (!shared && !canShare()) {
      showToast(t('notes.shareUnavailable'), { variant: 'warning' });
    }
  }

  private async copyNote(note: NoteItem): Promise<void> {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      showToast(t('notes.clipboardUnavailable'), { variant: 'warning' });
      return;
    }
    try {
      await clipboard.writeText(note.content);
      showToast(t('notes.copied'), { variant: 'success' });
    } catch {
      showToast(t('notes.copyFailed'), { variant: 'error' });
    }
  }
}
