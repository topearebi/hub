# Technical Specification & Product Requirements Document (PRD)

**Project Name:** Hub

**Document Version:** 1.1.0

**Target Release:** v1.0 (PWA & Static Deploy) — production-readiness revision

**Status:** Approved — production-readiness revision (implementation tracked in [`plans/production-readiness.md`](plans/production-readiness.md))

**Intended Audience:** Autonomous AI Coding Agents, Software Engineers, Systems Architects

**Companion specs:** [`DESIGN.md`](DESIGN.md) v2.0 (visual and interaction design — single source of truth for tokens and layout), [`docs/accessibility.md`](docs/accessibility.md) (WCAG 2.2 AA conformance), [`docs/spec-checklist.md`](docs/spec-checklist.md) (pre-implementation checklist; applies to every change to this document), [`SCHEMAS.md`](SCHEMAS.md) (data contracts), [`AGENTS.md`](AGENTS.md) (agent rules).

**Revision note (1.1.0):** Hub is now specified as a **mobile-first** product for quick access to key information on the go. The IP/location/weather telemetry is removed. Requirements for touch parity, accessibility, safety (undo), onboarding, offline status, install/update and storage durability were added (§2, §3, §5.5–5.9, §6, §8, Appendix A).

---

## 1. Executive Summary & Vision

### 1.1 Problem Statement

Modern multi-device and multi-browser workflows create severe fragmentation of personal daily context. Browser-native sync engines lock users into vendor ecosystems (Google, Apple, Mozilla), rely on opaque cloud backends, and lack cohesive workspaces integrating quick launch links, transient daily tasks, and scratchpad buffers.

### 1.2 Vision & Core Value Proposition

**Hub** is a zero-telemetry, local-first browser launchpad and Progressive Web Application (PWA). It acts as an adaptable home base providing seamless continuity of links, daily priorities, and scratchpad notes across any device, browser, or operating system. Data sovereignty is prioritized through a Bring-Your-Own-Storage (BYOS) model using standard file payloads, decoupling the application completely from proprietary hosting providers.

"Zero-telemetry" is a testable promise: **Hub makes no network requests other than same-origin asset requests and, only when the user has configured sync, requests to `api.github.com`.** No analytics, no IP/location/weather lookups, no third-party fonts, icons or scripts.

### 1.3 Primary Use Case & Design Targets

The primary scenario is **quick access to key information on the go**: a person on a phone, often one-handed, sometimes offline, who needs to open a saved link, check what is due today, or retrieve a pasted snippet within seconds. Consequences:

- **Mobile is the primary design target** (390 × 844 portrait first); desktop adds density, shortcuts and persistent panes but owns no function that touch lacks.
- **Installed-app behaviour is first-class:** Hub must feel native when added to the home screen (standalone display, safe areas, themed system bars, app shortcuts, share target, badge) and must launch and operate fully offline after a single online visit.
- **Glanceability:** the launchpad shows Recently Used links first; open-task count is visible on the tab bar and app badge; nothing requires sign-in or setup before use.
- **Durability:** user data must survive storage pressure (persistent storage requested) and updates (user-controlled update flow).
- **Accessibility and inclusivity:** WCAG 2.2 AA, every function reachable by touch, keyboard and assistive technology.

---

## 2. Scope Boundaries

### 2.1 In-Scope (Phase 1 Build Target)

- **Progressive Web App (PWA):** Fully responsive, installable desktop/mobile web app deployable statically via GitHub Pages, static hosting buckets, or local Nginx/Caddy servers.
- **Local-First Core:** Complete client-side functionality using browser `IndexedDB`. Zero cloud dependencies required for 100% operation.
- **Unified Omnibar:** Instant-focus central search bar routing between local bookmark fuzzy matches, direct URL navigation, and external search engines.
- **Dynamic Tri-Pane Interface:** Centered launchpad with dual collapsible and pinnable drawers (Tasks on left, Notes on right), collapsing into bottom navigation tabs on mobile viewports.
- **Multi-URL Bookmarking:** Support for alternative and mirror URLs with automated health-check fallback and non-intrusive UI toast notifications.
- **Plain-Text Scratchpad:** Rapid-capture pastebin supporting arbitrary Markdown syntax without rendering parser bloat.
- **BYOS Sync Adapter (GitHub REST API):** Non-destructive fine-grained entity synchronization against a private or public repository file via Personal Access Tokens (PAT).
- **Air-Gapped Data Portability:** Manual JSON import/export mechanisms bypassing network layers.
- **Production-Readiness Requirements (v1.1):**
  - Touch parity: every action reachable without hover, right-click or drag (§5.5).
  - Accessibility conformance to WCAG 2.2 AA (`docs/accessibility.md`).
  - Safety UX: undo for deletes, confirmations for irreversible actions, unsaved-changes guards (§5.6).
  - First-run onboarding with optional sample data and guided empty states (§5.7).
  - Connectivity and sync status model, queued sync (§5.8).
  - Install and update lifecycle, storage persistence, complete manifest and standalone metadata (§5.9).
  - A documented path to use Hub as the browser homepage / new tab (`docs/homepage.md`).
  - Internationalisation readiness (string catalogue, RTL, locale formats).
  - Content-Security-Policy and escaped dynamic values.

### 2.2 Out-of-Scope (Deferred to v2+)

- **Removed from the product (v1.1):** environment telemetry (client IP, location label and weather via `ipwho.is` / Open-Meteo), its header badge, and its local cache. Rationale: contradicts the air-gapped promise, exposes the user's IP on screen, and adds third-party requests.
- Browser Extension manifest wrappers (`newtab` override via Chromium/Firefox extension stores). A user guide for setting the installed PWA/URL as homepage is in scope; an MV3 extension is v2.
- Multi-user tenancy or proprietary OAuth account logins.
- Bi-directional synchronization with external issue trackers or productivity suites (CalDAV, Todoist, Google Tasks).
- Rich Markdown WYSIWYG editing, canvas elements, or image attachment rendering.
- Automated real-time WebSocket or WebRTC peer-to-peer sync protocols.

---

## 3. System Architecture & Technical Constraints

### 3.1 Technology Stack & Runtime Bounds

- **Build Toolchain:** Vite + TypeScript (Strict Mode).
- **Package Manager:** `npm`.
- **Runtime Dependencies:** Zero. No external UI frameworks (No React, Vue, or Svelte) and no runtime libraries. Pure Vanilla DOM manipulation with TypeScript classes and reactive state stores.
- **Build-time (dev) Dependencies:** Permitted when they only produce static build output or run in CI (for example a service-worker precache generator such as `vite-plugin-pwa`, or Lighthouse CI / axe-core as test tools). Each must be recorded with a rationale in the PR, must not add runtime code to the app shell beyond the generated worker/manifest, and must not breach the bundle budget.
- **Styling Layer:** Vanilla CSS utilizing native CSS Custom Properties (Variables) and CSS Grid / Flexbox / Container Queries. No Tailwind, Sass, or CSS-in-JS runtimes. Token definitions are owned by `DESIGN.md` §2.
- **Performance Budget (measured on a mid-tier Android phone profile, 4× CPU throttle, Fast 3G for the first load):**
- Maximum initial production bundle: `< 60 KB` gzipped (JS + CSS).
- First Contentful Paint (FCP): `< 50ms` from local cache (repeat visit); `< 1.8 s` first visit.
- Largest Contentful Paint (LCP): `< 2.5 s` first visit, `< 1 s` repeat visit.
- Time to Interactive (TTI): `< 100ms` repeat visit on mid-tier mobile hardware; Interaction to Next Paint (INP) `< 200 ms`; Cumulative Layout Shift `< 0.1`.
- Omnibar filtering: `< 10 ms` per keystroke for up to 1,000 bookmarks.
- **Security Baseline:**
- A `<meta http-equiv="Content-Security-Policy">` restricts `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data: blob: https:`, `connect-src 'self' https://api.github.com`, `worker-src 'self'`, `manifest-src 'self'`, `base-uri 'self'`, `form-action 'self'`. (GitHub Pages cannot send response headers, so the meta tag is the mechanism; `frame-ancestors` is unavailable in a meta tag.) `img-src https:` exists only because users may supply their own bookmark icon URLs; Hub never calls a third-party favicon service, and icon URLs render only via `<img>` with `referrerpolicy="no-referrer"`, falling back to a local letter tile on error.
- Dynamic values interpolated into CSS are escaped/validated (no unescaped `url("…")`).
- The GitHub token is local-only, never logged, never exported and never synced. It is **encrypted at rest** with a non-extractable WebCrypto (AES-GCM) key, not tied to app lock so unattended sync keeps working; Settings recommends a fine-grained token scoped to the single sync repository. The threat model and the approved storage shape are in `SCHEMAS.md` §3.5.

### 3.2 Storage & State Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                       Browser Runtime                       │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                      Hub UI                         │   │
│   │  (Omnibar / Bookmarks Grid / Tasks / Scratchpad)    │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │ Dispatches Mutations         │
│                              ▼                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                  State Store (RAM)                  │   │
│   └──────────────┬───────────────────────▲──────────────┘   │
│                  │ Async Cache           │ Rehydrate        │
│                  ▼                       │                  │
│   ┌──────────────────────────────────────┴──────────────┐   │
│   │               IndexedDB (Local Engine)              │   │
│   │   • stores: entities, device_metrics, config        │   │
│   └──────────────┬───────────────────────▲──────────────┘   │
└──────────────────┼───────────────────────┼──────────────────┘
                   │ Debounced (3-5s)      │ Fetch on Load
                   ▼                       │
┌─────────────────────────────────────────────────────────────┐
│                BYOS Target: GitHub REST API                 │
│              Payload: `/.hub/data.json`                     │
└─────────────────────────────────────────────────────────────┘

```

1. **Rehydration:** On application boot, state hydrates synchronously from `IndexedDB` into memory. UI renders instantly.
2. **Mutation:** Any user mutation immediately updates in-memory state and writes asynchronously to `IndexedDB`.
3. **Sync Trigger:** If remote sync is configured, changes trigger a debounced timer (3,000ms–5,000ms). All pending mutations batch into a single network commit.
4. **Lifecycle Hooks:** Window focus (`window.addEventListener('focus', ...)`) and PWA visibility change (`visibilitychange`) trigger background fetches against the remote file hash (`sha`) to detect remote updates.

---

## 4. Data Models & Sync Protocol

### 4.1 TypeScript Interfaces (`src/types/schemas.ts`)

> Informational excerpt. [`SCHEMAS.md`](SCHEMAS.md) is the authoritative data contract (payload `version: 2`, profiles, `profile_id` partitioning, local-only `AppConfig`); where this excerpt differs, `SCHEMAS.md` wins.

```typescript
export interface HubStoragePayload {
  version: 1;
  last_synced_at: number; // Unix epoch ms
  bookmarks: BookmarkItem[];
  categories: CategoryItem[];
  tasks: TaskItem[];
  notes: NoteItem[];
}

export interface SyncableEntity {
  id: string; // UUID v4
  created_at: number; // Unix epoch ms
  updated_at: number; // Unix epoch ms
  is_deleted?: boolean; // Soft-delete tombstone
}

export interface BookmarkItem extends SyncableEntity {
  title: string;
  url: string; // Primary URL
  alternate_urls?: string[]; // Fallbacks/mirrors/LAN targets
  category_id: string;
  icon?: string; // Custom URL or blank for auto-favicons
  hotkey?: string; // Assigned number '1'-'9' (triggered by the chord `g` then #, or optionally Alt + #)
}

export interface CategoryItem extends SyncableEntity {
  name: string;
  order: number;
}

export interface TaskItem extends SyncableEntity {
  title: string;
  description?: string;
  completed: boolean;
  completed_at?: number | null;
}

export interface NoteItem extends SyncableEntity {
  title: string;
  content: string; // Unparsed raw plain-text / Markdown
  color_tag?: string; // Hex code or warm theme token
}

export interface SearchProvider {
  id: string;
  name: string;
  query_url: string; // Template containing '%s' (e.g., "https://duckduckgo.com/?q=%s")
  is_default: boolean;
}

export interface AppConfig {
  sync_enabled: boolean;
  github_pat?: string;
  github_owner?: string;
  github_repo?: string;
  github_branch?: string;
  github_file_path?: string;
  search_providers: SearchProvider[];
  theme: 'auto' | 'light' | 'dark';
  pinned_drawers: {
    tasks: boolean;
    notes: boolean;
  };
}

// Local-only metrics; strictly excluded from remote synchronisation
export interface DeviceMetrics {
  bookmark_id: string;
  click_count: number;
  last_visited_at: number;
}
```

### 4.2 Non-Destructive Fine-Grained Merging Algorithm

When reconciling local state ($S_L$) with remote state ($S_R$):

```
For each entity collection C in [bookmarks, categories, tasks, notes]:
  Let MergedCollection = Map<ID, SyncableEntity>()

  For each entity E_local in C_local:
    MergedCollection.set(E_local.id, E_local)

  For each entity E_remote in C_remote:
    If NOT MergedCollection.has(E_remote.id):
      MergedCollection.set(E_remote.id, E_remote)
    Else:
      Let E_local = MergedCollection.get(E_remote.id)
      If E_remote.updated_at > E_local.updated_at:
        MergedCollection.set(E_remote.id, E_remote)
      Else:
        // Local state is newer or equal; keep local

  FinalCollection = Array.from(MergedCollection.values())

```

- **Deletions:** Handled via soft tombstones (`is_deleted: true`). An entity is never dropped from sync until its tombstone propagates past all client sync windows.
- **Device Isolation:** `DeviceMetrics` (`click_count`, `last_visited_at`) reside in a separate local IndexedDB table and are completely omitted from the payload committed to GitHub.

---

## 5. Functional Requirements & Interaction Flow

### 5.1 The Omnibar Search & Navigation Engine

1. **Focus State:** On devices with a fine pointer (mouse/trackpad), automatically grabs cursor focus upon application boot or new tab instantiation. On **coarse-pointer (touch) devices the omnibar is not auto-focused** (it would raise the on-screen keyboard over the content); tapping it focuses it. The `/` key focuses the omnibar and selects its text (ignored while typing, when a dialog is open, or when the app is locked).
2. **Key Bindings:**

- `Escape` (two-stage): first press closes the results list; second clears the query; third blurs the input.
- `ArrowDown` / `ArrowUp`: Navigates up and down through the results (wrapping), updating `aria-activedescendant`.
- `Enter`: Executes priority matching pipeline. With an empty query it does nothing visible but is not an error.
- `g` then `[1-9]` (primary, modifier-free chord, 1.5 s window) and the optional `Alt + [1-9]`: launch the bookmark mapped to that hotkey slot. `Alt+digit` is unreliable because browsers claim it (tab switching) and macOS types characters with it, hence the chord is primary (`DESIGN.md` §4.5). Single-key shortcuts can be turned off in Settings (WCAG 2.1.4; persisted in the approved `single_key_shortcuts_enabled` field, `SCHEMAS.md` §3.6). Hotkey hints are shown only on fine-pointer devices.
- The omnibar implements the ARIA combobox pattern (see `docs/accessibility.md` §4): labelled listbox, option ids, result-count announcement, close-on-blur. Results are capped at 8 rows with matched characters highlighted; hovering does not change the active row while the user is typing.

3. **Execution Pipeline (On `Enter`):**

- **Step 1: Internal Search.** Check query against local `BookmarkItem` records (fuzzy case-insensitive match against `title` and `url`). If matches exist and an item is selected, navigate immediately.
- **Step 2: Direct URL Detection.** Test if query is a navigable address: an explicit scheme (`http://`, `https://`), a dotted hostname with a TLD (including internationalised/IDN domains), an IPv4 or IPv6 literal, `localhost`, or a hostname with an explicit port (e.g. `localhost:3000`, `192.168.1.1`, `nas.local:8080/path`). `javascript:`, `data:` and `file:` schemes are never treated as URLs. If verified, navigate directly to URL. The same validator is used by the bookmark editor, so self-hosted and LAN addresses can be saved.
- **Step 3: External Search Engine.** Fallback to the configured default `SearchProvider` replacing `%s` with `encodeURIComponent(query)`.
- **Navigation Mandate:** All direct navigations execute within the active tab/window (`window.location.href = target`). No child popups or orphaned tabs are spawned.

### 5.2 Smart URL Fallback Mechanism

1. When a user activates a bookmark containing `alternate_urls`:
2. The runtime attempts navigation to the primary `url`.
3. If an async network pre-flight / fetch fails or triggers an error, the engine initiates a sequential traversal of `alternate_urls`.
4. Upon successfully selecting an alternate target, Hub dispatches a fixed bottom toast notification:

> _"Primary URL unreachable. Routed to mirror: [hostname]"_

5. Direct overrides can be accessed at any time via the bookmark tile's visible "⋯" menu button (always visible on touch devices), and also via right-click, long-press (500 ms) or the keyboard context-menu key / Shift+F10. The menu is the same in every case. (`contextmenu` is not fired by long-press on iOS Safari, so it must never be the only route.)
6. While the primary URL is being probed the tile shows a busy state ("Opening…", `aria-busy`); repeated activations are ignored until the probe resolves or times out (3 s).

### 5.3 Scratchpad Engine

- Operates strictly as a zero-friction, plain-text memory buffer and pastebin.
- Visual presentation utilizes sticky-card modules containing a title bar, copy-all action button, color-tag badge, and text area.
- Markdown formatting can be authored directly by the user, but the runtime does not execute HTML markdown parsing, ensuring total protection against XSS and zero bundle bloat.
- A single click on the "Copy" icon writes the raw payload directly to the clipboard via the `navigator.clipboard.writeText()` API.

### 5.4 Settings & Mutation Transparency

- Accessible via a persistent gear icon in the viewport header/footer.
- Contains explicit settings inputs: GitHub Token (Classic or Fine-Grained PAT), Repository Owner, Repository Name, Branch, and Custom Target File Path (defaults to `.hub/data.json`).
- **Connection Tester:** A manual button dispatches a read attempt to the GitHub API.
- If the file does not exist, a warning modal states:

> _"Target `.hub/data.json` not found in remote repository. Do you want Hub to initialize this file with your current local data?"_

- User must click "Confirm & Initialize" before Hub makes its first remote commit.

- Provides manual **Export JSON** and **Import JSON** file operations for air-gapped usage. Import shows a preview (counts of bookmarks, tasks, notes, profiles), offers to download a backup first, and requires explicit confirmation before replacing local data.
- Settings is organised into labelled sections (General, Sync, Notifications & reminders, Security, Data, Install & updates, Advanced) with section-scoped save semantics, inline validation, and a visible outcome for every asynchronous action (no state may remain stuck on "Testing…"). Expert fields (VAPID key, gamepad) live under "Advanced". See `DESIGN.md` §6.12.

### 5.5 Touch & Input Parity

1. **No hover-only functionality.** Any control revealed on hover (task actions, drag handle, note toolbar, tile actions) is permanently visible on `(hover: none)` / `(pointer: coarse)` devices or reachable through a persistent "⋯" affordance.
2. **Hit areas:** at least 44 × 44 CSS px on coarse pointers (24 px absolute floor on any pointer), with adequate spacing between adjacent targets.
3. **Pointer Events, not mouse events.** Interaction handlers use Pointer Events so mouse, touch and pen behave consistently. HTML5 drag-and-drop is replaced for task reordering/nesting; every drag has a non-drag alternative (Move up / Move down / Indent / Outdent).
4. **Long-press** (500 ms) is an accelerator for opening item menus, never the only path.
5. **Mobile keyboards:** URL, repo and token fields use the `type`/`inputmode`/`autocapitalize`/`autocorrect`/`enterkeyhint` attributes in `DESIGN.md` §4.3. Inputs are ≥ 16 px on coarse pointers (no focus zoom).
6. **Viewport:** full-height layouts use `dvh`; `viewport-fit=cover` with `env(safe-area-inset-*)` on fixed elements; dialogs reflow above the on-screen keyboard; scrollable panes use `overscroll-behavior: contain`.

### 5.6 Safety, Undo & Destructive Actions

1. Deleting a bookmark, task or note is **undoable** (toast with Undo, ≥ 8 s window) using the existing soft-delete tombstones; no blocking confirmation.
2. **Irreversible or data-wide actions require explicit confirmation:** delete profile (Cancel focused, danger-styled button, counts of what will be removed, blocked for the last remaining profile), import/replace data (with preview), disable app lock, initialise remote file.
3. **Unsaved changes are never discarded silently:** closing an editor (Esc, backdrop, Close) with unsaved edits asks "Discard changes?".
4. Destructive buttons are visually distinct (danger style) and not adjacent to the primary action without separation.
5. Errors persist until dismissed; every failing asynchronous operation reports a specific, actionable message.
6. The full policy table is `DESIGN.md` §9.
7. **Profile deletion (decided):** deleting a profile soft-deletes the profile **and its items together** (one shared timestamp), shows an Undo toast, and keeps everything recoverable for **30 days** from Settings → Data → Recently deleted (which also lists individually deleted items still inside the window). After 30 days the existing tombstone cull removes them. Semantics: `SCHEMAS.md` §5.4; UI: `DESIGN.md` §9.1.

### 5.7 First Run & Onboarding

1. First launch shows a dismissible welcome card with primary actions: **Add your first link**, **Import links**, **Connect sync**, **Try a sample set**. Completion is persisted (`AppConfig.onboarding_completed`).
2. Sample data is opt-in, created in a clearly named, removable "Sample links" category; nothing is seeded silently (preserves "Zero Hardcoded Bookmarks").
3. Contextual one-time tips teach long-press/"⋯" menus, hotkeys (fine pointers), task reorder, and install.
4. Users can create, rename, reorder and delete categories. The auto-created default category is named "Links".
5. Empty states contain a heading, one sentence, and a primary action (§6.3).
6. Until local data hydrates, a skeleton of the app frame is shown (no blank screen). A bootstrap failure shows a recovery screen with Reload and Export-data options.

### 5.8 Connectivity & Sync Status

1. A single header **status chip** (icon + text) reports: Saved on this device · Syncing… · Synced "N min ago" · Offline — changes saved locally · Sync failed — Retry. It is a polite live region and never relies on colour alone.
2. Sync stays event-driven (focus, visibility, debounced mutation; no polling). Failed pushes are queued and retried on reconnect (`online` event) and, where supported, via Background Sync.
3. All mutations, including **profile** edits, schedule a sync push when sync is enabled.
4. Offline operation requires no special mode: everything except GitHub sync works identically.

### 5.9 Install, Update & Durability

1. **Installability:** valid manifest with an absolute `id`, `display: standalone`, `display_override: ["window-controls-overlay", "standalone"]` with Window Controls Overlay **fully implemented** per `DESIGN.md` §3.1 (header as draggable title bar, `titlebar-area` insets, live `geometrychange` handling, graceful fallback), brand-matched `theme_color`/`background_color`, icons 48–512 (any + maskable + monochrome), a `narrow` and a `wide` screenshot, per-shortcut icons, `launch_handler: { client_mode: "focus-existing" }`, `note_taking`, and `file_handlers` for JSON import. iOS metadata: `apple-touch-icon` (180), `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`, `mobile-web-app-capable`, and splash images; `viewport-fit=cover`; `theme-color` metas for light/dark, updated from the in-app theme.
2. **Install UX:** a Settings install control and a dismissible card driven by `beforeinstallprompt`/`appinstalled` (never on the first visit; dismissal remembered via `AppConfig.install_prompt_dismissed_at`); an iOS "Share → Add to Home Screen" sheet; no install UI when already running standalone.
3. **Offline shell:** the service worker precaches the **entire built app shell** (hashed JS/CSS, HTML, icons, manifest) from a build-time manifest, so a single online visit guarantees offline launch. Navigations fall back to the cached shell only for valid HTML responses; manifest and icons use stale-while-revalidate; GitHub API requests are network-only and never cached.
4. **Update flow:** a new worker waits; Hub shows "A new version of Hub is ready — Reload"; `SKIP_WAITING` is sent only on user action; the page reloads once when an existing controller is replaced. The first installation’s initial controller claim does not reload the page. No unconditional `skipWaiting()`.
5. **Durability:** after first meaningful data entry (or install), call `navigator.storage.persist()`; record the result (`AppConfig.storage_persisted`); Settings → Data shows persistence state and quota estimate with a "Protect my data" action if not persistent, plus a prominent Export backup.
6. **Homepage/new tab:** `docs/homepage.md` documents setting Hub as the browser homepage/startup page and pinning the installed app; a browser-extension `newtab` override remains v2.
7. **Standalone navigation:** same-window navigation is retained (§5.1), with the system back gesture returning to Hub and the app logo Home action in the header.
8. **Native integrations (as supported):** badge with open-task count (also refreshed on resume), share target (text/URL), outbound Web Share on bookmarks and notes, reminders via local notifications and optional Web Push.

---

## 6. UI/UX Design System & Layout Specification

> **Single source of truth:** all design tokens, breakpoints, component anatomy and interaction rules live in [`DESIGN.md`](DESIGN.md) v2.0. This section states only the **product-level requirements**; it deliberately does not duplicate token values (the v1.0 copy had drifted from the shipped CSS and used superseded names).

### 6.1 Design Tokens & Theming

- Warm, low-strain light and dark palettes, selected automatically from `prefers-color-scheme` with an explicit Auto / Light / Dark override (global and per-profile). The effective theme also drives `color-scheme` and the `theme-color` meta values.
- All text meets **WCAG AA 4.5:1** and all control boundaries/focus indicators **3:1** in light, dark and `prefers-contrast: more` (`DESIGN.md` §2.3). A CI script verifies every token pair.
- Forced-colors and reduced-motion preferences are honoured (`DESIGN.md` §2.4, §2.7).
- Tokens are defined once (no triplicated dark blocks, no legacy aliases) and consumed via variables only — no raw colour, spacing or z-index literals in component CSS.

### 6.2 Viewport Layout (mobile-first)

Six tiers are defined in `DESIGN.md` §3. Product-level requirements:

- **Phone portrait (`< 768px`, primary target):** single pane, sticky omnibar at the top, fixed bottom tab bar `[ Tasks ] [ Bookmarks ] [ Notes ]` with icons, labels, an open-task count badge and `aria-current`. Safe areas respected; toasts and the status chip sit above the bar. Tab switches restore scroll position and move focus to the pane heading.
- **Phone landscape (short viewport):** the tab bar becomes a side rail; chrome is compacted so content is not squeezed.
- **Tablet (`768–1023px`):** drawers are overlays with a scrim (tap/Esc to close); pinning is disabled.
- **Laptop (`1024–1439px`):** one drawer may be pinned (two-column); two pinned drawers require `≥ 1280px`.
- **Wide (`≥ 1440px`):** content column up to 1200 px with a fluid tile grid; both drawers may be pinned (`var(--drawer-width) 1fr var(--drawer-width)`).
- **Foldable (spanned):** launchpad and active drawer occupy separate segments.
- Dialogs are bottom sheets on phones and centred cards from tablet up. Menus open as bottom sheets on phones.
- The system header carries brand/profile, status chip, settings and (tablet+) drawer toggles. **No telemetry badge.**

### 6.3 Empty, Loading & Error States

- **Zero Hardcoded Bookmarks:** first load contains no synthetic seeds; samples are opt-in (§5.7).
- Every container renders a heading, one sentence and a primary action when empty; copy is defined in `DESIGN.md` §8:
  - _Bookmarks:_ "Nothing here yet." / "Add your first link, or import your bookmarks."
  - _Tasks:_ "All clear." / "Add a task to track what matters today."
  - _Notes:_ "No notes yet." / "Jot something down or paste text to keep for later."
- These notices unmount as soon as the collection count exceeds zero.
- Loading shows a frame skeleton; failures show a recovery screen. Errors name the cause and the next step.

### 6.4 Internationalisation

- User-visible strings are served from a catalogue with parameterised messages and pluralisation; `lang`/`dir` follow the locale; CSS uses logical properties so RTL mirrors correctly; dates/times use `Intl` and the user's 12/24-hour preference; "today"/"tomorrow" use the local calendar.

---

## 7. Project Structure & Codebase Organization

The structure below reflects the repository after the production-readiness work (`★` = new in v1.1, `✗` = removed in v1.1).

```text
hub/
├── .github/
│   └── workflows/
│       ├── ci.yml                   # Quality gate (typecheck, lint, test, build, Lighthouse CI, size budget)
│       └── deploy.yml               # Static deployment to GitHub Pages (depends on the gate)
├── docs/
│   ├── accessibility.md             # ★ WCAG 2.2 AA conformance spec
│   └── homepage.md                  # ★ How to make Hub your homepage / new tab / pinned app
├── plans/                           # Phase plans; production-readiness.md is the active roadmap
├── public/
│   ├── apple-touch-icon.png         # 180×180
│   ├── icon*.png / icon.svg         # Full icon set incl. maskable + monochrome ★
│   ├── manifest.json                # PWA Web App Manifest
│   ├── screenshots/                 # ★ narrow + wide install screenshots
│   └── sw.js                        # Service worker (precache manifest injected at build ★)
├── scripts/
│   ├── generate-icons.mjs
│   └── contrast.mjs                 # ★ Token contrast verifier (CI)
├── src/
│   ├── core/
│   │   ├── db.ts                    # IndexedDB schema and operations
│   │   ├── sync.ts                  # GitHub REST client and entity merge logic
│   │   ├── store.ts                 # Central reactive state manager & event bus
│   │   ├── fallback.ts              # Alternate URL probe and resolution logic
│   │   ├── pwa.ts                   # Install/update lifecycle, badging, share parsing, storage persistence ★
│   │   ├── notifications.ts · gamepad.ts · lock.ts · image.ts
│   │   └── telemetry.ts             # ✗ removed
│   ├── components/
│   │   ├── omnibar.ts · bookmarks.ts · tasks.ts · notes.ts · drawer.ts
│   │   ├── bookmark-editor.ts · note-editor.ts · profile-editor.ts · profile-popover.ts
│   │   ├── settings.ts · share-target.ts · lock-screen.ts · header.ts · brand.ts
│   │   ├── status-chip.ts           # ★ sync/offline status
│   │   ├── onboarding.ts            # ★ first-run card + sample set
│   │   ├── toast.ts                 # Variants, undo/retry actions, persistence, dedupe
│   │   └── telemetry-badge.ts       # ✗ removed
│   ├── styles/
│   │   ├── tokens.css               # Tokens per DESIGN.md §2
│   │   ├── layout.css               # Responsive tiers per DESIGN.md §3
│   │   └── components.css           # Component styles
│   ├── types/
│   │   └── schemas.ts               # Strict transcription of SCHEMAS.md
│   ├── utils/
│   │   ├── dom.ts                   # DOM builders, multi-path SVG icon helper
│   │   ├── dialog.ts                # ★ Shared dialog primitive (trap/inert/restore/sheet)
│   │   ├── menu.ts                  # ★ Shared menu/popover primitive (roving focus, clamping)
│   │   ├── i18n.ts                  # ★ Message catalogue + plural/format helpers
│   │   ├── text.ts · crypto.ts
│   └── main.ts                      # Bootstrap, error boundary, SW registration
├── index.html                       # Static entry (viewport-fit=cover, CSP meta, themed metas)
├── package.json
├── tsconfig.json                    # Strict
└── vite.config.ts                   # base paths, static export, precache plugin ★
```

---

## 8. Implementation Verification & Test Matrix

Autonomous coding agents and engineers must satisfy this checklist prior to marking features complete. Every item is measurable; the owning roadmap phase is in brackets.

### 8.1 Functional Verification Checklist

- [ ] **Omnibar Navigation:** Entering a query matches local bookmarks. Selecting an item navigates in the same tab. Entering a valid URL — including `localhost:3000`, `192.168.1.1` and IDN domains — navigates directly. Fallback routes to the default search engine with query encoded. [1]
- [ ] **Hotkey Execution:** `Alt + 1…9` and `g` then `1…9` open the assigned link without triggering search bar numeric inputs; shortcuts are inert while typing, in dialogs and when locked. [3, 4]
- [ ] **Dual Drawer Pinning:** Pinned drawers persist their state to `AppConfig`. Layout reflows 1 → 2 → 3 columns per tier without horizontal scrollbar overflow. [7]
- [ ] **Mobile Responsiveness:** Viewports `< 768px` render the bottom tab bar (icons, labels, badge, `aria-current`) and one pane at a time with the omnibar visible; verified at 320, 360, 390, 430 px and landscape 568×320. [4, 7]
- [ ] **Health Check Fallbacks:** Bookmarks with alternative URLs detect failed endpoints, fall back, show the toast, and show a busy state during the probe. [5]
- [ ] **Sync Merging:** Simultaneous edits reconcile via fine-grained timestamp merging without losing either mutation, including **profile** edits. [6, existing]
- [ ] **Storage Transparency:** Testing the GitHub connection reports permissions and prompts before initialising `.hub/data.json`. [existing]
- [ ] **Zero Telemetry & Full Offline:** With the network disabled all CRUD works. Network traces (online, sync disabled) show only same-origin requests; (sync enabled) additionally only `api.github.com`. `grep -ri "ipwho\|open-meteo\|telemetry" src/` returns nothing. [9]

### 8.2 Touch, Mobile & Input

- [ ] No interactive element is smaller than 44 × 44 px under `pointer: coarse` emulation (24 px floor); automated bounding-box test passes. [4]
- [ ] No action is hover-only: every journey in `docs/accessibility.md` §7 is completed using touch only on iOS Safari and Android Chrome. [4]
- [ ] Bookmark edit/delete/mirror works on iOS without a context-menu event (visible "⋯" and long-press). [4]
- [ ] Inputs do not trigger iOS focus zoom; URL/repo/token fields show the correct keyboards and do not auto-capitalise. [2, 4]
- [ ] With the on-screen keyboard open, dialog action buttons remain visible; fixed bars do not overlap the notch/home indicator in standalone mode. [2, 7]

### 8.3 Accessibility

- [ ] axe-core: zero serious/critical violations on every primary view and dialog (light, dark, forced-colors). [11]
- [ ] Lighthouse Accessibility ≥ 95 (mobile profile). [11]
- [ ] Contrast script green (text ≥ 4.5:1, controls/focus ≥ 3:1) including `prefers-contrast: more`. [2]
- [ ] Dialogs trap and restore focus, set the background inert, and close on Esc; menus follow the keyboard contract. [3]
- [ ] Omnibar exposes `aria-activedescendant`, result counts and two-stage Escape. [3]
- [ ] Keyboard-only and screen-reader passes (VoiceOver iOS/macOS, TalkBack, NVDA) recorded in the roadmap baseline table. [11]

### 8.4 Safety & UX

- [ ] Deleting a bookmark/task/note shows an Undo toast that restores the item; profile delete cascades with Undo and 30-day recovery (`SCHEMAS.md` §5.4, `DESIGN.md` §9.1), import follows `DESIGN.md` §9; the last profile cannot be deleted. [5, 6]
- [ ] Closing a dirty editor prompts to discard; empty submits give inline feedback; errors persist and are dismissible. [5]
- [ ] First run shows the onboarding card; sample data is opt-in and removable in one action; no stuck "Testing…" states. [5, 6]
- [ ] Bootstrap failure shows a recovery screen; a skeleton shows while data hydrates. [5]

### 8.5 PWA, Offline & Update

- [ ] Lighthouse PWA category passes; manifest includes absolute `id`, maskable + monochrome icons, screenshots, shortcuts with icons, `launch_handler`, `note_taking`, `file_handlers`. [8]
- [ ] **Fresh-install airplane test:** install, immediately disable the network, relaunch: app shell loads and all core flows work. [8]
- [ ] **Two-build update test:** deploying a new build shows "A new version is ready"; the open page keeps working until the user reloads; no chunk 404s. [8]
- [ ] `navigator.storage.persist()` requested; state and quota shown in Settings; export backup is one tap away. [8]
- [ ] Install card/iOS sheet appears only after the first visit and respects dismissal. [8]
- [ ] Standalone window offers a way back to Hub after external navigation. [8]
- [ ] **Window Controls Overlay (installed desktop Chromium):** header content never overlaps the OS controls (controls on the right and on the left/macOS); the empty header area drags the window and keeps ≥ 48 px width when narrowed; all controls are `no-drag`; toggling the mode from the window chevron updates the layout live; popovers and sticky offsets use `--header-h`; browsers without WCO (and phones) are unaffected. [8]

### 8.6 Performance & Security

- [ ] Gzip initial JS + CSS `< 60 KB` (CI size budget). [11]
- [ ] Lighthouse mobile: Performance ≥ 90; LCP `< 2.5 s`, CLS `< 0.1`, INP `< 200 ms`. [11]
- [ ] Omnibar filtering `< 10 ms` for 1,000 bookmarks. [3]
- [ ] CSP meta present and the app functions with it; no inline scripts/styles; dynamic CSS values escaped. [1, 8]
- [ ] `DeviceMetrics` never appear in the remote payload; PAT never logged, exported or synced; PAT stored only as an `enc1:` envelope (legacy plaintext migrated on boot) and never re-displayed. [8, existing]

### 8.7 Quality Gates

- [ ] `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all exit 0 on every phase.
- [ ] New behaviour has unit tests (dialog, menu, toast actions, `todayIso`, `isUrlLike`, status chip, install/update lifecycle, import preview).

---

## Appendix A — Definition of Production-Ready (Release Criteria)

The v1.0 release may ship only when **all** are true:

1. Every Critical (C) and High (H) gap in `plans/production-readiness.md` §2 is closed or has a recorded, owner-approved waiver.
2. All of §8.1–§8.7 are checked and the evidence (reports, device matrix results) is linked from `plans/production-readiness.md` §6.
3. The real-device matrix (`plans/production-readiness.md` §5.3) has been executed on at least one iPhone, one Android phone, one tablet and desktop Chromium, including an assistive-technology pass.
4. Docs match the shipped code: `PRD.md`, `DESIGN.md`, `SCHEMAS.md`, `AGENTS.md`, `README.md` and `docs/*` contain no stale version, status, telemetry or token claims.
5. CI is green on `main`, the Pages deployment is verified in a fresh browser profile, and a rollback procedure (redeploy of the previous tag) is documented.
