# Dogfood Report — feat/proof-clone (Pruf demo-polish pass)

**Date:** 2026-06-05 · **Branch:** `feat/proof-clone` · **Scope:** uncommitted demo-polish diff (12 modified + 2 new files, +544/−157) · **Server:** :3201 (live)

## Diff Summary

Seven-feature UX pass on the Pruf editor plus floating-UI scroll fixes:

1. **Google-Docs margin suggestions** — `app/frontend/components/margin_suggestions.tsx` (new), gutter layout in `show.tsx`, rail de-stickied (one scroll)
2. **Readable presence avatars** — `presence_bar.tsx` rewrite (28px initials stack, +N, agent ✦ avatars)
3. **Instant populated first paint** — `yjs_state_b64` prop (`documents_controller.rb`) hydrated via `Y.applyUpdate` before cable connect (`milkdown_editor.tsx`); Shiki warm at import
4. **Focus modes** — `⌘\` panel hide, `⌘.` suggestion focus; persisted (`pruf:panel` / `pruf:focus`)
5. **Session-scoped recents** — `session[:recent_slugs]` in show/create/index
6. **Homepage agent create-instruction** — copyable block in `index.tsx`
7. **Pruf rebrand** — display strings only (layout, manifest, theme labels, share invite, `agent_guide.rb`)
8. *(in flight)* **Anchored floating UI** — ReviewPopover/SelectionToolbar tracking their anchors through scroll

## Personas (inferred — no STRATEGY.md/VISION.md in repo)

- **The Writer** — drafts with AI; cares about a calm copy surface, trustworthy provenance, frictionless review
- **The Agent Operator** — wires agents in via API; cares about discoverability (share/home instructions), identity attribution
- **The Invited Collaborator** — opens a share link cold; cares about instant load and knowing who's here

## Flows Tested

### Flow B — Suggestion lifecycle (Writer × Agent Operator)
```mermaid
flowchart TD
    A[Agent POSTs suggestion w/ anchor_text] --> B[Margin card appears live, aligned w/ anchor]
    B --> C{Hover card}
    C --> D[Anchor highlight intensifies in copy]
    B --> E{Writer decision}
    E -->|Accept| F[Text merges at anchor, AI-tinted provenance]
    E -->|Reject| G[Card leaves, nothing inserted]
    F --> H[Card animates out; no double-fire]
    B --> I[⌘. focus mode] --> J[Cards collapse to markers; gutter narrows]
    J --> K[Toggle back: cards realigned]
```

### Flow C/D — Review + selection floating UI (Writer)
```mermaid
flowchart TD
    A[Click AI-tinted span] --> B[Review popover at span]
    B --> C[Scroll page] --> D{Popover tracks anchor?}
    D -->|Yes| E[Advance pending→reviewed→endorsed]
    A2[Select sentence] --> B2[Selection toolbar]
    B2 --> C2[Scroll] --> D2{Toolbar tracks?}
    B2 --> E2[Comment → anchored in panel → resolve]
```

### Flow E/F — Share & presence (Agent Operator × Collaborator)
```mermaid
flowchart TD
    A[Click Share] --> B[Popover: human link + agent invite]
    B --> C[Paste invite to agent] --> D[Agent fetches URL → Pruf guide]
    D --> E[Agent announces presence] --> F[✦ avatar + badge + 'active now' dot]
    G[Second human opens link] --> H[28px avatar joins stack + count]
```

### Flow A/G/H — First load, home, chrome
```mermaid
flowchart TD
    A[Cold open /d/slug] --> B{First paint populated?}
    B -->|Yes| C[CRDT converges invisibly]
    H1[Home, fresh session] --> H2[Empty state — zero foreign docs]
    H2 --> H3[Visit doc] --> H4[In MY recents only]
    H1 --> H5[Copy agent create-instruction] --> H6[Agent POST creates doc]
    C1[⌘\\ panel] --> C2[Copy recenters; persisted]
    C3[Theme → Whitey] --> C4[Cards/avatars/highlights coherent]
```

## Test Matrix & Results

| # | Scenario | Persona | Status |
|---|----------|---------|--------|
| A1 | Cold load — instant populated paint, no console errors | Collaborator | **Pass** — populated at first observable frame (178ms post-nav, 1249 chars); console clean |
| B1 | Agent suggestion → margin card aligned with anchor | Operator | **Pass** — verified live twice (Playwright + agent-browser); card lands at its anchor, ✦ author chip |
| B2 | Nearby suggestions stack without overlap | Writer | **Pass** — y=644 h=169 → next at y=823, zero overlap |
| B3 | Hover highlights anchor; click scrolls to it | Writer | **Pass** — sug-anchor-hot registers on hover; click jumps |
| B4 | Accept merges AI-attributed, no double-fire | Writer | **Pass** — Pruf-rebrand suggestion accepted end-to-end via real UI; CRDT merged once, 303 |
| B5 | Reject discards cleanly | Writer | **Pass** — PATCH reject confirmed, nothing inserted |
| B6 | Focus mode markers ↔ cards | Writer | **Pass** — 10px markers in 32px gutter, aligned; cards return |
| B7 | One scroll surface | Writer | **Pass** — card and copy co-travel 400px; no inner scrollbars |
| C1 | Review popover tracks scroll + advances states | Writer | **Pass (after fix)** — tracked 250px scroll exactly; Endorse advanced live |
| D1 | Selection toolbar tracks scroll; comment flow | Writer | **Pass (after fix)** — toolbar moved 300px with text |
| E1 | Share popover: link + agent invite + live state | Operator | **Pass** — Copy link + Copy agent invite; “✦ 1 active now” green dot with live agent |
| E2 | Dual-audience URL, Pruf-branded guide | Operator | **Pass** — guide says Pruf; title Pruf; JSON guide OK |
| F1 | Avatars: two clients + distinct agent | Collaborator | **Pass** — AL/AK initial avatars + “3 here”; agent as dashed-ring ✦ + chip |
| G1 | Session-scoped recents + empty state | Collaborator | **Pass** — two-cookie-jar proof + regression test |
| G2 | Homepage agent create-instruction works | Operator | **Pass** — block + Copy verified visually; POST per instruction created a doc |
| H1 | Panel hide recenters + persists | Writer | **Pass** — persisted across reload |
| H2 | Whitey coherence across new UI | Writer | **Pass** — cards/highlights/avatars/popover restyle to blue family |
| H3 | ~900px degradation | Collaborator | **Pass** — scrollWidth=900, gutter+rail hide cleanly |

## What Was Fixed

1. **Frozen floating UI (user-reported)** — ReviewPopover/SelectionToolbar stored birth coordinates; now store anchor identity only, re-derive geometry per render with rAF-throttled scroll/resize listeners; hide when the anchor leaves viewport. (`show.tsx`)
2. **Live updates dying with HTTP 500 (found while dogfooding)** — two simultaneous Inertia partial reloads raced `ViteRuby.digest`'s process-global `Dir.chdir` → `conflicting chdir during another chdir block` → 500 → error modal. Fixed with a Mutex-serialized `safe_vite_digest` (`inertia_controller.rb`) + batching broadcast-triggered reloads into one `router.reload` (`use_meta_channel.ts`).
3. **302 redirects after non-GET (found via RoutingError in logs)** — `redirect_back` after PATCH/POST caused clients to replay `PATCH /d/:slug` → RoutingError. All 8 non-GET redirects now `status: :see_other`. **Regression test added** (`test/integration/redirect_status_test.rb`, also covers session-recents scoping + agent-fetch exclusion). Full suite: 72 runs, 0 failures.
4. **Restack jank** — margin cards animate `top` only after first placement (`is-placed` flag) so initial layout doesn't fly in.
5. **Data fixes** — seeded doc title + CRDT body H1 said "Proof": title via rails runner; the body H1 fixed *through the product itself* (agent-API replacement suggestion → accepted in the editor — the full loop as the fix).

## Paper Cuts (by persona)

| Paper cut | Persona | Severity | Status |
|-----------|---------|----------|--------|
| Demo copy drift: the "still awaits review — notice the tint" sentence got endorsed during testing, so its claim no longer matches its tint | Writer | Low | Deferred (review states are forward-only by design; needs re-seed or copy rewording) |
| Stale `pixel.png` ActiveStorage 404s from pre-reset uploads referenced by re-synced CRDT state | Writer | Low | Deferred (data; harmless broken thumbnails in old docs only) |
| Hover-hot highlight can sit on a slightly stale range during a concurrent remote edit until pointer re-enters | Writer | Low | Deferred (base highlights re-register; only the hover layer waits) |
| Margin cards can sit below the fold; a reader may not notice a new suggestion arrived off-screen | Writer | Med | Deferred — consider a subtle "1 suggestion below" affordance |

## Decisions for a Human

- None blocking. The "suggestion arrived off-screen" paper cut is a product call (indicator vs auto-scroll vs nothing).

## Learnings

1. **Inertia + Rails: every non-GET redirect needs `status: :see_other`** — a 302 after PATCH makes clients replay the method against the redirect target. Grep for `redirect_back`/`redirect_to` in mutation actions.
2. **`ViteRuby.digest` is not thread-safe in dev** (process-global chdir); any `inertia_config version:` calling it must serialize. Surfaces as intermittent 500s only under concurrent partial reloads — i.e., exactly when broadcasts fan out.
3. **Wiping a CRDT server-side doesn't wipe the doc** — connected clients re-sync their full state on reconnect. A true reset needs fresh slugs or coordinated client wipes.
4. **Floating UI must store anchor identity, not coordinates** — derive geometry at render; coordinates captured at open-time are stale one scroll later.
5. **Headless coordinate clicks below the fold silently no-op** — scrollIntoView before trusted clicks in browser automation (test-harness lesson, not app bug).

## Final Status

**READY** — 18/18 scenarios pass with screenshot/log/test evidence (21 Playwright captures in `/tmp/pruf-dogfood-*.png`, 4 agent-browser captures `/tmp/qa-*.png`). Full Rails suite green (72 runs / 0 failures), `tsc --noEmit` clean, `vite build` clean. Three real bugs found and fixed during dogfooding (frozen popovers, chdir-race 500s, 302-after-PATCH), one with a regression test. Deferred paper cuts listed above; none blocking.
