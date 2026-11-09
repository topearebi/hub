# First-install performance fix — G-49, G-56

The failed release report scored performance 87 (minimum 90), with 450ms total
blocking time and two document loads on a fresh visit. The initial service
worker's `clients.claim()` triggered the same reload handler as an update,
repeating startup work. Initial claims must not reload; replacing an existing
controller must reload once. The user-controlled update prompt remains intact.

This is a lifecycle correctness fix, with no new fields, dependencies, UI, network
hosts or storage migrations. Offline precaching, cached asset versions and user
data remain intact. No performance/accessibility/PWA threshold is lowered.

Acceptance checks:

- Fresh install claims its page without reloading.
- A later accepted update in that session reloads once.
- Existing installations reload once when their controller is replaced; duplicate
  notifications or loss of a controller do not reload.
- Real-browser old-to-new upgrade retains IndexedDB bookmarks and works offline,
  without clearing cookies, storage or caches manually.
- Three Lighthouse samples use the median performance score (minimum 90); the
  server readiness pattern matches Vite's coloured URL output reliably.
- Typecheck, lint, tests, build, contrast and the unchanged gzip budget pass.

Evidence: `docs/evidence/lighthouse-first-install/REVIEW.md`.
