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

describe('legacy entity backfill', () => {
  it('assigns unpartitioned entities to the active profile even when one exists', async () => {
    const now = Date.now();
    // A profile already exists (e.g. restored from sync) while a legacy record
    // has no `profile_id`.
    await put(STORE.profiles, { id: 'p1', created_at: now, updated_at: now, name: 'Existing' });
    await put(STORE.bookmarks, {
      id: 'b1',
      created_at: now,
      updated_at: now,
      title: 'Legacy',
      url: 'https://legacy.test',
      category_id: 'c1',
    } as unknown as BookmarkItem);

    await store.init();

    // The record must be visible and stamped with the active profile id.
    expect(store.activeBookmarks.map((b) => b.id)).toEqual(['b1']);
    expect(store.getBookmark('b1')?.profile_id).toBe('p1');
  });
});

describe('profile deletion', () => {
  it('creates a replacement profile when the last profile is deleted', async () => {
    await store.init();
    expect(store.profiles).toHaveLength(1);

    await store.softDeleteProfile(DEFAULT_PROFILE_ID);

    // A fresh live profile replaces the tombstone so the app stays usable and
    // new entities are never stamped with a deleted profile id.
    expect(store.profiles).toHaveLength(1);
    expect(store.profiles[0]?.id).not.toBe(DEFAULT_PROFILE_ID);
    expect(store.activeProfile?.is_deleted).not.toBe(true);
    expect(store.activeProfileId).toBe(store.profiles[0]?.id);
  });
});

describe('task cascade delete', () => {
  it('soft-deletes subtasks when a parent is deleted', async () => {
    await store.init();
    const now = Date.now();

    await store.upsertTask({
      id: 'p',
      created_at: now,
      updated_at: now,
      profile_id: DEFAULT_PROFILE_ID,
      title: 'Parent',
      completed: false,
      completed_at: null,
    });
    await store.upsertTask({
      id: 'c',
      created_at: now,
      updated_at: now,
      profile_id: DEFAULT_PROFILE_ID,
      title: 'Child',
      completed: false,
      completed_at: null,
      parent_id: 'p',
    });

    await store.softDeleteTask('p');

    // Both the parent and its subtask are removed from the active list.
    expect(store.activeTasks.map((t) => t.id)).toEqual([]);
  });
});

describe('profile cascade delete & restore (SCHEMAS.md §5.4)', () => {
  it('tombstones the profile and its items together, then restores exactly those', async () => {
    await store.init();
    const now = Date.now();

    await store.upsertProfile({ id: 'p2', created_at: now, updated_at: now, name: 'Work' });
    await store.upsertCategory({
      id: 'c2',
      created_at: now,
      updated_at: now,
      profile_id: 'p2',
      name: 'Work',
      order: 0,
    });
    await store.upsertBookmark({
      id: 'b2',
      created_at: now,
      updated_at: now,
      profile_id: 'p2',
      title: 'W',
      url: 'https://w.test',
      category_id: 'c2',
    });
    await store.upsertTask({
      id: 't2',
      created_at: now,
      updated_at: now,
      profile_id: 'p2',
      title: 'T',
      completed: false,
      completed_at: null,
    });
    await store.upsertNote({
      id: 'n2',
      created_at: now,
      updated_at: now,
      profile_id: 'p2',
      title: 'N',
      content: 'x',
    });
    // An item deleted individually *before* the profile keeps its own timestamp.
    await store.upsertBookmark({
      id: 'b3',
      created_at: now,
      updated_at: now - 1000,
      profile_id: 'p2',
      title: 'Old',
      url: 'https://old.test',
      category_id: 'c2',
      is_deleted: true,
    });

    await store.setActiveProfile('p2');
    const deleteAt = now + 5000;
    await store.softDeleteProfile('p2', deleteAt);

    // The profile and its live children are tombstoned with the shared timestamp.
    expect(store.profiles.some((p) => p.id === 'p2')).toBe(false);
    expect(store.activeBookmarks.map((b) => b.id)).not.toContain('b2');
    expect(store.getBookmark('b3')?.updated_at).toBe(now - 1000);

    // The deleted profile is listed with the counts a restore would revive.
    const entry = store.deletedProfiles.find((e) => e.profile.id === 'p2');
    expect(entry?.counts).toEqual({ bookmarks: 1, tasks: 1, notes: 1, categories: 1 });

    // Restore revives exactly the cascaded records.
    const restoreAt = deleteAt + 5000;
    await store.restoreProfile('p2', restoreAt);
    expect(store.profiles.some((p) => p.id === 'p2')).toBe(true);
    await store.setActiveProfile('p2');
    expect(store.activeBookmarks.map((b) => b.id)).toContain('b2');
    expect(store.activeTasks.map((t) => t.id)).toContain('t2');
    expect(store.activeNotes.map((n) => n.id)).toContain('n2');
    // The individually deleted item stays deleted.
    expect(store.activeBookmarks.map((b) => b.id)).not.toContain('b3');
  });

  it('ends recovery while retaining profile and child deletion markers', async () => {
    await store.init();
    const now = Date.now();
    await store.upsertProfile({ id: 'p3', created_at: now, updated_at: now, name: 'Temp' });
    await store.upsertBookmark({
      id: 'b4',
      created_at: now,
      updated_at: now,
      profile_id: 'p3',
      title: 'X',
      url: 'https://x.test',
      category_id: 'c3',
    });
    await store.softDeleteProfile('p3', now + 1);
    await store.permanentlyDeleteProfile('p3');

    expect(store.getBookmark('b4')?.is_deleted).toBe(true);
    expect(store.deletedProfiles.some((e) => e.profile.id === 'p3')).toBe(false);
  });

  it('sorts bookmarks by order ascending and batch updates with upsertBookmarks', async () => {
    await store.init();
    const now = Date.now();
    const b1: BookmarkItem = {
      id: 'b1',
      created_at: now,
      updated_at: now,
      profile_id: DEFAULT_PROFILE_ID,
      title: 'B1',
      url: 'https://b1.test',
      category_id: 'c1',
      order: 1,
    };
    const b2: BookmarkItem = {
      id: 'b2',
      created_at: now + 1,
      updated_at: now + 1,
      profile_id: DEFAULT_PROFILE_ID,
      title: 'B2',
      url: 'https://b2.test',
      category_id: 'c1',
      order: 0,
    };
    await store.upsertBookmarks([b1, b2]);

    const sorted = store.getBookmarksByCategory('c1');
    expect(sorted.map((b) => b.id)).toEqual(['b2', 'b1']);

    // Reorder
    await store.upsertBookmarks([
      { ...b1, order: 0 },
      { ...b2, order: 1 },
    ]);
    const reordered = store.getBookmarksByCategory('c1');
    expect(reordered.map((b) => b.id)).toEqual(['b1', 'b2']);
  });
});
