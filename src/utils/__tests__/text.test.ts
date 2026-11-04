import { describe, expect, it } from 'vitest';

import { initialOf, linkify, safeCssUrl } from '../text';

describe('linkify', () => {
  it('splits surrounding text from URLs', () => {
    expect(linkify('see https://a.test now')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'url', value: 'https://a.test' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('returns a single text segment when no URL is present', () => {
    expect(linkify('plain text')).toEqual([{ type: 'text', value: 'plain text' }]);
  });

  it('handles a lone URL', () => {
    expect(linkify('https://a.test')).toEqual([{ type: 'url', value: 'https://a.test' }]);
  });

  it('handles a trailing URL', () => {
    expect(linkify('link: http://b.test')).toEqual([
      { type: 'text', value: 'link: ' },
      { type: 'url', value: 'http://b.test' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(linkify('')).toEqual([]);
  });
});

describe('initialOf', () => {
  it('returns the first character, uppercased', () => {
    expect(initialOf('github')).toBe('G');
    expect(initialOf('  spaced  ')).toBe('S');
  });

  it('treats emoji/surrogate pairs as a single character (G-59)', () => {
    expect(initialOf('😀 party')).toBe('😀');
    expect(initialOf('🚀 launch')).toBe('🚀');
  });

  it('falls back when the input is empty or missing', () => {
    expect(initialOf('', 'H')).toBe('H');
    expect(initialOf('   ', 'H')).toBe('H');
    expect(initialOf(null, 'H')).toBe('H');
    expect(initialOf(undefined)).toBe('?');
  });
});

describe('safeCssUrl', () => {
  it('allows http, https, data:image and relative paths', () => {
    expect(safeCssUrl('https://cdn.test/a.png')).toBe('https://cdn.test/a.png');
    expect(safeCssUrl('http://cdn.test/a.png')).toBe('http://cdn.test/a.png');
    expect(safeCssUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(safeCssUrl('/avatar.png')).toBe('/avatar.png');
  });

  it('escapes double quotes and backslashes (G-55)', () => {
    expect(safeCssUrl('/a"b.png')).toBe('/a\\"b.png');
    expect(safeCssUrl('/a\\b.png')).toBe('/a\\\\b.png');
  });

  it('strips line breaks that could break out of the token', () => {
    expect(safeCssUrl('/a\nb.png')).toBe('/ab.png');
  });

  it('rejects dangerous or unexpected schemes', () => {
    expect(safeCssUrl('javascript:alert(1)')).toBe('');
    expect(safeCssUrl('data:text/html,<script>')).toBe('');
    expect(safeCssUrl('vbscript:msgbox')).toBe('');
  });

  it('returns an empty string for blank input', () => {
    expect(safeCssUrl('   ')).toBe('');
  });
});
