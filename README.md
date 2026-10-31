# Hub

A zero-telemetry, local-first browser launchpad and Progressive Web App (PWA).
Hub unifies quick-launch links, transient daily tasks, and a plain-text
scratchpad into one keyboard-driven home base — fully operational offline, with
optional Bring-Your-Own-Storage (BYOS) sync via the GitHub REST API.

> **Status:** Phase 1 (Foundation & Data Layer) complete.

---

## Tech Stack

- **Build:** Vite + TypeScript (strict mode)
- **Runtime:** Vanilla DOM + native CSS custom properties — **zero UI frameworks**
- **Storage:** Native IndexedDB (`hub_local_db`)
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
src/
├── core/          # Headless business logic (no DOM imports)
│   ├── db.ts      # Native IndexedDB wrapper (CRUD, transactions, indices)
│   ├── store.ts   # (Phase 2) Reactive in-memory state store & event bus
│   ├── sync.ts    # (Phase 4) GitHub REST client & timestamp merger
│   └── fallback.ts# (Phase 2) URL health checks & mirror resolution
├── components/    # (Phase 2+) Vanilla TS UI components
├── styles/
│   └── tokens.css # Warm light/dark design tokens
├── types/
│   └── schemas.ts # Canonical data contracts (single source of truth)
├── utils/
│   ├── dom.ts     # XSS-safe DOM builders (no innerHTML)
│   └── crypto.ts  # UUID v4 generation
└── main.ts        # Application entrypoint
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

## Quality Gates

Every commit is gated locally and in CI:

1. **Pre-commit (husky):** `lint-staged` (ESLint + Prettier) → `typecheck` → `test`.
2. **CI (`.github/workflows/ci.yml`):** install → typecheck → lint → test → build.

Enforced negative constraints (AGENTS.md):

- No `any` types.
- No `innerHTML` / `outerHTML` (XSS).
- No UI framework imports (React, Vue, Svelte, Preact).

---

## Phase 1 Exit Criteria

- [x] `npm run typecheck` passes with zero errors.
- [x] `npm run lint` passes with zero errors.
- [x] `npm run test` passes (IndexedDB init + CRUD, schema contracts).
- [x] `npm run build` produces a production bundle.
- [x] All six IndexedDB object stores and their indices are created.
- [x] Config and metrics store helpers implemented.

See [`plans/phase-1-foundation.md`](plans/phase-1-foundation.md) for the full
build approach and delivery pipeline.
