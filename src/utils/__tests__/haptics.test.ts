import { afterEach, describe, expect, it, vi } from 'vitest';

import { haptic, isHapticsSupported } from '../haptics';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('haptics', () => {
  it('reports support as a boolean', () => {
    expect(typeof isHapticsSupported()).toBe('boolean');
  });

  it('calls navigator.vibrate when supported', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic('success');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('never throws when unsupported', () => {
    expect(() => haptic('light')).not.toThrow();
  });
});
