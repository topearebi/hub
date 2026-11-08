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
import {
  btn,
  clearChildren,
  el,
  iconBtn,
  svg,
  ICON_CHECK,
  ICON_DOWN,
  ICON_GRIP,
  ICON_MORE,
  ICON_PLUS,
  ICON_TRASH,
  ICON_UP,
} from '../utils/dom';
import { haptic } from '../utils/haptics';
import { formatDate, t } from '../utils/i18n';
import { Menu, MenuKeyboard } from '../utils/menu';
import { attachSwipe } from '../utils/swipe';
import { showToast } from './toast';
import { newId } from '../utils/crypto';
import { renderLinkified } from '../utils/text';
import type { TaskItem } from '../types/schemas';

const ICON_CALENDAR =
  'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z';
const ICON_SUBTASK = 'M6 3v12a3 3 0 0 0 3 3h9M15 15l3 3-3 3';
const ICON_INDENT = 'M3 8h18M3 12h12M3 16h18M20 12l3 3-3 3';
const ICON_OUTDENT = 'M3 8h18M9 12h12M3 16h18M4 12l-3 3 3 3';

type Recurrence = 'daily' | 'weekly' | 'monthly' | 'yearly' | null;

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

/** Active siblings under `parentId`, in visual order. */
function siblingsOf(tasks: readonly TaskItem[], parentId: string | null): TaskItem[] {
  return sortTasks(
    tasks.filter((task) => !task.completed && (task.parent_id ?? null) === parentId),
  );
}

function targetSibling(
  tasks: readonly TaskItem[],
  id: string,
  delta: number,
): TaskItem | undefined {
  const task = tasks.find((entry) => entry.id === id);
  if (!task) return undefined;
  const siblings = siblingsOf(tasks, task.parent_id ?? null);
  const index = siblings.findIndex((entry) => entry.id === id);
  return index >= 0 ? siblings[index + delta] : undefined;
}

/** Move a task before its previous sibling. Returns null when it is first. */
export function computeMoveUp(tasks: readonly TaskItem[], id: string): TaskItem[] | null {
  const prev = targetSibling(tasks, id, -1);
  return prev ? computeTaskMove(tasks, id, prev.id, 'before') : null;
}

/** Move a task after its next sibling. Returns null when it is last. */
export function computeMoveDown(tasks: readonly TaskItem[], id: string): TaskItem[] | null {
  const next = targetSibling(tasks, id, 1);
  return next ? computeTaskMove(tasks, id, next.id, 'after') : null;
}

/** Indent a task under its previous sibling. Returns null when it is first. */
export function computeIndent(tasks: readonly TaskItem[], id: string): TaskItem[] | null {
  const prev = targetSibling(tasks, id, -1);
  return prev ? computeTaskMove(tasks, id, prev.id, 'child') : null;
}

/** Outdent a task to sit after its parent. Returns null at the root. */
export function computeOutdent(tasks: readonly TaskItem[], id: string): TaskItem[] | null {
  const task = tasks.find((entry) => entry.id === id);
  const parentId = task?.parent_id ?? null;
  if (!task || !parentId) {
    return null;
  }
  return computeTaskMove(tasks, id, parentId, 'after');
}

/** Format a due date/time for display. */
export function formatDue(task: TaskItem): string {
  if (!task.due_date) {
    return '';
  }
  const date = new Date(`${task.due_date}T${task.due_time ?? '00:00'}`);
  const label = formatDate(date, { month: 'short', day: 'numeric' });
  return task.due_time ? `${label}, ${task.due_time}` : label;
}

/** Format a completion timestamp as `Day, Mon DD`. */
export function formatCompleted(at: number): string {
  return formatDate(at, { weekday: 'short', month: 'short', day: 'numeric' });
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
  /** Restore a soft-deleted task and its descendants (undo). */
  restoreTask?(id: string): Promise<void>;
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
  /** Keyboard controller for the currently open task menu, if any. */
  private activeMenuKeyboard: MenuKeyboard | null = null;
  /** Active pointer-drag state, or `null`. */
  private dragState: { id: string; item: HTMLElement; pointerId: number } | null = null;

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
      title: t('tasks.title'),
      onPinToggle: callbacks.onPinToggle,
      onClose: callbacks.onClose,
    });
    this.element = shell.element;

    /* ---- Inline creator ---- */
    this.creatorTitle = el('input', {
      className: 'task-creator__title',
      attrs: {
        type: 'text',
        placeholder: t('tasks.creatorTitlePlaceholder'),
        'aria-label': t('tasks.creatorTitleAria'),
      },
    });
    this.creatorDetails = el('textarea', {
      className: 'task-creator__details',
      attrs: {
        placeholder: t('tasks.creatorDetailsPlaceholder'),
        'aria-label': t('tasks.creatorDetailsAria'),
        rows: '2',
      },
    });
    this.creatorDate = this.dateInput('date', 'tasks.dueDateAria');
    this.creatorTime = this.dateInput('time', 'tasks.dueTimeAria', 'task-creator__time');
    this.dateRow = el('div', {
      className: 'task-creator__date-row',
      children: [this.creatorDate, this.creatorTime],
    });
    this.dateRow.hidden = true;

    const todayChip = this.chip(t('tasks.today'), () => this.setCreatorDate(todayIso(0)));
    const tomorrowChip = this.chip(t('tasks.tomorrow'), () => this.setCreatorDate(todayIso(1)));
    const dateChip = this.chip(t('tasks.dateTime'), () => {
      this.dateRow.hidden = !this.dateRow.hidden;
    });
    // Repeat opens a menu of all options rather than cycling (DESIGN.md §6.4).
    this.recurrenceChip = this.chip(t('tasks.repeat'), () => this.openRecurrenceMenu());
    this.recurrenceChip.setAttribute('aria-haspopup', 'menu');
    this.recurrenceChip.setAttribute('aria-expanded', 'false');

    const chips = el('div', {
      className: 'task-creator__chips',
      children: [todayChip, tomorrowChip, dateChip, this.recurrenceChip],
    });

    const saveButton = btn(t('common.save'), {
      className: 'button--primary',
      onClick: () => {
        void this.saveCreator();
      },
    });
    const cancelButton = btn(t('common.cancel'), { onClick: () => this.closeCreator() });

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
      children: [
        svg(ICON_PLUS, { className: 'task-add__icon' }),
        el('span', { text: t('tasks.addTask') }),
      ],
    });
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
          text: t('tasks.empty'),
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

  /** Hide every open task context menu and reset its trigger's state. */
  private closeAllMenus(): void {
    this.activeMenuKeyboard?.deactivate();
    this.activeMenuKeyboard = null;
    for (const menu of this.listEl.querySelectorAll<HTMLElement>('.task-menu')) {
      menu.hidden = true;
    }
    for (const button of this.listEl.querySelectorAll<HTMLElement>('.task__menu-button')) {
      button.setAttribute('aria-expanded', 'false');
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

  /** Open the Repeat menu (DESIGN.md §6.4: a menu, not a cycling chip). */
  private openRecurrenceMenu(): void {
    const options: ReadonlyArray<{ value: Recurrence; label: string }> = [
      { value: null, label: t('tasks.recurrence.none') },
      { value: 'daily', label: t('tasks.recurrence.daily') },
      { value: 'weekly', label: t('tasks.recurrence.weekly') },
      { value: 'monthly', label: t('tasks.recurrence.monthly') },
      { value: 'yearly', label: t('tasks.recurrence.yearly') },
    ];
    const menu = new Menu({
      label: t('tasks.repeat'),
      className: 'task-menu',
      itemClassName: 'task-menu__item',
      items: options.map((option) => ({
        label: option.label,
        role: 'menuitemradio',
        checked: this.creatorRecurrence === option.value,
        onSelect: () => {
          this.creatorRecurrence = option.value;
          this.updateRecurrenceChip();
        },
      })),
      onClose: () => this.recurrenceChip.setAttribute('aria-expanded', 'false'),
    });
    const rect = this.recurrenceChip.getBoundingClientRect();
    this.recurrenceChip.setAttribute('aria-expanded', 'true');
    menu.openAt(rect.left, rect.bottom);
  }

  private updateRecurrenceChip(): void {
    this.recurrenceChip.textContent = this.creatorRecurrence
      ? t('tasks.repeats', { recurrence: this.creatorRecurrence })
      : t('tasks.repeat');
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
        'aria-label': t('tasks.toggleAria', { title: task.title }),
      },
      children: [svg(ICON_CHECK, { className: 'task__check-icon' })],
    });
    check.addEventListener('click', () => {
      void this.toggleTask(task, !task.completed);
    });

    const bodyChildren: HTMLElement[] = [];
    const title = el('div', { className: 'task__title' });
    renderLinkified(title, task.title);
    bodyChildren.push(title);

    if (task.description) {
      const details = el('div', { className: 'task__details' });
      renderLinkified(details, task.description);
      bodyChildren.push(details);
    }

    const due = formatDue(task);
    if (due || task.recurrence) {
      bodyChildren.push(
        el('div', {
          className: 'task__meta',
          children: [
            ...(due ? [el('span', { className: 'task__due', text: due })] : []),
            ...(task.recurrence
              ? [el('span', { className: 'task__recurrence', text: task.recurrence })]
              : []),
          ],
        }),
      );
    }
    const body = el('div', { className: 'task__body', children: bodyChildren });

    const menuId = `task-menu-${task.id}`;
    const menuButton = iconBtn(
      ICON_MORE,
      t('common.actionsFor', { name: task.title }),
      undefined,
      'icon-button task__menu-button',
    );
    menuButton.setAttribute('aria-haspopup', 'menu');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-controls', menuId);

    const move = (fn: (tasks: readonly TaskItem[], id: string) => TaskItem[] | null) => () =>
      void this.applyMove(fn(this.store.activeTasks, task.id));
    const actions: Array<[string, string, () => void]> = [
      [t('tasks.addSubtask'), ICON_SUBTASK, () => this.openCreator(task.id)],
      [t('tasks.setDateTime'), ICON_CALENDAR, () => this.toggleDateEditor(body, task)],
      [t('tasks.moveUp'), ICON_UP, move(computeMoveUp)],
      [t('tasks.moveDown'), ICON_DOWN, move(computeMoveDown)],
      [t('tasks.indent'), ICON_INDENT, move(computeIndent)],
      [t('tasks.outdent'), ICON_OUTDENT, move(computeOutdent)],
      [t('common.delete'), ICON_TRASH, () => void this.deleteTask(task.id)],
    ];
    const menu = el('div', {
      className: 'task-menu',
      attrs: {
        role: 'menu',
        id: menuId,
        'aria-label': t('common.actionsFor', { name: task.title }),
      },
      children: actions.map(([lbl, ic, fn]) => this.menuItem(lbl, ic, fn)),
    });
    menu.hidden = true;
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      // Close any other open menu first so only one is ever visible, then
      // toggle this one. Clicking the same button again closes it.
      const willOpen = menu.hidden;
      this.closeAllMenus();
      if (!willOpen) {
        return;
      }
      menu.hidden = false;
      menuButton.setAttribute('aria-expanded', 'true');
      const keyboard = new MenuKeyboard(menu, {
        getItems: () => Array.from(menu.querySelectorAll<HTMLElement>('.task-menu__item')),
        onClose: () => this.closeAllMenus(),
      });
      keyboard.activate('first');
      this.activeMenuKeyboard = keyboard;
    });

    // Drag handle: pointer-based reordering (G-20, G-24). Keyboard users use
    // the Move/Indent menu actions instead, so dragging is never the only path.
    const dragHandle = iconBtn(ICON_GRIP, t('tasks.dragAria'), undefined, 'task__drag', 16);
    dragHandle.addEventListener('pointerdown', (event) =>
      this.handleHandlePointerDown(event, task, item),
    );
    dragHandle.addEventListener('pointermove', (event) => this.handleHandlePointerMove(event));
    dragHandle.addEventListener('pointerup', (event) => void this.handleHandlePointerUp(event));
    dragHandle.addEventListener('pointercancel', () => this.handleHandlePointerCancel());

    item.dataset.taskId = task.id;
    item.append(dragHandle, check, body, menuButton, menu);

    // Swipe gestures (touch only, G-25): right completes, left deletes. Both
    // actions stay reachable by touch and keyboard via the check and the menu.
    let swiped = false;
    const resetSwipe = (): void => {
      window.setTimeout(() => {
        swiped = false;
      }, 500);
    };
    attachSwipe(item, {
      ignoreSelector: '.task__drag, .task__menu-button, .task__check',
      onSwipeRight: () => {
        swiped = true;
        resetSwipe();
        haptic('success');
        void this.toggleTask(task, true);
      },
      onSwipeLeft: () => {
        swiped = true;
        resetSwipe();
        haptic('warning');
        void this.deleteTask(task.id);
      },
    });
    item.addEventListener(
      'click',
      (event) => {
        if (swiped) {
          swiped = false;
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );
    return item;
  }

  /** Delete a task with an undo affordance (G-40). */
  private async deleteTask(id: string): Promise<void> {
    haptic('warning');
    await this.store.softDeleteTask(id);
    showToast(t('tasks.deleted'), {
      variant: 'info',
      action: {
        label: t('common.undo'),
        onSelect: () => {
          void this.store.restoreTask?.(id);
        },
      },
    });
  }

  private menuItem(label: string, icon: string, onClick: () => void): HTMLElement {
    const button = el('button', {
      className: 'task-menu__item',
      attrs: { type: 'button', role: 'menuitem' },
      children: [svg(icon, { size: 16 }), el('span', { text: label })],
    });
    button.addEventListener('click', () => {
      // Dismiss the menu before running the action so it never lingers.
      this.closeAllMenus();
      onClick();
    });
    return button;
  }

  private dateInput(
    type: 'date' | 'time',
    ariaKey: string,
    cls = 'task-creator__date',
  ): HTMLInputElement {
    return el('input', { className: cls, attrs: { type, 'aria-label': t(ariaKey) } });
  }

  private toggleDateEditor(body: HTMLElement, task: TaskItem): void {
    const existing = body.querySelector('.task__date-editor');
    if (existing) {
      existing.remove();
      return;
    }

    const date = this.dateInput('date', 'tasks.dueDateAria');
    date.value = task.due_date ?? '';
    const time = this.dateInput('time', 'tasks.dueTimeAria', 'task-creator__time');
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

  private handleHandlePointerDown(event: PointerEvent, task: TaskItem, item: HTMLElement): void {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.dragState = { id: task.id, item, pointerId: event.pointerId };
    item.classList.add('is-dragging');
  }

  private handleHandlePointerMove(event: PointerEvent): void {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }
    const row = this.rowUnder(event.clientX, event.clientY);
    if (!row || row === this.dragState.item) {
      this.clearDropIndicators();
      return;
    }
    this.setDropIndicator(row, this.dropPositionFor(event.clientY, row));
  }

  private async handleHandlePointerUp(event: PointerEvent): Promise<void> {
    const state = this.dragState;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }
    this.dragState = null;
    state.item.classList.remove('is-dragging');
    const row = this.rowUnder(event.clientX, event.clientY);
    this.clearDropIndicators();
    if (!row || row === state.item) {
      return;
    }
    const targetId = row.dataset.taskId;
    if (!targetId) {
      return;
    }
    const updated = computeTaskMove(
      this.store.activeTasks,
      state.id,
      targetId,
      this.dropPositionFor(event.clientY, row),
    );
    if (updated) {
      await this.persistMove(updated);
    }
  }

  private handleHandlePointerCancel(): void {
    if (!this.dragState) {
      return;
    }
    this.dragState.item.classList.remove('is-dragging');
    this.dragState = null;
    this.clearDropIndicators();
  }

  /** The task row currently under a viewport point, if any. */
  private rowUnder(x: number, y: number): HTMLElement | null {
    const node = document.elementFromPoint(x, y);
    const row = node instanceof Element ? node.closest<HTMLElement>('.task') : null;
    return row && this.listEl.contains(row) ? row : null;
  }

  /** Apply a move result from the menu actions. */
  private async applyMove(updated: TaskItem[] | null): Promise<void> {
    if (updated) {
      await this.persistMove(updated);
    }
  }

  /** Map the pointer's vertical position within a row to a drop position. */
  private dropPositionFor(clientY: number, item: HTMLElement): DropPosition {
    const rect = item.getBoundingClientRect();
    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
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
      children: [el('span', { text: t('tasks.completed', { count: tasks.length }) })],
    });
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
        children: [svg(ICON_CHECK, { className: 'task__check-icon' })],
      });
      check.addEventListener('click', () => {
        void this.toggleTask(task, false);
      });

      const body = el('div', { className: 'task__body' });
      body.appendChild(el('div', { className: 'task__title', text: task.title }));
      if (typeof task.completed_at === 'number') {
        body.appendChild(
          el('div', {
            className: 'task__completed-at',
            text: t('tasks.completedAt', { date: formatCompleted(task.completed_at) }),
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
    haptic(completed ? 'success' : 'light');
    const now = Date.now();
    await this.store.upsertTask({
      ...task,
      completed,
      completed_at: completed ? now : null,
      updated_at: now,
    });
  }
}
