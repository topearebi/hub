import { describe, expect, it, vi } from 'vitest';

import { Header } from '../header';
import type { HeaderCallbacks } from '../header';

function makeHeader(overrides: Partial<HeaderCallbacks> = {}): Header {
  return new Header({
    onToggleTasks: vi.fn(),
    onToggleNotes: vi.fn(),
    onOpenProfile: vi.fn(),
    onOpenSync: vi.fn(),
    onHome: vi.fn(),
    ...overrides,
  });
}

describe('Header', () => {
  it('renders a Home affordance', () => {
    const header = makeHeader();
    expect(header.element.querySelector('.header-home')).not.toBeNull();
  });

  it('invokes onHome when the Home button is clicked', () => {
    const onHome = vi.fn();
    const header = makeHeader({ onHome });
    header.element.querySelector<HTMLButtonElement>('.header-home')?.click();
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('reflects Window Controls Overlay narrowing on the header element', () => {
    const header = makeHeader();
    header.setWcoNarrowing({ profileName: false, statusText: false, homeLabel: false });
    expect(header.element.classList.contains('is-wco-narrow-profile')).toBe(true);
    expect(header.element.classList.contains('is-wco-narrow-status')).toBe(true);
    expect(header.element.classList.contains('is-wco-narrow-home')).toBe(true);

    header.setWcoNarrowing({ profileName: true, statusText: true, homeLabel: true });
    expect(header.element.classList.contains('is-wco-narrow-profile')).toBe(false);
    expect(header.element.classList.contains('is-wco-narrow-status')).toBe(false);
    expect(header.element.classList.contains('is-wco-narrow-home')).toBe(false);
  });
});
