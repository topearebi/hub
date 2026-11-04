/**
 * axe-core accessibility harness (roadmap Phase 11, G-56).
 * --------------------------------------------------------
 * Runs the axe-core engine against a rendered component fragment and fails the
 * test on any **serious** or **critical** violation. This is the automated half
 * of the release gate; the manual screen-reader and device matrix lives in
 * `plans/production-readiness.md` §5.3.
 *
 * Rules that cannot be evaluated meaningfully against a component fragment in
 * jsdom are disabled here and covered elsewhere:
 *   - `color-contrast` — jsdom has no layout engine; the token palette is
 *     verified by `scripts/contrast.mjs` (104/104 pairs).
 *   - document-level rules (`region`, `landmark-one-main`, `page-has-heading-one`,
 *     `bypass`, `html-has-lang`, `document-title`) — a fragment is not a page.
 */

import axe from 'axe-core';
import { expect } from 'vitest';

/** axe rules that are not applicable to a component fragment in jsdom. */
const DISABLED_RULES: Record<string, { enabled: boolean }> = {
  'color-contrast': { enabled: false },
  region: { enabled: false },
  'landmark-one-main': { enabled: false },
  'page-has-heading-one': { enabled: false },
  bypass: { enabled: false },
  'html-has-lang': { enabled: false },
  'document-title': { enabled: false },
};

export interface A11yViolation {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: number;
}

/**
 * Run axe on `container` and return only serious/critical violations, reduced to
 * a compact shape so failure messages stay readable.
 */
export async function seriousViolations(container: HTMLElement): Promise<A11yViolation[]> {
  const results = await axe.run(container, { rules: DISABLED_RULES });
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.length,
    }));
}

/**
 * Assert that `container` has no serious or critical axe violations. The failure
 * message lists each rule id, impact and node count so the fix is obvious.
 */
export async function expectNoA11yViolations(container: HTMLElement): Promise<void> {
  const violations = await seriousViolations(container);
  const summary = violations
    .map(
      (violation) =>
        `  - ${violation.id} (${violation.impact}): ${violation.help} [${violation.nodes} node(s)]`,
    )
    .join('\n');
  expect(violations, `axe serious/critical violations:\n${summary}`).toEqual([]);
}
