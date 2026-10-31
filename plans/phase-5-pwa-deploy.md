# Phase 5 — PWA Caching & Deployment: Build Approach & Delivery Plan

**Project:** Hub
**Phase:** 5 of 5 — PWA, Responsive Polish & Final Audit
**Parent Specs:** [`PRD.md`](../PRD.md), [`SCHEMAS.md`](../SCHEMAS.md), [`AGENTS.md`](../AGENTS.md)
**Status:** In progress

---

## 1. Objective

Make Hub installable, offline-capable, and deployable to GitHub Pages.

1. `public/manifest.json` — standalone display, warm theme colors, local icons.
2. `public/sw.js` — cache-first for static assets, network-first for the GitHub API.
3. Service worker registration in `src/main.ts`.
4. `.github/workflows/deploy.yml` — automatic GitHub Pages deployment on push to `main`.

**Exit Criteria (from AGENTS.md):** Lighthouse PWA audit passes; the app loads
and functions fully in airplane mode.

---

## 2. Guiding Principles

| Principle                     | How Phase 5 Enforces It                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| **No external CDNs**          | Icons are generated locally (SVG + PNG) with zero third-party assets.              |
| **Offline-first shell**       | The SW precaches the app shell and runtime-caches hashed assets (cache-first).     |
| **Never cache sync data**     | `api.github.com` requests use network-first and are never persisted.               |
| **Subpath-safe**              | `base: './'`, relative manifest `start_url`/`scope`, and `BASE_URL`-aware SW path. |
| **Progressive enhancement**   | SW registration failures are swallowed; the app works without offline caching.     |
| **Zero runtime dependencies** | PNG icons are generated with Node's built-in `zlib` (no image libraries).          |

---

## 3. Task Breakdown

### 3.1 Icons

- `public/icon.svg` — scalable warm-terracotta rounded square with a white "H".
- `public/icon-192.png`, `public/icon-512.png` — generated from the same design
  via a throwaway Node script (built-in `zlib` PNG encoder).

### 3.2 Manifest (`public/manifest.json`)

- `display: standalone`, `background_color`/`theme_color` from the warm palette,
  `start_url`/`scope` relative for GitHub Pages subpaths, and 192/512 icons
  (including a `maskable` entry).

### 3.3 Service Worker (`public/sw.js`)

- Precache the app shell on install; `skipWaiting` + `clients.claim`.
- Cache-first for same-origin GETs; network-first for `api.github.com`.
- Offline navigation fallback to the cached `index.html`.

### 3.4 Registration (`src/main.ts`)

- Register `${import.meta.env.BASE_URL}sw.js` on `load`, guarded by
  `'serviceWorker' in navigator`.

### 3.5 Deployment (`.github/workflows/deploy.yml`)

- On push to `main`: `npm ci` → typecheck → lint → test → build → upload `dist`
  → deploy to GitHub Pages.

---

## 4. Definition of Done (Phase 5)

- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm run test` passes (all suites).
- [ ] `npm run build` emits `dist/` with `manifest.json`, `sw.js`, and icons.
- [ ] Manifest is valid and references local 192/512 icons.
- [ ] SW uses cache-first for assets and network-first for the GitHub API.
- [ ] No `any` types, no `innerHTML`, no framework imports, no external CDNs.
