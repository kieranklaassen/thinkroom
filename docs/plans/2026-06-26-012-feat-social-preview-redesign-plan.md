---
title: "feat: Redesign document social previews"
type: feat
date: 2026-06-26
issue: 79
---

# Redesign document social previews

## Outcome

Make a shared Thinkroom document recognizable and inviting in link previews without turning the card into an advertisement. The preview should feel like an editorial document cover, explain where the link goes, and pass the metadata checks reported in issue #79.

## Design direction

- Keep the document title as the dominant element.
- Replace the empty ruled page with a warm paper card, violet edge/accent field, and restrained collaboration marks.
- Add a small `THINKROOM · SHARED DOCUMENT` label for source context.
- Add one honest conversion action: `Open document →`.
- Preserve generous whitespace and avoid owner names, tags, permissions, or application chrome.

## Requirements

1. The first server-rendered `<title>` is a bounded, descriptive document title with Thinkroom context.
2. Document pages include an explicit meta description, `og:site_name`, and concise matching Open Graph/X descriptions of at most 125 graphemes.
3. The 1200×630 PNG includes the document title, bounded excerpt, source label, and CTA with no overflow for long or Unicode content.
4. The image alt text describes both the document preview and the invitation to open it.
5. The image renderer version changes so already-cached previews are invalidated.
6. Existing canonical URLs, crawler behavior, image caching, and agent/plain-text responses remain unchanged.

## Implementation

- Extend `DocumentSocialPreview` with a bounded SEO page title and reduce the social description budget.
- Emit the page title and missing metadata from the Rails layout before Inertia's SSR head.
- Redesign `DocumentOgImage` as a deterministic SVG-to-PNG editorial card and adjust excerpt lines based on title height.
- Expand service/integration tests for metadata completeness, length limits, cache versioning, escaping, dimensions, and long-title layout.

## Verification

- Service and integration tests.
- TypeScript/Ruby lint and full Rails suite.
- Production Vite build.
- Visual inspection of representative short-, long-, and Unicode-title PNGs.
- Raw HTML inspection with browser and social-crawler user agents.
- Production image and metadata smoke test after deploy.
