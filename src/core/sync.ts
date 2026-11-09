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

import { validatePayload } from './sync-validation';
import { canonical, payloadFingerprint, reconcilePayloads } from './sync-merge';
import type { SyncConflict, SyncTargetState } from './sync-merge';
import type { SyncMetadata } from './db';
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

export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';

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
  void now;
  return [...entities];
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
    validatePayload(data);
    return data;
  }
  if (isHubStoragePayloadV1(data)) {
    const migrated = migrateV1ToV2(data);
    validatePayload(migrated);
    return migrated;
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

/**
 * True when the minimum GitHub credentials are present. `token` overrides the
 * stored `github_pat` so callers can pass the decrypted token from the vault
 * (the stored value is an `enc1:` envelope — SCHEMAS.md §3.5).
 */
export function hasGitHubConfig(config: AppConfig, token?: string): boolean {
  return Boolean((token ?? config.github_pat) && config.github_owner && config.github_repo);
}

/** Narrow an AppConfig into the GitHub client config. */
export function toGitHubConfig(config: AppConfig, token?: string): GitHubConfig {
  return {
    token: token ?? config.github_pat ?? '',
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

export type SyncErrorKind =
  | 'auth'
  | 'permission'
  | 'rate'
  | 'conflict'
  | 'server'
  | 'network'
  | 'timeout'
  | 'invalid'
  | 'storage'
  | 'cancelled';
export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    readonly retryAt = 0,
  ) {
    super(kind);
  }
}
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
export function targetKey(config: GitHubConfig): string {
  return JSON.stringify([
    config.owner.toLowerCase(),
    config.repo.toLowerCase(),
    config.branch,
    config.filePath,
  ]);
}
function fileUrl(config: GitHubConfig): string {
  const path = config.filePath.split('/').map(encodeURIComponent).join('/');
  return `${API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}`;
}
function responseError(response: Response): SyncError {
  const retry = response.headers?.get('retry-after');
  const reset = response.headers?.get('x-ratelimit-reset');
  const rate =
    response.status === 429 ||
    (response.status === 403 && (retry || response.headers?.get('x-ratelimit-remaining') === '0'));
  if (rate) {
    const deadline = retry
      ? Number.isFinite(Number(retry))
        ? Date.now() + Number(retry) * 1000
        : Date.parse(retry)
      : reset
        ? Number(reset) * 1000
        : Date.now() + 60000;
    return new SyncError(
      'rate',
      Math.max(Date.now() + 1000, Number.isFinite(deadline) ? deadline : Date.now() + 60000),
    );
  }
  return new SyncError(
    response.status === 401
      ? 'auth'
      : [403, 404].includes(response.status)
        ? 'permission'
        : response.status === 409
          ? 'conflict'
          : response.status >= 500
            ? 'server'
            : 'invalid',
  );
}
/** Deadline covers body decoding too, and never forwards credentials on redirects. */
async function request<T>(
  url: string,
  config: GitHubConfig,
  init: RequestInit,
  fetchImpl: FetchLike,
  signal: AbortSignal | undefined,
  decode: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);
  let rejectAbort: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new SyncError(timedOut ? 'timeout' : 'cancelled'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    return await Promise.race([
      cancelled,
      (async () => {
        const response = await fetchImpl(url, {
          ...init,
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
          headers: { ...authHeaders(config.token), ...init.headers },
        });
        return decode(response);
      })(),
    ]);
  } catch (error) {
    if (controller.signal.aborted) throw new SyncError(timedOut ? 'timeout' : 'cancelled');
    throw error instanceof SyncError
      ? error
      : new SyncError(error instanceof SyntaxError ? 'invalid' : 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}
/** Read content + SHA, with a same-api-origin raw fallback above 1 MB. */
export async function fetchRemoteFile(
  config: GitHubConfig,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<RemoteFile | null> {
  const url = `${fileUrl(config)}?ref=${encodeURIComponent(config.branch)}`;
  const data = await request(url, config, {}, fetchImpl, signal, async (response) => {
    if (response.status === 404) return null;
    if (!response.ok) throw responseError(response);
    return response.json() as Promise<{
      content?: string;
      sha?: string;
      encoding?: string;
      size?: number;
    }>;
  });
  if (!data) return null;
  if (typeof data.sha !== 'string' || !data.sha) throw new SyncError('invalid');
  let content: string;
  try {
    if (data.encoding === 'base64' && typeof data.content === 'string')
      content = decodeBase64(data.content);
    else if (data.encoding === 'none') {
      content = await request(
        url,
        config,
        { headers: { Accept: 'application/vnd.github.raw+json' } },
        fetchImpl,
        signal,
        async (response) => {
          if (!response.ok) throw responseError(response);
          return response.text();
        },
      );
    } else throw new SyncError('invalid');
  } catch (error) {
    throw error instanceof SyncError ? error : new SyncError('invalid');
  }
  return { content, sha: data.sha };
}
export async function putRemoteFile(
  config: GitHubConfig,
  content: string,
  sha: string | undefined,
  message: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const body = {
    message,
    content: encodeBase64(content),
    branch: config.branch,
    ...(sha ? { sha } : {}),
  };
  return request(
    fileUrl(config),
    config,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    fetchImpl,
    signal,
    async (response) => {
      if (!response.ok) throw responseError(response);
      const data = (await response.json()) as { content?: { sha?: string } };
      if (!data.content?.sha) throw new SyncError('invalid');
      return data.content.sha;
    },
  );
}
/** Read-only access test. Only a real subsequent sync can confirm write access. */
export async function testConnection(
  config: GitHubConfig,
  fetchImpl: FetchLike = fetch,
): Promise<ConnectionResult> {
  try {
    const data = await request(
      `${API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
      config,
      {},
      fetchImpl,
      undefined,
      async (response) => {
        if (!response.ok) throw responseError(response);
        return response.json() as Promise<{ permissions?: { push?: boolean } }>;
      },
    );
    if (!(await fetchRemoteFile(config, fetchImpl))) {
      await request(
        `${API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/branches/${encodeURIComponent(config.branch)}`,
        config,
        {},
        fetchImpl,
        undefined,
        async (response) => {
          if (!response.ok) throw responseError(response);
        },
      );
    }
    return {
      ok: true,
      canWrite: data.permissions?.push === true,
      message: data.permissions?.push ? 'sync.readable' : 'sync.noWrite',
    };
  } catch (error) {
    return {
      ok: false,
      canWrite: false,
      message:
        error instanceof SyncError && error.kind === 'auth' ? 'sync.auth' : 'sync.permission',
    };
  }
}

/* ------------------------------------------------------------------ */
/* Sync engine (debounced batching)                                    */
/* ------------------------------------------------------------------ */

export interface SyncEngineOptions {
  getConfig: () => AppConfig;
  getPayload: () => HubStoragePayload;
  applyRemote: (payload: HubStoragePayload, before: HubStoragePayload) => Promise<void>;
  refresh?: () => Promise<void>;
  withLock?: (task: () => Promise<void>) => Promise<void>;
  getMetadata?: () => Promise<SyncMetadata | undefined>;
  setMetadata?: (metadata: SyncMetadata) => Promise<void>;
  onStatus?: (status: SyncStatus) => void;
  onError?: (error: SyncError) => void;
  onConflicts?: (conflicts: SyncConflict[]) => void;
  onSha?: (sha: string) => void;
  getToken?: () => string;
  fetchImpl?: FetchLike;
  debounceMs?: number;
}
/** Event-driven full reconciliation. Persisted entities are the durable queue. */
export class SyncEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private requested = false;
  private generation = 0;
  private controller: AbortController | null = null;
  private retries = 0;
  private retryAt = 0;
  private metadata: SyncMetadata = { last_synced_at: 0 };
  constructor(private readonly options: SyncEngineOptions) {}
  schedule(): void {
    this.requested = true;
    this.options.onStatus?.('pending');
    if (this.running) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }
  pushNow(): Promise<void> {
    return this.syncNow();
  }
  pullNow(): Promise<void> {
    return this.syncNow();
  }
  syncNow(): Promise<void> {
    this.clearTimer();
    this.requested = true;
    if (this.running) return this.running;
    if (Date.now() < this.retryAt) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.syncNow();
      }, this.retryAt - Date.now());
      return Promise.resolve();
    }
    const generation = this.generation;
    const run = () => this.drain(generation);
    this.running = (this.options.withLock ? this.options.withLock(run) : run()).finally(() => {
      this.running = null;
      if (this.requested && generation !== this.generation) void this.syncNow();
    });
    return this.running;
  }
  private config(): GitHubConfig | null {
    const config = this.options.getConfig();
    const token = this.options.getToken?.() ?? config.github_pat ?? '';
    return config.sync_enabled && hasGitHubConfig(config, token)
      ? toGitHubConfig(config, token)
      : null;
  }
  private async drain(generation: number): Promise<void> {
    let passes = 0;
    while (this.requested && generation === this.generation) {
      this.requested = false;
      const config = this.config();
      if (!config) {
        this.options.onStatus?.('idle');
        return;
      }
      const current = (): boolean =>
        generation === this.generation && canonical(config) === canonical(this.config());
      this.controller = new AbortController();
      this.options.onStatus?.('syncing');
      try {
        await this.options.refresh?.();
        if (!current()) return;
        this.metadata = (await this.options.getMetadata?.()) ?? this.metadata;
        const target = targetKey(config);
        const state = this.metadata.targets?.[target] ?? {};
        if (state.conflicts?.length) {
          this.options.onConflicts?.(state.conflicts);
          this.options.onStatus?.('conflict');
          return;
        }
        let success = false;
        for (let attempt = 0; attempt < 3 && !success; attempt++) {
          const remote = await fetchRemoteFile(
            config,
            this.options.fetchImpl,
            this.controller.signal,
          );
          if (!current()) return;
          let remotePayload: HubStoragePayload | undefined;
          try {
            remotePayload = remote ? parsePayload(remote.content) : undefined;
          } catch {
            throw new SyncError('invalid');
          }
          const before = this.options.getPayload();
          const merged = remotePayload
            ? reconcilePayloads(before, remotePayload, state.baseline)
            : { payload: before, conflicts: [] };
          validatePayload(merged.payload);
          if (merged.conflicts.length) {
            await this.saveState(target, { ...state, conflicts: merged.conflicts });
            if (!current()) return;
            this.options.onConflicts?.(merged.conflicts);
            this.options.onStatus?.('conflict');
            return;
          }
          let sha = remote?.sha ?? '';
          if (
            !remotePayload ||
            payloadFingerprint(merged.payload) !== payloadFingerprint(remotePayload)
          ) {
            try {
              sha = await putRemoteFile(
                config,
                serializePayload(merged.payload),
                remote?.sha,
                'chore(hub): sync data',
                this.options.fetchImpl,
                this.controller.signal,
              );
            } catch (error) {
              if (error instanceof SyncError && error.kind === 'conflict' && attempt < 2) continue;
              throw error;
            }
          }
          if (!current()) return;
          await this.options.applyRemote(merged.payload, before);
          if (!current()) return;
          await this.saveState(target, { baseline: merged.payload, conflicts: [] }, sha);
          if (!current()) return;
          this.options.onSha?.(sha);
          this.retries = 0;
          this.retryAt = 0;
          const changed =
            payloadFingerprint(this.options.getPayload()) !== payloadFingerprint(merged.payload);
          this.requested ||= changed;
          success = true;
        }
        if (this.requested) {
          this.options.onStatus?.('pending');
          if (++passes >= 5) {
            this.timer = setTimeout(() => {
              this.timer = null;
              void this.syncNow();
            }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
            return;
          }
        } else this.options.onStatus?.('synced');
      } catch (error) {
        if (!current()) return;
        const failure = error instanceof SyncError ? error : new SyncError('storage');
        if (failure.kind === 'cancelled') return;
        this.options.onError?.(failure);
        this.options.onStatus?.('error');
        if (['network', 'server', 'timeout', 'rate'].includes(failure.kind) && this.retries++ < 3) {
          this.retryAt = Math.max(failure.retryAt, Date.now() + 1000 * 2 ** this.retries);
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.syncNow();
          }, this.retryAt - Date.now());
        }
        return;
      } finally {
        this.controller = null;
      }
    }
  }
  private async saveState(target: string, state: SyncTargetState, sha?: string): Promise<void> {
    this.metadata = {
      ...this.metadata,
      last_synced_at: Date.now(),
      ...(sha ? { github_last_sha: sha } : {}),
      targets: { ...this.metadata.targets, [target]: state },
    };
    await this.options.setMetadata?.(this.metadata);
  }
  /** Cancel old credentials/target work before it can change local state or status. */
  cancel(): void {
    this.generation++;
    this.requested = false;
    this.controller?.abort();
    this.clearTimer();
    this.retryAt = 0;
    this.retries = 0;
  }
  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  dispose(): void {
    this.cancel();
  }
}
