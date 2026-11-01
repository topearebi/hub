# `schemas.md` — Hub Data Specifications & Contracts

**Document Version:** 1.0.0

**Target Release:** v1.0 (PWA & Static Deploy)

**Parent Document:** `prd.md`

**Status:** Approved for Implementation

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
│ ┌───────────────────┬───────────────────┬─────────────────┐ │
│ │  entities_store   │   metrics_store   │  config_store   │ │
│ │  (SyncableEntity) │   (DeviceMetrics) │  (AppConfig)    │ │
│ └───────────────────┴───────────────────┴─────────────────┘ │
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
   * Triggered in the browser using the `Alt + [1-9]` key combination.
   */
  hotkey?: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
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
  color_tag?: 'terracotta' | 'sage' | 'amber' | 'neutral' | string;
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
}
```

---

## 4. IndexedDB Physical Storage Schema

Hub uses a single IndexedDB database named `hub_local_db` with native transactions.

- **Database Name:** `hub_local_db`
- **Current Version:** `1`

### 4.1 Object Store Definitions

```
hub_local_db (v1)
│
├── [ObjectStore] bookmarks (keyPath: "id")
│   ├── [Index] idx_category_id   → "category_id" (unique: false)
│   ├── [Index] idx_updated_at    → "updated_at"  (unique: false)
│   └── [Index] idx_is_deleted    → "is_deleted"  (unique: false)
│
├── [ObjectStore] categories (keyPath: "id")
│   └── [Index] idx_order         → "order"       (unique: false)
│
├── [ObjectStore] tasks (keyPath: "id")
│   ├── [Index] idx_completed     → "completed"   (unique: false)
│   └── [Index] idx_updated_at    → "updated_at"  (unique: false)
│
├── [ObjectStore] notes (keyPath: "id")
│   └── [Index] idx_updated_at    → "updated_at"  (unique: false)
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
