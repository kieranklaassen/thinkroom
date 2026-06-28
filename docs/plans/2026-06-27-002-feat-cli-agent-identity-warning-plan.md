---
title: "feat: Warn when CLI writes fall back to a generic agent identity"
type: feat
date: 2026-06-27
---

# feat: Warn when CLI writes fall back to a generic agent identity

## Summary

The `--agent` flag the PR asks for is **already implemented** on `main`: `cli/bin/thinkroom.js` parses `--agent`, resolves it through `agentName()` (`--agent` → `THINKROOM_AGENT` → default `"Thinkroom CLI"`), and forwards it as the `X-Agent-Name` header on `new`, `update`, `suggest`, `comment`, and `show`. Every example in the PR works today.

The residual gap is the PR's actual motivation: when an agent forgets `--agent` (and no `THINKROOM_AGENT` is set), writes are **silently** attributed to the generic `"Thinkroom CLI"` identity. The PR states this exact failure: "this makes provenance useless — you can't tell which agent wrote what." The raw HTTP API surfaces the missing-identity case loudly (suggestions/comments return 422 via `require_agent!`), but the CLI masks it with a default. This plan closes that gap with a non-breaking, stderr-only warning on write commands — the same pattern `git` uses when committing with a fallback identity.

## Problem Frame

`agentName()` always returns a non-empty string, so the CLI always sends `X-Agent-Name`. That is convenient but hides the difference between "I am Claude" and "I forgot to say who I am." In a multi-agent workflow the silent default produces misattributed provenance with no signal to the operator. We want to keep the convenient default (no breaking change) while making the fallback visible so agents and humans are nudged to identify themselves.

## Requirements

- R1. Running a write command (`new`, `update`, `suggest`, `comment`) without `--agent` and without `THINKROOM_AGENT` prints a single clear warning to **stderr** naming the generic identity in use and how to set a real one.
- R2. The warning is suppressed when identity is provided via `--agent` **or** `THINKROOM_AGENT`.
- R3. The warning does not change the `X-Agent-Name` header value (still `"Thinkroom CLI"` on fallback), stdout output, JSON output, or exit codes — behavior stays backward compatible.
- R4. The read-only `show` command stays silent (no warning), since it does not create provenance.
- R5. CLI test coverage verifies: fallback warns + still sends the default header; `THINKROOM_AGENT` suppresses the warning and sets the header; `show` without identity does not warn.

## Key Technical Decisions

- **Warn, do not error.** A non-zero exit would break the legitimate convenience default and the create path (the server permits header-less `POST /api/docs`). A stderr warning matches `git`'s default-identity nudge and keeps pipelines working.
- **stderr only.** Warnings must never pollute stdout (share URLs) or `--json` payloads, both of which are parsed by callers. Existing tests assert stdout exactly and only use stderr as a failure message, so an added stderr line is safe.
- **Distinguish explicit vs. fallback at resolution time.** Replace the single `agentName()` return value with a resolver that reports whether identity was explicit, then a write-only helper emits the warning. `show` calls the resolver without the helper.
- **Keep the `"Thinkroom CLI"` default in one place.** Promote the literal to a `DEFAULT_AGENT_NAME` constant so the resolver and the warning message stay in sync.
- **No version bump.** The `--version` test pins `0.1.0`; a release bump is the maintainer's call at publish time and is out of scope for this behavior fix.

## Scope Boundaries

- Does not make `--agent` required, nor change the resolution precedence (`--agent` → `THINKROOM_AGENT` → default).
- Does not change the header sent on fallback (still `"Thinkroom CLI"`).
- Does not touch server-side attribution (`Api::BaseController#current_agent`, `require_agent!`) — it already behaves correctly.
- Does not disambiguate the unrelated `--agent` flag on `init` / `skill install` (selects a skill directory); that naming overlap is pre-existing and out of scope.

### Deferred to Follow-Up Work

- Optionally persisting a default agent name in the CLI config file (`thinkroom login`/`config.json`) so a machine can set its identity once. Not needed to fix provenance visibility.

## Implementation Units

### U1. Surface the fallback identity on writes

**Goal:** Warn (stderr) when a write command resolves to the generic default identity, while preserving all existing behavior.

**Requirements:** R1, R2, R3, R4.

**Files:**
- `cli/bin/thinkroom.js` (modify)

**Approach:**
- Add `const DEFAULT_AGENT_NAME = 'Thinkroom CLI'` and use it inside the resolver.
- Replace `agentName(options)` with `resolveAgent(options)` returning `{ name, explicit }`, where `explicit = Boolean(options.agent || process.env.THINKROOM_AGENT)`.
- Add `writeAgent(options)`: calls `resolveAgent`, and when `!explicit` writes a one-line warning to `process.stderr` (e.g. `Warning: No agent identity set; attributing this write to "Thinkroom CLI". Pass --agent NAME or set THINKROOM_AGENT so your edits are attributed to you.`), then returns `name`.
- `createDocument`, `updateDocument`, `suggest`, `comment` use `writeAgent(options)`; `showDocument` uses `resolveAgent(options).name` (no warning).

**Patterns to follow:** existing `agentName(options)` usage and the `process.stderr.write(...)` calls already used in `login` for human-facing notices.

**Test scenarios:** covered in U2 (the CLI is exercised end-to-end as a spawned binary, so behavior is verified there rather than via unit calls).

**Verification:** `new`/`update`/`suggest`/`comment` without identity emit the warning to stderr; with `--agent` or `THINKROOM_AGENT` they do not; the `X-Agent-Name` header and stdout are unchanged in both cases.

### U2. Cover the fallback-warning behavior

**Goal:** Lock the new behavior with tests in the existing Node test suite.

**Requirements:** R5 (and guards R1–R4).

**Files:**
- `cli/test/thinkroom.test.js` (modify)

**Approach:** Add a test that logs in / configures a token against the local fake server (mirroring the existing `login` test setup) and then:
- Runs `new` **without** `--agent` and without `THINKROOM_AGENT`: assert exit 0, assert the server received `x-agent-name: Thinkroom CLI`, assert `stderr` matches the warning, assert `stdout` still equals the share URL.
- Runs `new` with `THINKROOM_AGENT=Claude` in env and no `--agent`: assert the server received `x-agent-name: Claude`, assert `stderr` does **not** contain the warning.
- In the existing `document commands` test (or an added assertion), confirm `show` without identity produces no warning on `stderr`.

**Test scenarios:**
- Happy path: write with explicit `--agent` → no warning, header is the agent name (already covered by existing tests; keep them green).
- Edge: write with no identity → warning printed, header is `Thinkroom CLI`, stdout unchanged, exit 0.
- Edge: write with `THINKROOM_AGENT` only → no warning, header is the env value.
- Edge: read-only `show` with no identity → no warning.

**Verification:** `npm run check:cli` passes including the new assertions.

### U3. Document the fallback behavior

**Goal:** Make the default-identity behavior discoverable so agents know to pass `--agent`.

**Files:**
- `cli/skill/thinkroom/SKILL.md` (modify)
- `cli/README.md` (modify)

**Approach:** Add one sentence to the skill's "Start a document" guidance and the CLI README noting that omitting `--agent`/`THINKROOM_AGENT` attributes writes to a generic `"Thinkroom CLI"` identity and prints a warning. Keep it brief; the skill already instructs agents to identify themselves.

**Test expectation:** none — documentation only.

**Verification:** wording matches the actual warning string and the existing docs voice.

## Verification Strategy

- `npm run check:cli` (Node test runner) — primary gate for U1/U2.
- `npm run check` — full TypeScript + CLI check to confirm nothing else regressed.
- Manual terminal run of the built CLI against the local Rails server (`bin/dev`) showing: a write without `--agent` prints the warning and the document is attributed to "Thinkroom CLI"; a write with `--agent "Claude"` prints no warning and is attributed to "Claude".
