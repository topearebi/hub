/**
 * Vitest global setup.
 *
 * `fake-indexeddb/auto` installs an in-memory IndexedDB implementation onto the
 * global scope so the data engine can be exercised in CI without a real browser.
 */
import 'fake-indexeddb/auto';
