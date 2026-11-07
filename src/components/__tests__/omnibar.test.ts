import { describe, expect, it } from 'vitest';

import {
  Omnibar,
  buildOmnibarActions,
  defaultActiveIndex,
  filterBookmarks,
  fuzzyScore,
  isUrlLike,
  normalizeUrl,
  resolveQuery,
} from '../omnibar';
import { DEFAULT_APP_CONFIG } from '../../types/schemas';
import type { BookmarkItem, SearchProvider } from '../../types/schemas';

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

const PROVIDERS: SearchProvider[] = [
  { id: 'sp_ddg', name: 'DuckDuckGo', query_url: 'https://duckduckgo.com/?q=%s', is_default: true },
  {
    id: 'sp_google',
    name: 'Google',
    query_url: 'https://www.google.com/search?q=%s',
    is_default: false,
  },
];

describe('isUrlLike', () => {
  it('detects explicit schemes', () => {
    expect(isUrlLike('https://example.com')).toBe(true);
    expect(isUrlLike('http://example.com/path')).toBe(true);
  });

  it('detects scheme-less domains via the TLD pattern', () => {
    expect(isUrlLike('example.com')).toBe(true);
    expect(isUrlLike('sub.example.co.uk/path')).toBe(true);
  });

  it('rejects plain search queries', () => {
    expect(isUrlLike('hello world')).toBe(false);
    expect(isUrlLike('justtext')).toBe(false);
    expect(isUrlLike('')).toBe(false);
  });

  it('accepts localhost, IP literals and intranet hosts (G-58)', () => {
    expect(isUrlLike('localhost')).toBe(true);
    expect(isUrlLike('localhost:3000')).toBe(true);
    expect(isUrlLike('192.168.1.1')).toBe(true);
    expect(isUrlLike('192.168.1.1:8080/path')).toBe(true);
    expect(isUrlLike('[::1]:3000')).toBe(true);
    expect(isUrlLike('intranet:8080')).toBe(true);
  });

  it('accepts IDN (Unicode) domains (G-58)', () => {
    expect(isUrlLike('münchen.de')).toBe(true);
    expect(isUrlLike('例え.jp')).toBe(true);
    expect(isUrlLike('sub.münchen.de/path')).toBe(true);
  });

  it('still rejects dangerous schemes (G-58)', () => {
    expect(isUrlLike('javascript:alert(1)')).toBe(false);
    expect(isUrlLike('data:text/html,<h1>x</h1>')).toBe(false);
    expect(isUrlLike('vbscript:msgbox(1)')).toBe(false);
  });

  it('does not misclassify decimals or email addresses as URLs', () => {
    expect(isUrlLike('3.14')).toBe(false);
    expect(isUrlLike('user@example.com')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('prepends https to scheme-less input', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });

  it('leaves explicit schemes untouched', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
  });
});

describe('fuzzyScore', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyScore('gh', 'GitHub')).not.toBeNull();
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'GitHub')).toBeNull();
  });

  it('scores contiguous matches higher than scattered ones', () => {
    const contiguous = fuzzyScore('git', 'GitHub');
    const scattered = fuzzyScore('git', 'Giraffe In Tree');
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous ?? 0).toBeGreaterThan(scattered ?? 0);
  });

  it('does not award the contiguity bonus to the first matched character', () => {
    // Regression: the first match previously compared `lastMatch (-1)` against
    // `ti - 1 (-1)` and wrongly earned the +3 contiguity bonus.
    // 'a' at index 0 => base(1) + start-of-string(2) = 3.
    expect(fuzzyScore('a', 'apple')).toBe(3);
    expect(fuzzyScore('a', 'banana')).toBe(1);
    // 'ab' contiguous from the start => (1 + 2) + (1 + 3) = 6.
    expect(fuzzyScore('ab', 'abzzz')).toBe(6);
  });
});

describe('filterBookmarks', () => {
  const bookmarks: BookmarkItem[] = [
    makeBookmark({ id: 'b1', title: 'GitHub', url: 'https://github.com' }),
    makeBookmark({ id: 'b2', title: 'GitLab', url: 'https://gitlab.com' }),
    makeBookmark({ id: 'b3', title: 'Deleted', url: 'https://deleted.test', is_deleted: true }),
  ];

  it('returns an empty list for an empty query', () => {
    expect(filterBookmarks('', bookmarks)).toEqual([]);
  });

  it('matches on title and excludes tombstones', () => {
    const results = filterBookmarks('git', bookmarks);
    expect(results.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('matches on URL as well as title', () => {
    const results = filterBookmarks('gitlab', bookmarks);
    expect(results.map((b) => b.id)).toEqual(['b2']);
  });

  it('matches on description as well as title and URL', () => {
    const list: BookmarkItem[] = [
      makeBookmark({
        id: 'b1',
        title: 'Dashboard',
        url: 'https://dash.test',
        description: 'Kubernetes monitoring cluster',
      }),
      makeBookmark({ id: 'b2', title: 'Repo', url: 'https://repo.test' }),
    ];
    const results = filterBookmarks('kuber', list);
    expect(results.map((b) => b.id)).toEqual(['b1']);
  });
});

describe('resolveQuery', () => {
  const bookmarks: BookmarkItem[] = [
    makeBookmark({ id: 'b1', title: 'GitHub', url: 'https://github.com' }),
  ];

  it('prefers a bookmark match over URL/search', () => {
    const result = resolveQuery('github', bookmarks, PROVIDERS);
    expect(result.type).toBe('bookmark');
    if (result.type === 'bookmark') {
      expect(result.bookmark.id).toBe('b1');
    }
  });

  it('navigates directly when the query is URL-like', () => {
    const result = resolveQuery('example.com', bookmarks, PROVIDERS);
    expect(result).toEqual({ type: 'url', url: 'https://example.com' });
  });

  it('falls back to the default search provider', () => {
    const result = resolveQuery('hello world', bookmarks, PROVIDERS);
    expect(result).toEqual({
      type: 'search',
      url: 'https://duckduckgo.com/?q=hello%20world',
    });
  });
});

describe('buildOmnibarActions', () => {
  const bookmarks: BookmarkItem[] = [
    makeBookmark({ id: 'b1', title: 'GitHub', url: 'https://github.com' }),
  ];

  it('returns no actions for an empty query', () => {
    expect(buildOmnibarActions('', bookmarks, PROVIDERS)).toEqual([]);
  });

  it('prefers bookmark matches over the add/navigate rows', () => {
    const actions = buildOmnibarActions('github', bookmarks, PROVIDERS);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe('bookmark');
  });

  it('offers an add row above the navigate row for a URL-like query', () => {
    const actions = buildOmnibarActions('example.com', bookmarks, PROVIDERS);
    expect(actions.map((action) => action.kind)).toEqual(['add', 'navigate']);
    expect(actions[0]).toEqual({ kind: 'add', url: 'https://example.com' });
    expect(actions[1]).toEqual({ kind: 'navigate', url: 'https://example.com' });
  });

  it('falls back to a search action for a plain query', () => {
    const actions = buildOmnibarActions('hello world', bookmarks, PROVIDERS);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe('search');
  });
});

describe('defaultActiveIndex', () => {
  it('skips a leading add row so Enter navigates by default', () => {
    expect(
      defaultActiveIndex([
        { kind: 'add', url: 'https://example.com' },
        { kind: 'navigate', url: 'https://example.com' },
      ]),
    ).toBe(1);
  });

  it('selects the first bookmark or search row', () => {
    expect(defaultActiveIndex([{ kind: 'search', url: 'https://duckduckgo.com/?q=x' }])).toBe(0);
  });

  it('returns -1 when there are no actions', () => {
    expect(defaultActiveIndex([])).toBe(-1);
  });
});

describe('Alt+[1-9] hotkey', () => {
  it('ignores the hotkey while the user is typing in a text field', () => {
    const bookmark = makeBookmark({
      id: 'b1',
      title: 'One',
      url: 'https://one.test',
      hotkey: '1',
    });
    let activated = 0;
    const fakeStore = {
      activeBookmarks: [bookmark],
      sortedCategories: [],
      appConfig: DEFAULT_APP_CONFIG,
      activeProfile: null,
      profiles: [],
      getRecentBookmarks: () => [],
      getBookmarksByCategory: () => [],
    };
    const omnibar = new Omnibar(fakeStore, {
      onActivateBookmark: () => {
        activated += 1;
      },
      onNavigate: () => undefined,
      onAddBookmark: () => undefined,
    });
    document.body.appendChild(omnibar.element);
    omnibar.attachGlobalHotkeys();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', altKey: true, bubbles: true }));

    expect(activated).toBe(0);
    omnibar.destroy();
  });
});
