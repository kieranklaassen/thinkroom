---
title: "feat: Set your display name — session-stored, random names become guest mode"
type: feat
status: completed
date: 2026-06-05
---

# feat: Set Your Display Name — Session-Stored, Random Names Become Guest Mode

## Summary

Everyone is currently a random "Quiet Falcon" forever. This plan adds a way to say who you are: an identity chip in the editor header shows your current name, click it to type your real one. The name stores in the Rails session and wins over the random localStorage identity everywhere new attribution happens — presence cursors, comments, suggestion resolutions, doc ownership. No name set = **guest mode**: the random name, visibly marked as guest. Clearing your name returns you to the same guest identity.

## Problem Frame

Identity today is a random adjective+animal minted client-side (`app/frontend/editor/identity.ts`, localStorage `proof:identity`) and used for everything: Yjs awareness labels, provenance mark authors, comment/suggestion attribution, and — since the ownership feature — claim/create owner names. There is no way to be "Kieran" instead of "Velvet Stoat". The user asked for the name to live in the session, making the random identity an explicit guest tier.

## Assumptions

Headless-mode inferred bets (pipeline run):

- **The Rails session is the store for chosen names** (`session[:display_name]`), per the user's "store to session". The random guest identity (name + color) stays in localStorage; **color always comes from localStorage** — choosing a name doesn't change your cursor color.
- **Setting the name is a CSRF-protected browser POST** (mirrors the claim endpoint's trust posture — drive-by requests can't rename you). Submitting an empty/whitespace name clears the session name → back to guest.
- **Rename applies live in-session** for presence (awareness label) and future attribution (provenance identity, comments, suggestions); text already attributed keeps its historical author name — renames are not retroactive.
- **Server prefers the session name** when stamping names on every browser-stack attribution write — create/claim ownership AND comments/suggestion resolutions — falling back to the client-posted name for guests. Other tabs pick up a rename on their next page load — no cross-tab live sync.
- **Names are self-asserted and unverified** — anyone with the share link can set any display name, including one resembling another participant. Accepted: it matches the share-link trust model (same boundary as ownership). No rate limiting on the rename endpoint either (CSRF-protected, session-scoped, no DB write).
- **Rider (user-requested in session):** the Pruf wordmark on the landing page becomes a link to `/`, so clicking the logo always goes home.

## Requirements

- R1. A user can set their display name from the editor header; new attribution everywhere uses it (presence label, comments, suggestion accept/reject, claim/create ownership).
- R2. The name persists in the Rails session — returning in the same browser keeps it without re-entering.
- R3. With no name set, the user is a guest: the existing random identity, visibly marked (e.g., "· guest") with an affordance inviting them to set a name.
- R4. Clearing the name (empty submit) returns to guest mode with the same random identity as before.
- R5. Names are normalized (strip, 255 cap — the `Document.normalize_owner_name` rule) and rendered only as text, never HTML.
- R6. Renaming mid-session updates the live presence label without a reload; GET requests never change the stored name.
- R7. The landing wordmark links to home.

## Key Technical Decisions

1. **`session[:display_name]` + `POST /identity`.** A tiny browser-stack endpoint (CSRF-protected like claim — KTD 2 of the ownership plan) writes the normalized name to the session; blank clears it. No model, no migration — the session cookie is the persistence the user asked for.
2. **`viewer` shared Inertia prop.** `inertia_share viewer: -> { ... }` in `app/controllers/inertia_controller.rb` (the file already documents this exact hook) exposes `{ name, guest }` to every page — index and show both need it, and shared data avoids per-action wiring. Reload after rename scopes to `only: ['viewer']`.
3. **Client precedence: server name > localStorage random.** `userIdentity()` gains an optional server-name argument: when present, it overrides the stored random name but keeps the stored color. The localStorage record itself is never overwritten by a chosen name — clearing the session name falls back to the unchanged guest identity (R4 for free).
4. **Live rename is imperative, not editor-recreating — and confirmed feasible.** The provenance writer reads `provenanceIdentityCtx` freshly inside every `appendTransaction`, and `EditorHandle` already exposes `editor` and `provider`; so `handle.editor.action(ctx => ctx.set(provenanceIdentityCtx.key, { name }))` + `handle.provider.awareness.setLocalStateField('user', ...)` covers both live surfaces with no editor teardown (the session effect keys on `[loading, slug]`; identity changes cannot recreate it). **Rename applies on POST success, not optimistically**: awareness and provenance are live Yjs/ctx side effects Inertia's optimistic rollback can't touch — applying them in `onSuccess` (one round-trip of label lag) avoids the failed-write divergence where this tab signs the new name while the session (and therefore create/claim stamping) keeps the old one. On error: input stays open with an inline retry message.
5. **Server stamps the session name on every browser attribution write.** Not just `documents#create`/`#claim` — also `comments#create` (`author_name`), `comments#resolve` (`by`), and `suggestions#accept`/`#reject` (`by`): `session[:display_name].presence || params[...]`. Otherwise a stale tab resolves comments as "Quiet Falcon" while the same session claims docs as "Kieran" — split identity in one activity feed. Clients keep posting their name as the guest fallback.

## Implementation Units

### U1. Session identity endpoint + viewer prop + server-side name preference

**Goal:** The session stores a chosen display name; every Inertia page knows the viewer's name/guest state; ownership stamping prefers it.
**Requirements:** R2, R4 (server half), R5, R6 (GET-never-mutates).
**Dependencies:** none.
**Files:** `config/routes.rb`, `app/controllers/identities_controller.rb` (new), `app/controllers/inertia_controller.rb`, `app/controllers/documents_controller.rb`, `app/controllers/comments_controller.rb`, `app/controllers/suggestions_controller.rb`, `app/models/document.rb`, `config/initializers/filter_parameter_logging.rb`, `test/integration/identity_flow_test.rb` (new).
**Approach:** `post "identity" => "identities#update"`. `IdentitiesController < InertiaController` must **not** reuse `Document.normalize_owner_name` (its "Anonymous" fallback would store "Anonymous" instead of clearing — breaking guest-mode return). Add `Document.normalize_display_name(raw)` → strip, 255 cap, `nil` for blank (and re-express `normalize_owner_name` as `normalize_display_name(raw) || "Anonymous"`); blank → `session.delete(:display_name)`, else store; redirect back 303 (mirrors claim). `inertia_share viewer: -> { { name: session[:display_name], guest: session[:display_name].blank? } }` in `InertiaController` (KTD 2). Session-name preference (`session[:display_name].presence || params[...]`) lands in `documents#create`/`#claim` AND `comments#create`/`#resolve` AND `suggestions#accept`/`#reject` (KTD 5). Add `:name` to `config/initializers/filter_parameter_logging.rb` — chosen names are PII and shouldn't land in production logs.
**Patterns to follow:** claim endpoint shape in `app/controllers/documents_controller.rb` (browser-stack POST, redirect_back 303); `inertia_share` comment in `inertia_controller.rb`.
**Test scenarios:** POST identity with a name → subsequent GET serves `viewer.name` set and `guest: false`; name persists across requests in the same session; POST with blank/whitespace → viewer back to guest (and the session key is actually gone — not "Anonymous"); name longer than 255 truncated; HTML in the name arrives intact in the prop as a plain JSON string (no server-side interpretation) — and is capped; GET never sets or changes the name; with session name set, `documents#create` stamps it as `owner_name` regardless of `params[:name]`; claim stamps session name over params; a comment created and a comment resolved by a named user carry the session name over params; suggestion accept/reject resolved_by and activity actor use the session name; guest (no session name) keeps every params fallback path; claim activity detail uses the same resolved name.
**Verification:** integration tests green; curl POST without CSRF token is rejected (covered by stack, same as claim).

### U2. Client identity precedence + live rename plumbing

**Goal:** The chosen name flows into every client-side attribution surface; renames apply live without recreating the editor.
**Requirements:** R1, R3 (precedence half), R6.
**Dependencies:** U1.
**Files:** `app/frontend/editor/identity.ts`, `app/frontend/pages/documents/show.tsx`, `app/frontend/editor/milkdown_editor.tsx`, `app/frontend/pages/documents/index.tsx`.
**Approach:** `userIdentity(serverName?)` — server name overrides stored random name, color always from the stored guest identity (KTD 3). `show.tsx`: identity becomes **initializer-only state** (`useState(() => userIdentity(viewer.name))`) plus the explicit rename handler — not a sync-on-prop-change effect, which a future reload batch listing `viewer` would silently clobber mid-rename. The rename handler runs in the POST's `onSuccess` (KTD 4): set state, `handle.provider.awareness.setLocalStateField('user', ...)`, `handle.editor.action(ctx => ctx.set(provenanceIdentityCtx.key, { name }))`. Existing `identity.name` consumers (suggestion accept/reject `by`, comment `author_name`, OwnershipChip `claimerName`) read the updated state automatically. Filter self out of the PresenceBar peers (`show.tsx` awareness loop, by `doc.clientID`) — the IdentityChip now represents you, and a duplicate self-avatar next to it is noise. **Audit step:** confirm `@milkdown/kit/plugin/cursor` builds remote cursor labels with `textContent`-safe APIs (not innerHTML) before relying on R5 for awareness-sourced names; if it uses innerHTML, sanitize the name before `setLocalStateField`. `index.tsx`: `useForm` initializer prefers `viewer.name` (guests keep posting the random name as fallback — the server prefers session anyway per U1).
**Patterns to follow:** existing identity prop threading in `show.tsx`/`milkdown_editor.tsx`; `acquireSession` awareness wiring.
**Test scenarios:** Test expectation: none in Ruby — client behavior; covered by U1's server tests plus browser verification: rename mid-session → cursor label in a second window updates within a beat; a comment posted after rename carries the new name; text typed after rename attributes to the new name; reload keeps the name; own avatar no longer duplicated between chip and presence bar.
**Verification:** two-window browser pass per scenarios above.

### U3. Identity chip UI + guest affordance + wordmark link

**Goal:** A visible, editable identity in the editor header; guests are invited to introduce themselves; the logo goes home.
**Requirements:** R1 (affordance), R3, R4 (UX half), R7.
**Dependencies:** U1, U2.
**Files:** `app/frontend/components/identity_chip.tsx` (new), `app/frontend/pages/documents/show.tsx`, `app/frontend/pages/documents/index.tsx`, `app/frontend/entrypoints/application.css`.
**Approach:** `IdentityChip` in the `doc-header-right` cluster (next to `PresenceBar`), chrome-toggle visual register, no modal — `OwnershipChip`'s inline-expand pattern with four states: *display* (avatar dot in your color + name, `max-width` ~12rem with ellipsis + full name in `title`, `cursor: pointer`, `aria-label="Set your display name — currently ‹name›"`), *guest display* (same + "· guest" suffix kept visible outside the truncation), *editing* (inline text input pre-filled with the current name — empty with placeholder "Your name" for guests — `maxLength` 80, Enter saves, Esc cancels, focus returns to the chip trigger on either), *saving/error* (input locked while the POST is in flight; on error the input stays open with an inline "Couldn't save — try again"). Save = `router.post('/identity', { name }, { only: ['viewer'], preserveScroll: true, async: true })` with the in-flight ref guard; the live identity side effects fire in `onSuccess` per KTD 4/U2; empty submit clears to guest. At ≤64rem the chip stays in the header in compact form (dot + tighter truncation); on focus, scroll the input into view so the soft keyboard doesn't occlude it. Landing page (`index.tsx`): wrap the wordmark in a `Link` to `/` (R7); optionally show the same chip on the landing under the actions — only if it drops in cleanly, otherwise editor-only.
**Patterns to follow:** `OwnershipChip` (inline expand, scoped POST, in-flight ref guard, error recovery); `chrome-toggle` CSS register.
**Test scenarios:** Test expectation: none in Ruby — presentational; browser verification: guest chip shows random name + guest marker; setting a name flips the chip and presence label; empty submit returns to the same random name; double-Enter doesn't double-POST (in-flight guard); a failed POST keeps the input open with the retry message and does NOT change the live cursor label; wordmark click navigates to `/`.
**Verification:** browser pass per scenarios; suite stays green.

## Scope Boundaries

**In scope:** everything above.

### Deferred to Follow-Up Work

- Cross-tab live name sync (other tabs update on next load only).
- Retroactive re-attribution of existing provenance marks/comments after rename.
- Showing the identity chip on the landing page if it doesn't drop in cleanly (editor-only is acceptable for v1).
- Agent-visible "humans present" names beyond what awareness already carries — no agent API changes in this plan.
- Account-grade identity (cross-device) — same boundary as the ownership plan.

## Risks & Dependencies

- **Editor stability on rename** — verified structurally safe: `useEditor` runs with `[]` deps and the collab session effect keys on `[loading, slug]`, so identity changes cannot tear down the CRDT session; renames apply imperatively via the existing handle (KTD 4). The two-window browser pass remains the guard against regressions here.
- **Two name stores could drift** (session name vs localStorage guest) — mitigated by precedence being one line (KTD 3) and by never writing chosen names into localStorage.
- **`viewer` shared prop on partial reloads** — verified: inertia_rails merges shared data into props before partial-reload filtering, so `only: ['viewer']` re-evaluates and delivers it. U1's tests assert it anyway.
- **Session cookie budget** — `display_name` (≤255 chars) joins `recent_slugs` and friends in the 4KB CookieStore cookie; comfortably under budget, but an overflow would drop the whole session silently. The 255 cap is the guard.
- **Awareness names bypass server normalization** — a modified client can put anything in the awareness stream regardless of U1; the U2 cursor-plugin audit (textContent vs innerHTML) is what actually protects peers, not the session normalization.
