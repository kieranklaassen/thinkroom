---
title: "A document's Yjs state outgrows its saved source: one 4 MB paste, a 10 MB CRDT, a 72-byte snapshot"
module: documents/show editor, YjsPersistence, SyncChannel
date: 2026-09-17
problem_type: data_integrity
component: rails_controller
severity: high
related_components:
  - service_object
  - action_cable
  - prosemirror_plugin
tags:
  - yjs
  - crdt
  - provenance
  - paste
  - snapshot
  - kamal
applies_when:
  - "A document page is many megabytes or never reaches the live editor while its API content looks tiny"
  - "The agent API, preview or social card show content that is older than what editors see"
  - "Deciding where a size limit belongs when the same data has a CRDT form and a serialized form"
  - "A Yjs client sends a sync-reply and you wonder whether it can be empty"
---

# A document's Yjs state outgrows its saved source

## Context

Document `9FQ2F6xpMt` (id 1150) served a 14.6 MB page: `yjs_state_b64` was 14.5 MB (10.8 MB binary) while `content` was still the 72-byte "Untitled" template. The binary contained about 66,000 occurrences of `provenance`, which read like provenance marks multiplying on every session.

Decoding the state with `yjs` told a different story. Two clients only: the seeder (71 clock units, the template) and one browser client (`clientID 4142641551`, 4.35 million clock units) whose every provenance mark is `human / Kieran Klaassen`. The fragment holds 12,131 top-level blocks and 34,203 text runs of a pasted Cursor agent transcript, 4.2 million characters, in monotonically increasing clock order: one client appended it in one sitting. Each text run carries one provenance mark, which Yjs stores as an open/close pair of format items, hence two `provenance` strings per run. Re-encoding through a fresh `Y.Doc` gave the identical 10,872,124 bytes: nothing was redundant. The document was simply 4 MB of pasted text.

The saved source stayed the template because `POST /d/:slug/snapshot` caps content at `MAX_SNAPSHOT_BYTES` (2 MB) and answered 413 on every debounce, logged only as `console.warn`, while the CRDT path (SyncChannel) has no cap. The two limits were asymmetric, so the document could outgrow the server's own source limit with nobody told.

A second, smaller write surfaced while checking that "open without editing writes nothing": it did not hold. `Y.encodeStateAsUpdate(doc, serverVector)` always appends the whole delete set, so a joiner's sync-reply on any document with deletion history is a zero-struct delete-set frame. `YjsPersistence.merge` short-circuits only the exactly-empty update, appended that frame as a row on every open, and the next handshake folded it away with a full load of the blob. On the incident document, every open cost a 10.8 MB decode and re-encode.

## Guidance

**1. Enforce a size limit at the point where the data is created, in the same unit the server enforces.** The server's cap on the serialized source is the truth; the editor now refuses local transactions that would push `doc.content.size` past `MAX_DOCUMENT_SIZE` (`app/frontend/editor/document_size_guard.ts`, a `filterTransaction` plugin). `content.size` is O(1) and a document above it can never serialize under the byte cap. Remote (y-sync) transactions and deletions are never filtered: filtering a remote change desynchronizes the replica, and the user must be able to delete back under the limit.

**2. When a write path fails permanently, tell the user, not the console.** A 413 on the durable snapshot now raises a visible notice through the editor's `onNotice` callback: the saved copy is stale until the document is shortened.

**3. A joiner owes the server nothing unless it has something.** `CableProvider` replies to the handshake only when a local change happened while unsynced (`pendingLocalChanges`; hydration from the page's `yjs_state_b64` is tagged `server-hydrate` and does not count) or the encoded diff carries structs (an `update` frame lost before a disconnect). The server keeps its fold-time classification of delete-set echoes for older clients.

**4. Do not embed what the browser cannot use.** `documents#show` omits `yjs_state_b64` above `MAX_EMBEDDED_STATE_BYTES` (1 MB); the editor takes the handshake path it already has for a document with no embedded state.

**5. Keep an operator path that does not need the CLI or an owner session.** `bin/rails "yjs:compact[slug]"` folds and re-encodes (content unchanged, previous blob archived as a checkpoint, second run reports `unchanged`). `bin/rails "yjs:reset[slug]"` replaces the live state with the saved source through `Document#replace_content!` (state archived as a `replacement`, generation bumped, editors reload). Compaction cannot shrink a document that is genuinely large; that one needs the reset.

## Why This Matters

The symptom pointed at the wrong mechanism. String counts in a CRDT blob describe its encoding, not its history; decoding the structs (client ids, clocks, content types, delete set) took a minute and settled the question. Asymmetric limits are the systemic bug: any pair of representations of the same data must be capped at the same boundary, or the uncapped one becomes the place where the invariant silently breaks.

## When to Apply

Any time a client-side data structure is mirrored by a server-side projection with its own limit (CRDT and snapshot, canvas scene and thumbnail, editor JSON and HTML export). And whenever a Yjs client sends `encodeStateAsUpdate(doc, remoteVector)`: check whether the recipient already has every delete, because the delete set travels regardless.

## Production runbook for the incident document

From a checkout of `main` with `.kamal/deploy.env` sourced (see `DEPLOYING.md`):

```bash
bin/kamal app exec --reuse 'bin/rails "yjs:compact[9FQ2F6xpMt]"'   # expected: 10872124 -> 10872124 bytes, unchanged
bin/kamal app exec --reuse 'bin/rails "yjs:reset[9FQ2F6xpMt]"'     # archives the 10.8 MB state, seeds the 72-byte template
```

The reset discards the pasted transcript from the live document. It stays recoverable in `yjs_state_archives` (kind `replacement`, the pre-bump generation) until five newer replacement archives push it out.
