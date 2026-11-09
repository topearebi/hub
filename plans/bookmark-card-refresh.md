# Bookmark card refresh — G-16, G-22, G-23, G-33

Primary scenario: one-handed phone browsing, often offline. Success means every
existing card action remains reachable by touch, keyboard and screen reader,
while scrolling never accidentally starts a drag.

## Approved behaviour and checklist

- [x] Reference-inspired surfaces, circular local icons, readable titles; preserve
      small/wide/large footprints, descriptions, hotkeys and custom colours.
- [x] Explicit transient Arrange mode enables whole-card Pointer Events dragging;
      action controls are excluded. Done/Escape exits; explicit Move actions remain.
- [x] Alternate URLs use labelled local initial buttons on every size, wrapping
      with 44px coarse-pointer targets. No external favicon requests.
- [x] Shared menus/dialogs respect visual viewport offsets and keyboard resizing;
      compact-phone bookmark menus become scrollable sheets.
- [x] Existing offline persistence, delete recovery and dirty-form guards remain.
      Reorder errors produce a visible retryable error; success is announced.
- [x] Strings use the catalogue, styles use tokens/logical properties, no schema
      changes or runtime dependencies. Reduced motion and forced colours supported.
- [x] Empty/first-run views remain; no network/loading dependency is introduced.
- [x] Verification: interaction regression tests, viewport tests, axe, typecheck,
      lint, test, build, contrast and gzip budget. Visual/device evidence must be
      reported separately from automated verification; no unperformed checks claimed.

Review: owner approved the implementation plan in chat on 2026-11-09.
