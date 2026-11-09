import { SYNCABLE_COLLECTIONS } from '../types/schemas';
import type { HubStoragePayload } from '../types/schemas';

const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
const string = (value: unknown): boolean => typeof value === 'string';
const boolean = (value: unknown): boolean => typeof value === 'boolean';
const nullableNumber = (value: unknown): boolean =>
  value === null || (finite(value) && Number(value) >= 0);
const nullableString = (value: unknown): boolean => value === null || string(value);
const oneOf =
  (...values: unknown[]) =>
  (value: unknown): boolean =>
    values.includes(value);
function url(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname;
  } catch {
    return false;
  }
}
const safeStyle = (value: unknown): boolean =>
  string(value) && !/url\s*\(|@import|expression|[;{}<>]/i.test(String(value));
const shared = {
  id: string,
  created_at: nullableNumber,
  updated_at: nullableNumber,
  is_deleted: boolean,
};
const partitioned = { ...shared, profile_id: string, order: finite };
type Rule = (value: unknown) => boolean;
const fields: Record<string, Record<string, Rule>> = {
  profiles: {
    ...shared,
    name: string,
    avatar: string,
    hub_title: string,
    logo: string,
    default_search_provider_id: string,
    theme: oneOf('auto', 'light', 'dark'),
    sync_path: string,
  },
  bookmarks: {
    ...partitioned,
    title: string,
    url,
    category_id: string,
    alternate_urls: (value) => Array.isArray(value) && value.every(url),
    icon: string,
    hotkey: oneOf('1', '2', '3', '4', '5', '6', '7', '8', '9'),
    card_size: oneOf('small', 'wide', 'large'),
    description: string,
    bg_color: safeStyle,
    text_color: safeStyle,
    border_color: safeStyle,
  },
  categories: { ...partitioned, name: string, collapsed: boolean },
  tasks: {
    ...partitioned,
    title: string,
    description: string,
    completed: boolean,
    completed_at: nullableNumber,
    remind_at: nullableNumber,
    parent_id: nullableString,
    due_date: (value) =>
      value === null || (string(value) && /^\d{4}-\d{2}-\d{2}$/.test(String(value))),
    due_time: (value) =>
      value === null || (string(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))),
    recurrence: oneOf(null, 'daily', 'weekly', 'monthly', 'yearly'),
  },
  notes: { ...partitioned, title: string, content: string, is_pinned: boolean, color_tag: string },
};
const required: Record<string, string[]> = {
  profiles: ['name'],
  bookmarks: ['profile_id', 'title', 'url', 'category_id'],
  categories: ['profile_id', 'name', 'order'],
  tasks: ['profile_id', 'title', 'completed'],
  notes: ['profile_id', 'title', 'content'],
};
/** Validate every record before it reaches IndexedDB or UI code. */
export function validatePayload(payload: HubStoragePayload): void {
  if (!finite(payload.last_synced_at) || payload.last_synced_at < 0)
    throw new Error('Invalid snapshot timestamp');
  for (const key of SYNCABLE_COLLECTIONS) {
    const seen = new Set<string>();
    for (const item of payload[key]) {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error('Invalid record');
      const record = item as unknown as Record<string, unknown>;
      if (
        !['id', 'created_at', 'updated_at', ...required[key]!].every(
          (name) => record[name] !== undefined && record[name] !== null,
        )
      )
        throw new Error('Missing required field');
      if (typeof record.id !== 'string' || !record.id.trim() || seen.has(record.id))
        throw new Error('Invalid or duplicate ID');
      seen.add(record.id);
      for (const [name, value] of Object.entries(record)) {
        if (value !== undefined && !fields[key]![name]?.(value))
          throw new Error('Invalid record field');
      }
      if (!finite(record.created_at) || !finite(record.updated_at))
        throw new Error('Invalid timestamp');
    }
  }
  const profiles = new Set(payload.profiles.map((item) => item.id));
  for (const key of ['bookmarks', 'categories', 'tasks', 'notes'] as const) {
    if (payload[key].some((item) => !item.profile_id.trim() || !profiles.has(item.profile_id)))
      throw new Error('Missing profile reference');
  }
  const tasks = new Map(payload.tasks.map((item) => [item.id, item]));
  for (const task of payload.tasks) {
    const visited = new Set([task.id]);
    let parent = task.parent_id;
    while (parent) {
      if (visited.has(parent)) throw new Error('Cyclic task hierarchy');
      visited.add(parent);
      parent = tasks.get(parent)?.parent_id;
    }
  }
}
