/**
 * Hub Data Contracts
 * ------------------
 * Single source of truth for all entity shapes. Transcribed verbatim from
 * `SCHEMAS.md`. Do NOT add, rename, or alter fields without explicit
 * authorization (AGENTS.md Prime Directive #2).
 *
 * Three data tiers are represented here:
 *   - Remote sync payload  -> HubStoragePayload (syncable entities only)
 *   - Local-only schemas   -> DeviceMetrics, AppConfig (never synced)
 *   - Base contract        -> SyncableEntity (conflict-resolution fields)
 */

/* ------------------------------------------------------------------ */
/* 1. Sync envelope                                                    */
/* ------------------------------------------------------------------ */

/**
 * Root sync payload committed to / fetched from the BYOS target
 * (`.hub/data.json`). Serialized as pretty-printed JSON (2-space indent).
 */
export interface HubStoragePayload {
  /** Schema contract version for forward/backward migration handling. */
  version: 1;

  /** Unix epoch timestamp (ms) indicating when this snapshot was written. */
  last_synced_at: number;

  /** Canonical collection arrays. */
  bookmarks: BookmarkItem[];
  categories: CategoryItem[];
  tasks: TaskItem[];
  notes: NoteItem[];
}

/* ------------------------------------------------------------------ */
/* 2. Base entity contract                                             */
/* ------------------------------------------------------------------ */

/**
 * All collections stored in the sync payload MUST implement this to support
 * deterministic conflict resolution.
 */
export interface SyncableEntity {
  /** RFC 4122 UUID v4 or 21-character nanoid. */
  id: string;

  /** Unix epoch timestamp (ms) of creation. */
  created_at: number;

  /** Unix epoch timestamp (ms) of latest state mutation (LWW tie-breaker). */
  updated_at: number;

  /**
   * Soft-delete tombstone flag. If true, the entity is treated as deleted
   * across the UI and retained during sync until tombstone propagation ends.
   */
  is_deleted?: boolean;
}

/* ------------------------------------------------------------------ */
/* 3. Domain entities                                                  */
/* ------------------------------------------------------------------ */

export interface BookmarkItem extends SyncableEntity {
  /** Human-readable display label. */
  title: string;

  /** Primary target URL (navigated to by default). */
  url: string;

  /**
   * Optional ordered list of mirror URLs, LAN hostnames, or IP targets.
   * Evaluated sequentially if the primary URL fails health/ping checks.
   */
  alternate_urls?: string[];

  /** Foreign key pointing to a valid CategoryItem.id. */
  category_id: string;

  /**
   * Optional explicit icon URL. If omitted or empty, the client falls back to
   * the favicon service for the hostname.
   */
  icon?: string;

  /** Single-character numeric hotkey ('1' through '9') for Alt + [1-9]. */
  hotkey?: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
}

export interface CategoryItem extends SyncableEntity {
  /** Category display name (e.g., "Daily Ops", "Infrastructure", "Media"). */
  name: string;

  /** Visual rendering sequence index (ascending: 0, 1, 2...). */
  order: number;
}

export interface TaskItem extends SyncableEntity {
  /** Primary task text. */
  title: string;

  /** Optional secondary details or context. */
  description?: string;

  /** Completion status flag. */
  completed: boolean;

  /** Unix epoch timestamp (ms) when completed, or null if pending. */
  completed_at?: number | null;
}

export interface NoteItem extends SyncableEntity {
  /** Note card title / summary line. */
  title: string;

  /**
   * Unparsed plain-text buffer. Markdown may be authored, but the UI renders
   * it safely as raw text (white-space: pre-wrap) to prevent XSS.
   */
  content: string;

  /** Visual badge color identifier (theme token or warm hex value). */
  color_tag?: 'terracotta' | 'sage' | 'amber' | 'neutral' | string;
}

/* ------------------------------------------------------------------ */
/* 4. Local-only schemas (never synced)                                */
/* ------------------------------------------------------------------ */

export interface SearchProvider {
  id: string;
  name: string;
  /** Query template requiring a '%s' parameter. */
  query_url: string;
  is_default: boolean;
}

export interface AppConfig {
  /** Master toggle for background synchronization. */
  sync_enabled: boolean;

  /** BYOS GitHub REST configuration. */
  github_pat?: string; // Token stored in cleartext inside IndexedDB only.
  github_owner?: string;
  github_repo?: string;
  github_branch: string; // defaults to "main"
  github_file_path: string; // defaults to ".hub/data.json"
  github_last_sha?: string; // Latest remote Git Blob SHA for optimistic concurrency.

  /** Search & omnibar settings. */
  search_providers: SearchProvider[];

  /** Viewport & appearance. */
  theme: 'auto' | 'light' | 'dark';

  /** Persistent UI drawer layout state (desktop only). */
  pinned_drawers: {
    tasks: boolean;
    notes: boolean;
  };
}

/**
 * Local-only usage metrics. Strictly excluded from remote synchronisation
 * (AGENTS.md: never leak DeviceMetrics into HubStoragePayload).
 */
export interface DeviceMetrics {
  /** Foreign key matching BookmarkItem.id. */
  bookmark_id: string;

  /** Total activation count from the omnibar or dashboard tile on this machine. */
  click_count: number;

  /** Unix epoch timestamp (ms) of the most recent activation. */
  last_visited_at: number;
}

/* ------------------------------------------------------------------ */
/* 5. Collection metadata                                              */
/* ------------------------------------------------------------------ */

/**
 * The four collections that participate in remote sync. Used by the merge
 * routine (Phase 4) and by tests asserting DeviceMetrics never serializes.
 */
export const SYNCABLE_COLLECTIONS = ['bookmarks', 'categories', 'tasks', 'notes'] as const;

export type SyncableCollection = (typeof SYNCABLE_COLLECTIONS)[number];

/* ------------------------------------------------------------------ */
/* 6. Default configuration                                            */
/* ------------------------------------------------------------------ */

/** Hydrated into `config_store` when no prior config exists (SCHEMAS.md §6). */
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
