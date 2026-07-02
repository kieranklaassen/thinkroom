---
title: "fix: Doc header polish — people cluster order, condensed mode menu"
type: fix
date: 2026-07-02
origin: Riffrec feedback bundle (session 383e3ef4, 2026-07-02, recorded on /d/huaxDEEFdc)
---

# fix: Doc header polish — people cluster order, condensed mode menu

## Summary

Alpha feedback (Riffrec recording, 2026-07-02) flagged three visual problems in the doc header:

1. The header right side reads `[• Kieran Klaassen] … big empty gap … [Share] [⋯]`. The gap is the PresenceBar's reserved lane (`min-width: 7.5rem`) sitting between the identity chip and Share whenever no other collaborator is present. Requested: active collaborators on the left, the viewer's own name on the right, no dead gap.
2. The mode dropdown (Edit / Suggest / Comment / Read) is "kind of big" — make it more condensed and refined.
3. The active mode option carries a left accent bar (`inset 2px 0 0` box-shadow) that "looks a little AI" — replace with a subtler selected treatment.

## Problem Frame

All three issues live in the doc page header chrome. No behavior changes — pure presentation: element order within one flex cluster, and CSS sizing/selected-state styling for the mode popover. The PresenceBar reserved-lane mechanism (layout stability on websocket-late presence arrival) must be preserved; only its position changes.

## Requirements

- R1: In `doc-header-right`, presence (active collaborators) renders to the left and the viewer's identity chip renders rightmost within the people cluster, adjacent to Share. The empty presence lane must no longer produce a visible gap between the viewer's name and Share.
- R2: The mode dropdown becomes visibly more compact: narrower popover, tighter paddings/gaps, smaller hint text and shortcut badges. Same four options, hints, and shortcuts remain.
- R3: The active mode option loses the left accent bar; keep a subtle tint + checkmark as the selected indicator.

## Key Technical Decisions

- **Reorder, don't remove, the reserved lane.** The `min-width: 7.5rem` lane in `app/assets/stylesheets/application.css` exists so late-arriving peers don't shove Share/⋯ (see comment block there). Moving PresenceBar to the cluster's left edge makes the empty lane border the flexible header middle, so it is visually indistinguishable from ordinary whitespace, while growth still happens within/into free space instead of pushing controls. `ProvenanceSummaryChip` stays between presence and identity (edit-mode only; not visible in the recording).
- **Condense via CSS only.** Keep hint copy in `mode_control.tsx` unchanged — browser check scripts assert on option labels and the trigger text, and tooltips reuse the hints. Shrink `.mode-control-popover` width (16rem → ~13.5rem), option padding, inter-option gap, hint font size, and `kbd` badge metrics.
- **Selected state = tint + checkmark.** Drop the `box-shadow: inset 2px 0 0 var(--accent)`; keep (slightly soften) the background tint. The checkmark column already communicates selection.

## Implementation Units

### U1. Reorder the header people cluster

**Goal:** Presence on the left, identity chip rightmost next to Share; kill the visible gap.
**Requirements:** R1
**Files:** `app/frontend/pages/documents/show.tsx`, `app/assets/stylesheets/application.css` (comment update only)
**Approach:** In `doc-header-people`, render order becomes `PresenceBar` → `ProvenanceSummaryChip` → `IdentityChip`. Update the reserved-lane comment in the Rails-pipeline stylesheet to reflect the lane now sitting on the cluster's open left edge.
**Test scenarios:** Visual: with zero peers in read mode, no visible gap between the viewer's name and Share; identity chip is immediately left of Share. Existing `script/browser_check.mjs` still passes (no selectors assert cluster order).
**Verification:** Screenshot of read-mode header with a signed-in user shows `[avatars?][name][Share][⋯]` with no dead gap.

### U2. Condense the mode dropdown

**Goal:** Smaller, tighter mode popover.
**Requirements:** R2
**Files:** `app/frontend/entrypoints/application.css`
**Approach:** Reduce `.mode-control-popover` width and padding; tighten `.mode-control-option` padding/gap; shrink `.mode-control-option-hint` and `.mode-control-shortcut` sizes. No TSX changes.
**Test expectation:** none — pure styling; verified visually and by existing Playwright checks that click options by label.
**Verification:** Screenshot of the open menu is visibly more compact than the recording, all four options readable, shortcuts intact.

### U3. Refine the active option treatment

**Goal:** Remove the left accent bar on the selected mode option.
**Requirements:** R3
**Files:** `app/frontend/entrypoints/application.css`
**Approach:** Delete the inset box-shadow from `.mode-control-option.is-active`; keep a soft background tint. Checkmark remains the primary indicator.
**Test expectation:** none — pure styling.
**Verification:** Screenshot of the open menu shows the active row with tint + checkmark only, no left bar.

## Scope Boundaries

- No changes to presence behavior, identity editing, share popover, or mobile sheet layout beyond what the shared CSS rules inherit.
- Hint copy and keyboard shortcuts unchanged.
- Deferred: none.

## Verification Strategy

`npm run check` (TypeScript), `bin/rubocop`, `bin/rails test`, plus manual GUI verification against the dev server (`bin/dev`): header layout with signed-in user, open mode menu before/after screenshots, and a second browser window to confirm presence avatars appear left of the identity chip without shifting Share.
