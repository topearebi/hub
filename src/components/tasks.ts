/**
 * Hub Tasks Drawer
 * ----------------
 * Left productivity pane (PRD §6.2). Supports rapid task creation, checkbox
 * completion toggles, soft deletion, and a deterministic sort that sinks
 * completed items to the bottom.
 */

import { buildDrawerShell } from './drawer';
import { clearChildren, el, svg } from '../utils/dom';
import { newId } from '../utils/crypto';
import type { TaskItem } from '../types/schemas';

const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_TRASH =
  'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6';

/**
 * Order tasks for display: pending first (newest first), then completed
 * (most recently completed first). Pure and unit-tested.
 */
export function sortTasks(tasks: readonly TaskItem[]): TaskItem[] {
  const pending = tasks
    .filter((task) => !task.completed)
    .sort((a, b) => b.created_at - a.created_at);
  const completed = tasks
    .filter((task) => task.completed)
    .sort((a, b) => (b.completed_at ?? b.updated_at) - (a.completed_at ?? a.updated_at));
  return [...pending, ...completed];
}

export interface TasksStore {
  readonly activeTasks: TaskItem[];
  upsertTask(item: TaskItem): Promise<void>;
  softDeleteTask(id: string): Promise<void>;
}

export interface TasksCallbacks {
  onPinToggle: () => void;
  onClose: () => void;
}

export class TasksDrawer {
  readonly element: HTMLElement;

  private readonly listEl: HTMLElement;
  private readonly input: HTMLInputElement;

  constructor(
    private readonly store: TasksStore,
    callbacks: TasksCallbacks,
  ) {
    const shell = buildDrawerShell({
      variant: 'tasks',
      title: 'Tasks',
      onPinToggle: callbacks.onPinToggle,
      onClose: callbacks.onClose,
    });
    this.element = shell.element;

    this.input = el('input', {
      className: 'drawer__input',
      attrs: { type: 'text', placeholder: 'Add a task…', 'aria-label': 'New task' },
    });

    const addButton = el('button', {
      className: 'icon-button',
      attrs: { type: 'button', 'aria-label': 'Add task' },
    });
    addButton.appendChild(svg(ICON_PLUS));

    const form = el('form', { className: 'drawer__form', children: [this.input, addButton] });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.addTask();
    });

    this.listEl = el('ul', { className: 'task-list' });

    shell.body.appendChild(form);
    shell.body.appendChild(this.listEl);
  }

  /** Rebuild the task list from current store state. */
  render(): void {
    clearChildren(this.listEl);

    const tasks = sortTasks(this.store.activeTasks);
    if (tasks.length === 0) {
      this.listEl.appendChild(
        el('li', {
          className: 'empty-state',
          text: "All priorities cleared. Add a task to track today's focus.",
        }),
      );
      return;
    }

    for (const task of tasks) {
      this.listEl.appendChild(this.renderTask(task));
    }
  }

  setPinned(pinned: boolean): void {
    this.element.setAttribute('data-pinned', pinned ? 'true' : 'false');
  }

  setOpen(open: boolean): void {
    this.element.setAttribute('data-open', open ? 'true' : 'false');
  }

  destroy(): void {
    this.element.remove();
  }

  private async addTask(): Promise<void> {
    const title = this.input.value.trim();
    if (title.length === 0) {
      return;
    }
    const now = Date.now();
    const task: TaskItem = {
      id: newId(),
      created_at: now,
      updated_at: now,
      title,
      completed: false,
      completed_at: null,
    };
    this.input.value = '';
    await this.store.upsertTask(task);
  }

  private renderTask(task: TaskItem): HTMLElement {
    const item = el('li', { className: `task${task.completed ? ' task--done' : ''}` });

    const checkbox = el('input', {
      className: 'task__checkbox',
      attrs: { type: 'checkbox', 'aria-label': `Toggle ${task.title}` },
    });
    checkbox.checked = task.completed;
    checkbox.addEventListener('change', () => {
      void this.toggleTask(task, checkbox.checked);
    });

    const title = el('span', { className: 'task__title', text: task.title });

    const removeButton = el('button', {
      className: 'icon-button task__delete',
      attrs: { type: 'button', 'aria-label': `Delete ${task.title}` },
    });
    removeButton.appendChild(svg(ICON_TRASH));
    removeButton.addEventListener('click', () => {
      void this.store.softDeleteTask(task.id);
    });

    item.appendChild(checkbox);
    item.appendChild(title);
    item.appendChild(removeButton);
    return item;
  }

  private async toggleTask(task: TaskItem, completed: boolean): Promise<void> {
    const now = Date.now();
    await this.store.upsertTask({
      ...task,
      completed,
      completed_at: completed ? now : null,
      updated_at: now,
    });
  }
}
