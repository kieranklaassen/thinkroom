---
title: "fix: Stop the CLI from fabricating a generic agent identity"
type: fix
date: 2026-06-28
---

# fix: Stop the CLI from fabricating a generic agent identity

## Summary

The CLI invents a fake agent identity. When a write command runs without
`--agent`/`THINKROOM_AGENT`, `resolveAgent()` returns the literal
`DEFAULT_AGENT_NAME = 'Thinkroom CLI'`, and `request()` forwards it as the
`X-Agent-Name` header on **every** call. PR #115 added a stderr warning but kept
sending the fabricated header, so the underlying provenance pollution still
happens. This plan removes the fabrication: the CLI only sends `X-Agent-Name`
when a real identity is supplied, requires identity on write commands, and never
attributes a write to a generic placeholder.

## Reproduction (on `main`, captured before the fix)

Authenticated against a local Rails server with a CLI token:

- `thinkroom new -` **without** `--agent` (warning prints, but) →
  server records `seed_author_kind: "agent"`, `seed_author_name: "Thinkroom CLI"`,
  activity feed entry `["Thinkroom CLI", "agent", "created_document"]`,
  `provenance_summary` = 100% AI by "Thinkroom CLI".
- `thinkroom show /d/demo` (a **read**) without `--agent` → fabricates an
  `AgentPresence` row `["Thinkroom CLI", "active"]` and a `joined` activity.
- `thinkroom new - --agent "Claude"` → correct: `seed_author_name: "Claude"`.

So a forgotten flag permanently bakes a meaningless identity into the document's
provenance, activity feed, and presence — exactly the "provenance is useless"
failure the report describes.

## Problem Frame

`X-Agent-Name` is self-asserted identity. The raw HTTP API treats it as
**required for writes** (suggestions/comments return `422` via `require_agent!`)
and optional for reads; header-less `POST /api/docs` deliberately records *no*
seed attribution rather than a fake one. The CLI should mirror that contract.
Today it does the opposite — it manufactures `"Thinkroom CLI"` and sends it
everywhere, which is strictly worse than sending nothing because it pollutes
provenance with a name that means "some unidentified CLI user."

## Requirements

- R1. Write commands (`new`, `update`, `suggest`, `comment`) require an agent
  identity from `--agent` or `THINKROOM_AGENT`. With none, the command fails with
  a clear, actionable error (exit 1) and makes **no** network request, so nothing
  is created or attributed.
- R2. When identity is provided, it is forwarded verbatim (trimmed) as
  `X-Agent-Name`, unchanged from today's behavior for the happy path.
- R3. The CLI never sends a fabricated default `X-Agent-Name`. The
  `DEFAULT_AGENT_NAME` placeholder is removed.
- R4. The read-only `show` command works without identity and, when none is
  given, sends no `X-Agent-Name` (so it no longer fabricates presence/activity).
  When `--agent`/`THINKROOM_AGENT` is set, `show` still forwards it (legitimate
  presence).
- R5. Tests cover: write without identity → exit 1, error on stderr, zero
  requests; write with `--agent` or `THINKROOM_AGENT` → header forwarded, exit 0;
  read without identity → no header, no warning, exit 0.

## Key Technical Decisions

- **Require, do not fabricate.** Requiring identity on writes is the strongest
  guarantee that provenance is always meaningful, and it is consistent across all
  four write commands. It matches the bundled `SKILL.md` ("Always pass
  `--agent`") and the server test note that "the real CLI always sends
  X-Agent-Name" — now it always sends a *real* one. The server still permits
  anonymous writes for the raw API / browser; that contract is unchanged.
- **Fail before the request.** Resolve identity first; throw `CliError` so no
  document/suggestion/comment is created under a missing identity. Reuses the
  existing error/exit-code path (`Error:` to stderr, exit 1).
- **Reads stay permissive.** `show` is non-mutating; keep it usable without
  identity, but omit the header so a read never creates presence. This also fixes
  the read-side pollution surfaced in the reproduction.
- **Trim and treat blank as missing.** `--agent ""` / whitespace resolves to
  "missing" so a blank identity can never slip through as the header.
- **No server changes.** `Api::BaseController#current_agent` / `require_agent!`
  already behave correctly; the bug is entirely in the CLI client.
- **No version bump.** The `--version` test pins `0.1.0`; releasing is the
  maintainer's call at publish time.

## Scope Boundaries

- Does not change the resolution precedence (`--agent` → `THINKROOM_AGENT`).
- Does not touch server-side attribution, presence, or activity logging.
- Does not change the unrelated `--agent` selector on `init` / `skill install`
  (it picks a skill directory: agents/claude/codex/all). That naming overlap is
  pre-existing; these subcommands are not writes and are out of scope.
- Removes the PR #115 fallback **warning** because the fallback it warned about no
  longer exists (the write now errors instead).

## Implementation Units

### U1. Remove the fabricated identity; require it on writes

**Files:** `cli/bin/thinkroom.js` (modify)

- Delete `const DEFAULT_AGENT_NAME = 'Thinkroom CLI'`.
- Replace `resolveAgent()` + `writeAgent()` with:
  - `agentIdentity(options)` → returns the trimmed `options.agent ??
    process.env.THINKROOM_AGENT`, or `undefined` when blank.
  - `requireAgent(options)` → returns `agentIdentity(options)` or throws
    `CliError` with: "Set your agent identity before writing so this edit is
    attributed to you. Pass --agent NAME (for example --agent \"Claude\") or set
    THINKROOM_AGENT."
- `createDocument`, `updateDocument`, `suggest`, `comment` → `agent:
  requireAgent(options)`.
- `showDocument` → `agent: agentIdentity(options)` (undefined ⇒ header omitted by
  the existing `if (agent)` guard in `request()`).
- Update `help()` so `--agent NAME` reads as required on the write commands and
  the environment line still lists `THINKROOM_AGENT`.

### U2. Update CLI tests

**Files:** `cli/test/thinkroom.test.js` (modify)

- Rewrite the `writes warn on the generic identity fallback…` test to
  `writes require an agent identity and honor THINKROOM_AGENT`:
  - `new` with neither `--agent` nor `THINKROOM_AGENT` → exit 1, stderr matches
    the identity guidance, and the fake server received **zero** requests.
  - `new` with `THINKROOM_AGENT=Claude` → server receives `x-agent-name: Claude`,
    exit 0, no warning on stderr.
- Keep the existing happy-path assertions (`--agent Codex/Scout`) and the
  `show` "no warning on stderr" assertion (still true — no header, no warning).

### U3. Update docs

**Files:** `cli/README.md`, `cli/skill/thinkroom/SKILL.md` (modify)

- README: replace the "falls back to a generic `Thinkroom CLI` identity and
  warns" note with: writes require `--agent`/`THINKROOM_AGENT`; without it the
  command stops with an error so nothing is misattributed.
- SKILL.md: replace the warning sentence with the requirement, keeping the
  existing "Always pass `--agent`" guidance.

## Verification Strategy

- `npm run check:cli` — primary gate (CLI behavior).
- `npm run check` — full TypeScript + CLI check for regressions.
- `bin/rails test` — confirm server behavior/tests are unaffected.
- Manual end-to-end against `bin/dev`:
  - `new`/`update`/`suggest`/`comment` without identity → clean error, exit 1,
    nothing created (verified in DB).
  - `new --agent "Claude"` → `seed_author_name: "Claude"`; confirm the editor
    surfaces "Claude" (not "Thinkroom CLI") in provenance/activity.
  - `show` without `--agent` → no new `AgentPresence` / `joined` activity.
