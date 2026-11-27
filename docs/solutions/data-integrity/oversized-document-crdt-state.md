---
title: "A document's Yjs state outgrows its saved source: one 4 MB paste, a 10 MB CRDT, a 72-byte snapshot"
module: documents/show editor, CableProvider, YjsPersistence, SyncChannel
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

One document served a 14.6 MB page: `yjs_state_b64` was 14.5 MB (10.8 MB binary) while `content` was still the 72-byte "Untitled" template. The binary contained about 66,000 occurrences of `provenance`, which read like provenance marks multiplying on every session.

Decoding the state with `yjs` told a different story. Two clients only: the seeder (71 clock units, the template) and one browser client (4.35 million clock units) whose every provenance mark names the same person. The fragment holds 12,131 top-level blocks and 34,203 text runs of a pasted agent transcript, 4.2 million characters, in monotonically increasing clock order: one client appended it in one sitting. Each text run carries one provenance mark, which Yjs stores as an open/close pair of format items, hence two `provenance` strings per run. Re-encoding through a fresh `Y.Doc` gave the identical 10,872,124 bytes: nothing was redundant. The document was simply 4 MB of pasted text.

The saved source stayed the template because `POST /d/:slug/snapshot` caps content at `MAX_SNAPSHOT_BYTES` (2 MB) and answered 413 on every debounce, logged only as `console.warn`, while the CRDT path (SyncChannel) had no cap. The two limits were asymmetric, so the document could outgrow the server's own source limit with nobody told.

A second, smaller write surfaced while checking that "open without editing writes nothing": it did not hold. `Y.encodeStateAsUpdate(doc, serverVector)` always appends the whole delete set, so a joiner's sync-reply built that way was a zero-struct delete-set frame on any document with deletion history. `YjsPersistence` short-circuited only the exactly-empty update, appended that frame as a row on every open, and the next handshake folded it away with a full load of the blob. On the incident document, every open cost a 10.8 MB decode and re-encode.

## Guidance

**1. Enforce a size limit at the point where the data is created, in the same unit the server enforces.** The server's cap on the serialized source is the truth; the editor now refuses local transactions that would push `doc.content.size` past `MAX_DOCUMENT_SIZE` (`app/frontend/editor/document_size_guard.ts`, a `filterTransaction` plugin). `content.size` is O(1) and a document above it can never serialize under the byte cap. Remote (y-sync) transactions and deletions are never filtered: filtering a remote change desynchronizes the replica, and the user must be able to delete back under the limit.

**2. When a write path fails permanently, tell the user, not the console.** A 413 on the durable snapshot now raises a visible notice through the editor's `onNotice` callback: the saved copy is stale until the document is shortened.

**3. A joiner owes the server nothing unless it has something.** `CableProvider` does not diff against the server's vector to find what it owes. It keeps every unacknowledged local edit in an outbox (`inFlight` and `queued`) and flushes exactly that after the handshake, so an update lost before a disconnect and a delete-only edit are both resent, and an open without edits sends nothing. Hydration from the page's `yjs_state_b64` carries `SERVER_HYDRATE_ORIGIN` and never enters the outbox. If a delete-set echo does reach the server, `YjsPersistence.perform_fold` compares the state vector and the delete set of a state without gaps, not its encoded bytes, so the echo does not rewrite what is stored.

**4. Do not embed what the browser cannot use.** `documents#show` omits `yjs_state_b64` above `MAX_EMBEDDED_STATE_BYTES` (1 MB); the editor takes the handshake path it already has for a document with no embedded state.

**5. Keep an operator path that does not need the CLI or an owner session.** `bin/rails "yjs:compact[slug]"` folds and re-encodes (content unchanged, previous blob archived as a checkpoint, second run reports `unchanged`). `bin/rails "yjs:reset[slug]"` replaces the live state with the saved source through `Document#replace_content!` (state archived as a `replacement`, generation bumped, editors reload). Compaction cannot shrink a document that is genuinely large; that one needs the reset.

The commands and what to know before running them on a live document are in `DEPLOYING.md`. A reset leaves the replaced state recoverable in `yjs_state_archives` only until `YjsStateArchive::MAX_PER_KIND` newer replacement archives push it out.

## Why This Matters

The symptom pointed at the wrong mechanism. String counts in a CRDT blob describe its encoding, not its history; decoding the structs (client ids, clocks, content types, delete set) took a minute and settled the question. Asymmetric limits are the systemic bug: any pair of representations of the same data must be capped at the same boundary, or the uncapped one becomes the place where the invariant silently breaks.

## When to Apply

Any time a client-side data structure is mirrored by a server-side projection with its own limit (CRDT and snapshot, canvas scene and thumbnail, editor JSON and HTML export). And whenever a Yjs client sends `encodeStateAsUpdate(doc, remoteVector)`: check whether the recipient already has every delete, because the delete set travels regardless.
