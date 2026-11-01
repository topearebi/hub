/**
 * Hub Notification Manager
 * ------------------------
 * Local task reminders via the Notification API plus Web Push subscription
 * plumbing (no server: subscriptions are stored locally and delivered by a
 * user-configurable VAPID key). The scheduling/decoding logic is exported as
 * pure functions so it is unit-testable without browser APIs.
 *
 * AGENTS.md air-gap mandate: every call is feature-detected and failures are
 * swallowed so Hub still runs when notifications are unavailable.
 */

import type { TaskItem } from '../types/schemas';

/** A reminder whose trigger time has passed and which has not yet fired. */
export interface DueReminder {
  taskId: string;
  title: string;
  remindAt: number;
}

/** Default reminder polling cadence (30s balances latency and battery). */
export const REMINDER_POLL_MS = 30_000;

export type NotificationSupport = NotificationPermission | 'unsupported';

/* ------------------------------------------------------------------ */
/* Pure logic                                                          */
/* ------------------------------------------------------------------ */

/** True when a task carries a concrete reminder timestamp. */
function hasReminder(task: TaskItem): task is TaskItem & { remind_at: number } {
  return typeof task.remind_at === 'number' && task.remind_at !== null;
}

/**
 * Select the reminders that are due at `now` and not already fired. Completed
 * and soft-deleted tasks are ignored, as are already-notified task ids.
 */
export function computeDueReminders(
  tasks: readonly TaskItem[],
  now: number,
  firedIds: ReadonlySet<string>,
): DueReminder[] {
  return tasks
    .filter((task) => task.is_deleted !== true && !task.completed)
    .filter(hasReminder)
    .filter((task) => task.remind_at <= now)
    .filter((task) => !firedIds.has(task.id))
    .map((task) => ({ taskId: task.id, title: task.title, remindAt: task.remind_at }));
}

/** Decode a URL-safe Base64 VAPID public key into the bytes PushManager needs. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Back the view with a fresh ArrayBuffer so it satisfies `BufferSource`.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

export interface NotificationManagerOptions {
  /** Snapshot of the current tasks (used to compute due reminders). */
  getTasks: () => readonly TaskItem[];
  /** Invoked for each reminder as it fires (e.g. to mark it as notified). */
  onFire?: (reminder: DueReminder) => void;
  /** Poll interval override (tests use a small value). */
  pollIntervalMs?: number;
}

export class NotificationManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly fired = new Set<string>();

  constructor(private readonly options: NotificationManagerOptions) {}

  /** Whether the Notification API is present in this environment. */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  /** Current permission state (or `'unsupported'`). */
  static permission(): NotificationSupport {
    return NotificationManager.isSupported() ? Notification.permission : 'unsupported';
  }

  /** Request permission, returning the resulting state. */
  static async requestPermission(): Promise<NotificationSupport> {
    if (!NotificationManager.isSupported()) {
      return 'unsupported';
    }
    return Notification.permission === 'granted' ? 'granted' : Notification.requestPermission();
  }

  /** Begin polling for due reminders. */
  start(): void {
    if (this.timer !== null || !NotificationManager.isSupported()) {
      return;
    }
    const interval = this.options.pollIntervalMs ?? REMINDER_POLL_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
  }

  /** Stop polling for reminders. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Evaluate reminders once (also used directly by tests). */
  async tick(now: number = Date.now()): Promise<DueReminder[]> {
    const due = computeDueReminders(this.options.getTasks(), now, this.fired);
    for (const reminder of due) {
      this.fired.add(reminder.taskId);
      this.options.onFire?.(reminder);
      await this.show(`Task reminder: ${reminder.title}`, {
        body: 'This task is due.',
        tag: `task-${reminder.taskId}`,
      });
    }
    return due;
  }

  /** Show a notification, preferring the SW registration when available. */
  async show(title: string, options: NotificationOptions = {}): Promise<void> {
    if (!NotificationManager.isSupported() || Notification.permission !== 'granted') {
      return;
    }

    const icon = './icon-192.png';

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, { icon, badge: icon, ...options });
        return;
      }
    } catch {
      // Fall back to the constructor below.
    }

    try {
      new Notification(title, { icon, ...options });
    } catch {
      // Notification constructor can throw on some platforms; ignore.
    }
  }

  /**
   * Subscribe to Web Push using the configured VAPID public key. Returns the
   * subscription, or `null` when unsupported or when no key is provided.
   */
  async subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      typeof window === 'undefined' ||
      !('PushManager' in window) ||
      vapidPublicKey.trim().length === 0
    ) {
      return null;
    }

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      return existing;
    }

    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey.trim()),
    });
  }

  /** Cancel any active push subscription. */
  async unsubscribeFromPush(): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await subscription?.unsubscribe();
    } catch {
      // Ignore: nothing to unsubscribe.
    }
  }
}
