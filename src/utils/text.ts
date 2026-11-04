/**
 * Text utilities
 * --------------
 * `linkify` splits plain text into text/URL segments so task titles and details
 * can render functional anchors without ever using `innerHTML` (XSS-safe).
 */

export interface TextSegment {
  type: 'text' | 'url';
  value: string;
}

const URL_PATTERN = /https?:\/\/[^\s]+/gi;

/** Split `text` into plain-text and URL segments. Pure and unit-tested. */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = new RegExp(URL_PATTERN.source, 'gi');
  let lastIndex = 0;
  let match: RegExpExecArray | null = regex.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'url', value: match[0] });
    lastIndex = match.index + match[0].length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * First user-perceived character of `text`, uppercased, or `fallback` when the
 * input is empty. Uses `Array.from` so emoji and other surrogate pairs (which
 * `charAt(0)` would split into a lone half) are handled as a single character
 * (G-59).
 */
export function initialOf(text: string | null | undefined, fallback = '?'): string {
  const first = Array.from((text ?? '').trim())[0];
  return (first ?? fallback).toUpperCase();
}

/**
 * Sanitise a value for interpolation inside a CSS `url("…")` token (G-55).
 *
 * - Returns an empty string for values whose scheme is not `http`, `https`,
 *   `data:image/` or a scheme-less relative path, so callers fall back safely.
 * - Escapes backslashes, double quotes and line breaks so the value can never
 *   break out of the quoted `url()` token (defence in depth: `url()` is never
 *   built from unsanitised user input elsewhere either).
 */
export function safeCssUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^(?:https?|data:image\/)/i.test(trimmed)) {
    return '';
  }
  return trimmed
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, '');
}

/**
 * Render `text` into `container`, turning URLs into safe anchors. Uses
 * `textContent`/`createElement` only (no `innerHTML`).
 */
export function renderLinkified(container: HTMLElement, text: string): void {
  for (const segment of linkify(text)) {
    if (segment.type === 'url') {
      const anchor = document.createElement('a');
      anchor.href = segment.value;
      anchor.textContent = segment.value;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'text-link';
      container.appendChild(anchor);
    } else {
      container.appendChild(document.createTextNode(segment.value));
    }
  }
}
