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
scripts/
└── generate-icons.mjs # Dependency-free PNG icon generator (from the logo SVG)
public/
├── manifest.json   # PWA manifest (shortcuts, share target, maskable icons)
├── sw.js           # Service worker (offline, push, notification, messaging)
├── icon.svg        # Scalable app logo (sourced from the hub_backup branch)
├── icon-192.png    # PWA icon (192×192)
├── icon-512.png    # PWA icon (512×512)
├── icon-maskable-512.png # Maskable PWA icon (512×512)
└── apple-touch-icon.png  # iOS home-screen icon (180×180)
src/
├── core/           # Headless business logic (no DOM imports)
│   ├── db.ts       # Native IndexedDB wrapper (v2: profiles + partition indices)
│   ├── store.ts    # Reactive state store, active-profile filtering & migration
│   ├── sync.ts     # GitHub REST client, v2 merge logic & debounced SyncEngine
│   ├── fallback.ts # URL health checks & mirror resolution
│   ├── pwa.ts      # Launch intents, share parsing, app badging
│   ├── notifications.ts # Local reminders + Web Push subscription
│   ├── gamepad.ts  # Gamepad -> navigation action mapping
│   ├── lock.ts     # WebAuthn app lock (screen lock / biometrics)
│   ├── telemetry.ts# IP/location (ipwho.is) + weather (Open-Meteo), TTL cache
│   └── image.ts    # Canvas scale/compress for avatars & logos
├── components/     # Vanilla TS UI components
│   ├── header.ts   # Edge-to-edge system header (telemetry + profile controls)
│   ├── telemetry-badge.ts # IP / location / weather badge with offline fallback
│   ├── brand.ts    # Centered logo or custom Hub title
│   ├── profile-popover.ts # Profile switcher / add / settings menu
│   ├── profile-editor.ts  # Profile name, avatar, logo, engine, theme
│   ├── omnibar.ts  # Search pill, engine selector, fuzzy matcher, `/` hotkey
│   ├── bookmarks.ts# Categorized grid, recents, empty state
│   ├── tasks.ts    # Tasks drawer (create, toggle, delete, sort, reminders)
│   ├── notes.ts    # Scratchpad drawer (cards, color badges, clipboard)
│   ├── drawer.ts   # Shared drawer shell (header, pin, close)
│   ├── settings.ts # Settings modal, features, connection test, import/export
│   ├── share-target.ts # Shared-text -> bookmark/note prompt
│   ├── lock-screen.ts  # WebAuthn lock overlay
│   └── toast.ts    # Bottom notification dispatcher
├── styles/
│   ├── tokens.css  # Warm light/dark design tokens
│   ├── layout.css  # Grid, drawers, responsive breakpoints
│   └── components.css # Omnibar, cards, drawers, modal, lock, share styles
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

## Multi-Profile & Start Page

- **Profiles:** every bookmark, category, task, and note is partitioned by
  `profile_id`. Each profile carries its own name, avatar, custom Hub title or
  logo, default search engine, and optional theme override.
- **Migration:** on first run after upgrading, a default profile is created and
  all legacy (unassigned) records are migrated into it — no data loss. v1 sync
  payloads are migrated to v2 on read.
- **System header:** an edge-to-edge header shows environment telemetry
  (IP / location / weather via ipwho.is + Open-Meteo, cached for 30 minutes with
  an offline fallback) on the left and the active-profile control on the right.
- **Search pill:** a centered, pill-shaped search bar with an inline engine
  selector. Press `/` anywhere to focus it and select existing text (ignored
  while typing in a field or when a modal is open).
- **Sync:** the BYOS payload is now `version: 2` and includes `profiles`; the
  Last-Write-Wins merge remains non-destructive.

---

## PWA & Deployment

- **Offline:** `public/sw.js` precaches the app shell and runtime-caches hashed
  bundles (cache-first). GitHub API requests are network-first and never cached.
  SPA navigations (including `/share-target` and `?action=` shortcuts) always
  resolve to the cached `index.html` shell.
- **Installable:** `public/manifest.json` declares `display: standalone`, an
  app `id`, categories, `display_override`, local 192/512/maskable icons, and
  the warm brand theme.
- **App shortcuts:** long-press the installed icon for **New Bookmark**,
  **New Task**, and **New Note** (`?action=...`).
- **Share target:** share text/links from any app to Hub (`share_target`, GET);
  Hub proposes a bookmark (when a URL is present) or a note.
- **App badging:** the installed icon shows the count of open tasks via the
  Badging API.
- **Notifications:** local task reminders fire via the Notification API; Web
  Push subscriptions use a configurable VAPID public key (see Settings), and the
  service worker handles `push` / `notificationclick`.
- **Gamepad navigation:** D-pad / left stick move focus, A activates, B backs
  out, Y/Start focus the omnibar, and LB/RB toggle the drawers.
- **App lock:** an optional WebAuthn gate using the device screen lock /
  biometrics (Settings → App features).
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
- [x] `npm run test` passes (114 tests across 15 suites).
- [x] `npm run build` produces a production bundle under the 60 KB gzip budget.
- [x] Omnibar auto-focuses; `Enter` navigates the current tab.
- [x] Drawers slide with a 200ms transition; pinning persists to `AppConfig`.
- [x] Mobile bottom tab bar switches views without reload.
- [x] Merge fixtures handle additions, edits, and tombstones without data loss.
- [x] PWA manifest, service worker, and local icons ship in `dist/`.
