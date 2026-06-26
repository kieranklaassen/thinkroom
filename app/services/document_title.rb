class DocumentTitle
  MAX_LENGTH = 255

  class << self
    def call(format:, content:)
      source = content.to_s.encode(Encoding::UTF_8, invalid: :replace, undef: :replace, replace: "�")
      html = if format == "html"
        source
      else
        Commonmarker.to_html(
          source,
          plugins: { table: true, strikethrough: true, tasklist: true }
        )
      end

      Nokogiri::HTML5.fragment(html)
        .at_css("h1")
        &.text
        &.squish
        &.first(MAX_LENGTH)
        &.presence
    end
  end
end
