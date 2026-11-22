---
title: Migrate Server Yjs Engine from y-rb to yrby - Plan
type: refactor
date: 2026-11-21
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Migrate Server Yjs Engine from y-rb to yrby - Plan

## Goal Capsule

- **Objective:** Keep server-side collaborative document persistence reliable, thread-safe, and non-blocking under concurrent Action Cable traffic without segfaulting on malformed updates or dropping pending updates in mixed frames.
- **Means:** Replace `y-rb` and unused `y-rb_actioncable` with the `yrby` core gem behind `YjsPersistence`, keeping Thinkroom's existing Action Cable sync, database schema, and frontend provider intact (`KTD1`, `KTD2`).
- **Authority:** Requirements (`R*`) govern observable behavior; Key Technical Decisions (`KTD*`) govern implementation mechanism; units (`U*`) carry local execution scope without overriding either.
- **Execution profile:** Single PR, 3 sequential units (`U1` → `U2` → `U3`).
- **Stop conditions:** Stop if `yrby` 0.9.x fails to resolve precompiled platform gems for `Gemfile.lock` Linux/macOS platforms (`x86_64-linux`, `aarch64-linux`, `arm64-darwin`, `x86_64-darwin`), or if existing persisted Yjs v1 blobs fail round-trip compatibility with `yrs 0.28.1`.
- **Ownership:** Executed end-to-end by this `lfg` run through verification, simplification, code review, browser sync checks, and PR creation.

---

## Product Contract

### Summary

Replace the server-side Rust CRDT gem `y-rb` (`0.7.0`, pinned to `yrs 0.17.4`) and the unused `y-rb_actioncable` (`0.1.7`) gem with `yrby` (`~> 0.9.1`, built on `yrs 0.28.1`), migrating `YjsPersistence` and its tests to `yrby`'s binary-string, GVL-releasing, thread-safe `Y::Doc` API. Keep Thinkroom's existing `SyncChannel`, `CableProvider`, database tables, wire protocol, and Inertia SSR hydration unchanged.

### Problem Frame

Thinkroom relies on `y-rb 0.7.0` (`Gemfile:74`) for all server-side Yjs update validation, tail folding, compaction, and state-vector fallback (`app/services/yjs_persistence.rb`), alongside a dead `y-rb_actioncable 0.1.7` entry (`Gemfile:76`) that was abandoned in favor of Thinkroom's custom `SyncChannel` (`docs/ideation/2026-07-02-yjs-storage-ideation.html:157`).

`y-rb` is effectively unmaintained (last non-Dependabot release Jan 2026, pinned to `yrs = "=0.17.4"`), has an open thread-safety issue (`y-crdt/yrb#72`), holds the Ruby GVL during CRDT work, forces `Array<Integer>` `.unpack("C*")`/`.pack("C*")` allocations on every call, segfaults the Ruby process on base64-valid updates with corrupted tail bytes (documented in Thinkroom PR #138), and leaves a documented fold residual where a frame mixing integrated and cross-client pending structs drops its pending half (`app/services/yjs_persistence.rb:302-306`).

`ce-pov` evidence (cited, not session-settled): **Adopt** `yrby` core (`0.9.1`) to replace `y-rb` + unused `y-rb_actioncable`; **Hold** on `yrby-rails` / `yrby-client` due to open Action Cable 8.1 race `jpcamara/yrby#124` and Thinkroom's existing domain-specific `SyncChannel`/`YjsPersistence`/`CableProvider` semantics (`content_generation`, editing locks, Inertia SSR first paint, checksum self-healing, delete-set echo suppression).

### Requirements

**Dependency and deployment compatibility**

- R1. Remove `y-rb` and unused `y-rb_actioncable` from `Gemfile` and `Gemfile.lock`, and depend on `yrby` (`~> 0.9.1`).
- R2. Preserve precompiled native platform gems in `Gemfile.lock` for Thinkroom's deployment and development platforms (`x86_64-linux`, `aarch64-linux`, `arm64-darwin`, `x86_64-darwin` and existing musl variants where published) so `Dockerfile` builds without `rustc`/`cargo`.

**Persistence semantics and wire compatibility**

- R3. Maintain 100% binary compatibility with existing Yjs v1 blobs in `documents.yjs_state`, `documents.yjs_state_vector`, `yjs_document_updates.payload`, and `yjs_state_archives.yjs_state`, and with browser `yjs` (`^13.6.31`) over `SyncChannel`.
- R4. Preserve all `YjsPersistence` contracts: O(update) append-only `merge` without loading `Y::Doc`, `state_b64` zero-`Y::Doc` column fast path, `persist_snapshot` zero-`Y::Doc` state-vector staleness gate, `fold!`, `compact!`, SHA-256 checksum self-healing, `yjs_state_archives` checkpoints/quarantine/orphan TTL, `content_generation` anti-resurrection, editing-lock enforcement, and `ActiveSupport::Notifications` events.
- R5. Reject undecodable and corrupted-tail Yjs updates cleanly by raising `ArgumentError` on `YjsPersistence.merge` (and healing via `CorruptStateError` on stored blobs) without crashing or segfaulting the Ruby process.
- R6. Fold tail updates without dropping pending structs from frames that mix already-integrated and causally-pending structs: gap-free batches compact and delete all applied rows; gapped batches persist only gap-free state (`compacted_state_update`) and retain any row whose structs are not yet fully captured in the folded snapshot.

### Scope Boundaries

- In scope: `Gemfile`, `Gemfile.lock`, `app/services/yjs_persistence.rb`, comments referencing `y-rb` in `app/channels/sync_channel.rb`, and Ruby tests covering `YjsPersistence`, `SyncChannel`, and `Document`.
- Deferred for later: Evaluating `yrby-rails` and `yrby-client` after `jpcamara/yrby#124` resolves and if Thinkroom ever wants ack-retransmit outbox semantics or server-side ProseMirror rendering.
- Out of scope: Changing `SyncChannel` JSON frame format, `CableProvider`, `db/schema.rb`, `DocumentsController`, `lib/tasks/yjs.rake`, or frontend npm dependencies.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Swap only the core CRDT gem (`yrby` ~> 0.9.1), keeping `YjsPersistence`, `SyncChannel`, and `CableProvider`.** `yrby` provides `require "y"` via `Bundler.require`, thread-safe GVL-released `yrs 0.28.1` bindings, binary `String` I/O, panic safety, and gap-detection primitives while avoiding `yrby-rails`'s open Action Cable 8.1 race (`jpcamara/yrby#124`) and preserving Thinkroom's custom generation, lock, archive, and SSR contracts.
- KTD2. **Use binary `String` throughout `YjsPersistence`, removing `.unpack("C*")` / `.pack("C*")` conversions.** `yrby`'s `Y::Doc#apply_update`, `encode_state_vector`, `encode_state_as_update`, and `compacted_state_update` accept and return ASCII-8BIT binary strings directly. `EMPTY_UPDATE` becomes `"\x00\x00".b.freeze`, and `decode_state_vector` / `zero_struct_update?` read bytes via `String#getbyte` to preserve zero-`Y::Doc` fast paths (`R4`) without allocating `Array<Integer>`.
- KTD3. **Use `compacted_state_update` for persisted snapshots and `pending?` + `update_ready?`/`update_advances?` for fold row classification.** On a gap-free fold (`!ydoc.pending?`), every applied current-generation row integrated cleanly and is deleted with zero per-row probes. On a gapped fold (`ydoc.pending?`), persist `blob = ydoc.compacted_state_update` (gap-free), seed a throwaway `base = Y::Doc.new; base.apply_update(blob)`, and delete an applied row only when `zero_struct_update?(row.payload)` (covering pure delete-set frames and joiner delete-set echoes) OR (`base.update_ready?(row.payload) && !base.update_advances?(row.payload)`). Any row carrying a still-pending struct — including a mixed frame with both integrated and pending structs — stays retained until its dependency arrives or `ORPHAN_TTL` quarantines it (`R6`).
- KTD4. **Keep `encode_ydoc_b64` gap-free via `compacted_state_update` and `encode_state_vector`.** Serving gap-free snapshots matches persisted `yjs_state` and avoids poisoning joining browsers with orphaned pending structs while retained tail rows remain in `yjs_document_updates` until healed or quarantined.
- KTD5. **Keep `decode_state_vector` hand-rolled in Ruby.** `persist_snapshot` compares stored `yjs_state_vector` and client `state_vector_b64` without instantiating `Y::Doc` (enforced by `test/services/yjs_persistence_test.rb:669`); keeping the 25-line lib0 varUint reader preserves this fast path cleanly.

### Assumptions

- Working branch will branch from `origin/main` cleanly without disturbing untracked or unrelated local files; verify the active rbenv Ruby matches `.ruby-version` on that base branch.
- `yrby` 0.9.1's `Y::Text#delete(index, length)` replaces `y-rb`'s `Y::Text#slice!(index, length)` in tests (`test/services/yjs_persistence_test.rb:220,237`), and `Y::Doc#encode_state_as_update(sv)` replaces `Y::Doc#diff(sv)` / `full_diff` across tests.

### Risks and Dependencies

- **Risk:** `yrby` is pre-1.0 (`0.9.1`, solo maintainer). **Mitigation:** Production code isolates all `Y::` calls inside `app/services/yjs_persistence.rb` and uses only `yrby`'s stable core `Y::Doc` sync/encoding methods, never its experimental Ruby write handles.
- **Risk:** `Gemfile.lock` platform resolution differs between `y-rb` (`x86_64-linux-gnu`) and `yrby` (`x86_64-linux`). **Mitigation:** Verify `Gemfile.lock` explicitly locks precompiled `yrby` platform gems for `x86_64-linux`, `aarch64-linux`, `arm64-darwin`, and `x86_64-darwin` after `bundle install` / `bundle lock`.
- **Risk:** `zero_struct_update?` vs `update_ready?` behavior on pure delete-set frames referencing unknown structs (moot tombstones) or joiner delete-set echoes. **Mitigation:** Explicitly verified in `U2`/`U3` against existing delete-only fold and delete-set echo tests plus a new mixed-frame pending-struct test.

---

## Implementation Units

### U1. Swap gems in Gemfile and lock precompiled platforms

- **Goal:** Replace `y-rb` and unused `y-rb_actioncable` with `yrby` (`~> 0.9.1`) and verify native platform lockfile entries (`R1`, `R2`, `KTD1`).
- **Files:** `Gemfile`, `Gemfile.lock`.
- **Approach:**
  - Replace `gem "y-rb", "~> 0.7.0"` and remove `gem "y-rb_actioncable", "~> 0.1.7"` with `gem "yrby", "~> 0.9.1"` in `Gemfile`.
  - Run `bundle install` and verify `Gemfile.lock` carries precompiled `yrby` entries for `arm64-darwin`, `x86_64-darwin`, `x86_64-linux`, `aarch64-linux` (and musl variants if in `PLATFORMS`), with zero remaining `y-rb` / `y-rb_actioncable` entries.
  - Smoke-check `bin/rails runner 'd = Y::Doc.new; puts d.encode_state_vector.unpack1("H*")'` loads the native extension cleanly.
- **Test Scenarios:**
  - `Gemfile.lock` contains precompiled `yrby` specs for Linux amd64/arm64 and macOS arm64/x86_64, and no `y-rb` or `y-rb_actioncable` entries.
  - `Y::Doc.new` boots cleanly under `bin/rails runner`.
- **Verification:** `bundle check && bin/rails runner 'puts Y::VERSION'`

### U2. Migrate YjsPersistence to yrby binary-string API and gap-safe fold classification

- **Goal:** Port `YjsPersistence` from `y-rb` to `yrby` binary strings, `compacted_state_update`, `encode_state_vector`, `apply_update`, and `pending?` / `update_ready?` / `update_advances?`, and update stale `y-rb` comments (`R3`, `R4`, `R5`, `R6`, `KTD2`, `KTD3`, `KTD4`, `KTD5`).
- **Files:** `app/services/yjs_persistence.rb`, `app/channels/sync_channel.rb`.
- **Approach:**
  - Change `EMPTY_UPDATE` to `"\x00\x00".b.freeze` and `decode(base64_update)` to `Base64.strict_decode64(base64_update)` (binary `String`).
  - Update `merge` to store `payload: update` directly and validate via `decodable_update?(update)` using `Y::Doc.new.apply_update(update)`.
  - Update `load_ydoc`, `blob_loadable?`, `compact!`, `encode_ydoc_b64`, `persist_snapshot` (the corrupt-vector/legacy-row fallback `load_or_heal_ydoc(document).encode_state_vector`), and `server_state_vector` to use `apply_update`, `compacted_state_update`, and `encode_state_vector` directly on binary strings.
  - Update `perform_fold`:
    - Separate older-generation rows into `integrated_ids`.
    - Apply current-generation rows to `ydoc` via `ydoc.apply_update(row.payload)` (catching `StandardError` into `retained` for undecodable rows).
    - Compute `blob = ydoc.compacted_state_update`.
    - If `!ydoc.pending?`, mark all applied rows integrated; if `ydoc.pending?`, seed `base = Y::Doc.new; base.apply_update(blob)` and mark an applied row integrated only if `zero_struct_update?(row.payload)` or (`base.update_ready?(row.payload) && !base.update_advances?(row.payload)`), retaining the rest for future healing or `ORPHAN_TTL` quarantine.
    - Remove obsolete `self_contained_update?`.
  - Update `zero_struct_update?`, `decode_state_vector`, and `decode_var_uint` to read bytes directly from binary `String` via `getbyte` (raising `ArgumentError` on out-of-bounds / nil byte).
  - Update comments in `app/services/yjs_persistence.rb` and `app/channels/sync_channel.rb` to reflect `yrby` instead of `y-rb`.
- **Test Scenarios:**
  - All existing `YjsPersistence` merge, fold, compaction, snapshot gate, checksum healing, archive, and notification behaviors pass unchanged.
  - Corrupted tail bytes in a base64-valid update raise `ArgumentError` in `merge` (no segfault) and heal cleanly if present in stored `yjs_state`.
  - A mixed frame carrying both already-integrated structs and causally-pending structs integrates the ready portion into `yjs_state`, retains the mixed row until the missing dependency arrives, and deletes the row once the dependency arrives and folds.
- **Verification:** `bin/rails test test/services/yjs_persistence_test.rb test/channels/sync_channel_test.rb test/models/document_test.rb`

### U3. Migrate Y::Doc test helpers and add regression coverage for corrupted tail bytes and mixed pending frames

- **Goal:** Port existing `y-rb` calls in test files to `yrby` APIs and add targeted tests proving `R5` and `R6` (`R3`, `R4`, `R5`, `R6`, `KTD2`, `KTD3`).
- **Files:** `test/services/yjs_persistence_test.rb`, `test/channels/sync_channel_test.rb`, `test/models/document_test.rb`.
- **Approach:**
  - Replace `y-rb` calls in tests (`sync(bytes.unpack("C*"))` → `apply_update(bytes)`, `diff` / `full_diff` → `encode_state_as_update` / `compacted_state_update`, `state` → `encode_state_vector`, `slice!` → `delete`).
  - Add a regression test in `test/services/yjs_persistence_test.rb` sending a base64-valid Yjs update with corrupted tail bytes to `YjsPersistence.merge` and verifying it raises `ArgumentError` cleanly without crashing and leaves the document untouched.
  - Add a regression test in `test/services/yjs_persistence_test.rb` for a frame mixing an integrated update (from client A) and a causally-pending update (from client B, clock > 0 missing clock 0): verify the first fold persists client A's text and retains the mixed row, and a subsequent fold after client B's missing update arrives integrates both edits and clears the tail.
- **Test Scenarios:**
  - Full `yjs_persistence_test.rb`, `sync_channel_test.rb`, and `document_test.rb` pass with zero failures.
  - Corrupted tail-byte frame is rejected with `ArgumentError`, not a native crash.
  - Mixed integrated+pending frame preserves both edits after dependency arrival instead of dropping the pending half.
- **Verification:** `bin/rails test && bin/rubocop && npm run check`

---

## Verification Contract

| Check | Command | Purpose |
|---|---|---|
| Full Rails test suite | `bin/rails test` | Verify all ~680+ unit/integration/channel tests including `YjsPersistence`, `SyncChannel`, `Document`, `yjs:compact`, `yjs:reset` |
| Ruby linter | `bin/rubocop` | Verify style compliance on `Gemfile`, `app/services/yjs_persistence.rb`, `app/channels/sync_channel.rb`, and tests |
| TypeScript check | `npm run check` | Verify zero frontend regressions |
| Two-client real Yjs browser/WS convergence | `node script/sync_check.mjs` (against `bin/dev`) | Prove live JavaScript `yjs ^13.6.31` ↔ Ruby `yrby 0.9.1` (`yrs 0.28.1`) binary wire compatibility and concurrent convergence |
| Document size & read-only open check | `node script/document_size_check.mjs` (against `bin/dev`) | Prove read-only open sends no echo writes and compaction/size guards hold |

---

## Definition of Done

- `Gemfile` and `Gemfile.lock` use `yrby` (`~> 0.9.1`) with precompiled Linux/macOS native gems locked and no references to `y-rb` or `y-rb_actioncable`.
- `app/services/yjs_persistence.rb` uses `yrby` binary-string APIs and gap-safe fold classification (`compacted_state_update`, `pending?`, `update_ready?`, `update_advances?`) with all existing durability, lock, generation, and zero-`Y::Doc` fast-path invariants intact.
- Regression tests cover corrupted-tail updates (`R5`) and mixed integrated+pending frames (`R6`).
- `bin/rails test`, `bin/rubocop`, `npm run check`, and live `script/sync_check.mjs` against `bin/dev` all pass.
- No abandoned/experimental code or unrelated working-tree changes remain in the diff.
