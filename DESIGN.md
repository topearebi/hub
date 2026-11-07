# design.md — UI/UX & Visual Design Specification

**Document Version:** 2.0.0
**Project:** Hub
**Status:** Approved — production-readiness revision
**Parent specs:** [`PRD.md`](PRD.md) (v1.1.0), [`docs/accessibility.md`](docs/accessibility.md)
**Roadmap:** [`plans/production-readiness.md`](plans/production-readiness.md)

This document is the **single source of truth** for visual and interaction design. `src/styles/tokens.css` implements §2; where the shipped CSS differs from this spec, the spec is the target and the delta is a defect tracked in the roadmap (gap IDs `G-xx`). `PRD.md` must not duplicate token values.

---

## 1. Principles

1. **Glance first.** Hub is used one-handed, in motion, on a phone, often offline. The most useful information (recent links, today's tasks, latest notes) must be visible and tappable within two seconds of opening, with no required setup, sign-in or network.
2. **Mobile is the primary design target.** Design the 390 × 844 portrait phone first, then scale up. Desktop adds density, shortcuts and persistent panes; it never owns functionality that touch lacks.
3. **Every action reachable by every input.** Touch, mouse, keyboard, screen reader and gamepad each get a complete path. No feature may depend on hover, right-click or drag alone.
4. **Calm, warm, low-strain.** Soft editorial warmth (not clinical white, not pure black). Colour carries meaning only when paired with text or shape.
5. **Forgiving over fearful.** Prefer undo to confirmation dialogs; confirm only what cannot be undone. Never discard user input silently.
6. **Progressive disclosure.** Show the common path; tuck expert options (mirrors, VAPID, hotkeys) behind an "Advanced" disclosure.
7. **Honest status.** Always say whether data is saved locally, syncing, offline or failed — in words, not just a coloured dot.
8. **Local-first and private.** No third-party requests other than the user-configured GitHub sync. No remote fonts, icons or scripts.

Atmosphere reference: iA Writer meets a modern browser start page. Typography is a clean system sans-serif hierarchy; monospace is reserved for hotkeys and badge tokens.

---

## 2. Design Tokens

### 2.1 Structure rules

- One definition per token. Light values live in `:root`. Dark values are declared **once**, and only in the dark-only places: a `@media (prefers-color-scheme: dark)` rule scoped to `:root:not([data-theme='light'])` (auto theme follows the OS), plus the explicit `[data-theme='dark']` selector. Plain CSS cannot share one declaration block between a media query and an attribute selector, so the dark set is either (a) generated at build time from a single source list by a small dev-only script/plugin, or (b) kept as two blocks guarded by a unit test that asserts they are identical. The explicit `[data-theme='light']` block is **deleted** (it only repeated `:root`).
- One naming system. The legacy aliases (`--bg-primary`, `--text-primary`, `--accent-warm`, numeric `--space-N`, `--shadow-sm/md`) are **removed**; `layout.css` migrates to the canonical names.
- `:root { color-scheme: light dark; }`, `[data-theme='light'] { color-scheme: light; }`, `[data-theme='dark'] { color-scheme: dark; }` so native controls, scrollbars and autofill follow the theme.
- The in-app theme also drives the two `<meta name="theme-color">` values (updated at runtime when the user overrides the OS theme).
- No raw colour, `px` spacing or `z-index` literals in `components.css` / `layout.css`; use tokens.

### 2.2 Token reference

```css
:root {
  color-scheme: light dark;

  /* Canvas & surfaces */
  --bg-app: #faf7f2; /* page background */
  --bg-card: #ffffff; /* cards, modals, menus */
  --bg-subtle: #f2ede4; /* inputs, hover fills, drawer backs */
  --bg-scrim: rgba(24, 23, 22, 0.5); /* behind dialogs and overlay drawers */

  /* Borders */
  --border-light: #e8e2d8; /* decorative dividers only (exempt from 3:1) */
  --border-control: #8c847a; /* input, button, checkbox, chip boundaries (>= 3:1) */

  /* Text (all >= 4.5:1 on --bg-app, --bg-card and --bg-subtle) */
  --text-main: #2c2825;
  --text-sub: #5f5a54; /* labels, metadata */
  --text-faint: #6e6760; /* placeholders, hints, empty states, done tasks */

  /* Accents — "fill" tokens carry white text (>= 4.5:1); "text" tokens are used as text on surfaces */
  --accent-terracotta: #b04a2e; /* primary button / active chip fill */
  --accent-terracotta-text: #a8472c; /* links, due dates, danger text */
  --accent-sage: #4f7565; /* checked fill */
  --accent-sage-text: #44695a;
  --accent-amber-text: #8a5a12; /* reminders, warnings (text) */
  --accent-amber: #d99b43; /* decorative only — never text */
  --on-accent: #ffffff; /* text/icon colour placed on an accent fill */

  /* Focus */
  --focus-color: #a8472c; /* >= 3:1 against all adjacent surfaces */
  --focus-ring: 2px solid var(--focus-color);
  --focus-offset: 2px;

  /* State overlays (hover/pressed) — applied with color-mix, not filter */
  --state-hover: color-mix(in srgb, var(--text-main) 6%, transparent);
  --state-pressed: color-mix(in srgb, var(--text-main) 12%, transparent);
}

/* Dark: declared once (see 2.1) */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --bg-app: #181716;
    --bg-card: #22201e;
    --bg-subtle: #2b2825;
    --bg-scrim: rgba(0, 0, 0, 0.6);
    --border-light: #36322e;
    --border-control: #7d766d;
    --text-main: #ede8e1;
    --text-sub: #b4ada3;
    --text-faint: #9a938a;
    --accent-terracotta: #e07a5f;
    --accent-terracotta-text: #ee9a82;
    --accent-sage: #81a492;
    --accent-sage-text: #98bcaa;
    --accent-amber-text: #e5a955;
    --accent-amber: #e5a955;
    --on-accent: #1a1210; /* dark text on the lighter dark-mode fills */
    --focus-color: #f0a28b;
  }
}
/* [data-theme='dark'] repeats the same declarations via the combined selector. */
```

### 2.3 Contrast requirements (verified by `scripts/contrast.mjs`, Phase 2)

Text must meet **4.5:1** (WCAG 1.4.3); control boundaries and focus indicators **3:1** (1.4.11, 2.4.13).

| Pair (foreground → background)                    | Light              | Dark               | Requirement |
| ------------------------------------------------- | ------------------ | ------------------ | ----------- |
| `--text-main` on app / card / subtle              | 13.7 / 14.6 / 12.5 | 14.7 / 13.3 / 12.0 | ≥ 4.5       |
| `--text-sub` on app / card / subtle               | 6.4 / 6.8 / 5.9    | 8.1 / 7.3 / 6.6    | ≥ 4.5       |
| `--text-faint` on app / card / subtle             | 5.2 / 5.6 / 4.8    | 5.9 / 5.4 / 4.8    | ≥ 4.5       |
| `--accent-terracotta-text` on app / card / subtle | 5.5 / 5.8 / 5.0    | 8.2 / 7.4 / 6.7    | ≥ 4.5       |
| `--accent-sage-text` on app / card / subtle       | 5.8 / 6.2 / 5.3    | 8.6 / 7.8 / 7.1    | ≥ 4.5       |
| `--accent-amber-text` on app / card / subtle      | 5.5 / 5.9 / 5.1    | 8.6 / 7.8 / 7.1    | ≥ 4.5       |
| `--on-accent` on `--accent-terracotta`            | 5.4 (white)        | 6.3 (dark)         | ≥ 4.5       |
| `--on-accent` on `--accent-sage`                  | 5.2 (white)        | 6.7 (dark)         | ≥ 4.5       |
| `--border-control` on app / card / subtle         | 3.5 / 3.7 / 3.2    | 4.0 / 3.6 / 3.3    | ≥ 3.0       |
| `--focus-color` on app / card / subtle            | 5.5 / 5.8 / 5.0    | 8.7 / 7.9 / 7.2    | ≥ 3.0       |

Note-card pastel pairs (`--note-*-bg` / `--note-*-fg`) already meet 6.7–10.8:1 and are unchanged.

### 2.4 High-contrast and forced-colors

- `@media (prefers-contrast: more)`: `--text-faint` → `--text-sub`; `--border-light` → `--border-control`; border widths 2 px on controls; shadows removed.
- `@media (forced-colors: active)`: never rely on `box-shadow` or background colour alone. Focus uses `outline` (system colour). Checked state, sync state and note colour each carry a text label or shape in addition to colour (checkmark glyph; status text; note colour name in the accessible name). Use `forced-color-adjust: none` only for the note swatches, which keep a border.

### 2.5 Type scale

System stack: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif`. Mono: `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`. Never `-webkit-font-smoothing: antialiased` on dark surfaces (thins light-on-dark text).

| Token               | Size                     | Use                                                            |
| ------------------- | ------------------------ | -------------------------------------------------------------- |
| `--font-size-xs`    | 0.75rem (12)             | Non-essential metadata only; never the sole carrier of meaning |
| `--font-size-sm`    | 0.875rem (14)            | Secondary text, chips, dense desktop UI                        |
| `--font-size-md`    | 1rem (16)                | **Body and all inputs**                                        |
| `--font-size-lg`    | 1.25rem (20)             | Dialog titles, drawer titles                                   |
| `--font-size-xl`    | 1.75rem (28)             | Empty-state headings                                           |
| `--font-size-brand` | clamp(2rem, 6vw, 3.5rem) | Brand title only                                               |

Rules: sizes are `rem` so they respect user font settings (no `px` font sizes). Inputs, selects and textareas are ≥ 16 px on coarse pointers (prevents iOS focus zoom). Section labels use one style (`--font-size-sm`, 600, `--text-sub`, 0.04em tracking, sentence case — **not** all caps with three variants). Weights: 400 body, 600 emphasis/headings, 700 only for the brand. Line height 1.5 body, 1.25 headings.

### 2.6 Spacing, sizing, radii, elevation

| Token               | Value                                                                      | Notes                                                               |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `--space-xs … xl`   | 4, 8, 16, 24, 32 px; add `--space-2xs` 2, `--space-3` 12, `--space-2xl` 48 | No other literals                                                   |
| `--hit-min`         | 44 px (coarse), 32 px (fine)                                               | Minimum interactive hit area (see §4.1)                             |
| `--control-h`       | 36 px fine / 44 px coarse                                                  | Buttons, inputs, selects, chips share one height                    |
| `--control-h-lg`    | 52 px                                                                      | Omnibar                                                             |
| `--radius-sm/md/lg` | 6 / 10 / 16 px; `--radius-pill` 999px                                      | Replace `--radius-card`/`--radius-input` aliases with `--radius-md` |
| `--shadow-1/2/3`    | subtle / elevated / overlay                                                | Dialogs use `--shadow-3`; dark-mode variants use stronger alpha     |
| `--drawer-width`    | 340 px (clamped `min(340px, 90vw)`)                                        |                                                                     |
| `--tab-bar-h`       | 56 px + `env(safe-area-inset-bottom)`                                      | Replaces the hard-coded 80 px padding                               |

### 2.7 Motion

| Token        | Value                        | Use                               |
| ------------ | ---------------------------- | --------------------------------- |
| `--dur-fast` | 120 ms                       | Hover/pressed, toggles            |
| `--dur`      | 200 ms                       | Drawers, menus, tab switches      |
| `--dur-slow` | 320 ms                       | Bottom sheets, route-like changes |
| `--ease`     | `cubic-bezier(0.2, 0, 0, 1)` | Enter/move                        |
| `--ease-out` | `cubic-bezier(0.4, 0, 1, 1)` | Exit                              |

Animate `opacity` and `transform` only. `prefers-reduced-motion: reduce` collapses transitions to ≤ 0.01 ms **and** disables parallax/auto-scrolling and any JS-driven animation. Motion never conveys information alone.

### 2.8 Z-index scale

`--z-base: 0` · `--z-sticky: 100` (omnibar, tab bar) · `--z-results: 150` (omnibar results) · `--z-drawer: 200` (drawers + scrim) · `--z-popover: 300` (menus, profile popover) · `--z-modal: 400` · `--z-nested: 410` (confirm over modal) · `--z-lock: 500` · `--z-toast: 600` (toasts render above everything, including modals and the lock screen).

---

## 3. Layout & Responsive Tiers

Mobile-first: base CSS targets the compact phone; larger tiers add via `min-width` queries. Use `100dvh` (with a `100vh` fallback), `viewport-fit=cover`, and `env(safe-area-inset-*)` on every edge-anchored element (tab bar, toast container, drawers, sticky omnibar, bottom sheets).

| Tier                            | Query                                              | Layout                                                                                                      | Navigation                                                                            | Drawers                                                                       |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **A. Compact (phone portrait)** | `< 768px`                                          | Single pane; sticky omnibar on top; tile grid 3 columns (`minmax(96px, 1fr)`)                               | Fixed bottom tab bar: Tasks · Bookmarks · Notes (icon + label, open-task count badge) | Drawers are the Tasks/Notes panes themselves                                  |
| **B. Compact landscape-short**  | `(orientation: landscape) and (max-height: 500px)` | Single pane; omnibar scrolls away; tab bar becomes a 56 px **side rail** (labels hidden, `aria-label` kept) | Side rail                                                                             | As A                                                                          |
| **C. Medium (tablet)**          | `768–1023px`                                       | Centred column (max 720 px); tile grid 4–5 columns                                                          | Header drawer toggles                                                                 | Overlay drawers with a **scrim** (tap to close, Esc closes); pinning disabled |
| **D. Expanded (laptop)**        | `1024–1439px`                                      | Centred column; grid fluid (container query)                                                                | Header drawer toggles                                                                 | Pin up to **one** drawer (two-column); two pinned only at ≥ 1280 px           |
| **E. Wide (desktop/ultrawide)** | `≥ 1440px`                                         | Content column max 1200 px; grid auto-fills up to 8 columns; omnibar stays 640 px                           | Header toggles                                                                        | Pin both (three-column)                                                       |
| **F. Foldable / spanned**       | `(horizontal-viewport-segments: 2)`                | Launchpad on segment 1, active drawer on segment 2                                                          | —                                                                                     | Drawer pinned to the second segment; respects `env(viewport-segment-*)`       |

Additional rules:

- **Tile grid** uses an intrinsic `repeat(auto-fill, minmax(var(--tile-min), 1fr))` with `--tile-min`: 96 px (A/B), 120 px (C+). A container query on the grid caps columns (no 640 px lock).
- **Sticky omnibar** has a solid `--bg-app` backing (no content bleed-through) and sits below the safe-area top inset.
- **Thumb zone:** primary destinations (tab bar) and the add-actions live in the bottom half of the screen on phones. Destructive actions are never placed adjacent to the primary action.
- **Standalone display:** when `display-mode: standalone` (or iOS `navigator.standalone`) is active, the header's Hub app logo navigates back to Home after in-app navigations and external opens (see §6.1).
- **Window Controls Overlay (desktop Chromium):** implemented, as a progressive enhancement of the installed desktop app. See §3.1 for the full specification.
- **Print:** `@media print` hides chrome, forces the light palette and prints the active pane's content.

### 3.1 Window Controls Overlay (installed desktop apps)

**Decision:** implement it properly. It applies only to the installed PWA on desktop Chromium (Chrome/Edge 105+, ChromeOS, Windows, macOS, Linux). Phones, tablets, Safari and Firefox never enter this mode and are unaffected; the feature degrades to a normal title bar.

**What it does.** The OS title bar is removed and the page extends to the top edge of the window. The OS draws only the window controls (minimise/maximise/close — on the right on Windows/Linux/ChromeOS, as traffic lights on the left on macOS) over the page. Hub's header becomes the title bar: it gains roughly 32–40 px of vertical space and looks native.

**Manifest.** `"display": "standalone"` and `"display_override": ["window-controls-overlay", "standalone"]`. The user can toggle the mode from the chevron in the installed window; the app must react live.

**Detection (progressive enhancement, no dependencies).**

- CSS: `@media (display-mode: window-controls-overlay)` for all layout changes.
- JS (core/pwa.ts, DOM-free helper plus a thin binder in `main.ts`): read `navigator.windowControlsOverlay?.visible`, subscribe to its `geometrychange` event, and publish the rect as CSS custom properties on `:root` via `style.setProperty` (no inline `style=""` attributes): `--wco-x`, `--wco-y`, `--wco-w`, `--wco-h`. When the API is absent or `visible` is false, none of this runs.

**Layout contract.**

| Concern                 | Rule                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header height           | `--header-h: max(env(titlebar-area-height, 0px), 40px)` in WCO mode; the normal header height otherwise. All popovers, sticky offsets, `scroll-padding-top` and the omnibar's sticky `top` use `--header-h` — never a literal.                                                                                                                                                         |
| Usable band             | Header content lives only between `env(titlebar-area-x, 0px)` and `env(titlebar-area-x) + env(titlebar-area-width)`. Use `padding-inline-start: env(titlebar-area-x, 0px)` and `padding-inline-end: calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%))` so macOS (controls on the left) and Windows (controls on the right) both work, and RTL mirrors correctly. |
| Drag region             | The header's empty space is the drag region: `app-region: drag` (with `-webkit-app-region: drag` fallback) declared in `components.css`. Every interactive child (profile button, status chip, toggles, gear, Home) is `app-region: no-drag`. The drag region must keep **≥ 48 px** of free width at all window sizes.                                                                 |
| Graceful narrowing      | As the window narrows, collapse in this order to protect the drag region: profile name → avatar-only; status chip text → icon-only (accessible name unchanged); Home label → icon-only. Never let content run under the OS controls.                                                                                                                                                   |
| Draggable ≠ interactive | The drag region is not focusable and has no role; double-click-to-maximise is provided by the OS. Keyboard users reach the window menu via the OS (Alt+Space / system menu), which the overlay does not remove.                                                                                                                                                                        |
| Hit areas               | Fine pointer: header controls 32 px tall minimum, 8 px spacing, per §4.1.                                                                                                                                                                                                                                                                                                              |
| Colour                  | The title bar and OS controls take `theme-color` (`<meta name="theme-color">`, kept in sync with the in-app theme — §10). Header background is `--bg-app`; the 1 px bottom border `--border-light` remains. Contrast of the OS-drawn controls is the OS's responsibility; Hub guarantees only that `theme-color` is a solid, non-transparent colour.                                   |
| Sticky bars             | The sticky omnibar offsets from `--header-h`; the focus-visible ring must never be obscured by the header (WCAG 2.4.11) — apply `scroll-padding-top: var(--header-h)`.                                                                                                                                                                                                                 |
| Standalone fallback     | When not in WCO mode (including installed apps where the user toggled it off), the header is an ordinary in-page bar with no drag region.                                                                                                                                                                                                                                              |

**Testing.** Unit-test the pure helper that maps a `DOMRect` to the `--wco-*` values and the narrowing breakpoints; manual verification on installed Chrome/Edge on Windows, macOS and Linux (controls right and left), toggling the mode from the window chevron, a very narrow window, 125–200 % display scaling, and RTL.

---

## 4. Input Modality

### 4.1 Hit areas and states

- On `(pointer: coarse)` every interactive element has a hit area of at least **44 × 44 px** (visual size may be smaller; extend with padding or a `::after` hit-slop). On fine pointers the minimum is 32 px; the absolute floor anywhere is **24 px** with adequate spacing (WCAG 2.5.8).
- Adjacent hit areas are separated by ≥ 8 px (4 px only between chips that are each ≥ 44 px wide on coarse pointers).
- Every control has distinct **hover** (fine pointers only, inside `@media (hover: hover)`), **active/pressed**, **focus-visible**, and **disabled** states. Tap highlight is `-webkit-tap-highlight-color: transparent` with a visible `:active` fill instead. Controls and tiles use `touch-action: manipulation`; the page sets `overscroll-behavior: contain` on scrollable panes, modals and result lists.

### 4.2 No hover-only controls

Anything shown on `:hover` must also be visible by default under `@media (hover: none), (pointer: coarse)` or reachable via a persistent affordance:

| Surface                            | Fine pointer                                | Touch                                                                                |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Task row actions                   | Menu button revealed on hover/focus         | Always-visible "⋯" menu button; drag handle always visible                           |
| Note card toolbar                  | Revealed on hover/focus-within              | Always-visible "⋯" overflow button opening the same menu (Pin, Colour, Copy, Delete) |
| Bookmark tile actions              | Right-click and "⋯" revealed on hover/focus | Always-visible "⋯" in tile corner; **long-press** (500 ms) also opens the menu       |
| Hotkey hints (`/`, `g n`, `Alt+n`) | Shown                                       | Hidden                                                                               |

### 4.3 Mobile keyboard attributes

| Field                               | Attributes                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Omnibar                             | `type="search"`, `enterkeyhint="go"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`, `inputmode="search"` |
| Bookmark URL, icon URL, mirror URLs | `type="url"`, `inputmode="url"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`                            |
| GitHub owner / repo / branch / path | `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`                                                             |
| GitHub token, VAPID key             | `type="password"` (token), `autocomplete="off"`, `spellcheck="false"`, `autocapitalize="off"`                                 |
| Task title                          | `enterkeyhint="done"`; details textarea `enterkeyhint="enter"`                                                                |
| Names/titles                        | `autocapitalize="words"` (profile name) / `sentences` (note text)                                                             |

The omnibar **does not auto-focus on coarse pointers** at boot (it would raise the keyboard over the content); tapping it focuses it. On fine pointers it auto-focuses as before.

### 4.4 Gestures (progressive enhancement)

- **Long-press** (500 ms, cancels on > 8 px movement): opens the item menu; triggers a light haptic where supported.
- **Drag to reorder / nest tasks:** Pointer Events with a visible handle; a ≥ 44 px handle on touch; drop zones shown while dragging with plain-language labels ("Move here", "Make subtask"). Always paired with explicit **Move up / Move down / Indent / Outdent** menu items.
- **Swipe** (optional, Phase 10): swipe a task right to complete, left to delete-with-undo; never the only path.
- **Pull-to-sync:** not implemented; `overscroll-behavior` prevents accidental browser pull-to-refresh in standalone mode.
- **Haptics:** `navigator.vibrate(10)` for long-press recognition, completion and drag pickup; feature-detected, silent where unsupported.

### 4.5 Keyboard & gamepad

See [`docs/accessibility.md`](docs/accessibility.md) §3 for the full map. `/` focuses the omnibar; `?` opens the shortcuts overlay.

**Pinned-bookmark launch scheme (decided):** the primary shortcut is the modifier-free chord **`g` then `1…9`**, because `Alt+digit` is intercepted by browsers (tab switching on Linux/Windows Firefox and Linux Chrome) and types special characters on macOS. `Alt+1…9` remains supported as an optional extra for users whose browser delivers it to the page. Chord rules:

- After `g`, a small non-blocking hint ("Go to… press 1–9", a polite live region) shows for **1.5 s**; `Esc`, any other key, a pointer press or the timeout cancels it.
- The chord is ignored while typing in a field, while a dialog/menu is open, while the app is locked, and whenever `Ctrl`, `Meta` or `Alt` is held with `g` (so browser shortcuts like Ctrl+G are untouched). `Shift+g` does not start it.
- Matching uses `event.key` (not `event.code`) and lower-cases it; on layouts where `g` is not reachable the user still has `Alt+digit`, the tile grid, and the omnibar.
- Single-key and chord shortcuts (`/`, `?`, `g`, `n`, `t`, `m`) can be turned off in Settings → General ("Keyboard shortcuts") per WCAG 2.1.4; `Alt+digit` is a modifier shortcut and stays on. The switch is persisted in the approved `AppConfig.single_key_shortcuts_enabled` field (`SCHEMAS.md` §3.6). The shortcuts and the switch ship together; without a user-controllable off switch the single-key shortcuts would fail WCAG 2.1.4.

Gamepad navigation remains an optional feature toggle.

---

## 5. Navigation Patterns

### 5.1 Mobile tab bar

Fixed to the bottom, `--tab-bar-h` tall plus the bottom safe-area inset, solid `--bg-card`, 1 px top `--border-light`. Three equal tabs (Tasks · Bookmarks · Notes), each an icon (24 px) above a label (`--font-size-xs`… text must remain ≥ 12 px) with a ≥ 44 px hit area. Active tab: filled icon, `--accent-terracotta-text` label, 3 px top indicator bar (shape cue, not colour alone), `aria-current="page"`. Tasks shows an open-task count badge (`99+` cap). Switching tabs cross-fades (`--dur`) and restores each pane's scroll position; focus moves to the pane heading. Toasts and the sync chip sit **above** the tab bar.

### 5.2 Drawers (tablet and up)

Unpinned drawers are overlays with a scrim (`--bg-scrim`), 340 px (max 90 vw), slide `--dur`. Tap scrim or press Esc to close; focus moves into the drawer on open and returns to the toggle on close. Toggles expose `aria-expanded`/`aria-controls`. Pin buttons expose `aria-pressed` and the label stays "Pin Tasks" (state via `aria-pressed`, not label swap).

### 5.3 Dialogs and bottom sheets

All modals use the shared dialog primitive (§6.7). On compact phones a dialog is a **bottom sheet**: anchored to the bottom, rounded top corners, max 90 dvh, drag-handle affordance, bottom safe-area padding, reflowing above the on-screen keyboard (`visualViewport`). On tablet and up it is a centred card (max 560 px). Primary action is the right-most button on desktop and the full-width bottom button on phones; destructive buttons are never adjacent to the primary action without ≥ 16 px separation and danger styling.

### 5.4 Standalone-mode escape hatch

Installed standalone windows have no browser chrome. After the app navigates away from Hub and returns (or opens an external bookmark in the same window), Hub provides a persistent but unobtrusive "← Hub" control via the system back gesture support (`history` entries are preserved) and a Home action in the header. Bookmarks keep the same-window navigation mandate; no new windows.

---

## 6. Component Specifications

Every component documents: anatomy, states (default · hover · pressed · focus-visible · disabled · invalid · loading · empty), touch variant, and accessibility contract.

### 6.1 System header

Full-width bar pinned to the top (below the safe-area inset), `--bg-app`, 1 px bottom `--border-light`. **No telemetry.** (The IP / location / weather cluster is removed — see PRD §2.2.) Content:

- **Left:** Hub app logo (functions as Home navigation across all display modes) and the **status chip** (§6.9).
- **Right:** drawer toggles (tablet+; phones use the tab bar), settings gear, and the active-profile control (avatar + name, collapses to avatar-only < 480 px) opening the profile popover.
- The header is a page-level `banner` landmark placed **outside** `<main>`. In Window Controls Overlay mode it doubles as the draggable title bar (§3.1).
- **Profile popover:** a menu (§6.8): profile list as `menuitemradio` (current profile `aria-checked`), then Add profile, Profile settings, App settings.

### 6.2 Brand & omnibar

- **Brand:** profile logo (`max-height: 72px`) or custom title or "Hub". A logo is always accompanied by visually-hidden text so the page keeps an `<h1>`.
- **Omnibar:** a 52 px pill, `--radius-pill`, 1 px `--border-control`, solid focus ring. Inline engine selector on the left (≥ 44 px on coarse), input fills the centre (`type="search"`, 16 px), clear button appears when non-empty, `Enter` hint on the right (fine pointers only). Implements the ARIA combobox pattern: `role="combobox"` on the input, `aria-controls` → labelled listbox, `aria-expanded`, `aria-activedescendant` pointing at the active option id, `aria-autocomplete="list"`. A visually-hidden live region announces "N results" (debounced). First `Escape` closes the list; second clears the query; third blurs. Results are capped at 8 with matched characters highlighted; hover does not change the active row while typing.
- **Results dropdown:** appears below the pill without pushing content (`position: absolute; z-index: var(--z-results)`), max-height `min(60dvh, 420px)`, `overscroll-behavior: contain`. Rows ≥ 48 px on coarse pointers. Row types: bookmark, "Go to <url>" (direct URL), "Search <engine> for…", and "Add <url> as bookmark".

### 6.3 Bookmark tile

- Compact rounded card (`--radius-md`), favicon/letter tile at the top-left, title (2-line clamp), and — on fine pointers only — a hotkey badge top-right showing the chord, e.g. "G 3" (the shortcuts overlay lists both `g 3` and `Alt+3`). Letter fallback uses the first grapheme (`Array.from`), `--accent-terracotta` fill with `--on-accent` text.
- A "⋯" button (44 × 44 hit area, 24 px visual) in the top-right opens the item menu: Open, Open mirror ▸, Edit, Duplicate, Delete. Right-click, long-press and the keyboard context-menu key open the same menu.
- States: pressed (scale 0.98 + `--state-pressed`), busy (while the mirror probe runs: spinner + "Opening…", `aria-busy`), mirror-fallback (toast, §6.10).
- The tile grid is a `role="list"`; tiles are `listitem`s with roving-tabindex arrow-key navigation (Home/End; arrows follow visual grid). "Recently Used" duplicates are `aria-label`-ed "Recent: <title>" and excluded from the grid's roving order.

### 6.4 Task row

Circular checkbox (a real `<input type="checkbox">` styled; 44 px hit area, 24 px visual, `--accent-sage` fill with `--on-accent` check glyph), title, optional details (URLs as safe anchors), due/recurrence meta with icon + text, "⋯" menu (Add subtask · Set date/time · Move up · Move down · Indent · Outdent · Delete), drag handle (always visible on touch; revealed on hover/focus on fine pointers). Subtasks indent 24 px under a connector. Completed tasks: filled check, strikethrough, `--text-faint` (still ≥ 4.5:1), and a "Completed: Day, Mon DD" label. Tasks are a nested `<ul>`; the completed accordion is a button with `aria-expanded`.

Creator: a dashed "+ Add a task" row expands inline (title, details, chip group Today · Tomorrow · Pick date/time · Repeat). Chips are a `role="group"` of toggle buttons with `aria-pressed`; **Repeat opens a menu** listing all options (None · Daily · Weekly · Monthly · Yearly) rather than cycling. Enter saves; Esc collapses; empty submit focuses the title and shows "Add a title to save this task." `todayIso()` uses the local calendar date.

### 6.5 Note card

Pastel card (`--note-*`), title, plain-text preview (`white-space: pre-wrap`, 6-line clamp), colour name exposed in the accessible name, and a sibling "⋯" overflow button (Pin · Colour ▸ · Copy · Delete). The card body is a single `<button>`-style link opening the editor; the toolbar is **not** nested inside it. Sections "Pinned"/"Others" use sentence-case headings. Quick capture: collapsed "Take a note…" expands to title, body, colour radiogroup (roving arrow keys; each swatch ≥ 44 px on coarse), pin toggle, Close (discards **with** an unsaved-changes guard when non-empty) and Save.

### 6.6 Buttons, fields, chips

- **Button:** height `--control-h`, `--radius-md`, weights 600. Variants: primary (`--accent-terracotta` fill, `--on-accent` text), secondary (`--bg-subtle` fill, `--border-control` border), ghost, **danger** (`--accent-terracotta-text` text on secondary; confirm variant uses a dedicated danger fill). States: hover (`--state-hover`), pressed (`--state-pressed`), focus-visible (outline), disabled (`aria-disabled`, 60 % opacity but still ≥ 3:1 for the outline), loading (inline spinner, label retained, `aria-busy`).
- **Field:** visible `<label>` above the input (no placeholder-only labels), `--border-control` border, 16 px text on coarse pointers, helper text and error text linked with `aria-describedby`; invalid state = red-toned border **plus** an icon and text message, `aria-invalid="true"`. One style for all text fields (including task and note creators).
- **Chip:** same height as buttons, toggle semantics via `aria-pressed`, selected = fill + check glyph.

### 6.7 Dialog primitive

One shared helper (`src/utils/dialog.ts`) provides: focus trap, inert background (`inert` on siblings), initial focus (first invalid field > first field > primary action; Cancel for destructive confirms), `Escape` and backdrop dismissal (guarded by the unsaved-changes check), focus restore to the invoking element, `aria-labelledby`/`aria-describedby`, `role="dialog"` or `role="alertdialog"` for confirms, scroll lock with `overscroll-behavior: contain`, bottom-sheet variant, and a `<form>` wrapper so Enter submits and Cmd/Ctrl+Enter saves multi-line forms. Errors render at the **top** of the dialog and next to the field, focus moves to the first invalid field, and the status region is `role="alert"`.

### 6.8 Menus and popovers

One shared helper provides `role="menu"` semantics only where arrow-key behaviour is implemented: roving tabindex, Arrow/Home/End, type-ahead, Esc closes and restores focus to the trigger, Tab closes, viewport-clamped positioning (flips above/left near edges), `aria-haspopup`/`aria-expanded` on the trigger, `menuitemradio`/`menuitemcheckbox` for stateful items, and `role="separator"` for dividers. Menu items are ≥ 44 px tall on coarse pointers. On compact phones, menus open as bottom sheets.

### 6.9 Status chip (sync / offline)

A single header chip replaces the colour-only dot. It always shows an icon **and** text: "Saved on this device", "Syncing…", "Synced 2 min ago", "Offline — changes saved locally", "Sync failed — Retry". It is a `role="status"` region (polite) that announces state changes, never repeats unchanged state, and is a button that opens sync details when actionable. When Background Sync is available, queued pushes are described ("1 change waiting to sync").

### 6.10 Toasts

Container sits above the tab bar and safe area, `--z-toast`. Variants (info · success · warning · error) each have an icon and a left accent bar; colour is never the only cue. Behaviour:

| Aspect          | Rule                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Duration        | Info/success 5 s; warning 8 s; **error persists** until dismissed                                  |
| Pause           | Timer pauses on hover, focus-within and while the document is hidden                               |
| Controls        | Dismiss (×, ≥ 44 px) on every toast; optional action button (e.g. **Undo**, **Retry**, **Reload**) |
| Semantics       | `role="status"` for info/success, `role="alert"` for error/warning                                 |
| Dedupe          | Toasts carry a `key`; an identical active toast refreshes instead of stacking; max 3 visible       |
| Mirror fallback | "Primary URL unreachable. Routed to mirror: <hostname>" (info, 8 s)                                |

### 6.11 Empty, loading and error states

- **Skeleton:** until IndexedDB hydrates, render the app frame with neutral skeleton tiles (no blank screen).
- **Empty:** a heading, one explanatory sentence and a primary button — never a bare sentence. Copy in §8.
- **Error boundary:** if bootstrap fails, show a full-page message with a Reload button and an Export-data link; never a blank page.
- **Busy:** operations over 300 ms show inline progress ("Opening…", "Testing connection…") and always resolve to success or an error message — no state may stick.

### 6.12 Settings

Grouped sections with headings and a sticky in-dialog section navigation on tablet+: **General** (theme, default search engine, keyboard shortcuts on/off), **Sync** (GitHub), **Notifications & reminders**, **Security** (app lock), **Data** (export, import with preview, storage status, **Recently deleted**), **Install & updates**, **Advanced** (disclosure: VAPID key, gamepad). Each section saves with its own clearly scoped button, or auto-saves with an inline "Saved" confirmation — never one ambiguous Save for everything. The token field is accompanied by help text ("Needs _Contents: read & write_ on the sync repository only. Hub stores it encrypted on this device.") and a link to a short guide; the field never displays the saved value (shows "Token saved" with Replace / Remove). The lock "toggle" is a real switch bound to state, not a disabled checkbox.

---

## 7. First Run & Onboarding

The first load must not be an empty page. It shows a single welcome card (dismissible, `onboarding_completed` persisted in `AppConfig`) over the empty launchpad:

```
┌──────────────────────────────────────────┐
│  Welcome to Hub                          │
│  Your links, tasks and notes — saved on  │
│  this device, available offline.         │
│                                          │
│  [ Add your first link ]  (primary)      │
│  [ Import links ]        [ Connect sync ]│
│  [ Try a sample set ]                    │
│                                          │
│  Tip: Install Hub for one-tap access.    │
│  [ How to install ]            [ Skip ]  │
└──────────────────────────────────────────┘
```

- **Sample set:** a small, clearly-labelled "Sample links" category; removing the category removes the samples in one action. No samples are ever seeded silently.
- **Contextual tips** appear once, in place, when relevant: long-press/"⋯" for mirrors, `/` for search (fine pointers only), swipe/drag for tasks, "Install" after the second visit.
- The auto-created category name is **"Links"** (user-renamable); category rename/reorder/delete lives in the bookmark editor and a "Manage categories" action.
- **Install guidance:** Chromium shows an in-app Install button (from `beforeinstallprompt`) in Settings and as a dismissible card; iOS shows a step sheet ("Tap Share → Add to Home Screen"). The prompt never appears on the first visit, and dismissal is remembered (`install_prompt_dismissed_at`).

---

## 8. Content Design

Voice: calm, concise, second person, sentence case. Say what happened and what to do next; no jargon in primary UI (put PAT/VAPID/SHA in Advanced).

| Context                       | Copy                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| Empty bookmarks               | **Nothing here yet.** "Add your first link, or import your bookmarks." [Add link] [Import]    |
| Empty tasks                   | **All clear.** "Add a task to track what matters today." [Add task]                           |
| Empty notes                   | **No notes yet.** "Jot something down or paste text to keep for later." [New note]            |
| No search matches             | "No saved links match “<q>”." Row: "Search <engine> for “<q>”"                                |
| Undo delete                   | "Task deleted." [Undo]                                                                        |
| Mirror fallback               | "Primary URL unreachable. Routed to mirror: <hostname>"                                       |
| Offline                       | "You're offline. Changes are saved on this device."                                           |
| Sync failed                   | "Couldn't sync. Your data is safe on this device." [Retry]                                    |
| Update ready                  | "A new version of Hub is ready." [Reload]                                                     |
| Offline ready (first install) | "Ready to work offline." (info, once, after the shell is fully precached)                     |
| Storage not persistent        | "Your browser may clear Hub's data when space is low. [Protect my data]"                      |
| Empty submit                  | "Add a title to save this task." (inline, focus moves to the field)                           |
| Import                        | "Import 42 links, 7 tasks, 3 notes? This will replace data on this device." [Cancel] [Import] |

Error messages state the cause when known (invalid file, permission denied, image too large) rather than "something went wrong". Destructive confirmations name the item ("Delete profile “Work”? Its links, tasks and notes will be removed.").

---

## 9. Destructive Action Policy

| Action                        | Pattern                                                                                                                                        | Notes                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete bookmark / task / note | **Undo toast** (soft-delete already in the data model)                                                                                         | 8 s undo window; no modal                                                                                                                         |
| Delete category (non-empty)   | Confirm naming the item count + Undo                                                                                                           | Items move to "Links" unless the user chooses delete-all                                                                                          |
| Delete profile                | **Confirm dialog** (danger button; Cancel focused) naming what will be deleted, then an **Undo toast**; blocked for the last remaining profile | Soft-deletes the profile **and its items together**; recoverable for 30 days from Settings → Data → Recently deleted (§9.1). Not adjacent to Save |
| Import JSON                   | Preview counts + confirm; offers to download a backup first                                                                                    | Never overwrites silently                                                                                                                         |
| Discard edits                 | Unsaved-changes guard on Esc/backdrop/Close when the form is dirty                                                                             | "Discard changes?" [Keep editing] [Discard]                                                                                                       |
| Disable app lock              | Re-authenticate if supported                                                                                                                   |                                                                                                                                                   |
| Initialize remote file        | Existing explicit confirm (PRD §5.4)                                                                                                           |                                                                                                                                                   |

### 9.1 Profile deletion and "Recently deleted" (decided)

Deleting a profile is a **soft delete of the profile and everything in it, as one operation**, recoverable for 30 days.

1. **Confirm dialog** (alertdialog, Cancel focused, danger button) states the consequence with counts: "Delete profile “Work”? Its 14 links, 3 tasks and 2 notes will be removed. You can restore it from Settings → Data → Recently deleted for 30 days."
2. On confirm, Hub tombstones the profile and all its categories, bookmarks, tasks and notes with one shared timestamp (`SCHEMAS.md` §5.4), shows an **Undo toast** (8 s), and switches the active profile to the first remaining one. The last remaining profile cannot be deleted (the button is disabled with an explanatory hint).
3. **Settings → Data → Recently deleted** lists deleted profiles (with item counts and "deleted N days ago / permanently removed in M days") with **Restore** and **Delete now** (confirm). It also lists individually deleted bookmarks, tasks and notes still inside the 30-day window, with Restore.
4. After 30 days the existing tombstone cull permanently removes them (`SCHEMAS.md` §5.3). The deletion syncs to other devices as tombstones; a restore syncs back because it carries a newer `updated_at`.

---

## 10. Theming

- Theme options: Auto · Light · Dark (+ per-profile override). The effective theme sets `data-theme`, `color-scheme` and both `theme-color` metas immediately, before first paint, from a tiny external boot script/stylesheet (no inline styles) to avoid a flash of the wrong theme.
- Manifest `theme_color` is `#faf7f2` and `background_color` is `#faf7f2` (light), matching the light meta. Splash/launch background in dark OS mode is covered by `theme-color` media metas and iOS splash images.
- The brand accent in manifests, `mask-icon` and iOS status bar is terracotta `#b04a2e` / app background `#faf7f2` — not the legacy slate.

---

## 11. Iconography & Imagery

- All icons are local inline SVG built by `src/utils/dom.ts#svg()`. The helper must be extended to accept **multi-path** and stroke-based icons (an array of `d` strings plus optional `stroke`); icons use `currentColor`, are `aria-hidden`/`focusable="false"`, and are sized by CSS (24 px default, 20 px dense).
- Required icon set: bookmarks, tasks, notes, add, more (⋯), search, settings, pin, copy, delete, undo, drag handle, check, chevron, offline, sync, error, install, share.
- **PWA assets** (all local): icons 48/72/96/144/192/256/384/512 (`any`), maskable 192/512, a monochrome 512 (`purpose: monochrome`), SVG icon, 180 px `apple-touch-icon`, iOS splash images for common device sizes (light/dark), 2+ screenshots (`form_factor: narrow` and `wide`), and a distinct icon per app shortcut.

---

## 12. Internationalisation

- All user-visible strings come from a catalogue (`src/utils/i18n.ts`); no concatenated sentences — use parameterised messages and a plural helper. `lang` and `dir` are set on `<html>`.
- CSS uses **logical properties** (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`, `border-inline-*`); the drawer layout mirrors under `dir="rtl"`; icons that imply direction flip.
- Dates and times use `Intl` with the user locale (and 12/24-hour preference); never print the raw stored `HH:MM`. "Today"/"Tomorrow" are computed on the **local** calendar.
- Initials use grapheme-safe extraction. Layouts tolerate 200 % text size and +40 % string expansion (no fixed-width labels, `min-width` rather than `width`).

---

## 13. Component Inventory (current anatomy retained)

The following remain from v1 and are refined by the sections above: drawers (340 px, 200 ms slide; pinned shifts the grid without horizontal jump), note cards (pastel, auto light/dark contrast), tasks (Google Tasks pattern: inline creator, nested subtasks, completed accordion), notes (Google Keep pattern: quick capture, Pinned/Others), centred brand + search pill (`/` focuses the pill and selects text; ignored in inputs, modals and when locked), and the bookmark editor/profile editor/settings dialogs (rebuilt on the dialog primitive).

---

## 14. Acceptance Checklist (design)

- [ ] Every text pair in §2.3 passes; `scripts/contrast.mjs` is green in CI.
- [ ] No interactive element has a hit area < 44 px on a coarse pointer (automated Playwright/axe target-size check + manual).
- [ ] No control is visible only on hover; all actions are reachable by touch, keyboard and screen reader.
- [ ] Layouts verified at 320, 360, 390, 430, 568×320 landscape, 744, 820, 1024, 1280, 1440, 1920 and 2560 px, plus a spanned foldable emulation.
- [ ] Safe areas respected with `viewport-fit=cover` on a notched iPhone in standalone mode; no content under the home indicator.
- [ ] Forced-colors, `prefers-contrast: more`, `prefers-reduced-motion` and 200 % text/zoom reviewed.
- [ ] Destructive actions follow §9; first run follows §7; copy follows §8.
- [ ] No third-party network requests; no inline styles or `innerHTML` with user content.
