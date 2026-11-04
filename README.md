# Hub

A zero-telemetry, local-first browser launchpad and Progressive Web App (PWA).
Hub unifies quick-launch links, transient daily tasks, and a plain-text
scratchpad into one fast home base — built **mobile-first** for quick access to
key information on the go, fully operational offline, with optional
Bring-Your-Own-Storage (BYOS) sync via the GitHub REST API.

> **Status:** The five original build phases are complete — installable,
> offline-capable, and deployable to GitHub Pages. Hub is now in a
> **production-readiness programme** (touch parity, accessibility, safety UX,
> PWA hardening). See [Production Readiness](#production-readiness) below.

---

## Documentation

| Document                                                         | Purpose                                                                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`PRD.md`](PRD.md)                                               | Product requirements (v1.1.0): scope, functional requirements, verification matrix, release criteria |
| [`DESIGN.md`](DESIGN.md)                                         | UI/UX design system (v2.0): tokens, responsive tiers, touch rules, components, content               |
| [`docs/spec-checklist.md`](docs/spec-checklist.md)               | Pre-implementation spec checklist and feature spec template (prevents silent or wrong requirements)  |
| [`docs/accessibility.md`](docs/accessibility.md)                 | WCAG 2.2 AA conformance spec, keyboard map, ARIA patterns, test procedure                            |
| [`SCHEMAS.md`](SCHEMAS.md)                                       | Data contracts: entities, IndexedDB layout, sync payload, `AppConfig`                                |
| [`AGENTS.md`](AGENTS.md)                                         | Rules for AI agents and contributors: constraints, directory map, Definition of Done                 |
| [`plans/production-readiness.md`](plans/production-readiness.md) | Gap analysis (current → ideal) and the phased roadmap to production                                  |
| [`plans/`](plans/)                                               | Historical phase plans                                                                               |

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
│   ├── telemetry.ts# (scheduled for removal — roadmap Phase 9) IP/location/weather lookups
│   └── image.ts    # Canvas scale/compress for avatars & logos
├── components/     # Vanilla TS UI components
│   ├── header.ts   # Edge-to-edge system header (profile controls, drawer toggles)
│   ├── telemetry-badge.ts # (scheduled for removal — roadmap Phase 9)
│   ├── brand.ts    # Centered logo or custom Hub title
│   ├── profile-popover.ts # Profile switcher / add / settings menu
│   ├── profile-editor.ts  # Profile name, avatar, logo, engine, theme
│   ├── omnibar.ts  # Search pill, engine selector, fuzzy matcher, `/` hotkey
│   ├── bookmarks.ts# Categorized grid, recents, empty state
│   ├── tasks.ts    # Tasks drawer (inline creator, subtasks, completed accordion)
│   ├── notes.ts    # Scratchpad drawer (quick capture, sections, pastel cards)
│   ├── note-editor.ts # Note edit modal (title, body, color)
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
│   ├── text.ts     # URL linkification for task text
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
- **System header:** an edge-to-edge header holds the active-profile control and
  drawer toggles. The environment-telemetry cluster (IP / location / weather via
  ipwho.is + Open-Meteo) is **being removed** (roadmap Phase 9) because it
  contradicts the zero-telemetry promise; the target header is specified in
  [`DESIGN.md`](DESIGN.md) §6.1.
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

## Production Readiness

A source-level audit found Hub's architecture sound but its experience
desktop-first. The owner-approved target is a **mobile-first** product with
full touch parity, WCAG 2.2 AA accessibility, undo-based safety UX, first-run
onboarding, and a hardened PWA (precached shell, user-controlled updates,
persistent storage, install UX, CSP). The audit, the gap list (`G-01…G-60`), and
the 11-phase roadmap live in
[`plans/production-readiness.md`](plans/production-readiness.md). Release
criteria are in [`PRD.md`](PRD.md) Appendix A.

Highlights of what the roadmap changes:

- Touch: visible "⋯" menus, ≥ 44 px targets, no hover-only controls, Pointer-Events drag with Move/Indent alternatives.
- Accessibility: shared dialog/menu primitives, full combobox pattern, AA contrast, forced-colors support.
- Safety: Undo toasts, import preview, unsaved-changes guard, error boundary, profile delete with 30-day recovery.
- PWA: build-time precache, "update available" flow, `storage.persist()`, install prompts, complete manifest and iOS metadata.
- Privacy: telemetry removed; network limited to same-origin and `api.github.com`.

### Use Hub as your homepage or new tab

See `docs/homepage.md` (added in roadmap Phase 8) for installing Hub as an app
and setting it as the browser homepage / startup page. A browser-extension
`newtab` override is planned for v2.

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
- No external CDNs or third-party requests (icons, fonts, and styles are all local).
- No hover-only controls; ≥ 44 px touch targets; AA contrast (see `AGENTS.md` §2).

Planned additions to the gate (roadmap Phases 2 and 11): token contrast script,
axe-core accessibility checks, Lighthouse CI (PWA pass, Accessibility ≥ 95), and
a `< 60 KB` gzip bundle-size budget.

---

## Phases

| Phase | Scope                              | Plan                                                                         |
| ----- | ---------------------------------- | ---------------------------------------------------------------------------- |
| 1     | Foundation & Data Layer            | [`plans/phase-1-foundation.md`](plans/phase-1-foundation.md)                 |
| 2     | Core Launchpad & Omnibar           | [`plans/phase-2-launchpad.md`](plans/phase-2-launchpad.md)                   |
| 3     | Productivity Panes (Tasks & Notes) | [`plans/phase-3-productivity-panes.md`](plans/phase-3-productivity-panes.md) |
| 4     | BYOS Sync Engine & Settings        | [`plans/phase-4-sync-settings.md`](plans/phase-4-sync-settings.md)           |
| 5     | PWA Caching & Deployment           | [`plans/phase-5-pwa-deploy.md`](plans/phase-5-pwa-deploy.md)                 |
| 6+    | Production readiness (11 phases)   | [`plans/production-readiness.md`](plans/production-readiness.md)             |

---

## Final Audit (original five phases)

- [x] `npm run typecheck` passes with zero errors.
- [x] `npm run lint` passes with zero errors.
- [x] `npm run test` passes (126 tests across 16 suites).
- [x] `npm run build` produces a production bundle under the 60 KB gzip budget.
- [x] Omnibar auto-focuses; `Enter` navigates the current tab.
- [x] Drawers slide with a 200ms transition; pinning persists to `AppConfig`.
- [x] Mobile bottom tab bar switches views without reload.
- [x] Merge fixtures handle additions, edits, and tombstones without data loss.
- [x] PWA manifest, service worker, and local icons ship in `dist/`.
