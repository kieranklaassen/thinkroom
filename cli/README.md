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
