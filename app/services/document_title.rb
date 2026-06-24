class DocumentTitle
  MAX_LENGTH = 255

  class << self
    def call(format:, content:)
      html = if format == "html"
        content.to_s
      else
        Commonmarker.to_html(
          content.to_s,
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
