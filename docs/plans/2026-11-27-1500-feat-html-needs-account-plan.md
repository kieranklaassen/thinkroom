---
title: HTML Needs An Account - Plan
type: feat
date: 2026-11-27
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# HTML Needs An Account - Plan

## Goal Capsule

- **Objective:** Creating or suggesting HTML needs an account, and plain Markdown does not.
- **Means:** One yes-or-no check on every content write, backed by the app's own parsers (KTD1, KTD2).
- **Authority:** Product Contract, then Planning Contract, then units.
- **Execution profile:** One pull request, left open and unmerged.
- **Stop conditions:** A migration or dependency turns out to be needed.

---

## Product Contract

### Requirements

- R1. An account is a signed-in browser session or a valid Thinkroom access token; an owner cookie, a display name, a share link or `X-Agent-Name` alone is not.
- R2. Without an account, a content write is refused when the document is HTML, when its stored or live content holds raw HTML, or when the incoming content does. This covers create, edit, suggest, review, snapshot and live sync.
- R3. Content that cannot be read completely counts as holding HTML.
- R4. Stored content is never migrated, rewritten or deleted, and every document stays readable for everyone. Comments, titles, tags and link settings keep their rules.
- R5. Code, inline code, escaped text, autolinks, images, and the editor's own markup (provenance, highlight, tracked change, empty line) are not HTML.
- R6. On a page, a guest on a document that holds HTML reads it, with a notice and a sign-in link. HTML a guest pastes or types in a plain document becomes text, with the same notice.
- R7. The API answers 403 with `error_code: "html_account_required"` on every refusal.

### Scope Boundaries

- No limit on size or nesting and no rendering change. Image uploads are unchanged.
- `script/html_document_check.mjs` signs in before it creates and edits its HTML document.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Markdown detection reads Commonmarker's tree**, with the preview's options and with the editor's grammar, because both readings are shown. (session-settled: user-directed, chosen over a regular expression or second parser: it must agree with the app's own parser)
- KTD2. **Live detection reads the CRDT tree.** Raw HTML is an `html` node. A front matter node counts by what its saved source holds. A guest update is checked as the document is and as the update would leave it; one that is not ready is retryable.
- KTD3. **The check is fail-closed and compares nothing.** (session-settled: user-directed, chosen over comparing an edit with the HTML already there: a single check is smaller and has one answer)
- KTD4. **Editing differs from link access.** `writable_by?` is unchanged; `editable_by?` adds R2 and governs `can_write`, modes and seed claims.
- KTD5. **The Markdown serializer escapes text completely,** so plain text never becomes HTML in the saved source.
- KTD6. **A live refusal stops sending.** The text stays on screen with a notice that it is not saved.

---

## Implementation Units

### U1. Policy and detection

- **Requirements:** R2, R3, R5
- **Files:** `app/services/raw_html.rb`, `app/models/document.rb`, `test/services/raw_html_test.rb`
- **Verification:** a table of HTML and plain sources; live trees with code, deep nesting and front matter.

### U2. HTTP and API writes

- **Requirements:** R1, R2, R4, R7
- **Files:** document and suggestion controllers, `app/models/suggestion.rb`, `app/services/agent_guide.rb`, `test/integration/html_account_test.rb`
- **Verification:** every route as a guest and as an account, on HTML, on Markdown with HTML, and on plain Markdown.

### U3. Live sync and snapshots

- **Requirements:** R2, R3
- **Files:** `app/services/yjs_persistence.rb`, `app/channels/sync_channel.rb`, `test/channels/html_account_channel_test.rb`
- **Verification:** editor updates over the channel and over HTTP.

### U4. Page behavior

- **Requirements:** R6
- **Files:** `app/frontend/editor/html_guard.ts`, `app/frontend/editor/markdown_text.ts`, `app/frontend/editor/cable_provider.ts`, `app/frontend/pages/documents/show.tsx`, `test/frontend/`
- **Verification:** Node tests and a browser check as a guest and as an account.

---

## Verification Contract

| Gate | Command |
|---|---|
| Ruby tests for touched areas | `bin/rails test` on the touched files |
| Front end | `npm run check` and `node --test test/frontend/*.test.mjs` |
| Style and security | `bin/rubocop`, `bin/brakeman` |
| Browser | a guest and an account on a throwaway server |

## Definition of Done

- Every write path is covered by a test that fails without the change.
- Documentation strings agents read match the behavior.
- No abandoned code remains.
