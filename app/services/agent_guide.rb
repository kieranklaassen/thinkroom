# One URL, two audiences: a browser opening a share link gets the editor; an
# agent fetching the same URL programmatically gets this guide — everything it
# needs to participate, with no special knowledge beyond the link itself.
class AgentGuide
  class << self
    # The full machine-readable state payload (shared by the API and the
    # share URL's JSON representation — same document, same truth).
    def state(document, base_url)
      content = document.current_content
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
        open_comments: document.comments.open.order(:created_at).map(&:as_props),
        agents_present: document.agent_presences.active.map(&:as_props),
        recent_activity: document.activities.recent.map(&:as_props),
        content_contract: content_contract(document.content_format, base_url),
        api: endpoints(document, base_url),
        notes: notes(document)
      }
      if document.content_format == "markdown"
        payload[:markdown] = content
        payload[:plain_markdown] = document.plain_markdown.presence || document.seed_markdown
      end
      payload
    end

    def endpoints(document, base_url)
      api_base = "#{base_url}/api/docs/#{document.slug}"
      source_name = document.html? ? "HTML" : "Markdown"
      {
        upload_image: {
          method: "POST",
          url: "#{base_url}/api/uploads",
          request: {
            content_type: "multipart/form-data",
            field: "file",
            allowed_content_types: Api::UploadsController::CONTENT_TYPES,
            max_bytes: Api::UploadsController::MAX_BYTES
          },
          returns: {
            src: "Canonical same-origin image path to embed in document source",
            html: "Ready-to-embed <img> element",
            filename: "Stored filename",
            content_type: "Detected image MIME type",
            byte_size: "Stored byte size"
          },
          purpose: "Upload an app-hosted image before referencing it in HTML. Requires X-Agent-Name. Use the returned src exactly; remote and data: image URLs are removed."
        },
        state: { method: "GET", url: api_base,
                 purpose: "Full live document state: immutable content format, canonical source, rendered plain text, provenance spans, pending suggestions, open comments, presence, activity." },
        propose_suggestion: { method: "POST", url: "#{api_base}/suggestions",
                              body: { body: "(required) #{source_name} you propose", intent: "(optional) one-line summary",
                                      anchor_text: "(optional) unique rendered text to insert after; missing anchors append on acceptance",
                                      replaces: "(optional) unique rendered text your proposal replaces; missing or ambiguous targets cannot apply" },
                              purpose: "Propose an edit in the document's content_format. It appears live in every open editor as a pending suggestion attributed to you. A human accepts or rejects it; accepted text keeps your provenance." },
        comment: { method: "POST", url: "#{api_base}/comments",
                   body: { body: "(required) what you want to say", anchor_text: "(optional) the doc text you're commenting on" },
                   purpose: "Leave a comment anchored to a text selection." },
        announce_presence: { method: "POST", url: "#{api_base}/presence",
                             body: { status: "active | done", location: "(optional) doc text you're working near" },
                             purpose: "Show up in the document's presence area with a labeled cursor while you work. Send status: done when finished." },
        poll_events: { method: "GET", url: "#{api_base}/events/pending",
                       purpose: "Activity since your last ack (humans accepting your suggestions, comments, etc.)." },
        ack_events: { method: "POST", url: "#{api_base}/events/ack",
                      body: { last_event_id: "(required) the ack_with value from poll_events" },
                      purpose: "Advance your event cursor." },
        create_document: { method: "POST", url: "#{base_url}/api/docs",
                           body: { title: "(optional)", format: "markdown | html", content: "(required with explicit format; canonical source)" },
                           returns: { slug: "Document identifier", share_url: "Browser/editor URL",
                                      content_format: "Immutable markdown or html", content: "Canonical source",
                                      plain_text: "Rendered text", normalized: "Whether source changed during normalization",
                                      content_contract: "Machine-readable source, HTML, CSS, and image rules" },
                           purpose: "Create a new shared document. X-Agent-Name is recommended for seed attribution but creation also permits an unattributed request." }
      }
    end

    def content_contract(format, base_url)
      contract = {
        content_format: format,
        immutable: true,
        canonical_source_field: "content",
        rendered_text_field: "plain_text",
        suggestion_body_format: format,
        editor_model: "Humans edit a rendered document. ProseMirror JSON and Yjs updates are internal and are not accepted by the HTTP API.",
        normalization: {
          response_field: "normalized",
          warning_field: "warning",
          meaning: "When normalized is true, unsupported or unsafe source was removed or rewritten."
        }
      }
      return contract unless format == "html"

      contract.merge(
        html: {
          scope: "Semantic body HTML, not a lossless full-page HTML/CSS document.",
          allowed_elements: HtmlDocumentSanitizer::TAGS,
          dropped_with_content: HtmlDocumentSanitizer::DROP_WITH_CONTENT,
          attributes: {
            supported: %w[href title src alt start colspan rowspan colwidth data-language],
            reserved: "Pruf provenance and suggestion data attributes may appear in trusted snapshots; external source cannot set them."
          },
          css: {
            supported: "Only text-align: left|center|right on th and td.",
            removed: [ "<style> blocks", "class and id styling hooks", "all other inline style declarations" ],
            guidance: "Use semantic elements and Pruf's editor styling. Do not depend on custom colors, spacing, fonts, grids, or page-level layout."
          },
          images: {
            upload: {
              method: "POST",
              url: "#{base_url}/api/uploads",
              request_content_type: "multipart/form-data",
              field: "file",
              identity_header: "X-Agent-Name",
              allowed_content_types: Api::UploadsController::CONTENT_TYPES,
              max_bytes: Api::UploadsController::MAX_BYTES
            },
            embed: %(<img src="RETURNED_SRC" alt="Descriptive text">),
            allowed_sources: "Only exact same-origin Active Storage paths returned by the upload endpoint.",
            removed_sources: [ "https:// remote images", "protocol-relative URLs", "data: URLs",
                               "arbitrary same-origin paths", "URLs with query strings or fragments" ]
          }
        }
      )
    end

    def notes(document)
      source_name = document.html? ? "HTML" : "Markdown"
      notes = [
        "Identity: send an X-Agent-Name header on every request. Suggestions, comments, presence, and event writes require it; document creation permits no header but then records no agent seed attribution. The name flows through suggestion attribution, provenance, presence, and activity.",
        "Source contract: content_format is immutable. content is canonical #{source_name} source; plain_text is the rendered text for context and matching. Humans edit a rendered document in the browser — never send ProseMirror JSON or Yjs data through the HTTP API.",
        "All your writes go through the same provenance/suggestion machinery as the human UI. There is no side channel: you propose, humans review.",
        "Text you contribute is marked kind=ai provenance (with your agent name as author) and tinted in the editor until a human advances its review state (pending -> reviewed -> endorsed).",
        "Documents you create with source content are pre-attributed as 100% unreviewed AI prose. Before any editor session opens the doc, the provenance summary is derived from the seed source and replaced by the first editor snapshot.",
        "Connected editors see your suggestions, comments, and presence live over WebSocket — no refresh needed on their side.",
        "Reading state: use plain_text as working context and content when source fidelity matters. This document expects #{source_name} suggestion bodies. State may lag if no human has the document open — the Yjs CRDT state is always authoritative.",
        "Suggestion targeting: use a unique quote from plain_text for replaces or anchor_text; source-formatted quotes are parsed too. A missing or ambiguous replaces target stays pending and changes nothing. A missing anchor_text falls back to appending if a human accepts it.",
        "Tracked changes use <ins data-suggestion-id> / <del data-suggestion-id> in the source snapshot. They are human-typed suggestions pending review, not your proposals, and are not resolvable through this API.",
        "Review is human-gated by design: accepting/rejecting suggestions and advancing review states happen in the editor, by humans. Your job is to propose well.",
        "Ownership: a human can claim a document in the browser; claimed docs show an owner in this payload (claimable: false means nobody can ever claim it, e.g. the demo). Claiming is browser-only (cookie-based) — agents cannot claim, so don't POST to any claim path. When a human claims, a claimed_document activity appears in the event feed with their name.",
        "A claimed document can be deleted by its owner, after which every endpoint here returns 404. Treat a 404 on a previously-working slug as deletion, not an outage to retry."
      ]
      if document.html?
        notes.insert(
          8,
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

        You are an agent reading a Pruf share link. Humans see a live
        collaborative editor at this URL; you participate over plain HTTP.
        Everything you do appears live in their editors, attributed to you.

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

        HTML is sanitized and normalized to Pruf's editable schema. Create and
        suggestion responses include normalized=true plus a warning when
        unsupported markup was removed or rewritten.
        This is semantic body HTML, not a lossless full-page HTML/CSS editor.
        Use headings, paragraphs, lists, links, code, blockquotes, rules,
        tables, and uploaded images. CSS is removed except text-align
        left/center/right on th and td. <style>, class/id hooks, scripts,
        embeds, SVG, remote images, data: images, and page metadata are removed.
        For Markdown, send format="markdown" and Markdown in content. Legacy
        clients may still send a top-level "markdown" field.

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

    def html_contract_text(document, base_url)
      return "" unless document.html?

      <<~TEXT
        ## HTML, CSS, and images
        This is semantic body HTML, not a lossless webpage source editor.
        Supported elements: #{HtmlDocumentSanitizer::TAGS.join(", ")}.
        CSS support is intentionally narrow: only text-align left, center, or
        right on th and td survives. <style> blocks, class/id styling hooks,
        and every other inline style are removed.

        Images must be uploaded to Pruf first:
          curl -X POST #{base_url}/api/uploads \\
            -H "X-Agent-Name: YOUR_NAME" \\
            -F "file=@figure.png"
        Embed the exact returned src:
          <img src="RETURNED_SRC" alt="Descriptive text">
        Remote, protocol-relative, data:, arbitrary same-origin, query-string,
        and fragment image sources are removed.

      TEXT
    end
  end
end
