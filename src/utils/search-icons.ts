/**
 * Hub Search Engine Icons & Presets
 * ---------------------------------
 * Local vector SVG marks for search providers (PRD §2, AGENTS.md §1).
 * Zero external requests / no third-party CDNs.
 */

import { el } from './dom';
import { initialOf } from './text';
import type { SearchProvider } from '../types/schemas';

export interface SearchPreset {
  id: string;
  name: string;
  query_url: string;
  icon?: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgIcon(pathData: string, size: number, stroke = false): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('width', String(size));
  node.setAttribute('height', String(size));
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('class', 'engine-icon engine-icon--svg');
  if (stroke) {
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '2');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
  } else {
    node.setAttribute('fill', 'currentColor');
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathData);
  node.appendChild(path);
  return node;
}

/**
 * Clean 24x24 vector paths for popular search providers.
 */
const PRESET_PATHS: Record<string, string> = {
  duckduckgo:
    'M12 2A10 10 0 1 0 22 12 10 10 0 0 0 12 2zm1 14.5c-2.5 0-4.5-1.5-5-3.5h10c-.5 2-2.5 3.5-5 3.5zm-3-6a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5zm6 0a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5z',
  google:
    'M12 5c1.8 0 3.2.7 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.5 8.9 5 12 5zm9.9 7c0-.8-.1-1.6-.2-2.3H12v4.5h5.6c-.3 1.3-1 2.4-2.1 3.2l3.3 2.6c2-1.9 3.1-4.7 3.1-8zM5.3 13.7c-.2-.7-.3-1.4-.3-2.2s.1-1.5.3-2.2L1.6 6.4C.6 8.3 0 10.4 0 12.5s.6 4.2 1.6 6.1l3.7-2.9v-2zM12 23c3.2 0 6-1.1 8-3l-3.3-2.6c-1.1.7-2.6 1.2-4.7 1.2-3.1 0-5.8-2.5-6.7-5.3L1.6 16.2C3.5 20.1 7.4 23 12 23z',
  bing: 'M5 3v18l5.5-3.1 5.3 3.1 3.2-1.8V9.5L12 6.2 8.6 4.9 5 3zm3.7 4.5l3.3 1.3v7.4l-3.3-1.8V7.5zm5.1 3.3l1.8 1v5.1l-1.8-1v-5.1z',
  brave:
    'M12 2L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3zm0 4c2.2 0 4 1.8 4 4 0 1.5-.8 2.8-2 3.5V17h-4v-3.5C8.8 12.8 8 11.5 8 10c0-2.2 1.8-4 4-4z',
  ecosia:
    'M12 2a9 9 0 0 0-9 9c0 4.18 2.86 7.69 6.75 8.67L9 22h6l-.75-2.33C18.14 18.69 21 15.18 21 11a9 9 0 0 0-9-9zm-1 5a4 4 0 0 1 4 4h-2a2 2 0 0 0-2-2V7z',
  kagi: 'M6 4h4v6.5L14.5 4H19l-5.8 7.5L19 20h-4.8L10 13.2V20H6V4z',
  startpage:
    'M12 2A10 10 0 1 0 22 12 10 10 0 0 0 12 2zm1 15h-2v-2h2v2zm1-7.8l-.9 1C12.5 11 12 11.5 12 13h-2v-.5c0-1.1.5-2.1 1.2-2.8l1.2-1.3c.4-.4.6-.9.6-1.4a2 2 0 1 0-4 0H7a5 5 0 1 1 10 0c0 1-.4 2-1 2.8z',
  perplexity: 'M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07L19.07 4.93',
  github:
    'M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z',
  youtube:
    'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.5 15.6V8.4l6.3 3.6-6.3 3.6z',
  wikipedia:
    'M12.09 13.12L9.64 4h-2.1L3.02 18h2.09l1.24-3.79h4.31l1.19 3.79h2.15l-1.91-4.88zm-4.32-1.39l1.64-5.35 1.62 5.35H7.77zM20.98 18l-4.52-14h-2.09l4.52 14h2.09z',
  reddit:
    'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm5.5 11.5a1.5 1.5 0 0 1-2.4 1.2c-.7.5-1.8.8-3.1.8s-2.4-.3-3.1-.8a1.5 1.5 0 1 1-1.9-2.1c.3-.3.8-.4 1.2-.4.1-.7.7-1.3 1.5-1.5l1-3.2 2.7.6a1 1 0 1 1 2 .4l-3.3-.7-.9 2.8c.8.2 1.4.8 1.6 1.5.4 0 .9.1 1.3.4a1.5 1.5 0 0 1 1 0zm-7.5-.5a1 1 0 1 0 1 1 1 1 0 0 0-1-1zm4 0a1 1 0 1 0 1 1 1 1 0 0 0-1-1zm-4 3.5c.6.4 1.3.6 2 .6s1.4-.2 2-.6a.5.5 0 0 0-.5-.8c-.4.3-1 .4-1.5.4s-1.1-.1-1.5-.4a.5.5 0 0 0-.5.8z',
  amazon:
    'M13.8 12.3c0-1.7-.8-2.6-2.5-2.6-1.2 0-2.3.6-2.7 1.3l-.2-.9H6.8v7.3h1.8v-1.1c.5.8 1.5 1.3 2.6 1.3 1.8 0 2.6-.9 2.6-2.5v-2.8zm-1.8 1.5c0 1-.5 1.5-1.4 1.5-.8 0-1.3-.6-1.3-1.6 0-1.1.5-1.6 1.3-1.6.9 0 1.4.5 1.4 1.7zm6.7 4.7C16.3 20 12.8 21 8.8 21c-3.5 0-6.6-.9-7.8-1.5-.3-.2-.1-.6.2-.5 2.5 1 5.4 1.4 7.6 1.4 3.6 0 6.9-.9 9.3-2.1.4-.2.7.2.4.4zm1.1-1.1c-.2-.4-.8-.6-1.5-.3-.6.3-1.4 1-1.6 1.3-.2.3 0 .5.3.4.4-.1 1.6-.7 2.1-1 .4-.2.7-.4.7-.4z',
};

/**
 * Built-in presets available in the Search Engine Manager.
 */
export const SEARCH_PRESETS: readonly SearchPreset[] = [
  { id: 'google', name: 'Google', query_url: 'https://www.google.com/search?q=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', query_url: 'https://duckduckgo.com/?q=%s' },
  { id: 'brave', name: 'Brave', query_url: 'https://search.brave.com/search?q=%s' },
  { id: 'bing', name: 'Bing', query_url: 'https://www.bing.com/search?q=%s' },
  { id: 'ecosia', name: 'Ecosia', query_url: 'https://www.ecosia.org/search?q=%s' },
  { id: 'kagi', name: 'Kagi', query_url: 'https://kagi.com/search?q=%s' },
  { id: 'startpage', name: 'Startpage', query_url: 'https://www.startpage.com/sp/search?query=%s' },
  { id: 'perplexity', name: 'Perplexity', query_url: 'https://www.perplexity.ai/search?q=%s' },
  { id: 'youtube', name: 'YouTube', query_url: 'https://www.youtube.com/results?search_query=%s' },
  { id: 'github', name: 'GitHub', query_url: 'https://github.com/search?q=%s' },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    query_url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s',
  },
  { id: 'reddit', name: 'Reddit', query_url: 'https://www.reddit.com/search/?q=%s' },
  { id: 'amazon', name: 'Amazon', query_url: 'https://www.amazon.com/s?k=%s' },
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
