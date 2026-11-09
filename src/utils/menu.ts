/**
 * Shared menu / popover primitive (G-19, G-31).
 *
 * Provides two building blocks so every menu in Hub shares the same keyboard
 * contract and viewport behaviour:
 *   - `MenuKeyboard` attaches roving tabindex plus Arrow/Home/End/Escape/
 *     type-ahead handling to an existing `role="menu"` element.
 *   - `Menu` builds a complete floating menu (items, separators, icons) and
 *     opens it clamped to the viewport.
 *
 * `clampToViewport` is a pure function so positioning is unit-testable without
 * a real layout engine. Built only with the XSS-safe `el()`/`svg()` helpers.
 */

import { el, on, svg } from './dom';
import { bindVisualViewport } from './viewport';

export type MenuItemRole = 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';

export interface MenuItemSpec {
  label: string;
  onSelect: () => void;
  role?: MenuItemRole;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  /** Render a separator above this item. */
  separatorBefore?: boolean;
  /** Optional inline SVG path rendered before the label. */
  icon?: string;
}

export interface MenuOptions {
  label: string;
  items: readonly MenuItemSpec[];
  className?: string;
  itemClassName?: string;
  separatorClassName?: string;
  /** Called when the menu closes (Escape, Tab, outside click, selection). */
  onClose?: () => void;
}

/** Clamp a floating panel's top-left so it stays within the viewport. */
export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = 8,
): { x: number; y: number } {
  const visual = window.visualViewport;
  const left = visual?.offsetLeft ?? 0;
  const top = visual?.offsetTop ?? 0;
  const maxX = Math.max(
    left + margin,
    left + (visual?.width ?? window.innerWidth) - width - margin,
  );
  const maxY = Math.max(
    top + margin,
    top + (visual?.height ?? window.innerHeight) - height - margin,
  );
  return {
    x: Math.min(Math.max(left + margin, x), maxX),
    y: Math.min(Math.max(top + margin, y), maxY),
  };
}

export interface MenuKeyboardOptions {
  /** Menu items in DOM order (only enabled items are navigated). */
  getItems: () => HTMLElement[];
  /** Called when the menu should close. */
  onClose: () => void;
}

/**
 * Roving-tabindex keyboard navigation for a `role="menu"` element. Activate when
 * the menu opens, deactivate when it closes.
 */
export class MenuKeyboard {
  private disposers: Array<() => void> = [];
  private typeBuffer = '';
  private typeTimer: ReturnType<typeof setTimeout> | null = null;
  private items: HTMLElement[] = [];

  constructor(
    private readonly element: HTMLElement,
    private readonly options: MenuKeyboardOptions,
  ) {}

  /** Enable navigation and move focus to the first (or last) item. */
  activate(focus: 'first' | 'last' | 'none' = 'first'): void {
    this.items = this.options.getItems();
    this.items.forEach((item, index) => {
      item.setAttribute('tabindex', index === 0 ? '0' : '-1');
    });

    if (focus !== 'none' && this.items.length > 0) {
      const target = focus === 'last' ? this.items[this.items.length - 1] : this.items[0];
      target?.focus();
    }

    this.disposers.push(
      on<KeyboardEvent>(this.element, 'keydown', (event) => this.handleKeydown(event)),
    );
  }

  deactivate(): void {
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
    this.items = [];
    if (this.typeTimer !== null) {
      clearTimeout(this.typeTimer);
      this.typeTimer = null;
    }
    this.typeBuffer = '';
  }

  private focusIndex(index: number): void {
    const item = this.items[index];
    if (!item) {
      return;
    }
    this.items.forEach((node, i) => node.setAttribute('tabindex', i === index ? '0' : '-1'));
    item.focus();
  }

  private currentIndex(): number {
    return this.items.findIndex((item) => item === document.activeElement);
  }

  private handleKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusIndex(this.currentIndex() + 1 >= this.items.length ? 0 : this.currentIndex() + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.focusIndex(
          this.currentIndex() - 1 < 0 ? this.items.length - 1 : this.currentIndex() - 1,
        );
        return;
      case 'Home':
        event.preventDefault();
        this.focusIndex(0);
        return;
      case 'End':
        event.preventDefault();
        this.focusIndex(this.items.length - 1);
        return;
      case 'Escape':
        event.preventDefault();
        this.options.onClose();
        return;
      case 'Tab':
        // Tab always leaves the menu and closes it (focus is not trapped).
        this.options.onClose();
        return;
      default:
        break;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.typeAhead(event.key);
    }
  }

  private typeAhead(char: string): void {
    this.typeBuffer += char.toLowerCase();
    if (this.typeTimer !== null) {
      clearTimeout(this.typeTimer);
    }
    this.typeTimer = setTimeout(() => {
      this.typeBuffer = '';
    }, 500);

    const index = this.items.findIndex((item) =>
      (item.textContent ?? '').trim().toLowerCase().startsWith(this.typeBuffer),
    );
    if (index >= 0) {
      this.focusIndex(index);
    }
  }
}

export class Menu {
  readonly element: HTMLElement;

  private readonly keyboard: MenuKeyboard;
  private disposers: Array<() => void> = [];
  private opened = false;
  private trigger: HTMLElement | null = null;

  constructor(private readonly options: MenuOptions) {
    this.element = el('div', {
      className: options.className ?? 'menu',
      attrs: { role: 'menu', 'aria-label': options.label },
    });
    this.render();

    this.keyboard = new MenuKeyboard(this.element, {
      getItems: () => this.items(),
      onClose: () => this.close(),
    });
  }

  private items(): HTMLElement[] {
    return Array.from(
      this.element.querySelectorAll<HTMLElement>(
        `.${(this.options.itemClassName ?? 'menu__item').split(' ').join('.')}:not([disabled])`,
      ),
    );
  }

  private render(): void {
    const baseItemClass = this.options.itemClassName ?? 'menu__item';
    for (const spec of this.options.items) {
      if (spec.separatorBefore) {
        this.element.appendChild(
          el('div', { className: this.options.separatorClassName ?? 'menu__separator' }),
        );
      }
      const classes = [baseItemClass];
      if (spec.danger) {
        classes.push(`${baseItemClass}--danger`);
      }
      const item = el('button', {
        className: classes.join(' '),
        attrs: {
          type: 'button',
          role: spec.role ?? 'menuitem',
        },
      });
      if (spec.disabled) {
        item.setAttribute('disabled', '');
      }
      if (spec.checked !== undefined) {
        item.setAttribute('aria-checked', spec.checked ? 'true' : 'false');
      }
      if (spec.icon) {
        item.appendChild(svg(spec.icon, { size: 16 }));
      }
      item.appendChild(el('span', { text: spec.label }));
      item.addEventListener('click', () => {
        this.close();
        spec.onSelect();
      });
      this.element.appendChild(item);
    }
  }

  /** Open the menu at a point, clamped to the viewport. */
  openAt(x: number, y: number): void {
    this.open();
    const position = (): void => {
      const rect = this.element.getBoundingClientRect();
      const point = clampToViewport(x, y, rect.width, rect.height);
      this.element.style.setProperty('--menu-x', `${point.x}px`);
      this.element.style.setProperty('--menu-y', `${point.y}px`);
    };
    position();
    this.disposers.push(on(window, 'resize', position));
    this.disposers.push(bindVisualViewport(this.element, position));
    this.keyboard.activate('first');
  }

  private open(): void {
    if (this.opened) {
      return;
    }
    this.opened = true;
    this.trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.trigger?.setAttribute('aria-expanded', 'true');
    if (!this.element.isConnected) {
      document.body.appendChild(this.element);
    }
    this.element.hidden = false;
    this.element.classList.add('is-open');

    this.disposers.push(
      on(document, 'pointerdown', (event: Event) => {
        if (!this.element.contains(event.target as Node)) {
          this.close();
        }
      }),
    );
  }

  close(): void {
    if (!this.opened) {
      return;
    }
    this.opened = false;
    this.keyboard.deactivate();
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
    this.element.classList.remove('is-open');
    this.element.remove();
    this.trigger?.setAttribute('aria-expanded', 'false');
    if (this.trigger?.isConnected) this.trigger.focus();
    this.trigger = null;
    this.options.onClose?.();
  }

  isOpen(): boolean {
    return this.opened;
  }

  destroy(): void {
    this.close();
    this.element.remove();
  }
}
