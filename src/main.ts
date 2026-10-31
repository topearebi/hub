/**
 * Hub application entrypoint.
 *
 * Phase 1 keeps this intentionally minimal: it loads the design tokens and
 * mounts a placeholder root so the build pipeline can be verified end-to-end.
 * Phase 2 attaches the omnibar and bookmark grid here without restructuring.
 */

import './styles/tokens.css';

const root = document.getElementById('app');

if (root) {
  root.textContent = 'Hub';
}
