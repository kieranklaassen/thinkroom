# One URL, two audiences: a browser opening a share link gets the editor; an
# agent fetching the same URL programmatically gets this guide — everything it
# needs to participate, with no special knowledge beyond the link itself.
class AgentGuide
  class << self
    # The full machine-readable state payload (shared by the API and the
    # share URL's JSON representation — same document, same truth).
    def state(document, base_url)
      content = document.current_content
      open_comments = document.comments.open.order(:created_at).map(&:as_props)
      revision_workflow = revision_workflow(document, base_url) if open_comments.any?
      payload = {
        slug: document.slug,
        title: document.title,
        share_url: "#{base_url}/d/#{document.slug}",
        content_format: document.content_format,
        content: content,
        plain_text: document.plain_text,
        # Same shape the browser sees minus the viewer-specific `yours` —
        # `claimable: false` lets agents describe permanently-unclaimable
        # docs (the demo) accurately.
        ownership: document.ownership_props(nil).except(:yours),
        provenance: {
          # Who authored the seed source (nil for docs without recorded
          # authorship) — the same attribution the editor uses to mark
          # seeded text, exposed so agents see what humans see in the chip.
          seed_author_kind: document.seed_author_kind,
          seed_author_name: document.seed_author_name,
          spans: document.provenance_spans,
          summary: document.provenance_summary
        },
        pending_suggestions: document.suggestions.pending.order(:created_at).map(&:as_props),
        open_comments:,
        agents_present: document.agent_presences.active.map(&:as_props),
        recent_activity: document.activities.recent.map(&:as_props),
        content_contract: content_contract(document.content_format, base_url),
        api: endpoints(document, base_url),
        notes: notes(document, revision_workflow:)
      }
      payload[:revision_workflow] = revision_workflow if revision_workflow
      if document.content_format == "markdown"
        payload[:markdown] = content
        payload[:plain_markdown] = document.plain_markdown.presence || document.seed_markdown
      end
      payload
    end

    def revision_workflow(document, base_url)
      api_base = "#{base_url}/api/docs/#{document.slug}"
      source_name = document.html? ? "HTML" : "Markdown"
      {
        kind: "claimed_document_comments",
        guidance: "Read open_comments, then for each comment you can address, propose one " \
                  "targeted suggestion using its anchor_text as replaces and the replacement " \
                  "source fragment as body. Resolve that comment only after the suggestion " \
                  "is successfully created. Leave comments open when targeting or suggestion " \
                  "creation fails.",
        when_no_open_comments: "If open_comments is empty, propose the change as a normal " \
                               "suggestion; no comment resolution is required.",
        steps: [
          {
            step: 1,
            action: "read_open_comments",
            method: "GET",
            url: api_base,
            reads: "open_comments (id, body, anchor_text)",
            guidance: "Use each comment's body as the requested change and anchor_text as its target."
          },
          {
            step: 2,
            action: "propose_targeted_suggestion",
            method: "POST",
            url: "#{api_base}/suggestions",
            body: {
              replaces: "comment.anchor_text",
              body: "replacement #{source_name} source fragment",
              intent: "one-line summary of how the revision addresses the comment"
            },
            guidance: "Create one suggestion per comment you address; do not create a replacement document."
          },
          {
            step: 3,
            action: "resolve_addressed_comment",
            method: "POST",
            url: "#{api_base}/comments/:id/resolve",
            guidance: "Resolve the matching comment only after its suggestion is successfully created."
          }
        ]
      }
    end

    def endpoints(document, base_url)
      api_base = "#{base_url}/api/docs/#{document.slug}"
      source_name = document.html? ? "HTML" : "Markdown"
      {
        upload_image: ImageUploadPolicy.contract(base_url).merge(
          returns: {
            src: "Canonical same-origin image path to embed in document source",
            html: "Ready-to-embed <img> element",
            filename: "Stored filename",
            content_type: "Detected image MIME type",
            byte_size: "Stored byte size after safe re-encoding",
            width: "Decoded width in pixels",
            height: "Decoded height in pixels",
            expires_at: "Deadline to save HTML that references src"
          },
          purpose: "Upload an app-hosted image before referencing it in HTML. Requires X-Agent-Name. Use the returned src exactly; remote and data: image URLs are removed."
        ),
        state: { method: "GET", url: api_base, headers: { "X-Agent-Name": "recommended" },
                 success_status: 200,
                 purpose: "Full live document state: immutable content format, canonical source, rendered plain text, provenance spans, pending suggestions, open comments, presence, activity." },
        propose_suggestion: { method: "POST", url: "#{api_base}/suggestions",
                              headers: { "X-Agent-Name": "required", "Content-Type": "application/json" },
                              success_status: 201,
                              rate_limits: contribution_rate_limits,
                              body: { body: "(required) #{source_name} you propose", intent: "(optional) one-line summary",
                                      anchor_text: "(optional) unique rendered text to insert after; missing anchors append on acceptance",
                                      replaces: "(optional) unique rendered text your proposal replaces; missing or ambiguous targets cannot apply" },
                              purpose: "Propose an edit in the document's content_format. It appears live in every open editor as a pending suggestion attributed to you. A human accepts or rejects it; accepted text keeps your provenance." },
        comment: { method: "POST", url: "#{api_base}/comments",
                   headers: { "X-Agent-Name": "required", "Content-Type": "application/json" },
                   success_status: 201,
                   rate_limits: contribution_rate_limits,
                   body: { body: "(required) what you want to say", anchor_text: "(optional) the doc text you're commenting on" },
                   purpose: "Leave a comment anchored to a text selection." },
        resolve_comment: { method: "POST", url: "#{api_base}/comments/:id/resolve",
                           headers: { "X-Agent-Name": "required" },
                           success_status: 200,
                           rate_limits: contribution_rate_limits,
                           purpose: "Close a comment thread (the id comes from open_comments). Attributed to you in the activity feed." },
        announce_presence: { method: "POST", url: "#{api_base}/presence",
                             headers: { "X-Agent-Name": "required", "Content-Type": "application/json" },
                             success_status: 200,
                             body: { status: "active | done", location: "(optional) doc text you're working near" },
                             purpose: "Show up in the document's presence area with a labeled cursor while you work. Send status: done when finished." },
        poll_events: { method: "GET", url: "#{api_base}/events/pending", headers: { "X-Agent-Name": "required" },
                       success_status: 200,
                       purpose: "Activity since your last ack (humans accepting your suggestions, comments, etc.)." },
        ack_events: { method: "POST", url: "#{api_base}/events/ack",
                      headers: { "X-Agent-Name": "required", "Content-Type": "application/json" },
                      success_status: 204,
                      body: { last_event_id: "(required) the ack_with value from poll_events" },
                      purpose: "Advance your event cursor." },
        create_document: { method: "POST", url: "#{base_url}/api/docs",
                           headers: { "X-Agent-Name": "recommended", "Content-Type": "application/json" },
                           success_status: 201,
                           rate_limits: document_creation_rate_limits,
                           body: { title: "(optional)", format: "markdown | html", content: "(required with explicit format; canonical source)" },
                           limits: { content_max_bytes: Document::MAX_CONTENT_BYTES },
                           content_contracts: {
                             markdown: content_contract("markdown", base_url),
                             html: content_contract("html", base_url)
                           },
                           returns: { slug: "Document identifier", share_url: "Browser/editor URL",
                                      content_format: "Immutable markdown or html", content: "Canonical source",
                                      plain_text: "Rendered text", normalized: "Whether source changed during normalization",
                                      content_contract: "Machine-readable source, HTML, CSS, and image rules" },
                           purpose: "Create a new shared document. X-Agent-Name is recommended for seed attribution but creation also permits an unattributed request." },
        update_document: { method: "PATCH", url: api_base,
                           headers: { "X-Agent-Name": "recommended", "Content-Type": "application/json" },
                           success_status: 200,
                           conflict_status: 409,
                           rate_limits: contribution_rate_limits,
                           body: { title: "(optional) replacement title",
                                   format: "(optional) must equal this document's immutable content_format",
                                   content: "(optional) replacement canonical #{source_name} source; send title and/or content" },
                           limits: { content_max_bytes: Document::MAX_CONTENT_BYTES },
                           returns: { slug: "Unchanged identifier", share_url: "Unchanged share URL",
                                      content: "Updated canonical source", plain_text: "Updated rendered text",
                                      normalized: "Whether source changed during normalization", warning: "Normalization detail" },
                           purpose: "Revise the document you created in place — same slug, same share URL — while it is still seed-stage (no human has opened it to edit). Once a human starts editing, the live collaborative document is authoritative: this returns 409, and you propose a suggestion instead." }
      }
    end

    def content_contract(format, base_url)
      contract = {
        # v2: sketches.markdown_source became a structured schema object (was a
        # one-line string in v1). Consumers can branch on this to detect the shape.
        version: 2,
        content_format: format,
        immutable: true,
        canonical_source_field: "content",
        rendered_text_field: "plain_text",
        suggestion_body_format: format,
        editor_model: "Humans edit a rendered document. ProseMirror JSON and Yjs updates are internal and are not accepted by the HTTP API.",
        normalization: {
          response_field: "normalized",
          warning_field: "warning",
          meaning: "When normalized is true, unsupported or unsafe source was removed or rewritten, or an excalidraw block was not recognized as a valid sketch and was kept as a code block. The warning field explains what happened."
        },
        sketches: {
          purpose: "Inline Excalidraw sketches remain editable in the human UI and expose text semantics to agents.",
          markdown_source: {
            format: %(A fenced "excalidraw" code block whose body is a single JSON object (the SketchData wrapper). The fence language must be exactly "excalidraw".),
            schema: {
              formatVersion: "(required) integer, must equal #{ThinkroomSketch::FORMAT_VERSION}.",
              id: %[(required) string matching /^[a-zA-Z0-9_-]{1,100}$/. Enforced by the editor — include it even though the create-time signal does not check it (see enforcement).],
              description: "(optional) human summary up to #{ThinkroomSketch::MAX_DESCRIPTION_LENGTH} characters; surfaced in plain_text.",
              height: "(optional) integer reserved render height in pixels, default #{ThinkroomSketch::DEFAULT_HEIGHT}; a finite value outside #{ThinkroomSketch::MIN_HEIGHT}-#{ThinkroomSketch::MAX_HEIGHT} is clamped into that range by the editor and the server preview, so an out-of-range height still renders (clamped) rather than breaking (see enforcement).",
              scene: {
                type: %((required) must equal "excalidraw".),
                version: "(required) integer greater than 0 (the Excalidraw scene version, e.g. 2).",
                elements: %[(required) array of Excalidraw elements. Each element type must be one of #{ThinkroomSketch::ELEMENT_TYPES.join(", ")}; any strokeColor/backgroundColor must match /^(?:transparent|#[0-9a-f]{3,8})$/i; fileId and link are not allowed.],
                appState: %[(optional) object; viewBackgroundColor must match the safe-color pattern. Only an allowlist of keys (theme, grid/zoom/scroll settings, viewBackgroundColor) is retained.],
                files: "(required) must be exactly {} - embedded bitmap files are not supported."
              }
            },
            example: markdown_sketch_example,
            recognition: %(A recognized sketch renders in plain_text as "Sketch: <description> — <labels>". If plain_text instead echoes the raw scene JSON, the fence was not recognized; the create response then reports normalized: true with a warning.),
            enforcement: %(The create-time signal (normalized/warning) validates the scene shape only. id is enforced when the editor opens the document, not at create — a scene with a missing/invalid id returns normalized: false here yet still renders as "Invalid sketch" to humans, so always include a valid id. Height is different: it is not a recognition criterion, and an out-of-range or non-positive height is clamped into #{ThinkroomSketch::MIN_HEIGHT}-#{ThinkroomSketch::MAX_HEIGHT} (matching the server preview) so the sketch renders rather than breaking. The stored content keeps the height you submitted; the editor and preview render the clamped value.),
            reference: "Excalidraw scene/element format and drawing semantics: https://docs.excalidraw.com/docs/codebase/json-schema"
          },
          html_source: "A trusted figure[data-thinkroom-sketch] snapshot; external HTML cannot set reserved sketch attributes.",
          rendered_context: "plain_text emits the sketch description and text labels instead of raw scene JSON.",
          canonical: "The Excalidraw scene is canonical; SVG is generated in the browser for preview, copy, and download.",
          supported_elements: ThinkroomSketch::ELEMENT_TYPES,
          limits: {
            scene_max_bytes: ThinkroomSketch::MAX_SCENE_BYTES,
            description_max_characters: ThinkroomSketch::MAX_DESCRIPTION_LENGTH,
            elements_max: ThinkroomSketch::MAX_ELEMENTS,
            points_max: ThinkroomSketch::MAX_POINTS,
            embedded_images: false
          }
        }
      }
      return contract unless format == "html"

      contract.merge(
        html: {
          scope: "Semantic body HTML, not a lossless full-page HTML/CSS document.",
          allowed_elements: HtmlDocumentSanitizer::TAGS,
          dropped_with_content: HtmlDocumentSanitizer::DROP_WITH_CONTENT,
          attributes: {
            supported: HtmlDocumentSanitizer::EXTERNAL_ATTRIBUTES,
            reserved: "Thinkroom provenance, suggestion, and sketch data attributes may appear in trusted snapshots; external source cannot set them."
          },
          css: {
            supported: "Only text-align: left|center|right on th and td.",
            removed: [ "<style> blocks", "class and id styling hooks", "all other inline style declarations" ],
            guidance: "Use semantic elements and Thinkroom's editor styling. Do not depend on custom colors, spacing, fonts, grids, or page-level layout."
          },
          images: {
            upload: ImageUploadPolicy.contract(base_url),
            embed: %(<img src="RETURNED_SRC" alt="Descriptive text">),
            guidance: "Use the exact src returned by api.upload_image. It expires unless referenced by saved HTML within one hour.",
            accepted_sources: "Validated same-origin Active Storage blob, representation, or disk paths. Agents should only generate the blob src returned by the upload endpoint.",
            removed_sources: [ "https:// remote images", "protocol-relative URLs", "data: URLs",
                               "arbitrary same-origin paths", "URLs with query strings or fragments" ]
          }
        }
      )
    end

    def notes(document, revision_workflow: nil)
      source_name = document.html? ? "HTML" : "Markdown"
      notes = [
        "Identity: send an X-Agent-Name header on every request. Suggestions, comments, presence, and event writes require it; document creation permits no header but then records no agent seed attribution. The name flows through suggestion attribution, provenance, presence, and activity.",
        "Source contract: content_format is immutable. content is canonical #{source_name} source; plain_text is the rendered text for context and matching. Humans edit a rendered document in the browser — never send ProseMirror JSON or Yjs data through the HTTP API.",
        "All your writes go through the same provenance/suggestion machinery as the human UI. There is no side channel: you propose, humans review.",
        "Text you contribute is marked kind=ai provenance (with your agent name as author) and tinted in the editor until a human advances its review state (pending -> reviewed -> endorsed).",
        "Documents you create with source content are pre-attributed as 100% unreviewed AI prose. Before any editor session opens the doc, the provenance summary is derived from the seed source and replaced by the first editor snapshot.",
        "Updating: PATCH /api/docs/:slug rewrites your document's seed in place — same slug, same share URL — so revisions stay at the link you already shared, as long as no human has started editing. Once an editor takes over you get a 409: from then on, propose suggestions, which is how every edit to a live document works.",
        "Connected editors see your suggestions, comments, and presence live over WebSocket — no refresh needed on their side.",
        "Reading state: use plain_text as working context and content when source fidelity matters. This document expects #{source_name} suggestion bodies. State may lag if no human has the document open — the Yjs CRDT state is always authoritative.",
        "Sketches: inline Excalidraw scenes appear in content and are summarized in plain_text from their human description and text labels. Treat the scene as editable source and SVG as a derived browser export; embedded bitmap files are not supported. To author one in Markdown, embed a fenced excalidraw block following content_contract.sketches.markdown_source (formatVersion, id, description, height, and a full excalidraw scene with type/version/appState/files) — copy its example to start. A recognized sketch shows in plain_text as \"Sketch: <description> — <labels>\"; raw scene JSON in plain_text means the block was not recognized, and the create response then returns normalized: true with a warning.",
        "Suggestion targeting: use a unique quote from plain_text for replaces or anchor_text; source-formatted quotes are parsed too. A missing or ambiguous replaces target stays pending and changes nothing. A missing anchor_text falls back to appending if a human accepts it.",
        "Tracked changes use <ins data-suggestion-id> / <del data-suggestion-id> in the source snapshot. They are human-typed suggestions pending review, not your proposals, and are not resolvable through this API.",
        "Review is human-gated by design: accepting/rejecting suggestions and advancing review states happen in the editor, by humans. Your job is to propose well.",
        "Ownership: a human can claim a document in the browser; claimed docs show an owner in this payload (claimable: false means nobody can ever claim it, e.g. the demo). Claiming is browser-only (cookie-based) — agents cannot claim, so don't POST to any claim path. When a human claims, a claimed_document activity appears in the event feed with their name.",
        "A claimed document can be deleted by its owner, after which every endpoint here returns 404. Treat a 404 on a previously-working slug as deletion, not an outage to retry.",
        "Document creation, suggestion, and comment writes are rate-limited per source IP. A 429 response means retry later; inspect each endpoint's rate_limits field for the current windows."
      ]
      if revision_workflow
        notes.insert(
          6,
          "Revising a claimed document: #{revision_workflow[:guidance]} " \
          "#{revision_workflow[:when_no_open_comments]}"
        )
      end
      if document.html?
        notes.insert(
          9,
          "HTML normalization: semantic body HTML is supported, not arbitrary page HTML/CSS. Scripts, embedded content, full-page metadata, <style> blocks, classes, remote images, and inline styles other than table-cell text alignment are removed. Upload images through api.upload_image and use the returned src exactly."
        )
      end
      notes
    end

    # The plain-text variant, embedded invisibly in the editor HTML and served
    # directly to non-browser fetchers of the share URL.
    def text(document, base_url)
      api_base = "#{base_url}/api/docs/#{document.slug}"
      source_name = document.html? ? "HTML" : "Markdown"
      example_body = document.html? ? "<p>Your proposed HTML.</p>" : "Your proposed markdown."
      suggestion_example = JSON.generate(
        body: example_body,
        intent: "Tighten the intro",
        anchor_text: "existing text to insert after"
      )
      <<~GUIDE
        # #{document.title} — agent guide

        You are an agent reading a Thinkroom share link. Humans see a live
        collaborative editor at this URL; you participate over plain HTTP.
        Everything you do appears live in their editors, attributed to you.

        Document creation, suggestion, and comment writes are rate-limited per
        source IP. A 429 response means retry later; the JSON guide exposes the
        current windows in each write endpoint's rate_limits field.

        ## Identity
        Send your display name in an X-Agent-Name header on every request.
        It is required for suggestions, comments, presence, and event writes,
        and becomes your identity in provenance and the activity feed. Document
        creation permits no header, but its seed then has no agent attribution.

        ## Source contract
        This document's immutable source format is #{source_name}.
        GET #{api_base} returns:
        - canonical source in "content"
        - rendered text in "plain_text"
        Humans edit the rendered document in the browser; ProseMirror/Yjs is
        internal — do not send editor JSON or CRDT data.

        Inline Excalidraw sketches are versioned source blocks. Their editable
        scene appears in content; plain_text gives you the human description
        and text labels without raw scene JSON. SVG is a derived browser
        preview/export, and embedded bitmap files are not supported. Author one
        with a fenced excalidraw block matching the JSON guide's
        content_contract.sketches.markdown_source (formatVersion, id,
        description, height, and a full excalidraw scene). When recognized,
        plain_text reads "Sketch: <description> — <labels>"; raw scene JSON in
        plain_text means it was not recognized. The Excalidraw scene/element
        format and drawing semantics are documented at
        https://docs.excalidraw.com/docs/codebase/json-schema.

        #{html_contract_text(document, base_url)}
        ## Participate

        1. Announce yourself (a labeled cursor appears in the editor):
           curl -X POST #{api_base}/presence \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"status": "active", "location": "text you are working near"}'

        2. Read the full document state (#{source_name}, plain text, provenance spans, pending
           suggestions, open comments, presence, recent activity):
           curl #{api_base} -H "X-Agent-Name: YOUR_NAME"

        3. Propose an edit (lands as a pending suggestion humans accept/reject;
           accepted text keeps your provenance, tinted until reviewed):
           curl -X POST #{api_base}/suggestions \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '#{suggestion_example}'
           Use a unique quote from plain_text for "anchor_text". Use "replaces"
           instead to replace text; a missing or ambiguous replacement stays
           pending and changes nothing. A missing insertion anchor appends if
           a human accepts it.

        4. Comment on a selection:
           curl -X POST #{api_base}/comments \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"body": "Consider a source here.", "anchor_text": "the text you mean"}'

           Resolve a thread once it's addressed (id comes from open_comments):
           curl -X POST #{api_base}/comments/COMMENT_ID/resolve -H "X-Agent-Name: YOUR_NAME"

        5. React to humans (poll + ack):
           curl #{api_base}/events/pending -H "X-Agent-Name: YOUR_NAME"
           curl -X POST #{api_base}/events/ack \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"last_event_id": 123}'

        6. Sign off when done:
           curl -X POST #{api_base}/presence \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"status": "done"}'

        ## Create your own HTML document
        1. Upload each image:
           curl -X POST #{base_url}/api/uploads \\
             -H "X-Agent-Name: YOUR_NAME" \\
             -F "file=@figure.png"
           The response returns "src" and a ready-to-embed "html" value. Use
           the returned src exactly; do not invent, rewrite, or externalize it.

        2. Create the document with canonical semantic body HTML:
           curl -X POST #{base_url}/api/docs \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"title": "My doc", "format": "html", "content": "<h1>Hello</h1><p><img src=\"RETURNED_SRC\" alt=\"Figure description\"></p>"}'

        3. Read the created document state using the returned slug:
           curl #{base_url}/api/docs/RETURNED_SLUG \\
             -H "X-Agent-Name: YOUR_NAME"

        4. Propose edits and comments through the endpoints in that state
           payload, poll events while waiting for review, then sign off.

        ## Revise a document you created
        While no human has opened the document to edit it, you can rewrite it
        in place — same slug, same share URL, so the link you shared keeps
        working. Send a new title, content, or both:
           curl -X PATCH #{base_url}/api/docs/RETURNED_SLUG \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"title": "Revised", "content": "..."}'
        format is immutable; omit it or send the document's existing format.
        Once a human starts editing, the live collaborative document becomes
        authoritative and PATCH returns 409 — from then on, propose a
        suggestion instead.

        HTML is sanitized and normalized to Thinkroom's editable schema. Create and
        suggestion responses include normalized=true plus a warning when
        unsupported markup was removed or rewritten.
        This is semantic body HTML, not a lossless full-page HTML/CSS editor.
        Use headings, paragraphs, lists, links, code, blockquotes, rules,
        tables, and uploaded images. CSS is removed except text-align
        left/center/right on th and td. <style>, class/id hooks, scripts,
        embeds, SVG, remote images, data: images, and page metadata are removed.
        For Markdown, send Markdown in content (format defaults to "markdown").

        ## Ownership
        A human can claim a document in their browser; the claimed owner shows
        in the state payload. Claiming is browser-only (cookie-based) — agents
        cannot claim. An owner can delete their document, after which every
        endpoint returns 404: treat a 404 on a previously-working slug as
        deletion, not an outage to retry.

        Machine-readable version of this guide: GET #{api_base} (JSON).
      GUIDE
    end

    private

    # A copy-pasteable, validation-passing markdown sketch fence. Agents drop
    # this straight into content; it is recognized by ThinkroomSketch.parse and
    # renders in plain_text as "Sketch: Human and AI agent edit the same Yjs
    # room — Human". Kept on one JSON line so it survives a literal copy.
    def markdown_sketch_example
      <<~MARKDOWN
        ```excalidraw
        {"id":"flow1","formatVersion":1,"description":"Human and AI agent edit the same Yjs room","height":260,"scene":{"type":"excalidraw","version":2,"elements":[{"id":"r1","type":"rectangle","x":100,"y":100,"width":220,"height":90,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#d3f9d8","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"boundElements":null,"updated":1,"link":null,"locked":false},{"id":"t1","type":"text","x":130,"y":132,"width":60,"height":25,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"roundness":null,"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"boundElements":null,"updated":1,"link":null,"locked":false,"text":"Human","fontSize":20,"fontFamily":1,"textAlign":"left","verticalAlign":"top","containerId":null,"originalText":"Human","lineHeight":1.25,"baseline":18}],"appState":{"viewBackgroundColor":"#fffef9"},"files":{}}}
        ```
      MARKDOWN
    end

    def document_creation_rate_limits
      rate_limits(
        burst: WriteRateLimited::DOCUMENT_CREATION_BURST_LIMIT,
        daily: WriteRateLimited::DOCUMENT_CREATION_DAILY_LIMIT
      )
    end

    def contribution_rate_limits
      rate_limits(
        burst: WriteRateLimited::CONTRIBUTION_BURST_LIMIT,
        daily: WriteRateLimited::CONTRIBUTION_DAILY_LIMIT
      )
    end

    def rate_limits(burst:, daily:)
      {
        by: "source_ip",
        response_status: 429,
        burst: { requests: burst, within_seconds: 10.minutes.to_i },
        daily: { requests: daily, within_seconds: 1.day.to_i }
      }
    end

    def html_contract_text(document, base_url)
      return "" unless document.html?

      <<~TEXT
        ## HTML, CSS, and images
        This is semantic body HTML, not a lossless webpage source editor.
        Supported elements: #{HtmlDocumentSanitizer::TAGS.join(", ")}.
        CSS support is intentionally narrow: only text-align left, center, or
        right on th and td survives. <style> blocks, class/id styling hooks,
        and every other inline style are removed.

        Images must be uploaded to Thinkroom first:
          curl -X POST #{base_url}/api/uploads \\
            -H "X-Agent-Name: YOUR_NAME" \\
            -F "file=@figure.png"
        Embed the exact returned src:
          <img src="RETURNED_SRC" alt="Descriptive text">
        PNG, JPEG, and WebP inputs up to #{ImageUploadPolicy::MAX_INPUT_BYTES}
        bytes are decoded and safely re-encoded. The returned src must be used
        in saved HTML within one hour or the temporary upload is purged.
        Remote, protocol-relative, data:, arbitrary same-origin, query-string,
        and fragment image sources are removed.

      TEXT
    end
  end
end
