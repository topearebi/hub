/**
 * Hub Search Engine Icons & Presets
 * ---------------------------------
 * Local vector SVG marks for search providers (PRD §2, AGENTS.md §1).
 * Zero external requests / no third-party CDNs.
 */

import { el, svg } from './dom';
import { initialOf } from './text';
import type { SearchProvider } from '../types/schemas';

export interface SearchPreset {
  id: string;
  name: string;
  query_url: string;
  icon?: string;
}

function createSvgIcon(pathData: string, size: number, stroke = false): SVGSVGElement {
  const node = svg(pathData, { size, className: 'engine-icon engine-icon--svg' });
  if (!stroke) {
    node.setAttribute('fill', 'currentColor');
    node.removeAttribute('stroke');
  }
  return node;
}

/**
 * Clean 24x24 vector paths for popular search providers.
 */
const PRESET_PATHS: Record<string, string> = {
  duckduckgo:
    'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 15c-3 0-5-2-5-4h10c0 2-2 4-5 4zm-2.5-6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  google:
    'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8h-8v-3h11a10 10 0 0 1-11 11z',
  bing: 'M5 3v18l5.5-3.1 5.3 3.1 3.2-1.8V9.5L12 6.2 8.6 4.9 5 3zm3.7 4.5 3.3 1.3v7.4l-3.3-1.8zm5.1 3.3 1.8 1v5.1l-1.8-1z',
  brave:
    'M12 2 4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5zm0 4a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V17h-4v-3.5A4 4 0 0 1 8 10a4 4 0 0 1 4-4z',
  kagi: 'M6 4h4v6.5L14.5 4H19l-5.8 7.5L19 20h-4.8L10 13.2V20H6V4z',
  youtube:
    'M22 6a3 3 0 0 0-2-2C18 3.5 12 3.5 12 3.5s-6 0-8 .5A3 3 0 0 0 2 6c-.5 2-.5 6-.5 6s0 4 .5 6a3 3 0 0 0 2 2c2 .5 8 .5 8 .5s6 0 8-.5a3 3 0 0 0 2-2c.5-2 .5-6 .5-6s0-4-.5-6zM10 15.5v-7l6 3.5z',
};

/**
 * Built-in presets available in the Search Engine Manager.
 */
const u = (h: string, p = '/search?q=') => `https://${h}${p}%s`;
const sp = (id: string, name: string, query_url: string): SearchPreset => ({ id, name, query_url });
export const SEARCH_PRESETS: readonly SearchPreset[] = [
  sp('google', 'Google', u('www.google.com')),
  sp('duckduckgo', 'DuckDuckGo', u('duckduckgo.com', '/?q=')),
  sp('brave', 'Brave', u('search.brave.com')),
  sp('bing', 'Bing', u('www.bing.com')),
  sp('kagi', 'Kagi', u('kagi.com')),
  sp('youtube', 'YouTube', u('www.youtube.com', '/results?search_query=')),
  sp('github', 'GitHub', u('github.com')),
  sp('wikipedia', 'Wikipedia', u('en.wikipedia.org', '/wiki/Special:Search?search=')),
];

/**
 * Detect a known preset ID from an engine's name or query URL.
 */
export function matchPresetEngine(name: string, url: string): string | null {
  const normName = name.trim().toLowerCase();
  const normUrl = url.trim().toLowerCase();

  for (const preset of SEARCH_PRESETS) {
    if (
      normName === preset.id ||
      normName === preset.name.toLowerCase() ||
      normUrl.includes(preset.id)
    ) {
      return preset.icon ?? preset.id;
    }
  }

  return null;
}

/**
 * Render a search engine icon:
 * 1. An image if `provider.icon` is a data URL.
 * 2. A preset SVG mark if `provider.icon` or auto-detection matches a known key.
 * 3. An accessible fallback monogram badge.
 */
export function renderSearchEngineIcon(
  provider: SearchProvider,
  size: number = 18,
): HTMLElement | SVGElement {
  const iconKey = provider.icon || matchPresetEngine(provider.name, provider.query_url);

  // 1. Data URL (uploaded custom image)
  if (provider.icon && provider.icon.startsWith('data:')) {
    const img = el('img', {
      className: 'engine-icon engine-icon--img',
      attrs: {
        src: provider.icon,
        alt: '',
        width: String(size),
        height: String(size),
        loading: 'lazy',
      },
    });
    img.addEventListener(
      'error',
      () => {
        img.replaceWith(renderLetterBadge(provider.name, size));
      },
      { once: true },
    );
    return img;
  }

  // 2. Preset SVG
  if (iconKey && PRESET_PATHS[iconKey]) {
    return createSvgIcon(PRESET_PATHS[iconKey], size);
  }

  // 3. Fallback lettermark badge
  return renderLetterBadge(provider.name, size);
}

function renderLetterBadge(name: string, size: number): HTMLElement {
  const badge = el('span', {
    className: 'engine-icon engine-icon--monogram',
    text: initialOf(name, '?'),
  });
  badge.style.setProperty('--engine-icon-size', `${size}px`);
  badge.style.setProperty('--engine-icon-font-size', `${Math.max(10, Math.round(size * 0.65))}px`);
  return badge;
}
