# Sync hardening — G-40, G-41, G-49, G-55, G-56

Status: Implemented; automated and emulated-browser verification complete. Physical-device release checks remain open. Owner choices recorded 2026-11-09.
Parent specifications: PRD sync and durability; SCHEMAS sync metadata and merge.

## User, goal and behaviour

A person edits Hub on multiple touch/keyboard devices, sometimes offline for
months. Persisted edits must survive upload races, retries and restart; “Synced”
means the current local dataset is confirmed on the configured GitHub target.

1. Serialize/coalesce sync passes, preserve edits made during requests, and
   reconcile on boot, online, focus, visibility, explicit sync and background retry.
   Existing persisted collections are the durable queue; no new entity fields.
2. Coordinate token removal/replacement with cancellation and other tabs. Re-test
   saved tokens through trusted code, never redisplay them. Distinguish auth,
   permissions, rate limits, timeouts, malformed data and storage failures.
3. Bounded SHA retries and transient backoff; atomic local collection commits;
   validate payloads before applying; read large files through api.github.com raw
   media. Never redirect a token to a third-party host. No new runtime dependency.
4. Owner-approved policy: keep both divergent versions in a local conflict inbox
   and ask the user which to use. Pause sync until resolved. Retain tombstones
   indefinitely remotely, preserving the existing 30-day restore window. This
   cannot reconstruct deletion history already discarded by older releases.

## Approved data changes

Extend only the existing local `sync_metadata` config record with target-specific
last-confirmed snapshots and unresolved conflicts. Conflict versions stay local;
no tokens, metrics or conflict metadata enter the remote v2 payload. No entity
fields or database stores are added. Baselines distinguish causal edits from
clock differences; equal-timestamp divergent edits are conflicts, not silent LWW.

## Interaction and recovery

All new controls are ordinary >=44px coarse-pointer buttons with catalogue text,
visible focus and the shared Dialog primitive. Settings exposes a conflict inbox;
users compare both versions, export them, and explicitly choose a version.
Closing preserves conflicts. No destructive automatic resolution. Errors offer
specific remediation/retry. Offline UI stays usable and saved data survives.
Use existing tokens/logical CSS; phone sheets follow the visual viewport.

## Verification and release

Test edits during awaited operations, coalescing, same-origin tabs, restart,
401/403/409/429/5xx, cancellation/deadlines, missing keys, saved token testing and
removal, large/malformed payloads, storage rollback, timestamp ties/skew,
conflicts and 31+ day offline devices. Run typecheck, lint, tests, contrast,
production build, gzip gate, axe and Lighthouse. Initial JS+CSS stays <60 KiB;
optional sync/conflict modules may load on demand and remain precached offline.
Report initial and total assets separately; do not hide deferred asset costs.

## Pre-implementation checklist and accepted limits

- [x] User/scenario, measurable behaviour, empty/loading/error/offline/recovery defined above.
- [x] Touch targets, keyboard path, shared focus primitive, safe-area/viewport tiers specified.
- [x] Existing verified tokens only; catalogue strings and standard control states.
- [x] Owner approved metadata extension, conflict policy and indefinite deletion markers.
- [x] Remote protocol and external token lifetime checked against GitHub primary documentation.
- [x] Regression acceptance cases cover concurrency, atomic failure and lifecycle recovery.
- [ ] Independent human review and physical device/screen-reader checks remain release checks.

No claim is made that a GitHub PAT stays valid forever: expiry, revocation,
permission changes and GitHub's unused-token policy are outside Hub's control.
Hub retains the encrypted token/key and provides specific authentication recovery.
Read tests establish repository/branch/file readability; only an actual sync
confirms Contents write permission. Existing deletion history already purged by
old releases cannot be reconstructed. A device still running an old release can
still apply its old timestamp-only policy; update all devices before relying on
the conflict guarantees. The engine can retry while a page is active or on the
next lifecycle event; it cannot upload with every page closed unless the browser
wakes a page through the existing service-worker path. No new polling is added.

Verification evidence: [sync-hardening results](../docs/evidence/sync-hardening/README.md).
