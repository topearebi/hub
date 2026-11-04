import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  draftFromShare,
  estimateStorage,
  extractUrl,
  formatBytes,
  isStoragePersisted,
  parseLaunchAction,
  parseLaunchIntent,
  parseShareTarget,
  requestPersistentStorage,
  shouldShowInstallPrompt,
  updateAppBadge,
  wcoCssVars,
  wcoNarrowing,
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

describe('wcoCssVars', () => {
  it('maps a titlebar rect to rounded pixel custom properties', () => {
    expect(wcoCssVars({ x: 10.4, y: 0, width: 1200.6, height: 33.5 })).toEqual({
      '--wco-x': '10px',
      '--wco-y': '0px',
      '--wco-w': '1201px',
      '--wco-h': '34px',
    });
  });
});

describe('wcoNarrowing', () => {
  it('keeps everything visible on a wide window', () => {
    expect(wcoNarrowing(1280)).toEqual({ profileName: true, statusText: true, homeLabel: true });
  });

  it('collapses in order as the window narrows', () => {
    expect(wcoNarrowing(420)).toEqual({ profileName: false, statusText: true, homeLabel: true });
    expect(wcoNarrowing(380)).toEqual({ profileName: false, statusText: false, homeLabel: true });
    expect(wcoNarrowing(320)).toEqual({ profileName: false, statusText: false, homeLabel: false });
  });
});

describe('shouldShowInstallPrompt', () => {
  const now = Date.parse('2026-11-04T00:00:00Z');

  it('shows when never dismissed', () => {
    expect(shouldShowInstallPrompt(undefined, now)).toBe(true);
  });

  it('suppresses inside the cool-down window', () => {
    expect(shouldShowInstallPrompt('2026-11-01T00:00:00Z', now)).toBe(false);
  });

  it('re-shows after the cool-down elapses', () => {
    expect(shouldShowInstallPrompt('2026-10-01T00:00:00Z', now)).toBe(true);
  });

  it('treats an unparseable timestamp as never dismissed', () => {
    expect(shouldShowInstallPrompt('not-a-date', now)).toBe(true);
  });
});

describe('formatBytes', () => {
  it('formats byte sizes with sensible units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('storage persistence helpers', () => {
  it('requests persistence and reports the granted state', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persist } });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalled();
  });

  it('returns false when the Storage API is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestPersistentStorage()).resolves.toBe(false);
    await expect(isStoragePersisted()).resolves.toBe(false);
    await expect(estimateStorage()).resolves.toBeNull();
  });

  it('reads the usage/quota estimate', async () => {
    const estimate = vi.fn(async () => ({ usage: 1024, quota: 2048 }));
    vi.stubGlobal('navigator', { storage: { estimate } });
    await expect(estimateStorage()).resolves.toEqual({ usage: 1024, quota: 2048 });
  });
});
