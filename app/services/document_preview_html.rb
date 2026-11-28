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
  # A long document's preview costs hundreds of milliseconds to render
  # (Commonmarker, the sanitizer and several Nokogiri passes over the whole
  # source) and is requested on every page load, yet only changes with its
  # inputs. Recent renders stay in a bounded in-process LRU keyed by a digest
  # of every input; uncompressed so a hit is a hash lookup, not an inflate.
  CACHE = ActiveSupport::Cache::MemoryStore.new(size: 64.megabytes, compress: false)
  CACHE_VERSION = 1

  # Milkdown's trailing plugin appends an empty paragraph whenever the last
  # block is neither a paragraph nor a heading, so the editor holds one block
  # more than the preview emitted.
  TRAILING_EXEMPT_BLOCKS = %w[p h1 h2 h3 h4 h5 h6].freeze

  # Block containers whose children are block elements; the whitespace between
  # those children is the markdown renderer's pretty-printing, never content.
  WHITESPACE_BLOCK_PARENTS = %w[
    ul ol li blockquote table thead tbody tr figure dl
  ].freeze
  WHITESPACE_BLOCK_PARENTS_SET = WHITESPACE_BLOCK_PARENTS.to_set.freeze
  ALL_WHITESPACE = /\A\s*\z/

  # Images carry no intrinsic size in markdown, so the preview reflows when
  # each one loads. Uploaded images are Active Storage blobs whose analyzed
  # dimensions we know — emit width/height (with height:auto CSS) so the
  # box is reserved from first paint.
  SIGNED_BLOB_SRC = %r{\A/rails/active_storage/blobs/(?:redirect|proxy)/([^/]+)/}

  class << self
    # editable: whether the editor will mount with contenteditable (Edit or
    #   Suggest mode for a writer) — controls Mermaid source visibility.
    # sketch_interactive: whether sketches will be clickable (Edit mode only)
    #   — controls the caption affordance so it doesn't flash at swap.
    # render_hints: Document#render_hints ({"mermaid" => {hash => px}}).
    def call(format:, content:, editable: false, sketch_interactive: false, render_hints: {})
      source = content.to_s
      return "" if source.blank?

      key = cache_key(format:, source:, editable:, sketch_interactive:, render_hints:)
      CACHE.fetch(key) { render(format:, source:, editable:, sketch_interactive:, render_hints:) }
    end

    # Top-level blocks in a rendered preview: the same count the editor sees
    # as doc.childCount, so the server preview and the live editor agree on
    # whether a document is long (editor/long_document.ts). Two structural
    # differences keep the raw element count from matching, and both can flip
    # a document across the threshold on one layer only.
    def block_count(html)
      return 0 if html.blank?

      CACHE.fetch([ "document-preview-blocks", CACHE_VERSION, Digest::SHA256.hexdigest(html) ]) do
        fragment = DocumentHtml.parse(html)
        count = 0
        last = nil
        node = fragment.first_element_child
        while node
          count += 1 unless mermaid_widget_figure?(node)
          last = node
          node = node.next_element
        end
        count += 1 if trailing_paragraph?(last)
        count
      end
    end

    def cache_key(format:, source:, editable:, sketch_interactive:, render_hints:)
      [
        "document-preview-html", CACHE_VERSION, format, editable, sketch_interactive,
        Digest::SHA256.hexdigest(source), Digest::SHA256.hexdigest(render_hints.to_json)
      ]
    end

    # FNV-1a over UTF-16 code units, matching sourceHash in
    # app/frontend/editor/mermaid.ts so persisted render hints line up with
    # the hashes the editor computes for its diagram figures.
    def mermaid_source_hash(source)
      hash = source.encode(Encoding::UTF_16LE).unpack("v*").reduce(2_166_136_261) do |acc, unit|
        ((acc ^ unit) * 16_777_619) & 0xFFFFFFFF
      end
      hash.to_s(36)
    end

    private

    # An editable preview keeps the Mermaid source <pre> and puts the loading
    # figure beside it (replace_mermaid), but the editor builds that figure as
    # a widget decoration on the code_block (editor/mermaid.ts) — so the pair
    # is a single block to doc.childCount.
    def mermaid_widget_figure?(node)
      return false unless node.name == "figure" && node["class"].to_s.split.include?("mermaid-diagram")

      sibling = node.next_element
      sibling&.name == "pre" && sibling["data-language"].to_s.casecmp?("mermaid")
    end

    def trailing_paragraph?(last_child)
      last_child.present? && TRAILING_EXEMPT_BLOCKS.exclude?(last_child.name)
    end

    def render(format:, source:, editable:, sketch_interactive:, render_hints:)
      mark_mermaid = false
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
        rendered = DocumentMarkdown.to_html(
          source,
          options: { render: { unsafe: true }, extension: { header_ids: nil } },
          plugins: { table: true, strikethrough: true, tasklist: true }
        )
        mark_mermaid = rendered.match?(/lang="mermaid"/i)
        rendered
      end

      # Security boundary: document content is authored by humans and agents, so
      # it is sanitized before it can reach dangerouslySetInnerHTML on the client.
      fragment = HtmlDocumentSanitizer.snapshot_fragment(html) do |parsed|
        mark_mermaid_fences(parsed) if mark_mermaid
      end

      hints = render_hints.is_a?(Hash) ? render_hints.fetch("mermaid", {}) : {}
      Transformer.new(format:, editable:, sketch_interactive:, hints:).call(fragment)
      fragment.to_html
    end

    # Commonmarker writes the fenced language to a `lang` attribute, which the
    # document sanitizer intentionally drops. Translate only the Mermaid signal
    # to the already-supported data-language attribute before sanitizing so the
    # instant preview can mark diagram blocks without trusting arbitrary HTML.
    def mark_mermaid_fences(parent)
      node = parent.child
      while node
        if node.type == Nokogiri::XML::Node::ELEMENT_NODE
          if node.name == "pre" && node["lang"]&.casecmp?("mermaid")
            node["data-language"] = "mermaid"
          end
          mark_mermaid_fences(node) if node.child
        end
        node = node.next_sibling
      end
    end
  end

  # Single-pass DOM transformer combining inter-block whitespace collapsing,
  # <br>\n stripping, ProseMirror trailing breaks, table-block wrapping,
  # sketch rendering, Mermaid loading figures, and Active Storage image
  # dimension annotation.
  class Transformer
    def initialize(format:, editable:, sketch_interactive:, hints:)
      @is_html = format == "html"
      @editable = editable
      @sketch_interactive = sketch_interactive
      @hints = hints.is_a?(Hash) && hints.any? ? hints : nil
      @image_targets = []
    end

    def call(fragment)
      transform_children(fragment, true, false)
      annotate_image_dimensions
      fragment
    end

    private

    def transform_children(parent, collapse_whitespace, in_table)
      node = parent.child
      while node
        next_node = node.next_sibling
        type = node.type

        if type == Nokogiri::XML::Node::TEXT_NODE
          if collapse_whitespace
            if next_node&.type == Nokogiri::XML::Node::TEXT_NODE
              next_node = collapse_text_run(node)
            elsif node.content.match?(ALL_WHITESPACE)
              node.remove
            end
          end
          node = next_node
          next
        end

        unless type == Nokogiri::XML::Node::ELEMENT_NODE
          node = next_node
          next
        end

        name = node.name
        case name
        when "br"
          next_node = collapse_break_newline(node, next_node)
        when "img"
          collect_image_target(node)
        when "p"
          transform_children(node, false, in_table) if node.child
          add_trailing_break(node)
        when "table"
          transform_children(node, true, true) if node.child
          wrap_table(node) unless in_table
        when "figure"
          if @is_html && replace_html_sketch(node)
            node = next_node
            next
          end
          transform_children(node, true, in_table) if node.child
        when "pre"
          if !@is_html && replace_markdown_sketch(node)
            node = next_node
            next
          end
          if node["data-language"] == "mermaid"
            transform_children(node, false, in_table) if @editable && node.child
            replace_mermaid_pre(node)
            node = next_node
            next
          end
          transform_children(node, false, in_table) if node.child
        else
          if node.child
            transform_children(node, WHITESPACE_BLOCK_PARENTS_SET.include?(name), in_table)
          end
        end

        node = next_node
      end
    end

    # Removing or unwrapping elements during sanitization can leave consecutive
    # sibling text nodes that a serialize+reparse round-trip would coalesce into
    # one text node. Treat a contiguous text run as removable only when every
    # node in the run is whitespace.
    def collapse_text_run(first_text)
      run_end = first_text
      all_whitespace = first_text.content.match?(ALL_WHITESPACE)

      while (sibling = run_end.next_sibling)&.type == Nokogiri::XML::Node::TEXT_NODE
        all_whitespace &&= sibling.content.match?(ALL_WHITESPACE)
        run_end = sibling
      end

      after = run_end.next_sibling
      if all_whitespace
        cursor = first_text
        loop do
          nxt = cursor.next_sibling
          cursor.remove
          break if cursor == run_end

          cursor = nxt
        end
      end
      after
    end

    # Commonmarker renders soft/hard line breaks as "<br>\n" — the literal
    # newline is a second forced break under white-space: break-spaces, so
    # every line break made the preview one full line taller than the editor
    # (which emits a bare <br>). Strip exactly one newline after each <br>.
    def collapse_break_newline(br, next_node)
      sibling = br.next_sibling
      sibling = sibling.next_sibling while sibling&.type == Nokogiri::XML::Node::TEXT_NODE && sibling.content.empty?
      return next_node unless sibling&.type == Nokogiri::XML::Node::TEXT_NODE

      content = sibling.content
      return next_node unless content.start_with?("\n")

      if content.bytesize == 1
        after = sibling.next_sibling
        sibling.remove
        sibling == next_node ? after : next_node
      else
        sibling.content = content.byteslice(1..)
        next_node
      end
    end

    # ProseMirror renders a separator + trailing break after a textblock that
    # ends in a non-text inline (a block image), after a trailing hard break,
    # and inside empty paragraphs — each adds one line box the plain HTML
    # doesn't have. Replicate the exact DOM so both layers wrap identically.
    def add_trailing_break(paragraph)
      last = nil
      child = paragraph.child
      while child
        last = child unless child.type == Nokogiri::XML::Node::TEXT_NODE && child.content.empty?
        child = child.next_sibling
      end

      if last.nil?
        paragraph << trailing_break(paragraph.document)
      elsif last.type == Nokogiri::XML::Node::ELEMENT_NODE
        case last.name
        when "img"
          separator = Nokogiri::XML::Node.new("img", paragraph.document)
          separator["class"] = "ProseMirror-separator"
          separator["alt"] = ""
          paragraph << separator
          paragraph << trailing_break(paragraph.document)
        when "br"
          paragraph << trailing_break(paragraph.document)
        end
      end
    end

    def trailing_break(document)
      br = Nokogiri::XML::Node.new("br", document)
      br["class"] = "ProseMirror-trailingBreak"
      br
    end

    def collect_image_target(img)
      src = img["src"]
      return if src.nil? || img["width"].present? || img["class"]&.include?("ProseMirror-separator")

      signed_id = SIGNED_BLOB_SRC.match(src)&.[](1)
      @image_targets << [ img, signed_id ] if signed_id
    end

    def annotate_image_dimensions
      return if @image_targets.empty?

      # One batched SELECT instead of a find_signed per <img>. The signature
      # check (verifier + :blob_id purpose, exactly what Blob.find_signed
      # does) still gates every id; unverifiable or missing blobs just skip.
      blob_ids = @image_targets.map(&:last).uniq.index_with do |signed_id|
        ActiveStorage.verifier.verified(signed_id, purpose: :blob_id)
      end.compact
      blobs = ActiveStorage::Blob.where(id: blob_ids.values).index_by(&:id)

      @image_targets.each do |img, signed_id|
        metadata = blobs[blob_ids[signed_id]]&.metadata
        width = metadata&.dig("width")
        height = metadata&.dig("height")
        next unless width.present? && height.present?

        img["width"] = width.to_s
        img["height"] = height.to_s
      end
    end

    # The editor renders every table inside the table-block chrome, whose
    # typography (UI font at 0.875em, own cell padding) makes it ~90px taller
    # than a bare prose table. Give the preview the same wrapper so the boxes
    # match; the chrome's interactive handles only appear in the live editor.
    def wrap_table(table)
      block = Nokogiri::XML::Node.new("div", table.document)
      block["class"] = "milkdown-table-block"
      wrapper = Nokogiri::XML::Node.new("div", table.document)
      wrapper["class"] = "table-wrapper"
      table.replace(block)
      block << wrapper
      wrapper << table
    end

    # Mermaid: the editor inserts a derived <figure class="mermaid-diagram">
    # BEFORE the source <pre> (which stays in the doc; CSS hides it when the
    # view is not editable). Mirror that exact structure: a loading figure —
    # min-height from the persisted render hint when one exists, so the box is
    # right-sized before mermaid ever runs — followed by the untouched source.
    def replace_mermaid_pre(pre)
      figure = Nokogiri::XML::Node.new("figure", pre.document)
      figure["class"] = "mermaid-diagram"
      figure["data-state"] = "loading"
      figure["aria-label"] = "Mermaid diagram"
      if @hints
        code_text = first_code_descendant(pre)&.text.to_s.sub(/\n\z/, "")
        hint = mermaid_hint(code_text)
        figure["style"] = "min-height: #{hint}px" if hint
      end
      status = Nokogiri::XML::Node.new("span", pre.document)
      status["class"] = "mermaid-diagram-status"
      status["role"] = "status"
      status.content = "Rendering diagram…"
      figure << status

      pre.add_previous_sibling(figure)
      pre.remove unless @editable
    end

    def first_code_descendant(parent)
      node = parent.child
      while node
        if node.type == Nokogiri::XML::Node::ELEMENT_NODE
          return node if node.name == "code"

          found = first_code_descendant(node)
          return found if found
        end
        node = node.next_sibling
      end
      nil
    end

    def mermaid_hint(source)
      value = @hints[DocumentPreviewHtml.mermaid_source_hash(source)]
      value.is_a?(Integer) && value.positive? ? value : nil
    end

    # Replace each sketch with the same figure the live node view builds
    # (SketchPreview.figure) so first paint shows the actual drawing and the
    # editor's identical figure swaps in with zero shift. Runs post-sanitize;
    # every scene passes ThinkroomSketch validation (element types, colors,
    # points) before anything is rendered, and unrecognized payloads keep
    # their sanitized code-block/figure form.
    def replace_html_sketch(node)
      return false unless node.key?("data-thinkroom-sketch")

      parsed = ThinkroomSketch.parse(
        node["data-scene"],
        description: node["data-description"],
        format_version: node["data-format-version"],
        id: node["data-sketch-id"].to_s,
        height: node["data-sketch-height"]
      )
      return false unless parsed

      node.replace(SketchPreview.figure(node.document, parsed, interactive: @sketch_interactive))
      true
    end

    # The excalidraw fence sanitizes down to <pre><code>{scene json}</code></pre>
    # (the lang hint is dropped), so the JSON payload itself is the signal.
    def replace_markdown_sketch(pre)
      child = pre.child
      while child
        if child.type == Nokogiri::XML::Node::ELEMENT_NODE && child.name == "code"
          code_text = child.text
          if code_text.lstrip.start_with?("{")
            parsed = ThinkroomSketch.parse_markdown_fence(code_text)
            if parsed
              pre.replace(SketchPreview.figure(pre.document, parsed, interactive: @sketch_interactive))
              return true
            end
          end
        end
        child = child.next_sibling
      end
      false
    end
  end
  private_constant :Transformer
end
