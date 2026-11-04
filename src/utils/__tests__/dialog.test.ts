import { afterEach, describe, expect, it, vi } from 'vitest';

import { el } from '../dom';
import { confirmDialog, Dialog, getFocusable } from '../dialog';

/** A body sibling used to assert background inerting. */
function backgroundSibling(): HTMLElement {
  const node = el('div', { text: 'behind' });
  document.body.appendChild(node);
  return node;
}

function keydown(target: HTMLElement, key: string, shiftKey = false): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('getFocusable', () => {
  it('returns enabled focusable descendants and skips disabled ones', () => {
    const container = el('div');
    const a = el('button', { text: 'a' });
    const b = el('button', { text: 'b' });
    b.setAttribute('disabled', '');
    const input = el('input');
    container.append(a, b, input);
    expect(getFocusable(container)).toEqual([a, input]);
  });
});

describe('Dialog', () => {
  it('opens, moves focus inside and inerts the background (G-28)', () => {
    const behind = backgroundSibling();
    const dialog = new Dialog({ label: 'Test dialog' });
    const first = el('button', { text: 'First' });
    const last = el('button', { text: 'Last' });
    dialog.content.append(first, last);

    dialog.open(first);

    expect(dialog.isOpen()).toBe(true);
    expect(dialog.overlay.classList.contains('is-open')).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(behind.hasAttribute('inert')).toBe(true);

    dialog.close();
    expect(behind.hasAttribute('inert')).toBe(false);
  });

  it('traps Tab and Shift+Tab within the dialog', () => {
    const dialog = new Dialog({ label: 'Trap' });
    const first = el('button', { text: 'First' });
    const last = el('button', { text: 'Last' });
    dialog.content.append(first, last);
    dialog.open(first);

    last.focus();
    keydown(dialog.overlay, 'Tab');
    expect(document.activeElement).toBe(first);

    first.focus();
    keydown(dialog.overlay, 'Tab', true);
    expect(document.activeElement).toBe(last);
  });

  it('requests close on Escape and on backdrop click', () => {
    const onRequestClose = vi.fn();
    const dialog = new Dialog({ label: 'Close', onRequestClose });
    dialog.content.append(el('button', { text: 'Ok' }));
    dialog.open();

    keydown(dialog.overlay, 'Escape');
    expect(onRequestClose).toHaveBeenCalledTimes(1);

    dialog.overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onRequestClose).toHaveBeenCalledTimes(2);
  });

  it('does not dismiss on backdrop click when disabled', () => {
    const onRequestClose = vi.fn();
    const dialog = new Dialog({ label: 'Locked', onRequestClose, dismissOnBackdrop: false });
    dialog.open();
    dialog.overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it('restores focus to the invoker on close', () => {
    const invoker = el('button', { text: 'Open' });
    document.body.appendChild(invoker);
    invoker.focus();

    const dialog = new Dialog({ label: 'Restore' });
    const inside = el('button', { text: 'Inside' });
    dialog.content.append(inside);
    dialog.open(inside);
    expect(document.activeElement).toBe(inside);

    dialog.close();
    expect(document.activeElement).toBe(invoker);
  });
});

describe('confirmDialog', () => {
  it('resolves true when confirmed and false when cancelled', async () => {
    const first = confirmDialog({ message: 'Sure?', confirmLabel: 'Yes' });
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Yes',
    );
    confirmButton?.click();
    await expect(first).resolves.toBe(true);

    const second = confirmDialog({ message: 'Sure?', confirmLabel: 'Yes' });
    const cancelButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel',
    );
    cancelButton?.click();
    await expect(second).resolves.toBe(false);
  });

  it('focuses Cancel first for destructive confirmations', async () => {
    const promise = confirmDialog({
      message: 'Delete?',
      confirmLabel: 'Delete',
      danger: true,
    });
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Cancel');
    document
      .querySelectorAll('button')
      .forEach((button) => button.textContent === 'Cancel' && button.click());
    await promise;
  });
});
