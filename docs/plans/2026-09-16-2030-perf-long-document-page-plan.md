---
title: "Long document page performance - Plan"
type: perf
date: 2026-09-16
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Long document page performance - Plan

## Goal Capsule

- **Objective:** A long shared document (hundreds of blocks, dozens of code blocks) opens and becomes a live editor in a fraction of the time it takes today, and stays responsive while reading and typing.
- **Means:** Remove the redundant work found by the measured `ce-optimize` loop (`.context/compound-engineering/ce-optimize/doc-page-render/`): a syntax-highlight refresh storm, full layout of offscreen blocks, forced reflows from width handles, a duplicated seed payload, and an uncached server preview render.
- **Authority:** Requirements govern behavior; technical decisions govern mechanism; `AGENTS.md`, `STRATEGY.md` and `docs/solutions/architecture-patterns/server-first-instant-paint.md` remain authoritative.
- **Execution profile:** Behavior-preserving; every change was measured against a 298 KB / 983-block fixture before being kept.
- **Stop conditions:** Escalate anything that would change document content, serialized Markdown, provenance, or collaboration semantics.

---

## Product Contract

### Summary

Opening `/d/:slug` for a long document must not block the main thread for many seconds. The page must show exactly the same content and chrome as before.

### Problem Frame

On a 298 KB Markdown document (983 top-level blocks, 60 code blocks) the Edit page took 15.7 s to reach the live editor with 13.3 s of total blocking time at 4x CPU throttling (about 4.8 s and 3.3 s unthrottled). Profiling showed the time was mostly avoidable: `prosemirror-highlight` dispatched 360 refresh transactions while shiki loaded, each rebuilding a 2,620-span decoration set; the browser laid out and painted all 983 blocks although a screen shows about 15; the width-handle plugin forced a layout per code block per update; the page shipped two 302 KB copies of the seed that no client reads for a live document; and the server re-rendered a 535 KB preview on every request.

### Requirements

**Speed**

- R1. On the reference fixture, total blocking time during load and time to the live editor must each drop by more than half versus `main`, measured with the same harness (4x CPU throttle, median of three runs).
- R2. Typing latency and scroll smoothness must not regress beyond measurement noise.
- R3. A repeat load of an unchanged document must not re-render the server preview.

**Fidelity**

- R4. The page renders the same content: the same number of top-level blocks, code blocks still get highlighted once shiki loads, tables and sketches keep their breakout width handles with correct `aria-value*` attributes.
- R5. Collaborator cursor labels (human awareness cursors, read pointers, agent cursors) stay fully visible; no block that holds a cursor may clip it.
- R6. The static preview and the live editor keep the same box geometry so the preview-to-editor swap stays seamless.
- R7. A fresh document's seed grant still ships the seed template (and its legacy `seed_markdown` alias for Markdown documents); a live document ships neither.
- R8. Social preview title and description are unchanged for any document whose text fits the description budget; longer documents keep the same truncation shape.

### Scope Boundaries

No windowing or virtual list (ProseMirror needs the whole document in one contenteditable for selection, find, and Yjs binding), no server pagination of document content, no change to Markdown serialization or the agent API. Viewport-deferred highlighting and cold-render optimizations of the sanitizer are follow-ups, not part of this change.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Coalesce the pending shiki promise instead of patching `prosemirror-highlight`.** The plugin subscribes to the pending parser promise once per code block per view update and dispatches a refresh from every subscription. `lazyShikiParser` now hands it a `Promise` subclass whose `then` settles only the first subscriber per synchronous burst; the rest never settle. Upstream 0.16.0 still has the behavior, so the fix lives in `app/frontend/editor/highlighter.ts`. Governs R1, R4.
- KTD2. **`content-visibility: auto` on offscreen top-level blocks, with explicit exemptions.** Applies to `p`, headings, lists, blockquotes and `hr` under `.milkdown .ProseMirror` in both layers (R6). Breakout blocks stay out because their width handles overflow the block and paint containment would clip them. Blocks holding a cursor widget are exempted with `:not(:has(.ProseMirror-yjs-cursor, .agent-cursor))`. A mutation-observer plugin that wrote a `data-holds-cursor` attribute measured slightly better on typing latency, but ProseMirror owns those nodes' DOM and re-renders a block whose attributes change under it, which looped with the observer and froze the page whenever a cursor widget appeared; the selector costs a few milliseconds of typing latency instead. Governs R1, R2, R5, R6.
- KTD3. **Width handles measure through a `ResizeObserver`.** Content mutations only reconcile which blocks carry a handle; geometry is read inside the observer callback, after layout, so nothing forces a reflow. Governs R2, R4.
- KTD4. **The seed template rides only with the seed grant.** `documents#show` sends `seed_content` (and `seed_markdown`) only when `seed_granted` is true, the one client path that applies it. Governs R7.
- KTD5. **Cache the preview render in a bounded in-process LRU.** `DocumentPreviewHtml.call` keys a 64 MB `MemoryStore` by a digest of every input (format, flags, source, render hints). `DocumentSocialPreview#bound` grapheme-scans only the prefix that can fit the budget. Governs R3, R8.

### Assumptions

- Production runs one Puma process, so a process-local cache is enough; a multi-process deployment would simply have one cache per process.
- Browsers without `content-visibility` support ignore the declaration and render as today.

### Sequencing

U1 through U5 are independent and already measured in combination; U6 adds the regression coverage that protects them.

---

## Implementation Units

### U1. Coalesce the lazy shiki promise
- **Files:** `app/frontend/editor/highlighter.ts`
- **Cites:** R1, R4, KTD1
- **Done when:** a long document with many code blocks triggers one highlight refresh per plugin check while shiki loads, and every code block is highlighted once it has loaded.

### U2. Skip rendering offscreen blocks
- **Files:** `app/frontend/styles/editor.css`
- **Cites:** R1, R2, R5, R6, KTD2
- **Done when:** offscreen paragraphs compute `content-visibility: auto`, breakout blocks and cursor-holding blocks compute `visible`, and a peer's cursor label renders unclipped.

### U3. Width handles without forced layout
- **Files:** `app/frontend/editor/rich_block_width.ts`
- **Cites:** R2, R4, KTD3
- **Done when:** handles still appear on every breakout block with numeric `aria-value*` attributes and the plugin no longer appears in a CPU profile of the load.

### U4. Seed payload only with a grant
- **Files:** `app/controllers/documents_controller.rb`
- **Cites:** R7, KTD4
- **Done when:** the seed-grant integration tests pass and a live document's props carry `seed_content: null` and no `seed_markdown`.

### U5. Cached preview render and bounded description scan
- **Files:** `app/services/document_preview_html.rb`, `app/services/document_social_preview.rb`
- **Cites:** R3, R8, KTD5
- **Done when:** a second render with identical inputs is served from the cache, different inputs never share an entry, and social preview tests pass.

### U6. Regression coverage
- **Files:** `script/long_document_check.mjs`, `.github/workflows/ci.yml`, `test/integration/document_seed_claim_test.rb`, `test/services/document_preview_html_test.rb`, `test/services/document_social_preview_test.rb`
- **Cites:** R4, R5, R7, R8
- **Done when:** the browser check runs in CI's `browser_checks` loop and the Rails tests cover the seed-grant payload rule, cache keying, and long-text description bounding.

---

## Verification Contract

- `npm run check` (TypeScript, ESLint, CLI tests)
- `bin/rubocop`
- `bin/rails test`
- `BASE_URL=http://localhost:3000 node script/long_document_check.mjs` against `bin/dev`
- Perf harness (outside the repo): `/tmp/perf/evaluate.sh` on the 298 KB fixture; kept numbers are in `.context/compound-engineering/ce-optimize/doc-page-render/experiment-log.yaml`.

## Definition of Done

- All Verification Contract commands pass.
- Measured on the fixture at 4x CPU: total blocking time 13.3 s to 4.5 s, time to live editor 15.7 s to 6.8 s, longest task 7.5 s to 1.6 s, page HTML 2.74 MB to 2.14 MB, warm TTFB about 1.0 s to about 0.2 s.
- No console errors during load, scroll, or typing on the fixture.
