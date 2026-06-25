class DocumentPlainText
  BLOCK_SEPARATOR = " "
  # The canonical Commonmarker plugin set for rendering document markdown to the
  # text projection agents read. MarkdownSketchAudit renders with the same set
  # so its create-time recognition signal matches what this projection produces.
  MARKDOWN_PLUGINS = { table: true, strikethrough: true, tasklist: true }.freeze

  class << self
    def call(format:, content:)
      source = content.to_s
      html = if format == "html"
        source
      else
        Commonmarker.to_html(source, plugins: MARKDOWN_PLUGINS)
      end

      fragment = Nokogiri::HTML5.fragment(html)
      replace_sketches(fragment, format:)

      fragment
        .xpath(".//text()")
        .map(&:text)
        .join(BLOCK_SEPARATOR)
        .squish
        .gsub(/\s+([.,;:!?])/, '\1')
    end

    private

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
      else
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
