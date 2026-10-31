import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SyncEngine,
  TOMBSTONE_GRACE_MS,
  cullPayloadTombstones,
  cullTombstones,
  fetchRemoteFile,
  hasGitHubConfig,
  mergeCollection,
  mergePayloads,
  parsePayload,
  putRemoteFile,
  serializePayload,
  testConnection,
  toGitHubConfig,
} from '../sync';
import type { GitHubConfig } from '../sync';
import { DEFAULT_APP_CONFIG } from '../../types/schemas';
import type { BookmarkItem, HubStoragePayload } from '../../types/schemas';

/** Build a fully-formed bookmark from minimal overrides. */
function bookmark(
  overrides: Partial<BookmarkItem> & Pick<BookmarkItem, 'id' | 'title' | 'url' | 'updated_at'>,
): BookmarkItem {
  return {
    created_at: overrides.updated_at,
    category_id: 'cat_1',
    ...overrides,
  };
}

/** Build an empty payload from minimal overrides. */
function payload(overrides: Partial<HubStoragePayload> = {}): HubStoragePayload {
  return {
    version: 1,
    last_synced_at: 0,
    bookmarks: [],
    categories: [],
    tasks: [],
    notes: [],
    ...overrides,
  };
}

/** Minimal Response-like object for mocked fetch. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const CONFIG: GitHubConfig = {
  token: 'token',
  owner: 'owner',
  repo: 'repo',
  branch: 'main',
  filePath: '.hub/data.json',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mergeCollection', () => {
  it('adopts entities that exist only remotely (additions)', () => {
    const local = [bookmark({ id: 'a', title: 'A', url: 'https://a.test', updated_at: 1 })];
    const remote = [bookmark({ id: 'b', title: 'B', url: 'https://b.test', updated_at: 1 })];

    const merged = mergeCollection(local, remote);
    expect(merged.map((b) => b.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps the newer remote edit (LWW)', () => {
    const local = [bookmark({ id: 'a', title: 'Old', url: 'https://a.test', updated_at: 1 })];
    const remote = [bookmark({ id: 'a', title: 'New', url: 'https://a.test', updated_at: 2 })];

    const merged = mergeCollection(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('New');
  });

  it('keeps the local edit when it is newer', () => {
    const local = [bookmark({ id: 'a', title: 'Local', url: 'https://a.test', updated_at: 5 })];
    const remote = [bookmark({ id: 'a', title: 'Remote', url: 'https://a.test', updated_at: 2 })];

    const merged = mergeCollection(local, remote);
    expect(merged[0]?.title).toBe('Local');
  });

  it('keeps local on a timestamp tie', () => {
    const local = [bookmark({ id: 'a', title: 'Local', url: 'https://a.test', updated_at: 3 })];
    const remote = [bookmark({ id: 'a', title: 'Remote', url: 'https://a.test', updated_at: 3 })];

    const merged = mergeCollection(local, remote);
    expect(merged[0]?.title).toBe('Local');
  });

  it('propagates a newer remote tombstone', () => {
    const local = [bookmark({ id: 'a', title: 'A', url: 'https://a.test', updated_at: 1 })];
    const remote = [
      bookmark({ id: 'a', title: 'A', url: 'https://a.test', updated_at: 2, is_deleted: true }),
    ];

    const merged = mergeCollection(local, remote);
    expect(merged[0]?.is_deleted).toBe(true);
  });
});

describe('mergePayloads', () => {
  it('merges additions, edits, and tombstones without data loss', () => {
    const local = payload({
      bookmarks: [
        bookmark({ id: 'keep', title: 'Keep', url: 'https://keep.test', updated_at: 1 }),
        bookmark({ id: 'edit', title: 'Local edit', url: 'https://edit.test', updated_at: 5 }),
        bookmark({ id: 'del', title: 'Delete me', url: 'https://del.test', updated_at: 1 }),
      ],
    });
    const remote = payload({
      bookmarks: [
        bookmark({ id: 'edit', title: 'Remote edit', url: 'https://edit.test', updated_at: 2 }),
        bookmark({ id: 'new', title: 'New', url: 'https://new.test', updated_at: 1 }),
        bookmark({
          id: 'del',
          title: 'Delete me',
          url: 'https://del.test',
          updated_at: 9,
          is_deleted: true,
        }),
      ],
    });

    const merged = mergePayloads(local, remote, 1000);
    const byId = new Map(merged.bookmarks.map((b) => [b.id, b]));

    expect(merged.last_synced_at).toBe(1000);
    expect(byId.get('keep')?.title).toBe('Keep');
    expect(byId.get('edit')?.title).toBe('Local edit'); // local newer
    expect(byId.get('new')?.title).toBe('New'); // remote addition
    expect(byId.get('del')?.is_deleted).toBe(true); // remote tombstone newer
    expect(merged.bookmarks).toHaveLength(4);
  });
});

describe('cullTombstones', () => {
  it('retains tombstones within the grace period', () => {
    const now = 1_000_000_000;
    const entities = [
      bookmark({
        id: 'a',
        title: 'A',
        url: 'https://a.test',
        updated_at: now - 1000,
        is_deleted: true,
      }),
    ];
    expect(cullTombstones(entities, now)).toHaveLength(1);
  });

  it('drops tombstones older than the grace period', () => {
    const now = 1_000_000_000;
    const entities = [
      bookmark({
        id: 'a',
        title: 'A',
        url: 'https://a.test',
        updated_at: now - TOMBSTONE_GRACE_MS - 1,
        is_deleted: true,
      }),
    ];
    expect(cullTombstones(entities, now)).toHaveLength(0);
  });

  it('never culls live entities', () => {
    const now = 1_000_000_000;
    const entities = [
      bookmark({
        id: 'a',
        title: 'A',
        url: 'https://a.test',
        updated_at: now - TOMBSTONE_GRACE_MS * 2,
      }),
    ];
    expect(cullTombstones(entities, now)).toHaveLength(1);
  });
});

describe('cullPayloadTombstones', () => {
  it('culls expired tombstones across all collections', () => {
    const now = 1_000_000_000;
    const old = now - TOMBSTONE_GRACE_MS - 1;
    const input = payload({
      bookmarks: [
        bookmark({ id: 'a', title: 'A', url: 'https://a.test', updated_at: old, is_deleted: true }),
      ],
    });

    const result = cullPayloadTombstones(input, now);
    expect(result.bookmarks).toHaveLength(0);
  });
});

describe('payload serialization', () => {
  it('round-trips through serialize/parse', () => {
    const original = payload({
      bookmarks: [bookmark({ id: 'a', title: 'A', url: 'https://a.test', updated_at: 1 })],
    });

    const restored = parsePayload(serializePayload(original));
    expect(restored).toEqual(original);
  });

  it('throws on malformed payloads', () => {
    expect(() => parsePayload('{"version":2}')).toThrow();
    expect(() => parsePayload('not json')).toThrow();
  });
});

describe('config helpers', () => {
  it('detects a complete GitHub config', () => {
    expect(hasGitHubConfig(DEFAULT_APP_CONFIG)).toBe(false);
    expect(
      hasGitHubConfig({
        ...DEFAULT_APP_CONFIG,
        github_pat: 't',
        github_owner: 'o',
        github_repo: 'r',
      }),
    ).toBe(true);
  });

  it('narrows AppConfig into a GitHubConfig', () => {
    const config = toGitHubConfig({
      ...DEFAULT_APP_CONFIG,
      github_pat: 't',
      github_owner: 'o',
      github_repo: 'r',
    });
    expect(config).toEqual({
      token: 't',
      owner: 'o',
      repo: 'r',
      branch: 'main',
      filePath: '.hub/data.json',
    });
  });
});

describe('GitHub client', () => {
  it('returns null when the remote file is missing (404)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    const result = await fetchRemoteFile(CONFIG, fetchMock as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it('decodes base64 file content', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ content: 'aGVsbG8=', sha: 'abc', encoding: 'base64' }),
    );
    const result = await fetchRemoteFile(CONFIG, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ content: 'hello', sha: 'abc' });
  });

  it('sends a PUT with the previous sha and returns the new sha', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ content: { sha: 'newsha' } }));

    const sha = await putRemoteFile(CONFIG, 'data', 'oldsha', 'chore(hub): sync data', fetchMock);

    expect(sha).toBe('newsha');
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.sha).toBe('oldsha');
    expect(body.message).toBe('chore(hub): sync data');
    expect(body.branch).toBe('main');
  });

  it('reports write access from repo permissions', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ permissions: { push: true } }));
    const result = await testConnection(CONFIG, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({
      ok: true,
      canWrite: true,
      message: 'Connection verified with write access.',
    });
  });

  it('reports missing write access', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ permissions: { push: false } }));
    const result = await testConnection(CONFIG, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.canWrite).toBe(false);
  });

  it('reports an invalid token (401)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 401));
    const result = await testConnection(CONFIG, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, canWrite: false, message: 'Invalid or expired token.' });
  });
});

describe('SyncEngine.pushNow', () => {
  const enabledConfig = (): typeof DEFAULT_APP_CONFIG => ({
    ...DEFAULT_APP_CONFIG,
    sync_enabled: true,
    github_pat: 't',
    github_owner: 'o',
    github_repo: 'r',
  });

  it('reconciles remote-only changes into local state after a successful push', async () => {
    const remotePayload = payload({
      bookmarks: [
        bookmark({ id: 'remote', title: 'Remote', url: 'https://remote.test', updated_at: 5 }),
      ],
    });
    const encoded = btoa(JSON.stringify(remotePayload));

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ content: encoded, sha: 'abc', encoding: 'base64' }))
      .mockResolvedValueOnce(jsonResponse({ content: { sha: 'def' } }));

    const applyRemote = vi.fn<(p: HubStoragePayload) => Promise<void>>(async () => undefined);

    const engine = new SyncEngine({
      getConfig: enabledConfig,
      getPayload: () => payload(),
      applyRemote,
      fetchImpl: fetchMock,
    });

    await engine.pushNow();

    expect(applyRemote).toHaveBeenCalledTimes(1);
    const applied = applyRemote.mock.calls[0]?.[0];
    expect(applied?.bookmarks.map((b) => b.id)).toContain('remote');
  });

  it('does not reconcile when the remote file does not exist yet', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ content: { sha: 'def' } }));

    const applyRemote = vi.fn<(p: HubStoragePayload) => Promise<void>>(async () => undefined);

    const engine = new SyncEngine({
      getConfig: enabledConfig,
      getPayload: () => payload(),
      applyRemote,
      fetchImpl: fetchMock,
    });

    await engine.pushNow();

    expect(applyRemote).not.toHaveBeenCalled();
  });
});
