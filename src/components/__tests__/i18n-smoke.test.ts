import { afterEach, describe, expect, it, vi } from 'vitest';

import { setPseudoLocale } from '../../utils/i18n';
import { Header } from '../header';
import { LockScreen } from '../lock-screen';
import { OnboardingCard } from '../onboarding';

afterEach(() => setPseudoLocale(false));

/**
 * Pseudo-locale smoke test (G-38): with the pseudo-locale enabled, every
 * user-visible string a component renders must come from the catalogue, so its
 * text is wrapped in `⟦…⟧`. A component that still shows plain English has a
 * hard-coded string that escaped the catalogue.
 */
describe('pseudo-locale smoke test', () => {
  it('renders the header chrome through the catalogue', () => {
    setPseudoLocale(true);
    const header = new Header({
      onToggleTasks: vi.fn(),
      onToggleNotes: vi.fn(),
      onOpenProfile: vi.fn(),
      onOpenSync: vi.fn(),
      onHome: vi.fn(),
    });
    expect(header.element.textContent).toContain('⟦');
  });

  it('renders the onboarding card through the catalogue', () => {
    setPseudoLocale(true);
    const card = new OnboardingCard({
      onAddBookmark: vi.fn(),
      onImport: vi.fn(),
      onConnectSync: vi.fn(),
      onTrySample: vi.fn(),
      onInstall: vi.fn(),
      onComplete: vi.fn(),
    });
    expect(card.element.textContent).toContain('⟦');
  });

  it('renders the lock screen through the catalogue', () => {
    setPseudoLocale(true);
    const lock = new LockScreen({ verify: async () => true, onUnlocked: vi.fn() });
    expect(lock.element.textContent).toContain('⟦');
  });
});
