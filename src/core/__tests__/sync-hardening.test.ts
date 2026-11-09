import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_CONFIG } from '../../types/schemas';
import type { BookmarkItem, HubStoragePayload } from '../../types/schemas';
import { SyncEngine, fetchRemoteFile, parsePayload, targetKey } from '../sync';
import type { SyncEngineOptions } from '../sync';
import { payloadFingerprint, rebasePayload, reconcilePayloads } from '../sync-merge';
import type { SyncMetadata } from '../db';

const book = (title = 'Original', updated_at = 1): BookmarkItem => ({
  id: 'b',
  title,
  url: 'https://example.test',
  category_id: '',
  profile_id: 'p',
  created_at: 1,
  updated_at,
});
const payload = (bookmarks: BookmarkItem[] = []): HubStoragePayload => ({
  version: 2,
  last_synced_at: 0,
  profiles: [{ id: 'p', name: 'Default', created_at: 1, updated_at: 1 }],
  categories: [],
  bookmarks,
  notes: [],
  tasks: [],
});
const config = {
  ...DEFAULT_APP_CONFIG,
  sync_enabled: true,
  github_owner: 'owner',
  github_repo: 'repo',
  github_pat: 'token',
};
const response = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => String(body),
  }) as Response;
const file = (p: HubStoragePayload, sha = 'sha'): Response =>
  response({ content: btoa(JSON.stringify(p)), encoding: 'base64', sha });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const engines: SyncEngine[] = [];
function harness(initial = payload(), extra: Partial<SyncEngineOptions> = {}) {
  let current = initial;
  let metadata: SyncMetadata = { last_synced_at: 0 };
  const statuses: string[] = [];
  const errors: string[] = [];
  const engine = new SyncEngine({
    getConfig: () => config,
    getPayload: () => current,
    applyRemote: async (incoming, before) => {
      current = rebasePayload(before, current, incoming);
    },
    getMetadata: async () => metadata,
    setMetadata: async (next) => {
      metadata = next;
    },
    onStatus: (status) => statuses.push(status),
    onError: (error) => errors.push(error.kind),
    ...extra,
  });
  engines.push(engine);
  return {
    engine,
    statuses,
    errors,
    get current() {
      return current;
    },
    set current(next) {
      current = next;
    },
    get metadata() {
      return metadata;
    },
  };
}
afterEach(() => {
  engines.splice(0).forEach((engine) => engine.dispose());
  vi.useRealTimers();
});

describe('approved three-way conflict policy', () => {
  it('retains both divergent versions even on tied timestamps', () => {
    const result = reconcilePayloads(
      payload([book('Local')]),
      payload([book('Remote')]),
      payload([book()]),
    );
    expect(result.conflicts[0]).toMatchObject({
      collection: 'bookmarks',
      id: 'b',
      local: { title: 'Local' },
      remote: { title: 'Remote' },
    });
  });
  it('uses ancestry rather than clock skew for one-sided edits', () => {
    const base = payload([book('Original', 999999)]);
    expect(
      reconcilePayloads(payload([book('Edited', 2)]), base, base).payload.bookmarks[0]?.title,
    ).toBe('Edited');
  });
  it('treats first-sync divergence as a conflict', () => {
    expect(reconcilePayloads(payload([book('A')]), payload([book('B')])).conflicts).toHaveLength(1);
  });
  it('retains old deletion markers from baseline when absent on both devices', () => {
    const tombstone = { ...book(), is_deleted: true };
    expect(reconcilePayloads(payload(), payload(), payload([tombstone])).payload.bookmarks).toEqual(
      [tombstone],
    );
  });
  it('propagates an explicit end to recovery without restoring its old deadline', () => {
    const original = payload([{ ...book(), is_deleted: true, updated_at: 100000 }]);
    const ended = payload([{ ...book(), is_deleted: true, updated_at: 1 }]);
    const result = reconcilePayloads(ended, original, original);
    expect(result.conflicts).toEqual([]);
    expect(result.payload.bookmarks[0]?.updated_at).toBe(1);
  });
  it('preserves edits made after a request snapshot, including same-millisecond edits', () => {
    expect(
      rebasePayload(payload([book()]), payload([book('New')]), payload([book('Incoming')]))
        .bookmarks[0]?.title,
    ).toBe('New');
  });
});

describe('sync reliability regressions', () => {
  it('uploads an edit made during PUT in a second pass without clobbering it', async () => {
    const started = deferred<void>(),
      release = deferred<Response>();
    let remote = payload();
    let writes = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method !== 'PUT') return file(remote, String(writes));
      const body = JSON.parse(String(init.body)) as { content: string };
      remote = JSON.parse(atob(body.content)) as HubStoragePayload;
      if (++writes === 1) {
        started.resolve();
        return release.promise;
      }
      return response({ content: { sha: String(writes) } });
    });
    const h = harness(payload([book()]), { fetchImpl: fetchMock });
    const running = h.engine.syncNow();
    await started.promise;
    h.current = payload([book('Edited during upload')]);
    h.engine.schedule();
    release.resolve(response({ content: { sha: '1' } }));
    await running;
    expect(writes).toBe(2);
    expect(remote.bookmarks[0]?.title).toBe('Edited during upload');
    expect(h.current.bookmarks[0]?.title).toBe('Edited during upload');
    expect(h.statuses.at(-1)).toBe('synced');
  });
  it('manual pull reconciles and uploads durable unsent local edits', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(file(payload()))
      .mockResolvedValueOnce(response({ content: { sha: 'new' } }));
    const h = harness(payload([book('Unsent')]), { fetchImpl: fetchMock });
    await h.engine.pullNow();
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(h.statuses.at(-1)).toBe('synced');
  });
  it('re-reads and merges after 409 using the fresh SHA', async () => {
    const remoteBook = { ...book('Other device'), id: 'other' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(file(payload(), 'old'))
      .mockResolvedValueOnce(response({}, 409))
      .mockResolvedValueOnce(file(payload([remoteBook]), 'fresh'))
      .mockResolvedValueOnce(response({ content: { sha: 'done' } }));
    const h = harness(payload([book()]), { fetchImpl: fetchMock });
    await h.engine.syncNow();
    const body = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as {
      sha: string;
      content: string;
    };
    expect(body.sha).toBe('fresh');
    expect((JSON.parse(atob(body.content)) as HubStoragePayload).bookmarks).toHaveLength(2);
    expect(h.errors).toEqual([]);
  });
  it('does not issue redundant writes for unchanged snapshots', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(file(payload([book()])));
    const h = harness(payload([book()]), { fetchImpl: fetchMock });
    await h.engine.syncNow();
    await h.engine.syncNow();
    expect(fetchMock.mock.calls.every((call) => call[1]?.method !== 'PUT')).toBe(true);
  });
  it('saves conflicts before reporting them and pauses all uploads', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(file(payload([book('Remote')])));
    const h = harness(payload([book('Local')]), { fetchImpl: fetchMock });
    await h.engine.syncNow();
    expect(Object.values(h.metadata.targets ?? {})[0]?.conflicts).toHaveLength(1);
    expect(h.statuses.at(-1)).toBe('conflict');
    await h.engine.syncNow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.metadata)).not.toContain('token');
  });
  it('cancels an in-flight request before applying remote data', async () => {
    const pending = deferred<Response>(),
      started = deferred<void>();
    const h = harness(payload(), {
      fetchImpl: vi.fn(async () => {
        started.resolve();
        return pending.promise;
      }),
    });
    const work = h.engine.syncNow();
    await started.promise;
    h.engine.cancel();
    pending.resolve(file(payload([book('Remote')])));
    await work;
    expect(h.current.bookmarks).toEqual([]);
    expect(h.statuses).not.toContain('synced');
    expect(h.errors).toEqual([]);
  });
  it('classifies auth failures without scheduling automatic retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({}, 401));
    const h = harness(payload(), { fetchImpl: fetchMock });
    await h.engine.syncNow();
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.errors).toEqual(['auth']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('honours Retry-After even when manually retriggered', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, 429, { 'retry-after': '60' }))
      .mockResolvedValue(file(payload()));
    const h = harness(payload(), { fetchImpl: fetchMock });
    await h.engine.syncNow();
    await h.engine.syncNow();
    await vi.advanceTimersByTimeAsync(59999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('recovers durable local edits with a new engine after a network failure', async () => {
    const first = harness(payload([book('Offline')]), {
      fetchImpl: vi.fn(async () => {
        throw new TypeError('offline');
      }),
    });
    await first.engine.syncNow();
    first.engine.dispose();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(file(payload()))
      .mockResolvedValueOnce(response({ content: { sha: 'done' } }));
    const second = harness(first.current, { fetchImpl: fetchMock });
    await second.engine.syncNow();
    expect(second.statuses.at(-1)).toBe('synced');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('uses a target identity that excludes tokens and distinguishes branches', () => {
    const a = { token: 'secret', owner: 'A', repo: 'B', branch: 'main', filePath: 'data.json' };
    expect(targetKey(a)).toBe(targetKey({ ...a, token: 'replacement' }));
    expect(targetKey(a)).not.toBe(targetKey({ ...a, branch: 'other' }));
    expect(targetKey(a)).not.toContain('secret');
  });
});

describe('request and payload boundaries', () => {
  const github = { token: 'secret', owner: 'a', repo: 'b', branch: 'main', filePath: 'data.json' };
  it('uses API-host raw media for files above the base64 response limit', async () => {
    const unicode = 'こんにちは';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ encoding: 'none', content: '', sha: 'large' }))
      .mockResolvedValueOnce(response(unicode));
    expect(await fetchRemoteFile(github, fetchMock)).toEqual({ content: unicode, sha: 'large' });
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/^https:\/\/api.github.com\//);
    expect(fetchMock.mock.calls[1]?.[1]?.redirect).toBe('error');
  });
  it('times out even when fetch ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const result = fetchRemoteFile(
      github,
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const assertion = expect(result).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
  });
  it.each([
    (p: HubStoragePayload) => {
      p.bookmarks[0]!.url = 'javascript:alert(1)';
    },
    (p: HubStoragePayload) => {
      p.bookmarks.push(book());
    },
    (p: HubStoragePayload) => {
      p.bookmarks[0]!.profile_id = 'missing';
    },
    (p: HubStoragePayload) => {
      Object.assign(p.bookmarks[0]!, { click_count: 4 });
    },
    (p: HubStoragePayload) => {
      p.bookmarks[0]!.updated_at = -1;
    },
  ])('rejects invalid records before mutation', (mutate) => {
    const p = payload([book()]);
    mutate(p);
    expect(() => parsePayload(JSON.stringify(p))).toThrow();
  });
  it('fingerprints ignore envelope timestamps and record ordering', () => {
    const a = book(),
      b = { ...book(), id: 'other' };
    expect(payloadFingerprint(payload([a, b]))).toBe(
      payloadFingerprint({ ...payload([b, a]), last_synced_at: 123 }),
    );
  });
});
