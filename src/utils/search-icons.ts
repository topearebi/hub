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
    'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 15c-3 0-5-2-5-4h10c0 2-2 4-5 4zm-2.5-6a1.5 1.5 0 1 1 1.5-1.5A1.5 1.5 0 0 1 9.5 11zm5 0a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5z',
  google:
    'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8h-8v-3h11a10 10 0 0 1-11 11z',
  bing: 'M5 3v18l5.5-3.1 5.3 3.1 3.2-1.8V9.5L12 6.2 8.6 4.9 5 3zm3.7 4.5l3.3 1.3v7.4l-3.3-1.8V7.5zm5.1 3.3l1.8 1v5.1l-1.8-1v-5.1z',
  brave:
    'M12 2L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3zm0 4c2.2 0 4 1.8 4 4 0 1.5-.8 2.8-2 3.5V17h-4v-3.5C8.8 12.8 8 11.5 8 10c0-2.2 1.8-4 4-4z',
  ecosia:
    'M12 2a9 9 0 0 0-9 9c0 4.18 2.86 7.69 6.75 8.67L9 22h6l-.75-2.33C18.14 18.69 21 15.18 21 11a9 9 0 0 0-9-9zm-1 5a4 4 0 0 1 4 4h-2a2 2 0 0 0-2-2V7z',
  kagi: 'M6 4h4v6.5L14.5 4H19l-5.8 7.5L19 20h-4.8L10 13.2V20H6V4z',
  startpage:
    'M12 2A10 10 0 1 0 22 12 10 10 0 0 0 12 2zm1 15h-2v-2h2v2zm1-7.8l-.9 1C12.5 11 12 11.5 12 13h-2v-.5c0-1.1.5-2.1 1.2-2.8l1.2-1.3c.4-.4.6-.9.6-1.4a2 2 0 1 0-4 0H7a5 5 0 1 1 10 0c0 1-.4 2-1 2.8z',
  perplexity: 'M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07L19.07 4.93',
  youtube:
    'M22 6a3 3 0 0 0-2-2C18 3.5 12 3.5 12 3.5s-6 0-8 .5A3 3 0 0 0 2 6C1.5 8 1.5 12 1.5 12s0 4 .5 6a3 3 0 0 0 2 2c2 .5 8 .5 8 .5s6 0 8-.5a3 3 0 0 0 2-2c.5-2 .5-6 .5-6s0-4-.5-6zM10 15.5V8.5l6 3.5z',
};

/**
 * Built-in presets available in the Search Engine Manager.
 */
export const SEARCH_PRESETS: readonly SearchPreset[] = (
  [
    ['google', 'Google', 'https://www.google.com/search?q=%s'],
    ['duckduckgo', 'DuckDuckGo', 'https://duckduckgo.com/?q=%s'],
    ['brave', 'Brave', 'https://search.brave.com/search?q=%s'],
    ['bing', 'Bing', 'https://www.bing.com/search?q=%s'],
    ['ecosia', 'Ecosia', 'https://www.ecosia.org/search?q=%s'],
    ['kagi', 'Kagi', 'https://kagi.com/search?q=%s'],
    ['startpage', 'Startpage', 'https://www.startpage.com/sp/search?query=%s'],
    ['perplexity', 'Perplexity', 'https://www.perplexity.ai/search?q=%s'],
    ['youtube', 'YouTube', 'https://www.youtube.com/results?search_query=%s'],
    ['github', 'GitHub', 'https://github.com/search?q=%s'],
    ['wikipedia', 'Wikipedia', 'https://en.wikipedia.org/wiki/Special:Search?search=%s'],
    ['reddit', 'Reddit', 'https://www.reddit.com/search/?q=%s'],
    ['amazon', 'Amazon', 'https://www.amazon.com/s?k=%s'],
  ] as const
).map(([id, name, query_url]) => ({ id, name, query_url }));

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
    return createSvgIcon(PRESET_PATHS[iconKey], size, iconKey === 'perplexity');
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
