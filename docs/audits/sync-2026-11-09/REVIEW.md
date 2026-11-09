# Sync reliability audit — 2026-11-09

Audited commit: `669ee6b`. Verdict: basic read/merge/write is implemented, but the
baseline system is not robust against concurrent edits, retries, long-offline
devices or credential lifecycle problems. These are baseline findings; the approved repair is tracked in [sync-hardening](../../../plans/sync-hardening.md).

## Evidence and limits

- Existing sync (24), token (12) and Settings (1) tests: **37 passed**.
- Isolated fault injection against the bundled current sync engine reproduced
  the failures in [fault-injection.json](fault-injection.json).
- Chromium 157, isolated persistent profile, two browser processes: encrypted
  token and non-extractable key survived a complete browser restart. The same
  browser audit exercised saved-token testing and removal through Settings.
  Results: [token-browser.json](token-browser.json).
- Only dummy tokens and isolated test data were used. These are not live tests
  of the user's configured sync repository or PAT. No GitHub file was written.
- Passing existing tests does not cover the reproduced fault scenarios.

## Findings, ordered by repair priority

### P1 — A completed upload can overwrite an edit made during the upload

`src/core/sync.ts:417–434` snapshots local state before the PUT and applies that
snapshot after the request finishes. `src/core/store.ts:822–848` replaces live
collections with it. An edit made while PUT is pending can therefore be replaced
by the older value, both in memory and when the snapshot is persisted.

The injected test changed a title while PUT was blocked. Its debounced follow-up
push fired while the engine was busy and was silently dropped (`sync.ts:403–405`).
When PUT finished, the old title was restored; only one upload occurred.

Repair: serialize reconciliation, preserve edits made since the snapshot, queue
another pass when a mutation occurs during a sync, and persist/recover unsent
work across restart. A pull must participate in the same coordination.

### P1 — Retry and “Sync now” can report success without uploading unsent edits

Settings Sync now, startup/focus/visibility pulls, and the Background Sync retry
all invoke `pullNow()` (`src/main.ts:752,760,791,794,1110`). This method merges
locally and reports `synced` without a PUT. Applying the payload suppresses the
collection events that would otherwise schedule a push. The normal `online`
listener only changes the status chip; it does not initiate reconciliation.

The reproduction retained a newer local title, uploaded nothing, and reported
`synced` while the remote copy stayed old. There is no persistent dirty/outbox
state. Reloading after an offline/failed edit can leave it unuploaded until a
new local mutation happens.

Repair: use full reconciliation for explicit Sync now, reconnect and retries;
report pending local changes honestly; clear pending state only after confirmed
remote persistence. Never equate a successful read with all changes uploaded.

### P1 — Removing the token does not clear the live credential

`SettingsModal.handleRemoveToken()` clears stored `github_pat` but never calls
`TokenVault.clear()` (`src/components/settings.ts:502–509`). The engine gets its
credential from the live vault (`src/main.ts:730`), independently of the cleared
config field. The browser confirmed the stored value became empty while the
vault remained configured; a separate engine test still sent an authenticated
request with that state.

Repair: make credential removal one coordinated operation that immediately
forgets the in-memory token, cancels queued work and prevents old in-flight work
from being reported as current. Verify removal across tabs and restart.

### P2 — SHA conflicts are rejected safely by GitHub but not recovered

The write includes the previous SHA, which is good: a concurrent remote update
will not be blindly overwritten. However, a 409 causes a generic error; there is
no refetch/remerge/bounded retry (`src/core/sync.ts:420–440`). The reproduction
made one GET and one failed PUT, with no retry.

There is no explicit timeout or classification/backoff for authentication,
permission, rate-limit, server and network failures. Core exceptions collapse to
`error` and the UI says to check GitHub settings, even for unrelated failures.

Repair: typed errors, bounded conflict retries using fresh local/remote state,
request deadlines, rate-limit-aware retry scheduling, and actionable UI states.
Avoid retrying invalid credentials indefinitely.

### P2 — Conflict policy is silent whole-record timestamp selection

`mergeCollection()` uses the device's `updated_at` and keeps local on equal
values (`src/core/sync.ts:75–92`). There is no common ancestor, field merge,
conflict copy or conflict explanation. Concurrent edits to different fields can
silently discard one version. Incorrect device clocks can select the wrong edit.
Equal-timestamp divergent records do not converge: the reproduction kept Device A
on A and Device B on B when each pulled the other.

This follows the current SCHEMAS.md policy; it is an architectural limitation,
not a deviation from that policy. A stronger policy needs an explicit product
choice about preserving/resolving conflicting versions. Persistent metadata or
entity/schema changes require owner approval.

### P2 — Devices offline beyond 30 days can resurrect deleted records

The approved tombstone policy removes deletion records after 30 days. Once the
remote no longer remembers an ID was deleted, a returning stale device treats
its old live record as a local-only addition. The reproduction restored that ID.
This is incompatible with an unlimited offline horizon.

Repair requires choosing a retention/retired-client policy, or retaining enough
deletion/version history to distinguish stale additions from new records. Do not
promise indefinite offline convergence under the present 30-day policy.

### P2 — A saved token cannot be re-tested through Settings

`readConfig()` reads only the token input, while saved tokens intentionally leave
that input empty and hidden. `handleTest()` rejects the configuration before
calling GitHub (`src/components/settings.ts:438–445,549–553`). The browser audit
confirmed zero connection tests were invoked with a saved credential.

Also, the current connection test checks repository `permissions.push`; it does
not demonstrate that the PAT can write the configured branch/path with the
required Contents permission. Treat that check as incomplete permission evidence.

Repair: let trusted code test the vault token without redisplaying it, distinguish
“stored” from “recently verified”, and check the actual configured target. Provide
clear expired/revoked/insufficient-access remediation.

### P2 — Payload validation and storage application are too weak for bad inputs

`parsePayload()` checks the version and top-level arrays but not individual
records (`src/core/sync.ts:184–210`). A record with numeric ID and invalid timestamp
was accepted in the injected test. Invalid data can reach RAM and IndexedDB before
component rendering fails. `applyPayload()` also uses five separate transactions;
a quota/storage failure can leave collections only partially applied.

Repair: validate entity fields, types, finite timestamps, URLs and references
before touching local state; preserve the prior valid state and show a useful
error on failure. Apply reconciled collections atomically and publish state only
after persistence succeeds.

### P2 — Growing files have no supported large-file read fallback

The client expects inline base64 content. A response with `encoding: "none"` and
empty `content` becomes an empty string and then fails JSON parsing. This response
shape was reproduced. GitHub documents different handling for files above 1 MB;
the client has no raw-media fallback or useful size-specific error.

[GitHub Contents API documentation](https://docs.github.com/en/rest/repos/contents)
explains the raw/object media types and size limits. A same-API-origin raw fetch
can fit Hub's existing privacy restriction; avoid adding a new runtime host.

## Key persistence versus GitHub credential validity

The local AES-GCM key is persisted as a non-extractable CryptoKey in IndexedDB.
It is reused rather than regenerated on each launch and has no app-defined expiry.
The actual restart test passed. Missing/incorrect keys request token re-entry;
exports and remote payloads exclude tokens. These foundations are sound, although
storage eviction/clearing, loss of the browser profile, and storage errors still
need recovery. No short test proves persistence over years or every browser.

A stored/decryptable PAT is not necessarily a valid GitHub credential. PATs can
expire or be revoked; organization policy can restrict them; GitHub removes PATs
unused for a year. Hub has no renewal workflow, expiry warning or specific auth
failure state during normal sync. It cannot extend an expired/revoked PAT itself.
See [GitHub's token documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
and [expiration/revocation rules](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation).

## Recommended repair order

1. Prevent in-flight edit loss and dropped queued work; serialize full sync and
   make recovery/upload status durable and truthful.
2. Correct credential removal and saved-token revalidation; classify auth errors
   and guide replacement without exposing secrets.
3. Add bounded SHA retries, timeouts, rate-limit handling, validation and atomic
   persistence; support growing payloads within documented GitHub limits.
4. Agree on explicit concurrent-edit and long-offline deletion policies, then
   extend the approved specification/schema only as authorized.

Regression tests should cover two devices, edits during every awaited operation,
409/401/403/429/5xx, offline/restart recovery, token replacement/removal, malformed
payloads, storage failures, clock skew/ties and devices returning after 31+ days.
