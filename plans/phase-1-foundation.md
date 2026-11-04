# Phase 1 — Foundation: Build Approach & Delivery Plan

**Project:** Hub
**Phase:** 1 of 5 — Foundation & Data Layer
**Parent Specs:** [`PRD.md`](../PRD.md), [`SCHEMAS.md`](../SCHEMAS.md), [`AGENTS.md`](../AGENTS.md)
**Status:** Complete

---

## 1. Objective

Establish a compiling, tested, and continuously deliverable foundation for Hub before any UI feature work begins. Phase 1 delivers four things:

1. A strict Vite + TypeScript build pipeline.
2. The warm design-token layer (`tokens.css`).
3. The canonical type contracts (`schemas.ts`) — the single source of truth.
4. The native IndexedDB data engine (`db.ts`) with all object stores and indices.

**Exit Criteria (from AGENTS.md):** `npm run typecheck` passes with zero errors, and an automated unit test verifies successful IndexedDB initialization and basic CRUD.

---

## 2. Guiding Principles for Continuous Development & Delivery

These principles shape every decision in this phase so that later phases (2–5) can be built, verified, and shipped incrementally without rework.

| Principle                           | How Phase 1 Enforces It                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Fail fast, fail locally**         | Pre-commit hook runs lint + typecheck + tests before any commit lands.                                   |
| **Every commit is shippable**       | CI runs typecheck, lint, test, and production build on every push/PR.                                    |
| **Contracts before code**           | `schemas.ts` is written first and treated as immutable without explicit authorization.                   |
| **Headless core, thin UI**          | All business logic lives in `src/core/` with zero DOM dependencies, so it is unit-testable in isolation. |
| **Versioned data, safe migrations** | IndexedDB uses an explicit version + upgrade hook so future schema changes never destroy user data.      |
| **Zero runtime dependencies**       | Only devDependencies are added; the shipped bundle stays framework-free and under the 60 KB budget.      |
| **Deterministic verification**      | `fake-indexeddb` makes DB tests run in CI without a real browser.                                        |

---

## 3. Delivery Pipeline (Continuous Integration)

```
Developer commit
      │
      ▼
┌──────────────────────────┐
│ husky pre-commit hook    │
│  • lint-staged           │
│    - eslint --fix        │
│    - prettier --write    │
│  • npm run typecheck     │
│  • npm run test          │
└────────────┬─────────────┘
             │ (blocks commit on failure)
             ▼
        git push / PR
             │
             ▼
┌──────────────────────────┐
│ GitHub Actions CI        │
│  • npm ci                │
│  • typecheck             │
│  • lint                  │
│  • test (vitest run)     │
│  • build (vite build)    │
└────────────┬─────────────┘
             │
             ▼
   (Phase 5 adds deploy.yml → GitHub Pages)
```

The `deploy.yml` workflow is intentionally deferred to Phase 5, but the CI workflow created here is the gate that keeps `main` always deployable.

---

## 4. Task Breakdown

### 4.1 Project Scaffolding

- `package.json` with scripts: `dev`, `build`, `preview`, `typecheck`, `test`, `test:watch`, `lint`, `format`, `prepare`.
- `.gitignore` (node_modules, dist, coverage, .DS_Store, *.local).
- `.editorconfig` and `.nvmrc` (pin Node LTS) for cross-machine consistency.

### 4.2 TypeScript Configuration

- `tsconfig.json` with `strict: true` plus hardening flags:
  - `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, `verbatimModuleSyntax`.
- `tsconfig.node.json` for the Vite config file (Node context).
- Rationale: `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` directly protect the optional fields in `schemas.ts` (`alternate_urls?`, `hotkey?`, `is_deleted?`).

### 4.3 Vite Configuration

- `vite.config.ts` with `base` configurable for GitHub Pages subpath deployment.
- `build.target: 'es2022'`, sourcemaps enabled, and a bundle-size awareness note.
- Vitest config co-located: `environment: 'jsdom'`, `setupFiles` importing `fake-indexeddb/auto`.

### 4.4 Entry Point

- `index.html` with a single `#app` root, no external CDN references.
- `src/main.ts` minimal bootstrap: imports `tokens.css`, mounts a placeholder, and is structured so Phase 2 can attach the omnibar without restructuring.

### 4.5 Dev Tooling & Quality Gates

- **Testing:** `vitest`, `jsdom`, `fake-indexeddb`.
- **Linting:** `eslint` (flat config) + `typescript-eslint` + `eslint-config-prettier`.
- **Formatting:** `prettier`.
- **Git hooks:** `husky` + `lint-staged`.
- Custom ESLint rules to enforce AGENTS.md negative constraints:
  - Ban `any` (`@typescript-eslint/no-explicit-any`).
  - Ban `innerHTML` / `outerHTML` assignment (`no-restricted-syntax`).
  - Ban imports of `react`, `vue`, `svelte`, `preact`, `tailwind` (`no-restricted-imports`).

### 4.6 Design Tokens (`src/styles/tokens.css`)

- Warm light palette as `:root` defaults (exact values from PRD §6.1).
- `@media (prefers-color-scheme: dark)` warm charcoal overrides.
- Explicit `[data-theme="light"]` / `[data-theme="dark"]` overrides for manual theme control.
- Additional tokens: spacing scale, z-index scale, shadow tokens, focus-ring token.

### 4.7 Type Contracts (`src/types/schemas.ts`)

- Transcribe every interface from SCHEMAS.md verbatim: `HubStoragePayload`, `SyncableEntity`, `BookmarkItem`, `CategoryItem`, `TaskItem`, `NoteItem`, `SearchProvider`, `AppConfig`, `DeviceMetrics`.
- Export `DEFAULT_APP_CONFIG` exactly as specified.
- Add a `SYNCABLE_COLLECTIONS` constant listing the four syncable collection keys — used by the merge routine in Phase 4 and by tests to assert `DeviceMetrics` is never serialized.

### 4.8 Utilities

- `src/utils/crypto.ts`: `newId()` wrapping `crypto.randomUUID()` with a fallback.
- `src/utils/dom.ts`: `el()` builder using `createElement` + `textContent` only (no `innerHTML`), plus typed event-listener helpers.

### 4.9 Data Engine (`src/core/db.ts`)

- Single database `hub_local_db`, version `1`.
- Object stores and indices exactly per SCHEMAS.md §4.1:
  - `bookmarks` (keyPath `id`; indices `idx_category_id`, `idx_updated_at`, `idx_is_deleted`)
  - `categories` (keyPath `id`; index `idx_order`)
  - `tasks` (keyPath `id`; indices `idx_completed`, `idx_updated_at`)
  - `notes` (keyPath `id`; index `idx_updated_at`)
  - `metrics` (keyPath `bookmark_id`; indices `idx_click_count`, `idx_visited`)
  - `config` (keyPath `key`; singletons `app_config`, `sync_metadata`)
- Design for scalability:
  - Generic typed `getAll<T>`, `get<T>`, `put<T>`, `delete`, `bulkPut<T>` helpers keyed by store name.
  - A `withTransaction` helper that guarantees transactions are committed/aborted and errors surfaced (AGENTS.md DoD).
  - An `onupgradeneeded` migration switch keyed by `oldVersion` so future versions add stores/indices without data loss.
  - Config helpers: `getAppConfig()` (returns `DEFAULT_APP_CONFIG` when absent), `setAppConfig()`, `getSyncMetadata()`, `setSyncMetadata()`.
  - Metrics helpers: `recordVisit(bookmarkId)`, `getMetrics()`.
- All operations return Promises; no callbacks leak to callers.

### 4.10 Tests

- `src/core/__tests__/db.test.ts`:
  - DB opens and reports version 1.
  - All six object stores exist with the correct keyPaths.
  - All declared indices exist.
  - CRUD round-trip for each store (put → get → getAll → delete).
  - `getAppConfig()` returns defaults when empty; persists after `setAppConfig()`.
  - `recordVisit()` increments `click_count` and updates `last_visited_at`.
- `src/types/__tests__/schemas.test.ts`:
  - `DEFAULT_APP_CONFIG` matches the spec shape.
  - A serialized `HubStoragePayload` contains only the four syncable collections and never `DeviceMetrics`.

### 4.11 Documentation

- `README.md`: setup, scripts, directory map, architecture boundaries, Phase 1 exit criteria.
- This plan file retained under `plans/`.

---

## 5. Scalability & Extensibility Notes

- **Repository pattern:** `db.ts` exposes generic store helpers so Phase 2–4 components never touch raw IDB APIs. Adding a store later is a one-line migration entry.
- **Migration-first schema:** The `onupgradeneeded` switch means v2+ changes are additive and non-destructive.
- **Headless core:** `db.ts` has no DOM imports, so it is reusable in a future Web Worker or Node test context.
- **Contract isolation:** `schemas.ts` is the only place types are defined; components import from it, preventing drift.
- **Bundle discipline:** Zero runtime deps now; the CI build step will surface any accidental bloat early.

---

## 6. Risks & Mitigations

| Risk                                                              | Mitigation                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `fake-indexeddb` diverges from real browser behavior              | Keep DB logic to standard IDB APIs; add a manual browser smoke check in Phase 2. |
| `exactOptionalPropertyTypes` friction with optional entity fields | Model optionals explicitly; document the pattern in `schemas.ts` comments.       |
| Husky hooks slow down commits                                     | Scope `lint-staged` to changed files only; keep test suite fast and focused.     |
| GitHub Pages subpath breaks asset URLs                            | Set `base` in `vite.config.ts` from the start; verify with `npm run preview`.    |

---

## 7. Definition of Done (Phase 1)

- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm run test` passes (db + schemas suites).
- [ ] `npm run build` produces a production bundle with no errors.
- [ ] Pre-commit hook blocks commits that fail lint/typecheck/test.
- [ ] CI workflow runs the full gate on push/PR.
- [ ] No `any` types, no `innerHTML`, no framework imports.
- [ ] All IndexedDB transactions are closed and error-handled.
