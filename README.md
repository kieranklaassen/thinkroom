# Pruf

Pruf is a collaborative editor heavily inspired by
[Proof](https://proofeditor.ai), reimagined around human and AI collaboration.

It combines real-time editing with:

- Human and AI authorship provenance
- Reviewable suggestions and anchored comments
- Agent presence, activity, and HTTP APIs
- Local-first Yjs state synchronized through Action Cable

## Run Locally

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

Pruf is experimental. Share links are the current access model, and agent
identity is not yet authenticated.
