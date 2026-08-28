---
title: Text Highlighter with Named Color Legend - Plan
type: feat
date: 2026-07-21
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# Text Highlighter with Named Color Legend - Plan

## Goal Capsule

Give document editors a marker-style text highlighter: select text, pick one of ten light background colors from the selection toolbar, and see every color used in the document listed in the right rail as a legend where each color can be given a shared, persistent name. Highlight formatting is Thinkroom-internal chrome — it must be stripped on copy and export exactly like provenance marks.

Authority: this plan derives from a Riffrec feedback recording on `thinkroom.kieranklaassen.com/d/mFtr1Syx9B/edit` (transcript: "I want a way in edit mode … can select the text and I can make it a color … maybe there are like 10 colors … we'll see all the colors here with a legend, so you can give the colors a name … like a highlighter, lighter colors in the background … probably that should be stripped when copying as well, similar to the provenance stuff here … I want to organize by color here").

Stop conditions: do not build filtering/reordering of document content by color, do not add a mobile legend sheet, do not extend highlighting into Suggest/Comment/Read modes in this iteration (see Scope Boundaries).

## Product Contract

### Summary

A `highlighter` ProseMirror mark (color attribute from a fixed 10-color palette) applied via swatches on the existing selection toolbar in Edit mode. A legend section in the right rail lists the colors currently present in the document with their highlighted snippets grouped per color; writers can name each color, and names persist per document and sync to all clients. Copy, export, and the server plain-markdown surface strip the mark.

### Problem Frame

Users organizing working documents (task hitlists, planning docs) want to visually categorize spans of text by color — like physical highlighters with a legend on the side. Today text selection only offers "Comment"; there is no way to color text, no legend, and no per-color naming.

### Requirements

**Highlighting**
- R1. In Edit mode, a writer selecting text can apply one of exactly 10 predefined highlight colors from the selection toolbar; the colors render as light background tints behind the text (marker style, readable contrast).
- R2. A writer can remove a highlight from selected text (clicking the already-active color toggles it off; a clear affordance exists when the selection is highlighted).
- R3. Highlights are document content: they sync live to all collaborators (Yjs), survive reload (markdown/HTML snapshot round-trip), and render in the server-side instant-paint preview without layout shift.

**Legend**
- R4. When at least one highlight exists in the document, the right rail shows a "Highlights" legend section listing each used color (palette order) with its highlighted text snippets grouped under it.
- R5. A writer can assign a name to each color in the legend; names are per-document, persist server-side, and appear for every viewer of the rail (live-synced like comments/activities).
- R6. Clicking a snippet in the legend scrolls the document to that highlight.

**Copy hygiene**
- R7. Copying highlighted text (editable and read-mode copy paths) and exporting the document (Markdown/HTML download) strips the highlighter mark, exactly like provenance — normal marks (bold, links, …) are preserved.
- R8. The agent-facing plain markdown surface (`Document#plain_markdown`) strips highlighter spans.
- R9. Highlighter metadata is only trusted from Thinkroom's own snapshots: external pasted HTML never smuggles highlighter attributes in (sanitizer parity with provenance).

### Acceptance Examples

- AE1. **Covers R1, R3.** Given a doc in Edit mode, when I select "Email cleanup" and click the yellow swatch, the text gets a light yellow background; a collaborator's window shows the same tint within a second; after reload the tint is still there and already visible in the pre-hydration preview.
- AE2. **Covers R2.** Given text already highlighted yellow, when I select it the yellow swatch shows as active; clicking it removes the highlight.
- AE3. **Covers R4, R5.** Given a doc with yellow and green highlights, the rail shows "Highlights" with a yellow row and a green row; typing "Urgent" as the yellow row's name and pressing Enter persists it — a second browser shows "Urgent" without reload.
- AE4. **Covers R7.** Given highlighted bold text, copying it and pasting into the doc (or exporting Markdown) yields bold text with no highlighter span.
- AE5. **Covers R9.** Pasting `<span data-highlighter data-color="yellow">x</span>` from an external source produces plain text, not a highlight.

### Scope Boundaries

- Deferred: highlighting from Suggest mode (interacts with the suggest-changes transaction interceptor), Comment/Read modes (non-editable views), a mobile legend sheet, and per-color filtering or reordering of document content. The recording's "organize by color" is satisfied by the per-color snippet grouping in the legend.
- Deferred: renaming affordances for read-only viewers (legend names render for everyone; editing requires write access).
- Outside identity: arbitrary custom colors or user-defined palettes — the palette is fixed at 10.

### Sources

- Riffrec feedback bundle (59s session, 2026-07-21) — transcript and frames analyzed via ce-riffrec-feedback-analysis; evidence local-only.
- Provenance mark stack: `app/frontend/editor/provenance/mark.ts`, `app/frontend/editor/provenance/remark.ts` — the round-trip pattern this feature mirrors.
- Clipboard hygiene: `app/frontend/editor/clipboard.ts` (`ACTIVITY_MARK_NAMES`, `transformCopied`, `bindReadModeCopy`), `app/frontend/editor/document_export.ts`.
- Sanitizer trust boundary: `app/services/html_document_sanitizer.rb` (provenance restore pattern).
- Rail + selection toolbar: `app/frontend/pages/documents/show.tsx`, `app/frontend/components/selection_toolbar.tsx`, `app/frontend/components/activity_panel.tsx`, `app/frontend/styles/rail.css`, `app/frontend/styles/review_chrome.css`.
- Doc-scoped JSON persistence pattern: `app/services/render_hints.rb`, `documents.render_hints` column.
- Live rail sync: `app/channels/document_meta_channel.rb`, `app/frontend/lib/use_meta_channel.ts` (`CABLE_FED_PROPS`).

## Planning Contract

### Key Technical Decisions

- KTD1. **Mark name `highlighter`, single `color` attr.** Avoids collision with the existing `@milkdown/plugin-highlight` (Shiki code blocks) and `lib/highlights.ts` (CSS Custom Highlight helpers). One mark type means y-prosemirror same-type replacement gives "one color per span" semantics for free (same property provenance relies on).
- KTD2. **Serialize as inline HTML span** `<span data-highlighter data-color="…">` in Markdown via `$remark` stringify/parse transformers, mirroring `provenance/remark.ts` verbatim. Markdown stays legal everywhere; the preview pipeline (Commonmarker `render.unsafe` → `HtmlDocumentSanitizer.snapshot`) already passes trusted spans through.
- KTD3. **CSS targets data attributes with a class fallback**, mirroring provenance: `.milkdown .hl--yellow, .doc-static-preview span[data-highlighter][data-color='yellow']`. The sanitizer strips `class`, so the preview selector must key on the restored data attributes.
- KTD4. **Fixed palette of 10 color ids** (`yellow green blue pink purple orange teal red gray brown`) defined once per side: `app/frontend/editor/highlighter/palette.ts` (ids + swatch hex) and `HighlightPalette::COLOR_IDS` in Ruby (sanitizer + names endpoint allowlist). Light tints via CSS custom properties for contrast.
- KTD5. **Legend content derives client-side from the live doc** (scan marks on `docTick`, the same recompute signal `MarginSuggestions` uses) — no server copy of highlight ranges. Only the color **names** persist server-side: new `documents.highlight_names` JSON column (default `{}`), sanitized map colorId → name (≤64 chars), written through `PATCH /d/:slug/highlight_names` guarded by `with_write_access`, broadcast as a `highlight_names` meta-channel event and reloaded as a lazy Inertia prop (added to `CABLE_FED_PROPS`).
- KTD6. **Strip-on-copy is one set membership**: add `'highlighter'` to `ACTIVITY_MARK_NAMES` — `transformCopied`, read-mode copy, and both document exports all flow through `stripActivityMarks`. Server-side, extend `Document#plain_markdown`'s open-tag gsub (the blanket `</span>` gsub already handles close tags).
- KTD7. **Edit-mode gating.** Swatches render on the selection toolbar only when `effectiveMode === 'edit'` and the viewer can write. Applying the mark dispatches a plain `addMark`/`removeMark` transaction (undoable; the provenance writer only attributes inserted text, so a pure mark step is untouched).

### Assumptions

- Marks sync through y-prosemirror as formatting attributes with no schema migration for existing docs (provenance precedent).
- An `addMark`-only transaction does not trip the suggest guard in Edit mode (suggesting disabled → `suggestDispatch` is a pass-through).

## Implementation Units

### U1. Highlighter mark, markdown round-trip, palette, styles

- Goal: the `highlighter` mark exists in the schema, round-trips through Markdown/HTML snapshots, and renders light tints in both the live editor and the static preview. (R1 rendering, R3)
- Files: `app/frontend/editor/highlighter/palette.ts` (new), `app/frontend/editor/highlighter/mark.ts` (new), `app/frontend/editor/highlighter/remark.ts` (new), `app/frontend/editor/highlighter/index.ts` (new), `app/frontend/editor/milkdown_editor.tsx` (register plugin), `app/frontend/styles/review_chrome.css` or a new `highlighter.css` (tints).
- Approach: mirror `provenance/mark.ts` + `provenance/remark.ts`. `parseDOM` on `span[data-highlighter]` with color validated against the palette; `toDOM` emits `data-highlighter`, `data-color`, `class="hl hl--<color>"`. Register `...highlighterPlugins` in the editor plugin chain near `provenance`.
- Test scenarios: TypeScript compiles; markdown round-trip covered indirectly by U2 sanitizer/model tests; visual verification in U6.

### U2. Copy/export/server stripping and sanitizer trust

- Goal: highlighter marks vanish from every export surface and cannot be smuggled in from external HTML. (R7, R8, R9)
- Files: `app/frontend/editor/clipboard.ts` (`ACTIVITY_MARK_NAMES`), `app/services/html_document_sanitizer.rb` (attrs + trusted restore), `app/models/document.rb` (`plain_markdown`), `app/services/highlight_palette.rb` (new: `COLOR_IDS`, name sanitization), `test/services/html_document_sanitizer_test.rb`, `test/models/document_test.rb` (or nearest existing model test file).
- Approach: add `'highlighter'` to the mark-name set; sanitizer gains `data-highlighter`/`data-color` in `ATTRIBUTES` with restore only when `trusted` and the color is in `HighlightPalette::COLOR_IDS`; `plain_markdown` gsub gains `<span data-highlighter[^>]*>`.
- Test scenarios: snapshot sanitize preserves a valid highlighter span; external sanitize strips it; invalid color stripped even when trusted; `plain_markdown` removes highlighter spans while keeping inner text.

### U3. Selection toolbar swatches and apply/remove commands

- Goal: Edit-mode selections offer 10 color swatches plus Comment; clicking applies/toggles the highlight. (R1, R2)
- Files: `app/frontend/components/selection_toolbar.tsx` (swatch support), `app/frontend/editor/highlighter/commands.ts` (new: apply/remove/active-color helpers reading `view.state`), `app/frontend/pages/documents/show.tsx` (wire swatches, mode gate), `app/frontend/styles/review_chrome.css` (swatch styles).
- Approach: extend `SelectionToolbar` with an optional `swatches` prop rendered as round color buttons (aria-labels carry color names); `show.tsx` passes them only when `effectiveMode === 'edit' && ownership.can_write`. Apply = `addMark(from, to)` (replacing any existing color), toggle-off when the clicked color already spans the whole selection.
- Test scenarios: TypeScript + lint; behavioral verification in U6 (apply, replace color, toggle off, toolbar absent in Suggest/Comment/Read).

### U4. Persisted legend names: column, endpoint, live sync

- Goal: per-document color names persist and reach every client live. (R5 persistence)
- Files: `db/migrate/*_add_highlight_names_to_documents.rb` (new), `db/schema.rb`, `app/services/highlight_palette.rb` (name sanitization), `app/controllers/documents_controller.rb` (props + `update_highlight_names`), `config/routes.rb` (`patch "d/:slug/highlight_names"`), `app/frontend/lib/use_meta_channel.ts` (`CABLE_FED_PROPS`), `test/integration/*highlight*` (new).
- Approach: `json` column default `{}` NOT NULL (mirrors `render_hints`). Endpoint merges sanitized `{color_id => name}` under `with_write_access`; blank name deletes the key; responds `head :no_content`; broadcasts `DocumentMetaChannel.broadcast_event(document, :highlight_names)`. `documents#show` ships `highlight_names: -> { document.highlight_names || {} }`.
- Test scenarios: writer can set/clear a name; read-only link (`link_access: "view"`) gets 403/redirect; unknown color ids and >64-char names rejected/truncated; show props include the map.

### U5. Legend rail panel

- Goal: the rail shows used colors with names and snippets; writers rename inline; snippets jump to their text. (R4, R5 UI, R6)
- Files: `app/frontend/components/highlight_legend_panel.tsx` (new), `app/frontend/editor/highlighter/scan.ts` (new: collect `{color, snippets: [{text, from, to}]}` from a doc), `app/frontend/pages/documents/show.tsx` (mount between Comments and Activity; recompute on `docTick`), `app/frontend/styles/rail.css` (legend styles), `app/frontend/types/payloads.ts` or local types.
- Approach: `rail-section` markup matching CommentsPanel/ActivityPanel conventions; section renders only when the scan finds ≥1 highlight; name input (writers) commits on Enter/blur via `patchJSON` with optimistic local state reconciled by the `highlight_names` prop reload; snippet click sets a text selection at the stored range and `scrollIntoView`s.
- Test scenarios: TypeScript + lint; behavioral verification in U6 (legend appears/disappears with highlights, names sync across two browsers, snippet jump scrolls).

### U6. End-to-end verification

- Goal: demonstrate the feature working end-to-end and guard regressions.
- Approach: run the full Verification Contract; browser-test with `bin/dev` on the seeded demo doc: apply highlights, rename colors in the legend, jump from a snippet, verify copy strips the mark (paste back into the doc), reload for preview parity.

## Verification Contract

- `npm run check` — TypeScript (app + SSR), ESLint, CLI tests.
- `bin/rubocop` — Ruby lint.
- `bin/rails test` — full Minitest suite (~405 tests) including the new sanitizer/model/integration tests.
- Manual browser pass on `bin/dev` (`/d/demo`): AE1–AE5 above, with a screen recording of the happy path.

## Definition of Done

- All requirements R1–R9 implemented and traced to shipped code.
- New Minitest coverage for sanitizer trust, `plain_markdown` stripping, and the names endpoint passes alongside the existing suite; `npm run check` and `bin/rubocop` clean.
- Browser evidence shows highlight apply/remove, live legend with rename, snippet jump, and strip-on-copy.
- No leftover debug code; no abandoned-approach code in the diff.
