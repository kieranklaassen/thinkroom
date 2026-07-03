class SiteOgImage
  WIDTH = DocumentOgImage::WIDTH
  HEIGHT = DocumentOgImage::HEIGHT
  # Bump when the artwork changes so the cached PNG and the versioned
  # og:image URL invalidate.
  VERSION = "1"

  # Same editorial "document cover" language as DocumentOgImage, but fully
  # static: the landing card carries the product tagline as its title and the
  # byline in the footer, so no wrapping or per-document projection is needed.
  MARGIN_X = DocumentOgImage::MARGIN_X
  CONTENT_RIGHT = DocumentOgImage::CONTENT_RIGHT
  RULE_X = DocumentOgImage::RULE_X
  HEADER_BASELINE = DocumentOgImage::HEADER_BASELINE
  HAIRLINE_Y = DocumentOgImage::HAIRLINE_Y
  FOOTER_CENTER = DocumentOgImage::FOOTER_CENTER

  ACCENT = DocumentOgImage::ACCENTS.first
  BACKGROUND = DocumentOgImage::BACKGROUND
  INK = DocumentOgImage::INK
  EYEBROW_INK = DocumentOgImage::EYEBROW_INK
  HAIRLINE_INK = DocumentOgImage::HAIRLINE_INK
  SERIF = DocumentOgImage::SERIF
  SANS = DocumentOgImage::SANS

  # Hand-set split of the tagline: both lines fit the document cards' title
  # measure (13.5 visual-width units at 72px), verified with
  # DocumentOgImage.visual_width.
  TITLE_LINES = [ "Where deeper thinking", "compounds." ].freeze
  TITLE_SIZE = DocumentOgImage::TITLE_SIZE
  TITLE_LINE_HEIGHT = DocumentOgImage::TITLE_LINE_HEIGHT
  # Two title lines centered in the band between header and footer hairline,
  # using the same block math as DocumentOgImage (region center 306).
  TITLE_BASELINE = 286

  BYLINE = "From the creator of Compound Engineering."

  class << self
    def call
      Rails.cache.fetch(cache_key) do
        Vips::Image
          .svgload_buffer(svg, access: :sequential)
          .write_to_buffer(".png", compression: 6, strip: true)
      end
    end

    def cache_key
      [ "site-og-image", VERSION ]
    end

    private

    def svg
      <<~SVG
        <svg xmlns="http://www.w3.org/2000/svg" width="#{WIDTH}" height="#{HEIGHT}" viewBox="0 0 #{WIDTH} #{HEIGHT}">
          <rect width="#{WIDTH}" height="#{HEIGHT}" fill="#{BACKGROUND}"/>
          <line x1="#{RULE_X}" y1="0" x2="#{RULE_X}" y2="#{HEIGHT}" stroke="#{ACCENT}" stroke-width="1" opacity="0.28"/>

          <text x="#{MARGIN_X}" y="#{HEADER_BASELINE}" fill="#{ACCENT}" font-family="#{SERIF}" font-size="34" font-weight="600">T.</text>
          <text x="120" y="#{HEADER_BASELINE}" fill="#{INK}" font-family="#{SANS}" font-size="21" font-weight="600" letter-spacing="-0.2">Thinkroom</text>

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
