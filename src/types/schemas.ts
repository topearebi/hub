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
  /**
   * Schema contract version. v2 introduces `profiles` and `profile_id`
   * partitioning; v1 payloads are migrated on read (see `sync.parsePayload`).
   */
  version: 2;

  /** Unix epoch timestamp (ms) indicating when this snapshot was written. */
  last_synced_at: number;

  /** Profile definitions (v2). */
  profiles: ProfileItem[];

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

export type BookmarkCardSize = 'small' | 'wide' | 'large';

export interface BookmarkItem extends SyncableEntity {
  /** Owning profile id (partition key). */
  profile_id: string;

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

  /**
   * Visual card footprint in the launchpad tile grid.
   * - 'small': 1x1 compact tile (default)
   * - 'wide': 2x1 horizontal card with description/mirrors
   * - 'large': 2x2 hero card with full description & direct clickable mirrors
   */
  card_size?: BookmarkCardSize;

  /** Optional secondary details, notes, or context for the bookmark. */
  description?: string;

  /** Manual sort index within its category (ascending; defaults to 0). */
  order?: number;

  /** Optional custom card background color or CSS gradient. */
  bg_color?: string;

  /** Optional custom text / label color. */
  text_color?: string;

  /** Optional custom card border color. */
  border_color?: string;
}

export interface CategoryItem extends SyncableEntity {
  /** Owning profile id (partition key). */
  profile_id: string;

  /** Category display name (e.g., "Daily Ops", "Infrastructure", "Media"). */
  name: string;

  /** Visual rendering sequence index (ascending: 0, 1, 2...). */
  order: number;

  /**
   * Whether the category section is collapsed in the launchpad view.
   * If omitted or false, the category is expanded.
   */
  collapsed?: boolean;
}

export interface TaskItem extends SyncableEntity {
  /** Owning profile id (partition key). */
  profile_id: string;

  /** Primary task text. */
  title: string;

  /** Optional secondary details or context. */
  description?: string;

  /** Completion status flag. */
  completed: boolean;

  /** Unix epoch timestamp (ms) when completed, or null if pending. */
  completed_at?: number | null;

  /**
   * Optional Unix epoch timestamp (ms) at which to raise a task reminder.
   * `null`/absent means no reminder is scheduled. Synced as a normal field
   * (authorized extension to `SCHEMAS.md`).
   */
  remind_at?: number | null;

  /** Parent task id for nested subtasks (`null`/absent = top level). */
  parent_id?: string | null;

  /** Optional due date as an ISO calendar date (`YYYY-MM-DD`). */
  due_date?: string | null;

  /** Optional due time as `HH:mm` (24-hour). */
  due_time?: string | null;

  /** Optional recurrence cadence (metadata only; no auto-spawn). */
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;

  /** Manual sort index within a list (ascending; defaults to 0). */
  order?: number;
}

export interface NoteItem extends SyncableEntity {
  /** Owning profile id (partition key). */
  profile_id: string;

  /** Note card title / summary line. */
  title: string;

  /**
   * Unparsed plain-text buffer. Markdown may be authored, but the UI renders
   * it safely as raw text (white-space: pre-wrap) to prevent XSS.
   */
  content: string;

  /** Whether the note is pinned to the top of the list. */
  is_pinned?: boolean;

  /**
   * Warm pastel background token. Legacy `'neutral'` is treated as
   * `'default'` at read time.
   */
  color_tag?: 'default' | 'burgundy' | 'amber' | 'sage' | 'terracotta' | 'slate' | string;

  /** Manual sort index within a list (ascending; defaults to 0). */
  order?: number;
}

/**
 * A user profile / space. Profiles partition every syncable collection via
 * `profile_id` and carry their own branding and search preference.
 */
export interface ProfileItem extends SyncableEntity {
  /** Display name of the profile / space. */
  name: string;

  /** Avatar image (data URL or remote URL). */
  avatar?: string;

  /** Custom space title shown when no logo is configured. */
  hub_title?: string;

  /** Custom space logo (compressed data URL). */
  logo?: string;

  /** Default search provider id (references `AppConfig.search_providers`). */
  default_search_provider_id?: string;

  /** Optional per-profile theme override. */
  theme?: 'auto' | 'light' | 'dark';

  /**
   * Preferred sync file path. Stored as a preference; Hub currently syncs all
   * profiles into a single shared file.
   */
  sync_path?: string;
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
  /** Optional icon identifier (preset key, SVG data URL, or image data URL). */
  icon?: string;
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

  /** Id of the currently active profile (local-only). */
  active_profile_id?: string;

  /* ---- Local-only feature toggles (never synced) ---- */

  /** Whether local task reminders are enabled. */
  notifications_enabled: boolean;

  /** Optional VAPID public key used to subscribe to Web Push. */
  vapid_public_key?: string;

  /** Whether gamepad navigation is enabled. */
  gamepad_enabled: boolean;

  /** Whether the WebAuthn app lock gates the UI on launch. */
  app_lock_enabled: boolean;

  /** Base64url credential id of the registered platform authenticator. */
  app_lock_credential_id?: string;

  /* ---- Production-readiness additions (local-only, never synced; approved v1.2) ---- */

  /** True once the first-run welcome card has been completed or dismissed. */
  onboarding_completed?: boolean;

  /** ISO-8601 timestamp of the last time the user dismissed the install prompt/card. */
  install_prompt_dismissed_at?: string;

  /** Result of the last `navigator.storage.persist()` request (true = durable storage granted). */
  storage_persisted?: boolean;
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
export const SYNCABLE_COLLECTIONS = [
  'profiles',
  'bookmarks',
  'categories',
  'tasks',
  'notes',
] as const;

/**
 * Deterministic id for the auto-created default profile. Using a fixed id
 * (rather than a random UUID) keeps v1->v2 migrations idempotent across devices
 * so their default profiles merge instead of duplicating.
 */
export const DEFAULT_PROFILE_ID = 'default-profile';

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
  notifications_enabled: false,
  gamepad_enabled: true,
  app_lock_enabled: false,
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
