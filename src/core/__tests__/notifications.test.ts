import { describe, expect, it } from 'vitest';

import { computeDueReminders, urlBase64ToUint8Array } from '../notifications';
import type { TaskItem } from '../../types/schemas';

/** Build a fully-formed task from minimal overrides. */
function makeTask(overrides: Partial<TaskItem> & Pick<TaskItem, 'id'>): TaskItem {
  return {
    title: overrides.id,
    created_at: 1,
    updated_at: 1,
    profile_id: 'p1',
    completed: false,
    ...overrides,
  };
}

describe('computeDueReminders', () => {
  const now = 1_000_000;

  it('includes pending tasks whose reminder time has passed', () => {
    const tasks = [makeTask({ id: 'due', remind_at: now - 100 })];
    expect(computeDueReminders(tasks, now, new Set()).map((r) => r.taskId)).toEqual(['due']);
  });

  it('excludes future, completed, deleted, and reminderless tasks', () => {
    const tasks = [
      makeTask({ id: 'future', remind_at: now + 100 }),
      makeTask({ id: 'completed', remind_at: now - 100, completed: true }),
      makeTask({ id: 'deleted', remind_at: now - 100, is_deleted: true }),
      makeTask({ id: 'none' }),
    ];
    expect(computeDueReminders(tasks, now, new Set())).toEqual([]);
  });

  it('excludes reminders that have already fired', () => {
    const tasks = [makeTask({ id: 'due', remind_at: now - 1 })];
    expect(computeDueReminders(tasks, now, new Set(['due']))).toEqual([]);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 (with padding handling)', () => {
    // 'AQAB' is the canonical sample VAPID-style key fragment [1, 0, 1].
    expect(Array.from(urlBase64ToUint8Array('AQAB'))).toEqual([1, 0, 1]);
  });

  it('decodes URL-safe variants of + and /', () => {
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
  });
});
