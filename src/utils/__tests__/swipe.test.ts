import { describe, expect, it, vi } from 'vitest';

import { attachSwipe } from '../swipe';

function pointer(type: string, x: number, y: number, pointerType = 'touch'): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

describe('attachSwipe', () => {
  it('fires onSwipeLeft for a leftward swipe', () => {
    const el = document.createElement('div');
    const onSwipeLeft = vi.fn();
    attachSwipe(el, { onSwipeLeft });
    el.dispatchEvent(pointer('pointerdown', 200, 100));
    el.dispatchEvent(pointer('pointerup', 100, 100));
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it('fires onSwipeRight for a rightward swipe', () => {
    const el = document.createElement('div');
    const onSwipeRight = vi.fn();
    attachSwipe(el, { onSwipeRight });
    el.dispatchEvent(pointer('pointerdown', 100, 100));
    el.dispatchEvent(pointer('pointerup', 200, 100));
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('ignores short or vertical gestures', () => {
    const el = document.createElement('div');
    const onSwipeLeft = vi.fn();
    attachSwipe(el, { onSwipeLeft });
    el.dispatchEvent(pointer('pointerdown', 200, 100));
    el.dispatchEvent(pointer('pointerup', 180, 100));
    el.dispatchEvent(pointer('pointerdown', 200, 100));
    el.dispatchEvent(pointer('pointerup', 100, 200));
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('ignores mouse pointers', () => {
    const el = document.createElement('div');
    const onSwipeLeft = vi.fn();
    attachSwipe(el, { onSwipeLeft });
    el.dispatchEvent(pointer('pointerdown', 200, 100, 'mouse'));
    el.dispatchEvent(pointer('pointerup', 100, 100, 'mouse'));
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('ignores gestures starting on an ignored descendant', () => {
    const el = document.createElement('div');
    const child = document.createElement('button');
    child.className = 'handle';
    el.appendChild(child);
    const onSwipeLeft = vi.fn();
    attachSwipe(el, { onSwipeLeft, ignoreSelector: '.handle' });
    child.dispatchEvent(pointer('pointerdown', 200, 100));
    el.dispatchEvent(pointer('pointerup', 100, 100));
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('destroy removes the listeners', () => {
    const el = document.createElement('div');
    const onSwipeLeft = vi.fn();
    const controller = attachSwipe(el, { onSwipeLeft });
    controller.destroy();
    el.dispatchEvent(pointer('pointerdown', 200, 100));
    el.dispatchEvent(pointer('pointerup', 100, 100));
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });
});
