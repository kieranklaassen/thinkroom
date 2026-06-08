---
title: "fix: Preserve soft line breaks so metadata blocks render as separate lines"
type: fix
status: completed
date: 2026-06-07
---

# fix: Preserve soft line breaks so metadata blocks render as separate lines

## Summary

The document at https://pruf.example.com/d/1KytrvTXNj opens with a metadata block — `**Date:** …`, `**Source:** …`, `**Goal:** …` on consecutive lines — that renders as one run-on paragraph in the editor. The lines are separated by single newlines (CommonMark soft breaks), and Milkdown's mdast→ProseMirror conversion collapses them to spaces. Agent-authored markdown uses single newlines deliberately (this metadata-block shape tops nearly every plan/brainstorm doc agents share to Pruf), so Pruf should preserve them as visible line breaks — the behavior users know from Notion, Slack, Obsidian, and GitHub comments.

Fix: a small remark transformer (mirroring the repo's existing `$remark` plugins) that converts in-paragraph newlines in mdast `text` values into mdast `break` nodes, which the commonmark preset already renders as `hardbreak`. Then repair the already-damaged live document via the agent suggestion API.

---

## Problem Frame

**Observed:** On `/d/1KytrvTXNj`, the three metadata lines render as a single jumbled paragraph: "Date: 2026-06-07 Source: Analysis of all local agent transcripts … Goal: Reduce, sharpen…". Verified in a live browser session; the rendered `<p>` contains no `<br>` and no newline characters.

**Root cause (verified locally):**
- `remark` keeps soft breaks as literal `\n` inside mdast `text` node values (verified against the repo's installed remark: `'**Date:** x\n**Source:** y'` parses to text values ending in `"\n"`).
- Milkdown's mdast→ProseMirror conversion collapses those newlines to spaces when creating PM text nodes. The collapse happens at parse time, so it is baked into the Yjs CRDT state of every document seeded with soft-break markdown.
- No custom remark plugin currently runs that could intercept this (`provenanceParse` and `suggestParse` only handle HTML spans).

**Hard breaks already work:** the commonmark preset includes a `hardbreak` node schema mapped to mdast `break`. Verified round-trip against the installed remark: a `break` node stringifies as `\` + newline, and `a\` + newline + `b` re-parses to `[text, break, text]`. So converting soft breaks → `break` nodes at the mdast stage rides entirely on existing, working machinery.

**Two layers of damage:**
1. Code: every future parse (document seeding, suggestion acceptance — both use the same Milkdown parser context) collapses soft breaks.
2. Content: the live document's Yjs state already has the collapsed text persisted. A code fix cannot retroactively repair it; the content needs an edit.

---

## Requirements

- R1: Markdown with single-newline-separated lines inside a paragraph renders each line on its own visible line in the editor (seeding path).
- R2: The same preservation applies when a suggestion is accepted (suggestion-acceptance parse path shares the parser).
- R3: Round-trip stability — serializing the document (snapshot push, agent API reads) emits hard breaks as `\`-terminated lines that re-parse to the identical structure; no drift on repeated open/serialize cycles.
- R4: Code blocks, inline code, and other literal contexts are untouched (they hold content in `value` fields, not phrasing `text` children — the transformer must only touch phrasing text).
- R5: The live document `/d/1KytrvTXNj` gets a proposed repair of its metadata block via the agent suggestion API (`anchor_text` + `replaces` + hard-break body), reviewable by the owner in the editor.

---

## Key Technical Decisions

**KTD1 — Convert soft breaks to hard breaks globally at the mdast stage, via a custom `$remark` transformer.**
Alternatives considered:
- *CSS `white-space` fix*: dead end — the newlines are already gone from the PM doc (verified: rendered text contains no `\n`).
- *`remark-breaks` npm package*: does exactly this, but Milkdown bundles its own unified/remark versions; a custom ~25-line transformer following the existing `provenanceParse` pattern (`app/frontend/editor/provenance/remark.ts`) avoids any version-compat risk, matches repo conventions, and keeps the dependency surface flat.
- *Heuristic scoping (only "metadata-looking" blocks)*: rejected — magic-pattern detection is fragile, and global newline-preservation is the established product behavior of comparable editors. Agent-generated markdown does not hard-wrap prose, so the global rule has no practical downside in this corpus.

**KTD2 — Repair the live document through the designed agent flow (suggestion with `anchor_text`/`replaces`), not by mutating CRDT state server-side.** `Suggestion.propose!` is the single sanctioned entry point; acceptance keeps provenance marks correct and keeps a human in the loop. The proposal body uses explicit `\` hard breaks so it renders correctly even before the code fix deploys.

**KTD3 — No data migration for other existing documents.** The collapse is baked into per-document Yjs state; rewriting CRDT history server-side is high-risk and out of proportion. Existing docs heal only if their owners re-edit them; new docs are correct from seed.

---

## Implementation Units

### U1. Soft-break preservation remark transformer

**Goal:** Single newlines inside paragraphs survive parsing as `hardbreak` nodes.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** none.

**Files:**
- `app/frontend/editor/line_breaks.ts` (new) — the `$remark` transformer
- `app/frontend/editor/milkdown_editor.tsx` — register it in the plugin chain (alongside `provenance` / `suggestChangesMarks`, before the editor parses any content)

**Approach:** Walk the mdast tree visiting phrasing `text` nodes (children arrays only — never `value`-bearing literal nodes like `code`/`inlineCode`, which have no text children and are naturally skipped). For each text value containing `\n`, split and splice `{type: 'break'}` nodes between the segments, dropping a trailing newline at the end of a paragraph rather than emitting a dangling break. Mirror the structure and typing style of `provenanceParse` in `app/frontend/editor/provenance/remark.ts`. No serializer half is needed: the commonmark preset already stringifies `break` → `\` + newline.

**Patterns to follow:** `app/frontend/editor/provenance/remark.ts` ($remark transformer shape, MdastNode interface, visit recursion); registration order conventions in `app/frontend/editor/milkdown_editor.tsx` (plugin chain around lines 303–322).

**Test scenarios:** (covered via U2's browser checks plus the script-level cases below — the repo has no JS unit-test runner, and adding one is out of scope)
- Happy path: seeding `**Date:** a\n**Source:** b\n**Goal:** c` renders three visual lines (two `<br>` in the paragraph).
- Round-trip: after seeding, the pushed snapshot markdown contains `\`-terminated lines; reloading the doc renders identically (no drift, no duplicated breaks).
- Edge: paragraph-final newline produces no trailing empty line.
- Edge: fenced code block content containing newlines is unchanged (still one `code_block`, newlines literal).
- Edge: blank-line-separated paragraphs still parse as separate paragraphs (transformer must not eat paragraph boundaries — those never reach text values, but assert it anyway).
- Integration: accepting a suggestion whose body contains soft breaks inserts hard-break-separated lines (R2).

**Verification:** On a locally seeded document with the exact metadata block from the live doc, the editor shows Date/Source/Goal on three lines; the API's `markdown` snapshot round-trips stably.

### U2. Browser-check coverage for soft-break rendering

**Goal:** Regression coverage in the repo's E2E harness.

**Requirements:** R1, R3.

**Dependencies:** U1.

**Files:**
- `script/browser_check.mjs` — add a check (or extend the seeding check) that creates a doc via `POST /api/docs` with a soft-break metadata block, opens it, and asserts the paragraph contains two `<br>` elements / three lines; then asserts the serialized snapshot keeps the lines separate.

**Patterns to follow:** existing checks in `script/browser_check.mjs` (33 sequential checks, Playwright, agent-API doc creation already exercised there).

**Test scenarios:** this unit *is* test coverage; the scenario list lives in U1.

**Verification:** `BASE_URL=http://localhost:3000 node script/browser_check.mjs` passes including the new check; full suite stays green (`bin/rails test` unaffected — no server code changes).

### U3. Repair the live document's metadata block

**Goal:** `/d/1KytrvTXNj` metadata renders as three lines after the owner accepts a proposed edit.

**Requirements:** R5.

**Dependencies:** none (deploy-independent: the proposal body uses explicit `\` hard breaks, which parse correctly in the current production build).

**Files:** none in-repo — this is an outward action against the production agent API (`POST /api/docs/1KytrvTXNj/suggestions` with `X-Agent-Name`, `anchor_text` matching the run-on metadata paragraph, `replaces` set, and a body where Date/Source/Goal lines end in `\`).

**Approach:** Propose, don't mutate: the suggestion lands in the review panel for Kieran to accept in the editor. Include an `intent` line explaining the reformat. This is reversible (rejectable) and uses the platform's designed agent loop.

**Test expectation: none** — content action, verified by observing the pending suggestion on the live doc (API `suggestions` array) and visually after acceptance.

**Verification:** `GET /api/docs/1KytrvTXNj` shows the pending suggestion with the hard-break body; after acceptance the rendered paragraph shows three lines.

---

## Scope Boundaries

**In scope:** soft-break preservation in the Milkdown parse pipeline; E2E regression check; suggestion-based repair of the one live document the user pointed at.

**Out of scope / non-goals:**
- YAML frontmatter (`---` delimited) parsing or styled metadata cards — the target document has none; nothing in the current corpus needs it.
- Server-side rewriting of existing documents' Yjs state (KTD3).
- Adding a JS unit-test framework (vitest etc.) — the repo's established harness is `script/browser_check.mjs`.

**Deferred to follow-up work:**
- A styled "document metadata" presentation (e.g., rendering a leading key-value block as a visually distinct card) if the plain three-line rendering proves insufficient.

---

## Assumptions

- Global soft-break→hard-break conversion is the desired product behavior (Notion/Slack-style), not a metadata-only special case. Grounded in: the user's ask, the agent-authored corpus (no hard-wrapped prose), and comparable products.
- "Metadata frontmatter" in the request refers to the visible `**Date:/Source:/Goal:**` block on the linked doc (it has no YAML frontmatter — verified via the API).
- Proposing a suggestion on the live production doc is within the autonomous mandate, since it is the platform's reviewable, rejectable agent flow and the user pointed at that doc explicitly.

---

## Risks & Dependencies

- **Round-trip drift:** if Milkdown's stringifier emitted something other than `\` line endings, snapshots could mutate on every open. Mitigated: round-trip verified against the installed remark; U2 asserts stability.
- **Existing docs re-serialize differently:** docs whose Yjs state already contains collapsed spaces are untouched by the transformer (no newlines left to convert) — no behavior change for them.
- **Suggest-changes / provenance interaction:** new `hardbreak` nodes flow through y-prosemirror and the provenance mark plugin like any inline node; the browser check with provenance-seeded content guards this.
