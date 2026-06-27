# Thinkroom CLI

Connect agents and terminals to [Thinkroom](https://thinkroom.kieranklaassen.com).

```bash
npm install --global thinkroom
thinkroom login
thinkroom init
thinkroom new draft.md --title "Decision memo" --agent "Codex"
```

Use `thinkroom help` for commands. Set `THINKROOM_URL` for a self-hosted server
and `THINKROOM_TOKEN` for non-interactive automation. Pass `--agent NAME` (or set
`THINKROOM_AGENT`) on writes so edits are attributed to you; without it the CLI
falls back to a generic `Thinkroom CLI` identity and warns.
