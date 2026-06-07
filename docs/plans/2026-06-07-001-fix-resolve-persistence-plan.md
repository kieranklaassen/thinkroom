---
title: "fix: Accept/reject/resolve must persist — no silent reappear-on-refresh"
type: fix
status: completed
date: 2026-06-07
---

# fix: Accept/Reject/Resolve Must Persist — No Silent Reappear-on-Refresh

## Summary

User-reported bug: accepting or rejecting a card makes it disappear, but refreshing the page brings it back — the optimistic UI claims success while the server state never changed. Reproduce the failure across the three resolve flows (server-row suggestion accept/reject, comment resolve, inline tracked-edit accept/reject), fix the confirmed cause(s), and make every resolve flow either persist or *visibly* fail — never silently lie.

---

## Problem Frame

A card that reappears after refresh means the database row is still `pending`/unresolved (`documents#show` serves `suggestions.pending` and comments with a derived `resolved` flag), so the PATCH or Yjs update never landed. Code reading surfaces three concrete defects and one fragile window, any of which produces the reported symptom:

1. **Unguarded optimistic comment resolve.** A freshly posted comment renders optimistically with a negative id (`-Date.now()`, `app/frontend/pages/documents/show.tsx`). Suggestion margin cards hide their Accept/Reject buttons until the real id arrives (`suggestion.id > 0` gate, plus an `id < 0` guard in the handlers); the comments panel has **neither** — clicking Resolve on a not-yet-reconciled comment PATCHes `/comments/-1786…/resolve`, a guaranteed `RecordNotFound`.
2. **`comments#resolve` 404s raw.** `CommentsController#resolve` has no `RecordNotFound` rescue — unlike `SuggestionsController#set_suggestion`, which redirects back cleanly. A stale card (comment deleted, doc deleted) or the negative-id PATCH above raises a 404 through Inertia.
3. **No failure reconciliation on optimistic flows.** `acceptSuggestion`, `rejectSuggestion`, and `resolveComment` chain `router.optimistic(...).patch(...)` with `onSuccess` only. Whether Inertia v3 auto-reverts optimistic mutations on a failed/errored response must be verified against the installed package — if it does not (or does not for 404/500 with `async: true` partial reloads), the card stays hidden client-side while the server still has it pending: the exact reported symptom.
4. **Inline tracked-edit drop window.** Inline accept/reject is a local ProseMirror transaction synced via Yjs. `CableProvider.handleDocUpdate` drops local updates while `!synced`; they are only re-sent at the next reconnect handshake (`sync-reply`). Accept → refresh before the handshake = the resolve never reached the server, and the tracked edit reappears. Two amplifiers make this window user-reachable: (a) the known main-thread wedge in Shiki tokenization (documented in PR #15's residuals) can block the cable send for 30+ seconds — exactly the situation where a user refreshes; (b) `useMetaChannel` (`app/frontend/lib/use_meta_channel.ts`) fires debounced background `router.reload({ only, async: true })` on every broadcast, and its own comment flags the optimistic-mutation interplay as load-bearing — a background reload racing an in-flight optimistic PATCH is a candidate clobber path U1 must check rather than assume safe.

Defect 1 also explains why the report says "comment": post a comment, immediately resolve it — the PATCH 404s against the optimistic id, the comment hides locally, and refresh resurrects it.

---

## Key Technical Decisions

- **Reproduce first, then fix what reproduces.** Multiple candidate causes share one symptom. U1 instruments and bisects before any fix; U2–U4 fix the confirmed cause(s) and harden the adjacent defects that are cheap and clearly correct regardless (the negative-id guard and the missing rescue are defects even if not the user's exact repro).
- **Settle Inertia v3 optimistic semantics from the installed source, not assumption.** Read `node_modules/@inertiajs/core`'s optimistic implementation to determine rollback-on-error behavior. If rollback is automatic, failure reconciliation needs only error surfacing; if not, each resolve flow adds explicit `onError` reconciliation (e.g., `router.reload({ only: [...] })` so the UI reconverges with server truth).
- **Mirror existing guards rather than inventing new machinery.** Comments adopt the exact patterns suggestions already use: action gating for optimistic rows, `RecordNotFound` rescue with `redirect_back` + Inertia error. No new abstractions.
- **The UI may fail, but must not lie.** The fix standard for every flow: success persists across refresh; failure visibly restores the card in-session. Silent divergence between client and server state is the bug class being eliminated, not just this instance.

---

## Requirements

**Persistence**

- R1. Accepting or rejecting a server-row suggestion persists: after a hard refresh the card does not return (DB row left `accepted`/`rejected`).
- R2. Resolving a comment persists: after a hard refresh the comment stays resolved.
- R3. Accepting or rejecting an inline tracked edit persists across an immediate refresh in the normal connected case. The disconnected-window boundary is U1's to characterize: U1 reports whether the drop window reproduces and is user-visible; the behavior is then documented in U4 (script comment or plan note) — it is not regression-tested unless U1 shows it reproduces cheaply.

**Failure honesty**

- R4. A resolve/accept/reject whose server request fails does not leave the UI pretending success — the card visibly returns in-session (rollback or reconciliation reload) rather than staying hidden until refresh.
- R5. The comments panel cannot fire a resolve PATCH for an optimistic (negative-id) comment — the action is hidden or disabled until the server id arrives, matching the suggestion-card pattern.
- R6. `comments#resolve` handles a missing comment gracefully (redirect back with an Inertia error), parity with `suggestions#set_suggestion`; no raw 404 modal over the editor.

**Coverage**

- R7. Rails integration tests cover the new failure paths; a browser-check scenario proves refresh-persistence for accept and resolve end-to-end.

---

## Implementation Units

### U1. Reproduce and diagnose the reappear-on-refresh

**Goal:** Confirm which flow(s) actually reproduce the user's symptom and capture the failing request/response or dropped update as evidence.

**Requirements:** R1, R2, R3 (diagnosis feeds all)

**Dependencies:** none

**Files:**
- `tmp/` throwaway Playwright probes (not committed)
- Reading: `app/frontend/pages/documents/show.tsx`, `node_modules/@inertiajs/core/dist/*` (optimistic semantics), `app/frontend/editor/cable_provider.ts`

**Approach:** Drive each flow against a local server with network/console capture and DB inspection between steps: (a) server-row suggestion accept and reject → check `suggestions.status` in DB → reload page; (b) post comment → resolve immediately (optimistic id window) and after reconciliation → check `resolved_at` → reload; (c) inline tracked edit accept → immediate reload; accept-during-brief-disconnect if cheaply simulable; (d) the broadcast race — a `useMetaChannel`-triggered background reload landing while an optimistic PATCH is in flight (e.g., a second client proposing a suggestion mid-accept) must not clobber the optimistic removal or resurrect the card. While here, read the installed Inertia source to settle the optimistic rollback question (KTD). Record which paths reproduce and the exact failing mechanism.

**Execution note:** Reproduce-first — no fixes in this unit; its output is the confirmed defect list driving U2–U4 scope.

**Test scenarios:** Test expectation: none — diagnostic unit; permanent coverage lands in U2–U4.

**Verification:** A short written diagnosis (in the ce-work session) naming reproduced flow(s) with evidence (HTTP status, DB state, or dropped-update trace), plus a definitive statement of Inertia v3's optimistic revert behavior across response classes (2xx redirect, 4xx, 5xx, network error) backed by installed-source citations — U3's branch choice depends on it being unambiguous.

### U2. Server hardening: comments#resolve parity

**Goal:** `comments#resolve` never 404s raw and never silently diverges — missing rows redirect back with an Inertia error, like suggestions.

**Requirements:** R6, R7

**Dependencies:** U1 (confirms shape; this lands regardless — the defect is real independent of the repro)

**Files:**
- `app/controllers/comments_controller.rb`
- `test/integration/comment_flow_test.rb`

**Approach:** Add a `RecordNotFound` rescue mirroring `SuggestionsController#set_suggestion` (redirect_back, `inertia: { errors: { comment: "is no longer available" } }`). Keep `resolve!` idempotent semantics (resolving an already-resolved comment is a no-op update, acceptable as-is).

**Patterns to follow:** `app/controllers/suggestions_controller.rb` `set_suggestion` rescue; existing assertions in `test/integration/comment_flow_test.rb`.

**Test scenarios:**
- Happy path: PATCH resolve on an open comment → 303 redirect, `resolved_at` set.
- Error path: PATCH resolve with a nonexistent id (e.g., `-42`) → 303 redirect back (not 404), no exception, errors bag carries the comment message.
- Edge: PATCH resolve twice → second succeeds idempotently (or remains a clean no-op), `resolved_at` unchanged semantics documented by the assertion.

**Verification:** New integration tests pass; full `bin/rails test` green.

### U3. Client guards and failure reconciliation for optimistic resolve flows

**Goal:** Optimistic comment rows can't fire premature resolves, and every optimistic resolve flow (suggestion accept/reject, comment resolve) visibly reconverges with server truth on failure.

**Requirements:** R1, R2, R4, R5

**Dependencies:** U1 (Inertia rollback semantics determine the reconciliation shape)

**Files:**
- `app/frontend/components/comments_panel.tsx` (hide/disable Resolve while `comment.id < 0`)
- `app/frontend/pages/documents/show.tsx` (`resolveComment` id guard; `onError` reconciliation on `acceptSuggestion`, `rejectSuggestion`, `resolveComment` per the U1 finding)

**Approach:** Mirror the suggestion-card optimistic gating for comments. For failure reconciliation: if U1 shows Inertia auto-reverts optimistic state on error, keep that and ensure the revert is reachable on the 303-with-errors path too; if not, add `onError` handlers that reload the affected props (`only: ['comments']` / `['suggestions']`) so a failed resolve restores the card in-session. Do not add toast infrastructure — the card visibly returning is the honest signal this codebase's patterns support today.

**Patterns to follow:** `margin_suggestions.tsx` optimistic-id action gating (`suggestion.id > 0`); existing `router.optimistic(...).patch(...)` call shape in `show.tsx`.

**Test scenarios:**
- Happy path: resolve a reconciled comment → card moves to resolved; refresh → stays resolved (also exercised end-to-end by U4's script).
- Edge: comment still optimistic (negative id) → Resolve affordance absent/disabled; after reconciliation it appears and works.
- Error path: force a failing resolve (nonexistent id via a stale card, or stubbed route in the probe) → the card returns to the open list in-session; no silent hidden-but-unresolved state.
- Integration: suggestion accept with server failure (already-accepted race: accept the same suggestion from two windows) → loser's card state reconverges (card clears because the row is genuinely non-pending — verify the winner's accept persisted and no duplicate insert).

**Verification:** `npm run check` green; manual probe of the forced-failure path shows the card returning in-session. (End-to-end refresh-persistence proof lands in U4, which depends on this unit.)

### U4. Refresh-persistence regression coverage

**Goal:** Executable proof that resolve actions survive refresh, in the repo's browser-check style, covering the inline tracked-edit path too.

**Requirements:** R1, R2, R3, R7

**Dependencies:** U2, U3

**Files:**
- `script/browser_check.mjs` (extend: refresh-persistence section)

**Approach:** Fresh doc via `POST /api/docs`; seed a server-row suggestion via the agent API. Scenarios: (a) accept suggestion → wait for reconcile → `page.reload()` → card absent; (b) reject → reload → absent; (c) post comment → wait for positive id (resolve affordance present) → resolve → reload → comment not in open list; (d) suggest-mode tracked insertion → accept inline → `page.reload()` immediately after the doc update settles → text retained without `ins` marks. Follow existing `ok`/`fail` conventions. For R3's disconnected-window boundary: document (comment in the script or plan note) rather than simulate if ActionCable disconnect simulation proves disproportionate.

**Patterns to follow:** existing suggest-mode and comment-flow sections in `script/browser_check.mjs`.

**Test scenarios:** the script is the enumeration (a–d above); each asserts post-reload server-truth state.

**Verification:** `node script/browser_check.mjs` placement + persistence sections exit 0 against a local server.

---

## Scope Boundaries

**In scope:** the three resolve flows' persistence and failure honesty; the two parity defects (comment guard, controller rescue); regression coverage.

**Non-goals:**
- Toast/notification infrastructure for error display — the card visibly returning is the failure signal; richer error UX is product work beyond this fix.
- Reworking the CableProvider offline queue (buffering local updates while `!synced` beyond the existing handshake re-send) — only verify and document the boundary; a full offline story is its own feature.
- Comment threads/replies, suggestion UI changes — untouched.

**Deferred to Follow-Up Work:**
- A `beforeunload`-style flush or pending-update indicator when local Yjs updates haven't reached the server (surfaced by R3's boundary documentation if the window proves user-visible in practice).

---

## Sources & Research

- Optimistic flows and negative-id pattern: `app/frontend/pages/documents/show.tsx` (`acceptSuggestion`, `rejectSuggestion`, `resolveComment`, `submitComment`).
- Guarded counterpart: `app/frontend/components/margin_suggestions.tsx` (`suggestion.id > 0` action gate, `resolving` set).
- Unguarded panel: `app/frontend/components/comments_panel.tsx` (Resolve button, no id gate).
- Server flows: `app/controllers/suggestions_controller.rb` (rescues present), `app/controllers/comments_controller.rb` (`resolve` lacks rescue), `app/models/suggestion.rb` (`transition!` raises on non-pending), `app/models/comment.rb` (`resolve!`).
- Page props refresh-truth: `app/controllers/documents_controller.rb#show` (`suggestions.pending`, comments with derived `resolved`).
- Yjs sync boundary: `app/frontend/editor/cable_provider.ts` (`handleDocUpdate` drops while `!synced`; `sync-reply` re-sends on handshake).
- Prior 500-race note relevant to silent failures: `app/controllers/inertia_controller.rb` (`safe_vite_digest` comment).
- Inertia versions in play: `@inertiajs/react` 3.3.1, `inertia_rails` 3.21.1 — optimistic rollback semantics to be verified from installed source (U1).
