---
title: "fix: Expose full document content from agent share-link fetches"
type: fix
date: 2026-06-26
issue: 102
---

# fix: Expose full document content from agent share-link fetches

## Summary

Include the document's current canonical source near the top of curl-like and explicit text responses from `/d/:slug`, while preserving browser SSR, hidden browser guidance, and JSON/API state.

## Problem Frame

The share controller routes non-browser user agents to `AgentGuide.text` before the Inertia SSR path. The guide describes `GET /api/docs/:slug`, but it never includes `Document#current_content`; agents handed only the human URL must make a second, inferred request before they can read the document.

## Requirements

- R1. A curl-like fetch of `/d/:slug` returns the full current canonical document content, not only its title and participation guide.
- R2. The direct response identifies the immutable content format and clearly delimits document data from agent instructions.
- R3. Snapshot content wins over stale seed content, matching `GET /api/docs/:slug`.
- R4. Markdown and HTML documents both expose their native canonical source without JSON or HTML escaping.
- R5. Explicit `?format=txt` has the same readable-content contract.
- R6. Browser HTML remains SSR-rendered and keeps its compact hidden participation guide without duplicating up to 2 MB of canonical source there.
- R7. `Accept: application/json` and `/api/docs/:slug` remain unchanged.

## Key Technical Decisions

- Add an opt-in `include_content:` keyword to `AgentGuide.text`; the controller enables it only for direct plain-text responses.
- Put the content block immediately after the short share-link preamble so truncated text-fetch tools encounter document content before the long participation guide.
- Use `Document#current_content`, the same source selected by machine-readable state, and include the format and byte length in explicit begin/end markers.

## Implementation Units

### U1. Add direct content framing

- **Files:** `app/services/agent_guide.rb`, `app/controllers/documents_controller.rb`
- **Approach:** Render an opt-in current-content section for curl-like and `?format=txt` responses; leave the browser-only embedded guide on the existing compact path.

### U2. Lock the negotiation contract

- **Files:** `test/integration/agent_discovery_test.rb`
- **Approach:** Cover current snapshot precedence, content ordering, native Markdown and HTML source, explicit text format, and unchanged compact guide generation.

## Acceptance Examples

- AE1. A curl fetch of a Markdown share URL contains the current snapshot body before `## Identity`.
- AE2. A text fetch of an HTML share URL contains the canonical `<h1>`/`<p>` source verbatim.
- AE3. Calling the embedded-guide variant directly omits the content markers, avoiding a second large copy in browser HTML.

## Scope Boundaries

- In scope: `/d/:slug` plain-text discovery output and regression tests.
- Out of scope: changing the JSON state schema, content negotiation rules, SSR rendering, authorization, or canonical source selection.

## Risks

- Document content is untrusted text and may resemble instructions. Framing must explicitly label it as document data.
- Large documents should not be duplicated into browser HTML; content inclusion remains opt-in for direct text responses only.

## Sources

- GitHub issue #102.
- `app/controllers/documents_controller.rb` — share URL content negotiation.
- `app/services/agent_guide.rb` — plain-text and JSON agent surfaces.
- `docs/solutions/architecture-patterns/server-first-instant-paint.md` — SSR/current-content projection guidance.
