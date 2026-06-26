---
title: "feat: Organize the document index"
type: feat
date: 2026-06-26
---

# feat: Organize the document index

## Summary

Redesign the home-page document lists into a higher-contrast library with creation dates, stable “This week” and “Earlier” groups, tag filtering, and owner-controlled inline tag editing. Remove format badges from the index and keep recent-document claiming intact.

---

## Problem Frame

The index treats documents as a low-contrast stream of title links with implementation-format labels that do not help someone find or organize their work. As ownership accumulates up to 50 documents, the list becomes difficult to scan because it has no time hierarchy, visible creation context, or user-defined grouping.

The index is also server-rendered. Any time grouping or date label rendered from the browser clock could differ from the server render and create hydration drift, so the presentation contract must arrive in the Inertia props.

---

## Requirements

### Document hierarchy and metadata

- R1. Index rows omit Markdown and HTML format labels while preserving document-format behavior everywhere else.
- R2. Every owned and recently opened document row shows a concise creation date backed by a machine-readable date value.
- R3. Owned documents are grouped into “This week” and “Earlier” using a server-derived boundary that renders identically during SSR and hydration.
- R4. The earlier group initially shows eight rows and offers an in-place reveal control for the remainder so a large library stays compact without dropping records.

### Tags and organization

- R5. Document owners can add, rename, and remove up to eight normalized tags of 32 characters each from the index without leaving the page.
- R6. Owned-document tags appear as compact chips and provide an “All” plus per-tag filter that preserves the time groups within the filtered result.
- R7. Tag mutation is enforced as owner-only on the server for both signed-in and guest-token ownership, and validation failures remain visible in the edited row.

### Visual and behavioral continuity

- R8. The document library uses stronger title, metadata, divider, hover, and focus contrast while remaining consistent with the existing warm-paper design tokens; text and interactive states meet WCAG AA contrast.
- R9. Recent-document empty states, claim actions, ownership labels, new-document creation, agent instructions, account controls, and footer behavior continue to work.
- R10. The revised library remains usable on narrow screens, including wrapped tag chips, non-overlapping metadata, and reachable edit/reveal controls.

---

## Assumptions

- Tags are shared document metadata: anyone who encounters the document in their recent list can see them, but only the owner can change them.
- This iteration keeps tagging focused on the human index. Agent API creation, API tag mutation, dedicated tag-management pages, and tag display inside the editor are outside scope.
- “This week” follows the Rails application time zone and its configured beginning of week, which keeps SSR deterministic. The date label is intentionally day-level rather than relative-time copy that can become stale.
- The “Earlier” reveal is ephemeral UI state. It does not paginate, change the existing 50-document ownership cap, or add URL state.

---

## Key Technical Decisions

- KTD1. **Store tags as a constrained JSON array on each document:** A join model would add identity, lifecycle, and query complexity that this single-owner organization surface does not need. Model normalization and validation will keep the array bounded and predictable.
- KTD2. **Keep server props as the index source of truth:** `DocumentsController#index` will serialize tags, an ISO creation date, a display label, and a stable age group. React will filter and render those props without a second fetch lifecycle.
- KTD3. **Use an owner-only PRG mutation endpoint:** Inline editors submit through Inertia to a dedicated document-tags route, then redirect back and partially reload the document lists. The controller repeats ownership enforcement even though the edit affordance is hidden for non-owners.
- KTD4. **Filter locally, mutate on the server:** The owned library is already capped at 50 records, so tag filtering and earlier-list expansion are cheap ephemeral state. Persisted tags and authorization remain server-owned.
- KTD5. **Preserve the existing index SSR contract:** Grouping, labels, default expansion, and initial markup must not depend on `window`, locale-specific browser formatting, or a post-mount regrouping pass. This follows the server-first pattern documented in `docs/solutions/architecture-patterns/server-first-instant-paint.md`.

---

## Scope Boundaries

### Included

- Home-page owned and recent document lists, their responsive styling, creation metadata, and existing claim/owner affordances.
- Persistent document tags, owner-only tag mutation, tag chips, and owned-library tag filtering.
- Regression coverage for the model contract, Inertia props, authorization, grouping metadata, and browser-visible interactions.

### Outside this change

- Changing Markdown or HTML editing, creation, export, or API contracts.
- Searching document contents, sorting controls, pagination, folders, nested tags, tag colors, or a standalone taxonomy manager.
- Raising or removing the existing 50-owned-document and 12-recent-document caps.
- Reworking the hero, agent instruction card, account controls, footer, or overall product branding beyond spacing needed to fit the wider library.

---

## Implementation Units

### U1. Persistent document tag contract

- **Goal:** Add bounded, normalized tag metadata to documents without changing existing records or content behavior.
- **Requirements:** R5, R7.
- **Dependencies:** None.
- **Files:** `db/migrate/20260626110000_add_tags_to_documents.rb`, `db/schema.rb`, `app/models/document.rb`, `test/models/document_test.rb`.
- **Approach:** Add a non-null JSON-array column with an empty default. Normalize whitespace, discard blanks, and deduplicate case-insensitively before validation; cap the array at eight tags and each tag at 32 characters at the model boundary so browser and future callers share one contract.
- **Patterns to follow:** Existing JSON defaults on `documents.provenance_spans`; model-owned normalization near `Document.normalize_display_name`; immutable document-format validation as an example of enforcing storage invariants in `Document`.
- **Test scenarios:** A document defaults to no tags; whitespace and blank entries normalize away; case-insensitive duplicates collapse while the first display spelling survives; the maximum accepted count and length save; over-limit count or length is rejected; existing documents remain valid after migration.
- **Verification:** The migrated schema loads from scratch, model tests exercise valid and invalid boundaries, and unrelated document tests remain green.

### U2. Owner-only tag mutation and index presentation props

- **Goal:** Expose stable date/group/tag props and let only owners update tags through the browser flow.
- **Requirements:** R2, R3, R5, R7, R9.
- **Dependencies:** U1.
- **Files:** `config/routes.rb`, `app/controllers/documents_controller.rb`, `test/integration/document_index_test.rb`, `test/integration/ownership_flow_test.rb`, `test/integration/home_claim_test.rb`.
- **Approach:** Centralize index-row serialization in the controller so owned and recent rows receive the same safe metadata shape. Derive `this_week` versus `earlier` and a compact date label with `Time.zone`, add a dedicated PATCH action, enforce `owned_by?` for both account and guest ownership, and return keyed Inertia errors on invalid or unauthorized updates.
- **Patterns to follow:** Explicit `render inertia: ... props:` in `DocumentsController#index`; ownership checks and redirect/error behavior in `destroy` and `update_editing_lock`; scoped `only: ['yours', 'recent']` reloads in the existing claim flow.
- **Test scenarios:** Index props include tags, machine date, display date, and the correct boundary group; a guest-token owner and signed-in owner can replace tags; non-owners cannot mutate tags; invalid tags leave persisted values unchanged and return a `tags` error; a missing document redirects safely; recent rows preserve ownership/claim props and never expose ownership tokens.
- **Verification:** Focused integration tests demonstrate the serialized contract and every authorization branch while existing claim and ownership regressions still pass.

### U3. Scannable grouped library and inline tag editing

- **Goal:** Replace the flat low-contrast rows with a compact, responsive document library that supports time grouping, filtering, and tag editing.
- **Requirements:** R1-R10.
- **Dependencies:** U2.
- **Files:** `app/frontend/pages/documents/index.tsx`, `app/frontend/entrypoints/application.css`, `script/browser_check.mjs`.
- **Approach:** Introduce small render-only row, group, filter, and tag-editor components inside the page. Render owned documents under stable time headings, truncate the initial earlier set with an accessible reveal button, derive tag filters from owned-document props, and submit per-row edits through keyed `useForm` instances with scroll preservation and scoped prop reloads. Recent rows reuse the clearer title/date/tag treatment while keeping claim and owner affordances.
- **Patterns to follow:** Existing Inertia `Link`, `useForm`, and `useClaim` behavior in `documents/index.tsx`; existing design tokens and focus-visible rules in `application.css`; SSR-safe rendering conventions from `docs/solutions/architecture-patterns/server-first-instant-paint.md`.
- **Test scenarios:** No index row displays Markdown or HTML labels; this-week and earlier headings render from server props; only eight earlier rows render before the reveal control is activated; selecting a tag filters both time groups and exposes a useful empty result when needed; adding/removing tags updates chips after the redirect; invalid input keeps the editor open with its error; claim success still moves a recent document to owned; narrow viewport rows wrap without horizontal overflow; keyboard focus reaches filter, edit, save, cancel, claim, and reveal controls; text and control states meet WCAG AA contrast.
- **Verification:** The focused Rails suite, full TypeScript check, production Vite build, browser smoke checks, and interactive Playwright inspection complete without console, hydration, accessibility, contrast, or overflow errors.

---

## System-Wide Impact

- **Data lifecycle:** The migration is additive and gives every existing document an empty tag array. No backfill or content/Yjs transformation is required.
- **Authorization:** Tag visibility is read-only public metadata for anyone already able to see a document row; mutation follows document ownership, not the broader collaborative write permission used for content.
- **SSR and Inertia:** The server continues to own initial page data and all persisted state. React owns only the selected filter, per-row editor visibility, and earlier-list expansion.
- **Agent parity:** Agents continue to create, read, and edit document content through the existing API. Tagging is intentionally a human-library action in this iteration and does not change agent guide or API contracts.
- **Performance:** The index retains its current record caps. JSON tag arrays and local filtering add bounded work and no additional index query.

---

## Risks and Dependencies

- **Shared metadata surprise:** Document-level tags are visible to collaborators who encounter the document. The UI should avoid implying that tags are private, and API parity should be reconsidered before tags become workflow-critical.
- **Migration safety:** A nullable or object-shaped legacy value would complicate rendering. The database default, non-null constraint, normalization, and model tests must keep the value an array.
- **Authorization drift:** Collaborative write access is broader than ownership. The new action must call the ownership predicate directly and be covered for signed-in, guest-token, and non-owner requests.
- **Hydration drift:** Browser-local date formatting or week calculations can change the first render. All visible date/group props must be serialized by Rails, with React consuming them verbatim.
- **Dense mobile rows:** Dates, tags, owner labels, and controls can compete for space. The row layout must use wrapping and title truncation intentionally, then be checked at the existing mobile breakpoints.

---

## Acceptance Examples

- AE1. Given an owner with documents created this week and earlier, when they open the index, then each document appears once under the correct heading with its creation date and no format badge.
- AE2. Given more earlier documents than the compact threshold, when the owner opens the index, then only the initial earlier set is shown until they activate the reveal control without leaving or scrolling to the top of the page.
- AE3. Given an owner editing a document’s comma-separated tags, when they save valid values, then normalized chips appear on the row and the tag filter updates after the Inertia redirect.
- AE4. Given a non-owner who submits a crafted tag update, when the request reaches the server, then no tag changes and the response returns an ownership error through the normal Inertia redirect flow.
- AE5. Given a selected tag that exists in both time groups, when the owner selects it, then only matching rows remain while the “This week” and “Earlier” hierarchy is preserved.
- AE6. Given an unclaimed recently opened document, when the user claims it from the revised row, then it moves into the owned library with its date and tags and disappears from Recent.

---

## Sources and Research

- `app/frontend/pages/documents/index.tsx` and `app/frontend/entrypoints/application.css` define the current flat list, format labels, claim control, SSR-safe client islands, and warm-paper visual tokens.
- `app/controllers/documents_controller.rb` defines the 50-owned/12-recent caps, explicit Inertia props, session recents, account/guest ownership split, and existing mutation authorization patterns.
- `test/integration/home_claim_test.rb` and `test/integration/ownership_flow_test.rb` provide the regression patterns for list movement, claim races, ownership isolation, and Inertia prop assertions.
- `docs/solutions/architecture-patterns/server-first-instant-paint.md` establishes the repo’s server-first, hydration-stable rendering posture.
- `STRATEGY.md` frames the index as the human-facing judgment layer; tag organization supports deliberate retrieval without expanding Thinkroom into an embedded-agent or chat product.
