import { SYNCABLE_COLLECTIONS } from '../types/schemas';
import type { HubStoragePayload, SyncableCollection, SyncableEntity } from '../types/schemas';

export type SyncRecord = HubStoragePayload[SyncableCollection][number];
export interface SyncConflict {
  collection: SyncableCollection;
  id: string;
  local: SyncRecord;
  remote: SyncRecord;
}
export interface SyncTargetState {
  baseline?: HubStoragePayload;
  conflicts?: SyncConflict[];
}

/** Stable comparisons ignore object key order, never user content. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }
    return item;
  });
}
export function payloadFingerprint(payload: HubStoragePayload): string {
  return canonical(
    SYNCABLE_COLLECTIONS.map((key) => [...payload[key]].sort((a, b) => a.id.localeCompare(b.id))),
  );
}
function content(item: SyncableEntity | undefined): string {
  if (!item) return '';
  const values = Object.fromEntries(
    Object.entries(item).filter(([key]) => !['created_at', 'updated_at'].includes(key)),
  );
  return canonical({
    ...values,
    is_deleted: item.is_deleted === true,
    ...(item.is_deleted ? { deleted_at: item.updated_at } : {}),
  });
}
/** Keep local records changed since a request snapshot, even on timestamp ties. */
export function rebasePayload(
  before: HubStoragePayload,
  current: HubStoragePayload,
  incoming: HubStoragePayload,
): HubStoragePayload {
  const result = { ...incoming };
  for (const key of SYNCABLE_COLLECTIONS) {
    const base = new Map(before[key].map((item) => [item.id, canonical(item)]));
    const merged = new Map<string, SyncRecord>(incoming[key].map((item) => [item.id, item]));
    for (const item of current[key]) {
      if (base.get(item.id) !== canonical(item)) merged.set(item.id, item);
    }
    Object.assign(result, { [key]: [...merged.values()] });
  }
  return result;
}
/** Three-way, whole-record reconciliation. Divergent edits are never discarded. */
export function reconcilePayloads(
  local: HubStoragePayload,
  remote: HubStoragePayload,
  baseline?: HubStoragePayload,
): { payload: HubStoragePayload; conflicts: SyncConflict[] } {
  const payload = { ...local, last_synced_at: Date.now() };
  const conflicts: SyncConflict[] = [];
  for (const key of SYNCABLE_COLLECTIONS) {
    const left = new Map<string, SyncRecord>(local[key].map((item) => [item.id, item]));
    const right = new Map<string, SyncRecord>(remote[key].map((item) => [item.id, item]));
    const base = new Map<string, SyncRecord>(baseline?.[key].map((item) => [item.id, item]) ?? []);
    const merged: SyncRecord[] = [];
    for (const id of new Set([...left.keys(), ...right.keys(), ...base.keys()])) {
      const a = left.get(id),
        b = right.get(id),
        ancestor = base.get(id);
      if (!a || !b) {
        const item = a ?? b;
        if (
          ancestor?.is_deleted &&
          item &&
          item.is_deleted !== true &&
          item.updated_at <= ancestor.updated_at
        ) {
          merged.push(ancestor);
        } else if (item) merged.push(item);
        else if (ancestor?.is_deleted) merged.push(ancestor);
        continue;
      }
      if (content(a) === content(b)) {
        merged.push(a.updated_at > b.updated_at ? a : b);
      } else if (ancestor && content(a) === content(ancestor)) {
        merged.push(b);
      } else if (ancestor && content(b) === content(ancestor)) {
        merged.push(a);
      } else {
        conflicts.push({ collection: key, id, local: a, remote: b });
        merged.push(a);
      }
    }
    Object.assign(payload, { [key]: merged });
  }
  return { payload, conflicts };
}
