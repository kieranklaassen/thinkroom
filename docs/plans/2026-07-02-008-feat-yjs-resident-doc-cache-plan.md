---
date: 2026-07-02
type: feat
title: "feat: Resident per-document Y::Doc session cache"
origin: docs/ideation/2026-07-02-yjs-storage-ideation.html (idea #4)
depth: standard
base: cursor/yjs-state-vector-column-0857 (deliberate alternative fork to the append-log PR)
---

# feat: Resident per-document Y::Doc session cache

## Summary

Every merge builds a fresh `Y::Doc` from the stored blob before applying one update — O(document) rehydration per keystroke frame. This plan keeps the merged doc resident in memory per document (the Hocuspocus model), validated under the existing locks by `content_generation` plus a blob digest, so steady-state merges skip the rehydration entirely and pay only the update apply + re-encode. Entries evict when the last subscriber disconnects (in-process refcount — correct under the deployment's single-process pin) and under an LRU cap for HTTP-only writers; the same lifecycle finally gives the never-evicted `LOCKS` mutex map an eviction point.

**Positioning:** this is the ideation roadmap's no-schema-change alternative to the append-only update log (PR #137). The two PRs deliberately conflict; the team picks a direction (or lands the log and adapts this cache to the fold path).

## Requirements

- R1: A merge whose cache entry is valid (same generation, digest matches the stored blob) applies the update to the resident doc without `load_ydoc`.
- R2: Validity is checked under both locks after `reload`; any external write (digest mismatch) or `replace_content!` (generation bump) forces a miss and a fresh load — no stale-cache write can ever persist.
- R3: The cache entry is refreshed on every persist; a no-op merge (pending or duplicate update) leaves the entry consistent with the unchanged stored blob.
- R4: Entries evict on last disconnect (SyncChannel refcount) and via an LRU cap (`MAX_RESIDENT_DOCS = 256`); the per-document `LOCKS` mutex evicts on last disconnect when unlocked (a racing thread that still holds a reference is safe — `with_lock` remains the second guard, per the existing comment).
- R5: `merge.yjs` events record `cache: hit|miss` so the hit rate is measurable.
- R6: Behavior is otherwise unchanged: same outcomes, same rejections, same handshake serving (columns-first from the stacked state-vector PR).
- R7: A pending (causally dependent) update is inert in the resident doc — y-rb 0.7.0 never re-integrates parked pending structs when the dependency later syncs (verified empirically), and `full_diff` never serializes them. Convergence comes from client redelivery, exactly as on the fresh-doc-per-merge path; the cache must not make this worse.

## Key Technical Decisions

- **Digest over timestamp for validity.** `updated_at` changes on unrelated column writes; a SHA-256 of the blob (microseconds at document sizes) is the only signal that proves the cached doc derives from the exact stored bytes.
- **Cache maintained on merge, evicted on disconnect + LRU.** HTTP keepalive flushes (`sync_update`) arrive as the cable closes, so merge-time caching plus a size cap covers writers without subscriptions; the disconnect hook covers the common editing session.
- **Mutex eviction accepts a benign race.** Deleting an unlocked mutex while another thread holds a reference can briefly yield two mutexes for one document; the row lock (`with_lock`) still serializes the write, matching the existing design note that the DB transaction is the second guard.

## Implementation Units

### U1. Resident cache in YjsPersistence

**Goal:** hit/miss logic under locks, entry refresh on persist, LRU cap, `cache` payload marker, public `release`/`resident?`/`reset_cache!` lifecycle hooks.

**Files:** `app/services/yjs_persistence.rb`, `config/initializers/yjs_instrumentation.rb`, `test/services/yjs_persistence_test.rb`

**Test scenarios:**
- Second merge on a doc does not call `load_ydoc` (stub raises) and produces the correct merged text; the event records `cache: "hit"`.
- External `update_columns` blob write invalidates the entry (next merge misses and includes the external content).
- `replace_content!` invalidates via generation (existing anti-resurrection tests stay green).
- Out-of-order dependent updates: dependent-first merge is a no-op; once the dependency merges, both persist (R7).
- LRU: exceeding `MAX_RESIDENT_DOCS` evicts the least-recently-used entry.
- Concurrency: existing concurrent-merge test stays green.

### U2. Disconnect lifecycle in SyncChannel

**Goal:** subscriber refcount; last disconnect calls `YjsPersistence.release(document_id)` (cache + unlocked-mutex eviction).

**Files:** `app/channels/sync_channel.rb`, `test/channels/sync_channel_test.rb`, `test/test_helper.rb` (reset shared state between tests)

**Test scenarios:**
- Last unsubscribe evicts the resident entry and the mutex; an intermediate unsubscribe (second subscriber open) does not.
- Rejected subscriptions do not corrupt the refcount.

## Scope Boundaries

- **Non-goals:** schema changes; serving handshakes from the cache (columns already serve them); healing/durability (lives in the other stack); multi-process coherence (deployment is pinned single-process; the digest check is the forward-compatible guard).
