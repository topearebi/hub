# Sync hardening evidence — 2026-11-09

## Summary

Sync now preserves edits made during uploads, serializes reconciliation and
recovers persisted unsent work on the next trigger. Divergent versions pause
upload in a local conflict inbox. Token removal cancels work and clears memory;
keys are initialized atomically across tabs. Local collection replacement is
atomic, GitHub SHA races are retried, and failures have specific recovery text.
Deletion markers remain indefinitely; the recovery UI retains its 30-day window.

## Spec and gap references

- [Approved specification](../../../plans/sync-hardening.md)
- PRD sync durability amendment; DESIGN sync conflict/credential amendment;
  accessibility sync inbox; SCHEMAS owner-approved local metadata amendment.
- G-40, G-41, G-49, G-55, G-56.
- [Baseline audit and reproductions](../../audits/sync-2026-11-09/REVIEW.md)

## Verification

- [x] Typecheck, lint, all **414 tests / 44 files**, production build pass.
- [x] Initial JS+CSS **59.66 KiB gzip** (<60); all JS+CSS **68.40 KiB gzip**.
      Deferred Settings/sync/inbox assets are precached, so total offline download
      increases. The manifest-based budget traverses static imports and CSS; it
      reports deferred cost separately. No runtime dependencies were added.
- [x] Lighthouse mobile performance **99/100/99**, accessibility **97**,
      PWA **100**, all three CI assertions pass without lowering thresholds.
- [x] Token contrast **104/104**; inbox axe zero serious/critical violations.
- [x] Fault regressions: in-flight edits, queued follow-up, restart recovery,
      full manual reconciliation, SHA 409 retries, rate cooldown, deadline,
      cancellation, strict records, large-file raw API response, skew/ties,
      indefinite markers, recovery expiry, atomic storage rollback, stale choices.
- [x] Chromium 157 persistent isolated profile: real non-extractable AES-GCM key
      survives browser shutdown/restart; concurrent tabs share one key; saved token
      testing works without DOM exposure; removal clears disk and memory.
- [x] Emulated coarse-pointer controls >=44px; inbox contained at 320, 390, 768
      (landscape), 1280, 1920px; light, dark, forced-colors, reduced motion screenshots.
- [x] Escape/Close restores focus and preserves conflicts; malicious text rendered
      as text; shared primitive focus/inert behaviour exercised by component tests.
- [x] Real service worker: first install navigates once; accepted update reloads
      once; old build upgrades preserving IndexedDB and runs offline without clearing
      cookies/storage. Settings, sync and inbox modules import successfully offline
      after a fresh install even though they were not previously opened.
- [x] Schemas unchanged except explicitly approved local metadata extension;
      normal exports/remote payload never include token, baseline, conflicts or metrics.
- [ ] Physical touchscreen keyboard, VoiceOver/TalkBack/NVDA and non-Chromium
      devices remain owner-run release checks. Browser emulation is not real hardware.

## Evidence

Phone and desktop: [390px](conflicts-390.png), [1280px](conflicts-1280.png).
Preferences: [dark](prefers-color-scheme.png), [forced colors](forced-colors.png),
[reduced motion](prefers-reduced-motion.png).
Machine-readable [browser checks](browser.json), [Lighthouse](lighthouse.json),
[test log](hardening-tests.txt), [bundle](bundle.txt), [worker](worker.txt),
[offline modules](offline.txt), [contrast](contrast.txt).
All credential/API tests used dummy tokens and isolated data; no live user
repository or PAT was modified by tests.

## Risks and follow-ups

PAT expiry, revocation and permission changes are controlled by GitHub; no app can
promise permanent validity. Missing keys prompt re-entry. Update old clients before
relying on the new conflict policy. Previously purged deletion history cannot be
reconstructed. Conflicts consume local storage and pause the target until resolved;
closing the inbox preserves them. “End recovery” retains deletion records and does
not erase Git history. Browser background scheduling remains platform-dependent.

Build bookkeeping: Vite emits `asset-manifest.json` at the site root; the bundle
gate reads it and the worker precaches it alongside every deferred module. This
avoids hidden paths and permits direct verification on the deployed origin.
