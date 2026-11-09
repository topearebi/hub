# Bookmark icon rendering repair — G-22, G-55

Status: Implemented and verified; approved by the owner's 2026-11-09 request to restore automatic site icons
and the existing Icon URL field. This supersedes the card refresh's local-only
bookmark-image rule; remote image requests for this purpose are explicitly authorized.

- [x] Scenario: a saved link displays its custom image, or its site's favicon.
- [x] No schema changes, new dependencies, icon proxy or favicon service.
- [x] Loading never blocks navigation, arranging, initialization or editing.
- [x] All card sizes and the live preview share the same renderer.
- [x] Decorative images have empty alt; bookmark title remains the accessible name.
- [x] Images send no referrer; arbitrary script/document URL schemes are rejected.
- [x] Existing tokens, sizes, touch targets, menu and arranging behaviour remain.

Try a valid explicit Icon URL first (HTTP(S), relative, image data or blob), then
the bookmark origin's `/favicon.ico`, finally the local initial avatar. Resolve
scheme-less bookmark addresses with HTTPS. Never pass bookmark paths, query strings,
passwords or fragments to a favicon service; none is used. Images use lazy loading,
async decoding and no-referrer. Browser mixed-content restrictions still apply.
Offline or missing images use the local avatar without hiding the card/title.
Alternate-link buttons retain their existing local hostname initials.

Verification: all sizes, custom/relative/data/blob images, automatic icons, rejected
schemes, error fallback chain, preview parity, touch/Arrange tests, typecheck, lint,
all tests, build, contrast, bundle budget and browser image/network checks. Real
physical-device checks remain the release matrix's owner-run checks.

Results: [browser/screenshots and verification](../docs/evidence/bookmark-icons/README.md).
