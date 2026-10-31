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
 * Headless by design: no DOM imports, so it is unit-testable in isolation.
 */

import {
  STORE,
  getAll,
  getAppConfig,
  getMetrics,
  put,
  recordVisit as persistVisit,
  setAppConfig,
} from './db';
import { DEFAULT_APP_CONFIG } from '../types/schemas';
import type {
  AppConfig,
  BookmarkItem,
  CategoryItem,
  DeviceMetrics,
  NoteItem,
  TaskItem,
} from '../types/schemas';

/** Collections that can be observed for change notifications. */
export type StoreEvent = 'bookmarks' | 'categories' | 'tasks' | 'notes' | 'metrics' | 'config';

export type StoreListener = () => void;

const ALL_EVENTS: readonly StoreEvent[] = [
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
  getRecentBookmarks(limit?: number): BookmarkItem[];
  getBookmarksByCategory(categoryId: string): BookmarkItem[];
}

class HubStore implements LaunchpadStore {
  private bookmarks: BookmarkItem[] = [];
  private categories: CategoryItem[] = [];
  private tasks: TaskItem[] = [];
  private notes: NoteItem[] = [];
  private metrics: DeviceMetrics[] = [];
  private config: AppConfig = structuredClone(DEFAULT_APP_CONFIG);

  private readonly listeners = new Map<StoreEvent, Set<StoreListener>>();
  private initialized = false;

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  /** Hydrate every collection from IndexedDB, then notify subscribers. */
  async init(): Promise<void> {
    const [bookmarks, categories, tasks, notes, metrics, config] = await Promise.all([
      getAll<BookmarkItem>(STORE.bookmarks),
      getAll<CategoryItem>(STORE.categories),
      getAll<TaskItem>(STORE.tasks),
      getAll<NoteItem>(STORE.notes),
      getMetrics(),
      getAppConfig(),
    ]);

    this.bookmarks = bookmarks;
    this.categories = categories;
    this.tasks = tasks;
    this.notes = notes;
    this.metrics = metrics;
    this.config = config;
    this.initialized = true;

    for (const event of ALL_EVENTS) {
      this.emit(event);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
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

  /** Bookmarks excluding soft-deleted tombstones. */
  get activeBookmarks(): BookmarkItem[] {
    return this.bookmarks.filter((b) => b.is_deleted !== true);
  }

  /** Categories excluding tombstones, ordered ascending by `order`. */
  get sortedCategories(): CategoryItem[] {
    return this.categories.filter((c) => c.is_deleted !== true).sort((a, b) => a.order - b.order);
  }

  get activeTasks(): TaskItem[] {
    return this.tasks.filter((t) => t.is_deleted !== true);
  }

  get activeNotes(): NoteItem[] {
    return this.notes.filter((n) => n.is_deleted !== true);
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

  async softDeleteTask(id: string, now: number = Date.now()): Promise<void> {
    const existing = this.tasks.find((t) => t.id === id);
    if (!existing) {
      return;
    }
    await this.upsertTask({ ...existing, is_deleted: true, updated_at: now });
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
