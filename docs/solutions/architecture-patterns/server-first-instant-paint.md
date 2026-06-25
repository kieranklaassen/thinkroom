---
title: "Server-first instant paint: lean into Inertia, render on the server, hydrate optimistically"
module: documents/show editor
date: 2026-06-24
problem_type: architecture_pattern
component: rails_view
severity: medium
related_components:
  - service_object
  - rails_controller
tags:
  - instant-paint
  - inertia
  - ssr
  - optimistic-ui
  - layout-shift
  - prosemirror
  - yjs
applies_when:
  - "An async client editor (ProseMirror/Milkdown, CodeMirror, etc.) hydrates content that is already known on the server"
  - "Eliminating first-paint flicker, blank frames, or layout shift on load"
  - "Deciding what to render on the server vs the client in an Inertia app"
---

# Server-first instant paint

## Context

The document editor flickered on load: the content area sat blank in its reserved frame, then popped in once Milkdown finished its async boot, while the header title and connection dot changed a beat later. The instinct was "the websocket is redrawing everything." It wasn't — the whole document already ships in the first HTTP response as an Inertia prop (`yjs_state_b64`, the Yjs/CRDT binary) and hydrates the editor *before* the websocket connects. The blank frame was purely the **async editor boot**: the client editor mounts asynchronously, so there is always a window where React has rendered the page but the editor has not yet painted.

Principle the team settled on: **server is king — make first paint as fast and optimistic as possible, and lean into Inertia to ship rendered content, not just data.**

## Guidance

**1. Render the content on the server for instant paint — don't wait on the client editor.**
The CRDT binary (`yjs_state_b64`) is authoritative but invisible until JS boots and the editor binds it. Ship a *second, human-renderable projection* alongside it: a `content_html` prop (server-rendered, sanitized HTML of the current content) painted straight into the reserved editor frame at mount, plus a server-derived `display_title` (first H1) so the header is correct on first paint. The editor then overlays and replaces this preview once it has painted the same content.

**2. Initialize state optimistically.**
A hydrated doc is functionally live the moment it paints — the websocket only confirms it. Initialize the connection status to `live` when the doc has state, instead of `connecting → live`, to kill the status flash.

**3. When you keep two renderers, normalize the server HTML to match the client DOM *exactly*.**
The server (Commonmarker) and the client (ProseMirror) will never be byte-identical, and any difference becomes a layout shift on swap. The subtle one that bit us: ProseMirror's editable content uses `white-space: break-spaces`, and Commonmarker pretty-prints a literal `\n` text node between block elements. ProseMirror's DOM has no such whitespace, so the `\n` rendered as a **phantom blank line** and pushed the first paragraph ~30px down — only until the editor swapped in. Fix: strip inter-block whitespace from the server HTML (preserving `pre`/`code` contents) so its box model matches the editor's.

**4. Swap by replace, never by blank.**
Keep the static preview behind the live editor (transparent overlay) until the editor has actually painted, then drop the preview a couple of animation frames *after* `onReady`. Removing it the instant the handle arrives reintroduces a one-frame blank ("deletes instead of replaces").

**5. The end-state is SSR.**
A React-rendered preview only covers the gap *after* React mounts. Measured on a warm load: React mounts ~220ms after navigation (JS download/parse/execute), and ProseMirror paints only ~14ms (one frame) after that. So the real "nothing on screen" window is the ~220ms before React mounts — which a React-rendered preview cannot fill. Truly "loaded in one go" requires **Inertia SSR**, which renders the shell + header + preview into the initial HTML response, with the browser-only editor hydrating client-side.

## Why This Matters

Perceived performance is dominated by first paint, not by when the editor becomes interactive. Shipping the rendered content as a prop turns a blank-then-fill flicker into content that is simply there. Two-renderer parity is the trap: it looks done but drifts in subtle, measurable ways (a stray anchor, a `\n`, a trailing break) that read as jank. Measure it — per-frame element positions and CLS — rather than eyeballing a sub-300ms transition. And remember that the dominant blank window is pre-React; only SSR closes it.

This also keeps the app **agent-native**: the same `content_html`/`plain_text` projection that paints instantly is what agents read over the HTTP API, since they have no CRDT runtime.

## When to Apply

Any time an async client component hydrates content the server already knows — rich-text editors, canvases, charts. Especially in Inertia apps, where the natural move is to ship *rendered* HTML as a prop rather than making the client render from raw data. Reach for SSR when the pre-mount blank window (not the editor boot) is the remaining flicker.

## Examples

Strip inter-block whitespace so the server preview matches ProseMirror's DOM (`app/services/document_preview_html.rb`):

```ruby
# ProseMirror emits no whitespace text nodes between block elements, but
# Commonmarker pretty-prints "\n" between them. Under white-space: break-spaces
# those render as phantom blank lines and shift the first paragraph on swap.
def collapse_block_whitespace(fragment)
  fragment.xpath(".//text()").each do |node|
    next unless node.content.match?(/\A\s*\z/)
    parent = node.parent
    next if parent.nil? || parent.name == "pre" || parent.name == "code"
    node.remove if parent.name == "#document-fragment" ||
      WHITESPACE_BLOCK_PARENTS.include?(parent.name)
  end
end
```

Optimistic status + server-derived title on first paint (`app/frontend/pages/documents/show.tsx`):

```tsx
const [status] = useState(doc.has_state || doc.seed_granted ? 'live' : 'connecting')
const [documentTitle] = useState(doc.display_title || doc.title)
```

Verification that the swap is genuinely zero-shift: a CPU-throttled Playwright run sampling each element's `getBoundingClientRect().top` per frame plus a `layout-shift` PerformanceObserver — assert **0 blank frames** and **CLS 0.0000** with every element stable from the first painted frame.
