---
title: "An editor dependency bump deletes stored lists when a document opens"
date: 2026-11-25
category: data-integrity
module: "app/frontend/editor schema, prosemirror-model, y-prosemirror"
problem_type: integration_issue
component: prosemirror_plugin
symptoms:
  - "RangeError: Expected value of type boolean for attribute spread on type list_item, got string"
  - "Opening a document that another build wrote removes every list from it, and a reload does not bring them back"
  - "Markdown lists, task lists and untitled images do not appear in a newly seeded document"
root_cause: data_integrity
resolution_type: code_fix
severity: critical
tags: [prosemirror, milkdown, y-prosemirror, yjs, schema, dependencies, data-loss]
---

# An editor dependency bump deletes stored lists when a document opens

## Problem

From version 1.25.12, `prosemirror-model` validates attributes whenever a node is created. Milkdown 7.21.3 declares list `spread` as a boolean but writes the strings "true" and "false", so shared documents store strings. When `y-prosemirror` cannot create a node for a stored element, it catches the error and deletes the element from the shared type (`createNodeFromYElement` in its sync plugin). Opening a document was therefore enough to delete its lists for everyone.

## What didn't work

- **Reading it as a parse failure.** The first visible symptom was a missing task checkbox in a newly seeded document. The damage to documents that already existed was the larger problem, and no CI check opened one.
- **Upgrading Milkdown.** Milkdown 7.22.1 writes booleans, but documents already stored keep their strings, and the validator still rejects those. Its serializers also test `spread` for truthiness, so a stored "false" reads as true.
- **Testing only that loading works.** With `prosemirror-model` held at 1.25.11, which does not validate on creation, the test passed with the fix removed. Calling `doc.check()` on the result validates on every version.

## Solution

`app/frontend/editor/schema_attributes.ts` widens the validators to the values that parsing produces and stored documents contain: `boolean|string` for `spread`, `string|null` for image `alt` and `title`. It exports `markdownPresets`, which the editor and the test share. Order matters: the GFM preset re-registers `list_item`, which would restore the strict validator.

The lockfile also holds three packages, and a lockfile update must keep the hold until each reason is gone:

- `prosemirror-model` 1.25.11. With 1.25.13, rejecting any suggestion throws while a heading or code block that was retyped in Suggest mode is still pending: the suggestion library restores the old `id` or `language` as null, and the validator rejects it. The review panel swallows the error, so Reject does nothing.
- `prosemirror-view` 1.42.4, which has the paste advisory fix (1.42.3 and later). 1.42.5 and later need model 1.25.12. From 1.43.0, dragging or double-clicking text in Read or Comment mode also leaves the browser selection empty.
- `prosemirror-transform` 1.12.0. Versions 1.12.5 to 1.12.7 can build a table header or cell with no paragraph when part of a table is inserted elsewhere (1.12.4 does not), and y-prosemirror deletes such a node. 1.12.1 to 1.12.4 place some inserted blocks differently.

## Prevention

- `test/frontend/schema_attributes.test.mjs` loads a stored document and checks that the shared type is unchanged. Keep the stored state as it is: regenerating it with newer packages removes the values it protects.
- Before merging a bump to Milkdown, ProseMirror or y-prosemirror, open a document stored by `main` in the new build. Compare the shared type and the Markdown before and after, then again after one edit and a reload. A newly created document does not show this failure.
- When adding a validator to a schema, accept every value the shared documents may already hold. A validator that is too strict deletes content.

## Related

- [A document's Yjs state outgrows its saved source](oversized-document-crdt-state.md)
