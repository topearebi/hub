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
