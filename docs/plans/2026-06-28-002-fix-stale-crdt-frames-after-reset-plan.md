---
title: "fix: Reject stale CRDT frames after owner content replacement"
type: fix
date: 2026-06-28
origin: thinkroom update on claimed doc not reflected in browser UI
---

# fix: Reject stale CRDT frames after owner content replacement

## Summary

`thinkroom update` on a live (claimed/edited) document succeeds — `thinkroom show`
returns the new content — but the browser editor keeps showing the old content,
even after a full reload. This is the residual half of the "Stale client
re-persistence" risk documented in `2026-06-28-001-fix-owner-live-cli-replacement-plan.md`.

`Document#replace_content!` correctly resets the document (`yjs_state: nil`,
`seed_state: "pending"`, new `seed_content`) and broadcasts `content_reset`, which
makes the *same* open tab reload and re-seed (the #118 fix). But the CRDT relay
layer — `YjsPersistence.merge`, called by `SyncChannel#receive` (`update` /
`sync-reply`) and by `documents#sync_update` — has **no notion of a content
generation**. A still-connected or reconnecting editor that holds the pre-reset
CRDT state can merge it back in (a reconnect `sync-reply` dumps the client's
entire old document because the server's state vector is now empty). That
repopulates `yjs_state` with the OLD content and flips `seed_state` back to
`"seeded"`.

The result is a split-brain that matches the bug report exactly:
- `seed_content` / `current_content` (what `thinkroom show` and agents read) = NEW
- `yjs_state` (what the browser editor binds to) = OLD

Because `yjs_state` is now present, `Document#try_claim_seed` returns `false`
forever, so the editor never re-seeds and the stale content sticks.

---

## Reproduction (confirmed)

1. `thinkroom new` → account-owned doc (seed stage).
2. Open `/d/:slug/edit`, type an edit → creates `yjs_state` (doc becomes live).
3. `thinkroom update <url> <file> --agent "Claude"` → `replace_content!`
   resets the doc and broadcasts `content_reset`.
4. A single stale CRDT frame from the still-connected/reconnecting tab is merged
   via `YjsPersistence.merge` → `yjs_state` = OLD content, `seed_state = "seeded"`.
5. `thinkroom show` → NEW content; browser (even after reload) → OLD content.

Verified deterministically with a `rails runner` script (replace, then replay the
captured pre-reset state through `YjsPersistence.merge`) and visually in the
browser (editor shows the stale heading/body after a full reload).

---

## Problem Frame

CRDT updates are designed to merge commutatively and idempotently — the server
"blindly merges binary updates" (per `YjsPersistence`). That is exactly why a
destructive *reset* cannot be expressed as "clear the blob": any client still
holding the pre-reset state can re-introduce it, and the server cannot tell an
old-content frame from a new-content frame by bytes alone.

To make a reset durable against late frames, the server needs an explicit
**generation epoch** that increments on reset, and it must reject CRDT frames
produced from an older epoch.

---

## Requirements

- R1. After an owner `replace_content!`, CRDT frames produced from the pre-reset
  document state must not repopulate `yjs_state` or flip `seed_state` back to
  `"seeded"`.
- R2. Frames from a client that synced at the current generation (including the
  reloaded tab that applies the new seed) must still be accepted and broadcast.
- R3. Normal collaborative editing on a document that was never reset is
  unchanged (no regression to relay, persistence, ordering, or broadcast).
- R4. A client whose live session spans a reset (transient reconnect, not a
  reload) must not dump its stale document back; it should recover by reloading.
- R5. Backwards/rollout compatible: a frame without a generation is treated as
  generation 0, so never-reset documents keep working and only post-reset stale
  frames are dropped.

---

## Key Technical Decisions

- **KTD-1 — Add a monotonic `crdt_epoch` integer on `documents`.** No existing
  column is monotonic-and-only-bumped-on-reset (`updated_at` changes on every
  edit; `seed_state` is not monotonic). `replace_content!` increments it.
- **KTD-2 — Clients echo the epoch they synced at; the server drops older
  frames.** The `SyncChannel` sends `epoch` in its `sync` message. `CableProvider`
  stores it and includes it on every `update` / `sync-reply` frame and on the
  `sync_update` keepalive body. `YjsPersistence.merge` skips (and the channel does
  not broadcast) any frame whose epoch is below the document's current epoch.
- **KTD-3 — Reload on epoch advance instead of replying with stale state.** If a
  reconnecting client receives a `sync` whose epoch is higher than the one it had,
  its local doc is superseded; it reloads (the existing `content_reset` recovery)
  rather than sending a `sync-reply` that would carry old content at the new epoch.
- **KTD-4 — Keep the destructive reset on the server.** This builds on the
  existing `replace_content!` + `content_reset` design; it does not make CRDT
  merging "smarter" or rebuild Yjs state server-side.

---

## Implementation Units

### U1. Add the `crdt_epoch` generation column and bump it on reset

**Files:** `db/migrate/*_add_crdt_epoch_to_documents.rb`, `db/schema.rb`,
`app/models/document.rb`, `test/models/document_test.rb`

**Approach:** Migration adds `crdt_epoch` (integer, default 0, null: false).
`replace_content!` sets `crdt_epoch: crdt_epoch + 1` inside its existing locked
transition.

**Test scenarios:** `replace_content!` increments `crdt_epoch`; a never-reset doc
stays at 0.

### U2. Reject stale frames in `YjsPersistence.merge`

**Files:** `app/services/yjs_persistence.rb`, `test/services/yjs_persistence_test.rb`

**Approach:** Add an `epoch:` keyword. After reload-under-lock, if `epoch` is
present and `document.crdt_epoch > epoch`, skip the merge. Return a boolean so
callers know whether the frame was applied (and therefore whether to broadcast).
Current-epoch no-op frames still return "accepted" to preserve relay behavior.

**Test scenarios:** a frame at an older epoch does not change `yjs_state` /
`seed_state`; a frame at the current epoch persists as before; missing epoch behaves
as epoch 0.

### U3. Thread the epoch through the channel and the keepalive endpoint

**Files:** `app/channels/sync_channel.rb`, `app/controllers/documents_controller.rb`,
`test/channels/sync_channel_test.rb`, `test/integration/*`

**Approach:** `SyncChannel#subscribed` includes `epoch: @document.crdt_epoch` in the
`sync` message. `#receive` reads `data["epoch"]`, passes it to `merge`, and only
broadcasts the frame when the merge accepted it (stale frames are dropped entirely,
not relayed). `documents#sync_update` reads `params[:epoch]`, passes it to `merge`,
and skips the derived snapshot persist when the frame was stale.

### U4. Echo the epoch from the client and reload on epoch advance

**Files:** `app/frontend/editor/cable_provider.ts`,
`app/frontend/editor/milkdown_editor.tsx` (only if a hook is needed)

**Approach:** `CableProvider` stores `serverEpoch` from the `sync` message and
includes `epoch` on `sendUpdate` and on the `persistCurrentState` keepalive body.
If a later `sync` carries a higher epoch than the one already seen (reconnect
across a reset), the provider triggers a reload instead of replying with its stale
state, reusing the existing content-reset recovery.

### U5. Regression coverage end to end

**Files:** `test/integration/agent_api_test.rb` (or a focused integration test)

**Approach:** Assert the full sequence: live doc → owner replace → replay a
pre-reset frame at the old epoch → `yjs_state` stays empty / `seed_state` stays
`pending`, and a fresh page load still grants the seed (`seed_granted: true`) and
serves the NEW content.

---

## Scope Boundaries

- Does not change CRDT merge semantics for same-generation edits.
- Does not rebuild Milkdown/y-prosemirror state server-side.
- Does not alter ownership/authorization for `replace_content!` (covered by
  `2026-06-28-001`).

---

## Risks & Dependencies

- **Rollout overlap:** during a deploy, an old client sends no epoch (treated as 0).
  On a never-reset doc that is fine; on a just-reset doc its frames are correctly
  dropped (its state is genuinely stale). Acceptable, and the brief window is
  bounded by a manual Kamal deploy.
- **Lost edits on a superseded tab:** a tab that edited stale content after a reset
  will have those frames dropped. This is correct — the content was replaced — and
  the reload recovery shows the new content.

---

## Sources & Research

- Prior plan / documented risk: `docs/plans/2026-06-28-001-fix-owner-live-cli-replacement-plan.md`
- Reset transition: `app/models/document.rb` (`replace_content!`, `try_claim_seed`)
- CRDT relay/persistence: `app/services/yjs_persistence.rb`, `app/channels/sync_channel.rb`
- Keepalive path: `app/controllers/documents_controller.rb#sync_update`
- Client provider + seed application: `app/frontend/editor/cable_provider.ts`,
  `app/frontend/editor/milkdown_editor.tsx`
- Seed grant on reload: `app/controllers/documents_controller.rb#show`, #118
