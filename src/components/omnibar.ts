/**
 * Hub Omnibar
 * -----------
 * The instant-focus central search bar (PRD §5.1). It routes a query through a
 * strict priority pipeline:
 *
 *   1. Local bookmark fuzzy match  -> activate the selected bookmark
 *   2. Direct URL detection        -> navigate to the URL
 *   3. Default search provider     -> redirect to the search engine
 *
 * The matching/URL logic is exported as pure functions so it can be unit-tested
 * without a DOM. The class only wires DOM events to that logic.
 */

import { clearChildren, el, on } from '../utils/dom';
import { hostnameOf } from '../core/fallback';
import type { BookmarkItem, SearchProvider } from '../types/schemas';
import type { LaunchpadStore } from '../core/store';

/* ------------------------------------------------------------------ */
/* Pure query logic (unit-tested)                                      */
/* ------------------------------------------------------------------ */

const URL_SCHEME_RE = /^https?:\/\//i;
/** PRD §5.1 Step 2: common TLD detection for scheme-less input. */
const DOMAIN_RE = /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\S*)?$/;

/** True when the query should be treated as a navigable URL, not a search. */
export function isUrlLike(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (URL_SCHEME_RE.test(trimmed)) {
    return true;
  }
  return DOMAIN_RE.test(trimmed);
}

/** Ensure a scheme-less URL is navigable by defaulting to HTTPS. */
export function normalizeUrl(query: string): string {
  const trimmed = query.trim();
  return URL_SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Subsequence fuzzy score. Returns `null` when the query is not a subsequence
 * of the text; otherwise a higher score means a better (earlier, more
 * contiguous) match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) {
    return 0;
  }

  let qi = 0;
  let score = 0;
  let lastMatch = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t.charAt(ti) === q.charAt(qi)) {
      // Contiguity bonus only applies when a *previous* character matched at
      // the immediately preceding index. Guarding on `lastMatch !== -1` avoids
      // awarding the bonus to the very first matched character (where
      // `lastMatch` is still the -1 sentinel and `ti - 1 === -1`).
      const isContiguous = lastMatch !== -1 && lastMatch === ti - 1;
      score += isContiguous ? 3 : 1;
      if (ti === 0) {
        score += 2; // start-of-string bonus
      }
      lastMatch = ti;
      qi += 1;
    }
  }

  return qi === q.length ? score : null;
}

/** Filter and rank bookmarks by fuzzy match against title and URL. */
export function filterBookmarks(query: string, bookmarks: readonly BookmarkItem[]): BookmarkItem[] {
  const q = query.trim();
  if (q.length === 0) {
    return [];
  }

  const scored: Array<{ bookmark: BookmarkItem; score: number }> = [];
  for (const bookmark of bookmarks) {
    if (bookmark.is_deleted === true) {
      continue;
    }
    const titleScore = fuzzyScore(q, bookmark.title);
    const urlScore = fuzzyScore(q, bookmark.url);
    const best = Math.max(titleScore ?? -1, urlScore ?? -1);
    if (best >= 0) {
      scored.push({ bookmark, score: best });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.bookmark.title.localeCompare(b.bookmark.title));
  return scored.map((entry) => entry.bookmark);
}

export type QueryResolution =
  | { type: 'bookmark'; bookmark: BookmarkItem }
  | { type: 'url'; url: string }
  | { type: 'search'; url: string };

/**
 * Resolve a query through the priority pipeline (PRD §5.1 Step 1-3). The
 * optional `preferredProviderId` (the active profile's default engine) takes
 * precedence over the global default provider.
 */
export function resolveQuery(
  query: string,
  bookmarks: readonly BookmarkItem[],
  providers: readonly SearchProvider[],
  preferredProviderId?: string,
): QueryResolution {
  const trimmed = query.trim();

  const first = filterBookmarks(trimmed, bookmarks)[0];
  if (first) {
    return { type: 'bookmark', bookmark: first };
  }

  if (isUrlLike(trimmed)) {
    return { type: 'url', url: normalizeUrl(trimmed) };
  }

  const provider =
    providers.find((p) => p.id === preferredProviderId) ??
    providers.find((p) => p.is_default) ??
    providers[0];
  if (!provider) {
    return { type: 'search', url: trimmed };
  }
  return { type: 'search', url: provider.query_url.replace('%s', encodeURIComponent(trimmed)) };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface OmnibarCallbacks {
  onActivateBookmark: (bookmark: BookmarkItem) => void;
  onNavigate: (url: string) => void;
  /** Persist a newly selected search engine for the active profile. */
  onSelectEngine?: (providerId: string) => void;
}

export class Omnibar {
  readonly element: HTMLElement;

  private readonly input: HTMLInputElement;
  private readonly engineSelect: HTMLSelectElement;
  private readonly resultsEl: HTMLElement;
  private readonly disposers: Array<() => void> = [];
  private resultNodes: HTMLElement[] = [];
  private matches: BookmarkItem[] = [];
  private activeIndex = -1;
  private selectedProviderId = '';

  constructor(
    private readonly store: LaunchpadStore,
    private readonly callbacks: OmnibarCallbacks,
  ) {
    this.input = el('input', {
      className: 'omnibar__input',
      attrs: {
        type: 'text',
        placeholder: 'Search bookmarks or enter a URL…',
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        role: 'combobox',
        'aria-label': 'Search bookmarks or enter a URL',
        'aria-expanded': 'false',
        'aria-controls': 'omnibar-results',
      },
    });

    // Inline search-engine selector on the left of the pill.
    this.engineSelect = el('select', {
      className: 'omnibar__engine',
      attrs: { 'aria-label': 'Search engine' },
    });
    this.engineSelect.addEventListener('change', () => {
      this.selectedProviderId = this.engineSelect.value;
      this.callbacks.onSelectEngine?.(this.selectedProviderId);
    });

    const hint = el('kbd', { className: 'omnibar__hint', text: 'Enter' });
    const bar = el('div', {
      className: 'omnibar',
      children: [this.engineSelect, this.input, hint],
    });

    this.resultsEl = el('ul', {
      className: 'omnibar__results',
      attrs: { id: 'omnibar-results', role: 'listbox' },
    });

    this.element = el('div', { className: 'omnibar-wrap', children: [bar, this.resultsEl] });

    this.renderEngine();
    this.bind();
  }

  /** Focus the input (called on boot for instant typing). */
  focus(): void {
    this.input.focus();
  }

  /** Focus the input and select any existing text (the `/` hotkey). */
  focusAndSelect(): void {
    this.input.focus();
    this.input.select();
  }

  /** Rebuild the engine selector (call after a profile switch). */
  renderEngine(): void {
    const providers = this.store.appConfig.search_providers;
    this.engineSelect.replaceChildren();
    for (const provider of providers) {
      this.engineSelect.appendChild(
        el('option', { text: provider.name, attrs: { value: provider.id } }),
      );
    }

    const preferred = this.store.activeProfile?.default_search_provider_id;
    const fallback = providers.find((p) => p.is_default)?.id ?? providers[0]?.id ?? '';
    this.selectedProviderId =
      preferred && providers.some((p) => p.id === preferred) ? preferred : fallback;
    this.engineSelect.value = this.selectedProviderId;
  }

  /** Bind document-level `Alt + [1-9]` and `/` hotkeys. */
  attachGlobalHotkeys(): void {
    this.disposers.push(
      on(document, 'keydown', (event: KeyboardEvent) => {
        if (!event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        if (!/^[1-9]$/.test(event.key)) {
          return;
        }
        const bookmark = this.store.activeBookmarks.find((b) => b.hotkey === event.key);
        if (!bookmark) {
          return;
        }
        event.preventDefault();
        this.callbacks.onActivateBookmark(bookmark);
      }),
    );

    // `/` focuses the search pill from any neutral page state. It is ignored
    // while typing in a field or when a modal is open.
    this.disposers.push(
      on(document, 'keydown', (event: KeyboardEvent) => {
        if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          return;
        }
        if (document.querySelector('.modal-overlay.is-open')) {
          return;
        }
        event.preventDefault();
        this.focusAndSelect();
      }),
    );
  }

  destroy(): void {
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
    this.element.remove();
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                        */
  /* ---------------------------------------------------------------- */

  private bind(): void {
    this.disposers.push(on(this.input, 'input', () => this.handleInput()));
    this.disposers.push(
      on(this.input, 'keydown', (event: KeyboardEvent) => this.handleKeydown(event)),
    );
    this.disposers.push(on(this.input, 'focus', () => this.renderResults()));
    // Prevent the input from blurring before a result click registers.
    this.disposers.push(
      on(this.resultsEl, 'mousedown', (event: MouseEvent) => event.preventDefault()),
    );
  }

  private handleInput(): void {
    this.matches = filterBookmarks(this.input.value, this.store.activeBookmarks);
    this.activeIndex = this.matches.length > 0 ? 0 : -1;
    this.renderResults();
  }

  private handleKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        this.reset();
        this.input.blur();
        break;
      case 'ArrowDown':
        if (this.matches.length > 0) {
          event.preventDefault();
          this.setActive((this.activeIndex + 1) % this.matches.length);
        }
        break;
      case 'ArrowUp':
        if (this.matches.length > 0) {
          event.preventDefault();
          this.setActive((this.activeIndex - 1 + this.matches.length) % this.matches.length);
        }
        break;
      case 'Enter':
        event.preventDefault();
        this.execute();
        break;
      default:
        break;
    }
  }

  private execute(): void {
    const selected = this.activeIndex >= 0 ? this.matches[this.activeIndex] : undefined;
    if (selected) {
      this.callbacks.onActivateBookmark(selected);
      this.reset();
      return;
    }

    const query = this.input.value.trim();
    if (query.length === 0) {
      return;
    }

    const resolution = resolveQuery(
      query,
      this.store.activeBookmarks,
      this.store.appConfig.search_providers,
      this.selectedProviderId,
    );
    if (resolution.type === 'bookmark') {
      this.callbacks.onActivateBookmark(resolution.bookmark);
    } else {
      this.callbacks.onNavigate(resolution.url);
    }
    this.reset();
  }

  private reset(): void {
    this.input.value = '';
    this.matches = [];
    this.activeIndex = -1;
    this.renderResults();
  }

  private setActive(index: number): void {
    this.activeIndex = index;
    this.resultNodes.forEach((node, i) => {
      const active = i === index;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  private renderResults(): void {
    clearChildren(this.resultsEl);
    this.resultNodes = [];

    const open = this.matches.length > 0;
    this.resultsEl.classList.toggle('is-open', open);
    this.input.setAttribute('aria-expanded', open ? 'true' : 'false');

    this.matches.forEach((bookmark, index) => {
      const item = el('li', {
        className: 'omnibar__result',
        attrs: { role: 'option', 'aria-selected': 'false' },
      });
      item.appendChild(el('span', { className: 'omnibar__result-title', text: bookmark.title }));
      item.appendChild(
        el('span', { className: 'omnibar__result-url', text: hostnameOf(bookmark.url) }),
      );
      if (bookmark.hotkey) {
        item.appendChild(
          el('kbd', { className: 'omnibar__result-hotkey', text: `Alt+${bookmark.hotkey}` }),
        );
      }

      item.addEventListener('mouseenter', () => this.setActive(index));
      item.addEventListener('click', () => {
        this.callbacks.onActivateBookmark(bookmark);
        this.reset();
      });

      this.resultsEl.appendChild(item);
      this.resultNodes.push(item);
    });

    if (this.activeIndex >= 0) {
      this.setActive(this.activeIndex);
    }
  }
}
