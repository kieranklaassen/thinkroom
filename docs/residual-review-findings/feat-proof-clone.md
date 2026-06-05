# Residual Review Findings

Source: ce-code-review run `20260605-110954-461a39e5` (artifacts under
`/tmp/compound-engineering/ce-code-review/20260605-110954-461a39e5/`), branch
`feat/proof-clone`, head `4b5406e`. The review applied 18 validated findings
(`fix(review): apply review findings`); the items below are the actionable
residuals that did not meet the autonomous apply bar (anchor-75 without
cross-persona agreement, design-input required, or new API surface).

No tracker sink was available (repo has no git remote, so GitHub Issues and a
PR body are unreachable; no tracker is documented). This committed file is the
durable record.

## Residual Review Findings

- **P2** `app/services/yjs_persistence.rb:42` — Corrupt stored yjs_state blob bricks every subscribe permanently. Fix shape: rescue y-rb sync failures in `load_ydoc`, log, degrade to empty doc (connected clients re-upload via sync-reply). *(validated; single-persona anchor-75)*
- **P2** `app/channels/sync_channel.rb:36` — No payload-size cap on WebSocket updates (HTTP snapshot path caps at 2 MB; cable path is unbounded). Fix shape: drop update/sync-reply frames over ~1 MB. *(validated; single-persona anchor-75)*
- **P2** `app/controllers/documents_controller.rb:31` — `comments` prop loads all comments unbounded on every render/partial reload. Fix shape: open comments in full + `resolved.order(resolved_at: :desc).limit(20)`. *(validated; negligible at demo scale)*
- **P2** `app/models/agent_presence.rb:25` — Presence broadcasts fire on every authenticated agent call even when nothing changed; a polling agent causes a client reload per poll. Fix shape: broadcast only on `newly_arrived` or `saved_change_to_status?/location_text?`. *(validated)*
- **P2** `app/frontend/pages/documents/show.tsx:155` — Selection toolbar / review popover are `position: fixed` with coords captured once; they drift when the user scrolls with a selection active. Fix shape: store doc positions and compute coords at render, or recompute on passive scroll/resize. *(validated)*
- **P2** `app/controllers/comments_controller.rb:22` — `resolve` duplicates the activity+broadcast pattern that `Comment#resolve!` should own (mirror `Suggestion#transition!`). *(single-persona anchor-75)*
- **P2** `app/frontend/components/suggestions_panel.tsx:34` — Leave-animation `setTimeout` not cleared on unmount; navigating away mid-animation fires accept/reject on a dead page. Fix shape: track timers in a ref, clear in unmount effect.
- **P2** `app/frontend/editor/milkdown_editor.tsx:160` — Snapshot push failures silently swallowed (`.catch(() => {})`); agent API staleness has no signal. Fix shape: `console.warn` + one retry.
- **P2** `app/services/agent_guide.rb:57` — Guide says X-Agent-Name is required on every request, but `POST /api/docs` allows anonymous creation. Decision needed: require the header on create, or soften the guide note. *(human judgment)*
- **P2** `app/frontend/entrypoints/application.css:1` — 1137-line monolithic stylesheet; split along existing section comments into tokens/layout/editor/components. *(human taste; organizational only)*
- **P3** `app/controllers/api/base_controller.rb:21` — Unbounded `X-Agent-Name` (and author_name params) flow verbatim into provenance marks, presence chips, and the activity feed. Fix shape: clamp to ~80 chars at the boundary + column length validations.
- **P3** `app/services/yjs_persistence.rb:12` — `LOCKS` map grows one Mutex per document id, never evicted. Fix shape: explanatory comment or small LRU.
- **P3** `test/integration/suggestion_flow_test.rb:37` — Double-resolve test doesn't assert the Inertia error props payload.
- **P3** `app/services/agent_guide.rb:37` — (Addressed in notes, kept for endpoint description) `state` endpoint description could also point agents at `plain_markdown`.
- **P3** `app/frontend/editor/cable_provider.ts:76` — `as never` casts in the listener map; type as `{ synced: Set<() => void>; seed: Set<() => void> }`.
- **P3** `app/frontend/pages/documents/show.tsx:291` — `copyShareLink` timer not cleared on unmount/re-click.

## Agent-native parity follow-ups

- No API endpoint to resolve comments (`PATCH /api/docs/:slug/comments/:id/resolve` calling `Comment#resolve!` + an AgentGuide entry) — clean parity win, new API surface so deferred for design sign-off.
- Accept/reject suggestions over the API: deliberately human-gated today (documented in AgentGuide notes); adding API accept would need the CRDT-merge caveat (a connected editor client must apply the text).
- Image upload flow (Active Storage direct upload) works for agents but is undocumented in AgentGuide.

## Validator-rejected findings (recorded for context, no action)

- Gemini call synchronous in-request (P1 claim): overcalibrated for the documented single-process demo topology; ActiveJob fix unsafe without a queue backend. Tracked as residual risk in the review artifact.
- Removing `with_lock` from `YjsPersistence.merge`: harmful — the row lock is the only cross-process guard.
- Snapshot endpoint forging: CSRF-protected and advisory-by-design (Yjs state is authoritative).
