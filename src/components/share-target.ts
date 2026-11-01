/**
 * Hub Share Target Prompt
 * -----------------------
 * Presents shared (or manually entered) content in an editable modal and saves
 * it as a scratchpad note.
 *
 * Bookmark shares are handled by the dedicated `BookmarkEditor`, so this prompt
 * is intentionally note-only to keep a single bookmark-creation path. Rendering
 * is XSS-safe: all values go through `textContent`/`value`, never `innerHTML`.
 */

import { el } from '../utils/dom';
import type { ShareDraft } from '../core/pwa';

export interface NoteDraft {
  title: string;
  content: string;
}

export interface ShareTargetPromptOptions {
  onCreateNote: (draft: NoteDraft) => Promise<void> | void;
  onDismiss: () => void;
}

export class ShareTargetPrompt {
  readonly element: HTMLElement;

  private readonly titleInput: HTMLInputElement;
  private readonly contentInput: HTMLTextAreaElement;
  private readonly statusEl: HTMLElement;

  constructor(private readonly options: ShareTargetPromptOptions) {
    this.titleInput = el('input', {
      className: 'drawer__input',
      attrs: { type: 'text', placeholder: 'Title', 'aria-label': 'Share title' },
    });
    this.contentInput = el('textarea', {
      className: 'drawer__textarea',
      attrs: { placeholder: 'Text', 'aria-label': 'Share content', rows: '4' },
    });
    this.statusEl = el('p', {
      className: 'share__status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const noteButton = el('button', {
      className: 'button button--primary',
      text: 'Save note',
      attrs: { type: 'button' },
    });
    noteButton.addEventListener('click', () => {
      void this.saveNote();
    });

    const dismissButton = el('button', {
      className: 'button',
      text: 'Dismiss',
      attrs: { type: 'button' },
    });
    dismissButton.addEventListener('click', () => {
      this.options.onDismiss();
      this.close();
    });

    const actions = el('div', {
      className: 'share__actions',
      children: [dismissButton, noteButton],
    });

    const title = el('h2', { className: 'modal__title', text: 'Save shared note' });
    const body = el('div', {
      className: 'share__body',
      children: [this.titleInput, this.contentInput, this.statusEl, actions],
    });
    const dialog = el('div', {
      className: 'modal',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Save shared note' },
      children: [title, body],
    });
    const overlay = el('div', { className: 'modal-overlay share-overlay', children: [dialog] });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.options.onDismiss();
        this.close();
      }
    });

    this.element = overlay;
  }

  /** Prefill the form from a draft and reveal the modal. */
  open(draft: ShareDraft): void {
    this.titleInput.value = draft.title;
    this.contentInput.value = draft.content;
    this.statusEl.textContent = '';
    this.element.classList.add('is-open');
    this.contentInput.focus();
  }

  close(): void {
    this.element.classList.remove('is-open');
  }

  private async saveNote(): Promise<void> {
    const content = this.contentInput.value.trim();
    if (content.length === 0) {
      this.statusEl.textContent = 'Enter some text to save a note.';
      return;
    }
    await this.options.onCreateNote({
      title: this.titleInput.value.trim() || 'Shared note',
      content,
    });
    this.statusEl.textContent = 'Note saved.';
    this.close();
  }
}
