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
  it('renders a Home affordance with the Hub app logo', () => {
    const header = makeHeader();
    const home = header.element.querySelector('.header-home');
    expect(home).not.toBeNull();
    expect(home?.getAttribute('aria-label')).toBe('Home');
    expect(home?.getAttribute('title')).toBe('Home');
    expect(home?.querySelector('.header-home__logo')).not.toBeNull();
    expect(home?.querySelector('.hub-logo__mark')).not.toBeNull();
    expect(home?.querySelector('.hub-logo__bg')).not.toBeNull();
    expect(home?.querySelector('.header-home__label')).toBeNull();
  });

  it('places the status chip in the left cluster (DESIGN.md §6.1)', () => {
    const header = makeHeader();
    const left = header.element.querySelector('.system-header__left');
    expect(left?.querySelector('.status-chip')).not.toBeNull();
    expect(left?.querySelector('.header-home')).not.toBeNull();
  });

  it('keeps the drawer toggles and profile control in the right cluster', () => {
    const header = makeHeader();
    const right = header.element.querySelector('.system-header__right');
    expect(right?.querySelectorAll('.drawer-toggle')).toHaveLength(2);
    expect(right?.querySelector('.profile-button')).not.toBeNull();
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
