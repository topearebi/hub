# Hub

A zero-telemetry, local-first browser launchpad and Progressive Web App (PWA).
Hub unifies quick-launch links, transient daily tasks, and a plain-text
scratchpad into one keyboard-driven home base — fully operational offline, with
optional Bring-Your-Own-Storage (BYOS) sync via the GitHub REST API.

> **Status:** All five phases complete — installable, offline-capable, and
> deployable to GitHub Pages.

---

## Tech Stack

- **Build:** Vite + TypeScript (strict mode)
- **Runtime:** Vanilla DOM + native CSS custom properties — **zero UI frameworks**
- **Storage:** Native IndexedDB (`hub_local_db`)
- **Sync:** GitHub REST API (BYOS) with deterministic Last-Write-Wins merging
- **Tests:** Vitest + `fake-indexeddb` + jsdom
- **Quality:** ESLint (flat config) + Prettier + husky + lint-staged

---

## Getting Started

```bash
# Requires Node >= 20 (see .nvmrc)
npm install

# Start the dev server
npm run dev
```

## Scripts

| Script               | Purpose                                 |
| -------------------- | --------------------------------------- |
| `npm run dev`        | Start the Vite dev server               |
| `npm run build`      | Typecheck + production build to `dist/` |
| `npm run preview`    | Preview the production build locally    |
| `npm run typecheck`  | Strict type-check (app + node configs)  |
| `npm run test`       | Run the Vitest suite once               |
| `npm run test:watch` | Run Vitest in watch mode                |
| `npm run lint`       | Lint the repository with ESLint         |
| `npm run format`     | Format with Prettier                    |

---

## Directory Map

```
public/
├── manifest.json   # PWA web app manifest (standalone, warm theme)
├── sw.js           # Service worker (cache-first assets, network-first API)
├── icon.svg        # Scalable app icon
├── icon-192.png    # PWA icon (192×192)
└── icon-512.png    # PWA icon (512×512, also maskable)
src/
├── core/           # Headless business logic (no DOM imports)
│   ├── db.ts       # Native IndexedDB wrapper (CRUD, transactions, indices)
│   ├── store.ts    # Reactive in-memory state store & event bus
│   ├── sync.ts     # GitHub REST client, merge logic & debounced SyncEngine
│   └── fallback.ts # URL health checks & mirror resolution
├── components/     # Vanilla TS UI components
│   ├── omnibar.ts  # Search bar, fuzzy matcher, hotkeys, provider router
│   ├── bookmarks.ts# Categorized grid, recents, empty state
│   ├── tasks.ts    # Tasks drawer (create, toggle, delete, sort)
│   ├── notes.ts    # Scratchpad drawer (cards, color badges, clipboard)
│   ├── drawer.ts   # Shared drawer shell (header, pin, close)
│   ├── settings.ts # Settings modal, connection test, import/export
│   └── toast.ts    # Bottom notification dispatcher
├── styles/
│   ├── tokens.css  # Warm light/dark design tokens
│   ├── layout.css  # Grid, drawers, responsive breakpoints
│   └── components.css # Omnibar, cards, drawers, modal styles
├── types/
│   └── schemas.ts  # Canonical data contracts (single source of truth)
├── utils/
│   ├── dom.ts      # XSS-safe DOM builders (no innerHTML)
│   └── crypto.ts   # UUID v4 generation
└── main.ts         # Application entrypoint & service worker registration
```

---

## Architecture Boundaries

- **`src/core/` is headless.** No DOM imports, so it is unit-testable and
  worker-safe. UI components consume it; it never consumes them.
- **`src/types/schemas.ts` is the contract.** All entity shapes are defined
  there and transcribed from `SCHEMAS.md`. Do not add or rename fields without
  explicit authorization.
- **Three data tiers:** remote sync payload (syncable entities only), local
  IndexedDB (entities + `DeviceMetrics` + `AppConfig`), and in-memory state.
  `DeviceMetrics` must **never** appear in the remote payload.

---

## PWA & Deployment

- **Offline:** `public/sw.js` precaches the app shell and runtime-caches hashed
  bundles (cache-first). GitHub API requests are network-first and never cached.
- **Installable:** `public/manifest.json` declares `display: standalone` with
  local 192/512 icons and warm theme colors.
- **Deploy:** pushing to `main` triggers
  [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which runs the
  full quality gate and publishes `dist/` to GitHub Pages. `base: './'` keeps
  asset URLs valid under a project subpath.

---

## Quality Gates

Every commit is gated locally and in CI:

1. **Pre-commit (husky):** `lint-staged` (ESLint + Prettier) → `typecheck` → `test`.
2. **CI (`.github/workflows/ci.yml`):** install → typecheck → lint → test → build.
3. **Deploy (`.github/workflows/deploy.yml`):** the same gate, then publish to Pages.

Enforced negative constraints (AGENTS.md):

- No `any` types.
- No `innerHTML` / `outerHTML` (XSS).
- No UI framework imports (React, Vue, Svelte, Preact).
- No external CDNs (icons, fonts, and styles are all local).

---

## Phases

| Phase | Scope                              | Plan                                                                         |
| ----- | ---------------------------------- | ---------------------------------------------------------------------------- |
| 1     | Foundation & Data Layer            | [`plans/phase-1-foundation.md`](plans/phase-1-foundation.md)                 |
| 2     | Core Launchpad & Omnibar           | [`plans/phase-2-launchpad.md`](plans/phase-2-launchpad.md)                   |
| 3     | Productivity Panes (Tasks & Notes) | [`plans/phase-3-productivity-panes.md`](plans/phase-3-productivity-panes.md) |
| 4     | BYOS Sync Engine & Settings        | [`plans/phase-4-sync-settings.md`](plans/phase-4-sync-settings.md)           |
| 5     | PWA Caching & Deployment           | [`plans/phase-5-pwa-deploy.md`](plans/phase-5-pwa-deploy.md)                 |

---

## Final Audit

- [x] `npm run typecheck` passes with zero errors.
- [x] `npm run lint` passes with zero errors.
- [x] `npm run test` passes (65 tests across 7 suites).
- [x] `npm run build` produces a production bundle under the 60 KB gzip budget.
- [x] Omnibar auto-focuses; `Enter` navigates the current tab.
- [x] Drawers slide with a 200ms transition; pinning persists to `AppConfig`.
- [x] Mobile bottom tab bar switches views without reload.
- [x] Merge fixtures handle additions, edits, and tombstones without data loss.
- [x] PWA manifest, service worker, and local icons ship in `dist/`.
