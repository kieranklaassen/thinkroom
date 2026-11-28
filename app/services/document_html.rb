# The one parse of document HTML. It names the parser's own limits as
# TooComplex, so a reader can show the source and a write can give the reason.
class DocumentHtml
  class TooComplex < StandardError
    MESSAGE = "This content is nested too deeply, or has too many attributes on one element, " \
              "to be saved. Simplify it and try again.".freeze

    def initialize(message = MESSAGE) = super
  end

  class << self
    def parse(html, max_errors: 0)
      within_limits { Nokogiri::HTML5.fragment(html, max_errors:) }
    end

    def within_limits
      yield
    rescue ArgumentError => error
      raise unless error.message.end_with?("limit exceeded")

      raise TooComplex
    end
  end
end
