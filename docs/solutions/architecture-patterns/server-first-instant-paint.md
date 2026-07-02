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

## Round two (2026-07-02): rich-block parity

Re-measuring with a torture document (image, two Mermaid diagrams, two sketches, wide table, highlighted code) found the preview drifting from the editor by **up to 512px of cumulative block height** — every drift is a jump at the swap. The catalog of two-renderer traps, beyond the original `\n`-between-blocks one:

- **`<br>\n`**: Commonmarker emits a newline after every `<br>`; under `white-space: break-spaces` that newline is a *second* forced break, so each soft line break made the preview one line taller. Strip the newline after each `<br>`.
- **ProseMirror trailing breaks**: a textblock ending in a non-text inline (block image) or a hard break gets a separator + `ProseMirror-trailingBreak` — one extra line box the plain HTML doesn't have. Replicate the exact DOM.
- **Chrome-wrapped blocks**: the editor renders tables inside `.milkdown-table-block` (UI font at 0.875em, own padding — +93px vs a bare prose table) and sketches inside a bordered figure with a caption bar (+53px vs a bare height box). The preview must emit the editor's own markup/classes, not simplified stand-ins. Any chrome CSS that ships in the code-split editor chunk needs a render-blocking replica for the preview (see `app/assets/stylesheets/application.css`).
- **Content-dependent async heights** (Mermaid): nothing server-side can predict the rendered SVG height, so persist it — editor snapshots now carry measured figure heights keyed by an FNV hash of the diagram source (`documents.render_hints`), and both the preview skeleton and the next editor mount pre-size from the same hints. First-ever render still grows once; every load after is zero-shift.
- **Marks vs attributes**: editor tints ride mark-derived classes (`.prov--ai`, `.sug-ins`); the preview only has sanitized data attributes. Style the attributes identically (including read-mode overrides) or the tint pops in at swap.
- **Renderer scratch DOM**: `mermaid.render()` measures in a div appended to `<body>`, transiently extending the page by the diagram height (~100ms scrollbar jump). Render into a hidden `position:fixed` host.
- **Raw HTML in markdown**: `Commonmarker` drops raw HTML by default (`unsafe: false`), silently deleting provenance spans from seed-only previews. Render unsafe and let `HtmlDocumentSanitizer` stay the security boundary — the editor shows dropped-tag content as literal text anyway.

The block-by-block parity harness (materialize `content_html` inside the live `.doc-editor-stack`, diff every top-level block's outer height against the editor's) is the fastest way to find the next drift: it reports per-block deltas instead of a single CLS number.

## Round three (2026-07-02): the idle redraw loop

Chasing "still flickering" past pixel parity found a 60fps feedback loop, not a paint bug: **any foreign chrome appended inside a ProseMirror-rendered node makes PM's DOMObserver re-render that node** (deleting the chrome), and if the chrome's owner rebuilds on mutation, the two fight forever. The rich-block width handle inside plain `<pre>` blocks burned a full core at idle (900 DOM mutations/s) on every document with a code block, and each per-frame `updateState` re-imposed the state selection over in-flight native drags — the real cause of the "comment-mode selection stomping" escalation and of caret clicks (review popover) getting eaten.

Rules of thumb:
- Chrome living inside a PM-rendered node requires a **node view** whose `ignoreMutation` scopes PM's attention to the editable `contentDOM` (see `app/frontend/editor/code_block_view.ts`; sketches and tables were already node views, which is why only code blocks looped).
- Measure idle: a healthy document page has **zero** editor mutations and zero `updateState` calls per second at rest. A MutationObserver over the editor subtree is a two-minute check and catches this whole bug class.
- Anything that dispatches per awareness tick (y-prosemirror's cursor plugin) belongs behind a slice-snapshot + rAF gate (`cursor_awareness.ts`, mirroring `read_pointers.ts`).
- Clamp/measure passes scheduled during a viewport resize read mid-reflow geometry (`window.innerWidth` lags); verify on the next frame (`agent_cursors.ts`).
