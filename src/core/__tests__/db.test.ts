import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DB_NAME,
  DB_VERSION,
  STORE,
  bulkPut,
  closeDatabase,
  deleteDatabase,
  get,
  getAll,
  getAppConfig,
  getMetrics,
  getSyncMetadata,
  openDatabase,
  put,
  recordVisit,
  remove,
  setAppConfig,
  setSyncMetadata,
} from '../db';
import { DEFAULT_APP_CONFIG } from '../../types/schemas';
import type { BookmarkItem, CategoryItem, NoteItem, TaskItem } from '../../types/schemas';

/**
 * Data-engine tests run against `fake-indexeddb` (installed in the Vitest
 * setup file), so they execute in CI without a real browser.
 */

beforeEach(async () => {
  // Reset to a clean database for every test.
  await closeDatabase();
  await deleteDatabase();
});

afterAll(async () => {
  await closeDatabase();
  await deleteDatabase();
});

describe('database initialization', () => {
  it('opens the database at the expected name and version', async () => {
    const db = await openDatabase();
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
  });

  it('creates all six object stores', async () => {
    const db = await openDatabase();
    const names = Array.from(db.objectStoreNames).sort();
    expect(names).toEqual(Object.values(STORE).sort());
  });

  it('creates the declared indices on the bookmarks store', async () => {
    const db = await openDatabase();
    const tx = db.transaction(STORE.bookmarks, 'readonly');
    const indexNames = Array.from(tx.objectStore(STORE.bookmarks).indexNames).sort();
    expect(indexNames).toEqual([
      'idx_category_id',
      'idx_is_deleted',
      'idx_profile_id',
      'idx_updated_at',
    ]);
  });

  it('creates the declared indices on the metrics store', async () => {
    const db = await openDatabase();
    const tx = db.transaction(STORE.metrics, 'readonly');
    const indexNames = Array.from(tx.objectStore(STORE.metrics).indexNames).sort();
    expect(indexNames).toEqual(['idx_click_count', 'idx_visited']);
  });
});

describe('generic CRUD', () => {
  it('round-trips a bookmark through put/get/getAll/remove', async () => {
    const bookmark: BookmarkItem = {
      id: 'bm_1',
      created_at: 1,
      updated_at: 1,
      profile_id: 'p1',
      title: 'Example',
      url: 'https://example.com',
      category_id: 'cat_1',
    };

    await put(STORE.bookmarks, bookmark);

    const fetched = await get<BookmarkItem>(STORE.bookmarks, 'bm_1');
    expect(fetched?.title).toBe('Example');

    const all = await getAll<BookmarkItem>(STORE.bookmarks);
    expect(all).toHaveLength(1);

    await remove(STORE.bookmarks, 'bm_1');
    expect(await get(STORE.bookmarks, 'bm_1')).toBeUndefined();
  });

  it('bulk-writes categories in a single transaction', async () => {
    const categories: CategoryItem[] = [
      { id: 'c1', created_at: 1, updated_at: 1, profile_id: 'p1', name: 'Daily Ops', order: 0 },
      {
        id: 'c2',
        created_at: 1,
        updated_at: 1,
        profile_id: 'p1',
        name: 'Infrastructure',
        order: 1,
      },
    ];

    await bulkPut(STORE.categories, categories);

    const all = await getAll<CategoryItem>(STORE.categories);
    expect(all).toHaveLength(2);
  });

  it('round-trips tasks and notes', async () => {
    const task: TaskItem = {
      id: 't1',
      created_at: 1,
      updated_at: 1,
      profile_id: 'p1',
      title: 'Review logs',
      completed: false,
      completed_at: null,
    };
    const note: NoteItem = {
      id: 'n1',
      created_at: 1,
      updated_at: 1,
      profile_id: 'p1',
      title: 'Scratch',
      content: 'Wireguard Gateway: 10.0.0.1',
      color_tag: 'terracotta',
    };

    await put(STORE.tasks, task);
    await put(STORE.notes, note);

    expect((await get<TaskItem>(STORE.tasks, 't1'))?.title).toBe('Review logs');
    expect((await get<NoteItem>(STORE.notes, 'n1'))?.content).toContain('10.0.0.1');
  });

  it('supports secondary index lookups', async () => {
    await bulkPut<BookmarkItem>(STORE.bookmarks, [
      {
        id: 'b1',
        created_at: 1,
        updated_at: 1,
        profile_id: 'p1',
        title: 'A',
        url: 'https://a.example',
        category_id: 'cat_x',
      },
      {
        id: 'b2',
        created_at: 1,
        updated_at: 1,
        profile_id: 'p1',
        title: 'B',
        url: 'https://b.example',
        category_id: 'cat_y',
      },
    ]);

    const db = await openDatabase();
    const tx = db.transaction(STORE.bookmarks, 'readonly');
    const index = tx.objectStore(STORE.bookmarks).index('idx_category_id');

    const results = await new Promise<BookmarkItem[]>((resolve, reject) => {
      const request = index.getAll('cat_x');
      request.onsuccess = () => resolve(request.result as BookmarkItem[]);
      request.onerror = () => reject(request.error);
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('b1');
  });
});

describe('config store helpers', () => {
  it('returns a deep clone of the defaults when unset', async () => {
    const config = await getAppConfig();
    expect(config).toEqual(DEFAULT_APP_CONFIG);
    expect(config).not.toBe(DEFAULT_APP_CONFIG);
  });

  it('persists and reloads the app config singleton', async () => {
    await setAppConfig({ ...DEFAULT_APP_CONFIG, theme: 'dark', sync_enabled: true });

    const loaded = await getAppConfig();
    expect(loaded.theme).toBe('dark');
    expect(loaded.sync_enabled).toBe(true);
  });

  it('persists and reloads sync metadata', async () => {
    await setSyncMetadata({ last_synced_at: 123, github_last_sha: 'abc123' });

    const meta = await getSyncMetadata();
    expect(meta).toEqual({ last_synced_at: 123, github_last_sha: 'abc123' });
  });
});

describe('metrics store helpers', () => {
  it('increments click_count and stamps last_visited_at', async () => {
    const first = await recordVisit('bm_1', 1000);
    expect(first.click_count).toBe(1);
    expect(first.last_visited_at).toBe(1000);

    const second = await recordVisit('bm_1', 2000);
    expect(second.click_count).toBe(2);
    expect(second.last_visited_at).toBe(2000);

    const metrics = await getMetrics();
    expect(metrics).toHaveLength(1);
  });
});
