class SiteOgImage
  WIDTH = DocumentOgImage::WIDTH
  HEIGHT = DocumentOgImage::HEIGHT
  # Bump when the artwork changes so the cached PNG and the versioned
  # og:image URL invalidate.
  VERSION = "1"

  # All copy is trusted static product copy (no user input), so the wrapping,
  # escaping, and truncation machinery in DocumentOgImage is intentionally
  # omitted. Geometry and palette come from DocumentOgImage so the two cards
  # stay in the same family.
  MARGIN_X = DocumentOgImage::MARGIN_X
  CONTENT_RIGHT = DocumentOgImage::CONTENT_RIGHT
  RULE_X = DocumentOgImage::RULE_X
  HEADER_BASELINE = DocumentOgImage::HEADER_BASELINE
  WORDMARK_TEXT_X = DocumentOgImage::WORDMARK_TEXT_X
  HAIRLINE_Y = DocumentOgImage::HAIRLINE_Y
  FOOTER_CENTER = DocumentOgImage::FOOTER_CENTER

  ACCENT = DocumentOgImage::ACCENTS.first
  BACKGROUND = DocumentOgImage::BACKGROUND
  INK = DocumentOgImage::INK
  EYEBROW_INK = DocumentOgImage::EYEBROW_INK
  HAIRLINE_INK = DocumentOgImage::HAIRLINE_INK
  SERIF = DocumentOgImage::SERIF
  SANS = DocumentOgImage::SANS

  TAGLINE = "Where deeper thinking compounds."
  BYLINE = "From the creator of Compound Engineering."

  # Hand-set split of TAGLINE: both lines fit the document cards' title
  # measure (13.5 visual-width units at 72px), verified in the service test
  # with DocumentOgImage.visual_width.
  TITLE_LINES = [ "Where deeper thinking", "compounds." ].freeze
  TITLE_SIZE = DocumentOgImage::TITLE_SIZE
  TITLE_LINE_HEIGHT = DocumentOgImage::TITLE_LINE_HEIGHT
  # Title block centered in the band between header and footer hairline,
  # matching DocumentOgImage's block math.
  TITLE_BASELINE = DocumentOgImage::REGION_CENTER -
    (TITLE_LINES.length * TITLE_LINE_HEIGHT / 2) +
    DocumentOgImage::TITLE_FIRST_BASELINE_OFFSET

  class << self
    def call
      Rails.cache.fetch(cache_key) do
        Vips::Image
          .svgload_buffer(svg, access: :sequential)
          .write_to_buffer(".png", compression: 6, strip: true)
      end
    end

    # The card renders from DocumentOgImage's shared geometry/palette, so its
    # identity chains both versions: a document-template bump that reshapes the
    # shared constants also invalidates the site card without a manual bump.
    def cache_key
      [ "site-og-image", url_version ]
    end

    def url_version
      "#{VERSION}-#{DocumentOgImage::VERSION}"
    end

    private

    def svg
      <<~SVG
        <svg xmlns="http://www.w3.org/2000/svg" width="#{WIDTH}" height="#{HEIGHT}" viewBox="0 0 #{WIDTH} #{HEIGHT}">
          <rect width="#{WIDTH}" height="#{HEIGHT}" fill="#{BACKGROUND}"/>
          <line x1="#{RULE_X}" y1="0" x2="#{RULE_X}" y2="#{HEIGHT}" stroke="#{ACCENT}" stroke-width="1" opacity="0.28"/>

          <text x="#{MARGIN_X}" y="#{HEADER_BASELINE}" fill="#{ACCENT}" font-family="#{SERIF}" font-size="34" font-weight="600">T.</text>
          <text x="#{WORDMARK_TEXT_X}" y="#{HEADER_BASELINE}" fill="#{INK}" font-family="#{SANS}" font-size="21" font-weight="600" letter-spacing="-0.2">Thinkroom</text>

          <text x="#{MARGIN_X}" y="#{TITLE_BASELINE}" fill="#{INK}" font-family="#{SERIF}" font-size="#{TITLE_SIZE}" font-weight="500" letter-spacing="-1">
            <tspan x="#{MARGIN_X}" dy="0">#{TITLE_LINES.first}</tspan>
            <tspan x="#{MARGIN_X}" dy="#{TITLE_LINE_HEIGHT}">#{TITLE_LINES.last}</tspan>
          </text>

          <line x1="#{MARGIN_X}" y1="#{HAIRLINE_Y}" x2="#{CONTENT_RIGHT}" y2="#{HAIRLINE_Y}" stroke="#{HAIRLINE_INK}" stroke-width="1"/>
          <text x="#{MARGIN_X}" y="#{FOOTER_CENTER + 6}" fill="#{EYEBROW_INK}" font-family="#{SANS}" font-size="19" font-weight="400">#{BYLINE}</text>
        </svg>
      SVG
    end
  end
end
