# The one render of document Markdown. A document with very many addresses
# shows the bare ones, and bare links, as text; written links stay links.
class DocumentMarkdown
  ADDRESS = /@|&(?:commat|#0*64|#x0*40);/in
  MAX_ADDRESSES = 200

  class << self
    def to_html(source, options: {}, plugins:)
      options = options.merge(extension: { **options[:extension], autolink: false }) if many_addresses?(source.b)
      Commonmarker.to_html(source, options:, plugins:)
    end

    private

    def many_addresses?(source)
      position = -1
      (MAX_ADDRESSES + 1).times.all? { position = source.byteindex(ADDRESS, position + 1) }
    end
  end
end
