# First-install performance review

The release CI report showed performance 87, 450ms total blocking time and two
page loads. A first-install service-worker claim incorrectly triggered a reload.
The controller observer now distinguishes initial claims from replacement
controllers and reloads at most once for updates.

Regression coverage includes first claim, update after first claim, existing
controller replacement, duplicate notifications and loss of a controller. Real
Chromium 157 checks verify one fresh-install navigation, one update navigation
after consent, and an upgrade from the older build with IndexedDB bookmarks
preserved and available after an offline reload. See
[browser results](browser-lifecycle.txt).

CI retains performance >=90, accessibility >=95 and PWA=100. Performance uses the
median of three runs, rather than a single noisy sample. The server readiness
pattern now matches the URL rather than a label interrupted by ANSI colouring.
No update consent, offline data, caching or asset-version requirements are relaxed.

No visual interaction changes were introduced. Physical-device and assistive
technology checks were not performed for this lifecycle-only fix.

## Verification results

- Typecheck, lint, 380 tests across 41 files, build and gzip gate pass. Assets:
  59.95 KiB gzip (unchanged 60 KiB limit).
- Three measured performance samples: 48, 99, 99; median 99, assertion passed.
  All samples scored accessibility 97 and PWA 100 and loaded the document once.
  Blocking times were 7431ms, 98ms and 136ms respectively. The slow sample is
  retained rather than discarded; it shows the timing variance of this host.
- Before: release report performance 87, blocking time 450ms, two document loads.
- [Full sample metrics](lighthouse-runs.json). Runtime browser lifecycle checks
  passed as recorded above; no storage was cleared during the upgrade test.
