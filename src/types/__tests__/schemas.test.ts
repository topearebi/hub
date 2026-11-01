import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_CONFIG, SYNCABLE_COLLECTIONS } from '../schemas';
import type { HubStoragePayload } from '../schemas';

describe('DEFAULT_APP_CONFIG', () => {
  it('matches the documented default shape', () => {
    expect(DEFAULT_APP_CONFIG.sync_enabled).toBe(false);
    expect(DEFAULT_APP_CONFIG.github_branch).toBe('main');
    expect(DEFAULT_APP_CONFIG.github_file_path).toBe('.hub/data.json');
    expect(DEFAULT_APP_CONFIG.theme).toBe('auto');
    expect(DEFAULT_APP_CONFIG.pinned_drawers).toEqual({ tasks: false, notes: false });
    expect(DEFAULT_APP_CONFIG.notifications_enabled).toBe(false);
    expect(DEFAULT_APP_CONFIG.gamepad_enabled).toBe(true);
    expect(DEFAULT_APP_CONFIG.app_lock_enabled).toBe(false);
    expect(DEFAULT_APP_CONFIG.search_providers).toHaveLength(2);

    const defaults = DEFAULT_APP_CONFIG.search_providers.filter((p) => p.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe('sp_ddg');
  });
});

describe('HubStoragePayload', () => {
  const payload: HubStoragePayload = {
    version: 2,
    last_synced_at: 0,
    profiles: [],
    bookmarks: [],
    categories: [],
    tasks: [],
    notes: [],
  };

  it('exposes the syncable collections plus envelope fields', () => {
    expect(Object.keys(payload).sort()).toEqual([
      'bookmarks',
      'categories',
      'last_synced_at',
      'notes',
      'profiles',
      'tasks',
      'version',
    ]);
    expect(SYNCABLE_COLLECTIONS).toEqual(['profiles', 'bookmarks', 'categories', 'tasks', 'notes']);
  });

  it('never serializes device metrics', () => {
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('click_count');
    expect(serialized).not.toContain('last_visited_at');
    expect(serialized).not.toContain('bookmark_id');
  });
});
