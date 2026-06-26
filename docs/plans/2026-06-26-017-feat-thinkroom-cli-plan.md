---
title: "feat: Add an account-linked Thinkroom CLI and agent skill"
type: feat
status: active
date: 2026-06-26
issue: 91
---

# Account-linked Thinkroom CLI and agent skill

## Goal

Ship a small, zero-dependency `thinkroom` command that an agent or person can install quickly, connect to a Thinkroom account through a browser approval flow without copying credentials, use for the core document workflow, and initialize as a reusable agent skill. Keep repository priming useful offline by surfacing durable project instructions, concepts, plans, and documented solutions.

## Product contract

- `thinkroom login` starts a ten-minute device authorization, opens a browser when possible, prints the same URL as a fallback, polls at the server-provided interval, and stores the returned token with user-only file permissions.
- The browser requires an existing Thinkroom session, clearly names the CLI request and account, and does not approve access until the person submits the CSRF-protected confirmation.
- `thinkroom whoami` and `thinkroom logout` make account state visible and revocable.
- `thinkroom new`, `show`, `update`, `suggest`, and `comment` cover the common agent document lifecycle. Commands accept a slug or share URL, read content from a file or stdin, emit script-friendly output, and return non-zero on API errors.
- Authenticated CLI document creation attaches the document to the approving account while preserving agent attribution through `X-Agent-Name`. Existing anonymous/share-link API behavior remains compatible.
- `thinkroom init` installs the bundled `thinkroom` skill into detected project-local agent directories and then runs `thinkroom prime`.
- `thinkroom prime` never requires network access. It emits the current account/host when known, the local Thinkroom workflow, and discovered `AGENTS.md`, `CLAUDE.md`, `CONCEPTS.md`, `docs/solutions`, and active plan paths so an agent can load relevant durable context.
- Installation works immediately from a one-line repository installer; the same CLI is also an npm-ready package named `thinkroom`.

## Security and lifecycle boundaries

- Store only SHA-256 digests of long-lived API tokens and the high-entropy device secret. The short user code is display-only correlation, is shown on both surfaces, and expires with the grant; raw access tokens are returned exactly once.
- Device grants expire after ten minutes, are single-use, and cannot be approved without a signed-in browser session.
- Reject invalid bearer credentials instead of silently degrading an intended authenticated request into an anonymous write.
- Rate-limit device initiation and token polling. Poll responses distinguish pending, slow-down, expired, and consumed states without exposing account data before approval.
- The CLI writes its config atomically under `XDG_CONFIG_HOME` or `~/.config/thinkroom`, sets directory mode `0700` and file mode `0600`, and lets `THINKROOM_TOKEN`/`THINKROOM_URL` override disk state for automation.
- Logging out revokes the server token before removing local state; an already-revoked token can still be removed locally.
- No password, browser cookie, OAuth credential, or raw API token is persisted in application logs or database columns.

## Implementation units

### 1. Device authorization and revocable access tokens

- Add `CliDeviceAuthorization` and `CliAccessToken` tables/models with digest lookup, a unique human-readable user code, expiration/single-use state, user ownership, and token issuance/revocation helpers.
- Add public JSON endpoints to start and poll device authorization plus bearer-protected identity and revoke endpoints.
- Extend `Api::BaseController` with optional bearer authentication that rejects an explicitly invalid token and throttles `last_used_at` writes.
- Attach documents created with a valid bearer token to that token's user and make the create response accurately describe account ownership.
- Cover model invariants, expiry, one-time issuance, invalid credentials, revocation, anonymous compatibility, and account-owned API creation.

### 2. Browser approval flow

- Add signed-in GET/POST routes and a focused Inertia page for CLI approval. The complete browser URL carries only the short user code; the high-entropy polling secret never enters browser history or server request paths.
- Preserve the complete local approval URL through login/signup, show the matching user code, reject expired/unknown grants, and render a clear success state after approval.
- Reuse the existing authentication, typography, card, button, and responsive patterns rather than creating a separate account system.
- Cover redirect-to-login, approval by the current user, expiry, replay, CSRF-protected form shape, and desktop/mobile rendering.

### 3. Zero-dependency CLI

- Add an npm-ready `cli/` package for Node 20+ using built-in `fetch`, `fs`, `child_process`, and `node:test` only.
- Implement argument parsing, config storage, browser opening, polling, slug normalization, stdin/file input, JSON/plain output, API error rendering, and commands: `login`, `logout`, `whoami`, `new`, `show`, `update`, `suggest`, `comment`, `init`, `skill install`, `prime`, `help`, and `version`.
- Keep standard output composable: content or the requested URL on success; progress and diagnostics on standard error; `--json` for structured automation.
- Add deterministic tests with temporary homes/projects and a local fake HTTP server; package/installer smoke tests must not touch the real account or production service.

### 4. Agent skill and offline priming

- Bundle a concise `thinkroom` `SKILL.md` that triggers when an agent needs to start, share, revise, comment on, or hand work to a human through Thinkroom.
- Teach the agent to run `thinkroom prime`, read relevant durable project context, use account-linked creation for handoffs, read live state before edits, prefer targeted suggestions after human involvement, and return the share URL.
- Install project-locally into detected `.agents/skills`, `.claude/skills`, and `.codex/skills` roots without overwriting unrelated files. Support an explicit `--agent agents|claude|codex|all` override, default to `.agents/skills` when no client directory exists, and make reruns update only the managed Thinkroom skill.
- Validate the source skill with the skill-creator validator and verify installed copies byte-for-byte in CLI tests.

### 5. Distribution, documentation, and CI

- Add a POSIX installer that places the single CLI entrypoint in `${THINKROOM_INSTALL_DIR:-$HOME/.local/bin}` with executable permissions and explains PATH setup when necessary.
- Add root scripts/CI coverage for CLI tests and npm packaging without adding runtime dependencies to the Rails frontend.
- Document the install/login/init/new/show workflow in the README and keep `THINKROOM_URL` documented for self-hosted installations.
- Verify `npm pack` contains only the intended CLI, license, and bundled skill assets.

## Acceptance examples

- A signed-out person runs `thinkroom login`, follows the printed browser URL, signs in, approves the named request, and the waiting command completes without asking them to paste a code or token.
- After login, `printf '# Draft' | thinkroom new --title Draft --agent Codex` prints a share URL and the document appears under the approving account on the home page with Codex seed attribution.
- An invalid or revoked token produces an actionable authentication error and never creates an unowned document.
- `thinkroom show <share-url>` prints the current source; `update` revises an untouched seed document; after a human starts editing, the same command surfaces the API's suggestion guidance and non-zero status.
- In a repository with `AGENTS.md`, `CONCEPTS.md`, and categorized `docs/solutions`, `thinkroom init` installs the requested skill and `thinkroom prime` lists those sources without making an HTTP request.
- Running the one-line installer in a temporary home produces an executable `thinkroom` whose `--version`, `help`, and `prime` commands work before login.

## Verification

- Focused model/integration tests for device grants, tokens, API authentication, browser approval, and account-owned CLI creation.
- `node --test cli/test/*.test.js` and `npm pack --dry-run --workspace thinkroom` (or the package-directory equivalent).
- Skill validation with `quick_validate.py`.
- Full `bin/rails test`, `bin/rubocop`, `npm run check`, test and production Vite builds, and security scans in CI.
- Browser verification of login handoff, approval, account-linked creation, home ownership, revoke behavior, and 390px layout.
- After merge, deploy the exact commit and repeat the device-login/create/revoke path against production using a temporary account and document, then remove both.

## Deferred

- Refresh tokens, multiple token management UI, token naming/editing, and audit-history UI.
- Native binaries, Homebrew, Windows installers, and publishing credentials/automation for the public npm registry.
- Using CLI bearer tokens to bypass a document's current share-link access level or live-edit an already-started CRDT document.
- Automatic mutation of `AGENTS.md` or other repository instruction files; initialization only installs the skill and reports durable context.
