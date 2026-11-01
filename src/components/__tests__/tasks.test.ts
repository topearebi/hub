import { describe, expect, it } from 'vitest';

import { sortTasks } from '../tasks';
import type { TaskItem } from '../../types/schemas';

/** Build a fully-formed task from minimal overrides. */
function makeTask(
  overrides: Partial<TaskItem> & Pick<TaskItem, 'id' | 'title' | 'created_at'>,
): TaskItem {
  return {
    updated_at: overrides.created_at,
    profile_id: 'p1',
    completed: false,
    ...overrides,
  };
}

describe('sortTasks', () => {
  it('places pending tasks before completed ones', () => {
    const tasks: TaskItem[] = [
      makeTask({ id: 'done', title: 'Done', created_at: 1, completed: true, completed_at: 10 }),
      makeTask({ id: 'todo', title: 'Todo', created_at: 2 }),
    ];

    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['todo', 'done']);
  });

  it('orders pending tasks newest-first', () => {
    const tasks: TaskItem[] = [
      makeTask({ id: 'old', title: 'Old', created_at: 1 }),
      makeTask({ id: 'new', title: 'New', created_at: 3 }),
      makeTask({ id: 'mid', title: 'Mid', created_at: 2 }),
    ];

    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['new', 'mid', 'old']);
  });

  it('orders completed tasks by most recently completed', () => {
    const tasks: TaskItem[] = [
      makeTask({ id: 'c1', title: 'C1', created_at: 1, completed: true, completed_at: 5 }),
      makeTask({ id: 'c2', title: 'C2', created_at: 2, completed: true, completed_at: 9 }),
    ];

    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['c2', 'c1']);
  });

  it('does not mutate the input array', () => {
    const tasks: TaskItem[] = [
      makeTask({ id: 'a', title: 'A', created_at: 1 }),
      makeTask({ id: 'b', title: 'B', created_at: 2 }),
    ];
    const snapshot = tasks.map((t) => t.id);

    sortTasks(tasks);

    expect(tasks.map((t) => t.id)).toEqual(snapshot);
  });
});
