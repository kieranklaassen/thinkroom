---
title: "feat: Make agent-start creation a primary home action"
type: feat
date: 2026-06-26
issue: 96
---

# feat: Make agent-start creation a primary home action

## Summary

Put agent-start creation beside manual document creation in the home hero, while keeping the HTTP prompt behind one clear, reversible interaction.

## Problem Frame

Thinkroom is explicitly agent-native, but the home page currently hides “Have an agent start a doc” in a quiet disclosure below the document library. That hierarchy makes an agent-created document feel secondary even though the product strategy treats external agents and human judgment as peers in the workflow.

## Requirements

- R1. The home hero presents agent-start creation beside “New document” without requiring users to scan below the document library.
- R2. The agent action has enough contrast and visual weight to read as a peer path while “New document” remains the solid primary action.
- R3. Activating the agent action reveals the existing copyable HTTP instruction without creating a document or mutating the clipboard automatically.
- R4. The trigger exposes its expanded state and controls relationship to assistive technology and works from the keyboard.
- R5. The action row and instruction panel remain legible and free of horizontal overflow on narrow screens.
- R6. Document grouping, tags, recents, account controls, feedback, and the agent API contract remain unchanged.

## Assumptions

- The concise hero label is “Have an agent start one”; the revealed panel provides the document and HTTP context.
- The instruction begins closed so protocol detail does not compete with the two creation paths.
- “Open the demo” remains a lower-emphasis optional third action.

## Key Technical Decisions

- KTD1. Use a React-controlled button and panel instead of moving the native disclosure intact. The trigger and content occupy separate hero-width regions, and explicit `aria-expanded`/`aria-controls` preserves accessible disclosure semantics.
- KTD2. Give the agent action a bordered, raised treatment with the same sizing and typography as the primary action. This makes the path prominent without presenting two indistinguishable solid-primary buttons.
- KTD3. Keep one instruction and copy implementation. Remove the old lower-page disclosure rather than exposing duplicate actions that can drift.
- KTD4. Reveal before copying. Clipboard writes remain an explicit second action so the first click is predictable and permission-safe.

## Implementation Units

### U1. Promote agent-start creation into the hero

- **Files:** `app/frontend/pages/documents/index.tsx`
- **Approach:** Add controlled disclosure state, render the agent trigger beside “New document,” place the instruction panel immediately below the hero, and remove the old lower-page disclosure. Keep the existing instruction generation and copy feedback.
- **Verification:** The top action is visible on first paint; it reports closed/open state; opening reveals one copyable prompt; manual creation and demo navigation still work.

### U2. Establish a clear responsive hierarchy

- **Files:** `app/frontend/entrypoints/application.css`
- **Approach:** Add a high-contrast secondary action treatment and hero-adjacent panel styles. Let actions wrap and make the instruction block contain long protocol text at compact widths.
- **Verification:** Desktop shows the two creation paths together; 390px layout has no clipping or horizontal overflow; focus indicators remain visible.

### U3. Update landing regression coverage

- **Files:** `script/browser_check.mjs`
- **Approach:** Replace the bottom-disclosure assertions with checks for the hero-level agent action, initial collapsed state, accessible expansion, and visible copyable instructions.
- **Verification:** The focused browser smoke check passes alongside TypeScript, Vite, Rails, and responsive browser checks.

## Acceptance Examples

- AE1. Given the home page, then “New document” and “Have an agent start one” are visible together before any document list.
- AE2. Given the agent panel is closed, when its trigger is activated by pointer or keyboard, then the prompt appears and the trigger reports expanded state.
- AE3. Given the prompt is visible, when Copy is activated, then the prompt is written to the clipboard and the control briefly confirms success.
- AE4. Given a 390px viewport, then the action row and full instruction fit within the page without horizontal overflow.

## Scope Boundaries

- In scope: home-page prominence, disclosure behavior, responsive styling, and regression coverage.
- Out of scope: changing the agent API payload, embedding an agent, adding a creation wizard, or redesigning the document library.

## Sources

- `STRATEGY.md` — agent-native work is an active product track; Thinkroom does not run an embedded agent.
- `docs/plans/2026-06-26-009-feat-menu-home-ux-audit-plan.md` — prior hierarchy decision and the existing progressive-disclosure implementation that issue #96 intentionally revises.
