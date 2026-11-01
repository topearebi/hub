import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { store } from '../store';
import { STORE, closeDatabase, deleteDatabase, put } from '../db';
import { DEFAULT_PROFILE_ID } from '../../types/schemas';
import type { BookmarkItem } from '../../types/schemas';

beforeEach(async () => {
  await closeDatabase();
  await deleteDatabase();
});

afterAll(async () => {
  await closeDatabase();
  await deleteDatabase();
});

describe('profile migration', () => {
  it('creates a default profile and backfills legacy entities', async () => {
    // Seed a legacy (pre-v2) bookmark with no `profile_id`.
    const legacy = {
      id: 'b1',
      created_at: 1,
      updated_at: 1,
      title: 'Legacy',
      url: 'https://legacy.test',
      category_id: 'c1',
    } as unknown as BookmarkItem;
    await put(STORE.bookmarks, legacy);

    await store.init();

    expect(store.profiles).toHaveLength(1);
    expect(store.profiles[0]?.id).toBe(DEFAULT_PROFILE_ID);
    expect(store.activeProfileId).toBe(DEFAULT_PROFILE_ID);
    expect(store.activeBookmarks.map((b) => b.id)).toEqual(['b1']);
    expect(store.activeBookmarks[0]?.profile_id).toBe(DEFAULT_PROFILE_ID);
  });
});

describe('profile partitioning', () => {
  it('filters entities by the active profile', async () => {
    await store.init();
    const now = Date.now();

    await store.upsertProfile({ id: 'p2', created_at: now, updated_at: now, name: 'Work' });
    await store.upsertBookmark({
      id: 'b1',
      created_at: now,
      updated_at: now,
      profile_id: DEFAULT_PROFILE_ID,
      title: 'Home',
      url: 'https://home.test',
      category_id: 'c1',
    });
    await store.upsertBookmark({
      id: 'b2',
      created_at: now,
      updated_at: now,
      profile_id: 'p2',
      title: 'Work',
      url: 'https://work.test',
      category_id: 'c1',
    });

    await store.setActiveProfile('p2');
    expect(store.activeBookmarks.map((b) => b.id)).toEqual(['b2']);

    await store.setActiveProfile(DEFAULT_PROFILE_ID);
    expect(store.activeBookmarks.map((b) => b.id)).toEqual(['b1']);
  });
});
