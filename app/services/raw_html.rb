# Whether content holds raw HTML. A source or a live document that cannot be
# read completely counts as holding it.
class RawHtml
  class Unreadable < StandardError; end

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

  PROVENANCE_OPEN = /\A<span[ \t]+data-provenance(?:="")?[ \t]+data-kind="([^"]*)"(?:[ \t]+data-author="([^"]*)")?[ \t]+data-state="([^"]*)"[ \t]*>\z/
  HIGHLIGHTER_OPEN = /\A<span[ \t]+data-highlighter(?:="")?[ \t]+data-color="([^"]*)"[ \t]*>\z/
  SUGGESTION_OPEN = /\A<(ins|del)[ \t]+data-suggestion-id="([^"]+)"(?:[ \t]+data-author="([^"]*)")?[ \t]*>\z/

  ROOT = "prosemirror"
  NODE = "html"
  FRONTMATTER = "frontmatter"
  MAX_LIVE_DEPTH = 1_000

  class << self
    def in_markdown?(source)
      source = sanitize_encoding(source)
      return false unless source.include?("<")

      html?(DocumentMarkdown.parse(source, extension: PREVIEW)) || editor_html?(source)
    rescue StandardError, SystemStackError
      true
    end

    # Reading the tree as text shows every node by its name, so a tree that
    # names neither node holds no HTML. The walk tells a node from text.
    def in_live?(ydoc)
      xml = ydoc.read_xml(ROOT).to_s
      return false unless xml.include?("<#{NODE}") || xml.include?("<#{FRONTMATTER}")

      html_node?(ydoc)
    rescue StandardError, SystemStackError
      true
    end

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
    def editor_html?(source)
      source = source.gsub(/\r\n?/, "\n").gsub(/^[ \t]+$/, "")
      normalized_fm = source.gsub(/^---[ \t]+$/, "---")
      sources = []
      sources << source if normalized_fm != source
      if normalized_fm.match?(/\A---(?:\n|\z)/) &&
         Commonmarker.parse(normalized_fm, options: EDITOR).first_child&.type != :frontmatter
        sources << normalized_fm.gsub(/(?<=\n) {0,3}(?=[-+*>0-9])/, "x ")
      end
      if normalized_fm.include?("<!--")
        sources += [ normalized_fm, *sources ].flat_map { |text| [ text.gsub("<!--", "x!--"), plain_comments(text) ] }
      end
      [ normalized_fm, *sources ].any? do |text|
        [ EDITOR, EDITOR_NO_TABLE ].any? { |options| html?(Commonmarker.parse(text, options:)) }
      end
    end

    def plain_comments(source)
      source.gsub(/(<!)?-{2,}(>)?/) { "#{"<!--" if $1}#{"_" unless $2 && !$1}#{"-->" if $2}" }
    end

    def html?(root)
      pending = [ root ]
      while (parent = pending.pop)
        open_tags = []
        child = parent.first_child
        while child
          case child.type
          when :html_block
            return true unless empty_line?(child.literal)
          when :html_inline
            literal = child.literal.strip
            if (tag = valid_editor_open_tag(literal))
              # The editor ends a tracked change at the first closing tag.
              return true if tag != "span" && open_tags.include?(tag)

              open_tags << tag
            elsif open_tags.any? && literal == EDITOR_END_TAG[open_tags.last]
              open_tags.pop
            elsif !empty_line?(literal)
              return true
            end
          else
            pending << child if child.first_child
          end
          child = child.next_sibling
        end
        return true if open_tags.any?
      end
      false
    end

    def empty_line?(value) = EMPTY_LINES.include?(value.to_s.strip)

    # The reader stops at some depth without saying so. Each node reports its
    # height to its parent, and a tree near that depth is not read.
    def html_node?(ydoc)
      types = Y::ProseMirror.new(ydoc).node_types(ROOT) or raise Unreadable
      mark = SecureRandom.hex(8)
      found = false
      rules = types.keys.to_h do |type|
        [ type, { contains: :blocks, render: lambda { |node|
          height = 1 + node.content.scan(/#{mark}:(\d+):/).map { |match| match.first.to_i }.max.to_i
          raise Unreadable if height >= MAX_LIVE_DEPTH

          found ||= case type
          when NODE then !empty_line?(node.attrs["value"])
          when FRONTMATTER then frontmatter_html?(node.attrs["value"])
          end
          "#{mark}:#{height}:"
        } } ]
      end
      Y::ProseMirror.new(ydoc, nodes: rules).to_html(ROOT) or raise Unreadable
      found
    end

    # The preview reads front matter as Markdown, so a value that swallows what
    # follows it changes how the rest of the document reads.
    def frontmatter_html?(value)
      return true unless value.is_a?(String)

      source = "---\n#{value}\n---\n"
      last = DocumentMarkdown.parse(sanitize_encoding("#{source}\nend\n"), extension: PREVIEW).each.to_a.last
      last.type != :paragraph || in_markdown?(source)
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
