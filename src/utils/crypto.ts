/**
 * Cryptographically-strong identifier helpers.
 *
 * Prefers the native `crypto.randomUUID()` (RFC 4122 v4). Falls back to a
 * `crypto.getRandomValues()`-based v4 generator for environments where
 * `randomUUID` is unavailable (e.g. some jsdom test runtimes).
 */

/** Generate a UUID v4 string. Throws if no secure random source exists. */
export function newId(): string {
  const c = globalThis.crypto;

  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }

  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    // Set version (4) and variant (10xx) bits per RFC 4122.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error('No secure random source available for ID generation.');
}
