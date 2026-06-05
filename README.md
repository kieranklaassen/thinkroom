# Proof — a provenance-tracking collaborative editor

A working clone of [Proof](https://proofeditor.ai): an agent-native collaborative
markdown editor where every span of text knows who wrote it — a human or an AI —
and humans review AI contributions explicitly. Live CRDT collaboration over
ActionCable, reviewable suggestions, anchored comments, agent presence, and a
document-level provenance summary that updates as you type.

## Setup

```bash
bin/setup     # bundle + npm install, db:prepare, seeds the demo document
bin/dev       # Rails on :3000 + Vite dev server
```

Open **http://localhost:3000/d/demo** in two windows side by side: edits sync
live, AI spans render tinted, the provenance summary updates as you type.
Requires Ruby 3.4, Node 20+ (22+ for `script/sync_check.mjs`), SQLite.
`GEMINI_API_KEY` is optional — Ask AI falls back to canned passages without it.

## Architecture

**CRDT sync.** Each document is a Yjs doc. Clients relay binary Yjs updates
(base64 in JSON) through `SyncChannel` (`app/channels/sync_channel.rb`): on
subscribe the server transmits its merged state + state vector; the client
applies it and replies with everything the server is missing (sync step 2);
afterwards incremental updates broadcast to every subscriber, with echoes
filtered client-side by a connection id. The server blindly merges every
update into `documents.yjs_state` via **y-rb** (Rust yrs bindings) —
commutative, idempotent, no document-structure knowledge needed
(`app/services/yjs_persistence.rb`, per-document lock). Documents survive
restarts; late joiners get the full merged state. Awareness (cursors) rides
the same channel, relay-only, never persisted.

**Editor.** Milkdown (`@milkdown/react`, raw builder with commonmark + GFM
presets) bound to the Yjs doc through `@milkdown/plugin-collab`
(y-prosemirror underneath). Code blocks highlight via shiki. Seeding an empty
document happens client-side under a server-issued atomic claim (exactly one
client applies the markdown template; the collab plugin's empty-doc condition
double-guards the race).

**Provenance** is a single ProseMirror mark type with
`{kind: human|ai, author, state}` attrs. y-prosemirror stores marks as
formatting attributes on the shared Y.XmlText, so attribution travels with
the text through sync, copy/paste, and reload. A ProseMirror plugin
attributes newly typed text to the local author (skipping remote y-sync
transactions — the critical guard), pastes keep existing marks, and AI
insertions apply their marks explicitly. Review states
(pending → reviewed → endorsed) are mark-attr rewrites, so they sync like any
edit. Markdown serialization emits the marks as
`<span data-provenance …>` HTML (legal markdown; a remark transformer parses
them back), which is how the seeded demo ships pre-attributed AI spans.

**Suggestions live in the database, not the CRDT, until accepted.** Agents
and the AI propose; rows broadcast to a meta channel; every connected editor
partial-reloads just that prop. Accepting is local-first: the accepting
client inserts the proposed markdown into the Yjs doc carrying the AI
author's provenance marks (pending review), then reconciles with the server.
Rejecting discards. The UI path and the agent API share single entry points
(`Suggestion.propose!`, `Comment.post!`) — there is no side channel.

**Instant UI.** Inertia v3 throughout: `router.optimistic(cb).post/patch`
with automatic rollback for accept/reject/comment/resolve, partial reloads
(`only:`) driven by ActionCable meta events, lambda props on the document
page, cookie-painted themes with optimistic switching. The editor itself is
local-first by construction.

## yrb-actioncable findings

The task asked to try `y-rb_actioncable` first. Findings (gem 0.1.7,
Apr 2024):

- It **loads and runs on Rails 8.1** — `Y::Actioncable::Sync` includes
  cleanly and exposes the documented `sync_for` / `sync_to` / `load` /
  `persist` surface (verified in this app before replacing it).
- We chose a ~60-line manual relay instead, for reasons inherent to the gem's
  design: it keeps a **full server-side `Y::Doc` replica per subscription**
  (N subscribers = N replicas integrating every message), persists the
  **entire document state on every received message per subscriber**, leaves
  awareness handling server-side as a `TODO`, and its maintainer describes it
  as a proof of concept with a known message-loss issue
  ([yrb-actioncable#71](https://github.com/y-crdt/yrb-actioncable/issues/71))
  that hasn't been touched since 2024.
- We kept its **wire format** (`{ update: <base64> }` JSON) so the
  `@y-rb/actioncable` client could be swapped in, and we kept **y-rb itself**
  (actively maintained, precompiled natives) for all server-side merging.
  The relay constructs one ephemeral `Y::Doc` per merge/handshake instead of
  one per connection, and persists once per update under a per-document lock.

## The agent loop (curl walkthrough)

Everything a human can do in the editor, an agent can do over plain HTTP —
same models, same broadcasts, same provenance machinery. An agent handed
nothing but a share link finds its way in: fetching the share URL without a
browser UA returns a plain-text guide (browsers get the editor; the editor
HTML also embeds the same guide invisibly in a `<template id="agent-guide">`,
and `Accept: application/json` returns machine-readable state + endpoints).

```bash
# 1. Create a document, get its shareable slug
curl -s -X POST http://localhost:3000/api/docs \
  -H "X-Agent-Name: Scout" -H "Content-Type: application/json" \
  -d '{"title": "Field Notes", "markdown": "# Field Notes\n\nDay one."}'
# => { "slug": "U3m9qBQymg", "share_url": ".../d/U3m9qBQymg", "api": { ... } }

# 2. Cold discovery — fetch the share link the way an agent would
curl -s http://localhost:3000/d/U3m9qBQymg
# => "# Field Notes — agent guide … Send your display name in an
#     X-Agent-Name header … 1. Announce yourself … 3. Propose an edit …"

# 3. Announce presence (a labeled ✦ cursor + chip appear live in the editor)
curl -s -X POST http://localhost:3000/api/docs/U3m9qBQymg/presence \
  -H "X-Agent-Name: Scout" -H "Content-Type: application/json" \
  -d '{"status": "active", "location": "Day one"}'

# 4. Read full state: markdown, provenance spans, suggestions, comments
curl -s http://localhost:3000/api/docs/U3m9qBQymg -H "X-Agent-Name: Scout"

# 5. Propose an edit — it slides into every open editor, agent-attributed,
#    pending review. A human clicks Accept and the text lands in the doc
#    carrying "Scout" provenance, tinted until reviewed.
curl -s -X POST http://localhost:3000/api/docs/U3m9qBQymg/suggestions \
  -H "X-Agent-Name: Scout" -H "Content-Type: application/json" \
  -d '{"body": "## Day two\n\nThe survey continues.", "intent": "Add day two", "anchor_text": "Day one"}'

# 6. Comment on a selection
curl -s -X POST http://localhost:3000/api/docs/U3m9qBQymg/comments \
  -H "X-Agent-Name: Scout" -H "Content-Type: application/json" \
  -d '{"body": "Worth a map here.", "anchor_text": "Day one"}'

# 7. React to humans: poll events since your last ack, then ack
curl -s http://localhost:3000/api/docs/U3m9qBQymg/events/pending -H "X-Agent-Name: Scout"
curl -s -X POST http://localhost:3000/api/docs/U3m9qBQymg/events/ack \
  -H "X-Agent-Name: Scout" -H "Content-Type: application/json" -d '{"last_event_id": 42}'

# 8. Sign off (presence chip clears)
curl -s -X POST http://localhost:3000/api/docs/U3m9qBQymg/presence \
  -H "X-Agent-Name: Scout" -H "Content-Type: application/json" -d '{"status": "done"}'
```

Forgetting the identity header teaches the fix:

```json
{ "error": "Missing X-Agent-Name header.",
  "how_to_participate": "Send your agent's display name in an X-Agent-Name header on every request. That name becomes your identity everywhere…",
  "example": "curl -X POST …/suggestions -H \"X-Agent-Name: Scout\" …" }
```

This loop was run for real against the dev server (cold fetch → discover →
presence → suggest → comment → human accepts in the UI → event poll sees the
acceptance → sign off) and is also exercised end-to-end by
`script/browser_check.mjs`, which verifies the human-visible half: presence
chip, "Shared with agents · 1 active" badge, labeled pseudo-cursor at the
agent's work location, live agent-attributed suggestion/comment cards,
activity feed entries, and agent-attributed provenance after acceptance.

## Verification

```bash
bin/rails test                                        # 57 tests: models, services, channels, API, discovery
BASE_URL=http://localhost:3000 node script/sync_check.mjs     # two-client CRDT convergence proof
BASE_URL=http://localhost:3000 node script/browser_check.mjs  # 33 end-to-end browser checks (Playwright)
```

**Two-client sync check** (`script/sync_check.mjs`): two Node clients speak
the SyncChannel protocol with independent Yjs docs, make 40 interleaved
concurrent edits, and assert both replicas converge to identical state
vectors with zero lost edits (CRDT, not last-write-wins), then a late joiner
receives the full converged state from server persistence alone. Output from
the captured run:

```
✓ created test document 1FUiJJSzWj
✓ both clients completed the sync handshake
✓ edit from A propagated to B
✓ 40 concurrent edits from two clients converged with no loss
✓ state vectors identical — true CRDT convergence, not last-write-wins
✓ late-joining client received the full converged state from server persistence
```

**Browser check** (`script/browser_check.mjs`): two real Chromium windows —
live typing sync, reload persistence, markdown input shortcuts, seeded AI
tints, human attribution of typed text, live summary, Ask AI → suggestion →
accept → AI-provenance merge, comments with resolve, image paste through
Active Storage direct upload, instant + persistent theme switching, and the
full agent loop described above. All 33 checks pass.

## Design notes & critique pass

The document is the hero: editorial serif measure (~44rem), a header that
carries only title, status, summary, presence, theme, and share. Provenance
styling is deliberately quiet — pending AI text gets a soft tint and
underline, reviewed softens it, endorsed fades to a whisper of an underline;
human text is unmarked (absence of decoration is the design). Two themes
share one token system: **Proof** (warm paper, Charter serif) and **Whitey**
(an homage to Typora's Whitey: pure white, quiet sans, generous measure,
blue accent), switchable instantly and persisted via cookie + localStorage so
the server paints the right theme on first byte.

The required critique pass (hierarchy, spacing, alignment, states, motion
across every surface) changed: lifted the agent pseudo-cursor label off the
text line (ring + shadow + pill, entrance animation) where it previously
collided with ascenders; added visible `:focus-visible` rings to every
interactive control; added `prefers-reduced-motion` support; separated rail
sections with hairlines; gave suggestion cards a leave-transition before
optimistic removal; unified empty states (calm, instructive copy) for
suggestions, comments, and activity.

## Inertia Rails skills audit

`npx skills add cole-robertson/inertia-rails-skills` was installed (committed
under `.agents/skills/`) and the app audited against
`inertia-rails-best-practices`, `-forms`, `-performance`, and `-testing`.
Findings and fixes are recorded in
[docs/REVIEW-NOTES.md](docs/REVIEW-NOTES.md).

## Known limits

- The share-link is the trust model (like Proof's slug links): no accounts;
  anyone with the slug can edit. Agent identity is honor-system via header.
- The server-readable markdown/spans snapshot is pushed by connected editors
  (debounced); if nobody has the doc open, API reads serve the last snapshot
  (or the seed markdown for never-opened docs). The Yjs binary state is
  always authoritative for sync.
- Dev runs single-process (async cable adapter + in-process seed locks);
  production would want Redis/AnyCable and the same relay holds.
