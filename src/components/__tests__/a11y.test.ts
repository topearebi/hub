/**
 * Automated accessibility gate (roadmap Phase 11, G-56).
 * ------------------------------------------------------
 * Renders each primary surface and asserts axe-core reports **zero serious or
 * critical** violations. Colour contrast is excluded here (jsdom has no layout)
 * and is enforced separately by `scripts/contrast.mjs`; document-level rules are
 * excluded because these are component fragments, not full pages.
 *
 * The manual screen-reader and real-device pass remains in
 * `plans/production-readiness.md` §5.3.
 */

import { afterEach, describe, it, vi } from 'vitest';

import { expectNoA11yViolations } from '../../test/axe';
import { BookmarksView } from '../bookmarks';
import { Header } from '../header';
import { NotesDrawer } from '../notes';
import { OnboardingCard } from '../onboarding';
import { SettingsModal } from '../settings';
import { StatusChip } from '../status-chip';
import { TasksDrawer } from '../tasks';
import { showToast } from '../toast';
import { Dialog } from '../../utils/dialog';
import { Menu } from '../../utils/menu';
import { DEFAULT_APP_CONFIG } from '../../types/schemas';
import type { BookmarkItem, CategoryItem, NoteItem, TaskItem } from '../../types/schemas';
import type { ConnectionResult } from '../../core/sync';

afterEach(() => {
  document.body.replaceChildren();
});

const CATEGORY: CategoryItem = {
  id: 'c1',
  created_at: 1,
  updated_at: 1,
  profile_id: 'p1',
  name: 'Links',
  order: 0,
};

const BOOKMARK: BookmarkItem = {
  id: 'b1',
  created_at: 1,
  updated_at: 1,
  profile_id: 'p1',
  category_id: 'c1',
  title: 'Example',
  url: 'https://example.com',
};

const TASK: TaskItem = {
  id: 't1',
  created_at: 1,
  updated_at: 1,
  profile_id: 'p1',
  title: 'Buy milk',
  completed: false,
};

const NOTE: NoteItem = {
  id: 'n1',
  created_at: 1,
  updated_at: 1,
  profile_id: 'p1',
  title: 'Idea',
  content: 'A short note',
};

describe('axe-core: no serious/critical violations', () => {
  it('StatusChip', async () => {
    const chip = new StatusChip({ onActivate: vi.fn() });
    document.body.appendChild(chip.element);
    await expectNoA11yViolations(document.body);
  });

  it('Header', async () => {
    const header = new Header({
      onToggleTasks: vi.fn(),
      onToggleNotes: vi.fn(),
      onOpenProfile: vi.fn(),
      onOpenSync: vi.fn(),
      onHome: vi.fn(),
    });
    document.body.appendChild(header.element);
    await expectNoA11yViolations(document.body);
  });

  it('OnboardingCard', async () => {
    const card = new OnboardingCard({
      onAddBookmark: vi.fn(),
      onImport: vi.fn(),
      onConnectSync: vi.fn(),
      onTrySample: vi.fn(),
      onInstall: vi.fn(),
      onComplete: vi.fn(),
    });
    document.body.appendChild(card.element);
    await expectNoA11yViolations(document.body);
  });

  it('Toast', async () => {
    showToast('Saved', { variant: 'success' });
    await expectNoA11yViolations(document.body);
  });

  it('BookmarksView (guided empty state)', async () => {
    const view = new BookmarksView(
      {
        activeBookmarks: [],
        sortedCategories: [],
        getRecentBookmarks: () => [],
        getBookmarksByCategory: () => [],
      },
      {
        onActivate: vi.fn(),
        onOpenAlternate: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onAddBookmark: vi.fn(),
        onImport: vi.fn(),
        onManageCategories: vi.fn(),
      },
    );
    view.render();
    document.body.appendChild(view.element);
    await expectNoA11yViolations(document.body);
  });

  it('BookmarksView (populated grid)', async () => {
    const view = new BookmarksView(
      {
        activeBookmarks: [BOOKMARK],
        sortedCategories: [CATEGORY],
        getRecentBookmarks: () => [BOOKMARK],
        getBookmarksByCategory: () => [BOOKMARK],
      },
      {
        onActivate: vi.fn(),
        onOpenAlternate: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onAddBookmark: vi.fn(),
        onImport: vi.fn(),
        onManageCategories: vi.fn(),
      },
    );
    view.render();
    document.body.appendChild(view.element);
    await expectNoA11yViolations(document.body);
  });

  it('TasksDrawer', async () => {
    const drawer = new TasksDrawer(
      {
        activeTasks: [TASK],
        activeProfileId: 'p1',
        upsertTask: vi.fn(async () => {}),
        softDeleteTask: vi.fn(async () => {}),
      },
      { onPinToggle: vi.fn(), onClose: vi.fn() },
    );
    drawer.render();
    document.body.appendChild(drawer.element);
    await expectNoA11yViolations(document.body);
  });

  it('NotesDrawer', async () => {
    const drawer = new NotesDrawer(
      {
        activeNotes: [NOTE],
        activeProfileId: 'p1',
        upsertNote: vi.fn(async () => {}),
        softDeleteNote: vi.fn(async () => {}),
      },
      { onPinToggle: vi.fn(), onClose: vi.fn() },
    );
    drawer.render();
    document.body.appendChild(drawer.element);
    await expectNoA11yViolations(document.body);
  });

  it('SettingsModal', async () => {
    const modal = new SettingsModal(
      {
        appConfig: DEFAULT_APP_CONFIG,
        updateConfig: vi.fn(async (patch) => ({ ...DEFAULT_APP_CONFIG, ...patch })),
      },
      {
        onClose: vi.fn(),
        onExport: vi.fn(),
        onImport: vi.fn(),
        onTestConnection: vi.fn(async (): Promise<ConnectionResult> => ({
          ok: true,
          canWrite: true,
          message: 'ok',
        })),
        onCheckFile: vi.fn(async () => true),
        onInitialize: vi.fn(async () => {}),
        onSaved: vi.fn(),
        onSyncNow: vi.fn(),
        onRegisterLock: vi.fn(async () => {}),
        onDisableLock: vi.fn(async () => {}),
        encryptToken: vi.fn(async (plaintext: string) => `enc1:${plaintext}`),
      },
    );
    modal.open();
    await expectNoA11yViolations(document.body);
    modal.close();
  });

  it('Dialog primitive', async () => {
    const dialog = new Dialog({ label: 'Test dialog' });
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Confirm';
    dialog.content.appendChild(button);
    dialog.open();
    await expectNoA11yViolations(document.body);
    dialog.destroy();
  });

  it('Menu primitive', async () => {
    const menu = new Menu({
      label: 'Tile actions',
      items: [
        { label: 'Edit', onSelect: vi.fn() },
        { label: 'Delete', onSelect: vi.fn(), danger: true },
      ],
    });
    menu.openAt(10, 10);
    await expectNoA11yViolations(document.body);
    menu.destroy();
  });
});
