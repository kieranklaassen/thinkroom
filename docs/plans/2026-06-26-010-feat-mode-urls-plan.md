---
title: "feat: Make document modes addressable in the URL"
type: feat
date: 2026-06-26
issue: 76
---

# feat: Make document modes addressable in the URL

## Summary

Make Read the canonical document URL, give Edit, Suggest, and Comment stable mode-specific URLs, and use Inertia client-side history state so switching modes is instant while links, reloads, and browser Back/Forward all restore the intended mode.

## Requirements

- R1. `/d/:slug` opens an ordinary document in Read mode.
- R2. `/d/:slug/edit`, `/d/:slug/suggest`, and `/d/:slug/comment` open the matching mode.
- R3. Choosing a mode updates the address bar without a network request, editor remount, scroll reset, or loss of in-progress client state.
- R4. Browser Back and Forward restore both the URL and active mode.
- R5. Reloading or directly opening a mode URL restores that mode from the server-rendered Inertia props; a stale mode cookie cannot override the URL.
- R6. If the viewer cannot write, a direct non-Read URL redirects to `/d/:slug`; if write permission disappears while the page is open, the client replaces the current history entry with the canonical Read URL.
- R7. The special demo remains locked to Edit at its established `/d/demo` URL; alternate demo mode URLs redirect to that canonical URL.
- R8. Existing sharing, Open Graph, agent API, collaboration, mode shortcuts, responsive mode control, and document action routes remain intact.
- R9. Creating a document through the home page redirects its creator to `/d/:slug/edit`, so the creation flow remains immediately actionable even though the canonical document URL is Read.

## Key Decisions

- KTD1. Use explicit constrained Rails routes for `edit|suggest|comment`, keeping the existing named `/d/:slug` route canonical for Read. Do not add `/read` or accept arbitrary mode segments.
- KTD2. Keep mode inside the existing `ui` Inertia prop, but derive it from the request path rather than `pruf_mode`. This preserves the current component contract and gives SSR and hydration one source of truth.
- KTD3. Use Inertia 3's client-side `router.push` with both `url` and updated props. That creates real Inertia history entries without issuing HTTP requests; native Back/Forward can therefore restore the saved page props as well as the path.
- KTD4. Treat all non-Read modes as unavailable when `ownership.can_write` is false, matching the existing locked mode control and `effectiveMode` guard. Authorization-dependent redirects use 303 and are not permanent-cache redirects.
- KTD5. Preserve the demo exception introduced with document modes. Its fixed Edit behavior remains canonical at `/d/demo`, so mode URLs do not imply choices the control refuses to make.
- KTD6. Retire mode-cookie persistence. The URL now provides stronger, shareable, reload-safe persistence; panel, focus, theme, and width cookies remain unchanged.
- KTD7. Keep library/document-share destinations canonical, but treat creation as an editing intent. Only the successful UI create redirect adds `/edit`; API response URLs and ordinary document links remain `/d/:slug`.

## Implementation Units

### U1. Server routing and canonical mode resolution

- **Files:** `config/routes.rb`, `app/controllers/documents_controller.rb`, `test/integration/document_mode_routing_test.rb`
- **Approach:** Add a constrained mode route before the canonical document route. Resolve the requested mode before rendering, feed it into `ui_prefs`, and redirect unavailable or noncanonical demo mode paths before recent-list, seed-claim, or render side effects. Remove `pruf_mode` parsing and redirect successful UI creation to the new Edit route.
- **Verification:** Integration tests cover the canonical Read URL, each write-mode URL, unknown modes, locked non-owner redirects, locked owner access, demo canonicalization, the create-to-Edit redirect, and mode props in initial Inertia responses.

### U2. Inertia client-side mode history

- **Files:** `app/frontend/pages/documents/show.tsx`
- **Approach:** Derive the active mode directly from `ui.mode`. On an allowed change, call `router.push` with the matching mode URL and a copied `ui.mode` prop while preserving state and scroll. Replace a non-Read history entry with the canonical URL if a later ownership update removes write access. Remove the mode-cookie write effect.
- **Verification:** Choosing modes changes the control and path instantly without a document request or editor remount; Back/Forward restores modes from Inertia history without a document request; keyboard shortcuts use the same path.

### U3. End-to-end browser coverage

- **Files:** `script/browser_check.mjs`
- **Approach:** Replace mode-cookie setup with mode URLs and add a focused sequence that checks canonical Read, client-side path changes, no mode-navigation document request, Back/Forward restoration, reload persistence, and locked-viewer fallback. Update editable smoke-check pages to enter through `/edit` where necessary.
- **Verification:** Focused browser checks pass on desktop and the mode control remains usable in the existing responsive sheet flow.

## Acceptance Examples

- AE1. Given a writable document at `/d/abc`, when it loads, then the control says Read mode and the editor is non-editable.
- AE2. When the viewer chooses Edit, then the control says Edit mode and the address becomes `/d/abc/edit` without requesting a new page or losing the current editor session.
- AE3. When the viewer then chooses Suggest and presses Back, then the browser returns to `/d/abc/edit` and the control returns to Edit; Forward restores Suggest.
- AE4. Given `/d/abc/comment` in a fresh tab, then the initial server response and hydrated page both use Comment mode.
- AE5. Given a locked document opened by a non-owner at `/d/abc/edit`, then the server redirects to `/d/abc` and the page opens in Read mode.
- AE6. Given `/d/demo/suggest`, then the server redirects to `/d/demo`, which remains locked in Edit mode.
- AE7. Given the home page, when the viewer creates a document, then the redirect lands on `/d/:slug/edit` ready for typing.

## Risks

- Inertia history can update the path without updating page props. Always push both together; otherwise Back/Forward restores a URL whose control still shows the previous mode.
- A normal Inertia `visit` would refetch the full document and can remount the collaborative editor. Use the client-side `push` API and assert no mode-navigation request occurs.
- Permission can change after initial render. Keep the server redirect for direct visits and add a client replacement path for ownership partial reloads.
- Changing the canonical default from Edit to Read affects browser smoke setup. Enter `/edit` explicitly for scenarios that type, toggle edit-only controls, or insert sketches.
