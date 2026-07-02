---
date: 2026-07-02
type: feat
title: "feat: Materialize the Yjs state vector at write time"
origin: docs/ideation/2026-07-02-yjs-storage-ideation.html (idea #3)
depth: standard
base: cursor/yjs-instrumentation-0857 (stacked on the instrumentation PR)
---

# feat: Materialize the Yjs state vector at write time

## Summary

Every subscribe calls `YjsPersistence.state_b64`, which builds a fresh `Y::Doc` from the stored blob and re-encodes both `full_diff` and the state vector — immediately after the merge that produced the blob computed and discarded those exact values. `persist_snapshot`'s staleness gate does the same full-doc load just to read the server state vector. This plan persists the state vector as a `documents.yjs_state_vector` binary column written inside the existing merge `update_columns`, so joins and snapshot gates become column reads with zero yrs instantiation. Reconnect storms (every deploy re-fires every client's handshake) stop paying O(document) CPU per subscriber.

## Problem Frame

- `state_b64` cost is O(document) CPU per join/reconnect; the write path already holds the identical bytes and discards them (`app/services/yjs_persistence.rb`).
- `persist_snapshot` loads the full doc per snapshot submission only to decode its state vector.
- yrs-kvstore (official yrs persistence layer) stores the state vector as its own key precisely so reads skip doc instantiation.
- The stored blob **is** the previous merge's `full_diff` output, so serving it directly is byte-faithful; the rebuild path only re-derives it.

## Requirements

- R1: `merge` persists `yjs_state_vector` alongside `yjs_state` in the same `update_columns` write.
- R2: `state_b64` serves the stored blob + stored state vector directly (no `Y::Doc`) when both columns are present; documents written before the migration (blob present, vector nil) fall back to the existing rebuild path.
- R3: `persist_snapshot` uses the stored state vector for its staleness gate when present, falling back to the rebuild path otherwise.
- R4: `Document#replace_content!` nulls `yjs_state_vector` together with `yjs_state`.
- R5: The `state.yjs` instrumentation event records whether the handshake was served from columns or rebuilt, so the rollout is observable.
- R6: Wire format and handshake semantics unchanged: clients receive the same `[full_state_b64, state_vector_b64]` pair.

## Key Technical Decisions

- **Nullable column, no backfill migration.** Legacy rows heal lazily: the first merge after deploy writes the vector. A backfill would load every document's blob through yrs at migrate time for no urgency — the fallback path keeps legacy rows correct.
- **Serve the stored blob bytes, not a re-encode.** `Base64.strict_encode64(document.yjs_state)` is exactly the previous merge's `full_diff` output; round-tripping through a fresh doc could only re-encode (never improve) it.
- **Column-vs-rebuild guard requires *both* columns.** A blob without a vector (legacy row) or a vector without a blob (impossible by construction, but cheap to guard) routes to the rebuild path.

---

## Implementation Units

### U1. Migration: add yjs_state_vector to documents

**Goal:** Nullable binary column exists.

**Requirements:** R1

**Dependencies:** none

**Files:**
- `db/migrate/*_add_yjs_state_vector_to_documents.rb` (new)
- `db/schema.rb`

**Approach:** `add_column :documents, :yjs_state_vector, :binary`. No default, no backfill.

**Test scenarios:** Test expectation: none — pure schema addition; behavior covered in U2.

**Verification:** `bin/rails db:migrate` clean; schema.rb shows the column.

### U2. Write the vector at merge time; serve columns on read

**Goal:** `merge` persists the vector; `state_b64` and `persist_snapshot` read it instead of rebuilding the doc; `replace_content!` clears it.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** U1

**Files:**
- `app/services/yjs_persistence.rb`
- `app/models/document.rb`
- `test/services/yjs_persistence_test.rb`

**Approach:** In `merge`'s persist branch, add `yjs_state_vector: ydoc.state.pack("C*")` to `update_columns`. In `state_b64`, when `yjs_state.present? && yjs_state_vector.present?`, return base64 of the two columns and set the event payload's `served_from: "columns"`; otherwise keep the rebuild path with `served_from: "rebuild"`. In `persist_snapshot`, use `document.yjs_state_vector` (unpacked) for `server_state` when present, else load the doc. In `replace_content!`, add `yjs_state_vector: nil` to the reset attributes.

**Patterns to follow:** rollout-compatibility branching mirrors the seq-less / nil-generation convention documented in `app/channels/sync_channel.rb`.

**Test scenarios:**
- Happy path: after a merge, `yjs_state_vector` equals the merged doc's `state` bytes; `state_b64` returns values that round-trip into a client doc with the merged content (existing handshake test extended).
- Column path is doc-free: with both columns present, `state_b64` does not construct a `Y::Doc` (stub `Y::Doc.new` to raise inside the call and assert it still serves).
- Fallback: a document with a blob but a nil vector (simulated legacy row via `update_columns`) still serves a correct handshake and reports `served_from: "rebuild"`.
- Reset path: `replace_content!` leaves `yjs_state_vector` nil; the next merge repopulates it.
- Snapshot gate: existing stale/ahead/reordered-vector tests stay green with the stored vector supplying the server state; a legacy row (nil vector) still gates correctly.
- Empty document: a document that has never merged serves the same empty-doc handshake as before.

**Verification:** `bin/rails test` green; `script/sync_check.mjs` (two-client convergence + late joiner) passes against `bin/dev`.

---

## Scope Boundaries

- **In scope:** the column, write-through, column-served handshake, snapshot gate read, reset behavior, observability of the serve path.
- **Deferred to follow-up work:** a differential handshake (client sends its sv, server serves a delta) — blocked on the y-rb `diff` multi-client-vector bug; caching the base64-encoded pair; dropping `yjs_state_b64` from Inertia props.
- **Non-goals:** changing the wire protocol or the dual-model split.

## Deferred to Implementation

- Whether `persist_snapshot`'s fallback doc load warrants its own payload marker (decide while instrumenting).
