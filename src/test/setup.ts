/**
 * Vitest global setup.
 *
 * `fake-indexeddb/auto` installs an in-memory IndexedDB implementation onto the
 * global scope so the data engine can be exercised in CI without a real browser.
 */
import 'fake-indexeddb/auto';

/**
 * jsdom does not implement `<canvas>`. axe-core probes `getContext` for its
 * icon-ligature detection (Phase 11 a11y gate); returning `null` makes the probe
 * a no-op instead of logging a "Not implemented" error on every run.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
