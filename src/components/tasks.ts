/**
 * Hub Tasks Drawer (Google Tasks pattern)
 * ---------------------------------------
 * Left productivity pane. Features an inline "+ Add a task" creator with quick
 * date/recurrence chips, circular completion toggles, nested subtasks, a
 * three-dot context menu, and a collapsible "Completed" accordion.
 *
 * Pure helpers (`sortTasks`, `buildTaskTree`, `completedTasks`) are exported for
 * unit testing.
 */

import { buildDrawerShell } from './drawer';
import { clearChildren, el, svg } from '../utils/dom';
import { newId } from '../utils/crypto';
import { renderLinkified } from '../utils/text';
import type { TaskItem } from '../types/schemas';

const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_TRASH =
  'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6';
const ICON_MORE = 'M12 6h.01M12 12h.01M12 18h.01';
const ICON_CHECK = 'M20 6 9 17l-5-5';
const ICON_CALENDAR =
  'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z';
const ICON_SUBTASK = 'M6 3v12a3 3 0 0 0 3 3h9M15 15l3 3-3 3';

type Recurrence = 'daily' | 'weekly' | 'monthly' | 'yearly' | null;

const RECURRENCE_CYCLE: ReadonlyArray<Recurrence> = [null, 'daily', 'weekly', 'monthly', 'yearly'];

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Sort by manual `order` ascending, then newest first. */
export function sortTasks(tasks: readonly TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || b.created_at - a.created_at);
}

export interface TaskNode {
  task: TaskItem;
  children: TaskNode[];
}

/** Build a parent/child tree of active (non-completed) tasks. */
export function buildTaskTree(tasks: readonly TaskItem[]): TaskNode[] {
  const active = tasks.filter((task) => !task.completed);
  const byId = new Map(active.map((task) => [task.id, task]));
  const childrenOf = new Map<string, TaskItem[]>();
  const roots: TaskItem[] = [];

  for (const task of active) {
    const parentId = task.parent_id ?? null;
    if (parentId && byId.has(parentId)) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(task);
      childrenOf.set(parentId, list);
    } else {
      roots.push(task);
    }
  }

  const build = (task: TaskItem): TaskNode => ({
    task,
    children: sortTasks(childrenOf.get(task.id) ?? []).map(build),
  });

  return sortTasks(roots).map(build);
}

/** Completed tasks, most recently completed first. */
export function completedTasks(tasks: readonly TaskItem[]): TaskItem[] {
  return tasks
    .filter((task) => task.completed)
    .sort((a, b) => (b.completed_at ?? b.updated_at) - (a.completed_at ?? a.updated_at));
}

/** Format a due date/time for display. */
export function formatDue(task: TaskItem): string {
  if (!task.due_date) {
    return '';
  }
  const date = new Date(`${task.due_date}T${task.due_time ?? '00:00'}`);
  const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return task.due_time ? `${label}, ${task.due_time}` : label;
}

/** Format a completion timestamp as `Day, Mon DD`. */
export function formatCompleted(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function todayIso(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface TasksStore {
  readonly activeTasks: TaskItem[];
  readonly activeProfileId: string | null;
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
  private readonly creatorEl: HTMLElement;
  private readonly creatorTitle: HTMLInputElement;
  private readonly creatorDetails: HTMLTextAreaElement;
  private readonly creatorDate: HTMLInputElement;
  private readonly creatorTime: HTMLInputElement;
  private readonly recurrenceChip: HTMLButtonElement;
  private readonly dateRow: HTMLElement;

  private creatorParentId: string | null = null;
  private creatorRecurrence: Recurrence = null;
  private completedOpen = false;

  constructor(
    private readonly store: TasksStore,
    callbacks: TasksCallbacks,
  ) {
    const shell = buildDrawerShell({
      variant: 'tasks',
      title: 'My Tasks',
      onPinToggle: callbacks.onPinToggle,
      onClose: callbacks.onClose,
    });
    this.element = shell.element;

    /* ---- Inline creator ---- */
    this.creatorTitle = el('input', {
      className: 'task-creator__title',
      attrs: { type: 'text', placeholder: 'Add a task', 'aria-label': 'Task title' },
    });
    this.creatorDetails = el('textarea', {
      className: 'task-creator__details',
      attrs: { placeholder: 'Details', 'aria-label': 'Task details', rows: '2' },
    });
    this.creatorDate = el('input', {
      className: 'task-creator__date',
      attrs: { type: 'date', 'aria-label': 'Due date' },
    });
    this.creatorTime = el('input', {
      className: 'task-creator__time',
      attrs: { type: 'time', 'aria-label': 'Due time' },
    });
    this.dateRow = el('div', {
      className: 'task-creator__date-row',
      children: [this.creatorDate, this.creatorTime],
    });
    this.dateRow.hidden = true;

    const todayChip = this.chip('Today', () => this.setCreatorDate(todayIso(0)));
    const tomorrowChip = this.chip('Tomorrow', () => this.setCreatorDate(todayIso(1)));
    const dateChip = this.chip('Date & Time', () => {
      this.dateRow.hidden = !this.dateRow.hidden;
    });
    this.recurrenceChip = this.chip('Recurrence', () => this.cycleRecurrence());

    const chips = el('div', {
      className: 'task-creator__chips',
      children: [todayChip, tomorrowChip, dateChip, this.recurrenceChip],
    });

    const saveButton = el('button', {
      className: 'button button--primary',
      text: 'Save',
      attrs: { type: 'button' },
    });
    saveButton.addEventListener('click', () => {
      void this.saveCreator();
    });
    const cancelButton = el('button', {
      className: 'button',
      text: 'Cancel',
      attrs: { type: 'button' },
    });
    cancelButton.addEventListener('click', () => this.closeCreator());

    const actions = el('div', {
      className: 'task-creator__actions',
      children: [cancelButton, saveButton],
    });

    const creatorForm = el('div', {
      className: 'task-creator',
      children: [this.creatorTitle, this.creatorDetails, chips, this.dateRow, actions],
    });
    creatorForm.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        void this.saveCreator();
      } else if (key === 'Escape') {
        event.preventDefault();
        this.closeCreator();
      }
    });
    this.creatorEl = creatorForm;
    this.creatorEl.hidden = true;

    const addButton = el('button', {
      className: 'task-add',
      attrs: { type: 'button' },
    });
    addButton.appendChild(svg(ICON_PLUS, { className: 'task-add__icon' }));
    addButton.appendChild(el('span', { text: 'Add a task' }));
    addButton.addEventListener('click', () => this.openCreator(null));

    this.listEl = el('div', { className: 'task-list' });

    shell.body.appendChild(addButton);
    shell.body.appendChild(this.creatorEl);
    shell.body.appendChild(this.listEl);
  }

  /** Rebuild the task list from current store state. */
  render(): void {
    clearChildren(this.listEl);

    const tasks = this.store.activeTasks;
    const tree = buildTaskTree(tasks);
    const completed = completedTasks(tasks);

    if (tree.length === 0 && completed.length === 0) {
      this.listEl.appendChild(
        el('p', {
          className: 'empty-state',
          text: "All priorities cleared. Add a task to track today's focus.",
        }),
      );
      return;
    }

    for (const node of tree) {
      this.listEl.appendChild(this.renderNode(node, 0));
    }

    if (completed.length > 0) {
      this.listEl.appendChild(this.renderCompleted(completed));
    }
  }

  /** Open the inline creator and focus the title (used by the app shortcut). */
  focusInput(): void {
    this.openCreator(null);
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

  /* ---------------------------------------------------------------- */
  /* Creator                                                          */
  /* ---------------------------------------------------------------- */

  private chip(label: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', {
      className: 'task-chip',
      text: label,
      attrs: { type: 'button' },
    });
    button.addEventListener('click', onClick);
    return button;
  }

  private openCreator(parentId: string | null): void {
    this.creatorParentId = parentId;
    this.creatorEl.hidden = false;
    this.creatorTitle.value = '';
    this.creatorDetails.value = '';
    this.creatorDate.value = '';
    this.creatorTime.value = '';
    this.creatorRecurrence = null;
    this.dateRow.hidden = true;
    this.updateRecurrenceChip();
    this.creatorTitle.focus();
  }

  private closeCreator(): void {
    this.creatorEl.hidden = true;
    this.creatorParentId = null;
  }

  private setCreatorDate(iso: string): void {
    this.creatorDate.value = iso;
    this.dateRow.hidden = false;
  }

  private cycleRecurrence(): void {
    const index = RECURRENCE_CYCLE.indexOf(this.creatorRecurrence);
    this.creatorRecurrence = RECURRENCE_CYCLE[(index + 1) % RECURRENCE_CYCLE.length] ?? null;
    this.updateRecurrenceChip();
  }

  private updateRecurrenceChip(): void {
    this.recurrenceChip.textContent = this.creatorRecurrence
      ? `Repeats ${this.creatorRecurrence}`
      : 'Recurrence';
    this.recurrenceChip.classList.toggle('is-active', this.creatorRecurrence !== null);
  }

  private async saveCreator(): Promise<void> {
    const title = this.creatorTitle.value.trim();
    if (title.length === 0) {
      return;
    }
    const now = Date.now();
    const description = this.creatorDetails.value.trim();
    const task: TaskItem = {
      id: newId(),
      created_at: now,
      updated_at: now,
      profile_id: this.store.activeProfileId ?? '',
      title,
      completed: false,
      completed_at: null,
      parent_id: this.creatorParentId,
      due_date: this.creatorDate.value || null,
      due_time: this.creatorTime.value || null,
      recurrence: this.creatorRecurrence,
      order: 0,
    };
    if (description.length > 0) {
      task.description = description;
    }
    this.closeCreator();
    await this.store.upsertTask(task);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  private renderNode(node: TaskNode, depth: number): HTMLElement {
    const wrapper = el('div', { className: 'task-node' });
    wrapper.appendChild(this.renderTask(node.task, depth));
    if (node.children.length > 0) {
      const children = el('div', { className: 'task-children' });
      for (const child of node.children) {
        children.appendChild(this.renderNode(child, depth + 1));
      }
      wrapper.appendChild(children);
    }
    return wrapper;
  }

  private renderTask(task: TaskItem, depth: number): HTMLElement {
    const item = el('div', {
      className: `task${task.completed ? ' task--done' : ''}`,
      attrs: { 'data-depth': String(depth) },
    });

    const check = el('button', {
      className: 'task__check',
      attrs: {
        type: 'button',
        role: 'checkbox',
        'aria-checked': task.completed ? 'true' : 'false',
        'aria-label': `Toggle ${task.title}`,
      },
    });
    check.appendChild(svg(ICON_CHECK, { className: 'task__check-icon' }));
    check.addEventListener('click', () => {
      void this.toggleTask(task, !task.completed);
    });

    const body = el('div', { className: 'task__body' });
    const title = el('div', { className: 'task__title' });
    renderLinkified(title, task.title);
    body.appendChild(title);

    if (task.description) {
      const details = el('div', { className: 'task__details' });
      renderLinkified(details, task.description);
      body.appendChild(details);
    }

    const meta = el('div', { className: 'task__meta' });
    const due = formatDue(task);
    if (due) {
      meta.appendChild(el('span', { className: 'task__due', text: due }));
    }
    if (task.recurrence) {
      meta.appendChild(el('span', { className: 'task__recurrence', text: task.recurrence }));
    }
    if (meta.childNodes.length > 0) {
      body.appendChild(meta);
    }

    const menuButton = el('button', {
      className: 'icon-button task__menu-button',
      attrs: { type: 'button', 'aria-label': `Actions for ${task.title}` },
    });
    menuButton.appendChild(svg(ICON_MORE));

    const menu = el('div', { className: 'task-menu' });
    menu.hidden = true;
    menu.appendChild(this.menuItem('Add subtask', ICON_SUBTASK, () => this.openCreator(task.id)));
    menu.appendChild(
      this.menuItem('Set date/time', ICON_CALENDAR, () => this.toggleDateEditor(item, task)),
    );
    menu.appendChild(
      this.menuItem('Delete', ICON_TRASH, () => void this.store.softDeleteTask(task.id)),
    );
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
    });

    item.appendChild(check);
    item.appendChild(body);
    item.appendChild(menuButton);
    item.appendChild(menu);
    return item;
  }

  private menuItem(label: string, icon: string, onClick: () => void): HTMLElement {
    const button = el('button', {
      className: 'task-menu__item',
      attrs: { type: 'button' },
    });
    button.appendChild(svg(icon, { size: 16 }));
    button.appendChild(el('span', { text: label }));
    button.addEventListener('click', onClick);
    return button;
  }

  private toggleDateEditor(item: HTMLElement, task: TaskItem): void {
    const existing = item.querySelector('.task__date-editor');
    if (existing) {
      existing.remove();
      return;
    }

    const date = el('input', {
      className: 'task-creator__date',
      attrs: { type: 'date', 'aria-label': 'Due date' },
    });
    date.value = task.due_date ?? '';
    const time = el('input', {
      className: 'task-creator__time',
      attrs: { type: 'time', 'aria-label': 'Due time' },
    });
    time.value = task.due_time ?? '';

    const apply = (): void => {
      void this.store.upsertTask({
        ...task,
        due_date: date.value || null,
        due_time: time.value || null,
        updated_at: Date.now(),
      });
    };
    date.addEventListener('change', apply);
    time.addEventListener('change', apply);

    const editor = el('div', {
      className: 'task__date-editor',
      children: [date, time],
    });
    item.appendChild(editor);
  }

  private renderCompleted(tasks: readonly TaskItem[]): HTMLElement {
    const section = el('div', { className: 'task-completed' });

    const header = el('button', {
      className: 'task-completed__header',
      attrs: { type: 'button', 'aria-expanded': this.completedOpen ? 'true' : 'false' },
    });
    header.appendChild(el('span', { text: `Completed (${tasks.length})` }));
    header.addEventListener('click', () => {
      this.completedOpen = !this.completedOpen;
      this.render();
    });
    section.appendChild(header);

    if (!this.completedOpen) {
      return section;
    }

    const list = el('div', { className: 'task-completed__list' });
    for (const task of tasks) {
      const row = el('div', { className: 'task task--done' });

      const check = el('button', {
        className: 'task__check task__check--filled',
        attrs: { type: 'button', role: 'checkbox', 'aria-checked': 'true' },
      });
      check.appendChild(svg(ICON_CHECK, { className: 'task__check-icon' }));
      check.addEventListener('click', () => {
        void this.toggleTask(task, false);
      });

      const body = el('div', { className: 'task__body' });
      body.appendChild(el('div', { className: 'task__title', text: task.title }));
      if (typeof task.completed_at === 'number') {
        body.appendChild(
          el('div', {
            className: 'task__completed-at',
            text: `Completed: ${formatCompleted(task.completed_at)}`,
          }),
        );
      }

      row.appendChild(check);
      row.appendChild(body);
      list.appendChild(row);
    }
    section.appendChild(list);
    return section;
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
