---
title: "fix: Make sketches belong to the active theme"
type: fix
date: 2026-06-26
---

# fix: Make sketches belong to the active theme

## Summary

Make inline sketches visually disappear into the Whitey document theme: square geometry, neutral surfaces, restrained Swiss-style borders and controls, and no warm paper, tape, dots, or brown shadows. Keep the current tactile sticky-note treatment in the Thinkroom theme and leave sketch scenes, persistence, layout, and editing behavior unchanged.

---

## Problem Frame

The document themes already diverge at the page-token level, but the inline-sketch CSS is mostly hard-coded to the warm Thinkroom palette. As a result, Whitey documents still contain rounded cream paper, a dotted texture, tan tape, brown shadows, and warm editing chrome. The sketch looks pasted onto the page instead of belonging to Whitey's white, minimal, sans-serif system.

The same wrapper moves between preview and editing states, and the active theme can change instantly through `document.documentElement.dataset.theme`. The fix therefore needs one coherent sketch presentation contract that reacts to the existing theme selector without remounting the editor, rewriting scene data, or changing the fixed paper dimensions that protect first paint and collaboration.

---

## Requirements

### Theme identity

- R1. In the default Thinkroom theme, inline sketches retain their current warm paper, dotted texture, rounded shape, tape, depth, and tactile controls.
- R2. In the Whitey theme, sketch preview and editing surfaces use only neutral white/gray/black colors derived from the theme, with no cream, tan, brown, or warm accent treatment.
- R3. Whitey sketches use square outer, preview, caption, canvas, resize, Excalidraw island, and sketch-control geometry, with no tape or paper shadow.
- R4. Whitey's caption and controls use the existing sans-serif UI type and restrained borders so the sketch reads as part of the document rather than a decorative card.

### State and behavior continuity

- R5. Switching themes updates an already-mounted sketch immediately in preview and edit states; it does not require reload or sketch remount.
- R6. Preview, selected, hover, editing, focus, loading, error, delete, download, resize, read-mode, and print behavior remain usable in both themes; caption and action text maintain at least WCAG AA 4.5:1 contrast against their surfaces.
- R7. Existing sketch height, viewport fitting, exact SVG rendering, persistence, synchronization, accessibility labels, keyboard activation, and scene/source formats are unchanged.
- R8. Whitey styling remains square and neutral at the existing narrow-screen breakpoint and does not introduce horizontal overflow or smaller touch targets.

---

## Assumptions

- The issue's “YD” theme refers to the existing `whitey` theme key and Whitey/Typora-inspired design.
- “Disappears” means the sketch becomes visually native to the document theme, not that its boundary, caption, edit affordances, or accessible controls are removed.
- Swiss means square geometry, flat hierarchy, neutral surfaces, crisp rules, and sans-serif control typography; it does not require a new font dependency or a redesign of Excalidraw's drawing content.
- Scene elements keep their authored colors. Theme styling applies to the sketch container and editor chrome, not to user-created marks inside the exported SVG.

---

## Key Technical Decisions

- KTD1. **Introduce sketch-local presentation tokens with Whitey overrides.** Define the warm defaults alongside the global design tokens, override them under `[data-theme='whitey']`, and have the shared sketch rules consume them. This keeps both themes explicit without duplicating the entire sketch stylesheet or relying on React theme state.
- KTD2. **Keep theme selection CSS-driven.** The existing `data-theme` mutation already restyles the page instantly. Theme-scoped custom properties and the tape pseudo-element selector will update mounted previews and the active Excalidraw portal in place.
- KTD3. **Preserve DOM and sketch data contracts.** No class-name, scene-schema, ProseMirror node, height, viewport, or persistence changes are needed. The work is presentation-only except for a browser regression that reads computed styles.
- KTD4. **Move Whitey's delete affordance off the tape position.** Thinkroom keeps the centered tape delete control; Whitey receives a square neutral control in the upper-left while download remains upper-right, avoiding overlap and removing the last tape metaphor.
- KTD5. **Test semantic visual invariants rather than screenshot pixels.** Browser checks will assert tape visibility, geometry, shadow, and representative surface colors in both preview and edit states. Those checks directly encode the issue while avoiding brittle whole-page image diffs.

---

## Scope Boundaries

### Included

- Theme-specific sketch container, preview, caption, editor, resize handle, Excalidraw toolbar island, delete, and download presentation.
- Responsive preservation of square Whitey geometry.
- Browser regression coverage for live theme changes and preview/edit computed styles.

### Outside this change

- Altering Excalidraw scenes, authored element colors, serialization, Markdown/HTML sketch source, exported SVG output, or the document export pipeline.
- Renaming themes, adding a third theme, introducing a font package, or redesigning the overall editor and theme picker.
- Changing sketch dimensions, viewport fitting, loading strategy, collaboration, read-mode permissions, or insertion flows.

---

## Implementation Units

### U1. Theme-aware sketch presentation tokens and styles

- **Goal:** Express Thinkroom's existing tactile sketch treatment and Whitey's neutral Swiss treatment through one theme-reactive CSS contract.
- **Requirements:** R1-R6, R8.
- **Dependencies:** None.
- **Files:** `app/frontend/entrypoints/application.css`.
- **Approach:** Add sketch-specific custom properties to `:root` for surfaces, borders, shadows, radii, texture, and control chrome; override them under `[data-theme='whitey']`. Replace hard-coded warm values in the sketch wrapper, preview, caption, editor, canvas, resize handle, selected/editing states, and toolbar islands with those properties. Hide `::after` tape in Whitey, neutralize `::before`, and reposition/restyle the delete affordance as a square top-left control. Update the mobile radius rule to consume a theme token so Whitey cannot regain rounding below 700px.
- **Patterns to follow:** The existing global token/Whitey override blocks at the top of `application.css`; existing theme-scoped provenance and comment selectors; the UI guideline preference for the lightest sufficient surface separation and responsive invariants.
- **Test scenarios:** Thinkroom retains tape, warm surface, radius, and shadow; Whitey has no tape, zero radius, no paper shadow/texture, neutral preview and caption surfaces, neutral selected/editing borders, square editor chrome, and distinct non-overlapping delete/download controls; caption and action text reach a 4.5:1 contrast ratio and both themes retain visible focus and hover states; Whitey stays square at a narrow viewport.
- **Verification:** Type/build checks pass and live browser inspection shows an already-mounted sketch switching cleanly between the two visual systems in preview and edit states.

### U2. Browser regression for both theme states

- **Goal:** Prevent warm paper or rounded geometry from leaking back into Whitey while protecting the Thinkroom identity.
- **Requirements:** R1-R8.
- **Dependencies:** U1.
- **Files:** `script/browser_check.mjs`.
- **Approach:** Extend the existing inline-sketch scenario before deletion. Toggle the mounted document's `data-theme` to Whitey, read computed styles from the wrapper, pseudo-element, preview, caption, editor/canvas, resize handle, and representative Excalidraw island/control, and assert the neutral/square/flat invariants and text contrast. Exercise both closed and editing states at the existing 1280px viewport, then add a narrow-viewport pass for the responsive invariant. Restore Thinkroom and assert tape, rounding, and warm depth return without reload; leave all existing persistence, exact-render, read-mode, and deletion checks intact.
- **Patterns to follow:** Existing geometry and first-frame assertions in the sketch section of `script/browser_check.mjs`; the later theme switch/persistence scenario for `data-theme` behavior; existing `ok`/`fail` reporting style.
- **Test scenarios:** Whitey restyles a closed persisted sketch immediately; opening that same sketch preserves neutral square editor chrome; a narrow Whitey viewport remains square and overflow-free; switching back restores the tactile Thinkroom paper; scene content and height remain unchanged across theme switches.
- **Verification:** `script/browser_check.mjs` completes with the new theme-specific sketch assertions and all existing sketch/theme checks green.

---

## System-Wide Impact

- **Data and collaboration:** None. Theme changes remain browser presentation state; no Yjs, database, Markdown, HTML, or API payload changes.
- **SSR and hydration:** The server already emits `data-theme` before the app mounts. CSS variables apply to the static preview and hydrated editor consistently, so no new client-only first frame is introduced.
- **Accessibility:** Existing labels, keyboard actions, focus rings, and touch sizing remain. Neutral Whitey controls must keep sufficient contrast and visible focus against white surfaces.
- **Performance:** A small set of CSS custom properties and selectors replaces hard-coded declarations. No new JavaScript, assets, font downloads, or render work is added.
- **Agent parity:** Agents continue to read and write the same sketch source. The change affects only how humans see that source in each theme.

---

## Risks and Dependencies

- **Incomplete warm-color removal:** A single hard-coded cream/brown value in edit, selected, or control states could keep the sketch visually inconsistent. Mitigation: inventory every selector in the sketch CSS block and assert representative preview and editing computed styles.
- **Responsive selector precedence:** The existing mobile rule directly sets a radius and could override Whitey. Mitigation: route mobile geometry through a theme-specific variable and cover a narrow viewport.
- **Excalidraw internal selector drift:** `.Island` and `.ToolIcon__icon` are library-owned classes. Mitigation: keep overrides cosmetic, verify the current installed version, and avoid depending on internal markup for core behavior.
- **Control overlap after removing tape:** Repositioned delete and existing download controls share the sketch overlay. Mitigation: assign opposite corners and inspect hover/focus at desktop and coarse-pointer sizes.
- **Browser test brittleness:** Browser engines serialize colors differently. Mitigation: compare normalized computed values or semantic properties rather than source CSS strings and avoid whole-page pixel snapshots.

---

## Acceptance Examples

- AE1. Given a Whitey document containing a saved sketch, when it first appears, then the sketch is square, flat, white/neutral, and tape-free while the drawing and caption remain visible.
- AE2. Given that Whitey sketch, when the owner opens it, then the canvas, resize bar, toolbar islands, caption, and controls remain square and neutral with no warm paper leaking through.
- AE3. Given an already-mounted sketch, when the user switches between Whitey and Thinkroom, then the presentation changes immediately without altering the drawing, title, height, or editability.
- AE4. Given a Whitey sketch on a narrow screen, when the layout crosses the existing 700px breakpoint, then the sketch stays square, fits the document width, and keeps usable overlay controls.
- AE5. Given a Thinkroom document, when the same sketch is viewed after this change, then its rounded cream paper, dotted texture, tape, and tactile depth remain intact.

---

## Sources and Research

- GitHub issue #68, `theme fixes`, defines the target: the Whitey/YD sketch should disappear into its theme through square Swiss styling with no warm colors.
- `app/frontend/entrypoints/application.css` defines the global `proof`/`whitey` token system and all current sketch presentation, including the hard-coded cream surfaces, tape pseudo-element, brown shadows, radii, edit states, and mobile radius override.
- `app/frontend/editor/sketch/node_view.ts` establishes the stable wrapper, preview, caption, delete, download, editor-mount classes and instant in-place lifecycle that CSS can safely theme.
- `app/frontend/editor/sketch/sketch_inline.tsx` establishes the active editor and resize structure; no React theme state is needed.
- `script/browser_check.mjs` already covers sketch insertion, exact SVG preview, fixed height, reload, Retina rendering, read mode, deletion, and instant theme switching; the new visual invariants belong in that flow.
- `docs/plans/2026-06-24-002-feat-inline-excalidraw-sketches-plan.md` and `docs/plans/2026-06-25-003-fix-sketch-height-clamp-plan.md` document the sketch behavior and layout contracts this CSS-only fix must preserve.
- `STRATEGY.md` favors focused interfaces for deliberate human modes; making sketches native to each reading theme improves that focus without expanding product scope.
