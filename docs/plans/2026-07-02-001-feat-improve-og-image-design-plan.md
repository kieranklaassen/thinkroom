---
title: "feat: Improve document OG image design"
type: feat
date: 2026-07-02
---

# feat: Improve document OG image design

## Outcome

Replace the purple-gradient card OG image with the warm, editorial "shared
document" design supplied as a Figma mockup: a full-bleed cream page, a serif
(`Newsreader`) document title, a sans (`Instrument Sans`) excerpt, a small
`T. Thinkroom` wordmark with a `SHARED DOCUMENT` eyebrow, a left margin rule,
and a hairline footer carrying the document author (avatar + name) and up to
three label pills. A curated per-document accent color ties it together.

## Problem frame

The current 1200×630 preview (`DocumentOgImage`) is a violet gradient card with
an "Open document →" button. The new mockup reads like a document cover rather
than an ad, and matches Thinkroom's editorial voice. The image is rendered
server-side by rasterizing an SVG through `ruby-vips`/librsvg, so the redesign
must be expressed as a hand-positioned SVG (librsvg renders SVG, not the
HTML/flexbox mockup) and must ship the two custom fonts the design depends on —
neither `Newsreader` nor `Instrument Sans` exists in the production image today.

## Key decisions

- **KTD1 — Vendor the fonts and register them via fontconfig at boot.** Store
  the OFL `Newsreader` and `Instrument Sans` variable TTFs under `vendor/fonts/`
  and add a `config/initializers/og_image_fonts.rb` that writes a fontconfig
  file (including the system config plus our font dir) and points
  `FONTCONFIG_FILE` at it. This makes librsvg resolve the families in every
  environment (dev, CI, test, production Docker) with no Dockerfile or base-image
  change. Verified: with the config, librsvg renders the correct families and
  honors per-weight selection from the variable fonts; without it they fall back
  to Noto.
- **KTD2 — Translate the flex mockup into deterministic absolute SVG.** Keep the
  existing deterministic word/grapheme wrapping and truncation helpers (`wrap`,
  `visual_width`, `ellipsize`) and compute line positions/pill layout by hand,
  since SVG has no `line-clamp`, `text-wrap`, or flexbox.
- **KTD3 — Derive author, labels, and accent from the document.** Author =
  `owner_name` (else `seed_author_name`); labels = `document.tags` (first 3);
  accent chosen deterministically per `slug` from a curated 4-color palette
  (maroon default). When no author exists, the footer-left shows the product
  tagline instead of a fabricated name; when no tags exist, the pills are
  omitted. This intentionally reverses the earlier "no author/tags" rule because
  the new mockup calls for them.
- **KTD4 — Bump the renderer version** (`VERSION`) so already-cached previews and
  versioned `og:image` URLs invalidate after the redesign.

## Requirements

1. The 1200×630 PNG renders the new editorial design: cream field, left margin
   rule, `T. Thinkroom` + `SHARED DOCUMENT` header, serif title (≤3 lines), sans
   excerpt (≤2 lines), hairline footer with author/tagline and optional pills.
2. Long, blank, Unicode, Markdown, and HTML content stays bounded with no
   overflow, raw markup, or render errors.
3. `Newsreader`/`Instrument Sans` resolve during rasterization in dev, test, and
   production; a generic serif/sans fallback degrades gracefully if absent.
4. Author, labels, and accent derive from the document; absent author/tags
   degrade cleanly.
5. Image responses stay publicly cacheable and versioned; the renderer version
   changes so old previews invalidate.
6. Metadata alt text describes the new design (no "Open document button").
7. Endpoint semantics (public inline PNG, ETag/304, 404, no ownership cookie)
   and agent/JSON/text responses are unchanged.

## Implementation units

- **U1. Fonts + fontconfig initializer** — `vendor/fonts/*.ttf`,
  `config/initializers/og_image_fonts.rb`.
- **U2. Renderer redesign** — rewrite `DocumentOgImage#svg` and helpers; bump
  `VERSION`.
- **U3. Data projection** — add `author`/`labels`/`accent` to
  `DocumentSocialPreview` (or compute in the renderer from the document); update
  `DocumentsController#document_open_graph` alt text.
- **U4. Tests** — update `test/services/document_og_image_test.rb` (copy +
  gutter background color), `test/integration/document_open_graph_test.rb`
  (alt text), keep dimension/cache/wrap coverage.

## Verification

- Service + integration tests, `bin/rubocop`, `npm run check`, full `bin/rails
  test`.
- Visual inspection of representative PNGs (demo, long title, Unicode, with
  author, with labels).
- Manual browser check of `/d/:slug/og.png` and document-page metadata.
