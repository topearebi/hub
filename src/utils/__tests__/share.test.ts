import { afterEach, describe, expect, it, vi } from 'vitest';

import { canShare, share } from '../share';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'share');
});

describe('share', () => {
  it('reports availability as a boolean', () => {
    expect(typeof canShare()).toBe('boolean');
  });

  it('returns false when unsupported', async () => {
    expect(await share({ title: 'x' })).toBe(false);
  });

  it('invokes navigator.share when available', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true });
    expect(await share({ title: 'x', url: 'https://example.com' })).toBe(true);
    expect(shareMock).toHaveBeenCalledWith({ title: 'x', url: 'https://example.com' });
  });

  it('returns false when the user cancels', async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error('cancelled'));
    Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true });
    expect(await share({ title: 'x' })).toBe(false);
  });
});
