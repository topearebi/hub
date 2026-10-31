# Technical Specification & Product Requirements Document (PRD)

**Project Name:** Hub

**Document Version:** 1.0.0

**Target Release:** v1.0 (PWA & Static Deploy)

**Status:** Approved for Implementation

**Intended Audience:** Autonomous AI Coding Agents, Software Engineers, Systems Architects

---

## 1. Executive Summary & Vision

### 1.1 Problem Statement

Modern multi-device and multi-browser workflows create severe fragmentation of personal daily context. Browser-native sync engines lock users into vendor ecosystems (Google, Apple, Mozilla), rely on opaque cloud backends, and lack cohesive workspaces integrating quick launch links, transient daily tasks, and scratchpad buffers.

### 1.2 Vision & Core Value Proposition

**Hub** is a zero-telemetry, local-first browser launchpad and Progressive Web Application (PWA). It acts as an adaptable home base providing seamless continuity of links, daily priorities, and scratchpad notes across any device, browser, or operating system. Data sovereignty is prioritized through a Bring-Your-Own-Storage (BYOS) model using standard file payloads, decoupling the application completely from proprietary hosting providers.

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

### 2.2 Out-of-Scope (Deferred to v2+)

- Browser Extension manifest wrappers (`newtab` override via Chromium/Firefox extension stores).
- Multi-user tenancy or proprietary OAuth account logins.
- Bi-directional synchronization with external issue trackers or productivity suites (CalDAV, Todoist, Google Tasks).
- Rich Markdown WYSIWYG editing, canvas elements, or image attachment rendering.
- Automated real-time WebSocket or WebRTC peer-to-peer sync protocols.

---

## 3. System Architecture & Technical Constraints

### 3.1 Technology Stack & Runtime Bounds

- **Build Toolchain:** Vite + TypeScript (Strict Mode).
- **Package Manager:** `npm`.
- **Runtime Dependencies:** Zero external UI frameworks (No React, Vue, or Svelte). Pure Vanilla DOM manipulation with TypeScript classes and reactive state stores.
- **Styling Layer:** Vanilla CSS utilizing native CSS Custom Properties (Variables) and CSS Grid / Flexbox. No Tailwind, Sass, or CSS-in-JS runtimes.
- **Performance Budget:**
- Maximum initial production bundle: `< 60 KB` gzipped (JS + CSS).
- First Contentful Paint (FCP): `< 50ms` from local cache.
- Time to Interactive (TTI): `< 100ms` on mid-tier mobile hardware.

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

### 4.1 TypeScript Interfaces (`src/types/index.ts`)

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
  hotkey?: string; // Assigned number '1'-'9' (triggers Alt + #)
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

1. **Focus State:** Automatically grabs cursor focus upon application boot or new tab instantiation.
2. **Key Bindings:**

- `Escape`: Clears query, clears search matches, and blurs input.
- `ArrowDown` / `ArrowUp`: Navigates up and down through bookmark search matches.
- `Enter`: Executes priority matching pipeline.
- `Alt + [1-9]`: Launches the bookmark mapped to that specific hotkey slot.

3. **Execution Pipeline (On `Enter`):**

- **Step 1: Internal Search.** Check query against local `BookmarkItem` records (fuzzy case-insensitive match against `title` and `url`). If matches exist and an item is selected, navigate immediately.
- **Step 2: Direct URL Detection.** Test if query matches URL pattern (starts with `http://`, `https://`, or matches common TLD regex `^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\S*)?$`). If verified, navigate directly to URL.
- **Step 3: External Search Engine.** Fallback to the configured default `SearchProvider` replacing `%s` with `encodeURIComponent(query)`.
- **Navigation Mandate:** All direct navigations execute within the active tab/window (`window.location.href = target`). No child popups or orphaned tabs are spawned.

### 5.2 Smart URL Fallback Mechanism

1. When a user activates a bookmark containing `alternate_urls`:
2. The runtime attempts navigation to the primary `url`.
3. If an async network pre-flight / fetch fails or triggers an error, the engine initiates a sequential traversal of `alternate_urls`.
4. Upon successfully selecting an alternate target, Hub dispatches a fixed bottom toast notification:

> _"Primary URL unreachable. Routed to mirror: [hostname]"_

5. Direct overrides can be accessed at any time via context menu (right click / long press) on the bookmark tile.

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

- Provides manual **Export JSON** and **Import JSON** file operations for air-gapped usage.

---

## 6. UI/UX Design System & Layout Specification

### 6.1 Design Tokens & Theming (`src/styles/tokens.css`)

Visual styling utilizes a warm, ergonomic palette designed for long sessions and eye-strain reduction:

```css
:root {
  /* Warm Light Mode Defaults */
  --bg-primary: #faf7f2;
  --bg-surface: #ffffff;
  --bg-surface-elevated: #f2ede4;
  --border-subtle: #e8e2d8;
  --border-active: #d4cabe;
  --text-primary: #2c2825;
  --text-secondary: #706b65;
  --text-muted: #a09890;
  --accent-warm: #c86d51; /* Warm Terracotta */
  --accent-sage: #6b8e7d; /* Subdued Sage */
  --accent-amber: #d99b43; /* Ochre */
  --font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --drawer-width: 340px;
  --transition-speed: 200ms;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Warm Charcoal / Low-Strain Dark Mode */
    --bg-primary: #181716;
    --bg-surface: #22201e;
    --bg-surface-elevated: #2b2825;
    --border-subtle: #36322e;
    --border-active: #4a453f;
    --text-primary: #ede8e1;
    --text-secondary: #ada59b;
    --text-muted: #736d66;
    --accent-warm: #e07a5f;
    --accent-sage: #81a492;
    --accent-amber: #e5a955;
  }
}

[data-theme='light'] {
  /* Explicit Light Overrides */
}
[data-theme='dark'] {
  /* Explicit Dark Overrides */
}
```

### 6.2 Viewport Layout Breakpoints

#### Desktop Viewport (`min-width: 1024px`)

- **Default State:** Centered search omnibar (max-width `680px`) floating above a categorized responsive grid of bookmark tiles. Side drawers are closed.
- **Drawer Behavior:**
- **Tasks Drawer:** Slides in from the left margin (`width: 340px`). Can be pinned open via an icon button.
- **Notes Drawer:** Slides in from the right margin (`width: 340px`). Can be pinned open via an icon button.

- **Three-Column Mode:** When both drawers are pinned, the CSS grid recalculates:
  `grid-template-columns: var(--drawer-width) 1fr var(--drawer-width);`
  The middle launchpad area adjusts dynamically, keeping the omnibar centered relative to the remaining space.

#### Mobile / PWA Viewport (`max-width: 768px`)

- Drawers do not use side fly-out mechanics.
- Top of viewport contains a pinned, compact omnibar.
- Bottom of viewport contains a fixed three-tab navigation bar:
  `[ Bookmarks ] | [ Tasks ] | [ Scratchpad ]`
- Tapping a tab transitions the view smoothly between the three modular panels without reloading.

### 6.3 Empty States

- **Zero Hardcoded Bookmarks:** First load contains no synthetic seeds.
- Every container (Bookmarks, Tasks, Notes) renders a clean, single-sentence instructional prompt when empty:
- _Bookmarks:_ "No links added yet. Press '+' or use Settings to import your links."
- _Tasks:_ "All priorities cleared. Add a task to track today's focus."
- _Notes:_ "Scratchpad is empty. Click '+ Note' to paste temporary information."

- These notices automatically unmount as soon as the collection item count exceeds zero.

---

## 7. Project Structure & Codebase Organization

The project will be structured with clean, modular boundaries:

```
hub/
├── .github/
│   └── workflows/
│       └── deploy.yml           # Static deployment to GitHub Pages
├── public/
│   ├── favicon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── manifest.json            # PWA Web App Manifest
│   └── sw.js                    # Service Worker for offline asset caching
├── src/
│   ├── core/
│   │   ├── db.ts                # IndexedDB schema and operations
│   │   ├── sync.ts              # GitHub API REST client and entity merge logic
│   │   ├── store.ts             # Central reactive state manager & event bus
│   │   └── fallback.ts          # Alternate URL probe and resolution logic
│   ├── components/
│   │   ├── omnibar.ts           # Central search engine and hotkey handler
│   │   ├── bookmarks.ts         # Bookmark grids, recents, and grouping logic
│   │   ├── tasks.ts             # Task drawer, item toggles, and input view
│   │   ├── notes.ts             # Scratchpad card rendering and copy actions
│   │   ├── settings.ts          # Configuration modal, token test, import/export
│   │   └── toast.ts             # Bottom notification dispatcher
│   ├── styles/
│   │   ├── tokens.css           # CSS variables, colors, typography, breakpoints
│   │   ├── layout.css           # Desktop 3-column grid and mobile viewport styles
│   │   └── components.css       # Omnibar, cards, drawers, and modal styles
│   ├── types/
│   │   └── index.ts             # Pure TypeScript interfaces and type definitions
│   ├── utils/
│   │   ├── dom.ts               # Minimal DOM builder and event helper utilities
│   │   └── crypto.ts            # UUID v4 generator and string hashing helpers
│   └── main.ts                  # Application bootstrap and service worker registration
├── index.html                   # Static HTML entry point
├── package.json                 # Dependency definitions and scripts
├── tsconfig.json                # TypeScript compiler configuration (strict)
└── vite.config.ts               # Vite build configuration (base paths, static export)

```

---

## 8. Implementation Verification & Test Matrix

Autonomous coding agents and engineers must satisfy this checklist prior to marking features complete:

### 8.1 Functional Verification Checklist

- [ ] **Omnibar Navigation:** Entering a query matches local bookmarks. Selecting an item navigates in the same tab. Entering a valid URL navigates directly. Fallback routes to the default search engine with query encoded.
- [ ] **Hotkey Execution:** Pressing `Alt + 1` through `Alt + 9` immediately opens the assigned link without triggering search bar numeric inputs.
- [ ] **Dual Drawer Pinning:** Pinned drawers persist their state to `AppConfig`. Desktop layout reflows from 1 to 2 or 3 columns smoothly without horizontal scrollbar overflow.
- [ ] **Mobile Responsiveness:** Viewports `< 768px` correctly render the bottom navigation tabs and display one section at a time while keeping the omnibar visible.
- [ ] **Health Check Fallbacks:** Bookmarks with alternative URLs detect failed endpoints, fall back to the secondary URL, and display the toast alert.
- [ ] **Sync Merging:** Simultaneous edits (e.g., local task completed while remote link is added) reconcile correctly via fine-grained timestamp merging without losing either mutation.
- [ ] **Storage Transparency:** Testing GitHub API connection reports correct permissions, and prompts before initializing `.hub/data.json` if the file doesn't exist.
- [ ] **Zero Telemetry & Full Offline:** Disconnecting internet allows complete CRUD operations against `IndexedDB`. No external resources (fonts, stylesheets, CDN icons) are loaded from third parties.
