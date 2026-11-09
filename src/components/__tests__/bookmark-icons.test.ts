import { describe, expect, it } from 'vitest';
import { populateBookmarkContent } from '../bookmarks';

const bookmark = {
  title: 'Example',
  url: 'https://example.test/saved/path?private=query#fragment',
};
function render(icon?: string, url = bookmark.url) {
  const host = document.createElement('button');
  populateBookmarkContent(
    host,
    { ...bookmark, ...(icon === undefined ? {} : { icon }), url },
    'small',
  );
  return host;
}

describe('bookmark image regression', () => {
  it.each(['small', 'wide', 'large'] as const)(
    'renders external custom images on %s cards',
    (size) => {
      const host = document.createElement('button');
      populateBookmarkContent(host, { ...bookmark, icon: 'https://images.test/custom.png' }, size);
      const image = host.querySelector('img')!;
      expect(image.src).toBe('https://images.test/custom.png');
      expect(image.alt).toBe('');
      expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(image.getAttribute('loading')).toBe('lazy');
    },
  );
  it('loads the direct origin favicon without sharing bookmark paths or queries', () => {
    expect(render().querySelector('img')?.src).toBe('https://example.test/favicon.ico');
    expect(
      render(undefined, 'https://user:password@example.test/path').querySelector('img')?.src,
    ).toBe('https://example.test/favicon.ico');
  });
  it('supports scheme-less bookmarked hosts', () => {
    expect(render(undefined, 'example.test/path').querySelector('img')?.src).toBe(
      'https://example.test/favicon.ico',
    );
  });
  it.each(['/custom.svg', 'data:image/png;base64,AAAA', 'blob:https://localhost/icon'])(
    'keeps supported local image source %s',
    (icon) => {
      expect(render(icon).querySelector('img')?.src).toBe(new URL(icon, window.location.href).href);
    },
  );
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///secret'])(
    'rejects unsafe custom source %s',
    (icon) => {
      expect(render(icon).querySelector('img')?.src).toBe('https://example.test/favicon.ico');
    },
  );
  it('falls back from custom image to favicon to local avatar with no retry loop', () => {
    const host = render('https://images.test/broken.png');
    const image = host.querySelector('img')!;
    image.dispatchEvent(new Event('error'));
    expect(image.src).toBe('https://example.test/favicon.ico');
    image.dispatchEvent(new Event('error'));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.tile__icon--fallback')?.textContent).toBe('E');
    expect(host.textContent).toContain('Example');
  });
  it('does not retry the same explicit favicon URL twice', () => {
    const host = render('https://example.test/favicon.ico');
    host.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(host.querySelector('img')).toBeNull();
  });
  it('falls back locally for invalid bookmark protocols', () => {
    expect(
      render(undefined, 'javascript:alert(1)').querySelector('.tile__icon--fallback'),
    ).not.toBeNull();
  });
});
