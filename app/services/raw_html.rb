class RawHtml
  class Unreadable < StandardError; end

  PREVIEW = { header_ids: nil }.freeze
  EDITOR = {
    parse: { leave_footnote_definitions: true },
    extension: { header_ids: nil, footnotes: true, front_matter_delimiter: "---" }
  }.freeze

  EMPTY_LINES = [ "<br />", "<br>", "<br >", "<br/>" ].freeze
  EDITOR_END_TAG = { "span" => "</span>", "ins" => "</ins>", "del" => "</del>" }.freeze
  RAW_CONTENT_ELEMENTS = %w[script style textarea title iframe noscript noembed noframes xmp plaintext].freeze

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
      source = source.to_s.encode(Encoding::UTF_8, invalid: :replace, undef: :replace, replace: "\uFFFD").scrub("\uFFFD")
      return {} unless source.include?("<")

      most(literals(DocumentMarkdown.parse(source, extension: PREVIEW)), *editor_readings(source))
    end

    def in_html(source)
      source = source.to_s
      return {} unless source.include?("<")

      nodes(source).map { |node| piece(node) }.tally
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

      most(tally_live(values), frontmatter_html)
    end

    # The markup of literals, without the text beside it: Markdown can join a
    # line of text to an HTML block.
    def markup(literals)
      literals.each_with_object(Hash.new(0)) do |(literal, count), markup|
        pieces(literal).each { |piece| markup[piece] += count }
      end
    end

    def more_markup(after, before)
      allowed = before.dup
      before.each do |piece, count|
        next unless piece.is_a?(Array) && piece.first != "comment"

        closing = "</#{piece.first}>"
        allowed[closing] = allowed.fetch(closing, 0) + count
      end
      more(after, allowed)
    end

    def more(after, before)
      after.filter_map { |piece, count| [ piece, count - before.fetch(piece, 0) ] if count > before.fetch(piece, 0) }.to_h
    end

    def most(*counts) = counts.reduce({}) { |all, count| all.merge(count) { |_piece, one, other| [ one, other ].max } }

    private

    # Commonmarker and the editor's parser differ in a few places, so the source
    # is also read the way the editor sees it there. Line endings and lines of
    # spaces normalize for footnotes and front matter; front matter fences may
    # carry trailing spaces; after front matter that never closes, the editor
    # knows no lists or quotes; in a comment it allows dashes, and a comment
    # that never closes hides nothing that follows.
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
      [ literals(root), *sources.map { |text| literals(Commonmarker.parse(text, options: EDITOR)) } ]
    end

    def plain_comments(source)
      source.gsub(/(<!)?-{2,}(>)?/) { "#{"<!--" if $1}#{"_" unless $2 && !$1}#{"-->" if $2}" }
    end

    def literals(root)
      found = []
      pending = [ root ]
      while (node = pending.pop)
        found << node.literal if %i[html_block html_inline].include?(node.type)
        child = node.first_child
        while child
          pending << child
          child = child.next_sibling
        end
      end
      tally_markdown(found)
    end

    def tally_markdown(values)
      editor_opens = Hash.new(0)
      kept = Hash.new(0)
      values.map(&:strip).tally.each do |stripped, count|
        if (tag = valid_editor_open_tag(stripped))
          editor_opens[tag] += count
        elsif !pieces(stripped).empty?
          kept[stripped.squish] += count
        end
      end
      editor_opens.each do |tag, open_count|
        closing = EDITOR_END_TAG.fetch(tag)
        next unless kept.key?(closing)

        remaining = kept[closing] - open_count
        if remaining > 0
          kept[closing] = remaining
        else
          kept.delete(closing)
        end
      end
      kept
    end

    # Real editor marks in Yjs are Y.XmlText formatting attributes, never html
    # nodes, so live html nodes only exempt empty-line <br /> placeholders.
    def tally_live(values)
      values.map(&:squish).tally.reject { |value, _count| value.empty? || EMPTY_LINES.include?(value) }
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
      frontmatter_html = {}
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
            fm_html = in_markdown(node.attrs["value"].to_s)
            frontmatter_html = most(frontmatter_html, fm_html) if fm_html.any?
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
      literal = literal.strip
      return [] if literal.empty? || EMPTY_LINES.include?(literal)
      return [] if valid_editor_open_tag(literal)
      if (match = literal.match(/\A<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>\z/))
        return [ "</#{match[1].downcase}>" ]
      end

      found = nodes(literal)
      return [ literal.squish ] if found.empty?

      found.map { |node| piece(node) }
    rescue DocumentHtml::TooComplex
      [ literal.squish ]
    end

    # A template takes any element, as a table cell.
    def nodes(html) = DocumentHtml.parse("<template>#{html}</template>").xpath("descendant::* | descendant::comment()").drop(1)

    def piece(node)
      return [ "comment", node.content ] if node.comment?

      [ node.name, node.attribute_nodes.map { |attribute| [ attribute.name, attribute.value ] }.sort,
        (node.content if RAW_CONTENT_ELEMENTS.include?(node.name)) ]
    end

    def valid_editor_open_tag(literal)
      return nil if literal.include?("\n") || !literal.match?(/\A<(?:span|ins|del)\b[^>]*>\z/i)

      found = nodes(literal)
      return nil unless found.size == 1 && editor_markup?(found.first)

      found.first.name
    rescue DocumentHtml::TooComplex
      nil
    end

    def editor_markup?(node)
      names = node.attribute_nodes.map(&:name)
      case node.name
      when "span"
        valid_provenance?(node, names) || valid_highlighter?(node, names)
      when "ins", "del"
        valid_suggestion?(node, names)
      else
        false
      end
    end

    def valid_provenance?(node, names)
      names.any? &&
        names.all? { |name| HtmlDocumentSanitizer::PROVENANCE_ATTRIBUTES.include?(name) } &&
        !node["data-provenance"].nil? &&
        HtmlDocumentSanitizer::PROVENANCE_KINDS.include?(node["data-kind"]) &&
        HtmlDocumentSanitizer::PROVENANCE_STATES.include?(node["data-state"]) &&
        node["data-author"].to_s.length <= HtmlDocumentSanitizer::MAX_AUTHOR_LENGTH
    end

    def valid_highlighter?(node, names)
      names.any? &&
        names.all? { |name| HtmlDocumentSanitizer::HIGHLIGHTER_ATTRIBUTES.include?(name) } &&
        !node["data-highlighter"].nil? &&
        HighlightPalette::COLOR_IDS.include?(node["data-color"])
    end

    def valid_suggestion?(node, names)
      suggestion_id = node["data-suggestion-id"].to_s
      names.any? &&
        names.all? { |name| HtmlDocumentSanitizer::SUGGESTION_ATTRIBUTES.include?(name) } &&
        suggestion_id.present? &&
        suggestion_id.length <= HtmlDocumentSanitizer::MAX_SUGGESTION_ID_LENGTH &&
        node["data-author"].to_s.length <= HtmlDocumentSanitizer::MAX_AUTHOR_LENGTH
    end
  end
end
