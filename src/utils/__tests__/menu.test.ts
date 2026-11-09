import { afterEach, describe, expect, it, vi } from 'vitest';

import { el } from '../dom';
import { clampToViewport, Menu, MenuKeyboard } from '../menu';

afterEach(() => {
  document.body.replaceChildren();
});

describe('clampToViewport', () => {
  it('leaves a point that already fits unchanged', () => {
    expect(clampToViewport(100, 100, 100, 100)).toEqual({ x: 100, y: 100 });
  });

  it('clamps to the bottom-right edge', () => {
    const { x, y } = clampToViewport(10_000, 10_000, 100, 100);
    expect(x).toBe(window.innerWidth - 100 - 8);
    expect(y).toBe(window.innerHeight - 100 - 8);
  });

  it('clamps to the top-left margin', () => {
    expect(clampToViewport(-50, -50, 100, 100)).toEqual({ x: 8, y: 8 });
  });
});

describe('MenuKeyboard', () => {
  function makeMenu(itemLabels: string[]): {
    element: HTMLElement;
    keyboard: MenuKeyboard;
    onClose: ReturnType<typeof vi.fn>;
  } {
    const element = el('div', { attrs: { role: 'menu' } });
    for (const label of itemLabels) {
      element.appendChild(el('button', { text: label, attrs: { role: 'menuitem' } }));
    }
    document.body.appendChild(element);
    const onClose = vi.fn();
    const keyboard = new MenuKeyboard(element, {
      getItems: () => Array.from(element.querySelectorAll<HTMLElement>('button')),
      onClose,
    });
    return { element, keyboard, onClose };
  }

  it('focuses the first item and sets a roving tabindex', () => {
    const { element, keyboard } = makeMenu(['Alpha', 'Beta', 'Gamma']);
    keyboard.activate('first');
    const items = Array.from(element.querySelectorAll<HTMLElement>('button'));
    expect(document.activeElement).toBe(items[0]);
    expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('moves with arrows, Home and End (wrapping)', () => {
    const { element, keyboard } = makeMenu(['Alpha', 'Beta', 'Gamma']);
    keyboard.activate('first');
    const items = Array.from(element.querySelectorAll<HTMLElement>('button'));

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(items[2]);

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(items[2]);

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
  });

  it('closes on Escape and Tab', () => {
    const { element, keyboard, onClose } = makeMenu(['Alpha', 'Beta']);
    keyboard.activate('first');
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('supports type-ahead', () => {
    const { element, keyboard } = makeMenu(['Alpha', 'Beta', 'Gamma']);
    keyboard.activate('first');
    const items = Array.from(element.querySelectorAll<HTMLElement>('button'));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    expect(document.activeElement).toBe(items[2]);
  });
});

describe('Menu', () => {
  it('builds items, opens clamped and closes on selection', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const menu = new Menu({
      label: 'Actions',
      className: 'context-menu',
      itemClassName: 'context-menu__item',
      separatorClassName: 'context-menu__separator',
      onClose,
      items: [
        { label: 'First', onSelect },
        { label: 'Delete', danger: true, separatorBefore: true, onSelect: vi.fn() },
      ],
    });

    menu.openAt(10, 20);
    expect(menu.isOpen()).toBe(true);

    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu__item'));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe('First');
    expect(items[1]?.classList.contains('context-menu__item--danger')).toBe(true);
    expect(document.querySelector('.context-menu__separator')).not.toBeNull();

    items[0]?.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(menu.isOpen()).toBe(false);
    expect(document.querySelector('.context-menu')).toBeNull();
  });
});

describe('visual viewport menu placement (G-16)', () => {
  it('repositions above the keyboard, restores trigger focus and cleans listeners', () => {
    const visual = new EventTarget() as EventTarget & {
      height: number;
      width: number;
      offsetTop: number;
      offsetLeft: number;
    };
    Object.assign(visual, { height: 300, width: 390, offsetTop: 60, offsetLeft: 0 });
    const original = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const menu = new Menu({
      label: 'Actions',
      items: [{ label: 'Edit', onSelect: () => undefined }],
    });
    try {
      menu.openAt(200, 700);
      expect(menu.element.style.getPropertyValue('--menu-y')).toBe('352px');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      visual.height = 200;
      visual.dispatchEvent(new Event('resize'));
      expect(menu.element.style.getPropertyValue('--menu-y')).toBe('252px');
      menu.close();
      expect(document.activeElement).toBe(trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      visual.height = 100;
      visual.dispatchEvent(new Event('resize'));
      expect(menu.element.style.getPropertyValue('--menu-y')).toBe('252px');
    } finally {
      menu.destroy();
      trigger.remove();
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: original });
    }
  });
});
