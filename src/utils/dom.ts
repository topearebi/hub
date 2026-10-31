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
