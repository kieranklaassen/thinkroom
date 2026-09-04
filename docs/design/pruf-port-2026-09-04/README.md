# Pruf UI port: plans and screenshot references

The user selected these improvements from the Proof-from-scratch benchmark: theme switching, sidebar/comments presentation, and guided review.
This is a planning package, not an implementation or deployment.

## Independent improvements

| Improvement | Plan | Units | Landing relationship |
|---|---|---:|---|
| Theme picker and theme fidelity | [Implementation plan](../../plans/2026-09-04-1101-feat-theme-picker-polish-plan.md) | 3 | Good first landing: shared theme and shortcut ownership. |
| Sidebar and activity timeline | [Implementation plan](../../plans/2026-09-04-1101-feat-sidebar-activity-timeline-plan.md) | 3 | Independent; coordinate shared chrome and preference edits. |
| Anchored comment cards | [Implementation plan](../../plans/2026-09-04-1101-feat-anchored-comment-cards-plan.md) | 3 | Independent of filters; coordinate annotation/rail placement. |
| Guided provenance review | [Implementation plan](../../plans/2026-09-04-1101-feat-guided-provenance-review-plan.md) | 3 | Independent functional improvement; coordinate header edits. |

Each plan is self-contained and has plan-local U1-U3 identifiers. Do not confuse units from different plans.
Use separate implementation PRs; serialize edits to shared document-page/chrome files or reconcile them before landing.

## Captured evidence

Screenshots were captured on 2026-09-04 at 1600 × 1050 from the existing container-hosted benchmark preview, using its demo document. These are actual rendered UI, not mockups. Theme/filter changes were browser-only; no comment, suggestion, or review mutation was submitted.

| Image | What to borrow |
|---|---|
| [Theme picker](theme-picker.png) | Direct trigger, visual swatches, descriptions, selected state. |
| [Whitey theme](whitey-theme.png) | Editorial typography and page-wide theme treatment; adapt width to Thinkroom. |
| [Activity sidebar](activity-sidebar.png) | Quiet timeline, actor/type hierarchy, timestamps, filter chips. |
| [Comment cards](comment-cards.png) | Readable card anatomy and explicit stale-anchor state beside suggestions. |
| [Guided review](guided-review.png) | Clicking the unreviewed summary reveals the passage and a clear next action. |

## Baseline and limits

- Source benchmark: LFGBench run `01M1545XV8CV5PF3NGYS9CPPSA`, Proof from scratch.
- Target source baseline: Thinkroom main `259fad051e62b0f03bcf34b1cd3dda1102e4ed28`, verified against GitHub on 2026-09-04.
- Thinkroom already has theme persistence, optimistic comments, anchor navigation, and current-span review transitions. The plans extend those capabilities rather than claiming they are absent.
- Production's demo could be read, but interactive hydration did not become ready during screenshot capture. It is not used as a visual before-state or as evidence of a verified deployed commit.
- Reference source files are named within each plan. The generated workspace is not the target repo; adapt patterns rather than copying its types or APIs unchanged.
- No private model identifier, credential, account settings, or unrelated document content is included.
- The reference's embedded Ask AI and threaded Reply feature are not included in this UI port. Thinkroom's external-agent model and existing comment contract remain intact.

## Release boundary

Publishing these plans and issues does not merge or deploy application code. Implementers must verify against the current main branch before starting and follow the repository's development, review, and deployment instructions.
