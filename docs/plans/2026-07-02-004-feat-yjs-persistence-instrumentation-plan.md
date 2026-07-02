---
date: 2026-07-02
type: feat
title: "feat: Instrument the Yjs persistence hot path"
origin: docs/ideation/2026-07-02-yjs-storage-ideation.html (idea #2)
depth: standard
---

# feat: Instrument the Yjs persistence hot path

## Summary

`YjsPersistence` hosts every silent data-loss and performance path in the collaborative-editing stack, yet contains zero logging, metrics, or `ActiveSupport::Notifications` instrumentation. `persist_snapshot` swallows state-vector decode errors as an indistinguishable `false`; sequence-gap drops and stale-generation rejections vanish into unsampled `Rails.logger.warn` lines; merge duration and blob-size distributions are unmeasurable. This plan wraps the persistence hot path (`merge`, `state_b64`, `persist_snapshot`) and the SyncChannel drop paths in structured `ActiveSupport::Notifications` events with an outcome taxonomy and byte-size payloads, plus a log subscriber that turns them into legible structured logs. The measured distributions become the tuning inputs for every follow-up storage change (compaction triggers, debounce windows, size caps).

## Problem Frame

- `app/services/yjs_persistence.rb` has no `Rails.logger`, `ActiveSupport::Notifications`, or `instrument` calls at all.
- `persist_snapshot` ends in `rescue ArgumentError → false`: a corrupt state vector is indistinguishable from a legitimately-stale client at the API boundary, and nothing is logged.
- The only pipeline signals are three `Rails.logger.warn` lines in `app/channels/sync_channel.rb` (malformed frame, gap drop, generic merge failure) — the gap-drop path discards user edits with only an unstructured warn.
- Every performance claim about the write path (O(document) per-frame cost, burst amplification, join cost) is unmeasured; there is no blob-size or merge-latency distribution to size future compaction/debounce/cap thresholds from.

## Requirements

- R1: Every `YjsPersistence.merge` call emits one structured event carrying document id, outcome, update bytes, blob bytes before/after, and duration.
- R2: Every `YjsPersistence.state_b64` call emits one structured event carrying document id and served blob bytes.
- R3: Every `YjsPersistence.persist_snapshot` call emits one structured event with outcome (`persisted`, `rejected_stale_vector`, `rejected_locked`, `invalid_state_vector`), and the invalid-state-vector path logs a warning instead of failing silently (return value stays `false` — API contract unchanged).
- R4: SyncChannel frame drops (malformed base64, excessive sequence gap) emit structured events with a reason, replacing bare warn lines with subscriber-driven logs.
- R5: A log subscriber renders these events as single-line structured logs — non-success outcomes at `warn`, slow operations at `info`, routine successes at `debug` — without ever logging document content.
- R6: No behavior change to persistence semantics: same return values, same raised errors, same locking, same broadcast ordering.

## Key Technical Decisions

- **`ActiveSupport::Notifications`, not an APM gem.** The repo has no APM integration; Rails-native events cost nothing extra and give any future APM (AppSignal, Datadog) a ready subscription point. Adding a paid APM dependency is out of scope.
- **Event names namespaced `merge.yjs` / `state.yjs` / `snapshot.yjs` / `frame_dropped.yjs`** following Rails' `event.namespace` convention so a single `/\.yjs$/` regex subscription covers them all.
- **Outcome taxonomy in the payload, not in event names.** One event per operation with an `outcome` key (`merged`, `noop`, `rejected_stale`, `rejected_locked`, `persisted`, `rejected_stale_vector`, `invalid_state_vector`, `dropped_gap`, `dropped_malformed`) keeps cardinality low and subscription simple.
- **Byte sizes only, never content.** Payloads carry `update_bytes`, `blob_bytes_before`, `blob_bytes_after` — document text never reaches logs.
- **Exceptions still propagate.** `EditingLockedError` / `StaleGenerationError` raise through the instrument block; the payload records the outcome before raising so subscribers see the rejection without changing the caller contract.

---

## Implementation Units

### U1. Instrument YjsPersistence operations

**Goal:** `merge`, `state_b64`, and `persist_snapshot` each emit one `ActiveSupport::Notifications` event with document id, outcome, and byte sizes; the snapshot decode failure logs a warning.

**Requirements:** R1, R2, R3, R6

**Dependencies:** none

**Files:**
- `app/services/yjs_persistence.rb`
- `test/services/yjs_persistence_test.rb`

**Approach:** Wrap each public method body in `ActiveSupport::Notifications.instrument("<op>.yjs", payload)` and mutate `payload[:outcome]` (plus byte counts) as the operation resolves. For `merge`, set `outcome: "rejected_locked"` / `"rejected_stale"` immediately before raising so the event records the rejection; `"noop"` when the state comparison short-circuits; `"merged"` with `blob_bytes_before`/`blob_bytes_after` on persist. For `persist_snapshot`, replace the bare `rescue ArgumentError; false` with a rescue that sets `outcome: "invalid_state_vector"`, logs one warn line with the document id and error message, and still returns `false`. Measure lock wait by capturing a monotonic timestamp at method entry and recording `lock_wait_ms` once inside the `with_lock` block.

**Patterns to follow:** payload/no-content discipline mirrors `config/initializers/filter_parameter_logging.rb` intent; test style mirrors existing `test/services/yjs_persistence_test.rb` helpers (`b64_update_for`, `text_of`).

**Test scenarios:**
- Happy path: `merge` of a real update emits `merge.yjs` with `outcome: "merged"`, positive `update_bytes` and `blob_bytes_after`, and `document_id`.
- No-op: the empty sync-reply emits `outcome: "noop"` and (existing assertion) does not persist or flip `seed_state`.
- Error path: stale-generation merge emits `outcome: "rejected_stale"` and still raises `Document::StaleGenerationError`; read-only doc emits `outcome: "rejected_locked"` and still raises `Document::EditingLockedError`.
- `state_b64` emits `state.yjs` with `blob_bytes` matching the stored blob size.
- `persist_snapshot` success emits `outcome: "persisted"`; behind-client emits `outcome: "rejected_stale_vector"` and returns false.
- Error path: corrupt state vector emits `outcome: "invalid_state_vector"`, returns false, and logs a warning (assert via `Rails.logger` expectation or log capture).
- Regression: all existing persistence tests stay green (R6).

**Verification:** `bin/rails test test/services/yjs_persistence_test.rb` green; subscribing to `/\.yjs$/` in a test captures the expected events.

### U2. Emit structured drop events from SyncChannel

**Goal:** The malformed-frame and sequence-gap drop paths emit `frame_dropped.yjs` events with a reason and document id.

**Requirements:** R4, R6

**Dependencies:** U1 (shares the event-naming convention)

**Files:**
- `app/channels/sync_channel.rb`
- `test/channels/sync_channel_test.rb`

**Approach:** In `receive`'s malformed-base64 rescue and `enqueue_update`'s gap branch, publish `ActiveSupport::Notifications.instrument("frame_dropped.yjs", document_id:, reason: "malformed"/"gap", ...)` carrying the gap distance for the gap case. Remove the now-redundant inline `Rails.logger.warn` lines (the U3 subscriber renders these events at warn). Keep the generic merge-failure rescue's warn line — it wraps unexpected exceptions, not a taxonomized outcome.

**Test scenarios:**
- Malformed frame: sending non-base64 `update` emits `frame_dropped.yjs` with `reason: "malformed"` and does not broadcast.
- Gap drop: a frame with `seq` beyond `MAX_SEQUENCE_GAP` emits `reason: "gap"` with the offending sequence and expected sequence, and does not persist.
- Regression: in-order and out-of-order-within-gap sequences still persist and broadcast (existing tests).

**Verification:** `bin/rails test test/channels/sync_channel_test.rb` green.

### U3. Log subscriber initializer

**Goal:** One initializer translates `*.yjs` events into single-line structured logs with severity by outcome.

**Requirements:** R5

**Dependencies:** U1, U2

**Files:**
- `config/initializers/yjs_instrumentation.rb` (new)
- `test/services/yjs_persistence_test.rb` (subscriber formatting covered implicitly via one log-capture assertion)

**Approach:** `ActiveSupport::Notifications.subscribe(/\.yjs$/)` building a `key=value` log line (event, document_id, outcome, byte counts, duration rounded to ms). Severity routing: non-success outcomes (`rejected_*`, `invalid_*`, `dropped_*`) → `warn`; successful operations slower than 250 ms → `info`; everything else → `debug`. Guard against missing payload keys so a future event shape change cannot raise inside the subscriber.

**Test scenarios:**
- One log-capture test: a stale-generation rejection produces a `warn` line containing `outcome=rejected_stale` and the document id, and no document content.
- Test expectation beyond that: none — severity threshold routing is presentation-only; the events themselves are asserted in U1/U2.

**Verification:** `bin/rails test` green; a manual merge in `bin/rails console` shows the debug line when the log level permits.

---

## Scope Boundaries

- **In scope:** events, payloads, log subscriber, snapshot decode-failure logging.
- **Deferred to follow-up work:** wiring events to an external APM (AppSignal); dashboards/alerting; using the measured distributions to set compaction or debounce thresholds (ideas #1/#4 from the ideation doc); any payload-size caps (idea #5's hardening).
- **Non-goals:** changing persistence semantics, locking, broadcast ordering, or the wire protocol.

## Deferred to Implementation

- Exact payload key names beyond those listed (keep `document_id`, `outcome` stable — the subscriber and tests depend on them).
- Whether the slow-operation `info` threshold is 250 ms or another value — pick one constant, name it, and leave tuning to real data.
