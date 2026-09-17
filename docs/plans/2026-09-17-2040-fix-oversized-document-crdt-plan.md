---
title: "Oversized document CRDT guard, state embedding cap, compaction tasks, deploy config - Plan"
type: fix
date: 2026-09-17
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Oversized document CRDT guard, state embedding cap, compaction tasks, deploy config - Plan

## Goal Capsule

- **Objective:** A document can no longer grow, through the live editor, past what the server accepts as its canonical source; a document that already did can be compacted or reset from the server; the page never embeds a multi-megabyte Yjs state in its HTML; `bin/kamal config` works on a clean `main` with an unset `WEBMCP_ORIGIN_TRIAL_TOKEN`.
- **Means:** A ProseMirror `filterTransaction` size guard for local edits, a visible notice when the durable snapshot is refused, a byte cap on `yjs_state_b64` in `documents#show`, `yjs:compact` and `yjs:reset` rake tasks over the existing `YjsPersistence` and `Document#replace_content!` paths, and `.to_json` on the string env values in `config/deploy.yml`.
- **Authority:** Requirements govern behavior; technical decisions govern mechanism; `AGENTS.md`, `STRATEGY.md`, `docs/plans/2026-07-02-006-feat-yjs-durability-stack-plan.md` and `docs/plans/2026-07-02-007-feat-yjs-update-log-plan.md` remain authoritative for the persistence layer.
- **Execution profile:** Behavior-preserving for every document under the caps; the only new user-visible behavior is the refused-edit notice and the snapshot-refused notice.
- **Stop conditions:** Escalate anything that would change Markdown serialization, provenance semantics, or reject a remote (y-sync) transaction.

---

## Product Contract

### Summary

Live document `9FQ2F6xpMt` (server id 1150) carries a 10.8 MB Yjs state while its stored source is the 72-byte template. Decoding the state shows the mechanism: it is not mark churn. One browser client (`clientID 4142641551`, every provenance mark `human / Kieran Klaassen`) pasted a 4.2 million character Cursor agent transcript, 12,131 top-level blocks and 34,203 text runs. Each pasted text run carries one provenance mark, which Yjs stores as an open/close pair of format items, hence the ~66k `provenance` strings. The only other client in the state is the seeder (71 clock units, the template). Re-encoding the state through a fresh `Y.Doc` yields the identical 10,872,124 bytes: there is nothing redundant to squash.

The stored source stayed the template because the editor's durable snapshot (`POST /d/:slug/snapshot`) is capped at `MAX_SNAPSHOT_BYTES = 2 MB` and answers 413 for this document, while the CRDT path (SyncChannel) has no cap, so the document outgrew the server's own source limit without anyone being told. Opening a document without editing already writes nothing durable (the joiner's sync-reply is the empty update and is a `noop`; awareness is relay-only); this plan keeps that true and adds a check for it.

### Problem Frame

Three defects follow from that mechanism, plus one deploy-config defect:

1. The editor accepts local edits that make the document larger than `Document::MAX_CONTENT_BYTES`, after which every snapshot push fails silently (a `console.warn`) and agents, previews and the social card serve stale content forever.
2. `documents#show` embeds the full Yjs state as base64 in the page HTML regardless of size (14.5 MB for this document), so the page itself becomes unusable before the editor even starts.
3. There is no server-side way to compact or reset a document's CRDT state without the CLI and an owner session.
4. `config/deploy.yml` writes `WEBMCP_ORIGIN_TRIAL_TOKEN: ` when the env var is unset, which YAML reads as nil and Kamal rejects (`env/clear/WEBMCP_ORIGIN_TRIAL_TOKEN: should be a string`). `RIFFREC_AUTOMATION_EMAILS` has the same shape.

### Requirements

**Size guard**

- R1. A local transaction (typing, paste, drop, slash-menu insert, programmatic replace) that would grow the ProseMirror document past a hard size limit is refused before it reaches Yjs; the document is unchanged and the user sees a notice naming the limit.
- R2. Remote (y-sync) transactions, deletions, and transactions that shrink an already-oversized document are never refused.
- R3. When the server refuses a durable snapshot as too large (413), the editor shows a visible notice that the document's saved source is stale, instead of only a console warning.

**Page payload**

- R4. `documents#show` omits `yjs_state_b64` when the stored state exceeds a byte cap; `has_state` still reports the truth, and the editor loads the state through the SyncChannel handshake exactly as a document with no embedded state does today.
- R5. Documents under the cap keep the embedded state and their current instant-hydration behavior.

**Server-side compaction and reset**

- R6. `bin/rails "yjs:compact[slug]"` folds any update tail, rebuilds the stored state from a fresh `Y::Doc` load and re-encode, persists the rebuilt blob, vector and checksum only when the bytes differ, archives the pre-compaction state as a checkpoint before rewriting, and prints before/after sizes. Running it twice is a no-op the second time. It never changes document content.
- R7. `bin/rails "yjs:reset[slug]"` replaces the live CRDT with the document's current saved source (the last accepted snapshot, or the seed) through `Document#replace_content!`, so the previous state is archived as a `replacement`, the content generation advances, and connected clients reload. It prints the archived size and the new generation.
- R8. Both tasks fail loudly on an unknown slug and touch nothing else.

**Open without editing**

- R9. Opening a document with existing state in the browser, waiting for the live editor, and closing it sends no Yjs update frame with content; the stored state, vector and checksum are byte-identical afterwards.

**Deploy configuration**

- R10. `bin/kamal config` renders `WEBMCP_ORIGIN_TRIAL_TOKEN` and `RIFFREC_AUTOMATION_EMAILS` as strings (`""` when unset) so it succeeds on a clean checkout with those variables absent from `deploy.env`; a set value renders verbatim.

### Scope Boundaries

No change to `MAX_CONTENT_BYTES` or `MAX_SNAPSHOT_BYTES`, no cap on SyncChannel frames (a legitimate full-state `sync-reply` for a 2 MB document exceeds 2 MB), no Markdown or provenance serialization change, no compression of the embedded state (the cap makes the multi-megabyte case moot; zstd on the wire already covers the rest), no deploy.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Guard on `doc.content.size` in `filterTransaction`, limit = `Document::MAX_CONTENT_BYTES` (2,097,152).** `content.size` is O(1) and counts one unit per character plus two per node boundary, so a document over the limit can never serialize under the byte cap: the guard catches every document that can never be snapshotted, at zero per-transaction cost. It does not catch documents between roughly 1 and 2 MB of text whose Markdown plus provenance markup exceeds 2 MB; R3 covers those by making the 413 visible. Governs R1, R2.
- KTD2. **Refused edits and refused snapshots surface through one editor callback (`onNotice`) rendered in the existing `doc-notice` slot.** No new UI component. Governs R1, R3.
- KTD3. **Embedding cap `MAX_EMBEDDED_STATE_BYTES = 1 MB` on the binary blob.** The perf fixture (1 MB base64, about 750 KB binary) stays embedded; the incident document (10.8 MB) does not. The client already handles a null `initialStateB64` by waiting for `synced`. Governs R4, R5.
- KTD4. **Compaction reuses `YjsPersistence.fold!` and the load/encode helpers; it does not reimplement folding.** A public `YjsPersistence.compact!(document)` acquires the same locks, folds, loads through `load_or_heal_ydoc`, encodes `full_diff`, and writes through the same columns and checksum as a fold. The pre-compaction blob is recorded as a `checkpoint` archive so a bad rewrite is recoverable. Governs R6.
- KTD5. **Reset is `replace_content!(source: current_content)`.** That path already archives the wiped state, bumps the generation, broadcasts `content_reset`, and auto-rejects stale suggestions. Governs R7.
- KTD6. **`.to_json` on ERB string values in `config/deploy.yml`.** `"".to_json` is `""` (a YAML string), `"abc".to_json` is `"abc"`. Governs R10.
- KTD7. **Open-idempotence is checked in the browser, in the CI `browser_checks` loop.** Playwright intercepts SyncChannel WebSocket frames sent by the page and asserts that after the handshake only awareness frames and the empty sync-reply go out, and that `yjs_state_b64` read from the page props is identical across two opens. Governs R9.

### Assumptions

- `Y::Doc#full_diff` on a freshly loaded doc yields a canonical encoding of the same state (deleted content garbage-collected), so a second compaction is a byte-for-byte no-op.
- A guest opening the page with `can_write` can still receive the state through the handshake when it is not embedded; nothing in the handshake depends on the embedded prop.

### Sequencing

U1 (deploy config) and U4 (tasks) are independent of the editor work. U2 (size guard and notices) and U3 (embedding cap) are independent of each other. U5 adds coverage for all of them and runs last.

---

## Implementation Units

### U1. Deploy config strings
- **Files:** `config/deploy.yml`, `test/config/deploy_config_test.rb`
- **Cites:** R10, KTD6
- **Done when:** rendering `config/deploy.yml` through ERB with the two variables unset yields `""` strings under `env.clear`, and with them set yields the values.

### U2. Editor size guard and notices
- **Files:** `app/frontend/editor/document_size_guard.ts`, `app/frontend/editor/milkdown_editor.tsx`, `app/frontend/editor/snapshots.ts`, `app/frontend/pages/documents/show.tsx`
- **Cites:** R1, R2, R3, KTD1, KTD2
- **Done when:** a paste that would push the document past the limit leaves the document unchanged and shows the notice; a 413 from the snapshot endpoint shows the stale-source notice; remote transactions are never filtered.

### U3. Embedding cap
- **Files:** `app/controllers/documents_controller.rb`, `test/integration/document_seed_claim_test.rb` or a new controller test
- **Cites:** R4, R5, KTD3
- **Done when:** a document whose blob exceeds the cap renders with `yjs_state_b64: null` and `has_state: true`; a smaller one still embeds.

### U4. Compaction and reset
- **Files:** `app/services/yjs_persistence.rb`, `lib/tasks/yjs.rake`, `test/services/yjs_persistence_test.rb`, `test/tasks/yjs_tasks_test.rb`
- **Cites:** R6, R7, R8, KTD4, KTD5
- **Done when:** `compact!` on a document with tombstones shrinks the blob, keeps the text identical, records a checkpoint, and is a no-op on the second run; `yjs:reset` archives the state, advances the generation and leaves the seed at the current content; both tasks raise on an unknown slug.

### U5. Open-idempotence browser check
- **Files:** `script/open_idempotence_check.mjs`, `.github/workflows/ci.yml`
- **Cites:** R9, KTD7
- **Done when:** the check passes locally against `bin/dev` and runs in the CI loop.

---

## Verification Contract

- `npm run check`
- `bin/rubocop`
- `bin/rails test`
- `BASE_URL=http://localhost:3000 node script/open_idempotence_check.mjs` against a running dev server
- `ruby -ryaml -rerb -rjson -e 'puts YAML.safe_load(ERB.new(File.read("config/deploy.yml")).result)["env"]["clear"].inspect'` with the required `KAMAL_*` variables set and the two optional ones unset

## Definition of Done

- All Verification Contract commands pass and CI is green.
- The runbook for production (`docs/solutions/` entry or the PR description) gives the exact `bin/kamal app exec` commands to compact and to reset document `9FQ2F6xpMt` after deploy.
