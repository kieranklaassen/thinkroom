class DocumentOgImage
  WIDTH = 1200
  HEIGHT = 630
  VERSION = "1"
  TITLE_LINE_WIDTH = 15.5
  TITLE_MAX_LINES = 3
  DESCRIPTION_LINE_WIDTH = 33.0
  DESCRIPTION_MAX_LINES = 3

  class << self
    def call(document)
      Rails.cache.fetch(cache_key(document)) do
        Vips::Image
          .svgload_buffer(svg(document), access: :sequential)
          .write_to_buffer(".png", compression: 6, strip: true)
      end
    end

    def cache_key(document)
      [ "document-og-image", VERSION, document.cache_key_with_version ]
    end

    def url_version(document)
      "#{VERSION}-#{document.updated_at.utc.strftime("%Y%m%d%H%M%S%6N")}"
    end

    private

    def svg(document)
      preview = DocumentSocialPreview.new(document)
      title_lines = wrap(preview.title, width: TITLE_LINE_WIDTH, maximum: TITLE_MAX_LINES)
      description_lines = wrap(
        preview.description,
        width: DESCRIPTION_LINE_WIDTH,
        maximum: DESCRIPTION_MAX_LINES
      )
      description_y = 154 + (title_lines.length * 76) + 36

      <<~SVG
        <svg xmlns="http://www.w3.org/2000/svg" width="#{WIDTH}" height="#{HEIGHT}" viewBox="0 0 #{WIDTH} #{HEIGHT}">
          <rect width="#{WIDTH}" height="#{HEIGHT}" fill="#fbfaf8"/>
          <line x1="96" y1="88" x2="1104" y2="88" stroke="#d8d5cf" stroke-width="2"/>
          <line x1="96" y1="542" x2="1104" y2="542" stroke="#d8d5cf" stroke-width="2"/>
          <text x="96" y="154" fill="#252525" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="64" font-weight="600" letter-spacing="-1.2">
            #{tspans(title_lines, x: 96, line_height: 76)}
          </text>
          <text x="96" y="#{description_y}" fill="#666666" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="30" font-weight="400">
            #{tspans(description_lines, x: 96, line_height: 42)}
          </text>
        </svg>
      SVG
    end

    def tspans(lines, x:, line_height:)
      lines.map.with_index do |line, index|
        dy = index.zero? ? 0 : line_height
        %(<tspan x="#{x}" dy="#{dy}">#{ERB::Util.html_escape(line)}</tspan>)
      end.join("\n")
    end

    def wrap(text, width:, maximum:)
      tokens = text.to_s.split(/\s+/).flat_map { |word| split_long_word(word, width) }
      lines = []
      current = +""

      tokens.each do |token|
        candidate = current.empty? ? token : "#{current} #{token}"
        if visual_width(candidate) <= width
          current = candidate
        else
          lines << current unless current.empty?
          current = token
        end
      end
      lines << current unless current.empty?
      lines = [ "Untitled" ] if lines.empty?
      return lines if lines.length <= maximum

      visible = lines.first(maximum)
      visible[-1] = ellipsize(visible[-1], width)
      visible
    end

    def split_long_word(word, width)
      return [ word ] if visual_width(word) <= width

      word.scan(/\X/).each_with_object([ +"" ]) do |grapheme, chunks|
        candidate = "#{chunks.last}#{grapheme}"
        if chunks.last.empty? || visual_width(candidate) <= width
          chunks[-1] = candidate
        else
          chunks << grapheme
        end
      end
    end

    def visual_width(text)
      text.scan(/\X/).sum { |grapheme| grapheme_width(grapheme) }
    end

    def grapheme_width(grapheme)
      return 0.32 if grapheme.match?(/\s/)
      return 1.0 if grapheme.match?(/[MW@%&#]/)
      return 1.0 if grapheme.match?(/\p{Han}|\p{Hiragana}|\p{Katakana}|\p{Hangul}/)
      return 1.0 if grapheme.codepoints.any? { |codepoint| codepoint >= 0x1F000 }
      return 0.32 if grapheme.match?(/[ilI1|!.,:;'`]/)
      return 0.68 if grapheme.match?(/[A-Z0-9]/)

      0.56
    end

    def ellipsize(text, width)
      graphemes = text.scan(/\X/)
      graphemes.pop while graphemes.any? && visual_width("#{graphemes.join}…") > width
      "#{graphemes.join.rstrip}…"
    end
  end
end
