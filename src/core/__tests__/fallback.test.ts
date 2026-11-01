import { afterEach, describe, expect, it, vi } from 'vitest';

import { hostnameOf, probeUrl, resolveBookmarkUrl } from '../fallback';
import type { BookmarkItem } from '../../types/schemas';

/** Build a fully-formed bookmark from minimal overrides. */
function makeBookmark(
  overrides: Partial<BookmarkItem> & Pick<BookmarkItem, 'id' | 'title' | 'url'>,
): BookmarkItem {
  return {
    created_at: 1,
    updated_at: 1,
    profile_id: 'p1',
    category_id: 'cat_1',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('hostnameOf', () => {
  it('extracts the hostname from a valid URL', () => {
    expect(hostnameOf('https://example.com/path?q=1')).toBe('example.com');
  });

  it('returns the raw input for malformed URLs', () => {
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});

describe('probeUrl', () => {
  it('resolves true when fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
    await expect(probeUrl('https://ok.test')).resolves.toBe(true);
  });

  it('resolves false when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(probeUrl('https://down.test')).resolves.toBe(false);
  });
});

describe('resolveBookmarkUrl', () => {
  it('short-circuits to the primary URL when no mirrors exist', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await resolveBookmarkUrl(
      makeBookmark({ id: 'b1', title: 'Primary', url: 'https://primary.test' }),
    );

    expect(result).toEqual({
      url: 'https://primary.test',
      usedAlternate: false,
      hostname: 'primary.test',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the primary URL when it is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));

    const result = await resolveBookmarkUrl(
      makeBookmark({
        id: 'b1',
        title: 'Primary',
        url: 'https://primary.test',
        alternate_urls: ['https://mirror.test'],
      }),
    );

    expect(result.usedAlternate).toBe(false);
    expect(result.url).toBe('https://primary.test');
  });

  it('routes to a reachable mirror when the primary fails', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('primary down'))
      .mockResolvedValueOnce({});
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveBookmarkUrl(
      makeBookmark({
        id: 'b1',
        title: 'Primary',
        url: 'https://primary.test',
        alternate_urls: ['https://mirror.test'],
      }),
    );

    expect(result).toEqual({
      url: 'https://mirror.test',
      usedAlternate: true,
      hostname: 'mirror.test',
    });
  });

  it('falls back to the primary URL when every target fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('all down')));

    const result = await resolveBookmarkUrl(
      makeBookmark({
        id: 'b1',
        title: 'Primary',
        url: 'https://primary.test',
        alternate_urls: ['https://mirror.test'],
      }),
    );

    expect(result).toEqual({
      url: 'https://primary.test',
      usedAlternate: false,
      hostname: 'primary.test',
    });
  });
});
