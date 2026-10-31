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

export interface SvgOptions {
  /** Optional class applied to the root `<svg>`. */
  className?: string;
  /** Rendered width/height in px (default 20). */
  size?: number;
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
