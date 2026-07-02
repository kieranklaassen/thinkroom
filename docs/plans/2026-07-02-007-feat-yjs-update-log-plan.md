---
date: 2026-07-02
type: feat
title: "feat: Append-only Yjs update log with fold compaction"
origin: docs/ideation/2026-07-02-yjs-storage-ideation.html (idea #1)
depth: deep
base: cursor/yjs-durability-stack-0857 (stacked on the durability PR)
---

# feat: Append-only Yjs update log with fold compaction

## Summary

Every incoming update currently pays O(document): load the full blob into a `Y::Doc`, merge one update, re-encode `full_diff`, rewrite the whole row — inside the per-document mutex and the SQLite write lock, per keystroke frame. This plan adopts the storage shape every production Yjs backend converged on (yrs-kvstore, Hocuspocus, y-redis, Automerge): the durable act of `merge` becomes an O(update) INSERT into a `yjs_document_updates` log, and a **fold** (compaction) materializes the log into the snapshot columns on joins, on a row-count threshold, on last-disconnect, and before snapshot gating or content replacement. Yjs updates are commutative and idempotent, so appends need no doc instantiation; the authorization, generation, and locking boundary of `merge` is untouched, and broadcast still follows the durable act (the append).

## Problem Frame

- Per-frame merge cost scales with document size, not edit size; the original 2026-06-05 editor plan specified a debounced writer that never shipped.
- The stored blob, state vector, checksum (stacked PRs) are all recomputed per frame; a typing burst of N frames does N full-blob rewrites.
- yrs-kvstore (same Rust core as y-rb) uses exactly {snapshot, sv, sequenced update rows} with periodic `flush_doc`; k_yrs_go folds at read time; Hocuspocus flushes on last disconnect; Automerge deletes only incorporated chunks.

## Requirements

- R1: `merge` performs its writability + generation checks under the existing locks, then durably appends the raw update bytes (generation-tagged) — no `Y::Doc` on the append path.
- R2: The exactly-empty update (`[0, 0]`, the sync-reply of a joining client with nothing new) is not appended and does not flip `seed_state`; the first non-empty append marks the document seeded.
- R3: A fold materializes snapshot + tail under both locks, writing blob/vector/checksum (with the round-trip probe) and deleting only rows it can prove incorporated: rows that advanced the doc state, or state-unchanged rows that are self-contained (their structs apply to a fresh doc — duplicates of snapshot content). State-unchanged rows that are *not* self-contained hold pending structs (a causal dependency never arrived) — they are retained, and quarantined to `yjs_state_archives` after a TTL instead of silently dropped.
- R4: Folds run: on join when the tail is non-empty (`state_b64`), when the tail reaches a row threshold at merge time, when the last subscriber disconnects, inside `persist_snapshot` before the staleness gate, and before `replace_content!` wipes state.
- R5: Log rows carry `content_generation`; a fold skips-and-deletes rows from older generations, and `replace_content!` deletes the document's tail (anti-resurrection preserved end to end).
- R6: A fold whose folded blob fails the round-trip probe serves clients from the in-memory doc but does not persist, emitting a warn-level outcome — degraded, never bricked, never silently lossy.
- R7: Everything is observable: `merge.yjs` gains outcome `appended`; a new `fold.yjs` event carries rows examined / integrated / retained and the folded blob size.
- R8: Wire protocol, dual-model split, and the channel's seq buffer are unchanged (seq-buffer removal is deliberately a follow-up — arrival-order appends keep cross-client causality, per-client order is still enforced upstream).

## Key Technical Decisions

- **Incorporation proof instead of blind deletion.** Deleting a log row is safe only when its content is provably in the snapshot. "Advanced the doc state during fold" proves integration. For state-unchanged rows, applying the row to a *fresh* doc discriminates: structs that apply cleanly there are dep-free and therefore would have integrated into the snapshot — the row is a duplicate; structs that stay pending on a fresh doc were pending in the fold too — the row is retained. This distinguishes duplicate from pending using only the `sync`/`state` API y-rb 0.7.0 exposes.
- **Fold-on-read (k_yrs_go) + threshold + last-disconnect (Hocuspocus)** rather than a background worker: no new process/queue infrastructure, staleness of the instant-paint prop is bounded by the same events that already refresh clients, and the dev/prod topology (single process) stays honest.
- **Empty-update filter by byte signature** (`[0,0]`, verified against y-rb): keeps the seed-claim guard without materializing a doc per frame, and prevents synced clients' empty sync-replies from bloating the log on every join.
- **Fold failure degrades, never bricks (R6):** the materialized doc is authoritative for serving; persistence is best-effort behind the probe.
- **In-process subscriber refcount for last-disconnect folds** — correct under the deployment's single-process pin; entries evict at zero (the eviction-discipline rule).

## High-Level Technical Design

```
merge (hot path, locks held)             fold (amortized, locks held)
  authz + generation check                 load_or_heal snapshot doc
  [0,0]? -> noop                           for each tail row (insertion order):
  INSERT raw update (O(update))              old generation -> delete
  seed_state flip on first content           state advanced -> integrated (delete)
  tail >= 64 -> fold                         unchanged + self-contained -> duplicate (delete)
                                             unchanged + not self-contained -> retain
join/state_b64: tail? -> fold, serve columns      (retained > TTL -> quarantine archive)
persist_snapshot: tail? -> fold, then gate      changed? -> probe -> checkpoint -> write
last unsubscribe -> fold                        probe fails -> serve from doc, skip write, warn
replace_content!: fold, wipe, delete tail
```

---

## Implementation Units

### U1. Schema + model: yjs_document_updates

**Goal:** Log table (document FK, content_generation, payload, created_at; ordered by id) and `YjsDocumentUpdate` model; `Document has_many ... dependent: :delete_all`.

**Requirements:** R1, R5

**Files:** `db/migrate/*`, `app/models/yjs_document_update.rb`, `app/models/document.rb`

**Test scenarios:** covered through U2-U4 behavior tests.

### U2. Append-only merge path

**Goal:** `merge` appends instead of materializing; empty-update filter; seed flip; threshold fold trigger; `appended` outcome.

**Requirements:** R1, R2, R7

**Files:** `app/services/yjs_persistence.rb`, `test/services/yjs_persistence_test.rb`

**Test scenarios:**
- A merge appends one generation-tagged row, leaves `yjs_state` untouched, emits `outcome: "appended"`, and flips `seed_state`.
- The `[0,0]` update appends nothing and leaves `seed_state` pending (existing no-op/seed tests keep passing).
- Stale-generation and locked rejections behave exactly as before (no row appended).
- The Nth merge past `FOLD_THRESHOLD` triggers a fold (tail shrinks, blob materializes).

### U3. Fold: materialize, prove incorporation, persist

**Goal:** `perform_fold` + public `fold!`; incorporation classification; orphan TTL quarantine; probe-gated persist with degraded serving; `fold.yjs` event; checkpoint integration.

**Requirements:** R3, R5, R6, R7

**Files:** `app/services/yjs_persistence.rb`, `test/services/yjs_persistence_test.rb`

**Test scenarios:**
- Fold of appended rows produces a blob/vector/checksum equal to merging them the old way; integrated rows deleted.
- A duplicate row (full-state sync-reply already in snapshot) is deleted as self-contained; a pending row (dependent update whose dependency is missing) is retained across folds and quarantined after the TTL.
- Rows from an older generation are deleted without folding.
- Probe failure: fold returns a servable doc, persists nothing, emits the warn outcome, retains rows.
- Fold heals a corrupt snapshot first (existing heal tests keep passing with the log in play).

### U4. Fold triggers on read paths and lifecycle

**Goal:** `state_b64` folds when the tail is non-empty (locks acquired on demand, mirroring the heal path); `persist_snapshot` folds before gating; SyncChannel folds on last disconnect via an in-process refcount; `replace_content!` folds first and deletes the tail.

**Requirements:** R4, R5, R8

**Files:** `app/services/yjs_persistence.rb`, `app/channels/sync_channel.rb`, `app/models/document.rb`, `test/services/yjs_persistence_test.rb`, `test/channels/sync_channel_test.rb`

**Test scenarios:**
- After appends, `state_b64` serves the folded state (existing handshake and instrumentation tests adapt: reading state now folds).
- `persist_snapshot` gates against the folded vector (a client that saw only the snapshot but not the tail is stale).
- Unsubscribing the last subscriber folds the tail; a second subscriber keeps it unfolded.
- `replace_content!` archives the folded pre-wipe state and leaves no tail rows; in-flight old-generation rows appended after the fold are deleted, not resurrected.
- End-to-end: `script/sync_check.mjs` (two clients + late joiner) converges.

---

## Scope Boundaries

- **In scope:** the log, fold machinery, triggers, observability, anti-resurrection, degraded modes.
- **Deferred to follow-up work:** removing the channel seq/gap buffer (safe only after the log is proven in production); serving joiners snapshot + raw tail without folding (stateless-relay endgame, ideation idea #7); background/async folding; attribution columns on log rows.
- **Non-goals:** wire protocol changes; multi-process scaling claims (WEB_CONCURRENCY stays pinned).

## Deferred to Implementation

- Exact constants: `FOLD_THRESHOLD = 64` rows, `ORPHAN_TTL = 1.hour` — named, tuned later from `fold.yjs` distributions.
- Whether `state_b64`'s fold shares the heal path's lock-acquisition helper.
