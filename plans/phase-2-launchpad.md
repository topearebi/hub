# Phase 2 — Core Launchpad & Omnibar: Build Approach & Delivery Plan

**Project:** Hub
**Phase:** 2 of 5 — Core Launchpad & Omnibar
**Parent Specs:** [`PRD.md`](../PRD.md), [`SCHEMAS.md`](../SCHEMAS.md), [`AGENTS.md`](../AGENTS.md)
**Status:** Complete

---

## 1. Objective

Deliver an instant, keyboard-driven new-tab landing experience on top of the
Phase 1 data engine. Phase 2 adds the reactive state layer and the first UI
components:

1. A central reactive in-memory store + pub/sub event bus (`core/store.ts`).
2. The omnibar with fuzzy matching, hotkeys, and the search-provider router.
3. The categorized bookmark grid with a local-only "Recently Used" row.
4. The alternate-URL fallback engine and the bottom toast dispatcher.
5. The layout + component stylesheets.

**Exit Criteria (from AGENTS.md):** Typing in the omnibar filters bookmarks in
`< 10ms`; pressing `Enter` navigates the current tab; empty states display a
single-sentence hint.

---

## 2. Guiding Principles

| Principle                  | How Phase 2 Enforces It                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| **Headless core, thin UI** | `store.ts` and `fallback.ts` have zero DOM dependencies and are unit-testable.           |
| **Pure logic is exported** | Fuzzy matching, URL detection, and query resolution are pure functions, tested directly. |
| **Same-window navigation** | All activations set `window.location.href`; no `window.open` / new tabs.                 |
| **Local-only metrics**     | "Recently Used" reads `DeviceMetrics`; it never enters the sync payload.                 |
| **XSS-safe DOM**           | Every node is built via `el()` / `textContent`; no `innerHTML`.                          |
| **Graceful degradation**   | Favicon fetches fall back to a local letter avatar on error (air-gap friendly).          |

---

## 3. Task Breakdown

### 3.1 Reactive State Store (`src/core/store.ts`)

- Singleton `HubStore` holding all collections in memory.
- `init()` hydrates every store from IndexedDB in parallel.
- `subscribe(event, listener)` / internal `emit(event)` pub/sub bus.
- Read getters: `activeBookmarks`, `sortedCategories`, `activeTasks`,
  `activeNotes`, `appConfig`, `getRecentBookmarks()`, `getBookmarkByHotkey()`.
- Mutations: `upsert*` / `softDelete*` per collection, `recordVisit()`,
  `updateConfig()` — each updates memory, persists to IDB, then emits.

### 3.2 Fallback Engine (`src/core/fallback.ts`)

- `probeUrl(url, timeoutMs)` — `fetch(..., { mode: 'no-cors' })` with an
  `AbortController` timeout; resolves `true`/`false`.
- `resolveBookmarkUrl(bookmark)` — short-circuits when there are no
  `alternate_urls`; otherwise probes primary then mirrors sequentially.
- Returns `{ url, usedAlternate, hostname }` for the toast dispatcher.

### 3.3 Toast Dispatcher (`src/components/toast.ts`)

- `showToast(message, { variant, durationMs })` appends a non-blocking node to a
  singleton container, animates in, auto-dismisses, and returns a disposer.

### 3.4 Omnibar (`src/components/omnibar.ts`)

- Pure exports: `isUrlLike`, `normalizeUrl`, `fuzzyScore`, `filterBookmarks`,
  `resolveQuery`.
- Class: auto-focus, `Escape` clear+blur, `ArrowUp`/`ArrowDown` navigation,
  `Enter` execution, and document-level `Alt + [1-9]` hotkeys.
- Execution pipeline: bookmark match → direct URL → default search provider.

### 3.5 Bookmarks View (`src/components/bookmarks.ts`)

- "Recently Used" row (local metrics), category-grouped grids, uncategorized
  bucket, and a single-sentence empty state.
- Tiles activate on click; right-click opens a context menu of mirrors.

### 3.6 Styles

- `layout.css`: app shell, centered launchpad, desktop 3-column grid classes
  (ready for Phase 3 drawers), mobile breakpoints.
- `components.css`: omnibar, result list, tiles, sections, toast, context menu.

### 3.7 Bootstrap (`src/main.ts`)

- Hydrate the store, build the shell, mount the omnibar + bookmarks view, and
  wire activation through the fallback engine + toast.

---

## 4. Tests

- `src/components/__tests__/omnibar.test.ts`: URL regex vs. search detection,
  fuzzy filtering, and query resolution precedence.
- `src/core/__tests__/fallback.test.ts`: mirror resolution with a mocked `fetch`.

---

## 5. Definition of Done (Phase 2)

- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm run test` passes (db, schemas, omnibar, fallback suites).
- [ ] `npm run build` produces a production bundle with no errors.
- [ ] No `any` types, no `innerHTML`, no framework imports.
- [ ] Omnibar auto-focuses on boot; `Enter` navigates the current tab.
- [ ] Empty states render a single-sentence hint.
