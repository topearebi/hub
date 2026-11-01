/**
 * Hub BYOS Sync Engine
 * --------------------
 * GitHub REST client + deterministic merge logic for the Bring-Your-Own-Storage
 * model (PRD §4.2, SCHEMAS.md §5).
 *
 * Headless by design: this module depends only on `fetch` and timers. DOM
 * lifecycle listeners (focus / visibility) are attached by `main.ts`, keeping
 * the core reusable and unit-testable.
 */

import { DEFAULT_PROFILE_ID } from '../types/schemas';
import type {
  AppConfig,
  BookmarkItem,
  CategoryItem,
  HubStoragePayload,
  NoteItem,
  ProfileItem,
  SyncableEntity,
  TaskItem,
} from '../types/schemas';

/** Legacy v1 payload shape (no profiles, unpartitioned entities). */
interface HubStoragePayloadV1 {
  version: 1;
  last_synced_at: number;
  bookmarks: BookmarkItem[];
  categories: CategoryItem[];
  tasks: TaskItem[];
  notes: NoteItem[];
}

const API_BASE = 'https://api.github.com';

/** Tombstones are retained for 30 days before permanent culling (SCHEMAS.md §5.3). */
export const TOMBSTONE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** Default debounce window for batched commits (PRD §3.2: 3–5s). */
export const DEFAULT_DEBOUNCE_MS = 4000;

export type FetchLike = typeof fetch;

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}

export interface RemoteFile {
  content: string;
  sha: string;
}

export interface ConnectionResult {
  ok: boolean;
  canWrite: boolean;
  message: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

/* ------------------------------------------------------------------ */
/* Pure merge logic (unit-tested)                                      */
/* ------------------------------------------------------------------ */

/**
 * Deterministic Last-Write-Wins merge (SCHEMAS.md §5.2).
 *
 * Local records seed the map; remote records are adopted when absent or when
 * strictly newer (`remote.updated_at > local.updated_at`). Ties keep local.
 */
export function mergeCollection<T extends SyncableEntity>(
  localEntities: readonly T[],
  remoteEntities: readonly T[],
): T[] {
  const merged = new Map<string, T>();

  for (const item of localEntities) {
    merged.set(item.id, item);
  }

  for (const remoteItem of remoteEntities) {
    const localItem = merged.get(remoteItem.id);
    if (!localItem || remoteItem.updated_at > localItem.updated_at) {
      merged.set(remoteItem.id, remoteItem);
    }
  }

  return Array.from(merged.values());
}

/** Merge every syncable collection (including profiles) of two payloads. */
export function mergePayloads(
  local: HubStoragePayload,
  remote: HubStoragePayload,
  now: number = Date.now(),
): HubStoragePayload {
  return {
    version: 2,
    last_synced_at: now,
    profiles: mergeCollection(local.profiles, remote.profiles),
    bookmarks: mergeCollection(local.bookmarks, remote.bookmarks),
    categories: mergeCollection(local.categories, remote.categories),
    tasks: mergeCollection(local.tasks, remote.tasks),
    notes: mergeCollection(local.notes, remote.notes),
  };
}

/** Drop tombstones whose grace period has elapsed. */
export function cullTombstones<T extends SyncableEntity>(
  entities: readonly T[],
  now: number = Date.now(),
): T[] {
  return entities.filter(
    (entity) => entity.is_deleted !== true || now - entity.updated_at <= TOMBSTONE_GRACE_MS,
  );
}

/** Apply tombstone culling across every collection of a payload. */
export function cullPayloadTombstones(
  payload: HubStoragePayload,
  now: number = Date.now(),
): HubStoragePayload {
  return {
    version: 2,
    last_synced_at: payload.last_synced_at,
    profiles: cullTombstones(payload.profiles, now),
    bookmarks: cullTombstones(payload.bookmarks, now),
    categories: cullTombstones(payload.categories, now),
    tasks: cullTombstones(payload.tasks, now),
    notes: cullTombstones(payload.notes, now),
  };
}

/** Serialize a payload as pretty-printed JSON (2-space indent). */
export function serializePayload(payload: HubStoragePayload): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse and validate a payload, throwing on malformed input. v1 payloads are
 * transparently migrated to v2 (a default profile is created and every entity
 * is assigned to it) so older backups and remote files keep working.
 */
export function parsePayload(json: string): HubStoragePayload {
  const data: unknown = JSON.parse(json);
  if (isHubStoragePayloadV2(data)) {
    return data;
  }
  if (isHubStoragePayloadV1(data)) {
    return migrateV1ToV2(data);
  }
  throw new Error('Invalid Hub payload.');
}

/** Migrate a legacy v1 payload into the v2 profile-partitioned shape. */
export function migrateV1ToV2(v1: HubStoragePayloadV1): HubStoragePayload {
  const now = Date.now();
  const profile: ProfileItem = {
    id: DEFAULT_PROFILE_ID,
    created_at: now,
    updated_at: now,
    name: 'Default',
    hub_title: 'Hub',
  };

  const assign = <T extends { profile_id?: string }>(items: T[]): T[] =>
    items.map((item) => (item.profile_id ? item : { ...item, profile_id: profile.id }));

  return {
    version: 2,
    last_synced_at: v1.last_synced_at,
    profiles: [profile],
    bookmarks: assign(v1.bookmarks),
    categories: assign(v1.categories),
    tasks: assign(v1.tasks),
    notes: assign(v1.notes),
  };
}

function isHubStoragePayloadV2(value: unknown): value is HubStoragePayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === 2 &&
    Array.isArray(record.profiles) &&
    Array.isArray(record.bookmarks) &&
    Array.isArray(record.categories) &&
    Array.isArray(record.tasks) &&
    Array.isArray(record.notes)
  );
}

function isHubStoragePayloadV1(value: unknown): value is HubStoragePayloadV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    Array.isArray(record.bookmarks) &&
    Array.isArray(record.categories) &&
    Array.isArray(record.tasks) &&
    Array.isArray(record.notes)
  );
}

/* ------------------------------------------------------------------ */
/* Config helpers                                                      */
/* ------------------------------------------------------------------ */

/** True when the minimum GitHub credentials are present. */
export function hasGitHubConfig(config: AppConfig): boolean {
  return Boolean(config.github_pat && config.github_owner && config.github_repo);
}

/** Narrow an AppConfig into the GitHub client config. */
export function toGitHubConfig(config: AppConfig): GitHubConfig {
  return {
    token: config.github_pat ?? '',
    owner: config.github_owner ?? '',
    repo: config.github_repo ?? '',
    branch: config.github_branch,
    filePath: config.github_file_path,
  };
}

/* ------------------------------------------------------------------ */
/* Base64 helpers (UTF-8 safe)                                         */
/* ------------------------------------------------------------------ */

function decodeBase64(input: string): string {
  const binary = atob(input.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/* ------------------------------------------------------------------ */
/* GitHub REST client                                                  */
/* ------------------------------------------------------------------ */

/** Read the remote file, returning `null` when it does not exist (404). */
export async function fetchRemoteFile(
  config: GitHubConfig,
  fetchImpl: FetchLike = fetch,
): Promise<RemoteFile | null> {
  const url = `${API_BASE}/repos/${config.owner}/${config.repo}/contents/${config.filePath}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetchImpl(url, { headers: authHeaders(config.token) });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub read failed (${response.status}).`);
  }

  const data = (await response.json()) as { content?: string; sha?: string; encoding?: string };
  if (typeof data.sha !== 'string') {
    throw new Error('Malformed GitHub response.');
  }

  const content =
    data.encoding === 'base64' && typeof data.content === 'string'
      ? decodeBase64(data.content)
      : (data.content ?? '');

  return { content, sha: data.sha };
}

/** Create or update the remote file, returning the new blob SHA. */
export async function putRemoteFile(
  config: GitHubConfig,
  content: string,
  sha: string | undefined,
  message: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const url = `${API_BASE}/repos/${config.owner}/${config.repo}/contents/${config.filePath}`;
  const body: Record<string, unknown> = {
    message,
    content: encodeBase64(content),
    branch: config.branch,
  };
  if (sha) {
    body.sha = sha;
  }

  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: { ...authHeaders(config.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`GitHub write failed (${response.status}).`);
  }

  const data = (await response.json()) as { content?: { sha?: string } };
  return data.content?.sha ?? '';
}

/**
 * Verify the token can read the repository and has push permission. Uses the
 * repo `permissions.push` flag so no commit is created during the test.
 */
export async function testConnection(
  config: GitHubConfig,
  fetchImpl: FetchLike = fetch,
): Promise<ConnectionResult> {
  const url = `${API_BASE}/repos/${config.owner}/${config.repo}`;
  const response = await fetchImpl(url, { headers: authHeaders(config.token) });

  if (response.status === 401) {
    return { ok: false, canWrite: false, message: 'Invalid or expired token.' };
  }
  if (response.status === 404) {
    return { ok: false, canWrite: false, message: 'Repository not found or token lacks access.' };
  }
  if (!response.ok) {
    return { ok: false, canWrite: false, message: `GitHub error (${response.status}).` };
  }

  const data = (await response.json()) as { permissions?: { push?: boolean } };
  const canWrite = data.permissions?.push === true;

  return {
    ok: true,
    canWrite,
    message: canWrite
      ? 'Connection verified with write access.'
      : 'Connected, but the token lacks write access.',
  };
}

/* ------------------------------------------------------------------ */
/* Sync engine (debounced batching)                                    */
/* ------------------------------------------------------------------ */

export interface SyncEngineOptions {
  getConfig: () => AppConfig;
  getPayload: () => HubStoragePayload;
  applyRemote: (payload: HubStoragePayload) => Promise<void>;
  onStatus?: (status: SyncStatus) => void;
  onSha?: (sha: string) => void;
  fetchImpl?: FetchLike;
  debounceMs?: number;
}

/**
 * Batches local mutations into a single debounced commit and reconciles remote
 * changes on demand. Network calls are strictly event-driven (no polling).
 */
export class SyncEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;

  constructor(private readonly options: SyncEngineOptions) {}

  /** Queue a debounced push after a local mutation. */
  schedule(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pushNow();
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  /** Merge local + remote, cull tombstones, and commit the result. */
  async pushNow(): Promise<void> {
    if (this.busy) {
      return;
    }
    const config = this.options.getConfig();
    if (!config.sync_enabled || !hasGitHubConfig(config)) {
      return;
    }

    this.busy = true;
    this.options.onStatus?.('syncing');
    try {
      const gh = toGitHubConfig(config);
      const remote = await fetchRemoteFile(gh, this.options.fetchImpl);
      const local = this.options.getPayload();
      const merged = remote ? mergePayloads(local, parsePayload(remote.content)) : local;
      const content = serializePayload(cullPayloadTombstones(merged));
      const sha = await putRemoteFile(
        gh,
        content,
        remote?.sha,
        'chore(hub): sync data',
        this.options.fetchImpl,
      );
      if (sha) {
        this.options.onSha?.(sha);
      }
      // A push merges remote into `merged` before writing, but the local store
      // still holds the pre-merge snapshot. Reconcile remote-only changes back
      // into local state so the UI reflects what was actually committed.
      if (remote) {
        await this.options.applyRemote(merged);
      }
      this.options.onStatus?.('synced');
    } catch {
      this.options.onStatus?.('error');
    } finally {
      this.busy = false;
    }
  }

  /** Fetch remote changes and merge them into local state. */
  async pullNow(): Promise<void> {
    const config = this.options.getConfig();
    if (!config.sync_enabled || !hasGitHubConfig(config)) {
      return;
    }

    try {
      const remote = await fetchRemoteFile(toGitHubConfig(config), this.options.fetchImpl);
      if (!remote) {
        return;
      }
      const merged = mergePayloads(this.options.getPayload(), parsePayload(remote.content));
      await this.options.applyRemote(merged);
      this.options.onStatus?.('synced');
    } catch {
      this.options.onStatus?.('error');
    }
  }

  /** Cancel any pending debounced push. */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
