/**
 * Hub Share Target Prompt
 * -----------------------
 * Presents shared (or manually entered) content in an editable modal and lets
 * the user save it as either a bookmark or a scratchpad note. Rendering is
 * XSS-safe: all values go through `textContent`/`value`, never `innerHTML`.
 */

import { el } from '../utils/dom';
import type { ShareDraft } from '../core/pwa';

export interface BookmarkDraft {
  title: string;
  url: string;
}

export interface NoteDraft {
  title: string;
  content: string;
}

export interface ShareTargetPromptOptions {
  onCreateBookmark: (draft: BookmarkDraft) => Promise<void> | void;
  onCreateNote: (draft: NoteDraft) => Promise<void> | void;
  onDismiss: () => void;
}

export class ShareTargetPrompt {
  readonly element: HTMLElement;

  private readonly titleInput: HTMLInputElement;
  private readonly urlInput: HTMLInputElement;
  private readonly contentInput: HTMLTextAreaElement;
  private readonly statusEl: HTMLElement;

  constructor(private readonly options: ShareTargetPromptOptions) {
    this.titleInput = el('input', {
      className: 'drawer__input',
      attrs: { type: 'text', placeholder: 'Title', 'aria-label': 'Share title' },
    });
    this.urlInput = el('input', {
      className: 'drawer__input',
      attrs: { type: 'text', placeholder: 'https://…', 'aria-label': 'Share URL' },
    });
    this.contentInput = el('textarea', {
      className: 'drawer__textarea',
      attrs: { placeholder: 'Text', 'aria-label': 'Share content', rows: '4' },
    });
    this.statusEl = el('p', {
      className: 'share__status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const bookmarkButton = el('button', {
      className: 'button button--primary',
      text: 'Save bookmark',
      attrs: { type: 'button' },
    });
    bookmarkButton.addEventListener('click', () => {
      void this.saveBookmark();
    });

    const noteButton = el('button', {
      className: 'button',
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
      children: [dismissButton, noteButton, bookmarkButton],
    });

    const title = el('h2', { className: 'modal__title', text: 'Save shared content' });
    const body = el('div', {
      className: 'share__body',
      children: [this.titleInput, this.urlInput, this.contentInput, this.statusEl, actions],
    });
    const dialog = el('div', {
      className: 'modal',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Save shared content' },
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
    this.urlInput.value = draft.url ?? '';
    this.contentInput.value = draft.content;
    this.statusEl.textContent = '';
    this.element.classList.add('is-open');
    (draft.kind === 'bookmark' ? this.urlInput : this.contentInput).focus();
  }

  close(): void {
    this.element.classList.remove('is-open');
  }

  private async saveBookmark(): Promise<void> {
    const url = this.urlInput.value.trim();
    if (url.length === 0) {
      this.statusEl.textContent = 'Enter a URL to save a bookmark.';
      return;
    }
    await this.options.onCreateBookmark({
      title: this.titleInput.value.trim() || url,
      url,
    });
    this.statusEl.textContent = 'Bookmark saved.';
    this.close();
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
