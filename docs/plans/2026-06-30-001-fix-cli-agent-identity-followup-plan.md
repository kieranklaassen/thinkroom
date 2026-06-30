---
title: "fix: Land the CLI agent-identity fix already in flight (issue #113)"
type: fix
status: ready
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
created: 2026-06-30
---

# fix: Land the CLI agent-identity fix already in flight (issue #113)

## Summary

Issue #113 asks for a `--agent` CLI flag that forwards `X-Agent-Name`, matching the HTTP API. That flag already exists on `main` (added before #115, confirmed by reading `cli/bin/thinkroom.js`). Investigating the issue's own comment thread and PR history shows the *real* gap was already identified and fixed twice over by another agent working this same issue:

- PR #115 (merged, commit `1e77991`) added a flag-omitted warning but kept sending a fabricated `X-Agent-Name: Thinkroom CLI` header.
- PR #123 (open, draft, branch `cursor/fix-cli-agent-identity-provenance-d620`) goes further: it stops fabricating an identity entirely. Write commands now require `--agent`/`THINKROOM_AGENT` and fail fast before any request if omitted; read-only `show` no longer fabricates an `AgentPresence` row either.

PR #123 is mergeable (`mergeStateStatus: UNSTABLE` only because of one red check), still in draft, and its `scan_ruby` failure is stale — re-running CI on the current `main` head shows `scan_ruby` green, so the `crass` advisory PR #123 cited as "pre-existing on main" has since cleared (the gem version didn't change; the advisory database did).

**This plan's job is not to re-implement `--agent` support — it already exists twice over.** The job is to land PR #123's already-correct, already-tested fix instead of authoring a third, conflicting implementation. Re-implementing from scratch would either duplicate #123's diff (wasted, conflict-prone) or regress behind it (re-adding the generic-identity fallback #123 deliberately removed).

**Product Contract preservation:** No separate Product Contract source — this is a direct technical/process decision (rebase-and-land vs. reimplement), not a product-scope change. The product behavior is exactly what issue #113 and PR #123 already describe.

---

## Problem Frame

The CLI's `--agent` flag (and `X-Agent-Name` forwarding) exists today. The actual remaining defect — the one that makes provenance "useless" per the issue — is that omitting `--agent` still silently sends a fabricated identity (`"Thinkroom CLI"`) rather than refusing the write or omitting the header. PR #123 fixes exactly this, in draft, currently blocked only by a stale CI signal and not yet marked ready for review/merge.

## Scope Boundaries

**In scope:**
- Bring PR #123's branch up to date with `main` (currently behind: #115's warning work is already on `main` and superseded by #123's stricter fix; #117, #118 unrelated CLI/editor fixes also landed since #123 branched).
- Re-run CI to confirm `scan_ruby` (and everything else) is green post-sync.
- Mark the PR ready for review (undraft) once green, and merge it (or hand back a ready-to-merge PR if the run can't merge directly).
- Verify the final `cli/bin/thinkroom.js` behavior matches issue #113's literal ask (flag exists, forwards `X-Agent-Name` on `new`/`update`/`suggest`/`comment`) **and** the stricter no-fabrication behavior PR #123 adds, since that stricter behavior is what actually closes the issue's "provenance is useless" complaint.
- Update PR #123's body / add a note so it explicitly closes issue #113 (its current body doesn't reference #113 by number — only the bug description).

**Out of scope / deferred to follow-up work:**
- Any further behavior change beyond what PR #123 already implements (e.g., short flag aliases, config-file-based default agent identity) — not requested by #113 and not present in #123.
- The earlier PR #115 is already merged; no action needed there beyond noting it's superseded.

**Non-goal:** This plan does not re-derive the CLI agent-identity design from scratch. PR #123's design (fail-fast on write commands without identity; `show` stays optional) is treated as settled and correct per its own plan document (`docs/plans/2026-06-28-002-fix-cli-omit-generic-agent-identity-plan.md`) and verification evidence (CLI tests, 471 Rails tests, live-server E2E transcript referenced in the PR body).

---

## Requirements Traceability

- **R1** (from issue #113): CLI write commands (`new`, `update`, `suggest`, `comment`) accept `--agent NAME` and forward it as `X-Agent-Name`. — **Already satisfied on `main`** (pre-dates this plan).
- **R2** (from issue #113, "provenance is useless" complaint): Omitting agent identity must not silently attribute writes to a meaningless generic identity. — **Satisfied by PR #123**, not yet merged. This plan's job.
- **R3** (process requirement for this task): The work that closes #113 must be auto-linked so GitHub closes the issue on merge.

---

## Key Technical Decisions

### KTD1: Land PR #123 rather than re-implement

**Decision:** Sync/update PR #123 onto current `main`, confirm green CI, and merge it (or get it merge-ready) instead of writing new code in `cli/bin/thinkroom.js` for this plan.

**Rationale:** PR #123's diff already implements, tests, and documents the correct fix (verified by reading `cli/bin/thinkroom.js` current state, `cli/test/thinkroom.test.js`, and the PR's own verification section). Re-implementing would either produce a near-duplicate diff that conflicts with #123 on merge, or — if done carelessly from the current `main` baseline — regress to the weaker #115 "warn but still fabricate" behavior, undoing #123's work. Landing existing, reviewed, tested work is strictly better than re-deriving it.

**Alternative considered:** Cherry-pick PR #123's commits into a fresh branch instead of pushing to its existing branch. Rejected — pushing to the existing branch preserves PR #123's review thread, CI history, and avoids opening a confusing duplicate PR for the same fix.

### KTD2: Treat the stale `scan_ruby` failure as a sync problem, not a code problem

**Decision:** Do not attempt to silence, skip, or pin around the `crass` advisory. Confirm `main`'s current CI is green (already verified: latest `main` CI run has `scan_ruby: success`), then sync PR #123 onto `main` so it inherits the same green state.

**Rationale:** The PR's own body already correctly diagnosed this as a transient `ruby-advisory-db` timing issue unrelated to its diff (no `Gemfile.lock` changes in the PR). Verified directly: `main`'s latest CI run (after PR #123 was opened) shows all four jobs green, including `scan_ruby`, confirming the advisory window has closed.

### KTD3: Ensure the merge auto-closes issue #113

**Decision:** Update PR #123's body to include `Fixes #113` (it currently doesn't reference the issue number at all, despite being the actual fix), so merging auto-closes the issue.

**Rationale:** Explicit requirement from the task driving this plan. Without this line, issue #113 stays open after merge even though the fix landed.

---

## Implementation Units

### U1. Sync PR #123's branch with current `main`

**Goal:** Bring `cursor/fix-cli-agent-identity-provenance-d620` up to date so its CI reflects current `main` state (specifically, current `Gemfile.lock` / advisory-db timing) rather than the stale snapshot from 2026-06-28.

**Requirements:** R2, supports KTD1/KTD2.

**Dependencies:** None — first unit.

**Files:**
- No file edits in this unit beyond the merge/rebase itself. Expect `cli/bin/thinkroom.js`, `cli/README.md`, `cli/skill/thinkroom/SKILL.md`, `cli/test/thinkroom.test.js` to carry forward unchanged from PR #123 (no conflicts expected — `main`'s commits since the branch point, #117/#118, touch CLI document-replacement and editor reseed logic, not the agent-identity code path PR #123 modifies).

**Approach:** Update the branch with `main` (merge or rebase — whichever keeps the existing PR's commit history cleanest per repo convention; check recent PR merge commits on `main` for the prevailing style before choosing). Push the result to the existing remote branch so PR #123 picks it up.

**Test scenarios:**
- Test expectation: none — this unit is a branch sync with no source changes; correctness is verified by U2's CI run, not new tests.

**Verification:** `git log` on the branch shows `main`'s latest commit as an ancestor; no merge/rebase conflicts reported.

### U2. Confirm CI is green on the synced branch

**Goal:** Verify all four CI jobs (`lint`, `test`, `scan_javascript`, `scan_ruby`) pass on the synced branch, closing out the stale `scan_ruby` failure.

**Requirements:** R2, KTD2.

**Dependencies:** U1.

**Files:** None.

**Approach:** Push triggers CI automatically; watch the run to completion. If `scan_ruby` (or anything else) is still red after the sync, treat it as a genuine new finding — investigate and fix rather than assuming it's stale a second time.

**Test scenarios:**
- Test expectation: none — this unit observes CI rather than adding tests. (If a fix is needed because something is genuinely red, that fix gets its own test scenarios at the point it's made.)

**Verification:** `gh pr checks 123` (or equivalent) reports all jobs successful.

### U3. Confirm CLI behavior matches issue #113 end-to-end

**Goal:** Independently verify (not just trust the PR description) that the synced branch's `cli/bin/thinkroom.js` satisfies issue #113's literal examples and the stricter no-fabrication fix.

**Requirements:** R1, R2.

**Dependencies:** U1.

**Files:** `cli/bin/thinkroom.js`, `cli/test/thinkroom.test.js` (read-only verification, no edits expected).

**Approach:** Read the synced branch's `cli/bin/thinkroom.js` to confirm: (a) `--agent` is parsed and forwarded as `X-Agent-Name` on `new`/`update`/`suggest`/`comment` exactly as #113's examples show; (b) write commands without `--agent`/`THINKROOM_AGENT` now fail fast with a clear error rather than sending a fabricated identity; (c) `show` (read-only) still works without an agent identity. Run the existing CLI test suite (`npm run check` or repo-equivalent inside `cli/`) to confirm these are covered by passing tests, not just code-read.

**Test scenarios:**
- Covers issue #113's example: `thinkroom new draft.md --title "..." --agent "Claude"` sends `X-Agent-Name: Claude`.
- Covers issue #113's example: `thinkroom update <url> revision.md --agent "Claude"` sends `X-Agent-Name: Claude`.
- Covers issue #113's example: `thinkroom suggest <url> --replaces "..." --body "..." --intent "..." --agent "Claude"` sends `X-Agent-Name: Claude`.
- Covers issue #113's example: `thinkroom comment <url> --body "..." --agent "Claude"` sends `X-Agent-Name: Claude`.
- Write command (any of the four) with no `--agent` and no `THINKROOM_AGENT` set: fails fast (non-zero exit, no request sent), per PR #123's design — this is the behavior that actually closes the "provenance is useless" complaint.
- `THINKROOM_AGENT` env var alone (no `--agent` flag) still forwards correctly.
- `show` with no agent identity: succeeds, does not fabricate presence.

**Verification:** Existing CLI test suite (`cli/test/thinkroom.test.js`) passes in full on the synced branch; manual cross-check of the four issue-#113 example commands against the code path confirms correct header forwarding.

### U4. Link the PR to issue #113 and prepare for merge

**Goal:** Ensure merging PR #123 auto-closes issue #113, and move the PR out of draft once U2/U3 are confirmed.

**Requirements:** R3.

**Dependencies:** U2, U3.

**Files:** PR body (GitHub metadata, not a repo file).

**Approach:** Edit PR #123's body to add a `Fixes #113` line (GitHub's auto-close syntax) if not already present after the sync. Mark the PR ready for review (undraft). Merge if CI is green and the repo's normal merge process allows it from this context; otherwise leave it merge-ready and report status.

**Test scenarios:**
- Test expectation: none — metadata/process step, not code behavior.

**Verification:** `gh pr view 123 --json body` contains `Fixes #113`; `gh pr view 123 --json isDraft` is `false`; issue #113 closes automatically on merge (or, if merge isn't performed in this run, the PR is confirmed mergeable and ready).

---

## Risks & Dependencies

- **Risk:** Syncing the branch could surface a real conflict or a genuinely new CI failure (not just the stale advisory). **Mitigation:** U2 treats any post-sync red check as a real finding requiring investigation, not an assumption of staleness.
- **Risk:** Merging directly from this run could be unexpected if the repo owner wanted to review PR #123 first (it's still in draft, suggesting it wasn't yet considered ready). **Mitigation:** Confirm via PR state/CI before merging; if anything is ambiguous, leave the PR ready-for-review with the `Fixes #113` link and green CI rather than force-merging.
- **Dependency:** GitHub CLI (`gh`) access and push rights to `cursor/fix-cli-agent-identity-provenance-d620` (same repo, so same credentials as this task already has for `kieranklaassen/thinkroom`).

## Definition of Done

- PR #123 is synced with current `main`, CI is fully green, its body contains `Fixes #113`, and it is out of draft.
- The four issue-#113 example commands are confirmed (by test + code read) to forward `X-Agent-Name` correctly, and the no-fabrication behavior is confirmed working.
- Either PR #123 is merged, or it is left in a fully merge-ready state (green CI, no conflicts, linked to #113) with that status clearly reported back.
