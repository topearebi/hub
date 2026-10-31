# `agents.md` — AI Agent Development & Operational Guidelines

**Document Version:** 1.0.0

**Project:** Hub

**Target Runtime:** Autonomous AI Agents (Claude Code, Cursor, Hermes, Copilot Workspace)

**Parent Specs:** `prd.md`, `schemas.md`

---

## 1. Persona & Operational Mandates

You are an expert Systems Architect and Senior Frontend Systems Engineer. You are tasked with implementing **Hub** in strict accordance with `prd.md` and `schemas.md`.

### The Prime Directives

1. **Zero Framework Bloat:** Use **Vanilla TypeScript**, **Vite**, and **Vanilla CSS**. Never suggest, install, or scaffold React, Preact, Vue, Svelte, Tailwind CSS, or component libraries.
2. **Adhere Strictly to `schemas.md`:** The data interfaces and IndexedDB layouts defined in `schemas.md` are the single source of truth. Do not invent new fields or alter entity definitions without explicit user authorization.
3. **Local-First & Air-Gapped by Default:** Hub must be fully operational without an internet connection or GitHub sync token. Never block UI state or initialization on external network calls.
4. **No External CDNs:** All icons (SVGs), fonts, and styles must be local to the repository. No Google Fonts, FontAwesome, or CDN scripts.
5. **No Regressions / Strict Verification:** Every task must compile without TypeScript warnings (`npm run typecheck`) and pass automated tests (`npm run test`) before being marked complete.

---

## 2. Forbidden Patterns (Negative Constraints)

Any pull request or code change containing the following patterns will be rejected immediately:

- ❌ Adding runtime dependencies to `package.json` without explicit approval.
- ❌ Using `innerHTML` with unsanitized user content (use `textContent`, `createElement`, or DOM templates to ensure zero XSS).
- ❌ Storing or leaking `DeviceMetrics` (`click_count`, `last_visited_at`) into the remote `HubStoragePayload`.
- ❌ Spawning new browser tabs/windows on standard bookmark clicks (mandate: all primary navigations execute in the same window via `window.location.href`).
- ❌ Polling the GitHub API continuously (sync must be strictly event-driven: on window focus, visibility change, or debounced mutation).

---

## 3. Project Directory Map & File Responsibilities

When modifying or implementing features, strictly respect directory boundaries:

```
src/
├── core/                  # Headless business logic, data, and network layers
│   ├── db.ts              # Native IndexedDB wrapper (CRUD, transactions, indices)
│   ├── store.ts           # Central reactive in-memory state store & pub/sub event bus
│   ├── sync.ts            # GitHub REST API client & fine-grained timestamp merger
│   └── fallback.ts        # Primary URL connectivity checks and mirror resolution
├── components/            # UI components (Vanilla TS classes managing DOM nodes)
│   ├── omnibar.ts         # Search bar, fuzzy matcher, hotkeys, search provider router
│   ├── bookmarks.ts       # Categorized bookmark cards, recents grid, empty state
│   ├── tasks.ts           # Left drawer, task creation, toggle state, deletion
│   ├── notes.ts           # Right drawer, scratchpad cards, clipboard copy
│   ├── settings.ts        # Settings modal, token verification, export/import
│   └── toast.ts           # Non-blocking bottom notification dispatch system
├── styles/                # CSS architecture
│   ├── tokens.css         # CSS variables (warm palette, dark mode, spacing)
│   ├── layout.css         # Desktop 3-column grid, responsive breakpoints, mobile tabs
│   └── components.css     # Modular styles for omnibar, cards, drawers, and modal
├── types/
│   └── schemas.ts         # Strict import of types defined in schemas.md
├── utils/
│   ├── dom.ts             # Element creation helpers, event listeners, sanitization
│   └── crypto.ts          # Native crypto.randomUUID() wrapper
└── main.ts                # Application entrypoint & Service Worker registration

```

---

## 4. Phased Implementation Roadmap

Agents must implement the project in sequential phases. **Do not move to the next phase until all acceptance criteria of the current phase are verified.**

```
┌────────────────────────────────────────────────────────┐
│ Phase 1: Foundation (Vite, TS, Tokens, IndexedDB)      │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Phase 2: Core Launchpad (Omnibar, Hotkeys, Bookmarks)  │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Phase 3: Productivity Panes (Tasks, Notes Drawers)     │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Phase 4: Sync & Settings (GitHub API, Merging, Import) │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Phase 5: PWA, Responsive Polish & Final Audit          │
└────────────────────────────────────────────────────────┘

```

### Phase 1: Foundation & Data Layer

- **Goal:** Establish repo structure, compilation pipeline, CSS design tokens, and local database.
- **Tasks:**

1. Configure `vite.config.ts`, `tsconfig.json` (strict: true), and standard `package.json`.
2. Implement `src/styles/tokens.css` with warm low-strain light/dark palettes and `prefers-color-scheme` support.
3. Implement `src/types/schemas.ts` exactly as specified in `schemas.md`.
4. Build `src/core/db.ts` implementing all IndexedDB object stores: `bookmarks`, `categories`, `tasks`, `notes`, `metrics`, `config`.

- **Exit Criteria:** `npm run typecheck` passes; unit test verifies successful IndexedDB initialization and basic CRUD.

### Phase 2: Core Launchpad & Omnibar

- **Goal:** Deliver an instant, keyboard-driven new-tab landing experience.
- **Tasks:**

1. Build `src/components/omnibar.ts` with auto-focus on boot, `Escape` blur, and `ArrowUp`/`ArrowDown` navigation.
2. Implement search logic hierarchy:

- Bookmark fuzzy match → Valid URL direct navigation → Default search provider redirect.

3. Implement `Alt + [1-9]` hotkey bindings for pinned bookmarks.
4. Build `src/components/bookmarks.ts` supporting category grouping and a local-only "Recently Used" row.
5. Build `src/core/fallback.ts` and `src/components/toast.ts` to route to `alternate_urls` if primary URL is dead.

- **Exit Criteria:** Typing in the omnibar filters bookmarks in `< 10ms`. Pressing `Enter` navigates current tab. Empty states display single-sentence hints.

### Phase 3: Productivity Panes (Tasks & Scratchpad)

- **Goal:** Implement the dual side-drawer workspace.
- **Tasks:**

1. Build `src/components/tasks.ts`: Checkbox toggles, task creation, and completed sorting.
2. Build `src/components/notes.ts`: Unformatted plain-text cards, pastebin scratchpad, color badges, and one-click copy to clipboard via `navigator.clipboard`.
3. Implement drawer pinning logic on desktop:

- 0 drawers pinned: Minimal centered layout.
- 1 drawer pinned: Two-column layout.
- 2 drawers pinned: Full three-column productivity dashboard.

4. Implement mobile viewport (`< 768px`) bottom tab bar (`Bookmarks` | `Tasks` | `Notes`).

- **Exit Criteria:** Drawers slide smoothly (`transition: 200ms`); pinning state persists to `AppConfig`; mobile tab switching works seamlessly.

### Phase 4: BYOS Sync Engine & Settings

- **Goal:** Enable cross-device sync via GitHub REST API and manual JSON backup.
- **Tasks:**

1. Build `src/components/settings.ts`: Accessible via gear icon; inputs for GitHub PAT, Owner, Repo, Branch, and File Path.
2. Build `src/core/sync.ts`:

- Test connection function verifying write permissions.
- Warning modal before initial `.hub/data.json` creation.
- Debounced (3–5 second) commit batching.
- Deterministic timestamp merger adhering to the algorithm in `schemas.md`.

3. Implement manual JSON export and import file handling in `settings.ts`.

- **Exit Criteria:** Merging local and remote test fixtures correctly handles additions, edits, and soft tombstones (`is_deleted: true`) without data loss.

### Phase 5: PWA Caching & Deployment

- **Goal:** Make Hub installable, offline-capable, and deployable to GitHub Pages.
- **Tasks:**

1. Implement `public/manifest.json` (standalone display, theme colors).
2. Implement `public/sw.js` (Cache-first strategy for static app assets, Network-first for GitHub API).
3. Register Service Worker in `src/main.ts`.
4. Create `.github/workflows/deploy.yml` for automatic GitHub Pages deployment on push to `main`.

- **Exit Criteria:** Lighthouse PWA audit passes; app loads and functions fully in airplane mode.

---

## 5. Developer Verification & Test Commands

Run these terminal checks sequentially during development:

```bash
# 1. Typecheck: Must exit with 0 errors
npm run typecheck

# 2. Automated Tests: Unit tests for db, merger, and omnibar logic
npm run test

# 3. Production Build: Verifies Vite bundling and asset compression
npm run build

# 4. Preview Build Locally
npm run preview

```

### Required Test Coverage (Vitest)

- `src/core/__tests__/db.test.ts`: Test database upgrade, indices, and entity read/writes.
- `src/core/__tests__/sync.test.ts`: Test merge conflict resolution with mock local and remote payloads (timestamps, deletions, additions).
- `src/components/__tests__/omnibar.test.ts`: Test URL regex detection vs. search query detection.

---

## 6. Agent "Definition of Done" Checklist

Before declaring any ticket or stage complete, the agent must verify:

- [ ] Code is formatted cleanly with semantic comments explaining architectural decisions.
- [ ] No `any` types used in TypeScript files (must adhere strictly to `schemas.ts`).
- [ ] No inline CSS styles or script injections.
- [ ] IndexedDB transactions are properly closed and error-handled.
- [ ] All inputs are trimmed and escaped to prevent layout breakage.
- [ ] `npm run typecheck` and `npm run test` pass with zero failures.
