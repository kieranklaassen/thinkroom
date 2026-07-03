---
title: "feat: Open Graph image and metadata for the main page"
type: feat
date: 2026-07-03
---

# feat: Open Graph image and metadata for the main page

## Outcome

Sharing the Thinkroom landing page (`/`) in Slack, iMessage, X, etc. unfurls
with a branded 1200×630 preview card in the same warm editorial design as the
document previews, plus complete Open Graph / Twitter metadata. Today the root
page ships no OG tags at all — the layout only emits them when `@open_graph`
is set, and only `documents#show` sets it.

## Problem frame

The per-document OG pipeline already exists and works well: `DocumentOgImage`
renders a hand-positioned SVG (cream field, `Newsreader` serif title,
`Instrument Sans` sans, `T. Thinkroom` wordmark, left margin rule, hairline
footer) and rasterizes it through ruby-vips/librsvg, with fonts vendored under
`vendor/fonts` and registered via `config/initializers/og_image_fonts.rb`. The
PNG is served by a dedicated CSRF-free controller with public caching, ETag,
and a versioned `?v=` URL. The main page needs the same treatment with static
site-level copy instead of document-derived copy.

## Key decisions

- **KTD1 — Dedicated `SiteOgImage` service + controller, mirroring the
  document pipeline.** A static file in `public/` would bypass the vendored
  fonts and drift from the document cards; rendering through the existing
  SVG→libvips path keeps typography and palette identical and reuses the
  fontconfig setup. Content is fixed, so the PNG caches under
  `["site-og-image", VERSION]` alone and the URL is versioned with `?v=VERSION`.
- **KTD2 — Fixed, hand-positioned copy; no wrapping engine.** The card's copy
  is static product copy that already exists in the repo: the serif title is
  the tagline "Where deeper thinking compounds." (split across two hand-set
  lines) and the hairline footer carries the byline "From the creator of
  Compound Engineering." (both from the landing hero in
  `app/frontend/pages/documents/index.tsx`). Header keeps the `T. Thinkroom`
  wordmark; no eyebrow, no pills, default maroon accent. No text is dynamic,
  so `DocumentOgImage`'s wrap/ellipsize helpers are not needed.
- **KTD3 — Root metadata rides the existing `@open_graph` layout block.**
  `DocumentsController#index` sets `@open_graph` with site copy; the layout
  gains a `type` key (default `"article"`) so the root can declare
  `og:type=website` while document pages are unchanged. `page_title` stays
  exactly "Thinkroom" so the `<title>` asserted by `test/integration/branding_test.rb`
  does not change. Both images are the standard 1200×630, so the layout's
  width/height tags remain sourced from `DocumentOgImage::WIDTH/HEIGHT`.
- **KTD4 — Endpoint semantics copied from `DocumentOgImagesController`:**
  GET-only public inline PNG at `/og.png`, `allow_forgery_protection = false`
  (no Set-Cookie), `expires_in 1.day, public: true, stale_while_revalidate:
  1.hour`, ETag from the cache key for conditional 304s.

## Requirements

1. `GET /og.png` returns a 1200×630 PNG in the editorial design with the
   tagline title and byline footer; publicly cacheable, inline, ETag/304,
   no ownership or session cookie minted.
2. `GET /` (browser) emits `og:title`, `og:description`, `og:url`,
   `og:image` (versioned URL), `og:type=website`, `og:site_name`,
   image dimensions/alt, `twitter:card=summary_large_image` and twitter
   title/description/image, a meta description, and a canonical link.
3. Document pages keep `og:type=article` and their existing metadata
   unchanged.
4. The `<title>` on `/` remains exactly "Thinkroom".

## Implementation units

### U1. `SiteOgImage` renderer service

**Goal:** Render the landing card PNG.
**Files:** `app/services/site_og_image.rb`, `test/services/site_og_image_test.rb`
**Approach:** Constants mirror `DocumentOgImage` (WIDTH/HEIGHT/VERSION,
palette, font stacks — palette/font constants may reference
`DocumentOgImage`'s to avoid divergence). `call` fetches from `Rails.cache`
keyed on `cache_key` = `["site-og-image", VERSION]`; SVG is fully static.
**Test scenarios:**
- Renders a PNG at 1200×630 (subprocess `bin/rails runner` pattern from
  `test/services/document_og_image_test.rb`, which isolates fontconfig env).
- SVG contains the wordmark "Thinkroom", the tagline lines, and the byline;
  no unexpanded interpolation.
- `cache_key` embeds `VERSION`.

### U2. Route, controller, and root metadata

**Goal:** Serve the image and emit root OG tags.
**Files:** `config/routes.rb`, `app/controllers/site_og_images_controller.rb`,
`app/controllers/documents_controller.rb`,
`app/views/layouts/application.html.erb`
**Dependencies:** U1
**Approach:** Route `get "og.png" => "site_og_images#show", as: :site_og_image`
next to the document OG route. Controller mirrors
`DocumentOgImagesController` minus the document lookup / `last_modified`.
`DocumentsController#index` sets `@open_graph` (title "Thinkroom",
page_title "Thinkroom", description "Where deeper thinking compounds.",
url `root_url`, image `site_og_image_url(v: SiteOgImage::VERSION)`, alt text,
`type: "website"`). Layout renders `@open_graph[:type] || "article"`.
**Test scenarios:** covered by U3.

### U3. Integration tests

**Goal:** Lock in endpoint semantics and root metadata.
**Files:** `test/integration/site_og_image_test.rb`,
`test/integration/site_open_graph_test.rb`
**Dependencies:** U1, U2
**Test scenarios:**
- `/og.png` responds 200 `image/png`, PNG magic bytes, `inline` disposition,
  `public` cache-control, ETag present, no `Set-Cookie` (stubbed renderer,
  mirroring `test/integration/document_og_image_test.rb`).
- Second request with `If-None-Match` → 304 with empty body.
- Root page (browser UA): `og:type` is `website`, `og:title` "Thinkroom",
  `og:description`/meta description are the tagline, `og:image` path is
  `/og.png` with a `v=` query, twitter card tags present, canonical link is
  the root URL, `<title>` still exactly "Thinkroom".
- A document page still emits `og:type=article` (regression guard for the
  layout change; may live in `test/integration/document_open_graph_test.rb`).

## Verification

- New service + integration tests pass; full `bin/rails test` stays green
  (including `branding_test.rb` and `document_open_graph_test.rb`).
- `bin/rubocop` clean; `npm run check` clean (no TS changes expected).
- Visual inspection of the generated `/og.png` in a browser via `bin/dev`.
