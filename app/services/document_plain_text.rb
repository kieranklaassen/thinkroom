class DocumentPlainText
  BLOCK_SEPARATOR = " "

  class << self
    def call(format:, content:)
      source = content.to_s
      html = if format == "html"
        source
      else
        Commonmarker.to_html(
          source,
          plugins: { table: true, strikethrough: true, tasklist: true }
        )
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
          payload = JSON.parse(node.text)
          replace_with_semantics(
            node.parent,
            scene: JSON.generate(payload.fetch("scene")),
            description: payload["description"],
            format_version: payload["formatVersion"]
          )
        rescue JSON::ParserError, KeyError
          # Leave malformed source visible instead of hiding data.
        end
      end
    end

    def replace_with_semantics(node, scene:, description:, format_version:)
      parsed = ThinkroomSketch.parse(scene, description:, format_version:)
      node.replace(Nokogiri::XML::Text.new(parsed.semantic_text, node.document)) if parsed
    end
  end
end
