---
title: "fix: Apply list replacements without jamming Accept all"
type: fix
date: 2026-06-26
issue: 98
---

# fix: Apply list replacements without jamming Accept all

## Summary

Make browser suggestion matching honor the same space-separated rendered text agents receive, including adjacent list items, and let Accept all merge applicable suggestions while leaving invalid targets pending.

## Problem Frame

The agent API exposes a `plain_text` projection that separates rendered text nodes with spaces. It therefore permits a unique quote spanning multiple list items. Browser acceptance only searches within one textblock or across top-level document blocks, so that valid quote is reported missing. Accept all then aborts its entire preflight when any one row is missing, ambiguous, or empty.

## Requirements

- R1. A unique `replaces` quote spanning adjacent list items resolves against the live editor document.
- R2. Replacing a subset of list items preserves a valid surrounding list, and replacing a whole list can change its list type, including ordered-list to task-list conversion.
- R3. Existing inline and top-level multi-block replacement behavior remains unchanged.
- R4. Missing, ambiguous, or empty targets remain pending and never mutate document content.
- R5. Accept all submits and merges applicable suggestions even when other pending suggestions are blocked, and reports that blocked rows remain for individual review.
- R6. The server transitions only the applicable IDs selected by the accepting client while preserving compare-and-set concurrency, one activity entry, and one suggestions broadcast.
- R7. Accepted list content keeps the existing author provenance and persists across reload.

## Assumptions

- The browser remains the applicability authority because only it has the current collaborative ProseMirror/Yjs state.
- A plain-text body replacing part of a list becomes one list item; a list-shaped body contributes its list items to the existing parent list.
- A window covering an entire list resolves to the outer list node so a replacement may change ordered, bullet, or task-list structure.

## Key Technical Decisions

- KTD1. Match normalized rendered text windows at two structural levels: top-level document children and partial sibling windows inside list nodes. Use ProseMirror’s block-separated text projection so nested list text receives the spaces present in the agent API projection.
- KTD2. Prefer the outer top-level node for a whole-list match by excluding a nested window that covers every child. This makes list-type conversions replace the list container instead of trying to insert one list inside another.
- KTD3. Mark partial list windows separately from top-level block windows. The apply path can then wrap paragraph-shaped bodies as list items or reuse list-shaped bodies’ items, maintaining schema-valid content.
- KTD4. Add optional suggestion IDs to the existing bulk endpoint. Omitting IDs retains the endpoint’s current all-pending behavior, while an explicit empty list accepts none.
- KTD5. Keep create-time validation structural-neutral. Rails cannot reliably validate against a live collaborative document snapshot, and rejecting a quote that is valid in the current editor would create a second, stale applicability authority.

## Implementation Units

### U1. Reproduce the list-target failures

- **Files:** `script/suggestion_list_replace_check.mjs`
- **Approach:** Create disposable documents through the local agent API. Cover a partial adjacent-item replacement, a whole ordered-list to task-list conversion, and a bulk batch containing one unrelated valid suggestion plus one missing target.
- **Verification:** The focused check fails on current `main` because the list targets pause or fail to apply.

### U2. Align browser matching and list replacement

- **Files:** `app/frontend/editor/suggestions.ts`
- **Approach:** Replace top-level-only block matching with normalized structural-window matching. Return a list-window match kind for partial list children and adapt parsed replacement content to the list-item schema before dispatch.
- **Verification:** Partial list replacement yields the intended remaining items; whole-list conversion renders task checkboxes; duplicate or missing quotes remain unapplied.

### U3. Make bulk acceptance selective

- **Files:** `app/frontend/pages/documents/show.tsx`, `app/controllers/suggestions_controller.rb`, `app/models/suggestion.rb`, `test/integration/suggestion_flow_test.rb`
- **Approach:** Partition pending rows by live applicability, send applicable IDs, transition only those rows, keep blocked cards visible/pending, and show a concise skipped-target notice after successful merges. Preserve the no-ID compatibility path and compare-and-set loop.
- **Verification:** Integration tests cover selected IDs, explicit empty IDs, omitted IDs, and cross-document exclusion. The focused browser check accepts valid rows while the blocked row remains.

## Acceptance Examples

- AE1. Given three ordered-list items, replacing the second and third items’ `plain_text` with “Merged item” leaves an ordered list containing the first item and the merged item.
- AE2. Given an ordered list, replacing all item text with Markdown task items yields task checkboxes and removes the ordered list.
- AE3. Given one applicable paragraph edit and one missing target, Accept all applies the paragraph edit, leaves the missing suggestion pending, and explains that one row was skipped.
- AE4. Given a quote that occurs in two lists, acceptance treats it as ambiguous and changes neither list.

## Scope Boundaries

- In scope: Markdown/HTML rendered-text matching parity, list-window application, selective bulk transition, notices, and regression coverage.
- Out of scope: server-side parsing of the live Yjs state, changing the public suggestion-create response, automatically rejecting stale suggestions, or resolving overlapping valid suggestions as a dependency graph.

## Risks

- Structural matches at multiple depths can create false ambiguity. Whole-container matches must suppress the equivalent all-children nested candidate.
- Partial list replacement must produce content valid for the current list parent before the transaction dispatches.
- The document can still change after preflight. The existing reopen compensation remains required for that collaboration race.

## Sources

- GitHub issue #98 and production repro document `4PzFN1Y2Pj`.
- `app/services/document_plain_text.rb` — canonical agent-facing space-separated projection.
- `docs/plans/2026-06-08-001-fix-suggestion-replace-duplication-plan.md` — prior quote-matching and no-duplicate acceptance constraints.
