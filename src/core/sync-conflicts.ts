import { openDatabase, STORE } from './db';
import type { SyncMetadata } from './db';
import { canonical } from './sync-merge';
import type { SyncConflict } from './sync-merge';

/** Resolve one frozen conflict and advance its ancestor in the same transaction. */
export async function resolveSyncConflict(
  target: string,
  expected: SyncConflict,
  choice: 'local' | 'remote',
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE.config, expected.collection], 'readwrite');
    const config = tx.objectStore(STORE.config);
    const records = tx.objectStore(expected.collection);
    const metadataRequest = config.get('sync_metadata');
    const localRequest = records.get(expected.id);
    let failure: Error | undefined;
    const finish = (): void => {
      if (metadataRequest.readyState !== 'done' || localRequest.readyState !== 'done') return;
      try {
        const metadata = metadataRequest.result?.value as SyncMetadata | undefined;
        const state = metadata?.targets?.[target];
        const conflict = state?.conflicts?.find(
          (item) => item.id === expected.id && item.collection === expected.collection,
        );
        if (
          !metadata ||
          !state ||
          !conflict ||
          canonical(conflict) !== canonical(expected) ||
          canonical(localRequest.result) !== canonical(expected.local)
        )
          throw new Error('changed');
        const selected = {
          ...conflict[choice],
          updated_at: Math.max(
            Date.now(),
            conflict.local.updated_at + 1,
            conflict.remote.updated_at + 1,
          ),
        };
        records.put(selected);
        if (state.baseline) {
          Object.assign(state.baseline, {
            [expected.collection]: [
              ...state.baseline[expected.collection].filter((item) => item.id !== expected.id),
              conflict.remote,
            ],
          });
        } else {
          // On a first sync, this ID now has an explicitly accepted remote ancestor.
          state.baseline = {
            version: 2,
            last_synced_at: 0,
            profiles: [],
            bookmarks: [],
            categories: [],
            tasks: [],
            notes: [],
          };
          Object.assign(state.baseline, { [expected.collection]: [conflict.remote] });
        }
        state.conflicts = state.conflicts!.filter((item) => item !== conflict);
        config.put({ key: 'sync_metadata', value: metadata });
      } catch (error) {
        failure = error instanceof Error ? error : new Error('storage');
        tx.abort();
      }
    };
    metadataRequest.onsuccess = localRequest.onsuccess = finish;
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('storage'));
  });
}

/** Refresh a displayed candidate without overwriting another tab's resolutions. */
export async function refreshConflictLocal(
  target: string,
  expected: SyncConflict,
): Promise<SyncConflict | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE.config, expected.collection], 'readwrite');
    const config = tx.objectStore(STORE.config);
    const metadataRequest = config.get('sync_metadata');
    const recordRequest = tx.objectStore(expected.collection).get(expected.id);
    let result: SyncConflict | undefined;
    const finish = (): void => {
      if (metadataRequest.readyState !== 'done' || recordRequest.readyState !== 'done') return;
      const metadata = metadataRequest.result?.value as SyncMetadata | undefined;
      result = metadata?.targets?.[target]?.conflicts?.find(
        (item) => item.collection === expected.collection && item.id === expected.id,
      );
      if (
        result &&
        recordRequest.result &&
        canonical(result.local) !== canonical(recordRequest.result)
      ) {
        result.local = recordRequest.result as SyncConflict['local'];
        config.put({ key: 'sync_metadata', value: metadata });
      }
    };
    metadataRequest.onsuccess = recordRequest.onsuccess = finish;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('storage'));
  });
}
