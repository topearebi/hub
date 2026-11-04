import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TasksDrawer,
  buildTaskTree,
  completedTasks,
  computeTaskMove,
  isDescendantOf,
  sortTasks,
  todayIso,
} from '../tasks';
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

describe('todayIso (G-57)', () => {
  const RealDate = Date;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * A `Date` stand-in whose *local* calendar fields (2023-12-31) differ from the
   * UTC day (2024-01-01), reproducing "just after midnight" in a negative-offset
   * timezone. `setDate` rolls over using UTC maths so `+1 day` crosses the
   * month/year boundary. A `toISOString()`-based implementation would wrongly
   * return 2024-01-01 for the un-offset call.
   */
  class FakeDate {
    private y = 2023;
    private m = 11;
    private d = 31;
    getFullYear(): number {
      return this.y;
    }
    getMonth(): number {
      return this.m;
    }
    getDate(): number {
      return this.d;
    }
    setDate(day: number): number {
      const rolled = new RealDate(RealDate.UTC(this.y, this.m, day));
      this.y = rolled.getUTCFullYear();
      this.m = rolled.getUTCMonth();
      this.d = rolled.getUTCDate();
      return this.d;
    }
    toISOString(): string {
      return '2024-01-01T01:30:00.000Z';
    }
  }

  it('returns the local calendar date rather than the UTC day', () => {
    vi.stubGlobal('Date', FakeDate);
    expect(todayIso()).toBe('2023-12-31');
  });

  it('rolls over month/year boundaries for day offsets', () => {
    vi.stubGlobal('Date', FakeDate);
    expect(todayIso(1)).toBe('2024-01-01');
  });

  it('pads single-digit months and days', () => {
    const real = new RealDate(2024, 0, 5); // 5 Jan 2024, local
    class FixedDate {
      getFullYear(): number {
        return real.getFullYear();
      }
      getMonth(): number {
        return real.getMonth();
      }
      getDate(): number {
        return real.getDate();
      }
      setDate(day: number): number {
        real.setDate(day);
        return real.getDate();
      }
      toISOString(): string {
        return real.toISOString();
      }
    }
    vi.stubGlobal('Date', FixedDate);
    expect(todayIso()).toBe('2024-01-05');
  });
});

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

  it('orders by manual `order` before recency', () => {
    const tasks: TaskItem[] = [
      makeTask({ id: 'a', title: 'A', created_at: 3, order: 2 }),
      makeTask({ id: 'b', title: 'B', created_at: 1, order: 1 }),
    ];

    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['b', 'a']);
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

describe('buildTaskTree', () => {
  it('nests subtasks under their parent', () => {
    const tasks: TaskItem[] = [
      makeTask({ id: 'p', title: 'Parent', created_at: 2 }),
      makeTask({ id: 'c', title: 'Child', created_at: 1, parent_id: 'p' }),
    ];

    const tree = buildTaskTree(tasks);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.task.id).toBe('p');
    expect(tree[0]?.children.map((node) => node.task.id)).toEqual(['c']);
  });

  it('excludes completed tasks from the tree', () => {
    const tasks: TaskItem[] = [
      makeTask({ id: 'done', title: 'Done', created_at: 1, completed: true }),
    ];
    expect(buildTaskTree(tasks)).toEqual([]);
  });
});

describe('completedTasks', () => {
  it('returns completed tasks most-recently-completed first', () => {
    const tasks: TaskItem[] = [
      makeTask({ id: 'c1', title: 'C1', created_at: 1, completed: true, completed_at: 5 }),
      makeTask({ id: 'c2', title: 'C2', created_at: 2, completed: true, completed_at: 9 }),
      makeTask({ id: 'p', title: 'P', created_at: 3 }),
    ];

    expect(completedTasks(tasks).map((t) => t.id)).toEqual(['c2', 'c1']);
  });
});

describe('task context menu', () => {
  it('closes when the user clicks outside the menu', () => {
    const task = makeTask({ id: 't1', title: 'Task', created_at: 1 });
    const fakeStore = {
      activeTasks: [task],
      activeProfileId: 'p1',
      upsertTask: async () => undefined,
      softDeleteTask: async () => undefined,
    };
    const drawer = new TasksDrawer(fakeStore, {
      onPinToggle: () => undefined,
      onClose: () => undefined,
    });
    document.body.appendChild(drawer.element);
    drawer.render();

    const menuButton = drawer.element.querySelector<HTMLElement>('.task__menu-button');
    expect(menuButton).not.toBeNull();
    menuButton?.click();

    const menu = drawer.element.querySelector<HTMLElement>('.task-menu');
    expect(menu?.hidden).toBe(false);

    // A click anywhere outside the menu/button dismisses it.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu?.hidden).toBe(true);

    drawer.destroy();
  });

  it('closes the previous menu when another task menu is opened', () => {
    const tasks = [
      makeTask({ id: 't1', title: 'One', created_at: 2 }),
      makeTask({ id: 't2', title: 'Two', created_at: 1 }),
    ];
    const fakeStore = {
      activeTasks: tasks,
      activeProfileId: 'p1',
      upsertTask: async () => undefined,
      softDeleteTask: async () => undefined,
    };
    const drawer = new TasksDrawer(fakeStore, {
      onPinToggle: () => undefined,
      onClose: () => undefined,
    });
    document.body.appendChild(drawer.element);
    drawer.render();

    const buttons = drawer.element.querySelectorAll<HTMLElement>('.task__menu-button');
    const menus = drawer.element.querySelectorAll<HTMLElement>('.task-menu');
    buttons[0]?.click();
    expect(menus[0]?.hidden).toBe(false);

    buttons[1]?.click();
    expect(menus[0]?.hidden).toBe(true);
    expect(menus[1]?.hidden).toBe(false);

    drawer.destroy();
  });
});

describe('date editor placement', () => {
  it('renders the date editor inside the task body, not as a row sibling', () => {
    const task = makeTask({ id: 't1', title: 'Task', created_at: 1 });
    const fakeStore = {
      activeTasks: [task],
      activeProfileId: 'p1',
      upsertTask: async () => undefined,
      softDeleteTask: async () => undefined,
    };
    const drawer = new TasksDrawer(fakeStore, {
      onPinToggle: () => undefined,
      onClose: () => undefined,
    });
    document.body.appendChild(drawer.element);
    drawer.render();

    drawer.element.querySelector<HTMLElement>('.task__menu-button')?.click();
    const setDate = Array.from(
      drawer.element.querySelectorAll<HTMLElement>('.task-menu__item'),
    ).find((button) => button.textContent?.includes('Set date/time'));
    setDate?.click();

    const editor = drawer.element.querySelector<HTMLElement>('.task__date-editor');
    expect(editor).not.toBeNull();
    expect(editor?.parentElement?.classList.contains('task__body')).toBe(true);

    drawer.destroy();
  });
});

describe('isDescendantOf', () => {
  it('detects nested descendants and rejects unrelated tasks', () => {
    const tasks = [
      makeTask({ id: 'p', title: 'Parent', created_at: 3 }),
      makeTask({ id: 'c', title: 'Child', created_at: 2, parent_id: 'p' }),
      makeTask({ id: 'g', title: 'Grandchild', created_at: 1, parent_id: 'c' }),
      makeTask({ id: 'x', title: 'Other', created_at: 1 }),
    ];

    expect(isDescendantOf(tasks, 'c', 'p')).toBe(true);
    expect(isDescendantOf(tasks, 'g', 'p')).toBe(true);
    expect(isDescendantOf(tasks, 'p', 'c')).toBe(false);
    expect(isDescendantOf(tasks, 'x', 'p')).toBe(false);
  });
});

describe('computeTaskMove', () => {
  const tasks = [
    makeTask({ id: 'a', title: 'A', created_at: 3 }),
    makeTask({ id: 'b', title: 'B', created_at: 2 }),
    makeTask({ id: 'c', title: 'C', created_at: 1 }),
  ];

  it('reorders a task before a sibling', () => {
    const result = computeTaskMove(tasks, 'c', 'a', 'before');
    expect(result).not.toBeNull();
    const order = sortTasks(result ?? []).map((t) => t.id);
    expect(order).toEqual(['c', 'a', 'b']);
  });

  it('reorders a task after a sibling', () => {
    const result = computeTaskMove(tasks, 'a', 'c', 'after');
    expect(result).not.toBeNull();
    const order = sortTasks(result ?? []).map((t) => t.id);
    expect(order).toEqual(['b', 'c', 'a']);
  });

  it('reparents a task as a child of the target', () => {
    const result = computeTaskMove(tasks, 'b', 'a', 'child');
    expect(result).not.toBeNull();
    const moved = result?.find((t) => t.id === 'b');
    expect(moved?.parent_id).toBe('a');
  });

  it('rejects dropping a task into its own descendant', () => {
    const nested = [
      makeTask({ id: 'p', title: 'Parent', created_at: 2 }),
      makeTask({ id: 'c', title: 'Child', created_at: 1, parent_id: 'p' }),
    ];
    expect(computeTaskMove(nested, 'p', 'c', 'child')).toBeNull();
  });

  it('rejects dropping a task onto itself', () => {
    expect(computeTaskMove(tasks, 'a', 'a', 'before')).toBeNull();
  });
});
