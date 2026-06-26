---
title: "feat: Extend rich-block width to code blocks and Mermaid diagrams"
type: feat
status: active
date: 2026-06-26
origin: docs/brainstorms/riffrec-feedback/thinkroom-doc-feedback/problem-analysis.md
---

# Rich-block width for code blocks and Mermaid diagrams

## Goal

Let fenced code blocks and Mermaid diagram previews use the same shared rich-content
breakout width as sketches and tables, so wide code (ASCII tables, multi-column snippets)
and horizontal Mermaid flows render "the whole way through" instead of being clamped to
the prose measure. Code blocks gain the same quiet drag handle sketches and tables already
have. This is the `R3` + `R4` slice of the Riffrec feedback (see `origin`); the spoken asks
were "add these blocks as well" (the drag thing on markdown/code blocks) and "these should
also be wider … not rendering the whole way through" (Mermaid).

## Problem frame

`app/frontend/editor/rich_block_width.ts` scopes the shared width handle to
`.thinkroom-sketch, .milkdown-table-block` only. Code blocks render as bare `pre > code`
(commonmark + `@milkdown/plugin-highlight`, no node-view wrapper) and Mermaid renders as a
derived `figure.mermaid-diagram` decoration before its source `pre`. Neither participates in
the `--rich-content-width` breakout, so both are stuck at the reading measure: the persona
ASCII block (frame `m7`) is clipped and the "Email lifecycle" flow (frame `m9`) does not fill
the column.

## Decisions

- Reuse the existing shared rich-block width preference (`pruf_rich_width` →
  `--rich-content-width`, default 960px, 640–1200px range). No new preference, no per-block
  width, no document/Markdown changes. Dragging any rich block still resizes them all,
  matching `docs/plans/2026-06-26-018-feat-rich-block-width-plan.md`.
- Code blocks become breakout rich blocks **and** get the drag handle. The handle is the
  existing `button.rich-block-width-handle` appended to the `<pre>` (the `code_block`
  nodeDOM; `<code>` stays the contentDOM), reattached by the plugin's existing
  MutationObserver across re-renders. No code-block node view is introduced — that would risk
  shiki highlighting, suggest-changes, provenance, and collab.
- Move the code block's horizontal scroll from the `<pre>` to its inner `<code>`. Today
  `.milkdown .ProseMirror pre` sets `overflow-x: auto`, which (per the CSS overflow-quirk)
  also clips the y-axis and would hide an edge handle. Scrolling on `<code>` keeps long-line
  scroll while letting the `<pre>` show the handle just outside its edge.
- Mermaid diagram previews (`figure.mermaid-diagram`) become breakout blocks so they render
  at the rich-content width; the rendered SVG keeps `max-width: 100%` so it grows into the
  wider container (and still scrolls/contains huge diagrams). The Mermaid **source** `pre`
  (`pre[data-language="mermaid"]`) is excluded from breakout/handle — it is paired source,
  not a standalone block, and excluding it avoids a redundant second handle in edit mode.
- The Mermaid figure does **not** get its own drag handle in this change: its
  `overflow: auto` would clip an edge handle, and reworking that DOM is out of scope. The
  shared width still applies, so any code/table/sketch handle resizes the diagram too.
- Honor every existing layout variant: centered breakout in Read and focus modes,
  gutter-aligned expansion in Edit/Suggest/Comment, and at the compact/coarse-pointer
  breakpoint return to 100% width with handles hidden and no page overflow.
- Update the handle's `aria-label`/`title` copy so it no longer says only "sketches and
  tables".

## Implementation units

### U1. Code blocks become resizable breakout rich blocks

- **Requirements:** R3 (origin).
- **Files:** `app/frontend/editor/rich_block_width.ts`,
  `app/frontend/entrypoints/application.css`.
- **Approach:**
  - Extend `BLOCK_SELECTOR` to also match top-level non-Mermaid code blocks
    (`.ProseMirror > pre:not([data-language="mermaid"])`) alongside the existing sketch/table
    selectors, keeping `buildHandle`/`syncHandleValue`/`closest(BLOCK_SELECTOR)` working.
  - Add the same selector to the four breakout-width selector groups (default read,
    review/edit, panel-hidden, focus) and the compact-breakpoint reset, so code blocks get
    `position: relative` + the shared width and collapse to 100% with hidden handles on
    mobile — exactly like sketches/tables.
  - Change `.milkdown .ProseMirror pre` to `overflow: visible` and move
    `overflow-x: auto` (with `display: block`) onto `.milkdown .ProseMirror pre code` so the
    edge handle is no longer clipped while long lines still scroll inside the block.
  - Update the handle `aria-label`/`title` to cover code blocks (e.g. "Sketch, table, and
    code block width").
- **Patterns to follow:** existing sketch/table handling in the same file and the breakout
  selector groups in `application.css` (~L1167–1212, `.rich-block-width-handle` ~L1214).
- **Test scenarios:**
  - Covers R3. A fenced code block in read mode shows a `.rich-block-width-handle` and
    defaults to the shared 960px breakout (wider than prose).
  - Dragging the code-block handle resizes the code block and the sibling sketch/table
    together and persists `pruf_rich_width` (shared width invariant).
  - Long single-line code scrolls horizontally inside the block with zero page overflow; the
    handle remains visible (not clipped).
  - At 390px the code block returns to prose width and its handle is `display: none` with no
    page overflow.
- **Verification:** `script/rich_block_width_check.mjs` extended to assert a code block joins
  the shared breakout, drag/persist, long-line containment, and mobile reset.

### U2. Mermaid diagrams render at the rich-content breakout width

- **Requirements:** R4 (origin).
- **Files:** `app/frontend/entrypoints/application.css` (and
  `app/frontend/editor/mermaid.ts` only if an inline SVG width must be relaxed).
- **Approach:**
  - Add `.ProseMirror > figure.mermaid-diagram` to the same breakout-width selector groups
    and the compact reset, so the figure uses `--rich-content-width` (centered in read/focus,
    gutter-aligned in edit) and collapses to contained width on mobile.
  - Keep `.mermaid-diagram-svg { max-width: 100% }` so the diagram grows into the wider figure
    and still contains/scrolls oversized diagrams. Only touch `mermaid.ts` if the sanitized
    SVG carries an intrinsic inline `max-width` that prevents using the wider container.
  - Leave the Mermaid source `pre[data-language="mermaid"]` at normal width (excluded from
    U1's selector and from any breakout rule).
- **Patterns to follow:** existing `.mermaid-diagram` rules (`application.css` ~L1502–1558)
  and the sketch/table breakout groups.
- **Test scenarios:**
  - Covers R4. In read mode a valid Mermaid diagram's figure width matches the shared rich
    width (≈960px default) and exceeds prose width.
  - The rendered SVG fills/uses the wider figure (its width grows versus the prior
    prose-clamped width) without clipping.
  - The Mermaid source `pre` stays at prose width (not breakout) in edit mode; no duplicate
    width handle appears around the diagram.
  - At 390px the diagram fits the viewport with zero page overflow (preserves the existing
    `script/mermaid_check.mjs` mobile assertion).
- **Verification:** `script/mermaid_check.mjs` extended with a desktop breakout-width
  assertion; existing mobile/overflow assertions stay green.

### U3. Regression checks

- **Requirements:** R3, R4.
- **Files:** `script/rich_block_width_check.mjs`, `script/mermaid_check.mjs`.
- **Approach:** extend the two existing Playwright checks (do not add a third script) with the
  code-block and Mermaid breakout assertions enumerated in U1/U2, reusing their
  create-doc/cleanup scaffolding. Keep `npm run check` (TypeScript) green.
- **Test expectation:** covered by U1/U2 scenarios; this unit only wires them into the
  existing harnesses.
- **Verification:** both scripts pass against `bin/dev`; `npm run check` passes.

## Verification

- `npm run check` (TypeScript) passes.
- `BASE_URL=… node script/rich_block_width_check.mjs` passes, including the new code-block
  assertions.
- `BASE_URL=… node script/mermaid_check.mjs` passes, including the new desktop breakout
  assertion and the unchanged mobile/overflow assertions.
- `bin/rubocop` and `bin/rails test` stay green (no Ruby changes expected; run as guardrail).
- Manual check against `bin/dev`: the persona-style code block and the "Email lifecycle"
  Mermaid diagram render wider/edge-to-edge; the code block exposes a working drag handle;
  short code blocks and the diagram remain contained at mobile width.

## Scope boundaries

### Deferred to follow-up work

- **R1 (header presence-name spacing):** move the doc-header presence name next to Share.
  Separate subsystem (`documents/show.tsx` header + `.doc-header-*` CSS); not part of the
  rich-block width subsystem.
- **R2 (mode control polish):** make the mode trigger/dropdown more minimal/compact.
  Explicitly open-ended ("do some iterations") in the feedback — better as its own design
  pass.
- **R5 (edge-control overlap hide/show):** hide a block's other edge chrome while the width
  handle is active. Ambiguous pairing in the recording and coupled to Crepe table chrome.
- **Mermaid figure drag handle:** the figure's `overflow: auto` would clip an edge handle;
  giving it its own handle needs a DOM rework. Shared width already covers the width ask.

## Non-goals

- No per-block width metadata or Markdown/document-source changes (shared viewer preference
  only).
- No code-block node view or change to shiki highlighting, suggest-changes, provenance, or
  collaboration behavior.
- No new browser-check script — extend the two existing focused checks.
