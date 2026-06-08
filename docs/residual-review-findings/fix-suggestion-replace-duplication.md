# Residual Review Findings — fix/suggestion-replace-duplication

Source: ce-code-review run `20260608-090630-e732cef8` (LFG pipeline, 2026-06-08).
Verdict: Ready with fixes — P1 and six P2 findings applied in-branch (`fix(review): apply review findings`); the three residual actionable findings below were filed to GitHub Issues.

## Residual Review Findings

- **P2** `app/models/suggestion.rb:55` — Cap the accept_all batch size (unbounded N×128KB response inside one SQLite write transaction) — [#21](https://github.com/kieranklaassen/pruf/issues/21)
- **P2** `app/frontend/editor/suggestions.ts:97` — Block matching should require node-type equality, not just text equality (paragraph text can satisfy a heading quote and be destructively replaced) — [#22](https://github.com/kieranklaassen/pruf/issues/22)
- **P2** `app/frontend/pages/documents/show.tsx:412` — Gate per-card acceptOne while Accept all is in flight (redundant overlapping request; CAS makes it harmless but noisy) — [#23](https://github.com/kieranklaassen/pruf/issues/23)

Report-only items (owner: human) retained in the review artifact at `/tmp/compound-engineering/ce-code-review/20260608-090630-e732cef8/`: replaceRange-branch test coverage, matcher wrapper indirection, confirm-then-merge orphan window (architectural, pre-existing trade-off), double partial reload (deliberate belt-and-braces), AgentGuide doc notes on `replaces` quoting and bulk-accept events.
