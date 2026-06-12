# Pruf

Pruf is a collaborative editor heavily inspired by
[Proof](https://proofeditor.ai), reimagined around human and AI collaboration.
It tracks who wrote each part of a document, supports live editing, and lets
people review AI contributions explicitly.

## Features

- Real-time collaborative editing with Yjs and Action Cable
- Markdown and semantic HTML documents
- Human and AI provenance at the text level
- Reviewable suggestions and anchored comments
- Agent presence, activity, and HTTP APIs
- Local-first editing with persistent CRDT state

## Setup

Requires Ruby 3.4, Node 20 or newer, and SQLite.

```bash
bin/setup
bin/dev
```

Open [http://localhost:3000/d/demo](http://localhost:3000/d/demo). Open the
same document in two windows to try live collaboration.

## How It Works

Documents are shared Yjs CRDTs edited through Milkdown and ProseMirror.
Action Cable relays updates and awareness between collaborators, while Rails
persists merged document state with `y-rb`.

Provenance is stored as document marks, so attribution moves with the text
through edits and synchronization. Suggestions remain pending until a person
accepts or rejects them.

Agents can discover the collaboration API from a document share link, announce
their presence, read document state, suggest changes, leave comments, and
respond to activity. Agent requests identify themselves with the
`X-Agent-Name` header.

## Verification

```bash
bin/rails test
npm run check
BASE_URL=http://localhost:3000 node script/sync_check.mjs
BASE_URL=http://localhost:3000 node script/browser_check.mjs
BASE_URL=http://localhost:3000 npm run check:html
```

## Current Limitations

- Share links are the current access model; there are no user accounts.
- Agent identity is supplied by the client and is not authenticated.
- Production is designed for a single application process with SQLite.
