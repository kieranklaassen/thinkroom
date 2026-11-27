class DocumentPlainText
  BLOCK_SEPARATOR = " "
  # The canonical Commonmarker plugin set for rendering document markdown to the
  # text projection agents read. MarkdownSketchAudit renders with the same set
  # so its create-time recognition signal matches what this projection produces.
  MARKDOWN_PLUGINS = { table: true, strikethrough: true, tasklist: true }.freeze

  class << self
    def call(format:, content:)
      text(fragment(format:, content:), format:)
    end

    # The parsed source. A caller that needs both the title and the text parses
    # once and reads the title (DocumentTitle.in) before the text, which
    # replaces sketches in place.
    def fragment(format:, content:)
      source = content.to_s.encode(Encoding::UTF_8, invalid: :replace, undef: :replace, replace: "�")
      html = if format == "html"
        source
      else
        Commonmarker.to_html(source, plugins: MARKDOWN_PLUGINS)
      end

      DocumentHtml.parse(html)
    rescue DocumentHtml::TooComplex
      # Shown as its source: one text node, so it has no title and no sketches.
      DocumentHtml.parse("").tap { |fragment| fragment << Nokogiri::XML::Text.new(source, fragment.document) }
    end

    # With `at_least`, reading may stop once the result has that many
    # characters; the result is then a prefix of the full text.
    def text(fragment, format:, at_least: nil)
      replace_sketches(fragment, format:)

      pieces = []
      collected = 0
      enough = at_least
      fragment.xpath(".//text()").each do |node|
        piece = node.text
        pieces << piece
        next unless at_least

        collected += piece.length
        next if collected < enough

        text = normalize(pieces)
        return text if text.length >= at_least

        # Whitespace collapsed below the target: read as much again.
        enough = collected * 2
      end
      normalize(pieces)
    end

    private

    def normalize(pieces)
      pieces.join(BLOCK_SEPARATOR).squish.gsub(/\s+([.,;:!?])/, '\1')
    end

    def replace_sketches(fragment, format:)
      if format == "html"
        fragment.css("figure[data-thinkroom-sketch]").each do |node|
          replace_with_semantics(
            node,
            scene: node["data-scene"],
            description: node["data-description"],
            format_version: node["data-format-version"]
          )
        end
      elsif fragment.at_xpath(".//pre")
        # A CSS search visits every top-level block, so it waits for a code block.
        fragment.css('pre[lang="excalidraw"] > code').each do |node|
          # A malformed body (unparseable, non-Hash, missing scene, or a value
          # that can't be re-encoded) returns nil and is left visible instead of
          # raising — the same outcome MarkdownSketchAudit reports as unrecognized.
          parsed = ThinkroomSketch.parse_markdown_fence(node.text)
          node.parent.replace(Nokogiri::XML::Text.new(parsed.semantic_text, node.parent.document)) if parsed
        end
      end
    end

    def replace_with_semantics(node, scene:, description:, format_version:)
      parsed = ThinkroomSketch.parse(scene, description:, format_version:)
      node.replace(Nokogiri::XML::Text.new(parsed.semantic_text, node.document)) if parsed
    end
  end
end
