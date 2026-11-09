import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openConflictInbox } from '../sync-conflicts';
import { store } from '../../core/store';
import { closeDatabase, deleteDatabase, getSyncMetadata, setSyncMetadata } from '../../core/db';
import { targetKey, toGitHubConfig } from '../../core/sync';
import { expectNoA11yViolations } from '../../test/axe';
beforeEach(async () => {
  await closeDatabase();
  await deleteDatabase();
  await store.init();
});
afterEach(() => {
  document.querySelector<HTMLButtonElement>('[role="dialog"] button')?.click();
  document.body.replaceChildren();
});
afterAll(async () => {
  await closeDatabase();
  await deleteDatabase();
});
it('keeps both versions on close, restores focus, and exposes an accessible inbox', async () => {
  const local = {
    id: 'b',
    title: 'Local <script>',
    url: 'https://example.test',
    category_id: '',
    profile_id: store.activeProfileId!,
    created_at: 1,
    updated_at: 1,
  };
  await store.upsertBookmark(local);
  const target = targetKey(toGitHubConfig(store.appConfig, ''));
  await setSyncMetadata({
    last_synced_at: 0,
    targets: {
      [target]: {
        conflicts: [
          { collection: 'bookmarks', id: 'b', local, remote: { ...local, title: 'Remote' } },
        ],
      },
    },
  });
  const opener = document.createElement('button');
  opener.textContent = 'Open inbox';
  document.body.appendChild(opener);
  opener.focus();
  await openConflictInbox(store, vi.fn());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Local <script>');
  expect(document.querySelector('script')).toBeNull();
  await expectNoA11yViolations(document.body);
  document
    .querySelector<HTMLElement>('[role="dialog"]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.activeElement).toBe(opener);
  expect((await getSyncMetadata())?.targets?.[target]?.conflicts).toHaveLength(1);
});
