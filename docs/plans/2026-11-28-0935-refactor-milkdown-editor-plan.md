---
title: Document Editor Module Split - Plan
type: refactor
date: 2026-11-28
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Document Editor Module Split - Plan

## Goal Capsule

- **Objective:** Someone changing one editor concern can read and change it without reading the rest of `app/frontend/editor/milkdown_editor.tsx`, and readers and writers of documents see no difference.
- **Means:** Extract five cohesive parts into named modules beside the component (KTD1).
- **Authority:** Requirements, then KTDs, then units.
- **Stop conditions:** An extraction that needs an ordering or timing change is left in place. If no extraction makes the file clearly simpler, stop without a pull request.
- **Execution profile:** One PR. The executor implements and verifies; the caller ships.

## Product Contract

### Summary

Move link opening, editor assembly, seed application, document change reporting, and sketch editing out of the component. Keep the collaboration effect in the component as the one place that states the bind and cleanup order.

### Problem Frame

The file is the most often changed frontend file. One component body mixes plugin assembly, the session lifecycle, seed attribution, link handling, and sketch editing, so every change has to be read against all of them.

### Key Decisions

- **Behavior is frozen.** Governs R1, R2. (session-settled: user-directed — chosen over tidying the interface: this is a refactor only)
- **Bugs are reported, not fixed.** Governs R4. (session-settled: user-directed — chosen over fixing in passing: out of scope)

### Requirements

- R1. Exported names, props, and visible behavior of the module stay the same.
- R2. Plugin order, effect order, cleanup order, ref timing, and async races (seed claim, reconnect, read-only switching, provider lifecycle) stay the same.
- R3. Each moved behavior has a check that fails when it breaks.
- R4. No existing test is deleted or loosened, no `script/*_check.mjs` file changes, and no bug is fixed here.

### Scope Boundaries

- The bind and cleanup sequence stays inline in the component's effect. A `useCollabBinding` hook would only move it behind a wide parameter list.
- `EditorProps` and `EditorHandle` stay where consumers import them.

## Planning Contract

### Key Technical Decisions

- KTD1. Split by concern into `link_opening.ts`, `editor_assembly.ts`, `seed_application.ts`, `change_reporting.ts`, and `sketch/use_sketch_editing.tsx`. Table button icon selection joins `table_icons.ts`.
- KTD2. The sketch hook is called after the component's other effects, so its effect stays last. The editor factory reaches it through one ref that the hook assigns during render, replacing three refs. Milkdown runs the factory in a passive effect, after that assignment.
- KTD3. The factory keeps its empty dependency list, so it still captures first-render identity and render hints.
- KTD4. Global stylesheet imports stay in the component module, in order, ahead of local modules. The production CSS must be byte-identical before and after.
- KTD5. (session-settled: user-directed — chosen over reordering for readability: ordering carries races) Seed steps keep their order: consume the one-shot fields, apply the template, connect, attribute, report spans, persist. Governed by R2.

### Assumptions

- Tests are Node tests in `test/frontend/`, the existing home for editor unit tests. That seam catches ordering and guard logic; real ProseMirror wiring stays with the browser checks.

## Implementation Units

### U1. Link opening and table icons

- **Goal:** Move link opening and table button icon selection out of the component.
- **Requirements:** R1, R3
- **Dependencies:** none
- **Files:** `app/frontend/editor/link_opening.ts`, `app/frontend/editor/table_icons.ts`, `app/frontend/editor/milkdown_editor.tsx`, `test/frontend/link_opening.test.mjs`, `test/frontend/table_icons.test.mjs`
- **Approach:** Verbatim move.
- **Test scenarios:**
  - A plain web link opens a new tab with no opener and prevents the default.
  - A `javascript:` link, a right click, an already handled click, and an anchor outside the editor are all left alone.
  - In the native shell a same-origin page uses the bridge, or plain navigation when there is no bridge.
  - Each table button type selects its existing icon.
  - In the native shell a stored file and a cross-origin link still open externally.
- **Verification:** The tests pass, and each fails under a matching mutation.

### U2. Seed application and change reporting

- **Goal:** Move seed consumption and attribution, span and title reporting, out of the effect.
- **Requirements:** R2, R3, KTD5
- **Dependencies:** none
- **Files:** `app/frontend/editor/seed_application.ts`, `app/frontend/editor/change_reporting.ts`, `app/frontend/editor/milkdown_editor.tsx`, `test/frontend/seed_application.test.mjs`, `test/frontend/change_reporting.test.mjs`
- **Approach:** Reporting keeps one animation frame at a time and reads callbacks when it fires.
- **Test scenarios:**
  - A seeded bind runs the KTD5 order and clears the one-shot fields before the template is applied.
  - A human or missing author is persisted without attribution, and no seed means only connect.
  - Attribution marks unmarked text only, outside history, and dispatches nothing when all text is marked.
  - HTML seeds go through the HTML default value.
  - Several document changes in a frame report spans once; a selection change reports none; disposing cancels the frame.
  - A nonempty first heading reports its title, an empty one reports none, and callbacks are read at call time.
- **Verification:** The tests pass, and each fails under a matching mutation.

### U3. Sketch editing hook

- **Goal:** Move sketch state, saves, and the portal into one hook.
- **Requirements:** R2, R3, KTD2
- **Dependencies:** none
- **Files:** `app/frontend/editor/sketch/use_sketch_editing.tsx`, `app/frontend/editor/milkdown_editor.tsx`, `test/frontend/use_sketch_editing.test.mjs`
- **Approach:** The hook returns the portal node and fills the controls ref.
- **Test scenarios:**
  - Insert, save, and delete do not write or persist the document while editing is disabled; delete leaves the draft open, and a controls save still updates a matching draft, as today.
  - A change that alters the document persists at once; one that does not is not persisted.
  - A save through the controls updates the open draft only for the same sketch; the inline editor's change handler writes without updating the draft; closing only closes the same sketch.
  - Delete closes the draft; Done closes it and moves focus only when asked.
- **Verification:** The tests pass, and each fails under a matching mutation.

### U4. Editor assembly

- **Goal:** Move editor configuration and the plugin list into one module.
- **Requirements:** R2, R3, KTD3, KTD4
- **Dependencies:** U1, U3
- **Files:** `app/frontend/editor/editor_assembly.ts`, `app/frontend/editor/milkdown_editor.tsx`, `test/frontend/editor_assembly.test.mjs`
- **Approach:** Same configuration order and plugin order; live values arrive as functions.
- **Test scenarios:**
  - The plugins are used in the existing order.
  - Editability and the refused-edit notice are read at call time.
  - A click handled by an earlier handler does not also open a link.
- **Verification:** The tests pass, each fails under a matching mutation, and built CSS is unchanged.

## Verification Contract

- `npm run check` passes.
- `node --test test/frontend/<file>` passes for each new file and for `warm_rich_blocks.test.mjs`.
- `bin/vite build --mode test` CSS output matches the base commit.
- Targeted browser checks that exercise moved behavior (`link_check`, `native_shell_check`, `sync_check`) pass against an isolated server when one can run safely.

## Definition of Done

- All units meet their verification and R1 to R4 hold.
- Every mutation is restored and no abandoned code remains in the diff.
