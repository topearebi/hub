# Accessibility Conformance Specification

**Document Version:** 1.0.0
**Project:** Hub
**Target:** WCAG 2.2 Level AA across all supported platforms (iOS, Android, desktop), plus the keyboard, screen-reader, switch, gamepad and high-contrast scenarios below.
**Parent specs:** [`PRD.md`](../PRD.md) §5.5–5.9 and §8, [`DESIGN.md`](../DESIGN.md)
**Roadmap:** [`plans/production-readiness.md`](../plans/production-readiness.md) (gap IDs `G-xx`)

---

## 1. Principles

1. Use native HTML elements first (`<button>`, `<input>`, `<dialog>`-like patterns, `<ul>`, `<nav>`); add ARIA only where no native element expresses the pattern.
2. **Every function has a keyboard path, a touch path and a screen-reader path.** No hover-only, right-click-only or drag-only functionality.
3. State is exposed programmatically (`aria-expanded`, `aria-pressed`, `aria-current`, `aria-checked`, `aria-invalid`, `aria-busy`), not only visually.
4. Colour is never the sole carrier of meaning.
5. User preferences are honoured: reduced motion, contrast, forced colours, colour scheme, text size, zoom, reduced transparency where applicable.

---

## 2. Landmarks, structure and semantics (G-32)

| Region                    | Element / role                                                                                                         | Notes                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Skip link                 | First focusable element: "Skip to content" → `#main`                                                                   | Visible on focus                                                            |
| Header                    | `<header>` as page `banner`, **outside** `<main>`                                                                      | Contains brand/profile/status/toggles                                       |
| Main                      | `<main id="main">` for the active pane                                                                                 | One per page                                                                |
| Mobile navigation         | `<nav aria-label="Primary">` with buttons; active has `aria-current="page"`                                            | Not `tablist` — panes are not ARIA tabs unless arrow-key behaviour is built |
| Drawers                   | `<aside aria-label="Tasks">` / `"Notes"`                                                                               | `inert` + `hidden` when closed                                              |
| Headings                  | One `<h1>` (brand text always present, visually hidden if a logo is shown), `<h2>` per pane/dialog, `<h3>` per section | No skipped levels                                                           |
| Lists                     | Tiles, tasks, subtasks and notes are `<ul>/<li>` (or `role="list"/"listitem"`)                                         | Screen readers announce counts                                              |
| Completed tasks           | Disclosure `<button aria-expanded>` controlling a list                                                                 |                                                                             |
| Page language / direction | `<html lang dir>` kept in sync with the active locale                                                                  |                                                                             |

---

## 3. Keyboard

### 3.1 Global shortcuts

Shortcuts are ignored while the user is typing in an input/textarea/select/contenteditable, while a dialog is open, and while the app is **locked** (G-29). Single-key shortcuts and chords (`/ ? g n t m`) can be turned off in Settings → General (WCAG 2.1.4; persisted in the approved field `single_key_shortcuts_enabled`, `SCHEMAS.md` §3.6). `Alt+digit` is unaffected.

| Keys                     | Action                                                              | Notes                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/`                      | Focus the omnibar and select its text                               | Fine pointers; also available via the skip link menu                                                                        |
| `?`                      | Open the keyboard-shortcuts overlay                                 | Lists every shortcut; `aria-keyshortcuts` mirrors it                                                                        |
| `g` then `1…9`           | Launch pinned bookmark in that slot (**primary**)                   | Modifier-free chord, 1.5 s window, hint announced politely; ignored with Ctrl/Meta/Alt held                                 |
| `Alt+1…9`                | Same (optional extra)                                               | Collides with browser tab switching / macOS Option characters on some platforms; modifier shortcut, so not subject to 2.1.4 |
| `n` then `t` / `n` / `b` | New task / new note / new bookmark                                  | Chord, 1.5 s timeout                                                                                                        |
| `t`, `m`                 | Toggle Tasks / Notes drawer (or switch mobile pane)                 |                                                                                                                             |
| `Esc`                    | Close the top-most layer (menu → dialog → drawer → omnibar results) | Same order as the gamepad "back"                                                                                            |
| `Ctrl/Cmd+Enter`         | Save in multi-line forms                                            |                                                                                                                             |

### 3.2 Focus management rules

1. **Dialogs:** on open, move focus inside (first invalid field → first field → primary action; Cancel for destructive confirms); trap Tab/Shift+Tab; mark background `inert`; on close, restore focus to the invoking element (or its nearest surviving ancestor). (G-28)
2. **Drawers (overlay):** focus moves to the drawer heading/first control on open; Esc closes; focus returns to the toggle. Pinned drawers do not steal focus.
3. **Mobile pane switch:** focus moves to the new pane's heading (`tabindex="-1"`) and the change is announced via the heading.
4. **Menus/popovers:** focus the first item (or the checked item) on open; Esc/Tab closes and returns focus to the trigger.
5. **After deletion:** focus moves to the next item, else the previous, else the list container/heading — never to `<body>`.
6. **Toast actions:** reachable by Tab (toasts are in the DOM order after `<main>`); never steal focus.
7. **Visible focus:** solid 2 px outline with 2 px offset (`--focus-ring`) ≥ 3:1 against adjacent colours; never `outline: none` without an equivalent; works in forced-colors. Focus is never obscured by sticky bars (apply `scroll-padding` for the omnibar/tab bar) (WCAG 2.4.11).
8. No keyboard trap other than the intentional dialog trap; Esc always exits.

### 3.3 Composite widgets (roving tabindex)

| Widget            | Keys                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Tile grid         | Arrows move in the visual grid; Home/End; Enter/Space activates; `Menu`/Shift+F10 opens the item menu. Only one tile is in the Tab order. |
| Menu              | Up/Down/Home/End, type-ahead, Enter/Space activates, Right/Left opens/closes submenus, Esc, Tab closes                                    |
| Colour radiogroup | Arrows move **and** select; Tab leaves the group                                                                                          |
| Omnibar           | Up/Down move the active option (focus stays in the input); Enter activates; Esc closes then clears then blurs                             |
| Task drag         | Handle focusable; Space picks up, Up/Down moves, Space drops, Esc cancels — plus Move/Indent menu items                                   |

---

## 4. ARIA patterns by component

| Component           | Pattern / required attributes                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Omnibar (G-30)      | Input `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant`; listbox has `aria-label="Search results"`; each option has a unique `id` and `aria-selected`; a polite live region announces "N results" / "No saved links match…" |
| Dialog              | `role="dialog"` (or `alertdialog` for confirms) with `aria-modal="true"`, `aria-labelledby` → visible title, `aria-describedby` → message                                                                                                                                          |
| Menu (G-31)         | Trigger: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`; container `role="menu"`; items `menuitem`/`menuitemradio`/`menuitemcheckbox` with `aria-checked`; separators `role="separator"`. Do not use `role="menu"` unless the keyboard behaviour above is implemented    |
| Pin button          | `aria-pressed` with a stable label ("Pin Tasks")                                                                                                                                                                                                                                   |
| Drawer toggle       | `aria-expanded`, `aria-controls`                                                                                                                                                                                                                                                   |
| Mobile nav          | `aria-current="page"` on the active button                                                                                                                                                                                                                                         |
| Task checkbox       | Native `<input type="checkbox">` with `aria-labelledby` → the task title (applies to completed tasks too)                                                                                                                                                                          |
| Task chips          | `role="group" aria-label="Due"`; each chip `aria-pressed`                                                                                                                                                                                                                          |
| Completed accordion | Button `aria-expanded`, `aria-controls`                                                                                                                                                                                                                                            |
| Colour swatches     | `role="radiogroup"`, each `role="radio"` with `aria-checked` and the colour **name** as label                                                                                                                                                                                      |
| Status chip         | `role="status"` (polite), text + icon; error state is `role="alert"`                                                                                                                                                                                                               |
| Toasts (G-37)       | Container region; info/success `role="status"`, error/warning `role="alert"`; pause on hover/focus; dismissible; no auto-dismiss for errors                                                                                                                                        |
| Form fields (G-36)  | Visible `<label for>`; `required`; `aria-invalid="true"` on error; `aria-describedby` → helper + error; error summary at top of the dialog (`role="alert"`) and focus on first invalid field                                                                                       |
| Busy operations     | `aria-busy="true"` on the control/region; a status message announces the result                                                                                                                                                                                                    |
| Icon-only buttons   | `aria-label` (never `title` alone); icons `aria-hidden="true"`                                                                                                                                                                                                                     |
| Avatar / logo       | Informative image: `alt` = profile name; decorative: `alt=""`                                                                                                                                                                                                                      |
| Skeleton            | Container `aria-busy="true"` and a visually-hidden "Loading your data"                                                                                                                                                                                                             |
| Telemetry region    | **Removed** (the former `role="status"` IP/weather badge no longer exists)                                                                                                                                                                                                         |

---

## 5. Visual, motion and preference requirements

| Requirement                       | Criterion                | Hub rule                                                                                                                  |
| --------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Text contrast                     | 1.4.3                    | ≥ 4.5:1 (DESIGN.md §2.3), checked in CI                                                                                   |
| Non-text contrast                 | 1.4.11                   | Control borders, focus ring, selected-state indicators ≥ 3:1                                                              |
| Use of colour                     | 1.4.1                    | Sync, selection, validation and toast variants pair colour with icon/text/shape                                           |
| Resize text / reflow              | 1.4.4 / 1.4.10           | 200 % text and 320 CSS px width without horizontal scrolling or loss of function; no fixed-height containers for text     |
| Text spacing                      | 1.4.12                   | No clipping when line/letter/word spacing is increased                                                                    |
| Content on hover/focus            | 1.4.13                   | Tooltips are dismissible (Esc), hoverable and persistent; essential info is never tooltip-only (`title` is supplementary) |
| Orientation                       | 1.3.4                    | Both orientations supported (manifest `orientation: any`)                                                                 |
| Target size                       | 2.5.8 (and 44 px policy) | ≥ 24 px minimum anywhere, ≥ 44 px on coarse pointers                                                                      |
| Dragging movements                | 2.5.7                    | Every drag has a single-pointer alternative (Move/Indent menu items)                                                      |
| Pointer gestures / cancel         | 2.5.1 / 2.5.2            | Long-press and swipe are never the only path; up-event activation, with abort by moving away                              |
| Character key shortcuts           | 2.1.4                    | Single-key shortcuts can be turned off or remapped                                                                        |
| Reduced motion                    | 2.3.3 (AAA, adopted)     | `prefers-reduced-motion` removes non-essential motion, including JS-driven animation                                      |
| Timing                            | 2.2.1                    | Toasts pause on hover/focus; errors persist; no time limits on user input                                                 |
| High contrast / forced colours    | —                        | `prefers-contrast: more` and `forced-colors: active` supported (DESIGN.md §2.4)                                           |
| Consistent help / navigation      | 3.2.2, 3.2.3, 3.2.6      | Settings and shortcut help are in the same place on every view                                                            |
| Redundant entry                   | 3.3.7                    | Previously entered values (e.g. sync config) are retained when a step fails                                               |
| Accessible authentication         | 3.3.8                    | App lock uses the platform authenticator (no cognitive test); the PAT field allows paste                                  |
| Error identification / suggestion | 3.3.1 / 3.3.3            | Errors are textual, specific and next to the field with a fix suggestion                                                  |
| Error prevention                  | 3.3.4                    | Destructive and data-overwriting actions are undoable or confirmed (DESIGN.md §9)                                         |

---

## 6. Platform specifics

- **iOS VoiceOver/Safari:** `contextmenu` does not fire on long-press, so every context-menu action also exists as a visible "⋯" button. Inputs ≥ 16 px avoid focus zoom. Standalone mode honours safe areas.
- **Android TalkBack:** exploration by touch needs ≥ 44 px targets and accessible names; custom swipe gestures must not collide with TalkBack gestures (they are optional).
- **Desktop screen readers (NVDA, JAWS, VoiceOver):** landmarks, headings and list counts provide the primary navigation; live regions are used sparingly (omnibar count, status chip, toasts).
- **Windows High Contrast / forced colours:** borders and outlines survive; icons use `currentColor`; SVG fills are not relied on.
- **Switch / voice control:** every control has a unique visible label matching its accessible name (WCAG 2.5.3 label-in-name).
- **Window Controls Overlay (installed desktop Chromium):** the OS window controls and system menu remain keyboard/AT-accessible; Hub keeps header controls outside the title-bar controls band, keeps the drag region non-focusable and role-less, and guarantees focus rings are not hidden under the header (`scroll-padding-top: var(--header-h)`). See DESIGN.md §3.1.
- **Gamepad:** optional; follows the same focus order and the `Esc`-equivalent "back".

---

## 7. Parity checklist (touch · keyboard · screen reader)

Each row must be reachable by every input method. A reviewer ticks all three columns.

| Function                                     | Touch                           | Keyboard                         | Screen reader                           |
| -------------------------------------------- | ------------------------------- | -------------------------------- | --------------------------------------- |
| Search & open a bookmark                     | Tap omnibar → result            | `/`, arrows, Enter               | Combobox announces active option        |
| Launch a pinned bookmark                     | Tap tile                        | `g n` / `Alt+n`                  | Tile name + position                    |
| Edit / delete / choose mirror                | Tile "⋯" or long-press          | Menu key / Shift+F10 / tile menu | Menu with named items                   |
| Add task, set date, repeat                   | Creator chips and Repeat menu   | Tab, Enter, Esc                  | Chips `aria-pressed`                    |
| Complete a task                              | Tap checkbox (44 px)            | Space                            | Checkbox named by the task title        |
| Reorder / nest a task                        | Drag handle or Move/Indent menu | Handle (Space + arrows) or menu  | Menu items; live "Moved to position"    |
| Create / pin / colour / copy / delete a note | Card "⋯" menu                   | Tab to the toolbar menu          | Named menu items                        |
| Undo a delete                                | Toast Undo button               | Tab to toast / shortcut `z`      | `role="status"` announces; button named |
| Switch pane                                  | Tab bar                         | `t`, `m` or toggles              | `aria-current`, pane heading focus      |
| Configure sync, export/import                | Settings sections               | Tab / Enter                      | Labelled fields, validated inline       |
| Install the app                              | Install card / iOS sheet        | Settings → Install               | Labelled controls                       |
| Unlock                                       | Biometric/screen lock           | Enter on the unlock button       | Dialog name + status                    |

---

## 8. Automated and manual verification

### 8.1 Automated (CI, Phase 11)

- **axe-core** against each primary view and dialog (light, dark, forced-colors emulation): zero serious/critical violations.
- **Lighthouse CI:** Accessibility ≥ 95 on the mobile profile; PWA category pass.
- **Unit tests:** dialog trap/restore/inert/Esc; menu roving behaviour; combobox `aria-activedescendant` updates; toast pause/persist/dedupe; `aria-current`/`aria-expanded` state changes; lock guard blocks shortcuts.
- **Contrast script:** `scripts/contrast.mjs` over `tokens.css`.
- **Target size check:** headless test measuring bounding boxes of interactive elements under `pointer: coarse` emulation (≥ 44 px, 24 px floor).

### 8.2 Manual (release gate)

1. Keyboard-only pass of every journey in §7 on desktop Chromium and Firefox; confirm visible focus everywhere and no traps.
2. VoiceOver (iOS Safari + installed PWA), TalkBack (Chrome + installed PWA), NVDA + Firefox, VoiceOver + Safari: complete the §7 journeys.
3. 200 % browser zoom and 320 px width; large system font on iOS/Android.
4. Windows forced-colors and `prefers-contrast: more`; `prefers-reduced-motion`.
5. Switch Access / Voice Control spot-check of labels (label-in-name).
6. Record results and defects in `plans/production-readiness.md` §6.

---

## 9. Definition of accessible

A feature is accessible when it: (a) has no open axe serious/critical issues; (b) passes the §7 parity row(s) it touches; (c) meets §5 contrast, target-size and preference rules; (d) has unit tests for any new focus or ARIA behaviour; and (e) has been manually checked with at least one screen reader and keyboard-only.

## Bookmark card refresh — G-16, G-22, G-23, G-33

The visible More menu exposes Arrange, Move, Edit, Share, Delete and size actions.
Arrange offers a whole-card touch drag surface, instructions, Done and Escape;
Move actions provide a complete non-drag alternative. Controls remain separate
from the primary activation button and use the coarse-pointer hit-area token.
Alternate icons have hostname-based accessible names and visible focus labels.
Keyboard focus returns to the menu trigger; move outcomes use accessible toasts.
Dialogs and menus reflow within the visual viewport, including keyboard-induced
resize/offset changes, with scrollable content and focus visibility.

### Sync conflict inbox (G-41/G-55, 2026-11-09)

The inbox uses the shared Dialog focus trap, inert background, viewport/safe-area
handling and focus restoration. Touch, mouse and keyboard users use the same
version-choice, export and Close buttons. Both version regions have accessible
names and tabindex for keyboard scrolling. Resolution moves focus to the updated
body; the empty state and persistent sync status explain when upload resumes.
Escape/Close never discards unresolved versions. Automated axe, focus and
coarse-pointer target evidence is in [sync-hardening](evidence/sync-hardening/).
Physical screen readers and on-screen keyboards remain owner-run release checks.

### Bookmark icon restoration — 2026-11-09

Custom and automatic bookmark images remain decorative (`alt=""`); titles name
the card action. Image failure preserves the local initial and readable title.
The same renderer serves small/wide/large cards and the live editor preview;
controls, focus handling and touch hit areas are unchanged. Image loading never
blocks navigation or arranging. See [icon repair evidence](evidence/bookmark-icons/README.md).
