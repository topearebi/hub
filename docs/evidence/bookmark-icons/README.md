# Bookmark icon repair — 2026-11-09

The card redesign rejected all external Icon URL values and never attempted an
automatic favicon. The owner's explicit request restores those image requests;
other runtime network connections stay restricted. Shared saved-card/live-preview
rendering now tries custom image → origin `/favicon.ico` → local initial.

- Spec: [bookmark-icon-repair](../../../plans/bookmark-icon-repair.md); G-22/G-55.
- No schema, runtime dependency, touch target or layout changes.
- **428 tests / 45 files**, typecheck, lint, build and **104/104** contrast pairs pass.
- Initial JS+CSS **59.80 KiB gzip**, total JS+CSS **68.54 KiB**; budget stays <60 initial.
- Real Chromium, 390px coarse-pointer phone and 1280px desktop-width emulation:
  loaded explicit external images on all sizes, direct favicons, custom-image
  failure → site icon, missing image → local avatar, and actual editor changes
  between explicit and automatic icons. All image requests had no referrer;
  automatic requests did not include saved private bookmark paths or queries.
- Lighthouse mobile performance **85/100/100** (median **100**, gate >=90),
  accessibility **97**, PWA **100**; unchanged three-run assertions pass.
  [All Lighthouse scores](lighthouse.json).
- Browser image responses used intercepted deterministic SVG/404 fixtures, not
  unreliable live third-party sites or a live user profile.
- Existing full suite includes axe, focus, touch/Arrange and preview integration checks.
- Physical devices/screen readers remain the existing owner-run release matrix.

[Phone screenshot](phone.png) · [Desktop screenshot](desktop.png) ·
[Browser image/network checks](browser.json) · [Tests](tests.txt) · [Bundle](bundle.txt).

Automatic discovery uses the standard origin `/favicon.ico`; sites that do not
serve it can use the Icon URL field. Browser mixed-content rules apply. Unavailable
images, including offline images, fall back locally without disabling card features.
No external favicon proxy/service is introduced. Decorative images have empty alt,
lazy loading, async decoding and no-referrer; unsupported custom URL schemes are
rejected. CSP permits image data/blob and HTTP(S) image sources while `connect-src`
continues to allow only same-origin and api.github.com.
