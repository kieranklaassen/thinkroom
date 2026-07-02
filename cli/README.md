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
