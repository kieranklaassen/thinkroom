---
title: "fix: Render sketches in Markdown exports and copied documents"
type: fix
date: 2026-06-26
issue: 70
---

# fix: Render sketches in Markdown exports and copied documents

## Summary

Make whole-document Markdown downloads and copy-all output portable. Editable Excalidraw scene fences remain the canonical in-app source, but outward-facing Markdown and clipboard payloads replace those private scene blocks with inline SVG that ordinary Markdown and rich-text consumers can display.

## Problem Frame

Thinkroom's HTML export already renders sketches as SVG, but Markdown export currently calls Milkdown's normal serializer and emits a fenced `excalidraw` JSON payload. That payload is useful only to Thinkroom-aware renderers and looks like garbled code everywhere else. Command-C has the same problem because Milkdown's default text clipboard serializer uses the same Markdown serializer, while its HTML clipboard serializer emits a metadata-only sketch figure.

## Requirements

- R1. A Markdown download replaces every valid Thinkroom sketch with an inline rendered SVG and contains no `excalidraw` fence or raw scene JSON.
- R2. Prose, headings, links, lists, and other Markdown remain normal Markdown rather than converting the entire document to HTML.
- R3. Copying a selection that contains a sketch writes rendered SVG in both the plain-text Markdown flavor and rich HTML flavor.
- R4. Copying ordinary text keeps current clean-clipboard behavior, including removal of Thinkroom provenance and suggestion marks.
- R5. Multiple sketches preserve document order, descriptions, and surrounding content.
- R6. Export preparation remains retryable through the existing Share status when SVG rendering fails.

## Key Technical Decisions

- KTD1. Keep editable scene JSON canonical inside Thinkroom; SVG is derived only at export/copy boundaries.
- KTD2. Build portable Markdown with collision-resistant block placeholders in a temporary ProseMirror document, serialize that document with Milkdown, then replace each placeholder with its SVG. This avoids brittle regular expressions over fenced JSON and preserves normal Markdown serialization around each sketch.
- KTD3. Use Excalidraw's asynchronous `exportToSvg` for downloaded Markdown, matching standalone HTML and per-sketch downloads. Use the existing synchronous safe preview renderer for the browser's synchronous clipboard serialization path.
- KTD4. Supply a custom ProseMirror clipboard DOM serializer for sketches while retaining `transformCopied` as the single activity-mark cleanup step. Rich clipboard consumers receive a semantic figure with inline SVG and caption; plain-text consumers receive Markdown with the same figure markup.
- KTD5. Put the shared figure/serialization logic in a small sketch portability module so Markdown download and both clipboard flavors cannot drift.

## Implementation Units

### U1. Portable sketch serialization

- **Goal:** Turn a ProseMirror document or copied slice into normal Markdown with rendered sketch figures.
- **Files:** `app/frontend/editor/sketch/portable.ts` (new), `app/frontend/editor/document_export.ts`
- **Approach:** Walk the document in order, replace valid sketch nodes with unique paragraph placeholders in a temporary tree, serialize through Milkdown, render each sketch, and replace the placeholder with one-line `<figure><svg>…</svg><figcaption>…</figcaption></figure>` markup. Escape accessible caption/label text and omit Thinkroom scene metadata.
- **Test scenarios:** zero, one, and multiple sketches; prose before/after; repeated or adversarial descriptions; nested block context; render rejection; exported output has SVG/caption but no fence, scene JSON, or `data-scene`.

### U2. Clipboard SVG flavors

- **Goal:** Make select-all + Command-C portable without regressing normal copy.
- **Files:** `app/frontend/editor/clipboard.ts`, `app/frontend/editor/sketch/portable.ts`
- **Approach:** Compose the existing `transformCopied`; add a plain-text serializer that uses the copied slice and portable Markdown helper; add a schema-derived DOM serializer whose sketch node renderer emits a semantic figure with synchronous inline SVG. Preserve ordinary nodes/marks and existing plugin behavior.
- **Test scenarios:** copy-all produces SVG in `text/plain` and `text/html`; raw Excalidraw JSON and internal sketch metadata are absent; provenance/suggestion data remains absent; a prose-only selection is unchanged.

### U3. Regression and browser verification

- **Goal:** Lock the reported flows and verify real clipboard/download behavior.
- **Files:** `script/export_check.mjs`
- **Approach:** Update the existing focused export check to assert SVG-only Markdown and both clipboard MIME flavors. Perform the formal browser pass with `agent-browser` against `bin/dev`, covering download content, Command-C, keyboard selection, errors, and production-like read mode.
- **Verification:** `npm run check`, Rails tests, RuboCop, production Vite build, focused export check assertions, and an `agent-browser` smoke test with no page or console errors.

## Acceptance Examples

- AE1. Given prose, a sketch, and more prose, when Markdown is downloaded, then both prose sections remain Markdown and the middle block is an inline SVG figure rather than an `excalidraw` code fence.
- AE2. Given a whole document selection containing two sketches, when Command-C is pressed, then clipboard plain text and HTML each contain two SVGs in document order and no scene JSON.
- AE3. Given a prose-only selection, when copied, then its text and ordinary formatting match current behavior and Thinkroom-only review metadata is absent.

## Risks

- Clipboard serialization is synchronous, while exact Excalidraw export is asynchronous. The existing safe preview renderer is therefore the deterministic clipboard fallback; downloads continue using exact Excalidraw rendering.
- Inline SVG support depends on a Markdown consumer allowing embedded HTML. This is the broadest portable representation available without external files or data URLs and remains readable as ordinary HTML where Markdown permits inline HTML.
- Placeholder replacement must be collision-safe and preserve list/container indentation. Keeping the replacement on one line avoids breaking Markdown container structure.
- Copy is deliberately an outward-facing export boundary: pasting a copied SVG back into Thinkroom does not recreate an editable Excalidraw scene. The canonical editable scene remains available in the live document; retaining private JSON on the clipboard would directly contradict the issue's portability requirement.
