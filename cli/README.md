# Thinkroom CLI

Connect agents and terminals to [Thinkroom](https://thinkroom.kieranklaassen.com).

```bash
npm install --global thinkroom
thinkroom login
thinkroom init
thinkroom new draft.md --title "Decision memo" --agent "Codex"
```

Use `thinkroom help` for commands. Set `THINKROOM_URL` for a self-hosted server
and `THINKROOM_TOKEN` for non-interactive automation. Writes require an agent
identity: pass `--agent NAME` (or set `THINKROOM_AGENT`) so edits are attributed
to you. Without one the CLI stops with an error rather than misattributing the
write to a generic identity.

## Editing a document you own

Prefer a targeted replacement over resending the whole document:

```bash
thinkroom update SHARE_URL --replaces "Exact current text" --with "New text" --agent "Codex"
```

Quote `--replaces` verbatim from the `content` field of `thinkroom show --json`
(the canonical source); it must match exactly once, and `--with ""` deletes the
target. A missing or ambiguous target fails without changing anything. Use the
full-file form (`thinkroom update SHARE_URL revision.md`) only when rewriting
most of the document.

## WebMCP

In a WebMCP-capable browser (Chrome 149+ with
`chrome://flags/#enable-webmcp-testing`), Thinkroom pages register
`thinkroom_*` tools on `document.modelContext` that call the same `/api/*`
endpoints the CLI uses. Document pages offer read, suggest, comment, resolve,
presence, events, and create; the index offers guide and create. Every write
takes a required `agent_name`, and the tools run at anonymous link-holder
privilege, so writes on comment-only or view-only links return 423 with a
`next_action`. Writable document pages (opened through an Edit link, claimed
or not, or owned by the viewer) also register `thinkroom_update_document`,
the in-page equivalent of `thinkroom update`: it replaces the whole document
through the live editor, never through the API, and the replaced text lands
as pending AI provenance for human review. Retitling without a heading,
accepting or rejecting, claiming, and link access stay with the CLI and with
humans.

## Provenance spans

`thinkroom show` prints the canonical Markdown source, which may embed
per-passage attribution marks:

```html
<span data-provenance data-kind="ai" data-author="Codex" data-state="pending">…</span>
```

Readers see these as provenance highlights pending human endorsement. The
contract when editing:

- `show --json` also carries `plain_markdown` (marks stripped) — read that for
  clean text, but edit and resend the span-bearing `content` so existing
  attribution survives.
- `new` needs no spans: the server records you as the seed author and the whole
  document reads as yours.
- `update` stores your content verbatim. Text you add inside someone else's
  span inherits *their* attribution — wrap your new or changed passages in your
  own span (as above) so provenance stays truthful. Unwrapped text reads as
  unattributed. The activity feed always credits the update itself to your
  `--agent` identity.
