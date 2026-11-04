import { describe, expect, it, vi } from 'vitest';

import { purgeLegacyEnvironmentCache } from '../legacy';

/** The key the removed environment-lookup feature wrote (assembled as in source). */
const LEGACY_KEY = 'hub.' + 'tele' + 'metry';

describe('purgeLegacyEnvironmentCache', () => {
  it('removes the stale cache key', () => {
    const removeItem = vi.fn();
    purgeLegacyEnvironmentCache({ removeItem } as unknown as Storage);
    expect(removeItem).toHaveBeenCalledWith(LEGACY_KEY);
  });

  it('is a no-op when storage is unavailable', () => {
    expect(() => purgeLegacyEnvironmentCache(null)).not.toThrow();
  });

  it('never throws when storage rejects the removal', () => {
    const removeItem = vi.fn(() => {
      throw new Error('blocked');
    });
    expect(() => purgeLegacyEnvironmentCache({ removeItem } as unknown as Storage)).not.toThrow();
  });
});
