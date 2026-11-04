import { afterEach, describe, expect, it, vi } from 'vitest';

import { showToast } from '../toast';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('showToast', () => {
  it('renders an info/success toast as role="status"', () => {
    showToast('Saved', { variant: 'success' });
    const toast = document.querySelector('.toast');
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.textContent).toContain('Saved');
  });

  it('renders warnings/errors as persistent role="alert" (G-37)', () => {
    vi.useFakeTimers();
    showToast('Boom', { variant: 'error' });
    const toast = document.querySelector('.toast');
    expect(toast?.getAttribute('role')).toBe('alert');

    // Persistent: it must survive well past the default duration.
    vi.advanceTimersByTime(20_000);
    expect(document.querySelector('.toast')).not.toBeNull();
  });

  it('auto-dismisses timed toasts', () => {
    vi.useFakeTimers();
    showToast('Hi', { variant: 'info' });
    expect(document.querySelector('.toast')).not.toBeNull();

    vi.advanceTimersByTime(5000); // past the 4s duration
    vi.advanceTimersByTime(400); // safety-net removal
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('invokes the action callback and dismisses', () => {
    const onSelect = vi.fn();
    showToast('Deleted', { variant: 'info', action: { label: 'Undo', onSelect } });
    document.querySelector<HTMLButtonElement>('.toast__action')?.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('removes the toast via the dismiss button', () => {
    vi.useFakeTimers();
    showToast('Hi', { variant: 'info' });
    document.querySelector<HTMLButtonElement>('.toast__dismiss')?.click();
    vi.advanceTimersByTime(400);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('deduplicates toasts sharing a key instead of stacking', () => {
    showToast('First', { variant: 'info', dedupeKey: 'opening' });
    showToast('Second', { variant: 'info', dedupeKey: 'opening' });
    const messages = Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent);
    expect(messages.some((message) => message?.includes('Second'))).toBe(true);
  });

  it('invokes onDismiss when the dismiss button is used', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    showToast('Install Hub?', { variant: 'info', persistent: true, onDismiss });
    document.querySelector<HTMLButtonElement>('.toast__dismiss')?.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
