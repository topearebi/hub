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

import { clearChildren, el, on, svg } from '../utils/dom';
import { hostnameOf } from '../core/fallback';
import type { BookmarkItem, SearchProvider } from '../types/schemas';
import type { LaunchpadStore } from '../core/store';

/* Inline icon paths (AGENTS.md: no external icon CDNs). */
const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_ARROW = 'M7 17 17 7M17 7H8M17 7v9';
const ICON_SEARCH = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35';

/* ------------------------------------------------------------------ */
/* Pure query logic (unit-tested)                                      */
/* ------------------------------------------------------------------ */

const URL_SCHEME_RE = /^https?:\/\//i;
/**
 * Schemes that must never be treated as navigable URLs. `javascript:` and
 * `data:` are XSS/exec vectors; the rest have no meaningful same-window target.
 */
const BLOCKED_SCHEME_RE = /^(?:javascript|data|vbscript|file|blob|about):/i;
/**
 * PRD §5.1 Step 2: dotted host with a 2+ letter TLD. Labels are
 * letters/digits/hyphens and the TLD must be letters, which keeps `3.14` and
 * email addresses out while allowing non-ASCII (IDN) labels such as
 * `münchen.de` or `例え.jp` (G-58).
 */
const DOMAIN_RE = /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[\p{L}]{2,}(\S*)?$/u;
/** IPv4 literal, optionally with a port and/or path. */
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:\/\S*)?$/;
/** Bracketed IPv6 literal, optionally with a port and/or path. */
const IPV6_RE = /^\[[0-9a-fA-F:]+\](?::\d{1,5})?(?:\/\S*)?$/;
/** `localhost`, optionally with a port and/or path. */
const LOCALHOST_RE = /^localhost(?::\d{1,5})?(?:\/\S*)?$/i;
/** A single-label intranet host with an explicit port, e.g. `intranet:8080`. */
const HOST_PORT_RE = /^[a-zA-Z0-9-]+:\d{1,5}(?:\/\S*)?$/;
/**
 * True when the query should be treated as a navigable URL, not a search.
 *
 * Beyond explicit `http(s)` schemes and dotted TLDs, this accepts the hosts a
 * self-hoster types in practice: `localhost:3000`, IPv4/IPv6 literals with
 * optional ports, single-label intranet names with a port, and IDN domains.
 * Dangerous schemes (`javascript:`, `data:`, …) are always rejected (G-58).
 */
export function isUrlLike(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (BLOCKED_SCHEME_RE.test(trimmed)) {
    return false;
  }
  return (
    URL_SCHEME_RE.test(trimmed) ||
    LOCALHOST_RE.test(trimmed) ||
    IPV4_RE.test(trimmed) ||
    IPV6_RE.test(trimmed) ||
    HOST_PORT_RE.test(trimmed) ||
    DOMAIN_RE.test(trimmed)
  );
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

/**
 * A single selectable row in the omnibar result list.
 *
 * `add` rows are offered above the `navigate` row for URL-like queries so a
 * user can capture a URL as a bookmark without leaving the launchpad.
 */
export type OmnibarAction =
  | { kind: 'bookmark'; bookmark: BookmarkItem }
  | { kind: 'add'; url: string }
  | { kind: 'navigate'; url: string }
  | { kind: 'search'; url: string };

/**
 * Build the ordered action list for a query. Bookmark fuzzy matches take
 * precedence (PRD §5.1 Step 1). Otherwise a URL-like query yields an
 * `add` row followed by a `navigate` row; anything else becomes a `search`.
 */
export function buildOmnibarActions(
  query: string,
  bookmarks: readonly BookmarkItem[],
  providers: readonly SearchProvider[],
  preferredProviderId?: string,
): OmnibarAction[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const matches = filterBookmarks(trimmed, bookmarks);
  if (matches.length > 0) {
    return matches.map((bookmark): OmnibarAction => ({ kind: 'bookmark', bookmark }));
  }

  if (isUrlLike(trimmed)) {
    const url = normalizeUrl(trimmed);
    return [
      { kind: 'add', url },
      { kind: 'navigate', url },
    ];
  }

  const resolution = resolveQuery(trimmed, bookmarks, providers, preferredProviderId);
  // A bookmark resolution is impossible here (matches was empty above), but the
  // union still needs narrowing before reading `.url`.
  const url = resolution.type === 'bookmark' ? trimmed : resolution.url;
  return [{ kind: 'search', url }];
}

/**
 * Index of the row selected by default. Skips a leading `add` row so `Enter`
 * keeps navigating by default; the add row stays reachable via `ArrowUp`/click.
 */
export function defaultActiveIndex(actions: readonly OmnibarAction[]): number {
  return actions.findIndex((action) => action.kind !== 'add');
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface OmnibarCallbacks {
  onActivateBookmark: (bookmark: BookmarkItem) => void;
  onNavigate: (url: string) => void;
  /** Open the bookmark editor prefilled with a captured URL. */
  onAddBookmark: (url: string) => void;
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
  private actions: OmnibarAction[] = [];
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
        // Ignore the hotkey while the user is editing a field (task/note
        // inputs, settings, etc.) so Alt+digit never navigates away mid-edit.
        // The omnibar's own input is exempt: it is the launchpad's primary
        // surface and is auto-focused on boot.
        const target = event.target as HTMLElement | null;
        const isEditable =
          target !== null &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable);
        if (isEditable && target !== this.input) {
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
    this.actions = buildOmnibarActions(
      this.input.value,
      this.store.activeBookmarks,
      this.store.appConfig.search_providers,
      this.selectedProviderId,
    );
    this.activeIndex = defaultActiveIndex(this.actions);
    this.renderResults();
  }

  private handleKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        this.reset();
        this.input.blur();
        break;
      case 'ArrowDown':
        if (this.actions.length > 0) {
          event.preventDefault();
          this.setActive((this.activeIndex + 1) % this.actions.length);
        }
        break;
      case 'ArrowUp':
        if (this.actions.length > 0) {
          event.preventDefault();
          this.setActive((this.activeIndex - 1 + this.actions.length) % this.actions.length);
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
    const selected = this.activeIndex >= 0 ? this.actions[this.activeIndex] : undefined;
    if (!selected) {
      return;
    }
    this.runAction(selected);
    this.reset();
  }

  /** Dispatch a resolved omnibar action to the host callbacks. */
  private runAction(action: OmnibarAction): void {
    switch (action.kind) {
      case 'bookmark':
        this.callbacks.onActivateBookmark(action.bookmark);
        break;
      case 'add':
        this.callbacks.onAddBookmark(action.url);
        break;
      case 'navigate':
      case 'search':
        this.callbacks.onNavigate(action.url);
        break;
    }
  }

  private reset(): void {
    this.input.value = '';
    this.actions = [];
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

    const open = this.actions.length > 0;
    this.resultsEl.classList.toggle('is-open', open);
    this.input.setAttribute('aria-expanded', open ? 'true' : 'false');

    this.actions.forEach((action, index) => {
      const item = el('li', {
        className: `omnibar__result omnibar__result--${action.kind}`,
        attrs: { role: 'option', 'aria-selected': 'false' },
      });

      if (action.kind === 'bookmark') {
        item.appendChild(
          el('span', { className: 'omnibar__result-title', text: action.bookmark.title }),
        );
        item.appendChild(
          el('span', { className: 'omnibar__result-url', text: hostnameOf(action.bookmark.url) }),
        );
        if (action.bookmark.hotkey) {
          item.appendChild(
            el('kbd', {
              className: 'omnibar__result-hotkey',
              text: `Alt+${action.bookmark.hotkey}`,
            }),
          );
        }
      } else if (action.kind === 'add') {
        item.appendChild(svg(ICON_PLUS, { className: 'omnibar__result-icon' }));
        item.appendChild(
          el('span', { className: 'omnibar__result-title', text: 'Add to bookmarks' }),
        );
        item.appendChild(
          el('span', { className: 'omnibar__result-url', text: hostnameOf(action.url) }),
        );
      } else if (action.kind === 'navigate') {
        item.appendChild(svg(ICON_ARROW, { className: 'omnibar__result-icon' }));
        item.appendChild(el('span', { className: 'omnibar__result-title', text: 'Go to' }));
        item.appendChild(el('span', { className: 'omnibar__result-url', text: action.url }));
      } else {
        item.appendChild(svg(ICON_SEARCH, { className: 'omnibar__result-icon' }));
        item.appendChild(el('span', { className: 'omnibar__result-title', text: 'Search' }));
        item.appendChild(
          el('span', { className: 'omnibar__result-url', text: this.input.value.trim() }),
        );
      }

      item.addEventListener('mouseenter', () => this.setActive(index));
      item.addEventListener('click', () => {
        this.runAction(action);
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
