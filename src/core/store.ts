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
  setAppConfig,
} from './db';
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

    if (live.length > 0) {
      const configured = this.config.active_profile_id;
      const valid = configured && live.some((p) => p.id === configured);
      const active = valid ? configured : live[0]!.id;
      this.currentProfileId = active;
      if (active !== configured) {
        await this.updateConfig({ active_profile_id: active });
      }
      return;
    }

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

    const backfill = async <T extends { profile_id: string }>(
      storeName: (typeof STORE)[keyof typeof STORE],
      items: T[],
    ): Promise<T[]> => {
      const updated = items.map((item) =>
        item.profile_id ? item : { ...item, profile_id: profile.id },
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

    this.currentProfileId = profile.id;
    await this.updateConfig({ active_profile_id: profile.id });
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
    return this.activeBookmarks.filter((b) => b.category_id === categoryId);
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

  /* ---------------------------------------------------------------- */
  /* Mutations                                                        */
  /* ---------------------------------------------------------------- */

  async upsertBookmark(item: BookmarkItem): Promise<void> {
    replaceIn(this.bookmarks, item);
    await put(STORE.bookmarks, item);
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

  async upsertTask(item: TaskItem): Promise<void> {
    replaceIn(this.tasks, item);
    await put(STORE.tasks, item);
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

  /* ---- Profiles ---- */

  async upsertProfile(item: ProfileItem): Promise<void> {
    replaceIn(this.profileList, item);
    await put(STORE.profiles, item);
    this.emit('profiles');
  }

  /** Soft-delete a profile; if it was active, switch to another live profile. */
  async softDeleteProfile(id: string, now: number = Date.now()): Promise<void> {
    const existing = this.profileList.find((p) => p.id === id);
    if (!existing) {
      return;
    }
    await this.upsertProfile({ ...existing, is_deleted: true, updated_at: now });

    if (this.currentProfileId === id) {
      const next = this.profileList.find((p) => p.is_deleted !== true);
      if (next) {
        await this.setActiveProfile(next.id);
      }
    }
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
