import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindVisualViewport, computeViewportMetrics } from '../viewport';

describe('computeViewportMetrics (G-16)', () => {
  it('reports no keyboard inset when the visual viewport fills the layout viewport', () => {
    expect(computeViewportMetrics(800, { height: 800, offsetTop: 0 })).toEqual({
      height: 800,
      offsetTop: 0,
      keyboardInset: 0,
    });
  });

  it('derives the keyboard height from the visual viewport shrink', () => {
    // A 300 px keyboard leaves a 500 px visual viewport at the top.
    expect(computeViewportMetrics(800, { height: 500, offsetTop: 0 })).toEqual({
      height: 500,
      offsetTop: 0,
      keyboardInset: 300,
    });
  });

  it('accounts for a scrolled visual viewport offset', () => {
    // The visual viewport is 500 px tall but scrolled 100 px down, so the
    // keyboard occupies 800 - 500 - 100 = 200 px.
    expect(computeViewportMetrics(800, { height: 500, offsetTop: 100 }).keyboardInset).toBe(200);
  });

  it('never returns a negative inset (pinch-zoom can enlarge the visual viewport)', () => {
    expect(computeViewportMetrics(800, { height: 900, offsetTop: 0 }).keyboardInset).toBe(0);
  });
});

describe('bindVisualViewport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('style');
  });

  it('no-ops when the Visual Viewport API is unavailable', () => {
    vi.stubGlobal('visualViewport', undefined);
    const dispose = bindVisualViewport();
    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
  });

  it('publishes --keyboard-inset and --vvh and updates on resize', () => {
    const listeners = new Map<string, () => void>();
    const visual = {
      height: 500,
      offsetTop: 0,
      addEventListener: (type: string, handler: () => void) => listeners.set(type, handler),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    vi.stubGlobal('visualViewport', visual);
    vi.stubGlobal('innerHeight', 800);

    const dispose = bindVisualViewport();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('300px');
    expect(root.style.getPropertyValue('--vvh')).toBe('500px');

    // Keyboard closes: the visual viewport grows back to the layout height.
    visual.height = 800;
    listeners.get('resize')?.();
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('0px');

    dispose();
    expect(listeners.has('resize')).toBe(false);
  });
});
