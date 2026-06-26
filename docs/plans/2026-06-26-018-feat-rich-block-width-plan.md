---
title: "feat: Let sketches and tables break out wider than prose"
type: feat
status: active
date: 2026-06-26
issue: 94
---

# Wider sketch and table blocks

## Goal

Let information-dense Excalidraw sketches and tables use more of a wide screen than the readable prose measure, with a separate accessible drag control and persisted viewer preference.

## Decisions

- Use one viewer-level rich-block width preference for sketches and tables. The existing document width is also a viewer preference; keeping this parallel avoids adding non-portable width metadata to Markdown tables or changing shared document source merely because one viewer resized their screen.
- Default rich blocks to 960px on desktop while never shrinking below their containing prose width. Allow adjustment from 640px through 1200px and clamp again to viewport-safe space.
- Put a quiet width control on every live sketch/table so the affordance appears where its effect is visible. Dragging one updates all rich blocks, persists to `pruf_rich_width`, and remains separate from the existing prose-edge control.
- Center breakouts in Read mode and suggestion-focus mode. In ordinary Edit/Suggest/Comment layouts, keep the block's review-gutter edge aligned with prose and expand toward the unused opposite side, capped to the viewport, so margin cards never cover the rich content.
- Support ArrowLeft/ArrowRight, Shift for larger steps, Home, and double-click reset with separator value semantics.
- Keep the first paint aligned with the final editor by applying the server-sanitized cookie as a CSS variable to both static preview blocks and live Milkdown blocks.
- At the existing compact/coarse-pointer breakpoint, rich blocks return to 100% width and controls disappear; tables retain inner horizontal scrolling instead of causing page overflow.

## Implementation

1. Parse and clamp `pruf_rich_width` in `DocumentsController#ui_prefs`, expose it in `DocumentProps`, and initialize a hydration-safe React state/CSS variable.
2. Add a small Milkdown ProseMirror plugin that attaches a shared-width handle to sketch and table node views, observes newly mounted blocks, and emits page-level width change/commit/reset events.
3. Add centered desktop breakout styles for live sketches/tables and their static-preview equivalents, plus mobile, print, focus, and table-scroll containment rules.
4. Add integration tests for preference sanitization and a focused browser check for default breakout, drag/keyboard/reset persistence, table behavior, prose-width independence, read/edit modes, and 390px overflow safety.

## Verification

- Referenced production geometry improves from a 640px sketch at 1440px viewport to the 960px default without page overflow.
- Rich-block drag and keyboard changes do not change `--document-width` or `pruf_width`.
- Reload and another document use the saved rich width on first paint.
- Wide tables use the breakout width and preserve `.table-wrapper` scrolling.
- At 1024px, 768px, and 390px, rich blocks are 100% of the prose content box, handles are hidden, and page overflow is zero.
- Full Rails, RuboCop, TypeScript, Vite builds, focused browser checks, PR CI, deploy, and production verification pass.
