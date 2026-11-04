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
const ICON_GRIP = 'M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01';

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

/** Where a dragged task should land relative to a drop target. */
export type DropPosition = 'before' | 'after' | 'child';

/**
 * True when `candidateId` is a descendant of `ancestorId` in the task tree.
 * Used to prevent dropping a task into its own subtree (which would create a
 * cycle and orphan the subtree).
 */
export function isDescendantOf(
  tasks: readonly TaskItem[],
  candidateId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  let current = byId.get(candidateId);

  while (current) {
    const parentId = current.parent_id ?? null;
    if (!parentId) {
      return false;
    }
    if (parentId === ancestorId) {
      return true;
    }
    if (seen.has(parentId)) {
      return false; // Defensive: malformed cyclic data.
    }
    seen.add(parentId);
    current = byId.get(parentId);
  }

  return false;
}

/**
 * Compute the updated task list after dragging `draggedId` onto `targetId`.
 *
 * - `before`/`after` reorder the dragged task as a sibling of the target.
 * - `child` reparents the dragged task under the target (appended last).
 *
 * Sibling `order` values are renumbered 0..n so the visual order is stable.
 * Returns `null` for invalid moves (same task, or dropping into a descendant).
 */
export function computeTaskMove(
  tasks: readonly TaskItem[],
  draggedId: string,
  targetId: string,
  position: DropPosition,
  now: number = Date.now(),
): TaskItem[] | null {
  const dragged = tasks.find((task) => task.id === draggedId);
  const target = tasks.find((task) => task.id === targetId);
  if (!dragged || !target || draggedId === targetId) {
    return null;
  }
  // Never move a task relative to one of its own descendants.
  if (isDescendantOf(tasks, targetId, draggedId)) {
    return null;
  }

  const parentId = position === 'child' ? targetId : (target.parent_id ?? null);

  // Siblings under the destination parent, excluding the dragged task.
  const siblings = sortTasks(
    tasks.filter((task) => task.id !== draggedId && (task.parent_id ?? null) === parentId),
  );

  let insertIndex: number;
  if (position === 'child') {
    insertIndex = siblings.length;
  } else {
    const targetIndex = siblings.findIndex((task) => task.id === targetId);
    if (targetIndex < 0) {
      insertIndex = siblings.length;
    } else {
      insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    }
  }

  const ordered = [...siblings];
  ordered.splice(insertIndex, 0, dragged);

  const orderById = new Map<string, number>();
  ordered.forEach((task, index) => orderById.set(task.id, index));

  return tasks.map((task) => {
    const newOrder = orderById.get(task.id);
    if (newOrder === undefined) {
      return task;
    }
    const newParent = task.id === draggedId ? parentId : (task.parent_id ?? null);
    if (task.order === newOrder && (task.parent_id ?? null) === newParent) {
      return task;
    }
    return { ...task, parent_id: newParent, order: newOrder, updated_at: now };
  });
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

/**
 * Today's date (optionally offset by whole days) as a local `YYYY-MM-DD`
 * string. Built from the local calendar fields rather than `toISOString()`,
 * which would return the UTC day and so report the wrong date near midnight
 * outside UTC (G-57).
 */
export function todayIso(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface TasksStore {
  readonly activeTasks: TaskItem[];
  readonly activeProfileId: string | null;
  upsertTask(item: TaskItem): Promise<void>;
  softDeleteTask(id: string): Promise<void>;
  /** Optional batched write used by drag-and-drop reordering. */
  upsertTasks?(items: readonly TaskItem[]): Promise<void>;
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
  /** Id of the task currently being dragged, or `null`. */
  private draggedTaskId: string | null = null;

  /**
   * Dismiss any open three-dot menu when the user clicks outside it. Registered
   * once on the document (not per render) so re-renders never leak listeners.
   */
  private readonly onDocumentMouseDown = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && target.closest('.task-menu, .task__menu-button')) {
      return;
    }
    this.closeAllMenus();
  };

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

    document.addEventListener('mousedown', this.onDocumentMouseDown);
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
    document.removeEventListener('mousedown', this.onDocumentMouseDown);
    this.element.remove();
  }

  /** Hide every open task context menu. */
  private closeAllMenus(): void {
    for (const menu of this.listEl.querySelectorAll<HTMLElement>('.task-menu')) {
      menu.hidden = true;
    }
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
      this.menuItem('Set date/time', ICON_CALENDAR, () => this.toggleDateEditor(body, task)),
    );
    menu.appendChild(
      this.menuItem('Delete', ICON_TRASH, () => void this.store.softDeleteTask(task.id)),
    );
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      // Close any other open menu first so only one is ever visible, then
      // toggle this one. Clicking the same button again closes it.
      const willOpen = menu.hidden;
      this.closeAllMenus();
      menu.hidden = !willOpen;
    });

    // Drag handle: only the grip initiates a drag, so the checkbox, menu and
    // inline date inputs keep their normal click behaviour.
    const dragHandle = el('span', {
      className: 'task__drag',
      attrs: { draggable: 'true', 'aria-label': 'Drag to reorder', title: 'Drag to reorder' },
    });
    dragHandle.appendChild(svg(ICON_GRIP, { size: 16 }));
    dragHandle.addEventListener('dragstart', (event) => this.handleDragStart(event, task, item));
    dragHandle.addEventListener('dragend', () => this.handleDragEnd(item));

    item.addEventListener('dragover', (event) => this.handleDragOver(event, task, item));
    item.addEventListener('dragleave', (event) => this.handleDragLeave(event, item));
    item.addEventListener('drop', (event) => void this.handleDrop(event, task, item));

    item.appendChild(dragHandle);
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
    button.addEventListener('click', () => {
      // Dismiss the menu before running the action so it never lingers.
      this.closeAllMenus();
      onClick();
    });
    return button;
  }

  private toggleDateEditor(body: HTMLElement, task: TaskItem): void {
    const existing = body.querySelector('.task__date-editor');
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
    // Append inside the task body so the editor stacks below the title instead
    // of becoming a flex sibling that squeezes the text to one character wide.
    body.appendChild(editor);
  }

  /* ---------------------------------------------------------------- */
  /* Drag & drop                                                      */
  /* ---------------------------------------------------------------- */

  private handleDragStart(event: DragEvent, task: TaskItem, item: HTMLElement): void {
    this.draggedTaskId = task.id;
    item.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', task.id);
      event.dataTransfer.setDragImage(item, 12, 12);
    }
  }

  private handleDragEnd(item: HTMLElement): void {
    this.draggedTaskId = null;
    item.classList.remove('is-dragging');
    this.clearDropIndicators();
  }

  private handleDragOver(event: DragEvent, target: TaskItem, item: HTMLElement): void {
    if (!this.draggedTaskId || this.draggedTaskId === target.id) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.setDropIndicator(item, this.dropPositionFor(event, item));
  }

  private handleDragLeave(event: DragEvent, item: HTMLElement): void {
    const related = event.relatedTarget as Node | null;
    if (related && item.contains(related)) {
      return;
    }
    item.classList.remove('drop-before', 'drop-after', 'drop-child');
  }

  private async handleDrop(event: DragEvent, target: TaskItem, item: HTMLElement): Promise<void> {
    event.preventDefault();
    const draggedId = this.draggedTaskId;
    this.draggedTaskId = null;
    this.clearDropIndicators();
    if (!draggedId || draggedId === target.id) {
      return;
    }
    const position = this.dropPositionFor(event, item);
    const updated = computeTaskMove(this.store.activeTasks, draggedId, target.id, position);
    if (!updated) {
      return;
    }
    await this.persistMove(updated);
  }

  /** Map the pointer's vertical position within a row to a drop position. */
  private dropPositionFor(event: DragEvent, item: HTMLElement): DropPosition {
    const rect = item.getBoundingClientRect();
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
    if (ratio < 0.25) {
      return 'before';
    }
    if (ratio > 0.75) {
      return 'after';
    }
    return 'child';
  }

  private setDropIndicator(item: HTMLElement, position: DropPosition): void {
    this.clearDropIndicators();
    item.classList.add(`drop-${position}`);
  }

  private clearDropIndicators(): void {
    for (const node of this.listEl.querySelectorAll<HTMLElement>(
      '.drop-before, .drop-after, .drop-child',
    )) {
      node.classList.remove('drop-before', 'drop-after', 'drop-child');
    }
  }

  /** Persist only the tasks whose parent or order actually changed. */
  private async persistMove(updated: readonly TaskItem[]): Promise<void> {
    const changed = updated.filter((task) => {
      const original = this.store.activeTasks.find((entry) => entry.id === task.id);
      return (
        original !== undefined &&
        (original.parent_id !== task.parent_id || original.order !== task.order)
      );
    });
    if (changed.length === 0) {
      return;
    }
    if (this.store.upsertTasks) {
      await this.store.upsertTasks(changed);
      return;
    }
    for (const task of changed) {
      await this.store.upsertTask(task);
    }
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
