/**
 * Hub Reactive State Store
 * ------------------------
 * Central in-memory singleton powering every UI component. It owns the
 * authoritative RAM copy of all collections and exposes a tiny pub/sub bus so
 * views re-render on mutation without polling.
 *
 * Data flow (PRD §3.2):
 *   IndexedDB  --init()-->  Store (RAM)  --subscribe/emit-->  UI components
 *   UI mutation  -->  Store (RAM)  -->  IndexedDB (async persist)
 *
 * Multi-profile: every syncable entity carries a `profile_id`. The active
 * profile is resolved on init (creating a default and backfilling legacy
 * records when none exist) and all "active" getters are scoped to it.
 *
 * Headless by design: no DOM imports, so it is unit-testable in isolation.
 */

import {
  STORE,
  bulkPut,
  getAll,
  getAppConfig,
  getMetrics,
  put,
  recordVisit as persistVisit,
  remove,
  setAppConfig,
} from './db';
import { newId } from '../utils/crypto';
import { DEFAULT_APP_CONFIG, DEFAULT_PROFILE_ID } from '../types/schemas';
import type {
  AppConfig,
  BookmarkItem,
  CategoryItem,
  DeviceMetrics,
  HubStoragePayload,
  NoteItem,
  ProfileItem,
  TaskItem,
} from '../types/schemas';

/** Collections that can be observed for change notifications. */
export type StoreEvent =
  'profiles' | 'bookmarks' | 'categories' | 'tasks' | 'notes' | 'metrics' | 'config';

export type StoreListener = () => void;

const ALL_EVENTS: readonly StoreEvent[] = [
  'profiles',
  'bookmarks',
  'categories',
  'tasks',
  'notes',
  'metrics',
  'config',
];

/**
 * Tombstone grace period (SCHEMAS.md §5.3): soft-deleted records are retained
 * for 30 days so they can be restored from Settings → Data → Recently deleted.
 */
export const TOMBSTONE_GRACE_MS = 30 * 86_400_000;

/** Item counts for a deleted profile, shown in the Recently deleted list. */
export interface DeletedProfileCounts {
  bookmarks: number;
  tasks: number;
  notes: number;
  categories: number;
}

/** A deleted profile together with the counts of the items it would restore. */
export interface DeletedProfileEntry {
  profile: ProfileItem;
  counts: DeletedProfileCounts;
}

/** Individually deleted items still inside the 30-day recovery window. */
export interface DeletedItems {
  bookmarks: BookmarkItem[];
  tasks: TaskItem[];
  notes: NoteItem[];
}

/** Minimal contract the omnibar/bookmarks views depend on (keeps them testable). */
export interface LaunchpadStore {
  readonly activeBookmarks: BookmarkItem[];
  readonly sortedCategories: CategoryItem[];
  readonly appConfig: AppConfig;
  readonly activeProfile: ProfileItem | null;
  readonly profiles: ProfileItem[];
  getRecentBookmarks(limit?: number): BookmarkItem[];
  getBookmarksByCategory(categoryId: string): BookmarkItem[];
}

class HubStore implements LaunchpadStore {
  private profileList: ProfileItem[] = [];
  private bookmarks: BookmarkItem[] = [];
  private categories: CategoryItem[] = [];
  private tasks: TaskItem[] = [];
  private notes: NoteItem[] = [];
  private metrics: DeviceMetrics[] = [];
  private config: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  private currentProfileId: string | null = null;

  private readonly listeners = new Map<StoreEvent, Set<StoreListener>>();
  private initialized = false;

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  /** Hydrate every collection from IndexedDB, then notify subscribers. */
  async init(): Promise<void> {
    const [profiles, bookmarks, categories, tasks, notes, metrics, config] = await Promise.all([
      getAll<ProfileItem>(STORE.profiles),
      getAll<BookmarkItem>(STORE.bookmarks),
      getAll<CategoryItem>(STORE.categories),
      getAll<TaskItem>(STORE.tasks),
      getAll<NoteItem>(STORE.notes),
      getMetrics(),
      getAppConfig(),
    ]);

    this.profileList = profiles;
    this.bookmarks = bookmarks;
    this.categories = categories;
    this.tasks = tasks;
    this.notes = notes;
    this.metrics = metrics;
    this.config = config;

    await this.migrateProfiles();

    this.initialized = true;

    for (const event of ALL_EVENTS) {
      this.emit(event);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Ensure at least one profile exists and that every entity is assigned to
   * one. Legacy (pre-v2) records without a `profile_id` are migrated into a
   * freshly created default profile — no data is dropped.
   */
  private async migrateProfiles(): Promise<void> {
    const live = this.profileList.filter((p) => p.is_deleted !== true);

    let activeId: string;
    if (live.length > 0) {
      const configured = this.config.active_profile_id;
      const valid = configured && live.some((p) => p.id === configured);
      activeId = valid ? configured : live[0]!.id;
      this.currentProfileId = activeId;
      if (activeId !== configured) {
        await this.updateConfig({ active_profile_id: activeId });
      }
    } else {
      const now = Date.now();
      const profile: ProfileItem = {
        id: DEFAULT_PROFILE_ID,
        created_at: now,
        updated_at: now,
        name: 'Default',
        hub_title: 'Hub',
      };
      this.profileList = [profile];
      await put(STORE.profiles, profile);
      activeId = profile.id;
      this.currentProfileId = activeId;
      await this.updateConfig({ active_profile_id: activeId });
    }

    // Backfill any legacy entities that predate profile partitioning, whether
    // or not a profile already existed. Without this, such records stay in
    // IndexedDB but are invisible (orphaned) in the UI.
    const backfill = async <T extends { profile_id: string }>(
      storeName: (typeof STORE)[keyof typeof STORE],
      items: T[],
    ): Promise<T[]> => {
      const updated = items.map((item) =>
        item.profile_id ? item : { ...item, profile_id: activeId },
      );
      const changed = updated.filter((item, index) => item !== items[index]);
      if (changed.length > 0) {
        await bulkPut(storeName, changed);
      }
      return updated;
    };

    this.bookmarks = await backfill(STORE.bookmarks, this.bookmarks);
    this.categories = await backfill(STORE.categories, this.categories);
    this.tasks = await backfill(STORE.tasks, this.tasks);
    this.notes = await backfill(STORE.notes, this.notes);
  }

  /* ---------------------------------------------------------------- */
  /* Pub/sub bus                                                      */
  /* ---------------------------------------------------------------- */

  /** Subscribe to a collection change. Returns an unsubscribe disposer. */
  subscribe(event: StoreEvent, listener: StoreListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set<StoreListener>();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  private emit(event: StoreEvent): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    for (const listener of set) {
      listener();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Read getters                                                     */
  /* ---------------------------------------------------------------- */

  /** True when an entity belongs to the active profile (or none is set). */
  private inActiveProfile(entity: { profile_id?: string }): boolean {
    if (this.currentProfileId === null) {
      return true;
    }
    return entity.profile_id === this.currentProfileId;
  }

  /** Bookmarks in the active profile, excluding soft-deleted tombstones. */
  get activeBookmarks(): BookmarkItem[] {
    return this.bookmarks.filter((b) => b.is_deleted !== true && this.inActiveProfile(b));
  }

  /** Categories in the active profile, ordered ascending by `order`. */
  get sortedCategories(): CategoryItem[] {
    return this.categories
      .filter((c) => c.is_deleted !== true && this.inActiveProfile(c))
      .sort((a, b) => a.order - b.order);
  }

  get activeTasks(): TaskItem[] {
    return this.tasks.filter((t) => t.is_deleted !== true && this.inActiveProfile(t));
  }

  get activeNotes(): NoteItem[] {
    return this.notes.filter((n) => n.is_deleted !== true && this.inActiveProfile(n));
  }

  /** Non-deleted profiles, oldest first. */
  get profiles(): ProfileItem[] {
    return this.profileList
      .filter((p) => p.is_deleted !== true)
      .sort((a, b) => a.created_at - b.created_at);
  }

  /** The currently active profile, if any. */
  get activeProfile(): ProfileItem | null {
    if (this.currentProfileId === null) {
      return null;
    }
    return this.profileList.find((p) => p.id === this.currentProfileId) ?? null;
  }

  /** Id of the active profile (used to stamp newly created entities). */
  get activeProfileId(): string | null {
    return this.currentProfileId;
  }

  get allMetrics(): DeviceMetrics[] {
    return this.metrics;
  }

  get appConfig(): AppConfig {
    return this.config;
  }

  getBookmark(id: string): BookmarkItem | undefined {
    return this.bookmarks.find((b) => b.id === id);
  }

  /** Resolve the bookmark bound to an `Alt + [1-9]` hotkey slot. */
  getBookmarkByHotkey(hotkey: string): BookmarkItem | undefined {
    return this.activeBookmarks.find((b) => b.hotkey === hotkey);
  }

  getBookmarksByCategory(categoryId: string): BookmarkItem[] {
    return this.activeBookmarks
      .filter((b) => b.category_id === categoryId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created_at - b.created_at);
  }

  /**
   * Bookmarks ordered by most recent local activation. Reads DeviceMetrics,
   * which never leave the device (SCHEMAS.md §3.1).
   */
  getRecentBookmarks(limit = 6): BookmarkItem[] {
    const byId = new Map(this.activeBookmarks.map((b) => [b.id, b]));
    return this.metrics
      .filter((m) => byId.has(m.bookmark_id))
      .sort((a, b) => b.last_visited_at - a.last_visited_at)
      .slice(0, limit)
      .map((m) => byId.get(m.bookmark_id))
      .filter((b): b is BookmarkItem => b !== undefined);
  }

  /**
   * Deleted profiles with the counts of the items that a restore would revive
   * (SCHEMAS.md §5.4, DESIGN.md §9.1). Counts only include children tombstoned
   * with the profile (same `updated_at`), so items deleted individually before
   * the profile are not double-counted.
   */
  get deletedProfiles(): DeletedProfileEntry[] {
    return this.profileList
      .filter((p) => p.is_deleted === true)
      .map((profile) => {
        const at = profile.updated_at;
        const count = <T extends { profile_id: string; is_deleted?: boolean; updated_at: number }>(
          items: T[],
        ): number =>
          items.filter(
            (item) =>
              item.profile_id === profile.id && item.is_deleted === true && item.updated_at === at,
          ).length;
        return {
          profile,
          counts: {
            bookmarks: count(this.bookmarks),
            tasks: count(this.tasks),
            notes: count(this.notes),
            categories: count(this.categories),
          },
        };
      });
  }

  /**
   * Individually deleted bookmarks, tasks and notes still inside the 30-day
   * recovery window. Items belonging to a deleted profile are excluded here
   * because they are represented by that profile's entry.
   */
  get deletedItems(): DeletedItems {
    const liveProfileIds = new Set(
      this.profileList.filter((p) => p.is_deleted !== true).map((p) => p.id),
    );
    const now = Date.now();
    const isDeletedItem = <
      T extends { profile_id: string; is_deleted?: boolean; updated_at: number },
    >(
      item: T,
    ): boolean =>
      item.is_deleted === true &&
      liveProfileIds.has(item.profile_id) &&
      now - item.updated_at <= TOMBSTONE_GRACE_MS;
    return {
      bookmarks: this.bookmarks.filter(isDeletedItem),
      tasks: this.tasks.filter(isDeletedItem),
      notes: this.notes.filter(isDeletedItem),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Mutations                                                        */
  /* ---------------------------------------------------------------- */

  async upsertBookmark(item: BookmarkItem): Promise<void> {
    replaceIn(this.bookmarks, item);
    await put(STORE.bookmarks, item);
    this.emit('bookmarks');
  }

  /** Insert or update many bookmarks in a single transaction (drag reordering). */
  async upsertBookmarks(items: readonly BookmarkItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    for (const item of items) {
      replaceIn(this.bookmarks, item);
    }
    await bulkPut(STORE.bookmarks, items);
    this.emit('bookmarks');
  }

  async softDeleteBookmark(id: string, now: number = Date.now()): Promise<void> {
    const existing = this.getBookmark(id);
    if (!existing) {
      return;
    }
    const tombstone: BookmarkItem = { ...existing, is_deleted: true, updated_at: now };
    await this.upsertBookmark(tombstone);
  }

  async upsertCategory(item: CategoryItem): Promise<void> {
    replaceIn(this.categories, item);
    await put(STORE.categories, item);
    this.emit('categories');
  }

  async softDeleteCategory(id: string, now: number = Date.now()): Promise<void> {
    const existing = this.categories.find((c) => c.id === id);
    if (!existing) {
      return;
    }
    await this.upsertCategory({ ...existing, is_deleted: true, updated_at: now });
  }

  /** Insert or update many categories in one transaction (reordering). */
  async upsertCategories(items: readonly CategoryItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    for (const item of items) {
      replaceIn(this.categories, item);
    }
    await bulkPut(STORE.categories, items);
    this.emit('categories');
  }

  /** Rename a category in place. */
  async renameCategory(id: string, name: string, now: number = Date.now()): Promise<void> {
    const existing = this.categories.find((c) => c.id === id);
    if (!existing) {
      return;
    }
    await this.upsertCategory({ ...existing, name, updated_at: now });
  }

  /**
   * Delete a category, moving its bookmarks to `targetCategoryId` (DESIGN.md §9).
   * Returns the tombstoned category and the affected bookmarks (with their
   * original `category_id`) so the caller can offer a faithful Undo.
   */
  async deleteCategory(
    id: string,
    targetCategoryId: string,
    now: number = Date.now(),
  ): Promise<{ category: CategoryItem; bookmarks: BookmarkItem[] } | null> {
    const existing = this.categories.find((c) => c.id === id);
    if (!existing) {
      return null;
    }
    const affected = this.bookmarks.filter((b) => b.category_id === id && b.is_deleted !== true);
    if (affected.length > 0) {
      const moved = affected.map((b) => ({ ...b, category_id: targetCategoryId, updated_at: now }));
      for (const bookmark of moved) {
        replaceIn(this.bookmarks, bookmark);
      }
      await bulkPut(STORE.bookmarks, moved);
      this.emit('bookmarks');
    }
    await this.upsertCategory({ ...existing, is_deleted: true, updated_at: now });
    return { category: existing, bookmarks: affected };
  }

  /** Undo a category deletion: revive the category and re-home its bookmarks. */
  async restoreCategory(
    category: CategoryItem,
    bookmarks: readonly BookmarkItem[],
    now: number = Date.now(),
  ): Promise<void> {
    await this.upsertCategory({ ...category, is_deleted: false, updated_at: now });
    if (bookmarks.length > 0) {
      const restored = bookmarks.map((b) => ({ ...b, updated_at: now }));
      for (const bookmark of restored) {
        replaceIn(this.bookmarks, bookmark);
      }
      await bulkPut(STORE.bookmarks, restored);
      this.emit('bookmarks');
    }
  }

  async upsertTask(item: TaskItem): Promise<void> {
    replaceIn(this.tasks, item);
    await put(STORE.tasks, item);
    this.emit('tasks');
  }

  /** Insert or update many tasks in a single transaction (drag reordering). */
  async upsertTasks(items: readonly TaskItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    for (const item of items) {
      replaceIn(this.tasks, item);
    }
    await bulkPut(STORE.tasks, items);
    this.emit('tasks');
  }

  /**
   * Soft-delete a task and cascade the tombstone to all of its descendants so
   * subtasks never orphan. Completing a parent does NOT cascade (handled in the
   * UI); only deletion does.
   */
  async softDeleteTask(id: string, now: number = Date.now()): Promise<void> {
    const existing = this.tasks.find((t) => t.id === id);
    if (!existing) {
      return;
    }

    const ids = this.collectDescendantTaskIds(id);
    ids.add(id);

    for (const taskId of ids) {
      const task = this.tasks.find((t) => t.id === taskId);
      if (task && task.is_deleted !== true) {
        await this.upsertTask({ ...task, is_deleted: true, updated_at: now });
      }
    }
  }

  /** Collect the ids of every task nested beneath `rootId` (breadth-first). */
  private collectDescendantTaskIds(rootId: string): Set<string> {
    const descendants = new Set<string>();
    const queue: string[] = [rootId];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const task of this.tasks) {
        if (task.parent_id === current && !descendants.has(task.id)) {
          descendants.add(task.id);
          queue.push(task.id);
        }
      }
    }

    return descendants;
  }

  async upsertNote(item: NoteItem): Promise<void> {
    replaceIn(this.notes, item);
    await put(STORE.notes, item);
    this.emit('notes');
  }

  async softDeleteNote(id: string, now: number = Date.now()): Promise<void> {
    const existing = this.notes.find((n) => n.id === id);
    if (!existing) {
      return;
    }
    await this.upsertNote({ ...existing, is_deleted: true, updated_at: now });
  }

  /* ---- Undo (restore a soft-deleted entity) ---- */

  async restoreBookmark(id: string, now: number = Date.now()): Promise<void> {
    const existing = this.getBookmark(id);
    if (existing && existing.is_deleted === true) {
      await this.upsertBookmark({ ...existing, is_deleted: false, updated_at: now });
    }
  }

  /** Restore a task and every descendant tombstoned with it. */
  async restoreTask(id: string, now: number = Date.now()): Promise<void> {
    const ids = this.collectDescendantTaskIds(id);
    ids.add(id);
    for (const taskId of ids) {
      const task = this.tasks.find((t) => t.id === taskId);
      if (task && task.is_deleted === true) {
        await this.upsertTask({ ...task, is_deleted: false, updated_at: now });
      }
    }
  }

  async restoreNote(id: string, now: number = Date.now()): Promise<void> {
    const existing = this.notes.find((n) => n.id === id);
    if (existing && existing.is_deleted === true) {
      await this.upsertNote({ ...existing, is_deleted: false, updated_at: now });
    }
  }

  /* ---- Profiles ---- */

  async upsertProfile(item: ProfileItem): Promise<void> {
    replaceIn(this.profileList, item);
    await put(STORE.profiles, item);
    this.emit('profiles');
  }

  /**
   * Soft-delete a profile; if it was active, switch to another live profile.
   *
   * Deleting the *last* live profile would otherwise leave `currentProfileId`
   * pointing at a tombstone (so `activeProfile` returns a deleted record and
   * new entities are stamped with a dead `profile_id`). In that case a fresh
   * default profile is created so the app always has a valid active profile.
   */
  async softDeleteProfile(id: string, now: number = Date.now()): Promise<void> {
    const existing = this.profileList.find((p) => p.id === id);
    if (!existing) {
      return;
    }
    await this.upsertProfile({ ...existing, is_deleted: true, updated_at: now });
    // Cascade the tombstone to every not-already-deleted child under one shared
    // timestamp so the profile and its items expire and restore together
    // (SCHEMAS.md §5.4).
    await this.tombstoneProfileChildren(id, now);

    if (this.currentProfileId === id) {
      const next = this.profileList.find((p) => p.is_deleted !== true);
      if (next) {
        await this.setActiveProfile(next.id);
      } else {
        const replacement: ProfileItem = {
          id: newId(),
          created_at: now,
          updated_at: now,
          name: 'Default',
          hub_title: 'Hub',
        };
        await this.upsertProfile(replacement);
        await this.setActiveProfile(replacement.id);
      }
    }
  }

  /**
   * Restore a deleted profile and exactly the children tombstoned with it
   * (same `updated_at`). Items deleted individually before the profile keep
   * their own, older timestamp and stay deleted (SCHEMAS.md §5.4).
   */
  async restoreProfile(id: string, now: number = Date.now()): Promise<void> {
    const profile = this.profileList.find((p) => p.id === id);
    if (!profile || profile.is_deleted !== true) {
      return;
    }
    const tombstoneAt = profile.updated_at;
    await this.upsertProfile({ ...profile, is_deleted: false, updated_at: now });
    await this.reviveProfileChildren(id, tombstoneAt, now);
  }

  /** Permanently remove a deleted profile and all of its records (Delete now). */
  async permanentlyDeleteProfile(id: string): Promise<void> {
    const profile = this.profileList.find((p) => p.id === id);
    if (!profile) {
      return;
    }
    const bookmarks = this.bookmarks.filter((b) => b.profile_id === id);
    const categories = this.categories.filter((c) => c.profile_id === id);
    const tasks = this.tasks.filter((t) => t.profile_id === id);
    const notes = this.notes.filter((n) => n.profile_id === id);

    this.profileList = this.profileList.filter((p) => p.id !== id);
    this.bookmarks = this.bookmarks.filter((b) => b.profile_id !== id);
    this.categories = this.categories.filter((c) => c.profile_id !== id);
    this.tasks = this.tasks.filter((t) => t.profile_id !== id);
    this.notes = this.notes.filter((n) => n.profile_id !== id);

    await Promise.all([
      remove(STORE.profiles, id),
      ...bookmarks.map((b) => remove(STORE.bookmarks, b.id)),
      ...categories.map((c) => remove(STORE.categories, c.id)),
      ...tasks.map((t) => remove(STORE.tasks, t.id)),
      ...notes.map((n) => remove(STORE.notes, n.id)),
    ]);

    this.emit('profiles');
    this.emit('bookmarks');
    this.emit('categories');
    this.emit('tasks');
    this.emit('notes');
  }

  /** Permanently remove a single soft-deleted item (Delete now). */
  async permanentlyDeleteItem(
    storeName: 'bookmarks' | 'tasks' | 'notes',
    id: string,
  ): Promise<void> {
    if (storeName === 'bookmarks') {
      this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    } else if (storeName === 'tasks') {
      this.tasks = this.tasks.filter((t) => t.id !== id);
    } else {
      this.notes = this.notes.filter((n) => n.id !== id);
    }
    await remove(STORE[storeName], id);
    this.emit(storeName);
  }

  /** Tombstone every not-already-deleted child of a profile at `now`. */
  private async tombstoneProfileChildren(profileId: string, now: number): Promise<void> {
    const bookmarks = this.bookmarks
      .filter((b) => b.profile_id === profileId && b.is_deleted !== true)
      .map((b) => ({ ...b, is_deleted: true, updated_at: now }));
    const categories = this.categories
      .filter((c) => c.profile_id === profileId && c.is_deleted !== true)
      .map((c) => ({ ...c, is_deleted: true, updated_at: now }));
    const tasks = this.tasks
      .filter((t) => t.profile_id === profileId && t.is_deleted !== true)
      .map((t) => ({ ...t, is_deleted: true, updated_at: now }));
    const notes = this.notes
      .filter((n) => n.profile_id === profileId && n.is_deleted !== true)
      .map((n) => ({ ...n, is_deleted: true, updated_at: now }));

    for (const item of bookmarks) replaceIn(this.bookmarks, item);
    for (const item of categories) replaceIn(this.categories, item);
    for (const item of tasks) replaceIn(this.tasks, item);
    for (const item of notes) replaceIn(this.notes, item);

    await Promise.all([
      bulkPut(STORE.bookmarks, bookmarks),
      bulkPut(STORE.categories, categories),
      bulkPut(STORE.tasks, tasks),
      bulkPut(STORE.notes, notes),
    ]);

    this.emit('bookmarks');
    this.emit('categories');
    this.emit('tasks');
    this.emit('notes');
  }

  /** Revive children tombstoned with a profile (matching `tombstoneAt`). */
  private async reviveProfileChildren(
    profileId: string,
    tombstoneAt: number,
    now: number,
  ): Promise<void> {
    const matches = <T extends { profile_id: string; is_deleted?: boolean; updated_at: number }>(
      items: T[],
    ): T[] =>
      items
        .filter(
          (item) =>
            item.profile_id === profileId &&
            item.is_deleted === true &&
            item.updated_at === tombstoneAt,
        )
        .map((item) => ({ ...item, is_deleted: false, updated_at: now }));

    const bookmarks = matches(this.bookmarks);
    const categories = matches(this.categories);
    const tasks = matches(this.tasks);
    const notes = matches(this.notes);

    for (const item of bookmarks) replaceIn(this.bookmarks, item);
    for (const item of categories) replaceIn(this.categories, item);
    for (const item of tasks) replaceIn(this.tasks, item);
    for (const item of notes) replaceIn(this.notes, item);

    await Promise.all([
      bulkPut(STORE.bookmarks, bookmarks),
      bulkPut(STORE.categories, categories),
      bulkPut(STORE.tasks, tasks),
      bulkPut(STORE.notes, notes),
    ]);

    this.emit('bookmarks');
    this.emit('categories');
    this.emit('tasks');
    this.emit('notes');
  }

  /** Switch the active profile and refresh every partitioned view. */
  async setActiveProfile(id: string): Promise<void> {
    this.currentProfileId = id;
    await this.updateConfig({ active_profile_id: id });
    this.emit('profiles');
    this.emit('bookmarks');
    this.emit('categories');
    this.emit('tasks');
    this.emit('notes');
  }

  /** Record a bookmark activation and refresh the local metrics cache. */
  async recordVisit(bookmarkId: string): Promise<DeviceMetrics> {
    const updated = await persistVisit(bookmarkId);
    const index = this.metrics.findIndex((m) => m.bookmark_id === bookmarkId);
    if (index >= 0) {
      this.metrics[index] = updated;
    } else {
      this.metrics.push(updated);
    }
    this.emit('metrics');
    return updated;
  }

  /** Merge a partial config patch, persist it, and notify subscribers. */
  async updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
    this.config = { ...this.config, ...patch };
    await setAppConfig(this.config);
    this.emit('config');
    return this.config;
  }

  /* ---------------------------------------------------------------- */
  /* Sync payload snapshot / apply                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Snapshot the syncable collections (including profiles) into a v2
   * `HubStoragePayload`. Tombstones are included so deletions propagate.
   */
  getPayload(now: number = Date.now()): HubStoragePayload {
    return {
      version: 2,
      last_synced_at: now,
      profiles: [...this.profileList],
      bookmarks: [...this.bookmarks],
      categories: [...this.categories],
      tasks: [...this.tasks],
      notes: [...this.notes],
    };
  }

  /**
   * Replace all syncable collections from a payload, persist them in a single
   * transaction per store, and notify subscribers.
   */
  async applyPayload(payload: HubStoragePayload): Promise<void> {
    this.profileList = [...payload.profiles];
    this.bookmarks = [...payload.bookmarks];
    this.categories = [...payload.categories];
    this.tasks = [...payload.tasks];
    this.notes = [...payload.notes];

    await Promise.all([
      bulkPut(STORE.profiles, this.profileList),
      bulkPut(STORE.bookmarks, this.bookmarks),
      bulkPut(STORE.categories, this.categories),
      bulkPut(STORE.tasks, this.tasks),
      bulkPut(STORE.notes, this.notes),
    ]);

    // Keep the active profile valid after a remote merge.
    const live = this.profileList.filter((p) => p.is_deleted !== true);
    if (live.length > 0 && !live.some((p) => p.id === this.currentProfileId)) {
      this.currentProfileId = live[0]!.id;
      await this.updateConfig({ active_profile_id: this.currentProfileId });
    }

    this.emit('profiles');
    this.emit('bookmarks');
    this.emit('categories');
    this.emit('tasks');
    this.emit('notes');
  }
}

/** Replace an entity in-place by id, or append it when new. */
function replaceIn<T extends { id: string }>(collection: T[], item: T): void {
  const index = collection.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    collection[index] = item;
  } else {
    collection.push(item);
  }
}

/** Shared singleton consumed by the application bootstrap and components. */
export const store = new HubStore();
