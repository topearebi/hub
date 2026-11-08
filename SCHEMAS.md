# `schemas.md` — Hub Data Specifications & Contracts

**Document Version:** 1.4.0

**Target Release:** v1.0 (PWA & Static Deploy) — production-readiness revision

**Parent Document:** `PRD.md` (v1.1.0)

**Status:** Approved — remote payload `version: 2` (profiles); production-readiness additions approved by the owner (§3.3, §3.5, §3.6)

**Changelog:** 1.4.0 — owner **approved** the encrypted-token storage shape (§3.5) and the `single_key_shortcuts_enabled` field (§3.6); both are now part of the contract and must be transcribed verbatim into `src/types/schemas.ts` when implemented. 1.3.0 — records the decided profile-deletion semantics (§5.4), the token-encryption approach and the hotkey scheme. 1.2.0 — documents the v2 multi-profile storage (`profiles` store, `profile_id` partitioning, IndexedDB v2), approves three local-only `AppConfig` fields, and records the removal of telemetry. 1.1.0 — local feature toggles. 1.0.0 — initial.

---

## 1. Architectural Principles & Storage Layers

Hub enforces a strict separation between **three distinct data tiers**:

1. **Remote Sync Payload (`/.hub/data.json`):**
   The single source of truth for cross-device state. Must remain lean, strictly versioned, and free of device-specific metadata or transient runtime counters.
2. **Local Persistence Layer (`IndexedDB`):**
   Browser-level storage executing all client-side CRUD operations. Houses syncable entities, local-only operational metrics, and client authentication tokens.
3. **In-Memory State Store (RAM):**
   Reactive singleton store powering UI view components with sub-millisecond lookups, live fuzzy filtering, and mutation queueing.

```
┌─────────────────────────────────────────────────────────────┐
│                      Remote Data Tier                       │
│                 GitHub: `/.hub/data.json`                   │
│         (HubStoragePayload: Entities + Global Config)       │
└──────────────────────────────▲──────────────────────────────┘
                               │  HTTPS REST (Debounced Sync)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Local IndexedDB                        │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Syncable stores (each record carries `profile_id`):   │   │
│ │ profiles · bookmarks · categories · tasks · notes     │   │
│ ├───────────────────────────┬───────────────────────────┤   │
│ │  metrics (DeviceMetrics)  │  config (AppConfig, sync  │   │
│ │  local-only, per device   │  metadata) — local-only   │   │
│ └───────────────────────────┴───────────────────────────┘   │
└──────────────────────────────▲──────────────────────────────┘
                               │  Async IDB Transaction
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   In-Memory Reactive State                  │
│       (Omnibar Index / Active Drawers / UI Event Bus)       │
└─────────────────────────────────────────────────────────────┘

```

---

## 2. Core TypeScript Interfaces (`src/types/schemas.ts`)

### 2.1 The Sync Envelope (`HubStoragePayload`)

This schema represents the exact byte-for-byte structure committed to and fetched from the remote BYOS target (`.hub/data.json`).

```typescript
/**
 * Root sync payload.
 * Serialized as pretty-printed JSON (2-space indent) on the remote target.
 */
export interface HubStoragePayload {
  /**
   * Schema contract version. v2 adds `profiles` and `profile_id` partitioning;
   * v1 payloads are migrated on read.
   */
  version: 2;

  /** Unix epoch timestamp (ms) indicating when this snapshot was written */
  last_synced_at: number;

  /** Profile definitions (v2) */
  profiles: ProfileItem[];

  /** Canonical collection arrays */
  bookmarks: BookmarkItem[];
  categories: CategoryItem[];
  tasks: TaskItem[];
  notes: NoteItem[];
}
```

---

### 2.2 Base Entity Contract (`SyncableEntity`)

All collections stored in the sync payload MUST implement `SyncableEntity` to support deterministic conflict resolution.

```typescript
export interface SyncableEntity {
  /** RFC 4122 UUID v4 or 21-character nanoid */
  id: string;

  /** Unix epoch timestamp (ms) of creation */
  created_at: number;

  /**
   * Unix epoch timestamp (ms) of latest state mutation.
   * Crucial tie-breaker for fine-grained entity reconciliation.
   */
  updated_at: number;

  /**
   * Soft-delete tombstone flag.
   * If true, entity is treated as deleted across the UI and retained
   * during sync until tombstone propagation finishes.
   */
  is_deleted?: boolean;
}
```

---

### 2.3 Domain Entities

#### A. Bookmarks & Categories

```typescript
export type BookmarkCardSize = 'small' | 'wide' | 'large';

export interface BookmarkItem extends SyncableEntity {
  /** Owning profile id (partition key) */
  profile_id: string;

  /** Human-readable display label */
  title: string;

  /** Primary target URL (navigated to by default) */
  url: string;

  /**
   * Optional ordered list of mirror URLs, LAN hostnames, or IP targets.
   * Evaluated sequentially if the primary URL fails health/ping checks.
   */
  alternate_urls?: string[];

  /** Foreign key pointing to a valid CategoryItem.id */
  category_id: string;

  /**
   * Optional explicit icon URL.
   * If omitted or empty, client falls back to:
   * https://www.google.com/s2/favicons?domain={hostname}&sz=64
   */
  icon?: string;

  /**
   * Single-character numeric hotkey ('1' through '9').
   * Triggered in the browser using the modifier-free chord `g` then `[1-9]`, or the optional `Alt + [1-9]` combination (see DESIGN.md §4.5).
   */
  hotkey?: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

  /**
   * Visual card footprint in the launchpad tile grid.
   * - 'small': 1x1 compact tile (default)
   * - 'wide': 2x1 horizontal card with description/mirrors
   * - 'large': 2x2 hero card with full description & direct clickable mirrors
   */
  card_size?: BookmarkCardSize;

  /** Optional secondary details, notes, or context for the bookmark. */
  description?: string;
}

export interface CategoryItem extends SyncableEntity {
  /** Owning profile id (partition key) */
  profile_id: string;

  /** Category display name (e.g., "Daily Ops", "Infrastructure", "Media") */
  name: string;

  /** Visual rendering sequence index (ascending: 0, 1, 2...) */
  order: number;
}
```

#### B. Tasks

```typescript
export interface TaskItem extends SyncableEntity {
  /** Owning profile id (partition key) */
  profile_id: string;

  /** Primary task text */
  title: string;

  /** Optional secondary details or context */
  description?: string;

  /** Completion status flag */
  completed: boolean;

  /** Unix epoch timestamp (ms) when completed, or null if pending */
  completed_at?: number | null;

  /**
   * Optional Unix epoch timestamp (ms) at which to raise a task reminder.
   * Null/absent means no reminder is scheduled. (v1.1 authorized extension.)
   */
  remind_at?: number | null;

  /** Parent task id for nested subtasks (null/absent = top level) */
  parent_id?: string | null;

  /** Optional due date (ISO calendar date 'YYYY-MM-DD') */
  due_date?: string | null;

  /** Optional due time ('HH:mm', 24-hour) */
  due_time?: string | null;

  /** Optional recurrence cadence (metadata only; no auto-spawn) */
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;

  /** Manual sort index (ascending; defaults to 0) */
  order?: number;
}
```

#### C. Scratchpad Notes

```typescript
export interface NoteItem extends SyncableEntity {
  /** Owning profile id (partition key) */
  profile_id: string;

  /** Note card title / summary line */
  title: string;

  /**
   * Unparsed plain-text buffer.
   * Users can enter Markdown syntax, but the UI must render it safely as
   * raw text (using `<pre>` or `white-space: pre-wrap`) to prevent XSS.
   */
  content: string;

  /**
   * Visual badge color identifier.
   * Restricted to theme tokens or predefined pastel/warm hex values.
   */
  /** Whether the note is pinned to the top of the list */
  is_pinned?: boolean;

  /**
   * Warm pastel background token. Legacy 'neutral' is treated as 'default'.
   */
  color_tag?: 'default' | 'burgundy' | 'amber' | 'sage' | 'terracotta' | 'slate' | string;

  /** Manual sort index (ascending; defaults to 0) */
  order?: number;
}
```

#### D. Profiles (v2)

```typescript
export interface ProfileItem extends SyncableEntity {
  /** Display name of the profile / space */
  name: string;

  /** Avatar image (data URL or remote URL) */
  avatar?: string;

  /** Custom space title shown when no logo is configured */
  hub_title?: string;

  /** Custom space logo (compressed data URL) */
  logo?: string;

  /** Default search provider id (references AppConfig.search_providers) */
  default_search_provider_id?: string;

  /** Optional per-profile theme override */
  theme?: 'auto' | 'light' | 'dark';

  /** Preferred sync file path (stored; a single shared file is used) */
  sync_path?: string;
}
```

---

## 3. Local-Only Schemas (Non-Syncable)

These entities are persisted exclusively in local client storage. They **must never** appear in `HubStoragePayload` or be committed to the remote repository.

### 3.1 Device-Isolated Usage Metrics (`DeviceMetrics`)

Used to construct the "Recently Used" and "Most Frequently Used" dynamic sections on the home screen without contaminating other devices' patterns or causing Git commit storms.

```typescript
export interface DeviceMetrics {
  /** Foreign key matching BookmarkItem.id */
  bookmark_id: string;

  /** Total activation count from the omnibar or dashboard tile on this machine */
  click_count: number;

  /** Unix epoch timestamp (ms) of the most recent activation */
  last_visited_at: number;
}
```

### 3.2 Client Configuration & Secrets (`AppConfig`)

```typescript
export interface SearchProvider {
  id: string;
  name: string;
  /** Query template requiring '%s' parameter */
  query_url: string;
  is_default: boolean;
  /** Optional icon identifier (preset key, SVG data URL, or image data URL) */
  icon?: string;
}

export interface AppConfig {
  /** Master toggle for background synchronization */
  sync_enabled: boolean;

  /** BYOS GitHub REST Configuration */
  github_pat?: string; // Token stored in cleartext inside IndexedDB only
  github_owner?: string; // e.g., "username" or "organization"
  github_repo?: string; // e.g., "my-hub-config"
  github_branch: string; // defaults to "main"
  github_file_path: string; // defaults to ".hub/data.json"
  github_last_sha?: string; // Latest remote Git Blob SHA for optimistic concurrency

  /** Search & Omnibar Settings */
  search_providers: SearchProvider[];

  /** Viewport & Appearance */
  theme: 'auto' | 'light' | 'dark';

  /** Persistent UI Drawer Layout State (Desktop only) */
  pinned_drawers: {
    tasks: boolean;
    notes: boolean;
  };

  /** Id of the currently active profile (local-only) */
  active_profile_id?: string;

  /* ---- Local-Only Feature Toggles (never synced, v1.1) ---- */

  /** Whether local task reminders are enabled */
  notifications_enabled: boolean;

  /** Optional VAPID public key used to subscribe to Web Push */
  vapid_public_key?: string;

  /** Whether gamepad navigation is enabled */
  gamepad_enabled: boolean;

  /** Whether the WebAuthn app lock gates the UI on launch */
  app_lock_enabled: boolean;

  /** Base64url credential id of the registered platform authenticator */
  app_lock_credential_id?: string;

  /* ---- Production-readiness additions (local-only, never synced; approved v1.2) ---- */

  /** True once the first-run welcome card has been completed or dismissed */
  onboarding_completed?: boolean;

  /** ISO-8601 timestamp of the last time the user dismissed the install prompt/card */
  install_prompt_dismissed_at?: string;

  /** Result of the last `navigator.storage.persist()` request (true = durable storage granted) */
  storage_persisted?: boolean;
}
```

### 3.3 Production-Readiness `AppConfig` Additions (approved)

The owner approved exactly the three optional, local-only fields below (plus the two further approved additions in §3.5 and §3.6). They are **never** part of `HubStoragePayload`, default to `undefined` (treated as `false`/"never"), require no IndexedDB migration (the `config` store is a key/value singleton), and must be added to `src/types/schemas.ts` verbatim.

| Field                         | Type                 | Written by                              | Read by                                                 |
| ----------------------------- | -------------------- | --------------------------------------- | ------------------------------------------------------- |
| `onboarding_completed`        | `boolean?`           | Onboarding card (complete/skip)         | Launchpad boot — show/hide welcome card                 |
| `install_prompt_dismissed_at` | `string?` (ISO-8601) | Install card dismiss                    | Install UX — suppress the prompt for a cool-down period |
| `storage_persisted`           | `boolean?`           | PWA lifecycle after `storage.persist()` | Settings → Data; durability warning                     |

Two further additions required by decisions already taken were **approved by the owner** and are specified in §3.5 (encrypted token storage) and §3.6 (shortcut switch). Anything beyond these five items is **not** approved and needs separate authorization per `AGENTS.md` prime directive 2.

### 3.4 Removed: Telemetry

v1.1 of the product removes IP/location/weather telemetry. No telemetry field ever existed in `AppConfig` or `HubStoragePayload`. The only artefact is a `localStorage` cache entry (`hub.telemetry`) written by the removed `core/telemetry.ts`; the application deletes that key once on boot after upgrading (`localStorage.removeItem('hub.telemetry')`). No schema change is required.

---

### 3.5 APPROVED: Encrypted GitHub token at rest

**Decision taken:** protect the GitHub personal access token (PAT) with encryption at rest using the native WebCrypto API and a **non-extractable** AES-GCM key. Not tied to the app-lock credential (so background/unattended sync keeps working). Combined with in-app guidance to use a fine-grained token limited to the single sync repository with _Contents: read & write_.

**Schema changes (approved):**

1. `AppConfig.github_pat` keeps its name and type (`string | undefined`) but its **content changes**: instead of the raw token it holds a versioned envelope string, `"enc1:" + base64url(iv) + "." + base64url(ciphertext)`. A value without the `enc1:` prefix is treated as legacy plaintext and is encrypted in place on next boot (one-time migration; the plaintext is overwritten).
2. One new **singleton record** in the existing `config` object store (keyPath `"key"`): `{ key: "token_key", value: CryptoKey }`, holding the non-extractable key (IndexedDB structured clone supports `CryptoKey`). No new object store, no new index, **no `DB_VERSION` bump**, and it is never part of `HubStoragePayload`.

**Requirements.**

- The raw token exists only in memory for the duration of a request; it is never logged, never written to export JSON, never in the sync payload, and the settings field never re-displays it.
- Removing the token deletes the envelope; "Reset app data" deletes the key record.
- If the key record is missing or undecryptable (site data partially cleared, restored backup, new device) the app treats sync as "not configured", asks the user to re-enter the token, and loses no bookmarks, tasks or notes.
- Import must ignore any `github_pat` present in a file.

**Honest threat model (document this to the user).** This raises the bar against casual inspection (DevTools → Application → IndexedDB shows ciphertext, not a usable token) and against accidental exposure through screenshots, copy/paste of config dumps and plaintext-searching tools. It does **not** protect against code executing inside the Hub page (XSS or a malicious extension with page access can still ask the page to decrypt), nor against an attacker who copies the browser profile directory (browsers may persist the key material alongside the data). Defence in depth comes from CSP, no `innerHTML`, scoped tokens and the ability to revoke the token on GitHub.

**Test notes.** `fake-indexeddb` and Node's WebCrypto may not round-trip a `CryptoKey` through IndexedDB identically to browsers; tests must inject a key store abstraction and cover the migration and missing-key paths, with a manual check in real browsers.

### 3.6 APPROVED: Single-key shortcut switch

**Decision taken:** the primary pinned-bookmark shortcut is the modifier-free chord `g` then `1…9` (DESIGN.md §4.5). WCAG 2.1.4 requires single-character-key shortcuts to be turn-off-able (or remappable), so the setting must persist.

**Approved field (local-only, never synced):**

```typescript
  /** When false, single-key shortcuts (/ ? g n t m) are disabled. Undefined = true. Alt+digit is unaffected. */
  single_key_shortcuts_enabled?: boolean;
```

Default `undefined` behaves as enabled. No IndexedDB migration is needed (`config` is a key/value singleton). This field is a **hard dependency** of the single-key shortcut feature: the shortcuts and the Settings switch ship together.

---

## 4. IndexedDB Physical Storage Schema

Hub uses a single IndexedDB database named `hub_local_db` with native transactions.

- **Database Name:** `hub_local_db`
- **Current Version:** `2` (v2 added the `profiles` store and the `idx_profile_id` index on every syncable entity store; legacy v1 records are migrated into a default profile with no data loss)

### 4.1 Object Store Definitions

```
hub_local_db (v2)
│
├── [ObjectStore] profiles (keyPath: "id")          # v2
│
├── [ObjectStore] bookmarks (keyPath: "id")
│   ├── [Index] idx_category_id   → "category_id" (unique: false)
│   ├── [Index] idx_updated_at    → "updated_at"  (unique: false)
│   ├── [Index] idx_is_deleted    → "is_deleted"  (unique: false)
│   └── [Index] idx_profile_id    → "profile_id"  (unique: false)   # v2
│
├── [ObjectStore] categories (keyPath: "id")
│   ├── [Index] idx_order         → "order"       (unique: false)
│   └── [Index] idx_profile_id    → "profile_id"  (unique: false)   # v2
│
├── [ObjectStore] tasks (keyPath: "id")
│   ├── [Index] idx_completed     → "completed"   (unique: false)
│   ├── [Index] idx_updated_at    → "updated_at"  (unique: false)
│   └── [Index] idx_profile_id    → "profile_id"  (unique: false)   # v2
│
├── [ObjectStore] notes (keyPath: "id")
│   ├── [Index] idx_updated_at    → "updated_at"  (unique: false)
│   └── [Index] idx_profile_id    → "profile_id"  (unique: false)   # v2
│
├── [ObjectStore] metrics (keyPath: "bookmark_id")
│   ├── [Index] idx_click_count   → "click_count" (unique: false)
│   └── [Index] idx_visited       → "last_visited_at" (unique: false)
│
└── [ObjectStore] config (keyPath: "key")
    └── (Stores singletons: "app_config", "sync_metadata")

```

---

## 5. Synchronization & Conflict Resolution Specs

### 5.1 Remote Payload JSON Schema Example (`.hub/data.json`)

```json
{
  "version": 1,
  "last_synced_at": 1730401200000,
  "categories": [
    {
      "id": "cat_ops_01",
      "created_at": 1730400000000,
      "updated_at": 1730400000000,
      "name": "Daily Operations",
      "order": 0
    }
  ],
  "bookmarks": [
    {
      "id": "bm_repo_01",
      "created_at": 1730400100000,
      "updated_at": 1730400100000,
      "title": "GitHub Console",
      "url": "https://github.com",
      "alternate_urls": ["https://github.com/notifications"],
      "category_id": "cat_ops_01",
      "icon": "",
      "hotkey": "1"
    }
  ],
  "tasks": [
    {
      "id": "task_rev_01",
      "created_at": 1730400200000,
      "updated_at": 1730400250000,
      "title": "Review infrastructure logs",
      "description": "Check Hetzner container health",
      "completed": false,
      "completed_at": null
    }
  ],
  "notes": [
    {
      "id": "note_scratch_01",
      "created_at": 1730400300000,
      "updated_at": 1730400300000,
      "title": "Temporary IP buffer",
      "content": "Wireguard Gateway: 10.0.0.1\nReverse Proxy: 10.0.0.254",
      "color_tag": "terracotta"
    }
  ]
}
```

---

### 5.2 Deterministic Merging Algorithm (Pseudo-Code)

This procedure executes during every sync cycle prior to pushing an updated commit:

```typescript
function mergeCollection<T extends SyncableEntity>(localEntities: T[], remoteEntities: T[]): T[] {
  const mergedMap = new Map<string, T>();

  // 1. Seed with local records
  for (const item of localEntities) {
    mergedMap.set(item.id, item);
  }

  // 2. Reconcile against remote records
  for (const remoteItem of remoteEntities) {
    if (!mergedMap.has(remoteItem.id)) {
      // Entity exists only remotely -> Adopt it
      mergedMap.set(remoteItem.id, remoteItem);
    } else {
      const localItem = mergedMap.get(remoteItem.id)!;
      // Both exist: strict Last-Write-Wins based on updated_at
      if (remoteItem.updated_at > localItem.updated_at) {
        mergedMap.set(remoteItem.id, remoteItem);
      }
      // If localItem.updated_at >= remoteItem.updated_at, keep local
    }
  }

  return Array.from(mergedMap.values());
}
```

### 5.3 Tombstone Cleanup Strategy

To prevent soft-deleted records (`is_deleted: true`) from growing indefinitely in `.hub/data.json`:

- An entity with `is_deleted: true` is retained in sync payloads for a **grace period of 30 days** (`now - updated_at <= 30 * 86,400,000`).
- Any entity exceeding 30 days past its deletion timestamp is permanently culled during the merge routine before writing the final payload.

### 5.4 Profile Deletion Semantics (decided)

Deleting a profile is a **cascading soft delete with a 30-day recovery window**; it uses only existing fields.

1. **Delete.** In one operation, take a single timestamp `T = now`. Set `is_deleted = true` and `updated_at = T` on the profile **and on every not-already-deleted** category, bookmark, task and note whose `profile_id` equals the profile's `id`. (Items that were individually deleted earlier keep their own, older `updated_at`.) If the deleted profile was active, `active_profile_id` moves to the first remaining non-deleted profile. Deleting the last remaining non-deleted profile is rejected.
2. **Restore.** Set `is_deleted = false` and `updated_at = now'` (a newer timestamp, so last-write-wins propagates it) on the profile and on exactly those child records with `is_deleted = true` and `updated_at === T`. Items deleted individually before the profile (different `updated_at`) stay deleted.
3. **Cull.** The 30-day rule in §5.3 applies unchanged. Because the profile and its cascaded children share `T`, they expire together; a profile must never be culled while children that depend on it remain, and children are never culled while their profile is restorable.
4. **Sync.** Tombstones propagate like any other deletion; another device that edits a child after `T` produces a newer `updated_at` and the merge keeps that edit — on restore it is simply visible again. Devices on a payload that lacks the cascade (older clients) will see the profile hidden and orphaned children, which is harmless.
5. **Invariant for tests.** After delete + restore with no intervening edits the dataset is identical to the original except for `updated_at`.

---

## 6. Default Fallback Configuration

When a user initializes Hub without a prior config or cloud profile, this default configuration object hydrates into `config_store`:

```typescript
export const DEFAULT_APP_CONFIG: AppConfig = {
  sync_enabled: false,
  github_branch: 'main',
  github_file_path: '.hub/data.json',
  theme: 'auto',
  pinned_drawers: {
    tasks: false,
    notes: false,
  },
  search_providers: [
    {
      id: 'sp_ddg',
      name: 'DuckDuckGo',
      query_url: 'https://duckduckgo.com/?q=%s',
      is_default: true,
    },
    {
      id: 'sp_google',
      name: 'Google',
      query_url: 'https://www.google.com/search?q=%s',
      is_default: false,
    },
  ],
};
```
