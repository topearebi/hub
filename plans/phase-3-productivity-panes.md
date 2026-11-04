# Phase 3 — Productivity Panes (Tasks & Scratchpad): Build Approach & Delivery Plan

**Project:** Hub
**Phase:** 3 of 5 — Productivity Panes
**Parent Specs:** [`PRD.md`](../PRD.md), [`SCHEMAS.md`](../SCHEMAS.md), [`AGENTS.md`](../AGENTS.md)
**Status:** Complete

---

## 1. Objective

Deliver the dual side-drawer workspace: a Tasks drawer on the left and a
Scratchpad drawer on the right, with desktop pinning and a mobile bottom tab
bar.

1. `components/tasks.ts` — task creation, checkbox toggles, deletion, sorting.
2. `components/notes.ts` — plain-text cards, color badges, clipboard copy.
3. `components/drawer.ts` — shared drawer shell (header, pin, close).
4. Desktop pinning: 0 / 1 / 2 pinned drawers → 1 / 2 / 3-column layouts.
5. Mobile (`< 768px`) bottom tab bar: Bookmarks | Tasks | Notes.

**Exit Criteria (from AGENTS.md):** Drawers slide smoothly
(`transition: 200ms`); pinning state persists to `AppConfig`; mobile tab
switching works seamlessly.

---

## 2. Guiding Principles

| Principle                  | How Phase 3 Enforces It                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| **Persisted UI state**     | Pinning writes to `AppConfig.pinned_drawers` via `store.updateConfig()`.     |
| **Pure logic is exported** | `sortTasks`, `sortNotes`, `noteColorClass` are pure and unit-tested.         |
| **XSS-safe rendering**     | Note bodies render via `<pre>` + `textContent`; Markdown is never parsed.    |
| **Local-first clipboard**  | Copy uses `navigator.clipboard.writeText()` with a graceful fallback toast.  |
| **Single source of truth** | Drawers mutate through the store; views re-render on `tasks`/`notes` events. |
| **No inline CSS**          | Drawer open/pin state is expressed via `data-*` attributes styled in CSS.    |

---

## 3. Task Breakdown

### 3.1 Shared Drawer Shell (`src/components/drawer.ts`)

- `buildDrawerShell({ variant, title, onPinToggle, onClose })` returns the
  `<aside>` element, its body mount point, and the pin/close buttons.
- Emits `data-pinned` / `data-open` attributes consumed by the layout CSS.

### 3.2 Tasks Drawer (`src/components/tasks.ts`)

- `sortTasks()` — pending first (newest first), then completed (newest first).
- Create via a form; toggle via checkbox (`completed` + `completed_at`);
  delete via soft tombstone.
- Empty state: "All priorities cleared. Add a task to track today's focus."

### 3.3 Notes Drawer (`src/components/notes.ts`)

- `sortNotes()` — most recently updated first.
- `noteColorClass()` — maps a `color_tag` to a safe CSS class (defaults neutral).
- Cards render title, color badge, copy, delete, and a `<pre>` body.
- Copy writes raw text to the clipboard and confirms via toast.
- Empty state: "Scratchpad is empty. Click '+ Note' to paste temporary information."

### 3.4 Layout & Pinning (`src/main.ts`, `layout.css`)

- `app-shell` gains `--tasks-pinned` / `--notes-pinned` / `--both-pinned`
  modifier classes driving the grid columns.
- Unpinned drawers are off-canvas overlays (slide via `transform`); pinned
  drawers occupy grid columns.
- Mobile: `data-view` on the shell selects the visible panel; a fixed bottom
  tab bar switches views.

---

## 4. Tests

- `src/components/__tests__/tasks.test.ts`: `sortTasks` ordering.
- `src/components/__tests__/notes.test.ts`: `sortNotes` + `noteColorClass`.

---

## 5. Definition of Done (Phase 3)

- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm run test` passes (all suites).
- [ ] `npm run build` produces a production bundle with no errors.
- [ ] Drawers slide with a 200ms transition; pinning persists to `AppConfig`.
- [ ] Mobile tab switching works without reload.
- [ ] No `any` types, no `innerHTML`, no framework imports.
