---
title: "feat: Add minimal document link previews"
type: feat
date: 2026-06-26
---

# feat: Add minimal document link previews

## Summary

Give every shared document URL server-rendered Open Graph and Twitter metadata plus a dynamic 1200×630 PNG containing the document title and a short excerpt. Keep the image deliberately unbranded and visually neutral so a pasted Thinkroom URL reads as the document itself, not as an advertisement for the application.

---

## Problem Frame

Document pages currently expose only the browser title. Messaging apps and social networks therefore have no image, excerpt, canonical URL, or explicit content type when they unfurl a shared document URL. The preview should be available from the first HTML response because crawlers do not run the hydrated editor and may not execute JavaScript at all.

The active reading theme is a viewer-local cookie. A social crawler fetching the shared URL does not receive the sharer's cookie, so it cannot reliably reproduce that person's theme unless Thinkroom starts encoding theme in shared URLs or persisting it on each document. This change intentionally avoids either product-level behavior change and uses one stable minimal visual treatment.

## Requirements

### Metadata

- R1. A browser or recognized link-preview crawler request for `/d/:slug` includes `og:type`, `og:title`, `og:description`, `og:url`, `og:image`, `og:image:width`, `og:image:height`, and `og:image:alt` in the initial server response.
- R2. The response includes the equivalent large-image Twitter card metadata.
- R3. Metadata uses the server-derived display title and a bounded plain-text excerpt from the current document content; all user-authored values remain safely escaped.
- R4. The canonical and image URLs are absolute, preserve the request host and HTTPS scheme in production, and version the image URL when document content changes.

### Image

- R5. The image endpoint returns a valid 1200×630 PNG suitable for link unfurlers, with the document title as the visual hierarchy and an optional excerpt beneath it.
- R6. The image includes no Thinkroom wordmark, logo, author attribution, ownership data, tags, collaboration state, or application chrome.
- R7. Long, blank, Unicode, Markdown, and HTML document content produces a bounded image without overflow, raw markup, or rendering errors.
- R8. Image responses are publicly cacheable and keyed by the document version so repeated crawler requests do not repeatedly rasterize unchanged content or remain stale after edits.

### Existing behavior

- R9. Explicit text/JSON document responses and curl-like agent discovery remain unchanged, while recognized social unfurlers receive metadata HTML without claiming a seed, adding a recent document, or otherwise mutating document state.
- R10. Unknown document image URLs return the normal 404 response and do not leak other document data.

## Assumptions

- The requested preview applies to shared document URLs, not the landing page.
- Stable neutral styling is preferable to changing shared-link semantics solely to carry a viewer-local theme.
- PNG is the delivery format because social preview consumers support it consistently; SVG remains an internal rendering source only.
- A short document excerpt is useful when present, but a title-only image remains valid for blank or title-only documents.

## Key Technical Decisions

- KTD1. **Render metadata on the server and distinguish unfurlers from agents.** `DocumentsController#show` will prepare an Open Graph payload before the Inertia render, and the application layout will emit it ahead of the hydrated head tags. A narrow allowlist of known link-preview user agents will receive HTML even though they do not identify as Mozilla; existing curl/wget-style agent discovery will remain plain text.
- KTD2. **Use a dedicated public image endpoint.** `/d/:slug/og.png` will load the same document and return an inline PNG with explicit dimensions and cache validators.
- KTD3. **Rasterize a small escaped SVG with ruby-vips.** The project already ships `ruby-vips` and libvips in production. SVG keeps the visual template auditable while PNG provides crawler compatibility without another image dependency.
- KTD4. **Share one title/excerpt projection.** A small service will derive bounded display copy from `display_title` and `plain_text`, remove a duplicated leading title from the excerpt, and feed both HTML metadata and the image renderer.
- KTD5. **Version by document cache key.** The metadata image URL will include `updated_at`, and the generated PNG will be cached by `cache_key_with_version` plus a renderer version. HTTP ETags provide a second validation layer.

## Scope Boundaries

### Included

- Document-page Open Graph and Twitter card tags.
- Dynamic document PNG generation, caching, versioned image URLs, and accessible alt text.
- Unit/integration coverage for copy projection, raster dimensions, metadata, caching headers, and 404 behavior.

### Outside this change

- Landing-page cards, per-user or per-document theme persistence, theme query parameters in copied links, branding, logos, author portraits, screenshot rendering, background jobs, or third-party image services.
- Changing document privacy, slug access, content storage, editor state, exports, or collaboration behavior.

## Implementation Units

### U1. Bounded social-preview projection and PNG renderer

- **Goal:** Produce safe, stable preview copy and a valid minimal PNG for any document content.
- **Requirements:** R3, R5-R8.
- **Dependencies:** None.
- **Files:** `app/services/document_social_preview.rb`, `app/services/document_og_image.rb`, `test/services/document_social_preview_test.rb`, `test/services/document_og_image_test.rb`.
- **Approach:** Derive the display title from the existing server projection, derive a plain-text excerpt with the duplicated leading title removed, and truncate both at word/grapheme boundaries. Build an escaped SVG with a neutral paper surface, fine rule, large title lines, and smaller excerpt lines; rasterize it through ruby-vips and cache the result by renderer/document version.
- **Test scenarios:** Markdown and HTML input; raw markup and XML-sensitive characters; Unicode graphemes; long title/excerpt wrapping; title-only and blank bodies; PNG signature and exact 1200×630 dimensions; stable cached output for an unchanged document.
- **Verification:** Service tests load the generated bytes with libvips and confirm the dimensions without exceptions or clipped line counts.

### U2. Public OG image endpoint

- **Goal:** Serve the generated image at a predictable absolute URL with crawler-friendly response semantics.
- **Requirements:** R4, R5, R8, R10.
- **Dependencies:** U1.
- **Files:** `config/routes.rb`, `app/controllers/document_og_images_controller.rb`, `test/integration/document_og_image_test.rb`.
- **Approach:** Add `/d/:slug/og.png` through a small `ActionController::Base` asset controller, look up by slug, return the cached PNG inline as `image/png`, attach a public cache policy and ETag, and retain normal `RecordNotFound` handling. Keeping the endpoint outside the application/Inertia controller hooks prevents both ownership and XSRF session cookies from weakening public caching.
- **Test scenarios:** Existing document returns 200, PNG media type and inline disposition, public cache header and ETag, conditional GET returns 304, unknown slug returns 404, no ownership cookie is minted, and the endpoint does not claim a seed or mutate document state.
- **Verification:** Integration tests and a local `curl`/image inspection confirm response headers, bytes, and dimensions.

### U3. Server-first document metadata

- **Goal:** Make every document HTML response self-sufficient for link unfurlers.
- **Requirements:** R1-R4, R6, R9.
- **Dependencies:** U1, U2.
- **Files:** `app/controllers/documents_controller.rb`, `app/views/layouts/application.html.erb`, `test/integration/document_open_graph_test.rb`, `test/integration/agent_discovery_test.rb`.
- **Approach:** Build a document-only metadata hash before the Inertia render and emit Open Graph/Twitter tags conditionally in the layout. Use request-aware Rails URL helpers, the versioned image path, exact image dimensions, and title-based alt text. Recognize common Facebook, X/Twitter, LinkedIn, Slack, Discord, WhatsApp, and generic OpenGraph preview user agents as HTML unfurlers; exclude those requests from recent-list and seed-claim side effects. Preserve explicit JSON/text and ordinary non-browser agent responses.
- **Test scenarios:** Initial browser HTML contains escaped title/excerpt and absolute canonical/image URLs; host follows both production domains; image URL version changes after a content update; no Thinkroom branding appears in the image alt/copy; representative non-Mozilla social crawlers receive HTML metadata without claiming a seed; curl still receives the agent guide; explicit JSON/text representations remain unchanged.
- **Verification:** Integration assertions inspect the raw response head, and the browser pipeline confirms the rendered document still loads with no console errors.

## System-Wide Impact

- **Data:** No schema or document mutation. Preview data is derived from the current persisted snapshot/seed.
- **SSR/hydration:** Metadata exists before Inertia SSR/client hydration and does not participate in React state, so there is no head flash or hydration branch.
- **Security/privacy:** The endpoint exposes only content already available at the public slug. HTML/SVG values are escaped, image generation receives bounded strings, and asset fetches do not mint ownership cookies.
- **Performance:** PNG rasterization is cached by document version and served with validators. The document HTML adds only a small set of meta tags.
- **Agent parity:** Programmatic JSON/text branches return before metadata setup and retain their existing self-describing contract.

## Risks and Dependencies

- **libvips SVG support:** Production must include the SVG loader used by ruby-vips. Mitigation: exercise the same renderer in the Docker/Kamal build and production smoke test; the production image already installs libvips.
- **Social crawler caching:** Crawlers may cache an old preview independently. Mitigation: include the document version in `og:image` so edits produce a new URL.
- **Text measurement:** SVG has no browser layout engine. Mitigation: bound lines conservatively with deterministic word/grapheme wrapping and test worst-case content.
- **Metadata duplication:** Inertia also manages the document `<title>`. Mitigation: add only social metadata to the Rails layout and keep the existing Inertia title path unchanged.
- **Crawler classification:** Existing non-Mozilla requests are intentionally treated as agents, but most social unfurlers are also non-Mozilla. Mitigation: use a deliberately narrow, tested preview-bot allowlist and preserve explicit format negotiation as the stronger signal.

## Acceptance Examples

- AE1. Given a document titled “Quarterly plan” with body text, when its URL is unfurled, then the card contains that title, a short plain-text excerpt, and a 1200×630 image with no Thinkroom branding.
- AE2. Given a document whose title contains `&` and whose body contains Markdown/HTML, when the raw page head and image are fetched, then values are escaped and no source markup appears.
- AE3. Given an edited document, when a crawler refetches its page, then `og:image` has a new version parameter and resolves to the updated preview.
- AE4. Given a missing slug, when `/d/missing/og.png` is requested, then the response is 404.

## Sources and Research

- GitHub issue #69 requests minimal, attractive OG images centered on the document title, without Thinkroom branding; theme matching is optional.
- `app/views/layouts/application.html.erb` is the server-owned head and already renders before the Inertia SSR head.
- `DocumentsController#show` already derives `display_title`, sanitized preview HTML, and agent-specific early responses from the current persisted document.
- `DocumentsController#agent_user_agent?` currently sends every non-Mozilla user agent to the plain-text agent guide, so social crawler user agents require an explicit HTML carve-out and must remain excluded from seed claims.
- `DocumentPlainText` provides the format-independent, sketch-aware text projection needed for a safe excerpt.
- `Gemfile` and the production Docker image already include `ruby-vips`/libvips.
- `docs/solutions/architecture-patterns/server-first-instant-paint.md` establishes the project rule that known document projections should be delivered on the first server response rather than waiting for client code.
