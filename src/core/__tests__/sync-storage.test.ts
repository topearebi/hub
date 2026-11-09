import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORE,
  closeDatabase,
  deleteDatabase,
  get,
  getSyncMetadata,
  persistSyncPayload,
  put,
  readSyncPayload,
  setSyncMetadata,
} from '../db';
import { refreshConflictLocal, resolveSyncConflict } from '../sync-conflicts';
import type { BookmarkItem, HubStoragePayload } from '../../types/schemas';
import type { SyncConflict } from '../sync-merge';
const book: BookmarkItem = {
  id: 'b',
  profile_id: 'p',
  category_id: '',
  title: 'Original',
  url: 'https://example.test',
  created_at: 1,
  updated_at: 1,
};
const snapshot = (bookmarks: BookmarkItem[] = [book]): HubStoragePayload => ({
  version: 2,
  last_synced_at: 0,
  profiles: [{ id: 'p', name: 'Profile', created_at: 1, updated_at: 1 }],
  categories: [],
  bookmarks,
  tasks: [],
  notes: [],
});
beforeEach(async () => {
  await closeDatabase();
  await deleteDatabase();
});
afterAll(async () => {
  await closeDatabase();
  await deleteDatabase();
});
describe('atomic sync storage', () => {
  it('rolls back all collection writes after any write failure', async () => {
    const before = snapshot();
    await persistSyncPayload(before, snapshot([]), () => snapshot([]));
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === STORE.notes) throw new DOMException('Disk full', 'QuotaExceededError');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    });
    const incoming = {
      ...snapshot([{ ...book, title: 'Changed' }]),
      notes: [
        { id: 'n', profile_id: 'p', title: 'Note', content: 'Text', created_at: 1, updated_at: 1 },
      ],
    };
    await expect(persistSyncPayload(incoming, before, () => before)).rejects.toThrow();
    spy.mockRestore();
    expect((await readSyncPayload()).bookmarks).toEqual([book]);
    expect((await readSyncPayload()).notes).toEqual([]);
  });
  it('preserves another tab edit committed after the network snapshot', async () => {
    const before = snapshot();
    await put(STORE.bookmarks, { ...book, title: 'Other tab' });
    const result = await persistSyncPayload(
      snapshot([{ ...book, title: 'Incoming' }]),
      before,
      () => before,
    );
    expect(result.bookmarks[0]?.title).toBe('Other tab');
  });
  it('clears old records when applying an explicit replacement snapshot', async () => {
    const before = snapshot();
    await put(STORE.bookmarks, book);
    await persistSyncPayload(snapshot([]), before, () => before);
    expect((await readSyncPayload()).bookmarks).toEqual([]);
  });
});
describe('conflict resolution transaction', () => {
  const conflict: SyncConflict = {
    collection: 'bookmarks',
    id: 'b',
    local: book,
    remote: { ...book, title: 'Remote', updated_at: 2 },
  };
  async function seed() {
    await put(STORE.bookmarks, book);
    await setSyncMetadata({ last_synced_at: 0, targets: { target: { conflicts: [conflict] } } });
  }
  it('commits the chosen record and accepted remote ancestor together', async () => {
    await seed();
    await resolveSyncConflict('target', conflict, 'local');
    expect((await get<BookmarkItem>(STORE.bookmarks, 'b'))?.title).toBe('Original');
    const state = (await getSyncMetadata())?.targets?.target;
    expect(state?.conflicts).toEqual([]);
    expect(state?.baseline?.bookmarks).toEqual([conflict.remote]);
  });
  it('refuses a stale resolution after another local edit', async () => {
    await seed();
    await put(STORE.bookmarks, { ...book, title: 'Latest' });
    await expect(resolveSyncConflict('target', conflict, 'remote')).rejects.toThrow('changed');
    expect((await get<BookmarkItem>(STORE.bookmarks, 'b'))?.title).toBe('Latest');
    expect((await getSyncMetadata())?.targets?.target?.conflicts).toHaveLength(1);
  });
});

it('refreshes the candidate from disk without recreating another tab resolved conflict', async () => {
  const conflict = {
    collection: 'bookmarks' as const,
    id: 'b',
    local: book,
    remote: { ...book, title: 'Other' },
  };
  await put(STORE.bookmarks, { ...book, title: 'New edit' });
  await setSyncMetadata({ last_synced_at: 0, targets: { target: { conflicts: [conflict] } } });
  expect((await refreshConflictLocal('target', conflict))?.local).toMatchObject({
    title: 'New edit',
  });
  await setSyncMetadata({ last_synced_at: 0, targets: { target: { conflicts: [] } } });
  expect(await refreshConflictLocal('target', conflict)).toBeUndefined();
  expect((await getSyncMetadata())?.targets?.target?.conflicts).toEqual([]);
});
