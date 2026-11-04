import { afterEach, describe, expect, it } from 'vitest';

import {
  MESSAGES,
  applyDocumentLocale,
  dirFor,
  formatDate,
  formatRelativeTime,
  getLocale,
  isPseudoLocale,
  pseudo,
  setLocale,
  setPseudoLocale,
  t,
  tp,
} from '../i18n';

afterEach(() => {
  setPseudoLocale(false);
  setLocale('en');
});

describe('t', () => {
  it('returns the English message for a known key', () => {
    expect(t('common.save')).toBe('Save');
  });

  it('interpolates {name} tokens', () => {
    expect(t('common.actionsFor', { name: 'Wikipedia' })).toBe('Actions for Wikipedia');
  });

  it('falls back to the key when unknown', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('leaves an unresolved token in place', () => {
    expect(t('common.actionsFor')).toBe('Actions for {name}');
  });
});

describe('tp', () => {
  it('uses the singular form for a count of one', () => {
    expect(tp('omnibar.resultCount', 1)).toBe('1 result');
  });

  it('uses the plural form otherwise', () => {
    expect(tp('omnibar.resultCount', 3)).toBe('3 results');
    expect(tp('omnibar.resultCount', 0)).toBe('0 results');
  });
});

describe('pseudo-locale', () => {
  it('wraps and accents a string', () => {
    const result = pseudo('Save');
    expect(result.startsWith('⟦')).toBe(true);
    expect(result.endsWith('⟧')).toBe(true);
    expect(result).not.toBe('Save');
  });

  it('transforms every message when enabled', () => {
    setPseudoLocale(true);
    expect(isPseudoLocale()).toBe(true);
    expect(t('common.save')).toContain('⟦');
    expect(tp('omnibar.resultCount', 2)).toContain('⟦');
  });

  it('is off by default', () => {
    expect(isPseudoLocale()).toBe(false);
    expect(t('common.save')).toBe('Save');
  });
});

describe('locale + direction', () => {
  it('reports RTL for right-to-left locales', () => {
    expect(dirFor('ar')).toBe('rtl');
    expect(dirFor('he-IL')).toBe('rtl');
    expect(dirFor('en')).toBe('ltr');
    expect(dirFor('fr-FR')).toBe('ltr');
  });

  it('reflects the locale on the document root', () => {
    setLocale('ar');
    expect(getLocale()).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');

    setLocale('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('applyDocumentLocale is safe to call directly', () => {
    expect(() => applyDocumentLocale()).not.toThrow();
  });
});

describe('date/time', () => {
  it('formats a date with the active locale', () => {
    const value = new Date('2026-03-04T12:00:00Z');
    expect(formatDate(value, { month: 'short', day: 'numeric' })).toMatch(/Mar/);
  });

  it('formats a relative time', () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now, now)).toBe('just now');
    expect(formatRelativeTime(now - 2 * 60_000, now)).toBe('2 min ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 d ago');
  });
});

describe('catalogue integrity', () => {
  it('has no empty message values', () => {
    for (const [key, value] of Object.entries(MESSAGES)) {
      expect(value.trim().length, `empty message for ${key}`).toBeGreaterThan(0);
    }
  });

  it('defines both plural forms for every plural key', () => {
    const pluralBases = new Set(
      Object.keys(MESSAGES)
        .filter((key) => key.endsWith('.one') || key.endsWith('.other'))
        .map((key) => key.replace(/\.(one|other)$/, '')),
    );
    for (const base of pluralBases) {
      expect(MESSAGES[`${base}.one`], `missing ${base}.one`).toBeDefined();
      expect(MESSAGES[`${base}.other`], `missing ${base}.other`).toBeDefined();
    }
  });
});
