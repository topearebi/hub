import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  draftFromShare,
  extractUrl,
  parseLaunchAction,
  parseLaunchIntent,
  parseShareTarget,
  updateAppBadge,
} from '../pwa';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseLaunchAction', () => {
  it('returns known shortcut actions', () => {
    expect(parseLaunchAction('?action=new-task')).toBe('new-task');
    expect(parseLaunchAction('?action=new-note')).toBe('new-note');
    expect(parseLaunchAction('?action=new-bookmark')).toBe('new-bookmark');
  });

  it('ignores unknown or absent actions', () => {
    expect(parseLaunchAction('?action=delete-everything')).toBeNull();
    expect(parseLaunchAction('')).toBeNull();
  });
});

describe('parseShareTarget', () => {
  it('parses title/text/url params', () => {
    expect(parseShareTarget('?title=Hi&text=Body&url=https%3A%2F%2Fx.test')).toEqual({
      title: 'Hi',
      text: 'Body',
      url: 'https://x.test',
    });
  });

  it('returns null when nothing was shared', () => {
    expect(parseShareTarget('?action=new-note')).toBeNull();
  });
});

describe('extractUrl', () => {
  it('extracts an explicit URL from surrounding text', () => {
    expect(extractUrl('see https://example.com/page now')).toBe('https://example.com/page');
  });

  it('normalises a bare domain to HTTPS', () => {
    expect(extractUrl('example.com/x')).toBe('https://example.com/x');
  });

  it('returns null for plain text', () => {
    expect(extractUrl('just some words')).toBeNull();
    expect(extractUrl('')).toBeNull();
  });
});

describe('draftFromShare', () => {
  it('proposes a bookmark when a URL is present', () => {
    const draft = draftFromShare({ title: 'Ex', text: '', url: 'https://ex.test' });
    expect(draft.kind).toBe('bookmark');
    expect(draft.url).toBe('https://ex.test');
    expect(draft.title).toBe('Ex');
  });

  it('proposes a note when only text is present', () => {
    const draft = draftFromShare({ title: 'Memo', text: 'remember this', url: '' });
    expect(draft.kind).toBe('note');
    expect(draft.content).toContain('remember this');
  });
});

describe('parseLaunchIntent', () => {
  it('combines an action and a share payload independently', () => {
    expect(parseLaunchIntent('?action=new-task').action).toBe('new-task');
    expect(parseLaunchIntent('?text=hi').share?.text).toBe('hi');
  });
});

describe('updateAppBadge', () => {
  it('sets the badge for a positive count', () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { setAppBadge, clearAppBadge });

    updateAppBadge(3);

    expect(setAppBadge).toHaveBeenCalledWith(3);
    expect(clearAppBadge).not.toHaveBeenCalled();
  });

  it('clears the badge for a zero count', () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { setAppBadge, clearAppBadge });

    updateAppBadge(0);

    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalled();
  });
});
