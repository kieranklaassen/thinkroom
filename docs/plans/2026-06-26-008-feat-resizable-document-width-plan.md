---
title: "feat: Make document width responsive and user-resizable"
type: feat
date: 2026-06-26
issue: 72
---

# feat: Make document width responsive and user-resizable

## Summary

Let desktop readers widen the document with a quiet, accessible edge handle, remember that preference without a reload jump, and remove the stale desktop max-width constraints that currently leave the document narrow on iPad and mobile layouts.

## Problem Frame

The document uses `--measure` for both readable prose and the total Read-mode canvas. At the existing 64rem responsive breakpoint the canvas is assigned `width: 100%`, but neither `.doc-main` nor the higher-specificity Read-mode canvas drops its desktop `max-width`. At tablet widths this produces a narrow column with unused space even though the layout has already removed the desktop rail and converted review cards to sheets. Landscape iPads can also exceed a width-only breakpoint, so the compact layout must account for coarse-pointer devices.

On larger screens the fixed measure is good for ordinary prose but gives the user no way to make a table, sketch, code sample, or deliberately spacious document easier to work with. Tables already scroll safely inside their wrapper; widening the whole document lets them use available space without introducing a second, content-specific layout model that could collide with suggestion markers and anchored review UI.

## Requirements

- R1. On sufficiently wide desktop screens, a quiet but persistent handle at the prose edge lets the user widen or narrow the document continuously within safe bounds.
- R2. The handle supports keyboard resizing and exposes its current value and bounds to assistive technology.
- R3. The chosen width persists across documents and renders from the server on the next visit, avoiding a post-hydration layout jump.
- R4. Double-clicking the handle resets to the active theme's default measure.
- R5. Edit, Suggest, Comment, and Read modes use the same chosen document width.
- R6. At the compact breakpoint and on coarse-pointer devices, the document and Read-mode canvas fill the available width; the desktop handle is absent and cannot create horizontal overflow.
- R7. Tables continue to fit the chosen column and retain horizontal scrolling when their minimum content width still exceeds the available space.
- R8. The side rail, suggestion gutter, floating review UI, print layout, and both themes continue to behave correctly.

## Key Decisions

- KTD1. Resize the whole document, not individual tables. The document already has one stable prose/gutter geometry used by anchored review UI; a table-only breakout would overlap the 15rem suggestion gutter or require a second anchor coordinate system.
- KTD2. Store an optional pixel width in a plain `pruf_width` cookie and include the sanitized value in the existing `ui` prop. Numeric values are clamped server-side; absent/invalid values mean “theme default.” This preserves SSR/client first-paint agreement while still allowing each theme's default measure to differ.
- KTD3. Put the zero-width handle in the flex flow immediately after `.doc-main`. Its visual hit target can straddle the exact prose edge without consuming layout width or relying on duplicated position calculations. In Read mode it remains at the canvas edge; in review modes it precedes the existing margin gutter.
- KTD4. Use an interactive ARIA separator with Pointer Events and pointer capture, plus Arrow keys in one-rem steps (Shift+Arrow for larger steps). Home and double-click reset. The handle is CSS-hidden until the viewport has enough room for desktop document + gutter/rail geometry, so tablet layouts stay direct and full-width.
- KTD5. Keep the existing table overflow wrapper. Widening the document naturally gives a wide table more room; exceptionally wide tables still scroll rather than forcing page overflow.

## Implementation Units

### U1. Server-backed width preference

- **Files:** `app/controllers/documents_controller.rb`, `app/frontend/pages/documents/show.tsx`, integration tests
- **Approach:** Parse and clamp `pruf_width` into the existing `ui` prop, initialize width state from it, apply `--document-width` on `.doc-page`, and commit changes back to the cookie. `nil` leaves the CSS theme default intact.
- **Verification:** Valid values survive a reload; invalid, undersized, and oversized cookie values cannot escape the supported range; SSR markup and hydration start from the same width.

### U2. Accessible document-edge resize handle

- **Files:** new `app/frontend/components/document_width_handle.tsx`, `app/frontend/pages/documents/show.tsx`, `app/frontend/entrypoints/application.css`
- **Approach:** Render a zero-width interactive separator after the article. Dragging derives the next width from horizontal pointer movement, clamped to mirrored server/client limits and the usable desktop canvas. Arrow keys resize, Home/double-click reset, and ARIA value metadata names the control. Keep a restrained vertical grip visible at rest and strengthen it on hover/focus/active.
- **Verification:** Drag and keyboard interaction change both `.doc-main` and Read-mode canvas widths; the gutter/rail remain adjacent; reset returns to the theme measure; no horizontal page overflow appears.

### U3. Tablet/mobile full-width repair

- **Files:** `app/frontend/entrypoints/application.css`, `app/frontend/pages/documents/show.css`
- **Approach:** Move the compact breakpoint to 72rem (the first width at which rail + gutter + minimum prose can coexist) and include coarse-pointer devices so landscape iPads are covered. Explicitly remove max-width from `.doc-canvas`, `.doc-main`, and the higher-specificity Read-mode canvas rule. Hide the desktop handle and keep the existing slim review-marker gutter and bottom-sheet behavior.
- **Verification:** At 1024px, 768px, and 390px the canvas fills the viewport, the prose consumes all space not reserved for the marker strip, Read mode is equally full-width, and `scrollWidth === clientWidth`.

### U4. Focused regression coverage

- **Files:** `script/browser_check.mjs`
- **Approach:** Extend the browser regression with default geometry, keyboard resizing, cookie persistence/reload, reset, Read-mode parity, table containment/scroll behavior, and 1024/768/390 viewport assertions. Keep existing mode, panel, editor, and deletion coverage intact.
- **Verification:** The focused browser script and full unit/type/lint/build suite pass.

## Acceptance Examples

- AE1. Given a desktop document at its default width, when the user drags the edge handle 160px right, then the prose and table become wider, the suggestion gutter moves with the edge, and the page does not horizontally overflow.
- AE2. Given a saved custom width, when another document loads, then its first rendered frame uses that width without a narrow-to-wide hydration jump.
- AE3. Given a custom width, when the user double-clicks the handle, then the Thinkroom theme returns to 44rem and Whitey returns to 47rem.
- AE4. Given an iPad-width viewport, when the document is in Edit or Read mode, then the canvas uses the available viewport width and no resize handle or horizontal page scrollbar appears.
- AE5. Given a table whose content is wider than the resized column, then the table wrapper scrolls horizontally while the page itself remains contained.

## Risks

- The configured preference can be wider than the current desktop's usable space when the side rail is open. The flex layout must be allowed to shrink to available width, and the handle's drag maximum must use the current canvas/rail geometry rather than only a global constant.
- A pointer drag can emit many updates. Apply visual state on animation frames and persist only on commit, not on every pointermove.
- The Read-mode max-width rule lives in page-local CSS and has higher specificity than the global responsive rule. It needs its own responsive override or the iPad bug will survive in Read mode.
- Theme defaults differ. Reset must clear the custom override instead of writing one theme's pixel default into the cookie.
