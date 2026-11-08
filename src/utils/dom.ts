/**
 * Minimal, XSS-safe DOM construction helpers.
 *
 * AGENTS.md forbids `innerHTML` with user content. Every helper here builds
 * nodes via `createElement` + `textContent` + `setAttribute` only.
 */

export interface ElOptions {
  /** Space-separated class list applied via `className`. */
  className?: string;
  /** Text content set via `textContent` (never parsed as HTML). */
  text?: string;
  /** Attributes applied via `setAttribute`. */
  attrs?: Record<string, string>;
  /** Child nodes appended in order. */
  children?: readonly Node[];
}

/**
 * Create a typed element with safe text/attribute assignment.
 *
 * @example
 *   const btn = el('button', { className: 'card', text: 'Open', attrs: { type: 'button' } });
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (options.className !== undefined) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.attrs !== undefined) {
    for (const [name, value] of Object.entries(options.attrs)) {
      node.setAttribute(name, value);
    }
  }
  if (options.children !== undefined) {
    for (const child of options.children) {
      node.appendChild(child);
    }
  }

  return node;
}

/**
 * Attach an event listener and return a disposer that removes it.
 * Keeps component teardown explicit and leak-free.
 */
export function on<E extends Event>(
  target: EventTarget,
  type: string,
  handler: (event: E) => void,
  options?: AddEventListenerOptions,
): () => void {
  const listener = handler as EventListener;
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}

/** Remove all children from a node without using innerHTML. */
export function clearChildren(node: Node): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---- Common SVG icon paths shared across components ---- */
export const ICON_CLOSE = 'M18 6 6 18M6 6l12 12';
export const ICON_PLUS = 'M12 5v14M5 12h14';
export const ICON_CHEVRON = 'M6 9l6 6 6-6';
export const ICON_TRASH =
  'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6';
export const ICON_UP = 'M12 19V5M5 12l7-7 7 7';
export const ICON_DOWN = 'M12 5v14M19 12l-7 7-7-7';
export const ICON_CHECK = 'M20 6 9 17l-5-5';
export const ICON_MORE = 'M12 6h.01M12 12h.01M12 18h.01';
export const ICON_SYNC =
  'M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M3 16v-4h4M21 8V4h-4';
export const ICON_GRIP = 'M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01';
export const ICON_PIN =
  'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';
export const ICON_TASKS = 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11';
export const ICON_NOTES = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6';

export interface SvgOptions {
  /** Optional class applied to the root `<svg>`. */
  className?: string;
  /** Rendered width/height in px (default 20). */
  size?: number;
}

export interface HubLogoOptions {
  /** Optional class applied to the root `<svg>`. */
  className?: string;
  /** Rendered width/height in px (default 24). */
  size?: number;
  /** Whether to render the rounded squircle background (default true). */
  withBackground?: boolean;
}

/**
 * Build the official Hub app logo mark as an inline SVG.
 * Sourced from the 512x512 design space (DESIGN.md §2).
 */
export function hubLogoSvg(options: HubLogoOptions = {}): SVGSVGElement {
  const size = options.size ?? 24;
  const withBackground = options.withBackground ?? true;
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', '0 0 512 512');
  node.setAttribute('width', String(size));
  node.setAttribute('height', String(size));
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  if (options.className !== undefined) {
    node.setAttribute('class', options.className);
  }

  if (withBackground) {
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', '512');
    bg.setAttribute('height', '512');
    bg.setAttribute('rx', '112');
    bg.setAttribute('class', 'hub-logo__bg');
    node.appendChild(bg);
  }

  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'hub-logo__mark');

  const squares = [
    [132, 132, 1],
    [276, 132, 0.55],
    [132, 276, 0.55],
    [276, 276, 0.3],
  ] as const;

  for (const [x, y, op] of squares) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', '104');
    rect.setAttribute('height', '104');
    rect.setAttribute('rx', '26');
    if (op < 1) {
      rect.setAttribute('opacity', String(op));
    }
    g.appendChild(rect);
  }

  node.appendChild(g);
  return node;
}

/**
 * Build a local, inline SVG icon from a single path `d` string.
 *
 * AGENTS.md forbids external icon CDNs, so every icon in Hub is an inline SVG
 * created here. The stroke inherits `currentColor` for theme compatibility.
 */
export function svg(pathData: string, options: SvgOptions = {}): SVGSVGElement {
  const size = options.size ?? 20;
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('width', String(size));
  node.setAttribute('height', String(size));
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '2');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  if (options.className !== undefined) {
    node.setAttribute('class', options.className);
  }

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathData);
  node.appendChild(path);

  return node;
}
