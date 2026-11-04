import { describe, expect, it, vi } from 'vitest';

import { OnboardingCard } from '../onboarding';

function makeCard(): {
  card: OnboardingCard;
  callbacks: {
    onAddBookmark: ReturnType<typeof vi.fn>;
    onImport: ReturnType<typeof vi.fn>;
    onConnectSync: ReturnType<typeof vi.fn>;
    onTrySample: ReturnType<typeof vi.fn>;
    onInstall: ReturnType<typeof vi.fn>;
    onComplete: ReturnType<typeof vi.fn>;
  };
} {
  const callbacks = {
    onAddBookmark: vi.fn(),
    onImport: vi.fn(),
    onConnectSync: vi.fn(),
    onTrySample: vi.fn(),
    onInstall: vi.fn(),
    onComplete: vi.fn(),
  };
  return { card: new OnboardingCard(callbacks), callbacks };
}

/** Find a button by its visible label. */
function buttonByText(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(text),
  );
}

describe('OnboardingCard (G-39)', () => {
  it('offers the three primary ways to get started', () => {
    const { card, callbacks } = makeCard();
    document.body.appendChild(card.element);

    buttonByText(card.element, 'Add your first link')?.click();
    expect(callbacks.onAddBookmark).toHaveBeenCalledTimes(1);

    buttonByText(card.element, 'Import links')?.click();
    expect(callbacks.onImport).toHaveBeenCalledTimes(1);

    buttonByText(card.element, 'Connect sync')?.click();
    expect(callbacks.onConnectSync).toHaveBeenCalledTimes(1);

    card.destroy();
  });

  it('seeds the optional sample set on request', () => {
    const { card, callbacks } = makeCard();
    document.body.appendChild(card.element);

    buttonByText(card.element, 'Try a sample set')?.click();
    expect(callbacks.onTrySample).toHaveBeenCalledTimes(1);

    card.destroy();
  });

  it('persists completion and hides when skipped', () => {
    const { card, callbacks } = makeCard();
    document.body.appendChild(card.element);
    expect(card.isVisible()).toBe(true);

    buttonByText(card.element, 'Skip')?.click();
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    expect(card.isVisible()).toBe(false);

    card.destroy();
  });
});
