---
name: thinkroom
description: Collaborate with people through Thinkroom documents using the Thinkroom CLI. Use when an agent needs to start or share a document, hand substantial thinking to a human, inspect or revise an existing Thinkroom share link, propose a targeted suggestion, leave a comment, or load a repository's durable agent context with thinkroom prime.
---

# Thinkroom

Use Thinkroom as the durable handoff surface for substantial work that benefits from human reading, judgment, suggestions, or endorsement. Keep local files authoritative while drafting; publish or revise the Thinkroom document at clear handoff points.

## Prime the repository

Run this before substantial work in a repository:

```bash
thinkroom prime
```

Read the relevant paths it reports, especially `AGENTS.md`, `CONCEPTS.md`, and matching entries under `docs/solutions/`. Priming is offline and must not block work when the CLI is not logged in.

## Start a document

Write the complete draft to a file or pipe it on standard input. Identify the actual agent name so provenance is useful:

```bash
thinkroom new draft.md --title "Decision memo" --agent "Codex"
```

Always pass `--agent` (or set `THINKROOM_AGENT`) on writes — it is required. Without it the CLI stops with an error instead of misattributing the write to a generic identity, because per-agent provenance is the point.

Use `--format html` only when semantic HTML is genuinely needed. Return the printed share URL to the user.

If the CLI asks for authentication, run `thinkroom login` and let the person approve the browser prompt. Never ask them to paste a token into chat.

## Work with an existing document

Read live state before changing anything:

```bash
thinkroom show SHARE_URL --json
```

The `content` field is the canonical Markdown source and may carry
`<span data-provenance data-kind="ai" data-author="…" data-state="pending">`
attribution marks; `plain_markdown` is the same text with marks stripped.
When you update, the server stores your content verbatim: round-tripping
`content` preserves everyone's existing attribution, but text you add inside
someone else's span inherits their name. Wrap your new or changed passages in
your own span (`data-author` = your `--agent` name) so provenance stays
truthful; unwrapped text reads as unattributed. Never build an update from
`plain_markdown` — that erases all existing attribution.

For a document that is still an untouched seed, revise it in place:

```bash
thinkroom update SHARE_URL revision.md --title "Updated title" --agent "Codex"
```

If you are logged in (`thinkroom login`) and own the document, you can update it in place this way even after it is claimed or after a live editing session exists. Owner updates are full replacements of the document source at the same share URL. Replacing a live document auto-rejects any pending suggestions whose targeted text no longer exists in the new content — `thinkroom update` warns when this happens; check `thinkroom show --json` afterward if you or others have pending suggestions on that document.

If you do not own the document, do not try to overwrite a claimed or live document from the CLI. Propose the smallest exact replacement and include intent:

```bash
thinkroom suggest SHARE_URL \
  --replaces "Exact current text" \
  --body "Proposed replacement" \
  --intent "Why this improves the document" \
  --agent "Codex"
```

Use comments for questions or review notes that should not directly replace prose:

```bash
thinkroom comment SHARE_URL --body "Could we verify this assumption?" --agent "Codex"
```

When an API conflict provides a next action, follow that guidance instead of retrying the same write.

## In a WebMCP browser

If you are driving a WebMCP-capable browser and the open Thinkroom page exposes `document.modelContext` tools named `thinkroom_*`, prefer them over curl. Always pass `agent_name` — the same identity rule as `--agent`. Never invent a generic name.

Document pages (`/d/SLUG`) register nine tools:

- `thinkroom_guide` — the agent guide for this server (read-only).
- `thinkroom_read_document` — canonical source, suggestions, comments, and ownership (read-only, no presence).
- `thinkroom_propose_suggestion` — exact-text replacement with intent; needs an edit link.
- `thinkroom_comment` — review note or question; needs a comment or edit link.
- `thinkroom_resolve_comment` — resolve an open comment on this document; needs a comment or edit link.
- `thinkroom_announce_presence` — tell readers you are working here.
- `thinkroom_poll_events` / `thinkroom_ack_events` — pending events addressed to your agent name, and their acknowledgement.
- `thinkroom_create_document` — a new unclaimed draft (rate-limited per IP).

The documents index (`/`) registers two: `thinkroom_guide` and `thinkroom_create_document`.

These tools run at anonymous link-holder privilege — no token, never the viewer's account. Write tools return 423 with a `next_action` on comment-only or view-only links; follow it instead of retrying. Content changes, retitling, accepting or rejecting suggestions, claiming, and link access are not browser tools — use the CLI (`thinkroom update`) or leave them to a human.

## Handoff

Finish by giving the person the share URL and one sentence describing what judgment or action is needed. Do not expose CLI config files, bearer tokens, browser cookies, or raw API responses containing credentials.
