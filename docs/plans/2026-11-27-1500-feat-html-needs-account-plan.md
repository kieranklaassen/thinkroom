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

- **Objective:** Creating or suggesting HTML needs an account, and a guest keeps everything else they can do with Markdown.
- **Means:** One server policy used by every content write, backed by the app's own parsers (KTD1, KTD2).
- **Authority:** Product Contract, then Planning Contract, then units.
- **Execution profile:** One pull request, left open and unmerged.
- **Stop conditions:** A guest cannot safely edit Markdown around existing HTML; a migration or dependency turns out to be needed.

---

## Product Contract

### Summary

Someone without an account cannot create an HTML document, or add or change HTML in any document, raw HTML in Markdown included. Existing documents stay readable and unchanged, and guests keep editing Markdown around HTML that is already there.

### Problem Frame

Creating or suggesting HTML now needs an account. Today the same writes are open to guests on the page, the JSON API and live sync.

### Requirements

**Policy**

- R1. An account is a signed-in browser session or a valid Thinkroom access token; an owner cookie, a display name, a share link or `X-Agent-Name` alone is not.
- R2. Without an account, a write that creates an HTML document is refused.
- R3. Without an account, a write that adds or changes raw HTML in Markdown content is refused, for create, edit, suggest, accept, snapshot and live sync.
- R4. Without an account, an HTML-format document can be read and commented on, and its title revised, but not edited; a suggestion to it may carry plain text only.

**What stays**

- R5. Stored content is never migrated, rewritten or deleted, and every document stays readable for everyone.
- R6. A guest edit that leaves existing HTML alone, removes it, or restores it within the same editing session is accepted.
- R7. Code, inline code, escaped text, autolinks, images, and the editor's own markup (provenance, highlight, tracked change, empty line) are not HTML for this policy.

**What people see**

- R8. A refused guest is told an account is needed and, on a page, gets a sign-in link.
- R9. The API answers 403 with `error_code: "html_account_required"` on every refusal.
- R10. HTML a guest pastes or is refused on live sync becomes plain text in their document instead of being lost.

### Scope Boundaries

- Titles, comments, tags, names and quotes are plain text and are unchanged.
- No limit on size or nesting and no rendering change.
- Image uploads are unchanged.
- `script/html_document_check.mjs` signs in with the check account and authorizes a CLI token before creating and editing its HTML document, after confirming that anonymous HTML creation is refused.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Markdown detection reads Commonmarker's tree.** `html_block` and `html_inline` nodes are HTML. The source is read with the preview's options and again with the editor's grammar (front matter, footnotes, tables on), because both readings are shown. (session-settled: user-directed — chosen over a regular expression or second parser: it must agree with the app's own parser)
- KTD2. **Live detection reads the CRDT tree through yrby.** Raw HTML is the `html` node's `value` under the `prosemirror` root. `read_xml` is complete and cheap, so a tree without an `html` tag in it needs nothing more; otherwise the ProseMirror renderer lists the values, and a tree the renderer does not read completely is refused. The check applies a guest update to a scratch copy under the document locks. A guest update that `update_ready?` reports as not ready is retryable.
- KTD3. **HTML already in the document is compared, not blocked.** The baseline is the larger count per value from the folded live tree, the current source and what this browser has seen in the document this session. That memory is in process, keyed by document, generation and the signed owner cookie, so the socket and HTTP share it. API edits and live updates compare exact literals. Snapshots and seeds compare elements, comments and raw-text contents, because Markdown can merge adjacent text into an HTML block.
- KTD4. **HTML-format documents have a separate content-edit rule.** Link access (`writable_by?`) is unchanged, so suggestions, rejection and highlight names keep their rule. A new predicate (link access plus an account for HTML) governs `can_write`, modes, seed claims, snapshot, sync and accept. Its refusal is the HTML account error, not the link error.
- KTD5. **The Markdown serializer escapes text and metadata completely,** so plain text never becomes HTML in the saved source.
- KTD6. **The client turns refused HTML into text.** A plugin converts HTML added by a local transaction. A live refusal names each excess value and count; the client converts only nodes its own Yjs client created, newest first, and resends its unsaved edits as one update. When it finds none it keeps the text on screen and says it is not saved.

### Assumptions

- WebMCP API tools send no credentials, so they count as guests.
- Session memory lives in one process and is lost on restart; a restore after that falls back to text (R10).

---

## Implementation Units

### U1. Policy and detection

- **Goal:** One place that says what HTML a source, HTML fragment or live document contains.
- **Requirements:** R1, R3, R6, R7
- **Files:** `app/services/raw_html.rb`, `app/services/document_markdown.rb`, `app/models/document.rb`, `test/services/raw_html_test.rb`
- **Approach:** KTD1 to KTD3. Iterative tree walk.
- **Execution note:** Failing tests first.
- **Test scenarios:**
  - Block and inline tags, comments, declarations, HTML in lists, quotes, tables, footnotes and after front matter are found.
  - Code, inline code, escapes, entities, autolinks, sketches, editor markup and empty-line breaks are not.
  - Adding a second copy of existing HTML counts as more; moving it does not.
- **Verification:** Agreement with the editor's parser over a generated corpus.

### U2. HTTP and API writes

- **Goal:** Every request that carries content enforces R2 to R4 and answers R8 and R9.
- **Requirements:** R1, R2, R3, R4, R6, R8, R9
- **Dependencies:** U1
- **Files:** `app/controllers/documents_controller.rb`, `app/controllers/suggestions_controller.rb`, `app/controllers/concerns/document_write_authorization.rb`, `app/controllers/api/base_controller.rb`, `app/controllers/api/docs_controller.rb`, `app/controllers/api/suggestions_controller.rb`, `app/models/suggestion.rb`, `app/services/agent_guide.rb`, `test/integration/html_account_test.rb`
- **Test scenarios:**
  - Guest and account for create, seed edit, targeted replace, suggest, accept, accept all, snapshot and sync.
  - A guest accept of an HTML suggestion leaves it pending; accept all takes the rest.
  - A guest edits Markdown around stored HTML and it is kept.
- **Verification:** Integration tests on every route.

### U3. Live sync

- **Goal:** Guest frames obey R3, R4 and R6.
- **Requirements:** R3, R4, R6, R10
- **Dependencies:** U1
- **Files:** `app/services/yjs_persistence.rb`, `app/channels/sync_channel.rb`, `test/services/yjs_persistence_test.rb`, `test/channels/sync_channel_test.rb`, `test/fixtures/files/`
- **Test scenarios:**
  - Guest frame with an HTML node is refused and not relayed; the same frame from an account is stored.
  - Guest text edits around HTML, deletes, restores and seeds containing HTML are stored.
  - A changed HTML value and a frame that arrives before its dependency are not stored.
  - A tree the renderer cannot read completely, with HTML in it, is refused.
  - Cut over the socket then restore over HTTP is stored; a guest re-upload after recovery keeps HTML in the saved source.
  - A guest snapshot after an account's unsaved live HTML is stored.
- **Verification:** Channel and persistence tests using real editor updates.

### U4. Page behavior

- **Goal:** R8 and R10 on the document page.
- **Requirements:** R8, R10
- **Dependencies:** U2, U3
- **Files:** `app/frontend/editor/html_guard.ts`, `app/frontend/editor/markdown_text.ts`, `app/frontend/editor/milkdown_editor.tsx`, `app/frontend/editor/cable_provider.ts`, `app/frontend/editor/replace_document.ts`, `app/frontend/pages/documents/show.tsx`, `app/frontend/pages/documents/use_suggestion_review.ts`, `test/frontend/`
- **Test scenarios:**
  - Guest paste of HTML becomes text and shows the notice; moving existing HTML does not.
  - A live refusal converts the values and resends every unsaved edit.
  - Text such as a tag followed by a space saves escaped.
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
- A pass that tries each route as a guest finds no accepted HTML.
- Documentation strings agents read match the behavior.
- No abandoned code remains.
