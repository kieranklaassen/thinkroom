class RawHtml
  class Unreadable < StandardError; end

  class Markup < Hash
    attr_reader :unclosed

    def initialize
      super(0)
      @unclosed = Hash.new(0)
    end
  end

  PREVIEW = { header_ids: nil }.freeze
  EDITOR = {
    parse: { leave_footnote_definitions: true },
    extension: { header_ids: nil, footnotes: true, front_matter_delimiter: "---" }
  }.freeze
  EDITOR_NO_TABLE = {
    parse: EDITOR[:parse],
    extension: EDITOR[:extension].merge(table: false)
  }.freeze

  EMPTY_LINES = [ "<br />", "<br>", "<br >", "<br/>" ].freeze
  EDITOR_END_TAG = { "span" => "</span>", "ins" => "</ins>", "del" => "</del>" }.freeze
  RAW_CONTENT_ELEMENTS = %w[script style textarea title iframe noscript noembed noframes xmp plaintext].freeze

  PROVENANCE_OPEN = /\A<span[ \t]+data-provenance(?:="")?[ \t]+data-kind="([^"]*)"(?:[ \t]+data-author="([^"]*)")?[ \t]+data-state="([^"]*)"[ \t]*>\z/
  HIGHLIGHTER_OPEN = /\A<span[ \t]+data-highlighter(?:="")?[ \t]+data-color="([^"]*)"[ \t]*>\z/
  SUGGESTION_OPEN = /\A<(ins|del)[ \t]+data-suggestion-id="([^"]+)"(?:[ \t]+data-author="([^"]*)")?[ \t]*>\z/

  HTML_TAG_START = %r{</?[a-zA-Z!?]}
  FRONTMATTER_FENCE = /^[ \t]*(?:---[ \t]*$|`{3,}|~{3,})/
  FRONTMATTER_BLOCK = /\A---[ \t]*\n(.*?)\n---[ \t]*(?:\n|\z)/m
  TEMPLATE_UNCLOSED_ERROR = /\AEnd tag 'template' isn't allowed here\. Currently open tags: html, template, (.+)\.\z/
  INVALID_TAG_FIRST_CHAR = /\AInvalid first character of tag name/

  ROOT = "prosemirror"
  NODE = "html"
  FRONTMATTER = "frontmatter"
  NODE_TAG = "<html"
  FRONTMATTER_TAG = "<frontmatter"
  MAX_LIVE_DEPTH = 512

  MARK_ATTRS = {
    "link" => { "data-href" => :href, "data-title" => :title },
    "provenance" => { "data-author" => :author },
    "suggestInsertion" => { "data-author" => :author, "data-suggestion-id" => :suggestionId },
    "suggestDeletion" => { "data-author" => :author, "data-suggestion-id" => :suggestionId }
  }.freeze

  class << self
    def in_markdown(source)
      source = sanitize_encoding(source)
      return {} unless source.include?("<")

      most(literals(DocumentMarkdown.parse(source, extension: PREVIEW)), *editor_readings(source))
    end

    # Parse a Markdown document keeping body HTML and leading YAML frontmatter
    # HTML in separate namespaces so frontmatter entries cannot credit body HTML.
    def markup_source(source)
      source = sanitize_encoding(source)
      normalized = source.gsub(/\r\n?/, "\n")
      if (match = normalized.match(FRONTMATTER_BLOCK))
        root = Commonmarker.parse(normalized.gsub(/^---[ \t]+$/, "---"), options: EDITOR)
        if root.first_child&.type == :frontmatter
          fm_raw = match[1]
          body = normalized.byteslice(match.end(0)..)
          body_markup = markup(in_markdown(body))
          frontmatter_html_for(fm_raw).each { |key, count| body_markup[key] += count }
          return body_markup
        end
      end

      markup(in_markdown(source))
    end

    def in_html(source)
      source = source.to_s
      return {} unless source.include?("<")

      tmpl = DocumentHtml.parse("<template>#{source}</template>", max_errors: 10)
      frag = DocumentHtml.parse(source, max_errors: 10)
      tallied = most(
        tmpl.xpath("descendant::* | descendant::comment()").drop(1).map { |node| piece(node) }.tally,
        frag.xpath("descendant::* | descendant::comment()").map { |node| piece(node) }.tally
      )
      return tallied if tallied.any?

      sanitized = HtmlDocumentSanitizer.external(source).content
      sanitized_nodes = DocumentHtml.parse(sanitized).xpath("descendant::* | descendant::comment()")
      return sanitized_nodes.map { |node| piece(node) }.tally if sanitized_nodes.any?

      return { source.squish => 1 } if source.match?(HTML_TAG_START)

      {}
    rescue DocumentHtml::TooComplex
      { source.squish => 1 }
    end

    # Each raw HTML node's value in the live document. Reading the tree as text
    # is complete and cheap, and shows every node; the renderer lists their
    # values, and stops at some depth and at a tree it does not know.
    def in_live(ydoc)
      xml = ydoc.read_xml(ROOT).to_s
      shown = xml.scan(NODE_TAG).size
      has_frontmatter = xml.include?(FRONTMATTER_TAG)
      return {} if shown.zero? && !has_frontmatter

      values, written, frontmatter_html = live_nodes(ydoc, xml)
      raise Unreadable unless values.size + written == shown

      tally_live(values).merge(frontmatter_html)
    end

    # The markup of literals, without the text beside it: Markdown can join a
    # line of text to an HTML block.
    def markup(literals)
      literals.each_with_object(Markup.new) do |(literal, count), result|
        if literal.is_a?(Array) && literal.first == :frontmatter
          result[literal] += count
        else
          found, unclosed = pieces_with_unclosed(literal)
          found.each { |item| result[item] += count }
          unclosed.each { |tag| result.unclosed[tag] += count }
        end
      end
    end

    def more_markup(after, before)
      allowed = before.dup
      unclosed = after.respond_to?(:unclosed) ? after.unclosed : {}
      before_tags = Hash.new(0)
      before.each do |piece, count|
        next unless piece.is_a?(Array) && piece.first != "comment" && piece.first != :frontmatter

        before_tags[piece.first] += count
      end
      unclosed.each do |tag, count|
        credit = [ count, before_tags[tag] ].min
        next if credit <= 0

        closing = "</#{tag}>"
        allowed[closing] = allowed.fetch(closing, 0) + credit
      end
      more(after, allowed)
    end

    def more(after, before)
      after.filter_map { |piece, count| [ piece, count - before.fetch(piece, 0) ] if count > before.fetch(piece, 0) }.to_h
    end

    def most(*counts) = counts.reduce({}) { |all, count| all.merge(count) { |_piece, one, other| [ one, other ].max } }

    private

    def sanitize_encoding(source)
      source.to_s.encode(Encoding::UTF_8, invalid: :replace, undef: :replace, replace: "\uFFFD").scrub("\uFFFD")
    end

    # Commonmarker and the editor's parser differ in a few places, so the source
    # is also read the way the editor sees it there. Line endings and lines of
    # spaces normalize for footnotes and front matter; front matter fences may
    # carry trailing spaces; after front matter that never closes, the editor
    # knows no lists or quotes; in a comment it allows dashes, and a comment
    # that never closes hides nothing that follows; table: false reads extra
    # body columns that Commonmarker's GFM table parser discards.
    def editor_readings(source)
      source = source.gsub(/\r\n?/, "\n").gsub(/^[ \t]+$/, "")
      normalized_fm = source.gsub(/^---[ \t]+$/, "---")
      root = Commonmarker.parse(normalized_fm, options: EDITOR)
      sources = []
      sources << source if normalized_fm != source
      if normalized_fm.match?(/\A---(?:\n|\z)/) && root.first_child&.type != :frontmatter
        sources << normalized_fm.gsub(/(?<=\n) {0,3}(?=[-+*>0-9])/, "x ")
      end
      if normalized_fm.include?("<!--")
        sources += [ normalized_fm, *sources ].flat_map { |text| [ text.gsub("<!--", "x!--"), plain_comments(text) ] }
      end
      readings = [
        literals(root),
        literals(Commonmarker.parse(normalized_fm, options: EDITOR_NO_TABLE))
      ]
      sources.each do |text|
        readings << literals(Commonmarker.parse(text, options: EDITOR))
        readings << literals(Commonmarker.parse(text, options: EDITOR_NO_TABLE))
      end
      readings
    end

    def plain_comments(source)
      source.gsub(/(<!)?-{2,}(>)?/) { "#{"<!--" if $1}#{"_" unless $2 && !$1}#{"-->" if $2}" }
    end

    def literals(root)
      kept = Hash.new(0)
      pending = [ root ]
      while (parent = pending.pop)
        stack = []
        child = parent.first_child
        while child
          case child.type
          when :html_block
            stripped = child.literal.strip
            kept[stripped.squish] += 1 unless pieces(stripped).empty?
          when :html_inline
            stripped = child.literal.strip
            if (tag = valid_editor_open_tag(stripped))
              stack << [ tag, stripped ]
            elsif stack.any? && stripped == EDITOR_END_TAG[stack.last.first]
              stack.pop
            elsif !pieces(stripped).empty?
              kept[stripped.squish] += 1
            end
          else
            pending << child if child.first_child
          end
          child = child.next_sibling
        end
        stack.each { |_tag, stripped| kept[stripped.squish] += 1 }
      end
      kept
    end

    # Real editor marks in Yjs are Y.XmlText formatting attributes, never html
    # nodes, so live html nodes only exempt empty-line <br /> placeholders.
    def tally_live(values)
      values.map(&:squish).tally.reject { |value, _count| value.empty? || EMPTY_LINES.include?(value) }
    end

    def frontmatter_html_for(raw)
      normalized = raw.to_s.gsub(/\r\n?/, "\n")
      found = Hash.new(0)
      normalized.each_line do |line|
        found[[ :frontmatter, :fence ]] += 1 if line.match?(FRONTMATTER_FENCE)
      end
      in_html(normalized).each do |item, count|
        found[[ :frontmatter, item ]] += count
      end
      found
    end

    def live_nodes(ydoc, xml)
      types = Y::ProseMirror.new(ydoc).node_types(ROOT) or raise Unreadable
      # Register every tag closed in read_xml as a mark so unknown marks stay
      # wrapped instead of letting adjacent text runs merge into "<html".
      closing_tags = xml.scan(%r{</([^<>]+)>}).flatten.uniq
      raise Unreadable if closing_tags.any? { |name| name.match?(/\s/) }

      marks = closing_tags.to_h do |name|
        attrs = MARK_ATTRS[name]
        [ name, attrs ? { tag: "span", attrs: } : { tag: "span" } ]
      end
      sentinel = SecureRandom.hex(8)
      marker = /#{sentinel}:(\d+):/
      values = []
      frontmatter_html = Hash.new(0)
      written = 0
      rules = types.keys.to_h do |type|
        [ type, { contains: :blocks, render: lambda { |node|
          max_child = 0
          if node.content.include?(sentinel)
            node.content.scan(marker) { max_child = [ max_child, Regexp.last_match(1).to_i ].max }
          end
          height = max_child + 1
          raise Unreadable if height >= MAX_LIVE_DEPTH

          if type == NODE
            value = node.attrs["value"]
            values << (value.is_a?(String) ? value : JSON.generate(value))
          elsif type == FRONTMATTER
            frontmatter_html_for(node.attrs["value"]).each do |key, count|
              frontmatter_html[key] += count
            end
          end
          node.attrs.each_value do |attribute|
            text = attribute.to_s
            written += text.scan(NODE_TAG).size if text.include?(NODE_TAG)
          end
          if node.content.include?("&lt;html") || node.content.include?(NODE_TAG)
            clean = node.content.gsub(marker, " ")
            DocumentHtml.parse(clean).xpath(".//text() | .//@*[starts-with(name(), 'data-')]").each do |item|
              content = item.is_a?(Nokogiri::XML::Attr) ? item.value : item.text
              written += content.scan(NODE_TAG).size if content.include?(NODE_TAG)
            end
          end
          "#{sentinel}:#{height}:"
        } } ]
      end
      Y::ProseMirror.new(ydoc, nodes: rules, marks:).to_html(ROOT) or raise Unreadable
      [ values, written, frontmatter_html ]
    rescue SystemStackError, DocumentHtml::TooComplex
      raise Unreadable
    end

    def pieces(literal)
      pieces_with_unclosed(literal).first
    end

    def pieces_with_unclosed(literal)
      literal = literal.strip
      return [ [], [] ] if literal.empty? || EMPTY_LINES.include?(literal)
      if (match = literal.match(%r{\A</([a-zA-Z][a-zA-Z0-9-]*)\s*>\z}))
        return [ [ "</#{match[1].downcase}>" ], [] ]
      end
      return [ [ literal.squish ], [] ] if literal.match?(/<\/template\b/i)

      doc = DocumentHtml.parse("<template>#{literal}</template>", max_errors: 10)
      found = doc.xpath("descendant::* | descendant::comment()").drop(1)
      return [ [ literal.squish ], [] ] if found.empty?

      unclosed = []
      unclosed_seen = false
      doc.errors.each do |error|
        headline = error.message.lines.first.to_s.strip.sub(/\A\d+:\d+:\s*ERROR:\s*/, "")
        if !unclosed_seen && (match = headline.match(TEMPLATE_UNCLOSED_ERROR))
          unclosed_seen = true
          unclosed = match[1].split(", ")
        elsif headline.match?(INVALID_TAG_FIRST_CHAR) && found.none?(&:comment?)
          next
        else
          return [ [ literal.squish ], [] ]
        end
      end

      [ found.map { |node| piece(node) }, unclosed ]
    rescue DocumentHtml::TooComplex
      [ [ literal.squish ], [] ]
    end

    def piece(node)
      return [ "comment", node.content ] if node.comment?

      [ node.name, node.attribute_nodes.map { |attribute| [ attribute.name, attribute.value ] }.sort,
        (node.content if RAW_CONTENT_ELEMENTS.include?(node.name)) ]
    end

    def valid_editor_open_tag(literal)
      if (match = literal.match(PROVENANCE_OPEN))
        kind, author, state = match.captures
        return "span" if HtmlDocumentSanitizer::PROVENANCE_KINDS.include?(kind) &&
                         HtmlDocumentSanitizer::PROVENANCE_STATES.include?(state) &&
                         author.to_s.length <= HtmlDocumentSanitizer::MAX_AUTHOR_LENGTH
      elsif (match = literal.match(HIGHLIGHTER_OPEN))
        return "span" if HighlightPalette::COLOR_IDS.include?(match[1])
      elsif (match = literal.match(SUGGESTION_OPEN))
        tag, suggestion_id, author = match.captures
        return tag if suggestion_id.length <= HtmlDocumentSanitizer::MAX_SUGGESTION_ID_LENGTH &&
                      author.to_s.length <= HtmlDocumentSanitizer::MAX_AUTHOR_LENGTH
      end
      nil
    end
  end
end
