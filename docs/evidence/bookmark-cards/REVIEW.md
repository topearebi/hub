# Bookmark card refresh review

## Summary

Bookmark cards now use a reference-inspired circular-icon layout with visible
controls and compact accessible alternate-link avatars. Arrange mode makes the
whole card draggable while preserving tap-to-open and scrolling during browsing.
Shared panels follow the visual viewport, keeping editor controls above keyboards.

## Spec and gap references

- DESIGN.md bookmark card refresh and responsive grid; accessibility.md bookmark
  card refresh; SCHEMAS.md icon privacy clarification (no field changes).
- G-16, G-22, G-23, G-33. Feature specification: plans/bookmark-card-refresh.md.

## Verification and quality gates

- Typecheck, lint, 377 tests, production build and 104 contrast pairs pass.
- Automated axe includes Arrange mode and alternate controls: zero serious/critical
  violations. Three final Lighthouse samples each scored PWA 100, accessibility
  97 and performance 99; the release assertions passed. An earlier isolated
  sample scored performance 70, so timing variance was checked with this repeat.
- Gzip assets total 59.92 KiB against the unchanged 60 KiB budget. Terser is build
  only; no runtime dependency was introduced.
- Headless Chromium 157: 320, 390, 768, 1280 and 1920 CSS px, light/dark, portrait
  and short landscape. No page overflow; all tested card action/alternate targets
  meet 44px with coarse pointers and the 24px fine-pointer floor.
- CDP touch input completed a whole-card move and success announcement. Tests
  cover non-drag browsing, cancellation, action exclusion, empty/collapsed category
  drops, edge scrolling, failures/retry and explicit Move actions.
- Keyboard-sized editor remained within the visible viewport with Save visible.
  Tests cover menu viewport changes, focus restoration and listener cleanup.
- Local avatars avoid favicon services. Existing delete and dirty-form recovery
  flows remain covered by the suite. No schema or sync payload changes.

## Evidence

- [Phone, light](phone-light.png), [phone, dark](phone-dark.png)
- [Desktop](desktop-light.png), [phone actions](phone-menu.png)
- [Compact editor](editor-compact.png), [browser measurements](browser-checks.json)

The measurements use isolated sample data. The browser captures disable service
worker registration to keep the screenshot session stable; production Lighthouse
runs use the normal application and service worker. No screenshots or reports
were uploaded to external services.

## Risks and manual follow-ups

Physical touch devices, actual software keyboard behaviour (especially iOS),
notched safe areas, and VoiceOver/TalkBack/NVDA remain unverified here. Browser
emulation and axe do not replace those checks. Bundle headroom is small; keep
running the size gate for subsequent work. Existing Vite warnings about the raw
chunk size and missing critical.css predate this change; the gzip gate passes.
