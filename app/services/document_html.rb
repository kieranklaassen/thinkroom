# The one parse of document HTML. The parser refuses a tree nested past its
# depth limit (and an element with too many attributes); this names that
# refusal so each reader of a document can answer it: a preview or a text shows
# the source, a write that must be sanitized is refused with the message.
class DocumentHtml
  class TooComplex < StandardError
    MESSAGE = "This HTML is nested too deeply or has too many attributes on one element. Simplify it and try again.".freeze

    def initialize(message = MESSAGE) = super
  end

  class << self
    def parse(html)
      within_limits { Nokogiri::HTML5.fragment(html) }
    end

    def within_limits
      yield
    rescue ArgumentError => error
      raise unless error.message.end_with?("limit exceeded")

      raise TooComplex
    end
  end
end
