---
title: "fix: Document agent API markdown sketch schema and surface silent fence failures"
type: fix
date: 2026-06-25
origin: https://github.com/kieranklaassen/thinkroom/issues/55
---

# Document agent API markdown sketch schema and surface silent fence failures

## Summary

The agent-facing document API lets agents author inline Excalidraw sketches by embedding a fenced ` ```excalidraw ` block in markdown source. Two problems make this nearly unusable for agents: (1) the self-documenting `content_contract` describes the sketch payload with a one-line summary that is vague *and wrong* on every key field, and (2) when an `excalidraw` fence fails validation, the create response is `201` with `normalized: false` and `warning: null` — byte-for-byte identical to a successful sketch. An agent has no way to know it failed except by noticing that `plain_text` echoes raw scene JSON instead of the sketch's semantic summary.

This plan delivers the three fixes the issue requests: replace the contract's `markdown_source` string with the real `SketchData` schema plus a copy-pasteable example; make a failed markdown sketch fence non-silent by setting `normalized: true` with an explanatory `warning`; and document the recognition signal (`plain_text` shows `Sketch: <description> — <labels>` when recognized, raw JSON when not).

This is a documentation + observability fix. It does **not** change sketch *validation* rules (`ThinkroomSketch.parse` and the TS `normalizeSketchData` stay as they are) — it makes the existing, correct validation legible to the agents that depend on it.

---

## Problem frame

Per `STRATEGY.md`, Thinkroom is an "agent-native data and UI layer" where "external agents bring work in." The self-documenting API (`AgentGuide`) is the entire contract surface an agent gets from a share link — "everything it needs to participate, with no special knowledge beyond the link itself." When that contract lies about the sketch schema and hides validation failures, the agent-native promise breaks at exactly the authoring step.

Today, for a markdown `POST /api/docs`:

- `AgentGuide.content_contract` (`app/services/agent_guide.rb:131`) documents the sketch source as a single string: *"A fenced excalidraw block containing versioned JSON with id, description, and scene."* The real contract (enforced by `ThinkroomSketch.parse` server-side and `normalizeSketchData` in `app/frontend/editor/sketch/scene.ts`) differs on every point: the top-level version key is `formatVersion` (not `version`), there is a `height` render hint (clamped 180–1200), and `scene` must be a full Excalidraw export object (`type: "excalidraw"`, `version > 0`, allowlisted `appState`, `files: {}`), not a `{ id, description, scene }` wrapper.
- `Api::DocsController#create` (`app/controllers/api/docs_controller.rb:35`) only computes `normalization` for HTML (`HtmlDocumentSanitizer.external`). For markdown, `normalization` is `nil`, so the response always sends `normalized: false` and `warning: nil` — even when an embedded `excalidraw` fence failed to parse and was silently kept as a dead code block.

The recognition machinery already exists and works: `DocumentPlainText.call` (`app/services/document_plain_text.rb:40`) finds `pre[lang="excalidraw"] > code`, calls `ThinkroomSketch.parse`, and replaces a recognized fence with its semantic text — leaving raw JSON visible when parsing fails. The create response just never reports that outcome back to the caller. The fix is to audit the markdown at create time using the same `ThinkroomSketch.parse` path and report the result.

---

## Requirements

Traced directly to the issue's three suggested fixes.

- **R1.** The `content_contract.sketches.markdown_source` field must describe the real `SketchData` schema — `formatVersion`, `id` pattern, `description`, `height` range/default, and the full `scene` shape (`type`, `version`, `appState`, `files`) — and include a copy-pasteable working example an agent can drop straight into a fence. (Issue fix #1)
- **R2.** When a markdown create includes an `excalidraw` fence that does not pass `ThinkroomSketch.parse`, the create response must signal the failure: `normalized: true` and a `warning` explaining that an excalidraw block was not a valid sketch and was kept as a code block. A valid sketch (or no sketch) must continue to return `normalized: false`, `warning: null`. (Issue fix #2)
- **R3.** The contract/notes must document the recognition signal: a recognized sketch renders in `plain_text` as `Sketch: <description> — <labels>`; raw scene JSON in `plain_text` means the fence was not recognized. (Issue fix #3, nice-to-have)

Success criteria: an agent reading only the JSON guide can author a valid markdown sketch on the first attempt, and an agent that submits an invalid one receives an unambiguous failure signal in the same response.

---

## High-Level Technical Design

The create path gains one markdown-only audit step. The key invariant: **the create-time warning must fire exactly when `plain_text` would echo raw JSON** — both must be driven by the same `ThinkroomSketch.parse` call so the response can never disagree with the rendered document.

```mermaid
flowchart TD
    A[POST /api/docs, format=markdown] --> B[Document.create! with seed_content = source]
    B --> C{MarkdownSketchAudit.call(content)}
    C -->|finds pre lang=excalidraw fences| D[For each fence: ThinkroomSketch.parse scene/description/formatVersion]
    D --> E{any fence present but unrecognized?}
    E -->|yes| F[normalized: true + warning: excalidraw block kept as code block]
    E -->|no / no fences| G[normalized: false, warning: nil]
    F --> H[Response also carries plain_text]
    G --> H
    H --> I[plain_text via DocumentPlainText — same ThinkroomSketch.parse path]
    style D fill:#d3f9d8
    style I fill:#d3f9d8
```

Both green nodes call `ThinkroomSketch.parse` with the same arguments (`scene` = `JSON.generate(payload["scene"])`, `description` = `payload["description"]`, `format_version` = `payload["formatVersion"]`). Centralizing recognition in `ThinkroomSketch.parse` — which `DocumentPlainText`, `DocumentPreviewHtml`, and the new audit all already funnel through — is what keeps the response signal and the rendered `plain_text` in lockstep without a shared rendering pass.

*Directional guidance for the reviewer — not implementation specification.*

---

## Key technical decisions

- **KTD-1 — Overload `normalized: true` for unrecognized sketches, and broaden the documented meaning to match.** The issue explicitly requests `normalized: true` + `warning` for a failed fence, even though the stored markdown source is unchanged (the fence is kept verbatim as a code block, not removed or rewritten). This slightly stretches the current contract meaning ("source was removed or rewritten"). We accept the overload because it gives agents a *single boolean* to check — consistent with how HTML normalization already works — and we keep the contract honest by broadening `content_contract.normalization.meaning` to: source was removed, rewritten, **or a sketch block was not recognized and kept as a code block**. *Alternative rejected:* a dedicated `sketch_warning` field or a warning-only signal (`normalized: false`, `warning != null`) — both add asymmetry with the HTML path and force agents to check two signals.
- **KTD-2 — Recognition is `ThinkroomSketch.parse`, mirrored from `DocumentPlainText`.** The create-time audit renders the markdown with the same `Commonmarker.to_html(..., plugins: { table: true, strikethrough: true, tasklist: true })` call as `DocumentPlainText`, selects `pre[lang="excalidraw"] > code`, and calls `ThinkroomSketch.parse` with identical arguments. This guarantees the warning fires iff `plain_text` echoes raw JSON. *Alternative rejected:* regex-scanning raw markdown for fences — fragile against indented/tilde fences and would drift from the renderer's actual recognition.
- **KTD-3 — Do not change validation behavior; only document and report.** `ThinkroomSketch.parse` (Ruby) intentionally does **not** validate `id` or `height` — those are enforced TS-side by `normalizeSketchData` when the live editor mounts the scene. We leave both validators exactly as they are. The contract documents the *full* TS shape (what the editor requires: `id` pattern, `height` range) so agents author correctly, while the create-time warning mirrors the *Ruby* recognition that drives `plain_text`. The narrow gap (a fence with a bad/missing `id` or `height` is recognized server-side but may be re-normalized by the editor) is documented, not closed — see Scope Boundaries.
- **KTD-4 — A single Ruby source of truth for sketch height bounds.** Add `DEFAULT_HEIGHT`/`MIN_HEIGHT`/`MAX_HEIGHT` constants to `ThinkroomSketch` (mirroring the existing `MAX_*`/`ELEMENT_TYPES` constants already surfaced in the contract) and reference them from both the contract and `DocumentPreviewHtml` (which currently hard-codes the same three literals). This keeps the documented height range and the preview's skeleton clamp from drifting.

---

## Scope boundaries

**In scope**
- Rewrite `content_contract.sketches.markdown_source` into a structured schema + example (R1).
- Update the markdown sketch guidance in `AgentGuide.notes` and the plain-text `AgentGuide.text` guide to reference the real shape and recognition signal (R1, R3).
- Add a markdown sketch audit and wire it into the markdown branch of `Api::DocsController#create` (R2).
- Broaden `content_contract.normalization.meaning` to cover the unrecognized-sketch case (R2).
- Add Ruby height constants and dedupe `DocumentPreviewHtml`'s local copies (KTD-4).

**Out of scope (true non-goals)**
- Changing sketch validation rules in `ThinkroomSketch.parse` or `normalizeSketchData` (`app/frontend/editor/sketch/scene.ts`). Behavior stays identical.
- HTML-document sketch authoring. The contract already states external HTML cannot set reserved sketch attributes; markdown remains the only agent authoring path and is the entire focus here.
- Any change to how sketches render in the editor or preview.

### Deferred to follow-up work
- **Ruby/TS recognition parity for `id` and `height`.** Today a fence whose payload omits or malforms `id`/`height` is recognized by `ThinkroomSketch.parse` (so no create-time warning) but may be rejected/normalized when the TS editor mounts it. Tightening Ruby parse to also require `id`/`height` would close the gap but risks reclassifying already-stored sketches as invalid; it needs its own migration-safety pass. Documented now (KTD-3), deferred as behavior change.

---

## Implementation units

### U1. Rewrite the sketch contract and agent guidance to the real schema

**Goal:** Replace the misleading one-line `markdown_source` description with the true `SketchData` schema plus a copy-pasteable example, document the recognition signal, and establish Ruby height constants as the single source of truth.

**Requirements:** R1, R3 (and KTD-4).

**Dependencies:** none.

**Files:**
- `app/services/thinkroom_sketch.rb` — add `DEFAULT_HEIGHT = 448`, `MIN_HEIGHT = 180`, `MAX_HEIGHT = 1200` constants (mirroring the existing `MAX_SCENE_BYTES`/`ELEMENT_TYPES` style).
- `app/services/agent_guide.rb` — rewrite the `sketches.markdown_source` entry in `content_contract` from a `String` to a structured object (schema + example + recognition note); update the `markdown_source` reference and add a recognition line to the sketch entry in `notes`; tighten the sketch paragraph in the `text` plain-text guide to reference the real shape and recognition signal.
- `app/services/document_preview_html.rb` — replace the local `DEFAULT_SKETCH_HEIGHT`/`MIN_SKETCH_HEIGHT`/`MAX_SKETCH_HEIGHT` literals with the new `ThinkroomSketch` constants (no behavior change).
- `test/integration/agent_discovery_test.rb` — update the existing contract assertion (currently `assert_includes body.dig("content_contract", "sketches", "markdown_source"), "excalidraw"`, which assumes a String) to the new object shape, and assert the example + recognition signal are present.
- `test/services/document_preview_html_test.rb` — confirm skeleton height behavior is unchanged after the constant swap.

**Approach:** The new `markdown_source` object should carry: a `format` note (a fenced ` ```excalidraw ` block whose body is a single JSON object), the field schema (`formatVersion` must equal 1; `id` matches `^[a-zA-Z0-9_-]{1,100}$`; `description` string ≤ `MAX_DESCRIPTION_LENGTH`; `height` integer in `MIN_HEIGHT..MAX_HEIGHT`, default `DEFAULT_HEIGHT`; `scene` is a full Excalidraw export with `type: "excalidraw"`, `version > 0`, allowlisted `appState` whose `viewBackgroundColor` matches the safe-color regex, and `files: {}`), a `recognition` note (`plain_text` shows `Sketch: <description> — <labels>` when recognized; raw scene JSON means it was not recognized), and an `example` string containing the working fence from the issue. Keep the existing `supported_elements` and `limits` keys. Reference `ThinkroomSketch` constants (`FORMAT_VERSION`, `ELEMENT_TYPES`, height constants, `MAX_*`) rather than hard-coding values, so the contract tracks the validator.

**Patterns to follow:** the existing `html:` sub-contract in `content_contract` (`app/services/agent_guide.rb:147`) already composes a structured object that references sanitizer constants — mirror that style. The `SAFE_COLOR` and `ELEMENT_TYPES` constants in `ThinkroomSketch` are the authoritative regex/list to cite.

**Test scenarios:**
- `content_contract("markdown", base_url)` returns `sketches.markdown_source` as a Hash (not a String) containing keys for the schema, an `example`, and a `recognition` note. *(Covers R1, R3.)*
- The `markdown_source` schema reports `formatVersion` required `== 1`, the `id` pattern, the `height` default/min/max matching `ThinkroomSketch` constants, and a `scene` description naming `type: "excalidraw"`, `version`, `appState`, and `files: {}`.
- The `example` value is a non-empty fenced `excalidraw` block whose JSON, when parsed through `ThinkroomSketch.parse` (with its `scene`/`description`/`formatVersion`), is recognized — i.e., the documented example actually works. *(Guards against the example drifting from the validator.)*
- The agent discovery share URL (`GET /d/:slug` plain-text guide) mentions the real recognition signal text. *(Covers R3.)*
- `DocumentPreviewHtml` produces identical skeleton heights before/after the constant swap (default when height absent, clamped within `MIN_HEIGHT..MAX_HEIGHT`). *(Regression guard for KTD-4.)*

**Verification:** the contract test suite passes with the new object shape; the documented `example` round-trips through `ThinkroomSketch.parse` as recognized.

### U2. Add a markdown sketch audit service

**Goal:** Provide a focused service that, given markdown content, reports how many `excalidraw` fences are present and how many failed recognition, using the exact `ThinkroomSketch.parse` path that drives `plain_text`.

**Requirements:** R2.

**Dependencies:** none (U3 consumes it).

**Files:**
- `app/services/markdown_sketch_audit.rb` — new service. `MarkdownSketchAudit.call(content)` returns a small result (e.g. a `Data.define(:fence_count, :unrecognized_count)` with an `unrecognized?` predicate). It renders the content via the same `Commonmarker.to_html(content, plugins: { table: true, strikethrough: true, tasklist: true })` call `DocumentPlainText` uses, selects `pre[lang="excalidraw"] > code`, parses each code body as JSON, and runs `ThinkroomSketch.parse(JSON.generate(payload["scene"]), description: payload["description"], format_version: payload["formatVersion"])`. A fence is "unrecognized" when JSON parsing fails, the `scene` key is missing, or `ThinkroomSketch.parse` returns `nil`.
- `test/services/markdown_sketch_audit_test.rb` — new test.

**Approach:** Mirror the markdown branch of `DocumentPlainText.replace_sketches` (`app/services/document_plain_text.rb:40-51`) for fence selection and parse-argument construction so recognition stays identical. Do not reimplement validation — delegate entirely to `ThinkroomSketch.parse`. The service is pure/stateless and does not touch the database.

**Patterns to follow:** `DocumentPlainText` (rendering + Nokogiri fragment + `ThinkroomSketch.parse`) and the `Data.define` result style already used by `HtmlDocumentSanitizer::Result` (`content`, `changed?`) and `ThinkroomSketch::Parsed`.

**Test scenarios:**
- Content with a single valid `excalidraw` fence (the issue's working example) → `fence_count: 1`, `unrecognized_count: 0`, `unrecognized?` false. *(Covers R2 happy path.)*
- Content with a fence using the *documented-but-wrong* old shape (`version` instead of `formatVersion`, `scene` lacking `type: "excalidraw"`) → `unrecognized_count: 1`, `unrecognized?` true. *(Covers R2 failure path — the exact case from the issue.)*
- Content with malformed JSON inside the fence → counted unrecognized (JSON parse error handled, not raised).
- Content with a fence missing the `scene` key → counted unrecognized (KeyError handled).
- A plain ` ```json ` or ` ```ruby ` code block that happens to contain a `scene`-like object → `fence_count: 0` (only `pre[lang="excalidraw"]` fences count), `unrecognized?` false. *(Guards against false positives on ordinary code blocks.)*
- Content with two fences, one valid and one invalid → `fence_count: 2`, `unrecognized_count: 1`.
- Content with no fences (or blank content) → `fence_count: 0`, `unrecognized?` false.

**Verification:** the service returns `unrecognized?` true for exactly the inputs where `DocumentPlainText.call` would leave raw scene JSON in the output.

### U3. Surface the audit in the create response and broaden the contract meaning

**Goal:** Make a failed markdown sketch fence non-silent in `POST /api/docs`, and update the contract's normalization meaning to honestly describe the new signal.

**Requirements:** R2.

**Dependencies:** U2 (uses `MarkdownSketchAudit`); coordinates with U1 (both touch `content_contract` — U1 edits the `sketches` sub-hash, U3 edits the `normalization` sub-hash; no overlap, but land U1 first to avoid an edit conflict).

**Files:**
- `app/controllers/api/docs_controller.rb` — in `create`, for the markdown branch run `MarkdownSketchAudit.call(content)`; when `unrecognized?`, set `normalized: true` and a `warning` (e.g. `"An excalidraw block was not a valid sketch and was kept as a code block."`, pluralized when `unrecognized_count > 1`). Leave the HTML branch (`HtmlDocumentSanitizer`-driven) untouched. The audit runs on the submitted `content` (markdown source is not server-normalized, so `source == content`).
- `app/services/agent_guide.rb` — broaden `content_contract.normalization.meaning` to include the unrecognized-sketch-kept-as-code-block case.
- `test/integration/agent_api_test.rb` — new create-response tests.

**Approach:** Keep the response assembly in `create` minimal — compute `normalized`/`warning` from the audit for markdown, from `normalization&.changed?` for HTML (existing behavior). A clean shape is to resolve `normalized`/`warning` once before building the response hash so the markdown and HTML paths read symmetrically. Do not alter `seed_content` — the fence stays verbatim in the stored source, consistent with the "kept as a code block" warning text.

**Patterns to follow:** the existing HTML normalization wiring in the same action (`app/controllers/api/docs_controller.rb:35,67-68`) and its tests in `agent_api_test.rb` ("agent creates sanitized HTML…" asserting `body["normalized"]` and `assert_includes body["warning"], "normalized"`).

**Test scenarios:**
- Markdown create with **no** sketch (`markdown: "# From an agent"`) → `normalized: false`, `warning: nil`. *(Regression guard — existing create tests must stay green.)*
- Markdown create with a **valid** sketch fence (issue's working example) → `201`, `normalized: false`, `warning: nil`, and `plain_text` contains `"Sketch: <description> — <labels>"` (recognized). *(Covers R2 success + recognition signal.)*
- Markdown create with an **invalid** sketch fence (old documented shape) → `201`, `normalized: true`, `warning` mentions the excalidraw block being kept as a code block, and `plain_text` echoes the raw scene JSON (the documented failure signal). *(Covers R2 failure path; ties response to recognition.)*
- Markdown create with two fences, one valid + one invalid → `normalized: true`, pluralized warning.
- HTML create with unsupported markup → unchanged: `normalized: true`, existing `"…normalized…"` warning. *(Confirms HTML path untouched.)*
- `content_contract.normalization.meaning` text now covers the unrecognized-sketch case.

**Verification:** an agent submitting the issue's failing payload now receives `normalized: true` + a warning in the same `201` response; the valid payload still returns a clean success; HTML behavior is unchanged.

---

## Risks & dependencies

- **Recognition drift between the audit and `plain_text`.** Mitigated by KTD-2: both paths call `ThinkroomSketch.parse` with identical arguments, and U3's test asserts the response signal and `plain_text` agree on the same payload. If `DocumentPlainText`'s fence selection ever changes, the audit must change with it — the shared `ThinkroomSketch.parse` contract is the seam that keeps them honest.
- **Existing contract test couples to a String.** `agent_discovery_test.rb` currently asserts `markdown_source` includes `"excalidraw"` as a String; changing it to a Hash will break that line. Explicitly updated in U1 — not a surprise regression.
- **`normalized` semantics overload.** Setting `normalized: true` without mutating source is a deliberate stretch (KTD-1); the contract `meaning` is broadened in U3 so the documentation never contradicts the behavior.
- **Performance:** the audit adds one extra `Commonmarker` render of the submitted markdown per create. Document creation is rate-limited and low-frequency; the cost is the same order as the `plain_text` render already performed on the new document. Acceptable.
- **No new dependencies, migrations, or env/config changes.** Pure Ruby service + controller + documentation strings.

---

## Acceptance

The issue is resolved when:
1. An agent reading only `GET /api/docs/:slug` (or the share-URL guide) can author a valid markdown sketch on the first attempt from the documented schema + example. (R1)
2. Submitting an `excalidraw` fence that fails validation returns `201` with `normalized: true` and an explanatory `warning`, distinguishable from success. (R2)
3. The contract documents that recognized sketches appear in `plain_text` as `Sketch: <description> — <labels>`, and raw scene JSON signals non-recognition. (R3)
4. Valid sketches and sketch-free documents still return `normalized: false`, `warning: null`; HTML normalization is unchanged.

---

## Sources & research

- Origin issue: https://github.com/kieranklaassen/thinkroom/issues/55 (includes the verified working fence used as the documented example and in tests).
- `app/services/agent_guide.rb` — `content_contract`, `notes`, `text` (the self-documenting agent contract).
- `app/controllers/api/docs_controller.rb` — `create` (where `normalized`/`warning` are emitted; markdown currently never normalizes).
- `app/services/thinkroom_sketch.rb` — `ThinkroomSketch.parse` and validation constants (server-side recognition source of truth).
- `app/frontend/editor/sketch/scene.ts` — `normalizeSketchData` / `normalizeSketchScene` (TS validation: `id` pattern, `height` 180–1200, full scene shape).
- `app/services/document_plain_text.rb` — the recognition path the audit mirrors (`pre[lang="excalidraw"] > code` → `ThinkroomSketch.parse`).
- `app/services/document_preview_html.rb` — duplicate height constants consolidated in KTD-4.
- `test/integration/agent_api_test.rb`, `test/integration/agent_discovery_test.rb`, `test/services/document_plain_text_test.rb` — existing patterns for create-response and contract assertions.
