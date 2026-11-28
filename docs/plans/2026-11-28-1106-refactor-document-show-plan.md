---
title: Split the Document Page into Hooks and Parts - Plan
type: refactor
date: 2026-11-28
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Split the Document Page into Hooks and Parts - Plan

## Goal Capsule

- **Objective:** A contributor changing one area of the document page can find that area in one named file, and readers and writers of documents notice no difference.
- **Means:** Move contiguous state and effects from `app/frontend/pages/documents/show.tsx` into hooks beside it, and the page header and comment-recovery markup into components (KTD1-KTD4).
- **Authority:** Requirements govern behaviour; key decisions govern structure.
- **Execution profile:** One PR. U1 and U2 move state, U3 moves markup, U4 proves equivalence.
- **Stop conditions:** Stop without a PR when an extraction needs a different effect order, different rendered HTML, or a change to the chunk graph, or when the result is not clearly simpler.

## Product Contract

### Summary

`show.tsx` is 1,308 lines and is edited often. Its remaining responsibilities are separable: appearance, mode routing, panel preferences, mobile sheets, agent presence, the live document channel, provenance review targeting, WebMCP, the header, and comment recovery.

### Requirements

- R1. The default export, `DocumentProps`, rendered markup, class names, ARIA and server/client first render are unchanged, including `useId` values.
- R2. Effects run and clean up in the same order, with the same effective dependencies. Refs mirror values during render, as now.
- R3. The static import graph keeps the same heavy libraries out of the page, and no lazy boundary moves.
- R4. Moved behaviour that no test covers gets a test that fails when it breaks.
- R5. Bugs found on the way are reported, not fixed.

### Scope Boundaries

- No edits to `app/frontend/editor/milkdown_editor.tsx`, `app/frontend/editor/cable_provider.ts`, or `script/*_check.mjs`.
- No test removed or loosened.

## Planning Contract

### Key Technical Decisions

- KTD1. A hook takes only effects that are contiguous today, and is called where its first effect stood. React runs effects in call order, so anything else reorders them.
- KTD2. `textTarget` state stays in the page. Earlier effects clear it, so it cannot be created inside the later targeting hook. Its setter then appears in hook dependency lists because lint cannot see that it is stable; React guarantees its identity, so no effect re-runs.
- KTD3. A component replaces one existing child slot. Replacing several sibling slots with one would change the tree positions that `useId` derives its values from. The rail and mobile sheets stay in the page: each reads most of the page's state, so moving them would only relocate props.
- KTD4. The composer's two toolbars and the two comment lists keep their own slots and share their duplicated props through plain values.

### Assumptions

- Adding a stable setter or ref to a dependency list counts as unchanged effective dependencies (R2).

## Implementation Units

### U1. Page state hooks

- **Goal:** Move appearance, document mode, WebMCP, mobile sheets, panel preferences and shortcuts out of the page (R1-R4).
- **Files:** `app/frontend/pages/documents/show.tsx`, `use_document_appearance.ts`, `use_document_mode.ts`, `use_document_webmcp.ts`, `use_mobile_sheets.ts`, `use_panel_preferences.ts`, `use_document_shortcuts.ts` beside it; `test/frontend/document_page_hooks.test.mjs`.
- **Approach:** `use_document_mode.ts` exports two hooks: an effect-free one that derives the mode where it is derived today, and one holding only the replace-with-Read effect, called between the panel-cookie effects and the shortcut effect. The two short export callbacks stay in the page.
- **Pattern:** `use_follow_presence.ts`; hook tests follow `test/frontend/use_comments.test.mjs`.
- **Test scenarios:** A mode change pushes the right URL and props, and does nothing when locked, unavailable or current. A now-invalid mode is replaced by Read, except on the demo. Each shortcut does its action and leaves other keys alone. Theme, width and panel changes write their cookies. Rich-width events store only on commit. Leaving mobile closes the sheet. A WebMCP call sees the ownership, mode and handle current at call time.
- **Verification:** `npm run check`, the new test file, and each scenario failing under a mutation.

### U2. Live document and review hooks

- **Goal:** Move agent presence, the document channel, and review targeting out of the page (R1-R4).
- **Dependencies:** U1.
- **Files:** `app/frontend/pages/documents/show.tsx`, `use_editor_presence.ts`, `use_document_channel.ts`, `use_text_targeting.ts` beside it; `test/frontend/document_page_hooks.test.mjs`.
- **Test scenarios:** The presence poll runs only while agents are shown. Deletion and content reset stop the poll before leaving. Access reloads ask for the right props for owners and others. A denied write listener is removed on cleanup. Selection dispatch picks selection, mobile suggestion, paragraph comment or review in that order; a document change never opens a target and reports a lost review passage. Closing a review returns focus to its trigger.
- **Verification:** As U1.

### U3. Header and comment recovery components

- **Goal:** Move the header and comment-recovery markup into `app/frontend/components/` and remove the repeated update button and panel props (R1, KTD3, KTD4).
- **Files:** `app/frontend/pages/documents/show.tsx`, `app/frontend/components/document_header.tsx`, `app/frontend/components/comment_recovery.tsx`, `app/frontend/components/version_update_button.tsx`; `test/frontend/comment_recovery.test.mjs`.
- **Test scenarios:** Recovery renders each state: failed with and without an anchor, uncertain, checked missing, no access, and a plain notice. Server HTML of the page is byte-identical before and after.

### U4. Equivalence proof

- **Goal:** Show R1-R3 against the base commit.
- **Dependencies:** U1-U3.
- **Verification:** Compare server HTML of the page across prop variants, the order of registered effects, and the production chunk graph, base against branch. Run the focused browser checks in the machine's queue. These comparisons are run-only and are not committed.

## Verification Contract

- `npm run check`
- `node --test` on the new and neighbouring frontend tests
- `bin/vite build`, client and server
- Browser checks for collaboration, compound writing, the highlighter and WebMCP against an isolated server with a throwaway database

## Definition of Done

- `show.tsx` is clearly shorter, with each moved concern in one named file and no unused code left behind.
- Every requirement has evidence from the verification contract.
- Each new test was seen failing under a mutation that was then restored.
- An open, non-draft PR against main exists.
