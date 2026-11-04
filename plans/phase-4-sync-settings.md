# Phase 4 — BYOS Sync Engine & Settings: Build Approach & Delivery Plan

**Project:** Hub
**Phase:** 4 of 5 — Sync & Settings
**Parent Specs:** [`PRD.md`](../PRD.md), [`SCHEMAS.md`](../SCHEMAS.md), [`AGENTS.md`](../AGENTS.md)
**Status:** Complete

---

## 1. Objective

Enable cross-device sync via the GitHub REST API and manual JSON backup.

1. `core/sync.ts` — deterministic merge, GitHub client, debounced `SyncEngine`.
2. `components/settings.ts` — config modal, connection test, export/import.
3. Initial-file warning modal before the first remote commit.
4. Store helpers to read/apply a full `HubStoragePayload`.

**Exit Criteria (from AGENTS.md):** Merging local and remote test fixtures
correctly handles additions, edits, and soft tombstones (`is_deleted: true`)
without data loss.

---

## 2. Guiding Principles

| Principle                     | How Phase 4 Enforces It                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| **Headless core**             | `sync.ts` uses only `fetch`/`setTimeout`; DOM lifecycle listeners live in `main.ts`. |
| **Deterministic merge**       | `mergeCollection` implements the exact LWW algorithm from SCHEMAS.md §5.2.           |
| **Tombstone hygiene**         | `cullTombstones` drops tombstones older than the 30-day grace period (§5.3).         |
| **Event-driven, not polling** | Sync is debounced (4s) on mutation and triggered on focus/visibility only.           |
| **No secret leakage**         | The PAT lives only in IndexedDB; `DeviceMetrics` never enters the payload.           |
| **Testable network layer**    | Every client function accepts an injectable `fetch` for fixture-driven tests.        |

---

## 3. Task Breakdown

### 3.1 Sync Core (`src/core/sync.ts`)

- Pure: `mergeCollection`, `mergePayloads`, `cullTombstones`,
  `cullPayloadTombstones`, `serializePayload`, `parsePayload`.
- Client: `fetchRemoteFile`, `putRemoteFile`, `testConnection` (verifies write
  permission via repo `permissions.push`).
- `SyncEngine`: `schedule()` (debounced), `pushNow()`, `pullNow()`, `dispose()`.

### 3.2 Store Helpers (`src/core/store.ts`)

- `getPayload()` — snapshot all four syncable collections.
- `applyPayload(payload)` — replace collections, persist via `bulkPut`, emit.

### 3.3 Settings Modal (`src/components/settings.ts`)

- Inputs: PAT, Owner, Repo, Branch, File Path, sync toggle.
- "Test connection" → `testConnection`; if the file is missing, a warning modal
  offers "Confirm & Initialize".
- Manual **Export JSON** / **Import JSON**.

### 3.4 Wiring (`src/main.ts`)

- Gear icon opens the modal; export/import/test/initialize callbacks.
- `SyncEngine` scheduled on collection mutations; `pullNow` on focus/visibility.

---

## 4. Tests

- `src/core/__tests__/sync.test.ts`: merge additions, edits (LWW), tombstones,
  tombstone culling, payload round-trip, and client functions with mocked fetch.

---

## 5. Definition of Done (Phase 4)

- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm run test` passes (all suites).
- [ ] `npm run build` produces a production bundle with no errors.
- [ ] Merge fixtures handle additions, edits, and tombstones without data loss.
- [ ] No `any` types, no `innerHTML`, no framework imports.
