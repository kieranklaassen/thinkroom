---
title: "fix: Add API docs index"
type: fix
date: 2026-06-27
---

# fix: Add API docs index

## Summary

`GET /api/docs` currently falls through to a 404 even though the API exposes `POST /api/docs` and document-specific `GET /api/docs/:slug` endpoints. This plan adds a collection read endpoint that helps agents discover accessible documents and the canonical creation contract without weakening document ownership rules.

## Problem Frame

The root document UI lists a viewer's documents and recent browser documents, while the agent API is document-specific after creation. A direct fetch of `/api/docs` should be a valid API entry point instead of an unhelpful 404. The fix should stay aligned with Thinkroom's agent-native strategy and avoid exposing a global document list.

## Requirements

- R1. `GET /api/docs` returns HTTP 200 with a JSON payload instead of 404.
- R2. The response includes the current caller's account documents when authenticated with a valid CLI bearer token.
- R3. Anonymous callers do not receive a global document listing.
- R4. The response exposes the existing `POST /api/docs` creation contract so agents can recover from fetching the collection URL.
- R5. Integration coverage verifies authenticated listing and anonymous non-leak behavior.

## Key Technical Decisions

- **Collection reads are scoped to the authenticated API user:** `Api::BaseController` already resolves CLI bearer tokens into `current_api_user`; the index action should use that identity and return an empty `documents` array without a token. This avoids inventing global or cookie-backed API discovery.
- **Document summaries stay shallow:** The collection payload should include identifiers and links such as `slug`, `title`, `share_url`, `api_url`, `content_format`, and timestamps, not full document content. Full live state remains `GET /api/docs/:slug`.
- **Reuse the existing API contract source:** The creation contract already lives in `AgentGuide.endpoints`; the index action should expose the `create_document` entry from that helper rather than duplicating request schema text.

## Scope Boundaries

- This plan does not add pagination or search. The existing UI caps document lists at 50, and the API index can follow the same practical bound.
- This plan does not expose guest browser recents because `ActionController::API` does not carry the browser session/cookie ownership model.
- This plan does not change `POST /api/docs`, `GET /api/docs/:slug`, or document write permissions.

## Implementation Units

### U1. Add the API collection read

**Goal:** Route `GET /api/docs` to an index action that returns a scoped JSON entry point.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:** `config/routes.rb`, `app/controllers/api/docs_controller.rb`

**Approach:** Add the GET route before the slug route. Implement `Api::DocsController#index` using `current_api_user&.documents&.order(created_at: :desc)&.limit(50)` and serialize shallow document summaries with `request.base_url` links. Include `api.create_document` from `AgentGuide.endpoints` using a representative document where needed, or extract a smaller helper if implementation shows that cleaner.

**Test Scenarios:** Authenticated CLI token returns only that user's documents; anonymous `GET /api/docs` succeeds with an empty `documents` array and still includes the create-document contract; documents owned by another user are omitted.

**Verification:** `bin/rails test test/integration/agent_api_test.rb`

### U2. Cover collection endpoint behavior

**Goal:** Add focused integration tests to lock the new collection contract.

**Requirements:** R1, R2, R3, R5

**Dependencies:** U1

**Files:** `test/integration/agent_api_test.rb`

**Approach:** Reuse the existing agent API integration test setup and CLI token model helpers already present in the suite. Assert response shape, URL paths, ownership scoping, and absence of unrelated documents.

**Test Scenarios:** The endpoint returns 200 for anonymous requests; authenticated requests include account documents with `/d/:slug` and `/api/docs/:slug` URLs; documents for other users do not appear.

**Verification:** `bin/rails test test/integration/agent_api_test.rb`

## Sources & Research

- `config/routes.rb` defines `POST /api/docs` and `GET/PATCH /api/docs/:slug`, but no collection GET route.
- `app/controllers/api/docs_controller.rb` centralizes create/show/update behavior for agent documents.
- `app/controllers/api/base_controller.rb` authenticates CLI bearer tokens and exposes `current_api_user`.
- `app/services/agent_guide.rb` owns the machine-readable agent endpoint contract.
- `app/controllers/documents_controller.rb` demonstrates the existing 50-document cap and account-scoped document ordering for the browser index.
