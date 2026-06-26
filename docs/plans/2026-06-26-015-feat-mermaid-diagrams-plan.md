---
title: "feat: Render Mermaid Markdown diagrams"
type: feat
status: active
date: 2026-06-26
issue: 85
---

# Render Mermaid Markdown diagrams

## Goal

Make fenced `mermaid` blocks useful in Thinkroom documents: render valid Mermaid source as a safe, responsive diagram while preserving the original Markdown as the collaborative source of truth.

## Product decisions

- A fenced `mermaid` code block remains an ordinary ProseMirror code block. This preserves Markdown round trips, live collaboration, history, provenance, and exports without introducing a second source format.
- Edit mode shows the rendered diagram and its editable source. Read-only modes show the diagram alone when rendering succeeds.
- Invalid or unsupported Mermaid never removes content. It shows a concise render error and leaves the source visible in every mode.
- Diagram rendering is browser-only, lazy-loaded, and configured with Mermaid's strict security mode. The returned SVG is sanitized before insertion.
- The server-rendered first paint uses a neutral Mermaid placeholder so raw source does not flash before the live editor mounts.

## Implementation

1. Add Mermaid as a direct frontend dependency and create an editor plugin that decorates `code_block` nodes whose language is `mermaid`.
2. Render each diagram asynchronously with stable, collision-free IDs; discard stale results when source changes; sanitize SVG; and degrade to the source block on any error.
3. Add responsive, theme-compatible diagram, loading, source, and error styling, including read-mode source hiding only after success.
4. Preserve Markdown code-language metadata in the static preview long enough to replace Mermaid blocks with height-reserving placeholders.
5. Add server preview tests and a focused Playwright check covering valid rendering, invalid fallback, edit/read behavior, source round-trip fidelity, responsive layout, and cleanup.

## Verification

- `npm run check`
- `bin/rails test test/services/document_preview_html_test.rb`
- `bin/rails test`
- `bin/rubocop`
- focused Mermaid browser check against `bin/dev`
- production Vite build
- code review and simplification passes
- production deployment followed by the same valid/invalid/read/edit verification

## Non-goals

- A bespoke visual Mermaid editor.
- Converting Mermaid diagrams to Excalidraw scenes.
- Persisting rendered SVG in the document or database.
