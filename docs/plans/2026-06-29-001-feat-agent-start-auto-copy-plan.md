---
title: "feat: Auto-copy the agent prompt when starting an agent doc"
type: feat
date: 2026-06-29
origin: Riffrec feedback recording (thinkroom.kieranklaassen.com, 2026-06-29 15:47Z, 15.8s)
---

# feat: Auto-copy the agent prompt when starting an agent doc

## Summary

On the home page, clicking **"Have an agent start one"** should copy the agent HTTP
prompt to the clipboard at the same time it reveals it, instead of requiring a second
click on the panel's **Copy** button.

## Problem Frame

A Riffrec product-feedback recording captured the product owner on the Thinkroom home
page clicking **"Have an agent start one"** repeatedly and saying:

> "Okay, when I click 'Have an agent start one', I want it to just automatically copy —
> so when you click this, it should send copy."

The recording's event stream confirms repeated clicks on `#agent-start-trigger`
(t≈4.7s, 7.5s, 8.3s) with no copy occurring — the user had to find and click the
separate **Copy** button inside the revealed panel. The expectation is that the primary
agent-start action also puts the prompt on the clipboard so it can be pasted straight
into an agent.

This intentionally revises the earlier decision in
`docs/plans/2026-06-26-019-feat-prominent-agent-start-plan.md` (KTD4 / R3 / AE3:
"reveal before copying; clipboard writes remain an explicit second action"). The new
recorded owner feedback supersedes that choice: the reveal click should now also copy.
Copying inside a click handler is a user gesture, so it stays permission-safe on the
production HTTPS origin.

## Requirements

- R1. Activating `#agent-start-trigger` reveals the HTTP instruction (unchanged) **and**
  copies that instruction to the clipboard in the same action.
- R2. The copy produces visible confirmation (the existing "Copied" state) so the user
  knows the prompt is on the clipboard.
- R3. The panel's manual **Copy** button continues to work for re-copying and as a
  fallback if the automatic copy is unavailable.
- R4. Collapsing the panel (toggling closed) does not copy; keyboard activation and the
  existing `aria-expanded` / `aria-controls` disclosure semantics are preserved.
- R5. No change to the prompt text, the agent API contract, manual "New document"
  creation, or the rest of the document library.

## Key Technical Decisions

- KTD1. Reuse the existing `copyInstruction` callback and `copied` state; trigger the
  copy when the disclosure transitions to open. No new clipboard plumbing, matching the
  convention in `app/frontend/components/share_popover.tsx`.
- KTD2. Copy on open only (not on close). Computing the next open-state outside the
  state updater keeps the copy a single, predictable side effect (no double-fire under
  React StrictMode).
- KTD3. Keep the in-panel **Copy** button. It is the fallback path and the re-copy
  affordance, so the feature degrades gracefully if `navigator.clipboard` rejects.

## Implementation Units

### U1. Copy the agent prompt when the trigger reveals it

- **Files:** `app/frontend/pages/documents/index.tsx`
- **Approach:** Add a click handler for `#agent-start-trigger` that toggles
  `agentInstructionsOpen` and, when the next state is open, calls the existing
  `copyInstruction()`. Leave the prompt generation, the `copied` feedback, and the
  in-panel **Copy** button untouched.
- **Verification:** Clicking the trigger opens the panel and the in-panel **Copy** button
  reads "Copied" without a second click; the prompt is on the clipboard; toggling closed
  does not copy; keyboard activation works and `aria-expanded` still flips.

### U2. Update landing regression coverage

- **Files:** `script/browser_check.mjs`
- **Approach:** In the landing smoke section, replace the "explicit second Copy click"
  assertion with one that verifies the **Copy** button shows "Copied" immediately after
  the trigger click (auto-copy), keeping the existing expand-state assertion.
- **Test scenarios:**
  - Happy path: after `agentStart.click()`, `.landing-agent-block .share-copy` reaches
    text "Copied" without an explicit copy click.
  - Preserved: `aria-expanded` flips to `true` and the instruction panel becomes visible.
- **Verification:** `node script/browser_check.mjs` passes against a running `bin/dev`,
  alongside `npm run check`.

## Acceptance Examples

- AE1. **Covers R1, R2.** Given the home page, when "Have an agent start one" is clicked,
  then the HTTP prompt appears and is on the clipboard with a "Copied" confirmation.
- AE2. **Covers R3.** Given the panel is open, when the **Copy** button is clicked, then
  the prompt is (re)written to the clipboard with confirmation.
- AE3. **Covers R4.** Given the panel is open, when the trigger is clicked again, then the
  panel collapses and no copy occurs; the trigger reports `aria-expanded="false"`.

## Scope Boundaries

- In scope: copy-on-reveal behavior for the home agent-start trigger and its regression
  coverage.
- Out of scope: changing the prompt text or agent API, adding a toast system, restyling
  the hero, or altering `share_popover.tsx`.

### Deferred to Follow-Up Work

- Hardening `copyInstruction` with an explicit `navigator.clipboard` guard / `.catch`.
  The sibling `share_popover.tsx` omits it too; production is HTTPS (secure context) and
  the manual button is the fallback, so this is a separate, optional cleanup.

## Sources

- Riffrec feedback recording (transcript + click events + frames) — the spoken request to
  auto-copy on click, with repeated `#agent-start-trigger` clicks as corroboration.
- `docs/plans/2026-06-26-019-feat-prominent-agent-start-plan.md` — the prior decision this
  plan intentionally revises (KTD4 "reveal before copying").
- `app/frontend/components/share_popover.tsx` — existing `navigator.clipboard.writeText`
  + `copied` convention to mirror.
