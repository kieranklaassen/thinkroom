---
title: "feat: First-class tables and editorial markdown typography"
type: feat
status: active
date: 2026-06-05
---

# feat: First-Class Tables and Editorial Markdown Typography

## Summary

GFM tables currently render as bare, unstyled HTML — no borders, no padding, no editing affordances ("tables look crappy"). This plan makes tables first-class: the official Milkdown `table-block` component (hover row/column handles, drag-to-reorder, alignment buttons, add/delete) wired with our own icons and CSS, plus research-grounded editorial table typography (horizontal rules only, smaller sans with tabular numerals, header weight instead of background fill). Alongside, a polish pass brings the whole markdown element set up to typeset quality — heading rhythm, muted list markers, task lists, strikethrough, hr air, first/last-child trim — coherent across both themes.

## Problem Frame

`app/frontend/entrypoints/application.css` has an Editor typography section covering headings, lists, code, blockquote, hr — but **zero table CSS**, so GFM tables render with browser defaults (no rules, no padding, full-size serif). There is also no way to manipulate a table without hand-editing pipe syntax. The user asked for research-backed best-in-class markdown rendering with tables called out as the failure.

## Assumptions

Headless-mode inferred bets (pipeline run):

- **Adopt `@milkdown/kit/component/table-block`** (already inside our installed `@milkdown/kit@7.21.2`) rather than CSS-only tables — the "crappy" complaint covers editing UX, not just looks, and this is the official component Crepe ships. Cost: it mounts a Vue 3 runtime (~25kB gz, regular dependency already in node_modules) inside the NodeView, fully outside React. Accepted.
- **Editorial table style over developer-docs style**: horizontal rules only (no vertical rules, no outer frame, no zebra), per Rutter/Tschichold and Tailwind Typography's prose tables. GitHub-style full grid + zebra is explicitly rejected as wrong for a paper-like editor.
- **Tables switch to the UI sans at 0.875em** with `tabular-nums` — small serif in tight cells goes muddy; the sans/serif contrast marks tables as "data" (standard editorial practice).
- **No new insert-table UI affordance** — the GFM preset's input rule (`|3x2|` + pipe syntax) and paste support already create tables; the component covers everything after creation. A slash-menu is deferred.
- **Table structural editing is pointer-first for v1.** The component's handles reveal on hover, which never fires on touch — even Crepe doesn't solve touch table editing. Decision: at coarse-pointer devices the priority is reading (scroll affordance, R3); structural editing on touch is an explicit deferred item, and the keyboard/popover accessibility of the Vue-rendered button group is a known upstream gap (markdown pipe syntax remains the universal editing path).
- **No server-side changes except seeds** — GFM table serialization already round-trips; `db/seeds.rb`'s demo gains a table (with an aligned column), a task list, and strikethrough so verification is executable from a fresh `db:seed`.

## Requirements

- R1. Tables render with editorial typography: horizontal rules only (stronger under the header, hairline between rows), 0.875em sans with lining tabular numerals, baseline-aligned cells, padding ~0.5em/0.75em with first/last columns flush to the measure, honoring per-column `text-align` from markdown alignment syntax.
- R2. Hovering a table reveals editing affordances: row/column drag handles, alignment buttons (left/center/right), add row/column on boundary lines, delete row/column — all themed to the app's chrome, invisible until needed. (Functional wiring is U1's half; visual theming is U2's.)
- R3. Wide tables scroll horizontally within the 68ch measure — the table never breaks the page layout.
- R4. Table editing works under live collaboration: edits from the handles sync to a second window; remote structural edits render correctly.
- R5. The full markdown element set reads as professionally typeset: heading rhythm (space-above > space-below, no stray gap after headings), muted list markers, styled task-list checkboxes, strikethrough, blockquote without fatigue-inducing forced italic on long passages, hr with section-break air, inline-code chip, link underline refinement.
- R6. Everything derives from the existing theme tokens so both themes (proof paper + whitey) stay coherent, including dark-aware native scrollbars on table overflow.
- R7. The Ruby test suite stays green — markdown serialization, snapshots, and provenance behavior are untouched.

## Key Technical Decisions

1. **`tableBlock` from `@milkdown/kit/component/table-block`, configured with our SVG icons.** The default `renderButton` returns bare text ('+', '-', 'left') — always override with inline SVG strings (injected DOMPurify-sanitized into `span.milkdown-icon`). Crepe's wiring at `node_modules/@milkdown/crepe/src/feature/table/index.ts` is the copyable reference.
2. **Base CSS imports are required, not optional — and U1 owns them, imported in `milkdown_editor.tsx`**: `@milkdown/kit/prose/tables/style/tables.css` (border-collapse, fixed layout, `.selectedCell` overlay, `--default-cell-min-width` — define it) and `@milkdown/kit/prose/view/style/prosemirror.css` (positioned `.ProseMirror` ancestor the floating handles require). The editor-module location avoids application.css's Tailwind-v4 `@import`-ordering constraint (extra `@import`s would have to hoist above all rules); both subpaths are verified Vite-resolvable through the exports maps. The component ships **zero** styles of its own; without `.milkdown-table-block .handle { position: absolute }` + `[data-show='false']` hiding, raw buttons render inline above the table.
3. **Handle/popover CSS adapted from Crepe's `theme/common/table.css`** (in node_modules transitively via `@milkdown/react@7.21.2` — covers handle pills, button-group popover incl. the `::after` hover bridge, line-handle add buttons, drag preview, indicator mode) with `--crepe-*` variables swapped for our tokens. In 7.21.2 the component renders a plain `div.milkdown-table-block` (Vue app inside), NOT a custom element — its DOM (source-verified) is: the two `.handle.cell-handle[data-role]` elements with their `.button-group` popovers, then `div.table-wrapper` containing `.drag-preview`, the two `.line-handle` elements with `.add-button`, and `table.children > tbody.content-dom`. Stacking: handles get a named low layer (~z-index 15) and the button-group popover ~30 — above editor content and provenance tints, below sheets/dock; the browser pass checks no collision with margin-gutter suggestion cards.
4. **Table DOM facts that drive the CSS** (verified from preset-gfm source): no `<thead>` — header row is `<tr data-is-header="true">` with `<th>` cells; alignment is always an inline `style="text-align: …"` (never a data attr); selected cells get `.selectedCell`. The header rule targets `tr[data-is-header]`.
5. **Overflow strategy: scroll the wrapper, never the page** — `div.table-wrapper` (part of the component's DOM per KTD 3) gets `overflow-x: auto; max-width: 100%`; the table keeps semantics. Discoverability, not just color: `scrollbar-width: thin` plus a right-edge fade hint at ≤64rem (iOS overlay scrollbars are invisible at rest), and `color-scheme` awareness keeps native scrollbars theme-correct.
6. **Typography values anchored to Tailwind Typography/GitHub/Rutter research**: tables 0.875em / line-height 1.45 / `font-variant-numeric: lining-nums tabular-nums`; headings keep our scale but gain `h2 + *`-style adjacency trimming and `text-wrap: balance`; hr gets `margin: 3em` air; list markers muted via `::marker { color: var(--ink-faint) }`; task lists get `accent-color: var(--accent)` native checkboxes with muted completed items; blockquote drops forced italic in favor of an ink shift. Spacing stays on the existing `> * + *` lobotomized-owl system (ProseMirror blocks are siblings; the owl is already in place) — per-element `margin-top` overrides extend it rather than introducing symmetric margins.
7. **Collab safety is verified-by-design but tested-by-hand**: `tableBlockView` is a standard NodeView on the gfm `table` node (`update()` returns true for content changes; `ignoreMutation` defers to ProseMirror); Crepe ships this exact pairing with collab. The two-window browser pass exercises concurrent structural edits since no authoritative upstream test exists.
8. **Keep every `@milkdown/*` at exactly 7.21.2** — `tableBlockView` keys on `tableSchema.node` from the kit's own preset-gfm instance; a duplicate preset-gfm in the tree would silently unbind the view.

## Implementation Units

### U1. Table-block component wiring

**Goal:** Tables gain Crepe-grade editing affordances inside our raw-builder editor without disturbing collab.
**Requirements:** R2, R4, R7.
**Dependencies:** none.
**Files:** `app/frontend/editor/milkdown_editor.tsx`, `app/frontend/editor/table_icons.ts` (new).
**Approach:** Import `tableBlock, tableBlockConfig` from `@milkdown/kit/component/table-block`; `.use(tableBlock)` after the presets; configure `renderButton` per KTD 1 with a small icon module (`table_icons.ts`) exporting inline SVG strings for all nine `RenderType`s (plus, trash, align left/center/right, grip handles) drawn in the app's quiet line style (1.5px stroke, currentColor). Import the two base CSS files (KTD 2) in the editor module or application.css.
**Patterns to follow:** Crepe's `feature/table/index.ts` config wiring; the existing plugin `.use()` chain in `milkdown_editor.tsx`.
**Test scenarios:** Test expectation: none in Ruby — component wiring; `bin/rails test` must stay green (serialization untouched), and the two-window browser pass covers: handles appear on hover and operate (add/delete/move row+col, set alignment); edits sync to a second window; a remote window's structural edit renders correctly here; readonly-ish surfaces unaffected.
**Verification:** browser pass per scenarios; `npm ls @milkdown/ctx` still shows a single 7.21.2 tree.

### U2. Table CSS — handles + editorial typography

**Goal:** Tables look typeset (R1) and the editing chrome looks native to the app, in both themes.
**Requirements:** R1, R2 (visual half), R3, R6.
**Dependencies:** U1 (DOM exists).
**Files:** `app/frontend/entrypoints/application.css`, `db/seeds.rb` (demo gains a table with an aligned column).
**Approach:** New "Tables" section in the Editor typography area. Two layers: (a) **typography** per KTD 4/6 — `font-family: var(--font-ui)` 0.875em, lh ~1.45, `tabular-nums`; `tr[data-is-header] th` weight 600 + `border-bottom: 1px solid var(--ink-faint)` (the stronger header rule), body cells hairline `var(--line)` bottom rule, padding `0.5em 0.75em` with flush first/last columns, `vertical-align: baseline`, no zebra, no vertical rules, no outer frame, table block margin ~2em via the owl override; (b) **chrome** per KTD 3 (reference Crepe's `theme/common/table.css` for source selectors incl. the `::after` hover bridge) — tokens: `--surface-raised` pills, `--line` borders, `--ink-soft` icons; `.selectedCell::after` uses `color-mix(in srgb, var(--accent) 12%, transparent)` (NOT `--accent-soft`, whose ~13%-alpha hex is too faint on whitey's raised surface); z-index per KTD 3; `.table-wrapper` overflow per KTD 5 incl. the ≤64rem fade hint; handles hidden at `[data-show='false']`; popover shadow consistent with `share-popover`. Define `--default-cell-min-width` (~6ch).
**Patterns to follow:** existing Editor typography section variable usage; `share-popover` elevation treatment.
**Test scenarios:** Test expectation: none — presentational; browser verification: a seeded table renders with header rule + hairlines and no vertical borders in both themes; alignment syntax (`:---:`) visibly centers a column; a 10-column table scrolls inside the measure without widening the page; selected cell shows the accent overlay.
**Verification:** screenshots in both themes look typeset; no layout overflow.

### U3. Markdown element polish pass

**Goal:** The rest of the markdown set reads as professionally typeset in both themes (R5).
**Requirements:** R5, R6, R7.
**Dependencies:** U2 (both edit `application.css` — land after it).
**Files:** `app/frontend/entrypoints/application.css`, `db/seeds.rb` (demo gains a task list + strikethrough sample).
**Approach:** Within the Editor typography section, research-anchored refinements (KTD 6), all expressed as **owl-conformant `margin-top` overrides** (no symmetric margins): heading adjacency (`h2/h3 + *` top-trim so headings bind to their section; `text-wrap: balance`); muted `::marker`; task lists (gfm emits task items: list-style none, checkbox in the marker gutter, `accent-color: var(--accent)`, completed muted); `del`/strikethrough subtle (50% decoration color); blockquote: drop the proof theme's forced `font-style: italic` (whitey already overrides it to normal — this unifies the themes, intentional); hr air via `.ProseMirror > hr { margin-top: 3em }` and `.ProseMirror > hr + * { margin-top: 3em }`; inline code chip stays but verify contrast on whitey; links: `text-decoration-thickness: 1px`, hover to full accent; `.ProseMirror > :first-child { margin-top: 0 }` trim. Verify nothing regresses provenance tints or suggestion/comment anchor decorations (they style spans, orthogonal to block CSS).
**Patterns to follow:** existing token usage; keep the section's comment style.
**Test scenarios:** Test expectation: none — presentational; browser verification: the seeded demo doc (headings, lists, blockquote, code) plus a task list + table + strikethrough sample reads cleanly in both themes; checkbox toggling renders accent-colored; suite stays green.
**Verification:** before/after screenshots of the demo doc in both themes.

## Scope Boundaries

**In scope:** everything above.

### Deferred to Follow-Up Work

- Slash-menu / toolbar affordance to insert a table without typing (`insertTableCommand` exists; UI deferred — the `|3x2|` input rule and paste-from-Docs already work).
- Touch-first table structural editing (hover handles never fire on coarse pointers; pipe-syntax editing remains the touch path — see Assumptions).
- Keyboard accessibility of the Vue-rendered button-group popover (upstream component gap; `renderButton` only controls icon innerHTML, not button attributes).
- Column-resize plugin (prosemirror-tables resizing — not loaded today).
- Footnotes styling (gfm footnotes not enabled in the preset config).
- Print/export stylesheet.

## Risks & Dependencies

- **Vue 3 runtime joins the bundle** (~25kB gz) as table-block's renderer — accepted; it mounts inside the NodeView, invisible to React.
- **Concurrent structural table edits** (two users adding columns simultaneously) resolve at the Yjs level but lack an authoritative upstream test — the two-window pass exercises it; any anomaly gets documented rather than blocking (tables were previously unusable anyway).
- **Provenance marks inside cells**: the auto-mark writer attributes text in cells like anywhere else; serialization emits provenance spans inside table cells. Existing behavior, unchanged — spot-check in the browser pass that tints render acceptably inside cells.
- **`Enter` in a cell exits the table** (gfm keymap binds Enter → exitTable; cells are single-paragraph). Known upstream behavior, not a regression — noted so the browser pass doesn't misread it as a bug.

## Sources & Research

- Milkdown 7.21.2 table-block internals verified against installed source (`node_modules/@milkdown/components/src/table-block/`, kit exports, Crepe's `theme/common/table.css` + `feature/table/index.ts`); collab discussion [Milkdown #1993](https://github.com/orgs/Milkdown/discussions/1993).
- Table/typography values: [Tailwind Typography styles.js](https://github.com/tailwindlabs/tailwindcss-typography/blob/main/src/styles.js), [Rutter — Designing Tables to be Read (A List Apart)](https://alistapart.com/article/web-typography-tables/), [Butterick — Grids of numbers](https://practicaltypography.com/grids-of-numbers.html), [github-markdown-css](https://github.com/sindresorhus/github-markdown-css) (as the rejected developer-docs contrast).
