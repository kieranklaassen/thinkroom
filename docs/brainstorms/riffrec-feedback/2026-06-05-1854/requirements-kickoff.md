---
date: 2026-06-06
topic: riffrec-2026-06-05-1854-bc6c4e
---

# Pruf feedback: claim visibility, header cleanup, and editor modes

## Problem Frame

A 71-second Riffrec feedback session on `https://pruf.kieranklaassen.com/d/VCDx7RNVtk` captured four explicit, evidence-backed asks: (1) claimable docs in the home Recent list have no claim affordance, (2) the doc-page Claim button is too subtle for an ownership-critical action, (3) the doc header chrome is overcrowded and unscannable with Share buried, and (4) the user wants a Google Docs-style Edit / Suggest / Comment mode switcher. Items 1–3 are friction in existing surfaces; item 4 is a new capability.

Evidence bundle (all repo-relative under `docs/brainstorms/riffrec-feedback/2026-06-05-1854/`):
- `analysis.md` — transcript, selected moments, candidate findings
- `problem-analysis.md` — confirmed, categorized findings
- `source-materials.md` — raw source manifest
- `frames/` — screenshots (local-only)

---

## Actors

- A1. **Browser visitor** — anonymous cookie identity (`owner_token`); can claim unclaimed docs, edit, comment.
- A2. **Doc owner** — visitor whose token claimed the doc; gets delete rights and "Yours" badge.
- A3. **Agents** — create docs via API, propose suggestions, post comments; cannot claim.

---

## Key Flows

- F1. **Claim from home page** — Trigger: visitor sees a claimable doc under Recent. Steps: spot claim affordance on the row → claim without leaving the page (or via a one-hop visit) → row moves to "Your docs". Covered by: R1, R2.
- F2. **Claim from doc page** — Trigger: visitor opens an unclaimed claimable doc. Steps: a prominent banner offers "Claim this doc to your account" → click → doc is theirs, banner dismisses, ownership broadcasts to peers. Covered by: R3, R4.
- F3. **Scan the header** — Trigger: visitor opens any doc. Steps: header reads as: identity/presence · primary Share action · one menu holding secondary chrome (Panel, Focus, etc.). Covered by: R5, R6.
- F4. **Switch editor mode** — Trigger: visitor picks Edit / Suggest / Comment from a mode control. Steps: Edit = today's behavior; Suggest = changes become reviewable suggestions instead of direct edits; Comment = read-only with selection-to-comment. Covered by: R7–R10.

---

## Requirements

**Claim visibility**
- R1. Home-page Recent rows for claimable (unclaimed, non-demo) docs show a claim affordance; claimed and own docs show none.
- R2. Claiming from the home page binds the doc to the visitor's browser identity using the existing atomic first-claim-wins flow, and the UI reflects the result (row moves to "Your docs"; lost race shows the new owner without an error modal).
- R3. On the doc page, an unclaimed claimable doc presents a prominent claim banner ("Claim this doc to your account") instead of relying solely on the small header chip.
- R4. The banner respects existing claim semantics: never on claimed docs, never on the demo doc, GET-inert, dismissible without claiming.

**Header cleanup**
- R5. Secondary chrome controls (Panel, Focus, feedback) collapse into a single menu; the header right side shows at most: identity/presence, mode control, Share, menu.
- R6. Share is the visually primary header action.

**Editor modes**
- R7. The doc page exposes a three-way mode control: Edit, Suggest, Comment. Edit is the default and matches current behavior.
- R8. In Comment mode the editor content is read-only; selecting text offers comment composition (existing comment flow).
- R9. In Suggest mode direct typing does not mutate the shared doc; selections offer "Suggest a change," producing a pending suggestion through the existing suggestion pipeline (margin card, accept/reject) attributed to the human visitor.
- R10. Mode is a per-visitor, per-session UI state — it does not change other collaborators' modes and does not persist server-side.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given an unclaimed agent-created doc in my Recent list, when I activate its claim affordance, then it appears under "Your docs" with me as owner; given someone else claimed it first, I see it's owned by them and no error modal.
- AE2. **Covers R3, R4.** Given I open an unclaimed doc, then a banner reading "Claim this doc to your account" is visible without hunting the header; dismissing it leaves the doc unclaimed and the header chip still available.
- AE3. **Covers R5, R6.** Given I open any doc, then Panel and Focus are inside one menu, Share renders as the single primary button, and the header right side has at most four groups.
- AE4. **Covers R7, R8.** Given I switch to Comment mode, when I type into the doc body, nothing changes in the document; when I select text, I can post a comment.
- AE5. **Covers R9.** Given I switch to Suggest mode and select a sentence, when I submit "Suggest a change" with replacement text, then a pending suggestion appears in the margin attributed to my display name, and the doc body is unchanged until someone accepts it.

---

## Success Criteria

- A claimable doc can be claimed from the home page without opening it.
- The claim CTA on the doc page is unmissable to a first-time visitor.
- The header reads in one scan: who's here, what mode, Share, everything-else menu.
- All three modes work for a guest visitor with no account.

## Scope Boundaries

- **In scope:** the four findings above, on existing browser-identity trust model.
- **Deferred for later:** inline track-changes rendering for Suggest mode (Google Docs-style in-text diff marks) — first version routes suggestions through the existing margin-card pipeline; server-persisted mode preference; comment-mode for agents.
- **Out of scope:** accounts/auth, ownership transfer, edit-gating by mode for *other* collaborators.

---

## Key Decisions

- Evidence first: every requirement traces to the transcript and frames (see `problem-analysis.md`).
- Suggest mode v1 reuses the existing `Suggestion` pipeline rather than introducing track-changes editor infrastructure.
- Mode is client-side per-visitor state, mirroring Google Docs' per-user mode semantics.

## Dependencies / Assumptions

- Claim flow, ownership props, and broadcast events from the 2026-06-05 claim-ownership plan are shipped and stable.
- Suggestion model currently allows `AUTHOR_KINDS = %w[ai agent]`; human-suggested changes need that surface widened.
- Pipeline run (LFG): findings were promoted from evidence without an interactive brainstorm confirmation; the transcript is short and explicit, so promotion risk is low.

## Outstanding Questions

### Deferred to Planning
- [Technical] Exact read-only mechanism in the Milkdown editor for Comment/Suggest modes.
- [Technical] Whether home-page claim is inline (POST from index) or routes through the doc page.
