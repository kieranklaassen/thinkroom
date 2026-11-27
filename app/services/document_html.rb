# The one parse of document HTML. It names the parser's own limits as
# TooComplex so each reader of a document answers them the same way: a preview
# or a text shows the source, and a write that must be sanitized first returns
# the message.
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
