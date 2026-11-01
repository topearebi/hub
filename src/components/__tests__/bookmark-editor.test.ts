import { describe, expect, it } from 'vitest';

import {
  HOTKEYS,
  isHotkeyTaken,
  normalizeHotkey,
  parseAlternateUrls,
  validateBookmarkForm,
} from '../bookmark-editor';
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

describe('parseAlternateUrls', () => {
  it('splits on newlines and commas and trims each entry', () => {
    expect(parseAlternateUrls('https://a.test\n  https://b.test ,https://c.test')).toEqual([
      'https://a.test',
      'https://b.test',
      'https://c.test',
    ]);
  });

  it('drops empty entries and de-duplicates while preserving order', () => {
    expect(parseAlternateUrls('https://a.test\n\nhttps://a.test\nhttps://b.test')).toEqual([
      'https://a.test',
      'https://b.test',
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(parseAlternateUrls('   \n  ')).toEqual([]);
  });
});

describe('normalizeHotkey', () => {
  it('accepts the digits 1-9', () => {
    for (const hotkey of HOTKEYS) {
      expect(normalizeHotkey(hotkey)).toBe(hotkey);
    }
  });

  it('rejects empty, zero, and out-of-range values', () => {
    expect(normalizeHotkey('')).toBeUndefined();
    expect(normalizeHotkey('0')).toBeUndefined();
    expect(normalizeHotkey('a')).toBeUndefined();
  });
});

describe('isHotkeyTaken', () => {
  const bookmarks: BookmarkItem[] = [
    makeBookmark({ id: 'b1', title: 'One', url: 'https://one.test', hotkey: '1' }),
    makeBookmark({
      id: 'b2',
      title: 'Two',
      url: 'https://two.test',
      hotkey: '2',
      is_deleted: true,
    }),
  ];

  it('detects a slot owned by a live bookmark', () => {
    expect(isHotkeyTaken('1', bookmarks)).toBe(true);
  });

  it('ignores tombstones', () => {
    expect(isHotkeyTaken('2', bookmarks)).toBe(false);
  });

  it('excludes the bookmark being edited', () => {
    expect(isHotkeyTaken('1', bookmarks, 'b1')).toBe(false);
  });
});

describe('validateBookmarkForm', () => {
  const bookmarks: BookmarkItem[] = [
    makeBookmark({ id: 'b1', title: 'One', url: 'https://one.test', hotkey: '1' }),
  ];

  it('requires a URL', () => {
    const result = validateBookmarkForm(
      { title: '', url: '   ', alternateText: '', hotkey: '' },
      { bookmarks },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/URL/i);
  });

  it('rejects a non-URL value', () => {
    const result = validateBookmarkForm(
      { title: '', url: 'hello world', alternateText: '', hotkey: '' },
      { bookmarks },
    );
    expect(result.ok).toBe(false);
  });

  it('normalises a scheme-less URL and falls back the title to the hostname', () => {
    const result = validateBookmarkForm(
      { title: '  ', url: 'example.com', alternateText: '', hotkey: '' },
      { bookmarks },
    );
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://example.com');
    expect(result.title).toBe('example.com');
  });

  it('keeps an explicit title', () => {
    const result = validateBookmarkForm(
      { title: '  Example ', url: 'https://example.com', alternateText: '', hotkey: '' },
      { bookmarks },
    );
    expect(result.title).toBe('Example');
  });

  it('normalises mirrors, drops the primary self-reference and de-duplicates', () => {
    const result = validateBookmarkForm(
      {
        title: 'Example',
        url: 'https://example.com',
        alternateText: 'mirror.example.com\nhttps://example.com\nhttps://mirror.example.com',
        hotkey: '',
      },
      { bookmarks },
    );
    expect(result.ok).toBe(true);
    expect(result.alternateUrls).toEqual(['https://mirror.example.com']);
  });

  it('rejects a conflicting hotkey', () => {
    const result = validateBookmarkForm(
      { title: 'Two', url: 'https://two.test', alternateText: '', hotkey: '1' },
      { bookmarks },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Alt \+ 1/);
  });

  it('allows the edited bookmark to keep its own hotkey', () => {
    const result = validateBookmarkForm(
      { title: 'One', url: 'https://one.test', alternateText: '', hotkey: '1' },
      { bookmarks, excludeId: 'b1' },
    );
    expect(result.ok).toBe(true);
    expect(result.hotkey).toBe('1');
  });

  it('omits the hotkey when none is selected', () => {
    const result = validateBookmarkForm(
      { title: 'Two', url: 'https://two.test', alternateText: '', hotkey: '' },
      { bookmarks },
    );
    expect(result.ok).toBe(true);
    expect(result.hotkey).toBeUndefined();
  });
});
