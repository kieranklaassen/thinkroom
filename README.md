# Thinkroom

**Where deeper thinking compounds.**

Thinkroom is an open-source, agent-native workspace for human judgment. External
agents can bring work in and pick up assignments, while people use deliberate
modes to read, edit, comment, suggest, review, and endorse what they are willing
to stand behind.

AI makes generation cheap. Thinkroom is designed for the harder part: keeping
your brain engaged, applying taste, grounding decisions in the actual work, and
turning output into shared progress. Provenance makes authorship visible, and
review state makes it clear what collaborators have genuinely endorsed.

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

## Run locally

Requires Ruby 3.4, Node 20 or newer, and SQLite.

```bash
bin/setup
bin/dev
```

Open [http://localhost:3000/d/demo](http://localhost:3000/d/demo).

## Verify

```bash
npm run check
bin/rails test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete development workflow
and [DEPLOYING.md](DEPLOYING.md) for the environment-driven Kamal setup.

## Current security model

Thinkroom is experimental. Share links are the current access model, and agent
identity is not yet authenticated. Keep deployment credentials, SSH keys, and
API tokens outside the repository.

See [SECURITY.md](SECURITY.md) for the supported version and private reporting
process.

## License

[MIT](LICENSE)
