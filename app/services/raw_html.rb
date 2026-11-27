# The HTML in a document's source or live state, as counts of each piece, so a
# write can be compared with what is already there.
class RawHtml
  # A live tree that holds HTML and was not read completely.
  class Unreadable < StandardError; end

  # The page shows Markdown in two readings: the preview's, and the editor's,
  # which also knows front matter and footnotes and has no table limit.
  PREVIEW = { header_ids: nil }.freeze
  EDITOR = {
    parse: { leave_footnote_definitions: true },
    extension: { header_ids: nil, footnotes: true, front_matter_delimiter: "---" }
  }.freeze

  # What the editor itself writes into Markdown: an empty line, and the ends of
  # its own spans and tracked changes.
  EMPTY_LINES = [ "<br />", "<br>", "<br >", "<br/>" ].freeze
  ENDS = %w[</span> </ins> </del>].freeze
  EDITOR_MARKUP = {
    "span" => [ HtmlDocumentSanitizer::PROVENANCE_ATTRIBUTES, HtmlDocumentSanitizer::HIGHLIGHTER_ATTRIBUTES ],
    "ins" => [ HtmlDocumentSanitizer::SUGGESTION_ATTRIBUTES ],
    "del" => [ HtmlDocumentSanitizer::SUGGESTION_ATTRIBUTES ]
  }.freeze

  # Elements whose content is not text.
  OPAQUE = %w[script style textarea title iframe noscript noembed noframes xmp plaintext].freeze

  ROOT = "prosemirror"
  NODE = "html"
  NODE_TAG = "<html"
  MAX_LIVE_DEPTH = 512

  class << self
    # Each piece of raw HTML as written.
    def in_markdown(source)
      source = source.to_s.encode(Encoding::UTF_8, invalid: :replace, undef: :replace, replace: "�").scrub("�")
      most(literals(DocumentMarkdown.parse(source, extension: PREVIEW)), *editor_readings(source))
    end

    # The elements and comments of a HTML body.
    def in_html(source) = nodes(source.to_s).map { |node| piece(node) }.tally

    # Each raw HTML node's value in the live document. Reading the tree as text
    # is complete and cheap, and shows every node; the renderer lists their
    # values, and stops at some depth and at a tree it does not know.
    def in_live(ydoc)
      xml = ydoc.read_xml(ROOT).to_s
      shown = xml.scan(NODE_TAG).size
      return {} if shown.zero?

      values, written = live_nodes(ydoc, xml)
      raise Unreadable unless values.size + written == shown

      tally(values)
    end

    # The markup of literals, without the text beside it: Markdown can join a
    # line of text to an HTML block.
    def markup(literals)
      literals.each_with_object(Hash.new(0)) do |(literal, count), markup|
        pieces(literal).each { |piece| markup[piece] += count }
      end
    end

    # What markup `after` has more of. The end of an element that is there can
    # be a literal of its own.
    def more_markup(after, before)
      ends = before.keys.grep(Array).map { |piece| "</#{piece.first}>" }
      more(after, before).except(*ends)
    end

    # What `after` has more of than `before`.
    def more(after, before)
      after.filter_map { |piece, count| [ piece, count - before.fetch(piece, 0) ] if count > before.fetch(piece, 0) }.to_h
    end

    # The larger count of each piece.
    def most(*counts) = counts.reduce({}) { |all, count| all.merge(count) { |_piece, one, other| [ one, other ].max } }

    private

    # Commonmarker and the editor's parser differ in three places, so the source
    # is also read the way the editor sees it there. A line of spaces is an empty
    # line in a footnote, too. After front matter that never closes, the editor
    # knows no lists or quotes. In a comment it allows dashes, and a comment that
    # never closes hides nothing that follows.
    def editor_readings(source)
      source = source.gsub(/^[ \t]+(?=\r?$)/, "")
      root = Commonmarker.parse(source, options: EDITOR)
      sources = []
      if source.match?(/\A---[ \t]*$/) && root.first_child&.type != :frontmatter
        sources << source.gsub(/(?<=\n|\r) {0,3}(?=[-+*>0-9])/, "x ")
      end
      sources += [ source, *sources ].flat_map { |text| [ text.gsub("<!--", "x!--"), plain_comments(text) ] } if source.include?("<!--")
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
      tally(found)
    end

    def tally(values) = values.map(&:squish).reject { |value| pieces(value).empty? }.tally

    def live_nodes(ydoc, xml)
      types = Y::ProseMirror.new(ydoc).node_types(ROOT) or raise Unreadable
      # Register every tag closed in read_xml as a mark so unknown marks stay
      # wrapped instead of letting adjacent text runs merge into "<html".
      marks = xml.scan(%r{</([^\s>]+)>}).flatten.uniq.to_h { |name| [ name, { tag: "span" } ] }
      sentinel = SecureRandom.hex(8)
      marker = /#{sentinel}:(\d+):/
      values = []
      written = 0
      rules = types.keys.to_h do |type|
        [ type, { contains: :blocks, render: lambda { |node|
          heights = node.content.scan(marker).map { |match| match.first.to_i }
          height = (heights.max || 0) + 1
          raise Unreadable if height >= MAX_LIVE_DEPTH

          value = node.attrs["value"]
          values << (value.is_a?(String) ? value : JSON.generate(value)) if type == NODE
          node.attrs.each_value { |attribute| written += attribute.to_s.scan(NODE_TAG).size }
          clean = node.content.gsub(marker, " ")
          if clean.include?("html")
            DocumentHtml.parse(clean).xpath(".//text()").each { |text| written += text.text.scan(NODE_TAG).size }
          end
          "#{sentinel}:#{height}:"
        } } ]
      end
      Y::ProseMirror.new(ydoc, nodes: rules, marks:).to_html(ROOT) or raise Unreadable
      [ values, written ]
    rescue SystemStackError, DocumentHtml::TooComplex
      raise Unreadable
    end

    def pieces(literal)
      literal = literal.strip
      return [] if literal.empty? || EMPTY_LINES.include?(literal) || ENDS.include?(literal)

      found = nodes(literal)
      return [ literal.squish ] if found.empty?

      found.reject { |node| editor_markup?(node) }.map { |node| piece(node) }
    rescue DocumentHtml::TooComplex
      [ literal.squish ]
    end

    # A template takes any element, as a table cell.
    def nodes(html) = DocumentHtml.parse("<template>#{html}</template>").xpath("descendant::* | descendant::comment()").drop(1)

    def piece(node)
      return [ "comment", node.content ] if node.comment?

      [ node.name, node.attribute_nodes.map { |attribute| [ attribute.name, attribute.value ] }.sort,
        (node.content if OPAQUE.include?(node.name)) ]
    end

    def editor_markup?(node)
      names = node.attribute_nodes.map(&:name)
      EDITOR_MARKUP[node.name]&.any? { |allowed| names.any? && names.all? { |name| allowed.include?(name) } && node[allowed.first] }
    end
  end
end
