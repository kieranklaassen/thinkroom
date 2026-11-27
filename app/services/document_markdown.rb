# The one render of document Markdown. A document with very many addresses, or
# very many links in one line, shows the bare ones as text; written links stay
# links. One with very large tables shows its tables as text.
class DocumentMarkdown
  ADDRESS = /@|&(?:commat|#0*64|#x0*40);/in
  MAX_ADDRESSES = 200
  LINK = %r{www\.|://}n
  MAX_LINK_TEXT = 100_000_000
  MAX_COLUMNS = 1_000
  MAX_CELLS = 20_000

  class << self
    def to_html(source, options: {}, plugins:)
      Commonmarker.to_html(source, options: limited(source, options), plugins:)
    end

    # The tree that to_html renders.
    def parse(source, **options) = Commonmarker.parse(source, options: limited(source, options))

    private

    def limited(source, options)
      bytes = source.b
      off = {}
      off[:autolink] = false if crowded?(bytes)
      off[:table] = false if large_tables?(bytes)
      off.any? ? options.merge(extension: { **options[:extension], **off }) : options
    end

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

    # Every row counts as full: a short one is filled up.
    def large_tables?(source)
      return false unless source.include?("-")

      source = source.gsub(/\r\n?/n, "\n") if source.include?("\r")
      columns = cells = 0
      source.each_line.any? do |line|
        if line.include?("-")
          columns = [ columns, delimited_columns(line) ].max
        elsif columns.positive? && line.match?(/\A[ \t]*\n?\z/n)
          columns = 0
        end
        cells += columns
        columns > MAX_COLUMNS || cells > MAX_CELLS
      end
    end

    # A delimiter row has one run of dashes for each column, up to the line's end,
    # and a pipe between two columns.
    def delimited_columns(line)
      before = line.rindex(/[^|: \t\v\f\n-]/n)
      delimiters = line.byteslice((before ? before + 1 : 0)..)
      [ delimiters.squeeze("-").count("-"), delimiters.count("|") + 1 ].min
    end
  end
end
