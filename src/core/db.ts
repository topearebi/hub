/**
 * Hub Local Data Engine (IndexedDB)
 * ---------------------------------
 * Native IndexedDB wrapper for `hub_local_db` (v1). Implements every object
 * store and index defined in SCHEMAS.md §4.1.
 *
 * Design goals:
 *   - Headless: no DOM imports, so it is unit-testable and worker-safe.
 *   - Generic typed CRUD so UI components never touch raw IDB APIs.
 *   - Versioned, additive migrations via `onupgradeneeded` (no data loss).
 *   - Every transaction is committed/aborted and errors surfaced (AGENTS.md DoD).
 */

import { DEFAULT_APP_CONFIG } from '../types/schemas';
import type { AppConfig, DeviceMetrics } from '../types/schemas';

export const DB_NAME = 'hub_local_db';
export const DB_VERSION = 1;

/** Canonical object store names. */
export const STORE = {
  bookmarks: 'bookmarks',
  categories: 'categories',
  tasks: 'tasks',
  notes: 'notes',
  metrics: 'metrics',
  config: 'config',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

/** Primary key path per store (SCHEMAS.md §4.1). */
const STORE_KEY_PATHS: Record<StoreName, string> = {
  bookmarks: 'id',
  categories: 'id',
  tasks: 'id',
  notes: 'id',
  metrics: 'bookmark_id',
  config: 'key',
};

interface IndexDef {
  name: string;
  keyPath: string;
  unique: boolean;
}

/** Secondary indices per store (SCHEMAS.md §4.1). */
const STORE_INDICES: Partial<Record<StoreName, readonly IndexDef[]>> = {
  bookmarks: [
    { name: 'idx_category_id', keyPath: 'category_id', unique: false },
    { name: 'idx_updated_at', keyPath: 'updated_at', unique: false },
    { name: 'idx_is_deleted', keyPath: 'is_deleted', unique: false },
  ],
  categories: [{ name: 'idx_order', keyPath: 'order', unique: false }],
  tasks: [
    { name: 'idx_completed', keyPath: 'completed', unique: false },
    { name: 'idx_updated_at', keyPath: 'updated_at', unique: false },
  ],
  notes: [{ name: 'idx_updated_at', keyPath: 'updated_at', unique: false }],
  metrics: [
    { name: 'idx_click_count', keyPath: 'click_count', unique: false },
    { name: 'idx_visited', keyPath: 'last_visited_at', unique: false },
  ],
};

/* ------------------------------------------------------------------ */
/* Connection lifecycle                                                */
/* ------------------------------------------------------------------ */

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Apply schema migrations. Additive and version-gated so future releases can
 * introduce stores/indices without destroying existing user data.
 */
function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    for (const name of Object.values(STORE)) {
      if (db.objectStoreNames.contains(name)) {
        continue;
      }
      const store = db.createObjectStore(name, { keyPath: STORE_KEY_PATHS[name] });
      for (const index of STORE_INDICES[name] ?? []) {
        store.createIndex(index.name, index.keyPath, { unique: index.unique });
      }
    }
  }
  // Future migrations: if (oldVersion < 2) { ... }
}

/** Open (and cache) the database connection. */
export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      upgrade(request.result, event.oldVersion);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onblocked = () =>
      reject(new Error('IndexedDB upgrade blocked by another open connection'));
  });

  // Do not cache a rejected promise: if the first open is blocked (e.g. another
  // tab mid-upgrade), later calls would otherwise be stuck with that failure
  // forever. Clearing the cache lets a subsequent call retry cleanly.
  dbPromise = attempt.catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

/** Close the cached connection (used by tests to reset state). */
export async function closeDatabase(): Promise<void> {
  if (!dbPromise) {
    return;
  }
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

/** Delete the entire database (used by tests). */
export function deleteDatabase(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to delete database'));
    request.onblocked = () => resolve();
  });
}

/* ------------------------------------------------------------------ */
/* Generic transaction helpers                                         */
/* ------------------------------------------------------------------ */

/**
 * Run a single request inside a transaction and resolve once the transaction
 * commits. Guarantees the transaction is aborted on synchronous errors and
 * that failures reject the returned promise.
 */
async function runRequest<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();

  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    let result!: T;
    let request: IDBRequest<T>;

    try {
      request = op(store);
    } catch (err) {
      tx.abort();
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Read every record from a store. */
export function getAll<T>(storeName: StoreName): Promise<T[]> {
  return runRequest<T[]>(storeName, 'readonly', (store) => store.getAll() as IDBRequest<T[]>);
}

/** Read a single record by primary key. */
export function get<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return runRequest<T | undefined>(
    storeName,
    'readonly',
    (store) => store.get(key) as IDBRequest<T | undefined>,
  );
}

/** Insert or update a record. */
export function put<T>(storeName: StoreName, value: T): Promise<IDBValidKey> {
  return runRequest<IDBValidKey>(storeName, 'readwrite', (store) => store.put(value));
}

/** Delete a record by primary key. */
export function remove(storeName: StoreName, key: IDBValidKey): Promise<undefined> {
  return runRequest<undefined>(storeName, 'readwrite', (store) => store.delete(key));
}

/** Insert or update many records in a single transaction. */
export async function bulkPut<T>(storeName: StoreName, values: readonly T[]): Promise<void> {
  const db = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);

    for (const value of values) {
      store.put(value);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB bulk write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB bulk write aborted'));
  });
}

/* ------------------------------------------------------------------ */
/* Config store helpers (singletons)                                   */
/* ------------------------------------------------------------------ */

interface ConfigRecord<T> {
  key: string;
  value: T;
}

const APP_CONFIG_KEY = 'app_config';
const SYNC_METADATA_KEY = 'sync_metadata';

/** Local sync bookkeeping (never part of the remote payload). */
export interface SyncMetadata {
  last_synced_at: number;
  github_last_sha?: string;
}

/** Read the app config, falling back to a deep clone of the defaults. */
export async function getAppConfig(): Promise<AppConfig> {
  const record = await get<ConfigRecord<AppConfig>>(STORE.config, APP_CONFIG_KEY);
  return record ? record.value : structuredClone(DEFAULT_APP_CONFIG);
}

/** Persist the app config singleton. */
export async function setAppConfig(config: AppConfig): Promise<void> {
  await put<ConfigRecord<AppConfig>>(STORE.config, { key: APP_CONFIG_KEY, value: config });
}

/** Read local sync metadata, if any. */
export async function getSyncMetadata(): Promise<SyncMetadata | undefined> {
  const record = await get<ConfigRecord<SyncMetadata>>(STORE.config, SYNC_METADATA_KEY);
  return record?.value;
}

/** Persist local sync metadata. */
export async function setSyncMetadata(meta: SyncMetadata): Promise<void> {
  await put<ConfigRecord<SyncMetadata>>(STORE.config, { key: SYNC_METADATA_KEY, value: meta });
}

/* ------------------------------------------------------------------ */
/* Metrics store helpers (local-only)                                  */
/* ------------------------------------------------------------------ */

/**
 * Record a bookmark activation: increments the click count and stamps the
 * visit time. Metrics never leave the device.
 */
export async function recordVisit(
  bookmarkId: string,
  now: number = Date.now(),
): Promise<DeviceMetrics> {
  const existing = await get<DeviceMetrics>(STORE.metrics, bookmarkId);
  const updated: DeviceMetrics = {
    bookmark_id: bookmarkId,
    click_count: (existing?.click_count ?? 0) + 1,
    last_visited_at: now,
  };
  await put<DeviceMetrics>(STORE.metrics, updated);
  return updated;
}

/** Read all device metrics. */
export function getMetrics(): Promise<DeviceMetrics[]> {
  return getAll<DeviceMetrics>(STORE.metrics);
}
