---
title: "feat: Clarify document menus and simplify the home page"
type: feat
date: 2026-06-26
issue: 75
---

# feat: Clarify document menus and simplify the home page

## Summary

Make Share about sharing and exporting, move the personal Theme preference into a clearly grouped document menu, and simplify the home page by removing redundant empty-state sections and progressively disclosing technical agent instructions.

## Audit Findings

1. **Share mixes unrelated concerns.** Human collaboration, agent collaboration, export, and personal appearance all live in one popover. Theme does not affect what recipients receive, so it does not belong under Share.
2. **The overflow menu has no information hierarchy.** Side panel, suggestion focus, access controls, account state, deletion, and feedback appear as one list separated only by rules. The popover also claims `role="menu"` while embedding confirmations and other richer controls, which do not follow menu-item interaction semantics.
3. **Share labels describe audiences inconsistently.** “People” and “Your agent” are less direct than “Share link” and “Agent invite,” and the agent explanation exposes protocol detail before the user asks for it.
4. **The empty home repeats absence.** A new visitor sees empty “Your documents” and empty “Recently opened” sections back to back.
5. **Technical setup competes with primary work.** The full agent API prompt is always expanded even though creating or opening a document is the main home-page action.

## Requirements

- R1. Theme is removed from Share and appears in the three-dot document menu.
- R2. The document menu visibly groups view/appearance, access/ownership, account, and help concerns where those groups exist.
- R3. The document popover uses dialog semantics suitable for its mixed controls, with an accurate trigger relationship and accessible group labels.
- R4. Theme switching remains instant, persists across reloads, and retains touch-sized controls in the mobile menu sheet.
- R5. Share contains only link sharing, agent invitation, and export/print actions, with concise task-oriented labels and copy.
- R6. The home page omits “Recently opened” when there are no recent documents instead of showing a second empty state.
- R7. Agent creation instructions remain available on the home page but are collapsed by default behind a native, keyboard-accessible disclosure.
- R8. Existing ownership, editing-lock, account, feedback, export, copy, responsive-sheet, and theme behavior remain intact.

## Key Decisions

- KTD1. Keep Share and the document menu as separate entry points. Share remains a primary header action because collaboration is common; settings and secondary actions stay behind the three dots.
- KTD2. Change the overflow surface from `role="menu"` to `role="dialog"`. It contains a radiogroup, ownership confirmation, account action, and feedback recorder—not a uniform command menu—so dialog semantics are more truthful and require no fake arrow-key menu model.
- KTD3. Add lightweight section labels only where they clarify a real boundary. “View” owns panel/focus/theme, “Access” owns lock/ownership, “Account” appears for signed-in users, and “Help” owns feedback.
- KTD4. Reuse `ThemePicker`; do not create another theme state path. Menu-specific CSS makes its two choices full-width and touch-sized.
- KTD5. Use native `<details>/<summary>` for agent instructions. It provides disclosure semantics, keyboard support, and a no-JavaScript fallback without adding state machinery.
- KTD6. Preserve the home document library introduced by the index redesign. This audit changes hierarchy and progressive disclosure, not grouping, dates, tags, or ownership behavior.

## Implementation Units

### U1. Share and document-menu information architecture

- **Files:** `app/frontend/components/share_popover.tsx`, `app/frontend/components/header_menu.tsx`, `app/frontend/entrypoints/application.css`
- **Approach:** Remove Theme from Share; rename its audience sections to “Share link” and “Agent invite” with shorter explanatory copy. Add a labelled View group containing panel/focus controls and ThemePicker to HeaderMenu. Group access, account, and help content, and change the trigger/popover to dialog semantics.
- **Verification:** Share has no Theme control; the three-dot surface has exactly one Theme radiogroup; ownership/account/feedback render in the correct groups; theme changes instantly and persists; Escape/outside click still dismiss.

### U2. Home-page progressive disclosure

- **Files:** `app/frontend/pages/documents/index.tsx`, `app/frontend/entrypoints/application.css`
- **Approach:** Render Recently opened only when it has content. Convert the always-expanded agent section into a quiet native disclosure with the full copy block inside. Keep sign-in, feedback, primary creation, document groups, tags, GitHub, and creator credit unchanged.
- **Verification:** A fresh browser sees one document empty state and a collapsed agent disclosure; a browser with recents sees the recent library; opening the disclosure reveals a copyable instruction.

### U3. Browser regression coverage

- **Files:** `script/browser_check.mjs`
- **Approach:** Update landing assertions for the conditional recent section and collapsed disclosure. Assert Share contains collaboration/export but no Theme, the document dialog contains grouped Theme controls, theme switching persists, and the mobile menu sheet keeps 44px targets without overflow.
- **Verification:** Focused agent-browser checks pass at desktop and 390px; existing automated regression assertions reflect the new hierarchy.

## Acceptance Examples

- AE1. Given a document, when Share opens, then it presents Share link, Agent invite, and Export—and no Theme control.
- AE2. Given the same document, when the three-dot button opens, then View contains side panel, suggestion focus, and Theme; changing to Whitey updates the mounted page immediately and survives reload.
- AE3. Given a signed-in owner, then Access and Account are distinct, labelled groups and delete remains behind its confirmation.
- AE4. Given a fresh browser on the home page, then only Your documents presents an empty state; Recently opened is absent and “Have an agent start a doc” is collapsed.
- AE5. Given a 390px viewport, then Share and the document menu portal into full-width bottom sheets, their controls remain touch-sized, and the page has no horizontal overflow.

## Risks

- Moving Theme could accidentally leave share-scoped CSS as the only source of full-width/touch sizing. Add explicit header-menu theme styles before removing the share selectors.
- Group labels inside a dialog must not become focusable noise. Use visible text plus `role="group"`/`aria-labelledby`, while keeping only actual controls in the tab order.
- Hiding an empty recent library must not hide real claimable or non-owned recents. The condition is exactly `recent.length > 0`.
- Native disclosure markers vary by browser. Replace only the visual marker, retain native summary semantics, and provide a clear open-state indicator.

