class DocumentOgImage
  WIDTH = 1200
  HEIGHT = 630
  # Bump when the visual template changes so cached PNGs and versioned
  # og:image URLs invalidate.
  VERSION = "4"

  # Page geometry. The design is a full-bleed cream "document cover": a left
  # margin rule, a wordmark/eyebrow header, a centered serif title + excerpt,
  # and a hairline footer carrying the author and optional label pills.
  MARGIN_X = 72
  CONTENT_RIGHT = WIDTH - MARGIN_X
  RULE_X = 44

  HEADER_BASELINE = 96

  # Title/excerpt live in the band between the header and the footer hairline
  # and are vertically centered within it.
  REGION_TOP = 128
  REGION_BOTTOM = 484
  REGION_CENTER = (REGION_TOP + REGION_BOTTOM) / 2

  # Widths are in "visual width" units (~1 em per unit), so max line px / size.
  TITLE_SIZE = 72
  TITLE_LINE_HEIGHT = 78
  TITLE_LINE_WIDTH = 13.5
  TITLE_MAX_LINES = 3

  DESCRIPTION_SIZE = 26
  DESCRIPTION_LINE_HEIGHT = 38
  DESCRIPTION_LINE_WIDTH = 33.0
  DESCRIPTION_MAX_LINES = 2
  DESCRIPTION_GAP = 22

  HAIRLINE_Y = 508
  FOOTER_CENTER = 554
  AVATAR_RADIUS = 20

  # Curated jewel/earth tones that all read well on the cream field. The default
  # (first) is the maroon from the mockup; each document gets a stable accent
  # derived from its slug so previews feel distinct without a manual choice.
  ACCENTS = %w[#7A2E2E #2A5A46 #2F3A56 #8A5A1F].freeze

  BACKGROUND = "#FBFAF7"
  INK = "#1C1B18"
  DESCRIPTION_INK = "#5C5850"
  EYEBROW_INK = "#8A867C"
  HAIRLINE_INK = "#E3DFD6"
  AUTHOR_INK = "#3A372F"
  PILL_INK = "#5C5850"
  PILL_BORDER = "#DBD6CB"
  AVATAR_INK = "#FBFAF7"

  SERIF = "Newsreader, 'Liberation Serif', Georgia, 'Times New Roman', serif".freeze
  SANS = "Instrument Sans, -apple-system, 'Segoe UI', 'Liberation Sans', Helvetica, Arial, sans-serif".freeze

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
      accent = accent_for(document)

      title_lines = wrap(preview.title, width: TITLE_LINE_WIDTH, maximum: TITLE_MAX_LINES)
      description_maximum = title_lines.length >= TITLE_MAX_LINES ? 1 : DESCRIPTION_MAX_LINES
      # A title-only document projects its title as the description too; don't
      # echo it back as a redundant subtitle on the card.
      description_text = preview.description.to_s
      description_text = "" if description_text.strip == preview.title.to_s.strip
      description_lines = description_text.present? ? wrap(description_text, width: DESCRIPTION_LINE_WIDTH, maximum: description_maximum) : []

      block_height = title_lines.length * TITLE_LINE_HEIGHT
      block_height += DESCRIPTION_GAP + description_lines.length * DESCRIPTION_LINE_HEIGHT if description_lines.any?
      block_top = REGION_CENTER - (block_height / 2.0)

      title_baseline = block_top + 58
      title_bottom = block_top + title_lines.length * TITLE_LINE_HEIGHT
      description_baseline = title_bottom + DESCRIPTION_GAP + 27

      wordmark_x = MARGIN_X + (visual_width("T.") * 34) + 14

      <<~SVG
        <svg xmlns="http://www.w3.org/2000/svg" width="#{WIDTH}" height="#{HEIGHT}" viewBox="0 0 #{WIDTH} #{HEIGHT}">
          <rect width="#{WIDTH}" height="#{HEIGHT}" fill="#{BACKGROUND}"/>
          <line x1="#{RULE_X}" y1="0" x2="#{RULE_X}" y2="#{HEIGHT}" stroke="#{accent}" stroke-width="1" opacity="0.28"/>

          <text x="#{MARGIN_X}" y="#{HEADER_BASELINE}" fill="#{accent}" font-family="#{SERIF}" font-size="34" font-weight="600">T.</text>
          <text x="#{wordmark_x.round(1)}" y="#{HEADER_BASELINE}" fill="#{INK}" font-family="#{SANS}" font-size="21" font-weight="600" letter-spacing="-0.2">Thinkroom</text>
          <text x="#{CONTENT_RIGHT}" y="#{HEADER_BASELINE}" text-anchor="end" fill="#{EYEBROW_INK}" font-family="#{SANS}" font-size="16" font-weight="500" letter-spacing="2.2">SHARED DOCUMENT</text>

          <text x="#{MARGIN_X}" y="#{title_baseline.round(1)}" fill="#{INK}" font-family="#{SERIF}" font-size="#{TITLE_SIZE}" font-weight="500" letter-spacing="-1">
            #{tspans(title_lines, x: MARGIN_X, line_height: TITLE_LINE_HEIGHT)}
          </text>
          #{description_svg(description_lines, description_baseline)}

          <line x1="#{MARGIN_X}" y1="#{HAIRLINE_Y}" x2="#{CONTENT_RIGHT}" y2="#{HAIRLINE_Y}" stroke="#{HAIRLINE_INK}" stroke-width="1"/>
          #{footer_left_svg(preview, accent)}
          #{pills_svg(preview.labels)}
        </svg>
      SVG
    end

    def description_svg(lines, baseline)
      return "" if lines.empty?

      %(<text x="#{MARGIN_X}" y="#{baseline.round(1)}" fill="#{DESCRIPTION_INK}" font-family="#{SANS}" font-size="#{DESCRIPTION_SIZE}" font-weight="400">
            #{tspans(lines, x: MARGIN_X, line_height: DESCRIPTION_LINE_HEIGHT)}
          </text>)
    end

    def footer_left_svg(preview, accent)
      if preview.author.present?
        cx = MARGIN_X + AVATAR_RADIUS
        <<~AUTHOR.strip
          <circle cx="#{cx}" cy="#{FOOTER_CENTER}" r="#{AVATAR_RADIUS}" fill="#{accent}"/>
          <text x="#{cx}" y="#{FOOTER_CENTER + 7}" text-anchor="middle" fill="#{AVATAR_INK}" font-family="#{SERIF}" font-size="21" font-weight="500">#{escape(preview.author_initial)}</text>
          <text x="#{cx + AVATAR_RADIUS + 14}" y="#{FOOTER_CENTER + 7}" fill="#{AUTHOR_INK}" font-family="#{SANS}" font-size="20" font-weight="500">#{escape(preview.author)}</text>
        AUTHOR
      else
        %(<text x="#{MARGIN_X}" y="#{FOOTER_CENTER + 6}" fill="#{EYEBROW_INK}" font-family="#{SANS}" font-size="19" font-weight="400">A place for deeper thinking</text>)
      end
    end

    def pills_svg(labels)
      return "" if labels.empty?

      gap = 10
      widths = labels.map { |label| ((visual_width(label) * 16) + 32).round }
      total = widths.sum + gap * (labels.length - 1)
      cursor = CONTENT_RIGHT - total
      top = FOOTER_CENTER - 17

      labels.each_with_index.map do |label, index|
        width = widths[index]
        pill = <<~PILL.strip
          <rect x="#{cursor}" y="#{top}" width="#{width}" height="34" rx="17" fill="none" stroke="#{PILL_BORDER}" stroke-width="1.5"/>
          <text x="#{cursor + width / 2}" y="#{FOOTER_CENTER + 6}" text-anchor="middle" fill="#{PILL_INK}" font-family="#{SANS}" font-size="16" font-weight="500">#{escape(label)}</text>
        PILL
        cursor += width + gap
        pill
      end.join("\n          ")
    end

    def accent_for(document)
      slug = document.slug.to_s
      return ACCENTS.first if slug.empty?

      ACCENTS[slug.each_byte.sum % ACCENTS.length]
    end

    def tspans(lines, x:, line_height:)
      lines.map.with_index do |line, index|
        dy = index.zero? ? 0 : line_height
        %(<tspan x="#{x}" dy="#{dy}">#{escape(line)}</tspan>)
      end.join("\n")
    end

    def escape(text)
      ERB::Util.html_escape(text)
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
