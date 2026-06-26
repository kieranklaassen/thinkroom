class DocumentOgImage
  WIDTH = 1200
  HEIGHT = 630
  VERSION = "3"
  TITLE_LINE_WIDTH = 16.5
  TITLE_MAX_LINES = 3
  DESCRIPTION_LINE_WIDTH = 33.0
  DESCRIPTION_MAX_LINES = 2

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
      description_maximum = title_lines.length >= TITLE_MAX_LINES ? 1 : DESCRIPTION_MAX_LINES
      description_lines = wrap(
        preview.description,
        width: DESCRIPTION_LINE_WIDTH,
        maximum: description_maximum
      )
      description_y = 222 + (title_lines.length * 68)

      <<~SVG
        <svg xmlns="http://www.w3.org/2000/svg" width="#{WIDTH}" height="#{HEIGHT}" viewBox="0 0 #{WIDTH} #{HEIGHT}">
          <defs>
            <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#f4effa"/>
              <stop offset="1" stop-color="#ece5f6"/>
            </linearGradient>
            <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#a755db"/>
              <stop offset="1" stop-color="#7240c7"/>
            </linearGradient>
          </defs>
          <rect width="#{WIDTH}" height="#{HEIGHT}" fill="url(#background)"/>
          <circle cx="1090" cy="8" r="260" fill="#9d4edd" opacity="0.08"/>
          <circle cx="1138" cy="72" r="126" fill="none" stroke="#9d4edd" stroke-width="2" opacity="0.16"/>
          <rect x="48" y="48" width="1104" height="534" rx="28" fill="#fffdf9" stroke="#dcd2e8" stroke-width="2"/>
          <path d="M76 48H62C54.268 48 48 54.268 48 62V568C48 575.732 54.268 582 62 582H76Z" fill="url(#accent)"/>

          <circle cx="105" cy="112" r="6" fill="#9d4edd"/>
          <text x="123" y="120" fill="#674e78" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="20" font-weight="700" letter-spacing="2.6">THINKROOM · SHARED DOCUMENT</text>
          <g opacity="0.72">
            <circle cx="1040" cy="111" r="17" fill="#eadcf5" stroke="#fffdf9" stroke-width="4"/>
            <circle cx="1072" cy="111" r="17" fill="#d6c2ec" stroke="#fffdf9" stroke-width="4"/>
            <circle cx="1104" cy="111" r="17" fill="#9d4edd" stroke="#fffdf9" stroke-width="4"/>
          </g>

          <text x="100" y="198" fill="#252128" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="62" font-weight="650" letter-spacing="-1.5">
            #{tspans(title_lines, x: 100, line_height: 68)}
          </text>
          <text x="100" y="#{description_y}" fill="#685f6c" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="28" font-weight="400">
            #{tspans(description_lines, x: 100, line_height: 40)}
          </text>

          <rect x="100" y="504" width="232" height="50" rx="25" fill="#8f46cf"/>
          <text x="126" y="536" fill="#ffffff" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="19" font-weight="700">Open document →</text>
          <text x="1100" y="535" text-anchor="end" fill="#827787" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="18">A place for deeper thinking</text>
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
