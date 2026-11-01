import { describe, expect, it } from 'vitest';

import { linkify } from '../text';

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
