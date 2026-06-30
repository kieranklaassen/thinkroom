---
title: "fix: Stale CRDT resurrects old content after CLI replacement"
type: fix
date: 2026-06-28
origin: "PR: Hard refresh does not fix stale browser after thinkroom update on claimed doc"
---

# fix: Stale CRDT resurrects old content after CLI replacement

## Summary

After `thinkroom update` replaces a claimed/live document, the browser keeps
showing the **old** content even after a hard refresh or in an incognito
window, while `thinkroom show --json` correctly returns the **new** content.

The CLI owner-replacement path (`Document#replace_content!`, added in #117/#118)
resets the live editor state — it sets `yjs_state` and `content_snapshot` to
`nil`, bumps the seed lifecycle back to `pending`, and stores the new source as
`seed_content` — so fresh page loads reseed the new source. It also broadcasts
`content_reset` so **connected** editors reload. That works for the clean
single-tab case.

The bug is the residual case: a browser session that still holds the
**pre-reset** Yjs document (a tab that was offline/backgrounded when the
`content_reset` broadcast fired, then reconnects; or any lingering session)
re-merges its old CRDT state into the server through the normal sync write
paths. Once `yjs_state` is non-`nil` again, `seed_stage?` is `false`, so every
later load — including incognito — hydrates the resurrected old CRDT instead of
reseeding the new source. `current_content` still reads `seed_content` (new),
which is why the API looks correct while the browser is stale.

## Reproduction (deterministic)

```ruby
doc = Document.create!(title: "Repro", seed_markdown: "# Seed", user: User.first)
old = Y::Doc.new; old.get_text("t") << "OLD LIVE CONTENT"
YjsPersistence.merge(doc, Base64.strict_encode64(old.full_diff.pack("C*"))) # live, yjs_state = OLD

doc.replace_content!(source: "# NEW FROM CLI")           # reset: yjs_state nil, seed_content NEW
YjsPersistence.merge(doc, Base64.strict_encode64(old.full_diff.pack("C*"))) # stale client re-syncs OLD

doc.reload
doc.current_content            # => "# NEW FROM CLI"   (API / thinkroom show)
ydoc_text_of(doc.yjs_state)    # => "OLD LIVE CONTENT"  (what the browser hydrates)
doc.seed_stage?                # => false               (so no reseed on refresh/incognito)
```

## Root cause

The Yjs persistence layer (`YjsPersistence.merge` / `persist_snapshot`, reached
via `SyncChannel` `sync-reply`/`update`, the `sync_update` keepalive, and the
`snapshot` push) has no concept of "this client's state predates a reset." A
client computes "everything the server is missing" relative to the server's
(now-empty) state vector and ships its **entire** old document; the server
cannot distinguish legitimately-missing new content from resurrected old
content, so it persists it.

## Fix

Add a monotonic **content generation** counter to `Document`, bumped on every
`replace_content!`. Editor clients learn the generation at page-load time
(Inertia prop), announce it when they connect (`SyncChannel` subscribe param)
and on the HTTP persistence requests (`snapshot`, `sync_update`). The server
**drops any CRDT/snapshot write whose announced generation is older than the
document's current generation**, so a pre-reset client can never resurrect the
stale state.

- The generation a client uses is fixed at page load and is **not** adopted
  from reconnect handshakes — a stale tab keeps announcing its old generation
  even after reconnecting, so its writes are reliably rejected.
- A stale client is told to reload: on a stale `SyncChannel` handshake (or a
  dropped stale write) the server transmits a `reset` signal that triggers the
  same `window.location.reload()` the `content_reset` broadcast uses. This
  self-heals the tab that missed the original broadcast.
- Absent generation (clients deployed before this change during a rollout) is
  treated as "no guard" so behavior is unchanged for them — matching the
  existing `seq`/rollout-compatibility conventions in `SyncChannel`.

## Implementation units

### U1. `content_generation` column + model bump
- `db/migrate/*_add_content_generation_to_documents.rb`: `integer, null: false, default: 0`.
- `Document#replace_content!`: bump `content_generation` inside the existing lock.
- `Document#content_stale?(generation)`: predicate used by the guard.
- Tests: `test/models/document_test.rb`.

### U2. Server-side generation guard (the data-integrity fix)
- `YjsPersistence.merge(..., generation:)` raises `Document::StaleContentError`
  when the caller's generation is behind the reloaded document.
- `YjsPersistence.persist_snapshot(..., generation:)` returns `false` when stale.
- `SyncChannel`: capture the client generation from subscribe params; pass it to
  `merge`; on a stale handshake or a dropped write, transmit `{ type: "reset" }`
  and never relay the stale frame.
- `documents#snapshot` / `documents#sync_update`: read `params[:gen]`, thread it
  to the persistence calls, and reject stale writes without broadcasting.
- Tests: `test/services/yjs_persistence_test.rb`, `test/channels/sync_channel_test.rb`.

### U3. Client threading + reset handling
- `documents#show` props: add `content_generation`.
- `documents/show.tsx`: pass `contentGeneration` into `DocumentEditor`.
- `milkdown_editor.tsx`: forward to `CableProvider`; include `gen` on the
  snapshot push.
- `cable_provider.ts`: send `gen` in the subscribe params and the `sync_update`
  body; handle an incoming `{ type: "reset" }` by emitting `reset`, wired to a
  full reload.

## Scope boundaries

- No change to non-owner conflict semantics or to how `replace_content!`
  computes the new source/attribution.
- No attempt to merge old and new content — replacement stays destructive by
  design.
- The guard is defense-in-depth at the single persistence chokepoint; it does
  not replace the `content_reset` broadcast (which remains the primary,
  immediate reload path for connected clients).

## Verification

- Deterministic persistence/channel tests prove a stale generation can no longer
  resurrect `yjs_state`/`content_snapshot`.
- Browser end-to-end: a live doc replaced via the CLI shows the new content on
  hard refresh and in incognito; a stale tab reloads to the new content.
