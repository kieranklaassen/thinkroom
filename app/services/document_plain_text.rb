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

      Nokogiri::HTML5.fragment(html)
        .xpath(".//text()")
        .map(&:text)
        .join(BLOCK_SEPARATOR)
        .squish
        .gsub(/\s+([.,;:!?])/, '\1')
    end
  end
end
