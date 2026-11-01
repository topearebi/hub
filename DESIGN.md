# design.md — UI/UX & Visual Design Specification

## 1. Aesthetic Identity & Design System

- **Atmosphere:** Warm, low-contrast, minimal, distraction-free. Think iA Writer meets a modern browser start page.
- **Tone:** Soft editorial warmth (not sterile hospital white; not pure `#000000` pitch black).
- **Typography:** Clean system sans-serif hierarchy; monospace for hotkeys and badge tokens.

## 2. Design Tokens (CSS Variables)

```css
:root {
  /* Canvas & Surfaces */
  --bg-app: #faf7f2; /* Warm off-white page background */
  --bg-card: #ffffff; /* Pure card surface */
  --bg-subtle: #f2ede4; /* Inputs, active hovers, drawer backs */

  /* Borders & Dividers */
  --border-light: #e8e2d8;
  --border-focus: #c86d51; /* Accent glow */

  /* Text & Contrast */
  --text-main: #2c2825; /* Primary readability */
  --text-sub: #706b65; /* Labels, metadata */
  --text-faint: #a09890; /* Hotkey hints, empty states */

  /* Accents */
  --accent-terracotta: #c86d51;
  --accent-sage: #6b8e7d;
  --accent-amber: #d99b43;

  /* Spacing Scale */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* Radii & Shadows */
  --radius-card: 10px;
  --radius-input: 8px;
  --shadow-subtle: 0 1px 3px rgba(44, 40, 37, 0.05);
  --shadow-elevated: 0 4px 12px rgba(44, 40, 37, 0.08);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-app: #181716;
    --bg-card: #22201e;
    --bg-subtle: #2b2825;
    --border-light: #36322e;
    --text-main: #ede8e1;
    --text-sub: #ada59b;
    --text-faint: #736d66;
    --accent-terracotta: #e07a5f;
  }
}
```

## 3. Component Anatomy & Layout Constraints

### 3.1 Omnibar (Central Search)

- **Max Width:** `640px`, centered horizontally.
- **Height:** `48px` to `52px`.
- **Visuals:** Full rounded pill or `var(--radius-input)`, subtle border, no harsh shadows.
- **States:** Subtle warm ring on focus (`outline: 2px solid var(--border-focus)`).
- **Dropdown Matches:** Appears directly below the bar without pushing dashboard content down (`position: absolute; z-index: 50;`).

### 3.2 Bookmark Cards & Grids

- **Layout:** Dynamic grid (`grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px;`).
- **Tile:** Compact, square-ish or rounded rectangular card. Icon top-left or centered, title truncated at 2 lines.
- **Hotkey Badge:** Pinned to top-right corner in subtle monospace (`font-size: 11px; color: var(--text-faint);`).

### 3.3 Drawers (Tasks & Scratchpad)

- **Width:** Fixed `340px`.
- **State Management:**
- When unpinned: Overlay on top of the dashboard with a backdrop blur.
- When pinned: Shifts grid to `340px 1fr 340px` smoothly without horizontal page jumping.

- **Divider:** Clean `1px solid var(--border-light)` border; zero drop-shadow bleed.

### 3.4 Notes / Scratchpad Cards

- Styled like flat index cards or sticky notes using `--bg-card` and an optional vertical color border on the left (`border-left: 3px solid var(--accent-sage);`).

### 3.5 System Header (Edge-to-Edge)

- **Layout:** full-width bar pinned to the top of the viewport, `1px` bottom
  border (`--border-light`), background `--bg-app`. Two clusters:
  - **Left:** environment telemetry — client IP, location label, and weather
    with temperature. Muted `--text-sub`; a single "Offline" badge when
    telemetry is unavailable.
  - **Right:** sync status dot, drawer toggles, and the active-profile control
    (avatar + name) which opens the profile popover.
- **Profile popover:** anchored beneath the profile control; lists profiles for
  quick switching plus Add profile / Profile settings / App settings.

### 3.6 Centered Brand & Search Pill

- **Brand:** centered above the search pill. Renders the profile's custom logo
  (`max-height: 72px`) when set, otherwise the custom Hub title in prominent
  type (`clamp(2rem, 6vw, 3.5rem)`), otherwise "Hub".
- **Search pill:** centered, `52px` tall, full pill radius, subtle border and
  shadow; warm focus ring on focus. An inline search-engine selector sits on the
  left; the input fills the middle; an `Enter` hint sits on the right.
- **Hotkey:** pressing `/` focuses the pill and selects existing text. Ignored
  while typing in an input/textarea/select or when a modal is open.
