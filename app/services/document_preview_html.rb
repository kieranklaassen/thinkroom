# Server-rendered HTML for the document's current content, painted instantly on
# page load so the editor frame shows real text before Milkdown finishes its
# async boot. The live editor (hydrated from yjs_state) swaps in over this once
# it is ready; because both render the same content into the same prose styles,
# the swap is seamless. See app/frontend/pages/documents/show.tsx (doc-editor-stack).
#
# Parity contract: every block this preview emits must occupy exactly the box
# the live editor's DOM will occupy, or the swap reads as a flicker/jump.
# The transforms below exist to close measured mismatches:
#   - Commonmarker's "\n" after <br> renders as a phantom line under
#     white-space: break-spaces (ProseMirror emits no such text node).
#   - ProseMirror appends a separator + trailing break line after a block
#     image / trailing hard break / empty paragraph.
#   - The editor wraps tables in the table-block chrome (own typography).
#   - Mermaid fences render as a loading <figure> BEFORE the source <pre>
#     (hidden when not editable), sized from persisted render hints.
#   - Sketches render as the real sketch figure (border/caption/tape) with a
#     server-drawn SVG of the scene — not a gray placeholder.
class DocumentPreviewHtml
  DEFAULT_SKETCH_HEIGHT = ThinkroomSketch::DEFAULT_HEIGHT
  MIN_SKETCH_HEIGHT = ThinkroomSketch::MIN_HEIGHT
  MAX_SKETCH_HEIGHT = ThinkroomSketch::MAX_HEIGHT

  class << self
    # editable: whether the editor will mount with contenteditable (Edit or
    #   Suggest mode for a writer) — controls Mermaid source visibility.
    # sketch_interactive: whether sketches will be clickable (Edit mode only)
    #   — controls the caption affordance so it doesn't flash at swap.
    # render_hints: Document#render_hints ({"mermaid" => {hash => px}}).
    def call(format:, content:, editable: false, sketch_interactive: false, render_hints: {})
      source = content.to_s
      return "" if source.blank?

      html = if format == "html"
        source
      else
        # header_ids: nil drops Commonmarker's empty heading anchor (<a class=
        # "anchor">). The live Milkdown editor renders a bare <h1>, so without
        # this the preview's heading is structurally taller and the first
        # paragraph jumps ~30px when the editor swaps in.
        #
        # render.unsafe passes raw HTML through to the sanitizer below instead
        # of dropping it. The editor parses inline HTML (provenance spans,
        # suggestion ins/del) into marks, so a preview that drops those tags
        # loses their tint until the swap — a visible color flash.
        # HtmlDocumentSanitizer remains the security boundary either way.
        rendered = Commonmarker.to_html(
          source,
          options: { render: { unsafe: true }, extension: { header_ids: nil } },
          plugins: { table: true, strikethrough: true, tasklist: true }
        )
        mark_mermaid_fences(rendered)
      end

      # Security boundary: document content is authored by humans and agents, so
      # it is sanitized before it can reach dangerouslySetInnerHTML on the client.
      sanitized = HtmlDocumentSanitizer.snapshot(html).content
      fragment = Nokogiri::HTML5.fragment(sanitized)
      collapse_block_whitespace(fragment)
      collapse_break_newlines(fragment)
      add_trailing_breaks(fragment)
      annotate_image_dimensions(fragment)
      wrap_tables(fragment)
      replace_sketches(fragment, format:, interactive: sketch_interactive)
      # Both formats: the editor derives diagram figures from any code block
      # whose language is mermaid, so HTML documents need the placeholder too.
      hints = render_hints.is_a?(Hash) ? render_hints.fetch("mermaid", {}) : {}
      replace_mermaid(fragment, editable:, hints:)
      fragment.to_html
    end

    # FNV-1a over UTF-16 code units, matching sourceHash in
    # app/frontend/editor/mermaid.ts so persisted render hints line up with
    # the hashes the editor computes for its diagram figures.
    def mermaid_source_hash(source)
      hash = 2_166_136_261
      source.encode(Encoding::UTF_16LE).unpack("v*").each do |unit|
        hash = ((hash ^ unit) * 16_777_619) & 0xFFFFFFFF
      end
      hash.to_s(36)
    end

    private

    # Block containers whose children are block elements; the whitespace between
    # those children is the markdown renderer's pretty-printing, never content.
    WHITESPACE_BLOCK_PARENTS = %w[
      ul ol li blockquote table thead tbody tr figure dl
    ].freeze

    # Commonmarker writes the fenced language to a `lang` attribute, which the
    # document sanitizer intentionally drops. Translate only the Mermaid signal
    # to the already-supported data-language attribute before sanitizing so the
    # instant preview can mark diagram blocks without trusting arbitrary HTML.
    def mark_mermaid_fences(html)
      fragment = Nokogiri::HTML5.fragment(html)
      fragment.css("pre[lang]").each do |pre|
        next unless pre["lang"].to_s.casecmp?("mermaid")

        pre["data-language"] = "mermaid"
      end
      fragment.to_html
    end

    # ProseMirror's DOM carries no whitespace text nodes between block elements,
    # but Commonmarker pretty-prints a "\n" between each one. The editor renders
    # with white-space: break-spaces, so in the preview those newlines become
    # phantom blank lines and the first paragraph sits ~30px too low until the
    # live editor swaps in. Drop the inter-block whitespace so the preview's box
    # model matches the editor exactly. Inline whitespace (inside p, headings)
    # and pre/code contents are left untouched.
    def collapse_block_whitespace(fragment)
      fragment.xpath(".//text()").each do |node|
        next unless node.content.match?(/\A\s*\z/)

        parent = node.parent
        next unless parent
        next if parent.name == "pre" || parent.name == "code"

        if parent.name == "#document-fragment" || WHITESPACE_BLOCK_PARENTS.include?(parent.name)
          node.remove
        end
      end
    end

    # Commonmarker renders soft/hard line breaks as "<br>\n" — the literal
    # newline is a second forced break under white-space: break-spaces, so
    # every line break made the preview one full line taller than the editor
    # (which emits a bare <br>). Strip exactly one newline after each <br>.
    def collapse_break_newlines(fragment)
      fragment.css("br").each do |br|
        sibling = br.next_sibling
        next unless sibling&.text?

        trimmed = sibling.content.sub(/\A\n/, "")
        if trimmed.empty?
          sibling.remove
        else
          sibling.content = trimmed
        end
      end
    end

    # ProseMirror renders a separator + trailing break after a textblock that
    # ends in a non-text inline (a block image), after a trailing hard break,
    # and inside empty paragraphs — each adds one line box the plain HTML
    # doesn't have. Replicate the exact DOM so both layers wrap identically.
    def add_trailing_breaks(fragment)
      fragment.css("p").each do |paragraph|
        last = paragraph.children.reject { |node| node.text? && node.content.empty? }.last

        if last.nil?
          paragraph << trailing_break(paragraph.document)
        elsif last.element? && last.name == "img"
          separator = Nokogiri::XML::Node.new("img", paragraph.document)
          separator["class"] = "ProseMirror-separator"
          separator["alt"] = ""
          paragraph << separator
          paragraph << trailing_break(paragraph.document)
        elsif last.element? && last.name == "br"
          paragraph << trailing_break(paragraph.document)
        end
      end
    end

    def trailing_break(document)
      br = Nokogiri::XML::Node.new("br", document)
      br["class"] = "ProseMirror-trailingBreak"
      br
    end

    # Images carry no intrinsic size in markdown, so the preview reflows when
    # each one loads. Uploaded images are Active Storage blobs whose analyzed
    # dimensions we know — emit width/height (with height:auto CSS) so the
    # box is reserved from first paint.
    SIGNED_BLOB_SRC = %r{\A/rails/active_storage/blobs/(?:redirect|proxy)/([^/]+)/}

    def annotate_image_dimensions(fragment)
      fragment.css("img[src]").each do |img|
        next if img["width"].present? || img["class"].to_s.include?("ProseMirror-separator")

        match = SIGNED_BLOB_SRC.match(img["src"].to_s)
        next unless match

        blob = ActiveStorage::Blob.find_signed(match[1])
        width = blob&.metadata&.dig("width")
        height = blob&.metadata&.dig("height")
        next unless width.present? && height.present?

        img["width"] = width.to_s
        img["height"] = height.to_s
      rescue ActiveSupport::MessageVerifier::InvalidSignature, ActiveRecord::RecordNotFound
        next
      end
    end

    # The editor renders every table inside the table-block chrome, whose
    # typography (UI font at 0.875em, own cell padding) makes it ~90px taller
    # than a bare prose table. Give the preview the same wrapper so the boxes
    # match; the chrome's interactive handles only appear in the live editor.
    def wrap_tables(fragment)
      fragment.css("table").each do |table|
        next if table.ancestors("table").any?

        block = Nokogiri::XML::Node.new("div", table.document)
        block["class"] = "milkdown-table-block"
        wrapper = Nokogiri::XML::Node.new("div", table.document)
        wrapper["class"] = "table-wrapper"
        table.replace(block)
        block << wrapper
        wrapper << table
      end
    end

    # Mermaid: the editor inserts a derived <figure class="mermaid-diagram">
    # BEFORE the source <pre> (which stays in the doc; CSS hides it when the
    # view is not editable). Mirror that exact structure: a loading figure —
    # min-height from the persisted render hint when one exists, so the box is
    # right-sized before mermaid ever runs — followed by the untouched source.
    def replace_mermaid(fragment, editable:, hints:)
      fragment.css('pre[data-language="mermaid"]').each do |pre|
        figure = Nokogiri::XML::Node.new("figure", pre.document)
        figure["class"] = "mermaid-diagram"
        figure["data-state"] = "loading"
        figure["aria-label"] = "Mermaid diagram"
        hint = mermaid_hint(hints, pre.at_css("code")&.text.to_s.sub(/\n\z/, ""))
        figure["style"] = "min-height: #{hint}px" if hint
        status = Nokogiri::XML::Node.new("span", pre.document)
        status["class"] = "mermaid-diagram-status"
        status["role"] = "status"
        status.content = "Rendering diagram…"
        figure << status

        pre.add_previous_sibling(figure)
        pre.remove unless editable
      end
    end

    def mermaid_hint(hints, source)
      return nil unless hints.is_a?(Hash)

      value = hints[mermaid_source_hash(source)]
      value.is_a?(Integer) && value.positive? ? value : nil
    end

    # Replace each sketch with the same figure the live node view builds —
    # frame, tape, preview area at the reserved height, caption — holding a
    # server-drawn SVG of the scene. First paint shows the actual drawing and
    # the editor's identical figure swaps in with zero shift. Runs
    # post-sanitize; every scene passes ThinkroomSketch validation (element
    # types, colors, points) before anything is rendered, and unrecognized
    # payloads keep their sanitized code-block/figure form.
    def replace_sketches(fragment, format:, interactive:)
      sketch_nodes(fragment, format:).each do |node, sketch|
        node.replace(sketch_figure(node.document, sketch, interactive:))
      end
    end

    def sketch_nodes(fragment, format:)
      if format == "html"
        fragment.css("figure[data-thinkroom-sketch]").filter_map do |node|
          parsed = ThinkroomSketch.parse(
            node["data-scene"],
            description: node["data-description"],
            format_version: node["data-format-version"]
          )
          next unless parsed

          [ node, {
            parsed:,
            id: node["data-sketch-id"].to_s,
            height: clamp_height(node["data-sketch-height"])
          } ]
        end
      else
        # The excalidraw fence sanitizes down to <pre><code>{scene json}</code></pre>
        # (the lang hint is dropped), so the JSON payload itself is the signal.
        fragment.css("pre > code").filter_map do |code|
          payload = parse_sketch_payload(code.text) or next
          parsed = ThinkroomSketch.parse_markdown_fence(code.text)
          next unless parsed

          # The editor only accepts fences whose id matches this pattern
          # (normalizeSketchData); anything else stays a code block there,
          # so it must stay a code block here too.
          id = payload["id"].to_s[/\A[a-zA-Z0-9_-]{1,100}\z/]
          next unless id

          [ code.parent, {
            parsed:,
            id:,
            height: clamp_height(payload["height"])
          } ]
        end
      end
    end

    # Match only a real sketch payload, not any code block that happens to hold
    # JSON with a "scene" key. The live editor keys sketches on a lang=excalidraw
    # fence, but the sanitizer strips that hint — so mirror the sketch wrapper
    # shape instead (a formatVersion plus an excalidraw scene). Otherwise a
    # JSON/Ruby code sample gets erased into a blank skeleton on first paint.
    def parse_sketch_payload(text)
      data = JSON.parse(text)
      return nil unless data.is_a?(Hash) && data.key?("formatVersion")

      scene = data["scene"]
      data if scene.is_a?(Hash) && scene["type"] == "excalidraw"
    rescue JSON::ParserError
      nil
    end

    def sketch_figure(document, sketch, interactive:)
      parsed = sketch[:parsed]
      figure = Nokogiri::XML::Node.new("figure", document)
      figure["class"] = interactive ? "thinkroom-sketch is-editable" : "thinkroom-sketch"
      figure["data-sketch-id"] = sketch[:id]
      figure["style"] = tape_style(sketch[:id])

      preview = Nokogiri::XML::Node.new("div", document)
      preview["class"] = "thinkroom-sketch-preview"
      preview["style"] = "height: #{sketch[:height]}px"
      preview << SketchPreviewSvg.node(parsed.scene, document:)
      figure << preview

      caption = Nokogiri::XML::Node.new("figcaption", document)
      caption_classes = [ "thinkroom-sketch-caption" ]
      caption_classes << "is-empty" if parsed.description.blank?
      caption_classes << "is-editable" if interactive
      caption["class"] = caption_classes.join(" ")
      title = Nokogiri::XML::Node.new("input", document)
      title["class"] = "thinkroom-sketch-title"
      title["type"] = "text"
      title["value"] = parsed.description
      title["readonly"] = ""
      title["tabindex"] = "-1"
      title["aria-label"] = "Sketch title"
      title["placeholder"] = "Add a title…" if interactive
      caption << title
      figure << caption

      figure
    end

    # Same FNV hash the node view uses for its tape variation CSS variables
    # (syncTapeVariation in app/frontend/editor/sketch/node_view.ts), so the
    # washi tape sits at the identical width/offset/angle across the swap.
    def tape_style(id)
      hash = 2_166_136_261
      id.to_s.each_char do |character|
        hash = ((hash ^ character.ord) * 16_777_619) & 0xFFFFFFFF
      end
      width = 86 + hash % 23
      offset = ((hash >> 8) % 21) - 10
      angle = (((hash >> 16) % 29) - 14) / 10.0
      angle_text = angle == angle.truncate ? angle.truncate.to_s : angle.to_s
      "--sketch-tape-width: #{width}px; --sketch-tape-offset: #{offset}px; --sketch-tape-angle: #{angle_text}deg"
    end

    def clamp_height(raw)
      value = raw.to_i
      return DEFAULT_SKETCH_HEIGHT if value <= 0

      value.clamp(MIN_SKETCH_HEIGHT, MAX_SKETCH_HEIGHT)
    end
  end
end
