---
title: "feat: Make document mode the primary header state"
type: feat
date: 2026-06-26
issue: 71
---

# feat: Make document mode the primary header state

## Summary

Replace the low-value Markdown/HTML badge beside the document title with a clear mode control, remove the duplicate control from the right-side action cluster, and add Command/Control 1–4 shortcuts for Edit, Suggest, Comment, and Read.

## Problem Frame

The document format badge occupies the most contextual position in the header even though format is immutable and no longer useful during editing. The active interaction mode changes what clicks and typing do, but its control is mixed into the right-side sharing/action cluster. The current dropdown also does not expose keyboard shortcuts or strongly mark the active option.

## Requirements

- R1. The current mode control replaces the Markdown/HTML badge beside the title.
- R2. The right-side header no longer contains a second mode control.
- R3. The trigger explicitly reads as a mode and makes the current state glanceable in every state.
- R4. Command/Control+1, +2, +3, and +4 switch to Edit, Suggest, Comment, and Read respectively.
- R5. The dropdown displays each shortcut and gives the active mode an unmistakable selected treatment.
- R6. Shortcuts and clicks respect existing locks: the demo remains Edit-only and a non-writer remains Read-only.
- R7. Moving the control must not introduce header overflow or an off-screen dropdown on desktop or mobile.

## Key Decisions

- KTD1. Keep `ModeControl` as the single source for labels, order, hints, and shortcuts; the page imports the exported ordered mode list for key handling so UI and behavior cannot drift.
- KTD2. Use a start-aligned popover when the control sits in the left header. Mobile retains the existing full-width sheet behavior.
- KTD3. Register shortcuts on `window` and handle both Meta and Control for platform parity. Use `event.code` (`Digit1`–`Digit4`) with a numeric-key fallback and prevent the browser action only when a valid, unlocked mode switch is handled.
- KTD4. Keep mode state visitor-local and cookie-backed exactly as today; this issue changes navigation and presentation, not collaboration semantics.

## Implementation Units

### U1. Mode control hierarchy and visual state

- **Files:** `app/frontend/components/mode_control.tsx`, `app/frontend/pages/documents/show.tsx`, `app/frontend/entrypoints/application.css`
- **Approach:** Move the existing component after the title, delete the format badge, remove the right-side instance, label the trigger as `<Mode> mode`, add a selected check and shortcut keycap to each option, and start-align the desktop popover.
- **Verification:** Edit/Suggest/Comment/Read each show the correct trigger label; only one mode control exists; the selected option is visually and semantically active; narrow headers do not overflow.

### U2. Command/Control 1–4 switching

- **Files:** `app/frontend/components/mode_control.tsx`, `app/frontend/pages/documents/show.tsx`, `script/browser_check.mjs`
- **Approach:** Export the ordered mode definition and map Digit1–Digit4 in the existing global shortcut effect. Route clicks and keys through one lock-aware mode change callback. Extend the focused browser regression script to exercise shortcut switching and locked behavior.
- **Verification:** 1/2/3/4 select Edit/Suggest/Comment/Read; state persists through the existing cookie path; locked documents do not change.

## Acceptance Examples

- AE1. Given an editable document in Suggest mode, the left side reads “Suggest mode,” the dropdown marks Suggest selected, and the right action cluster contains no mode control.
- AE2. Given an editable document, pressing Command/Control+3 switches to Comment mode and updates the trigger immediately.
- AE3. Given a document locked by its owner, pressing Command/Control+1 leaves the viewer in Read mode.

## Risks

- Command/Control+number is reserved by some browser chrome for tab selection. The application handles the shortcut whenever the browser dispatches it to the page; browser-level interception cannot be overridden by web content.
- The left header is the shrinkable side. The title must remain the only flex item that absorbs width while the mode trigger stays compact and the popover aligns inward.

