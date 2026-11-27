# The one render of document Markdown. A document with very many addresses, or
# very many links in one line, shows the bare ones as text; written links stay
# links.
class DocumentMarkdown
  ADDRESS = /@|&(?:commat|#0*64|#x0*40);/in
  MAX_ADDRESSES = 200
  LINK = %r{www\.|://}n
  MAX_LINK_TEXT = 100_000_000

  class << self
    def to_html(source, options: {}, plugins:)
      options = options.merge(extension: { **options[:extension], autolink: false }) if crowded?(source.b)
      Commonmarker.to_html(source, options:, plugins:)
    end

    private

    def crowded?(source) = many_addresses?(source) || much_link_text?(source)

    def many_addresses?(source)
      position = -1
      (MAX_ADDRESSES + 1).times.all? { position = source.byteindex(ADDRESS, position + 1) }
    end

    def much_link_text?(source)
      source.each_line.sum { |line| line.bytesize * parts(line) } > MAX_LINK_TEXT
    end

    def parts(line)
      addresses = links = 0
      line.scan(ADDRESS) { addresses += 1 }
      line.scan(LINK) { links += 1 }
      addresses + links + (links.zero? ? 0 : line.count(")"))
    end
  end
end
