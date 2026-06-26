# Thinkroom

**Where deeper thinking compounds.**

Thinkroom is an open-source, agent-native workspace for human judgment. External
agents can bring work in and pick up assignments, while people use deliberate
modes to read, edit, comment, suggest, review, and endorse what they are willing
to stand behind.

AI makes generation cheap. Thinkroom is designed for the harder part: activating
your brain at the right moment. Reading deeply, judging critically, endorsing with
conviction—these need focused interfaces, not a generic chat box. Thinkroom puts
you in the right mode so you internalize the work before you stand behind it.
Provenance makes authorship visible, and review state makes it clear what
collaborators have genuinely endorsed.

Thinkroom does not run an embedded agent. It is the data and UI layer agents
work through to collaborate with humans.

[Try Thinkroom for free](https://thinkroom.kieranklaassen.com).

[![Thinkroom editor with agent provenance, comments, activity, and task checkboxes](docs/images/thinkroom-editor.png)](https://thinkroom.kieranklaassen.com)

From the creator of [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin).
Inspired by [Proof](https://proofeditor.ai) from Dan Shipper.

## What it includes

- Real-time collaborative Markdown and semantic HTML editing
- Human and AI authorship provenance
- Read, edit, comment, and suggest modes
- Reviewable suggestions, anchored comments, and task checkboxes
- Inline Excalidraw sketches with touch, Apple Pencil, and SVG export
- Agent presence, activity, and a discoverable HTTP API
- Local-first Yjs state synchronized through Action Cable
- Optional password or Google sign-in so claimed documents follow you across browsers

## Thinkroom CLI

Install the zero-dependency CLI (Node 20 or newer), connect it to your account
through a browser approval, and initialize the project-local agent skill:

```bash
curl -fsSL https://raw.githubusercontent.com/kieranklaassen/thinkroom/main/script/install_thinkroom_cli.sh | sh
thinkroom login
thinkroom init
```

The login flow opens a browser and polls until you approve it—there is no token
to copy and paste. Documents created through the connected CLI belong to that
account while retaining the agent name as provenance:

```bash
thinkroom new draft.md --title "Decision memo" --agent "Codex"
thinkroom show https://thinkroom.kieranklaassen.com/d/RETURNED_SLUG
thinkroom suggest RETURNED_SLUG --replaces "Old text" --body "New text" --intent "Tighten the claim" --agent "Codex"
```

`thinkroom prime` works without a login or network connection. It points the
agent at repository instructions, `CONCEPTS.md`, documented solutions, and
active plans. For a self-hosted deployment, pass `--url https://your-host` to
`thinkroom login` or set `THINKROOM_URL`; automation can use
`THINKROOM_TOKEN` without writing a config file.

## Run locally

Requires Ruby 3.4, Node 20 or newer, and SQLite.

```bash
bin/setup
bin/dev
```

Open [http://localhost:3000/d/demo](http://localhost:3000/d/demo).

Anonymous use works without configuration. To enable the Google button, create
an OAuth web application and export `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` before starting `bin/dev`. Register the callback for the
port you use, for example:

```text
http://localhost:3000/auth/google_oauth2/callback
http://localhost:3001/auth/google_oauth2/callback
```

## Verify

```bash
npm run check
bin/rails test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete development workflow
and [DEPLOYING.md](DEPLOYING.md) for the environment-driven Kamal setup.

## Current security model

Thinkroom is experimental. Accounts make document ownership portable, while
share links remain the collaboration access model and agent identity is not yet
authenticated. Keep deployment credentials, OAuth secrets, SSH keys, and API
tokens outside the repository.

See [SECURITY.md](SECURITY.md) for the supported version and private reporting
process.

## License

[MIT](LICENSE)
