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
import { Dialog } from '../utils/dialog';
import { t } from '../utils/i18n';
import type { ShareDraft } from '../core/pwa';

let shareDialogSeq = 0;

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

  private readonly dialog: Dialog;
  private readonly titleId: string;
  private readonly titleInput: HTMLInputElement;
  private readonly contentInput: HTMLTextAreaElement;
  private readonly statusEl: HTMLElement;

  constructor(private readonly options: ShareTargetPromptOptions) {
    shareDialogSeq += 1;
    this.titleId = `share-title-${shareDialogSeq}`;
    this.dialog = new Dialog({
      labelledBy: this.titleId,
      sheet: true,
      onRequestClose: () => {
        this.options.onDismiss();
        this.close();
      },
    });

    this.titleInput = el('input', {
      className: 'drawer__input',
      attrs: {
        type: 'text',
        placeholder: t('share.titlePlaceholder'),
        'aria-label': t('share.titleAria'),
      },
    });
    this.contentInput = el('textarea', {
      className: 'drawer__textarea',
      attrs: {
        placeholder: t('share.contentPlaceholder'),
        'aria-label': t('share.contentAria'),
        rows: '4',
      },
    });
    this.statusEl = el('p', {
      className: 'share__status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const noteButton = el('button', {
      className: 'button button--primary',
      text: t('share.saveNote'),
      attrs: { type: 'button' },
    });
    noteButton.addEventListener('click', () => {
      void this.saveNote();
    });

    const dismissButton = el('button', {
      className: 'button',
      text: t('common.dismiss'),
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

    const title = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: t('share.heading'),
    });
    const body = el('div', {
      className: 'share__body',
      children: [this.titleInput, this.contentInput, this.statusEl, actions],
    });
    this.dialog.content.appendChild(title);
    this.dialog.content.appendChild(body);

    this.element = this.dialog.overlay;
  }

  /** Prefill the form from a draft and reveal the modal. */
  open(draft: ShareDraft): void {
    this.titleInput.value = draft.title;
    this.contentInput.value = draft.content;
    this.statusEl.textContent = '';
    this.dialog.open(this.contentInput);
  }

  close(): void {
    this.dialog.close();
  }

  private async saveNote(): Promise<void> {
    const content = this.contentInput.value.trim();
    if (content.length === 0) {
      this.statusEl.textContent = t('share.empty');
      return;
    }
    await this.options.onCreateNote({
      title: this.titleInput.value.trim() || t('share.defaultTitle'),
      content,
    });
    this.statusEl.textContent = t('share.saved');
    this.close();
  }
}
