---
date: 2026-07-02
type: feat
title: "feat: Self-healing durability stack for Yjs state"
origin: docs/ideation/2026-07-02-yjs-storage-ideation.html (idea #5)
depth: deep
base: cursor/yjs-state-vector-column-0857 (stacked on the state-vector PR)
---

# feat: Self-healing durability stack for Yjs state

## Summary

The CRDT blob is the only unreconstructable dataset in the product, and it currently has a validated-but-unfixed P2: a corrupt `yjs_state` blob raises inside `load_ydoc` on every subscribe, permanently bricking the document, with no backups anywhere (no litestream, no restore docs) and `replace_content!` destroying prior state irrecoverably. This plan layers three defenses, each covering the failure the previous cannot: **prevent** (never commit a blob that cannot round-trip into a fresh `Y::Doc`; checksum every stored blob), **contain** (on corrupt load: quarantine the bytes for forensics, restore the last-good same-generation checkpoint — or degrade to empty — and let connected clients re-upload the tail via the protocol's existing sync-reply), and **recover** (documented Litestream off-host replication with a rehearsed restore, since volume loss is beyond the app's reach).

## Problem Frame

- `docs/residual-review-findings/feat-proof-reimagining.md` P2: "Corrupt stored yjs_state blob bricks every subscribe permanently. Fix shape: rescue y-rb sync failures in `load_ydoc`, log, degrade to empty doc (connected clients re-upload via sync-reply)."
- Degrading to an *empty* doc silently loses all content when no client happens to be connected; a retained last-good snapshot bounds the loss instead.
- `Document#replace_content!` nulls `yjs_state` — the product's most destructive operation has no undo artifact.
- No backup tooling exists; production is one SQLite file on one Docker volume.

## Requirements

- R1: `merge` refuses to persist a blob that cannot be loaded into a fresh `Y::Doc` (raises; frame is not broadcast — durable-before-broadcast preserved).
- R2: Every persisted blob carries a SHA-256 checksum column; loads verify it and treat mismatch as corruption.
- R3: A corrupt blob encountered on merge, join, or snapshot-gate paths never bricks the document: the corrupt bytes are quarantined (kept, not destroyed), the document is restored to the most recent **same-generation** checkpoint (or emptied when none exists), and the operation proceeds on the restored state.
- R4: Restoration never resurrects content across a `replace_content!` boundary: only archives tagged with the document's current `content_generation` are restore candidates.
- R5: `merge` writes a periodic checkpoint archive (at most one per interval per document) of the pre-merge state; `replace_content!` archives the state it wipes (tagged with the pre-bump generation, for manual undo).
- R6: Archives are pruned per document and kind so storage stays bounded.
- R7: All prevention/containment actions are observable through the existing `*.yjs` event stream (`rejected_invalid_encode`, `recovered.yjs` with a `restored_from` marker).
- R8: DEPLOYING.md documents Litestream replication and a step-by-step restore rehearsal.

## Key Technical Decisions

- **Round-trip validation targets loadability, not byte equality.** The anti-brick property is "the blob we persist can be synced into a fresh doc without raising". State-vector equality would not catch y-rb's pending-struct drop (pending structs do not advance the vector), and that hazard is already guarded by the channel's per-client sequencing — validation is the tripwire for encode/decode failures specifically.
- **One `yjs_state_archives` table with a `kind` discriminator** (`checkpoint` / `replacement` / `quarantine`) instead of three tables: identical column shape (blob, vector, generation, optional error), one pruning mechanism.
- **Generation-tagged restores (R4).** A `replacement` archive's generation is by construction behind the current one, so the same-generation restore rule structurally prevents the resurrection class of bug that `content_generation` exists to stop. Replacement archives serve manual undo only.
- **Healing always happens under both locks.** `merge` and `persist_snapshot` already hold the per-doc mutex + row lock when they load; `state_b64` acquires them only when corruption is detected (the fast path stays lock-free). The in-process mutex is not reentrant, so healing is invoked from the lock-holding frame rather than acquiring inside `load_ydoc`.
- **Litestream stays documentation.** Deploys are manual (AGENTS.md) and Kamal accessory changes cannot be tested from this environment; shipping untested deploy config is riskier than a precise runbook.

## High-Level Technical Design

```
merge/persist_snapshot (locks held)          state_b64 (lock-free fast path)
        |                                            |
   verified load  --CorruptStateError-->   verified load/columns
        |                :                           |            :
        |           heal_corrupt_state!              |    (acquire locks, re-check,
        |             - quarantine bytes             |     heal_corrupt_state!, retry)
        |             - restore same-gen checkpoint
        |               (else empty)
        |             - emit recovered.yjs
        v
   sync update -> full_diff -> ROUND-TRIP PROBE -> update_columns(blob, sv, checksum)
                                   : raise EncodeValidationError    |
                                     (frame not persisted,          +-- maybe checkpoint archive
                                      not broadcast)                    (interval-gated, pruned)
```

---

## Implementation Units

### U1. Schema: checksum column + archives table

**Goal:** `documents.yjs_state_checksum` string column; `yjs_state_archives` table (document FK, kind, content_generation, yjs_state, yjs_state_vector, error, created_at, index on [document_id, kind, created_at]).

**Requirements:** R2, R5

**Dependencies:** none

**Files:** `db/migrate/*` (two migrations or one), `db/schema.rb`, `app/models/yjs_state_archive.rb` (new), `app/models/document.rb` (association)

**Approach:** Plain migration; `YjsStateArchive` model with `KINDS = %w[checkpoint replacement quarantine]`, validation on kind, `belongs_to :document`; `Document has_many :yjs_state_archives, dependent: :destroy`.

**Test scenarios:** Model: invalid kind rejected; destroying a document destroys its archives.

**Verification:** migration runs; model tests green.

### U2. Prevent: round-trip probe + checksum at write time

**Goal:** `merge` validates the new blob loads into a fresh doc before `update_columns`, and persists its SHA-256 alongside.

**Requirements:** R1, R2, R7

**Dependencies:** U1

**Files:** `app/services/yjs_persistence.rb`, `test/services/yjs_persistence_test.rb`

**Approach:** After `blob = ydoc.full_diff.pack("C*")`, run `probe = Y::Doc.new; probe.sync(blob.unpack("C*"))` inside a rescue; on raise set `payload[:outcome] = "rejected_invalid_encode"` and raise `YjsPersistence::EncodeValidationError` (frame not persisted; SyncChannel's StandardError rescue keeps it unbroadcast). Add `yjs_state_checksum: Digest::SHA256.hexdigest(blob)` to `update_columns`.

**Test scenarios:**
- Happy path: merged docs carry a checksum matching the blob.
- Error path: stub `full_diff` to return garbage; merge raises `EncodeValidationError`, emits `rejected_invalid_encode`, persists nothing.
- Channel integration: a frame whose persist raises is not broadcast (existing "update that fails persistence is not relayed" test pattern).

### U3. Contain: verified loads, quarantine, same-generation restore

**Goal:** Corrupt blobs (checksum mismatch or y-rb raise) heal in place on merge, join, and snapshot paths.

**Requirements:** R3, R4, R7

**Dependencies:** U1, U2

**Files:** `app/services/yjs_persistence.rb`, `app/models/document.rb` (checkpoint/restore helpers if cleaner there), `test/services/yjs_persistence_test.rb`, `test/channels/sync_channel_test.rb`

**Approach:** `load_ydoc` verifies checksum (skip when column nil — legacy rows) and wraps `ydoc.sync` errors, raising `CorruptStateError`. `merge`/`persist_snapshot` rescue it in their lock-holding frames: call `heal_corrupt_state!(document)` — INSERT quarantine archive (corrupt bytes + error), restore newest checkpoint archive with `content_generation == document.content_generation` (blob+vector+recomputed checksum) or null all three, emit `recovered.yjs` with `restored_from: "checkpoint"|"empty"` — then retry the load once and continue. `state_b64`: rescue from both column path (checksum verify before serving) and rebuild path; acquire mutex + `with_lock`, reload, re-verify (another thread may have healed), heal, retry.

**Test scenarios:**
- Corrupt blob + existing same-generation checkpoint: merge heals, retains a quarantine archive with the corrupt bytes, restores checkpoint content, applies the update on top, and the doc round-trips.
- Corrupt blob + no checkpoint: merge heals to empty and persists the incoming update alone.
- A `replacement`-kind archive from a previous generation is NOT restored (R4) — heal goes to empty instead.
- Join path: `state_b64` on a corrupt doc (checksum mismatch) returns a servable handshake and the doc is healed; subscribing via SyncChannel to a corrupt doc succeeds (no brick).
- Snapshot path: `persist_snapshot` on a corrupt doc does not raise; the gate operates on restored state.
- Legacy row (nil checksum) loads without verification.

### U4. Checkpoint + replacement archives, pruning

**Goal:** merge writes interval-gated checkpoints of pre-merge state; `replace_content!` archives what it wipes; both prune to the newest N per kind.

**Requirements:** R5, R6

**Dependencies:** U1

**Files:** `app/services/yjs_persistence.rb`, `app/models/document.rb`, `test/services/yjs_persistence_test.rb`, `test/models/document_test.rb`

**Approach:** In merge's persist branch (locks held), when the pre-merge blob is present and the newest checkpoint for the doc is older than `CHECKPOINT_INTERVAL` (10 minutes), archive the pre-merge columns (kind `checkpoint`, current generation), then prune (keep newest 5 per document+kind). In `replace_content!`, archive pre-wipe columns (kind `replacement`, **pre-bump** generation) when blob present, prune to 5.

**Test scenarios:**
- Second merge creates one checkpoint; an immediate third merge does not (interval gate); `travel` past the interval → next merge checkpoints again.
- Checkpoint content equals the pre-merge blob (restoring it yields the older text).
- `replace_content!` writes a replacement archive carrying the wiped state and the pre-bump generation.
- Pruning: more than 5 checkpoints → oldest deleted, other kinds untouched.

### U5. Recover: Litestream runbook

**Goal:** DEPLOYING.md gains an off-host replication + restore-rehearsal section.

**Requirements:** R8

**Dependencies:** none

**Files:** `DEPLOYING.md`

**Approach:** Concrete Kamal accessory config for Litestream replicating `storage/production.sqlite3` (and the cable DB excluded, derivable), S3-compatible target via env, and a numbered restore rehearsal (restore to a scratch path, integrity-check, swap). Marked as config-to-apply, not applied.

**Test scenarios:** Test expectation: none — documentation.

---

## Scope Boundaries

- **In scope:** the three layers above, observability, tests.
- **Deferred to follow-up work:** applying the Litestream accessory to `config/deploy.yml` (needs a deploy rehearsal the maintainer runs); a UI/CLI for manual restore from `replacement` archives; extending checkpoints to an update-log world (idea #1 builds on this).
- **Non-goals:** changing the wire protocol; automatic restore across generations; APM wiring.

## Deferred to Implementation

- Whether `heal_corrupt_state!` lives on `YjsPersistence` or `Document` (pick the one that keeps locking obvious).
- Exact constants (`CHECKPOINT_INTERVAL = 10.minutes`, `MAX_ARCHIVES = 5`) — named constants, tuned later via the instrumentation distributions.
