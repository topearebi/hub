# `agents.md` — AI Agent Development & Operational Guidelines

**Document Version:** 1.2.0

**Project:** Hub

**Target Runtime:** Autonomous AI Agents (Claude Code, Cursor, Hermes, Copilot Workspace)

**Parent Specs:** `PRD.md` (v1.1.0), `DESIGN.md` (v2.0), `SCHEMAS.md` (v1.4.0), `docs/accessibility.md`

**Active roadmap:** `plans/production-readiness.md`

---

## 1. Persona & Operational Mandates

You are an expert Systems Architect and Senior Frontend Systems Engineer. You are tasked with implementing **Hub** in strict accordance with `PRD.md`, `DESIGN.md`, `docs/accessibility.md` and `SCHEMAS.md`. Hub is a **mobile-first** product for quick access to key information on the go: design for the phone, then scale up.

### The Prime Directives

1. **Zero Framework Bloat:** Use **Vanilla TypeScript**, **Vite**, and **Vanilla CSS**. Never suggest, install, or scaffold React, Preact, Vue, Svelte, Tailwind CSS, or component libraries.
2. **Adhere Strictly to `SCHEMAS.md`:** The data interfaces and IndexedDB layouts defined in `SCHEMAS.md` are the single source of truth. Do not invent new fields or alter entity definitions without explicit user authorization. The only approved additions are the three local-only `AppConfig` fields in `SCHEMAS.md` §3.3, the encrypted-token envelope and `token_key` config record in §3.5, and `AppConfig.single_key_shortcuts_enabled` in §3.6.
3. **Local-First & Air-Gapped by Default:** Hub must be fully operational without an internet connection or GitHub sync token. Never block UI state or initialization on external network calls.
4. **No External CDNs or Third-Party Requests:** All icons (SVGs), fonts, and styles must be local to the repository. No Google Fonts, FontAwesome, or CDN scripts. At runtime Hub may contact only its own origin and, when the user has enabled sync, `api.github.com`. There is no telemetry (the former IP/location/weather lookups were removed).
5. **No Regressions / Strict Verification:** Every task must compile without TypeScript warnings (`npm run typecheck`) and pass automated tests (`npm run test`) before being marked complete.
6. **Every Input Method, Every Device:** A feature is not complete until it works by touch (≥ 44 px targets, no hover-only controls), keyboard, and screen reader, at phone, tablet and desktop sizes, in light, dark and high-contrast modes (`DESIGN.md`, `docs/accessibility.md`).
7. **Design Tokens Are the Only Source of Style:** Consume `DESIGN.md` §2 tokens; never introduce raw colours, spacing, font sizes or `z-index` literals in component CSS.

---

## 2. Forbidden Patterns (Negative Constraints)

Any pull request or code change containing the following patterns will be rejected immediately:

- ❌ Adding **runtime** dependencies to `package.json`. Build-time/dev dependencies that only generate static output or run in CI (e.g. a service-worker precache plugin, Lighthouse CI, axe-core) are allowed; record the rationale in the PR and confirm the bundle budget still holds.
- ❌ Using `innerHTML` with unsanitized user content (use `textContent`, `createElement`, or DOM templates to ensure zero XSS).
- ❌ Storing or leaking `DeviceMetrics` (`click_count`, `last_visited_at`) into the remote `HubStoragePayload`.
- ❌ Spawning new browser tabs/windows on standard bookmark clicks (mandate: all primary navigations execute in the same window via `window.location.href`).
- ❌ Polling the GitHub API continuously (sync must be strictly event-driven: on window focus, visibility change, `online`, or debounced mutation).
- ❌ Any network request to a host other than the app's own origin or `api.github.com` (no IP/geo/weather lookups, analytics, favicon services, fonts or CDNs).
- ❌ Controls that are visible or reachable only on `:hover`, via right-click (`contextmenu`) only, or by HTML5 drag-and-drop only.
- ❌ Interactive hit areas below 44 × 44 px on `(pointer: coarse)` (24 px absolute floor).
- ❌ `outline: none` without an equivalent, ≥ 3:1 focus indicator; relying on `box-shadow` alone for focus (invisible in forced-colors).
- ❌ Text below 4.5:1 or control boundaries below 3:1 contrast; colour as the only carrier of meaning.
- ❌ Using `100vh` for full-height layout (use `100dvh` with a `vh` fallback); fixed bars without `env(safe-area-inset-*)`.
- ❌ Building a modal, popover or menu without the shared `utils/dialog.ts` / `utils/menu.ts` primitives (focus trap, inert background, focus restore, Escape).
- ❌ Deleting user data without an Undo toast or an explicit confirmation (`DESIGN.md` §9); discarding unsaved edits silently.
- ❌ `<input>` URL/identifier fields without the mobile keyboard attributes in `DESIGN.md` §4.3; inputs under 16 px on coarse pointers.
- ❌ Hard-coded user-visible strings outside the message catalogue (once `utils/i18n.ts` exists); physical CSS properties (`margin-left`, `left`, …) where a logical property exists.
- ❌ Calling `skipWaiting()` unconditionally in the service worker; the update flow is user-controlled (`PRD.md` §5.9).
- ❌ Writing the GitHub token (PAT) in plain text anywhere once the encryption envelope exists (IndexedDB, export JSON, logs, sync payload, DOM value); the approved shapes in `SCHEMAS.md` §3.5/§3.6 must be implemented exactly as specified, with no additional fields.
- ❌ Header content positioned without respecting `env(titlebar-area-*)` / `--header-h`, or interactive header children missing `app-region: no-drag` (Window Controls Overlay, `DESIGN.md` §3.1).
- ❌ Inline `<script>` / `<style>` or inline `style=""` attributes (dynamic values go through CSS custom properties set via `style.setProperty`).

---

## 3. Project Directory Map & File Responsibilities

When modifying or implementing features, strictly respect directory boundaries:

```
src/
├── core/                  # Headless business logic, data, and network layers (no DOM imports)
│   ├── db.ts              # Native IndexedDB wrapper (CRUD, transactions, indices)
│   ├── store.ts           # Central reactive in-memory state store & pub/sub event bus
│   ├── sync.ts            # GitHub REST API client & fine-grained timestamp merger
│   ├── fallback.ts        # Primary URL connectivity checks and mirror resolution
│   ├── pwa.ts             # Install/update lifecycle, badging, share parsing, storage.persist()
│   └── notifications.ts · gamepad.ts · lock.ts · image.ts
├── components/            # UI components (Vanilla TS classes managing DOM nodes)
│   ├── omnibar.ts         # Search combobox, fuzzy matcher, hotkeys, search provider router
│   ├── bookmarks.ts       # Categorized tile grid, recents, empty state, tile menu
│   ├── tasks.ts · notes.ts · drawer.ts · note-editor.ts · bookmark-editor.ts
│   ├── header.ts · brand.ts · profile-popover.ts · profile-editor.ts
│   ├── status-chip.ts     # Sync / offline status (icon + text)
│   ├── onboarding.ts      # First-run card and opt-in sample set
│   ├── settings.ts        # Sectioned settings, token verification, export/import preview
│   ├── share-target.ts · lock-screen.ts
│   └── toast.ts           # Variants, undo/retry actions, persistence, dedupe
├── styles/                # CSS architecture
│   ├── tokens.css         # Tokens exactly per DESIGN.md §2 (single dark definition)
│   ├── layout.css         # Mobile-first responsive tiers per DESIGN.md §3
│   └── components.css     # Component styles (tokens only; no raw literals)
├── types/
│   └── schemas.ts         # Strict import of types defined in SCHEMAS.md
├── utils/
│   ├── dom.ts             # Element creation helpers, multi-path SVG icons, sanitization
│   ├── dialog.ts          # Shared dialog / bottom-sheet primitive (trap, inert, restore)
│   ├── menu.ts            # Shared menu / popover primitive (roving focus, clamping)
│   ├── i18n.ts            # Message catalogue, plural and format helpers
│   ├── text.ts · crypto.ts
└── main.ts                # Entrypoint: bootstrap, error boundary, Service Worker registration
docs/                      # accessibility.md, homepage.md
plans/                     # Phase plans; production-readiness.md is the active roadmap
scripts/                   # generate-icons.mjs, contrast.mjs (token contrast verifier)
```

---

## 4. Phased Implementation Roadmap

The original five build phases (Foundation, Launchpad, Productivity Panes, Sync & Settings, PWA) are **complete** (see `plans/phase-*.md`). The active roadmap is the **production-readiness programme** in [`plans/production-readiness.md`](plans/production-readiness.md): Phase 0 baseline → 1 correctness fixes → 2 CSS foundations → 3 dialog & menu primitives → 4 touch parity → 5 safety UX → 6 first-run & IA → 7 responsive tiers → 8 PWA hardening → 9 telemetry removal → 10 i18n/RTL & polish → 11 release gates.

Rules for working the roadmap:

- Implement phases in the documented order. **Do not start a phase until the previous phase's exit criteria are verified.** Phases 2 and 3 unblock 4–7.
- Reference gap IDs (`G-xx`) in commit messages and tests (e.g. `fix(tasks): use local date for today chip (G-57)`).
- Each phase adds tests for the behaviour it introduces and updates the relevant spec if reality differs (specs and code must never drift).
- Record before/after metrics in `plans/production-readiness.md` §6.
- Commit in small logical units; each commit passes `typecheck` + `test`.

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

# 5. Lint (also enforced pre-commit and in CI)
npm run lint

# 6. Token contrast verification (added in roadmap Phase 2): text >= 4.5:1, controls/focus >= 3:1
node scripts/contrast.mjs

# 7. Release gates (added in roadmap Phase 11): Lighthouse CI (PWA pass, a11y >= 95),
#    axe-core (zero serious/critical), bundle-size budget (< 60 KB gzip)
```

### Required Test Coverage (Vitest)

- `src/core/__tests__/db.test.ts`: Test database upgrade, indices, and entity read/writes.
- `src/core/__tests__/sync.test.ts`: Test merge conflict resolution with mock local and remote payloads (timestamps, deletions, additions).
- `src/components/__tests__/omnibar.test.ts`: Test URL detection vs. search query detection (including `localhost:3000`, IPv4/IPv6, IDN, and rejected `javascript:`/`data:` schemes) and the combobox ARIA contract.
- `src/utils/__tests__/dialog.test.ts` and `menu.test.ts`: focus trap, inert background, focus restore, Escape, roving tabindex, viewport clamping.
- `src/components/__tests__/toast.test.ts`: variants, undo/retry actions, pause-on-hover/focus, persistent errors, dedupe.
- `src/components/__tests__/tasks.test.ts`: local-date `todayIso()` (midnight / non-UTC timezones), Move/Indent actions, Pointer-Events drag.
- `src/core/__tests__/pwa.test.ts`: install-prompt lifecycle, update-available flow, `storage.persist()` result recording.
- Accessibility/target-size tests run under `pointer: coarse` emulation (see `docs/accessibility.md` §8).

---

## 6. Agent "Definition of Done" Checklist

Before declaring any ticket or stage complete, the agent must verify:

- [ ] Code is formatted cleanly with semantic comments explaining architectural decisions.
- [ ] No `any` types used in TypeScript files (must adhere strictly to `schemas.ts`).
- [ ] No inline CSS styles or script injections.
- [ ] IndexedDB transactions are properly closed and error-handled.
- [ ] All inputs are trimmed and escaped to prevent layout breakage.
- [ ] `npm run typecheck`, `npm run lint` and `npm run test` pass with zero failures; `npm run build` stays under the `< 60 KB` gzip budget.
- [ ] **Touch:** every new interaction works by touch alone; hit areas are ≥ 44 px on coarse pointers; nothing is hover-only (`DESIGN.md` §4).
- [ ] **Keyboard & screen reader:** reachable by keyboard with visible focus, correct roles/states/names, focus managed on open/close (`docs/accessibility.md`).
- [ ] **Contrast & preferences:** tokens only; text ≥ 4.5:1, controls/focus ≥ 3:1; verified under `prefers-contrast: more`, forced-colors and `prefers-reduced-motion`.
- [ ] **Responsive:** checked at 320, 390, 768, 1280 and 1920 px, portrait and landscape; safe areas and `dvh` respected.
- [ ] **Safety:** deletes are undoable or confirmed; dirty forms are guarded; async actions always resolve to a visible success or error.
- [ ] **Network:** the change adds no request to any host other than same-origin or `api.github.com`.
- [ ] Specs updated in the same change if behaviour or tokens changed (`PRD.md`, `DESIGN.md`, `docs/accessibility.md`, `SCHEMAS.md`), and the gap ID (`G-xx`) referenced.
