require "uri"

class HtmlDocumentSanitizer
  Result = Data.define(:content, :changed?)

  TAGS = %w[
    p h1 h2 h3 h4 h5 h6 blockquote pre code br hr
    ul ol li strong b em i s del a img
    table thead tbody tr th td span ins figure figcaption
  ].freeze

  ATTRIBUTES = %w[
    href title src alt start style colspan rowspan colwidth
    data-language data-item-type data-label data-list-type data-spread data-checked
    data-is-header data-provenance data-kind data-author data-state data-suggestion-id
    data-thinkroom-sketch data-sketch-id data-sketch-height data-scene data-description data-format-version
    data-highlighter data-color
  ].freeze

  PROVENANCE_KINDS = %w[human ai].freeze
  PROVENANCE_STATES = %w[verbatim pending reviewed endorsed].freeze
  ACTIVE_STORAGE_PATH = %r{
    \A/rails/active_storage/
    (?:
      blobs/(?:redirect|proxy)|
      representations/(?:redirect|proxy)|
      disk
    )/
  }x.freeze
  ALIGNMENT = /\A\s*text-align:\s*(left|center|right)\s*;?\s*\z/i
  MAX_AUTHOR_LENGTH = 255
  MAX_SUGGESTION_ID_LENGTH = 255
  DROP_WITH_CONTENT = %w[script style iframe object embed template svg math].freeze
  PROVENANCE_ATTRIBUTES = %w[data-provenance data-kind data-author data-state].freeze
  SUGGESTION_ATTRIBUTES = %w[data-suggestion-id data-author].freeze
  SKETCH_ATTRIBUTES = %w[
    data-thinkroom-sketch data-sketch-id data-sketch-height data-scene data-description data-format-version
  ].freeze
  HIGHLIGHTER_ATTRIBUTES = %w[data-highlighter data-color].freeze
  THINKROOM_ATTRIBUTES = (
    PROVENANCE_ATTRIBUTES + SUGGESTION_ATTRIBUTES + SKETCH_ATTRIBUTES + HIGHLIGHTER_ATTRIBUTES
  ).uniq.freeze
  EXTERNAL_ATTRIBUTES = (ATTRIBUTES - THINKROOM_ATTRIBUTES).freeze

  ALLOWED_TAGS = TAGS.to_set.freeze
  ALLOWED_ATTRIBUTES = ATTRIBUTES.to_set.freeze
  EXTERNAL_ALLOWED_ATTRIBUTES = EXTERNAL_ATTRIBUTES.to_set.freeze
  DROP_WITH_CONTENT_SET = DROP_WITH_CONTENT.to_set.freeze
  THINKROOM_ATTRIBUTES_SET = THINKROOM_ATTRIBUTES.to_set.freeze
  ALIGNMENT_TAGS = %w[td th].to_set.freeze
  SUGGESTION_TAGS = %w[ins del].to_set.freeze
  # Disallowed HTML5 button-scope barriers whose in-place unwrapping can expose
  # illegal nesting (such as <table> inside <p> or nested <a>), requiring a
  # canonical HTML5 re-parse on that rare slow path.
  BUTTON_SCOPE_BARRIERS = %w[button marquee applet].to_set.freeze

  # Scrubs a Nokogiri::HTML5::DocumentFragment directly in a single pass using
  # Loofah::HTML5::Scrub for URI, CDATA, CSS, and attribute escaping, avoiding
  # Loofah's per-node decorator overhead and redundant parse/serialize cycles.
  class Scrubber
    def initialize(trusted_metadata:)
      @tags = ALLOWED_TAGS
      @attributes = trusted_metadata ? ALLOWED_ATTRIBUTES : EXTERNAL_ALLOWED_ATTRIBUTES
      @trusted_metadata = trusted_metadata
    end

    def scrub_fragment(fragment)
      reparse = scrub_children(fragment)
      reparse ? DocumentHtml.parse(fragment.to_html) : fragment
    end

    private

    def scrub_children(parent)
      reparse = false
      node = parent.child
      while node
        next_node = node.next_sibling
        reparse = true if scrub_node_tree(node)
        node = next_node
      end
      reparse
    end

    def scrub_node_tree(node)
      case node.type
      when Nokogiri::XML::Node::TEXT_NODE
        false
      when Nokogiri::XML::Node::ELEMENT_NODE
        name = node.name
        if DROP_WITH_CONTENT_SET.include?(name) || node.namespace
          node.remove
          return false
        end

        reparse = scrub_children(node)

        unless @tags.include?(name)
          reparse = true if BUTTON_SCOPE_BARRIERS.include?(name) && node.first_element_child
          unwrap_node(node)
          return reparse
        end

        scrub_allowed_element(node, name)
        reparse
      when Nokogiri::XML::Node::CDATA_SECTION_NODE
        node.replace(Loofah::HTML5::Scrub.cdata_escape(node))
        false
      else
        node.remove
        false
      end
    end

    def unwrap_node(node)
      child = node.child
      while child
        next_child = child.next_sibling
        node.add_previous_sibling(child)
        child = next_child
      end
      node.remove
    end

    def scrub_allowed_element(node, name)
      attrs = node.attribute_nodes
      if attrs.empty?
        node.remove if name == "img"
        return
      end

      style_attr = nil
      has_thinkroom_attr = false
      needs_escaping = false

      attrs.each do |attr|
        attr_name = attr.name
        unless @attributes.include?(attr_name)
          attr.remove
          next
        end

        if attr_name == "style"
          style_attr = attr
          next
        end

        has_thinkroom_attr = true if @trusted_metadata && THINKROOM_ATTRIBUTES_SET.include?(attr_name)

        prefixed = Loofah::HTML5::Scrub.prefixed_attribute_name(attr)
        next if Loofah::HTML5::Scrub.scrub_attribute_value(node, attr, prefixed)

        if prefixed == "src" && !attr.value.match?(/[^[:space:]]/)
          attr.remove
          next
        end

        needs_escaping = true if Loofah::LibxmlWorkarounds::BROKEN_ESCAPING_ATTRIBUTES.include?(attr_name)
      end

      Loofah::HTML5::Scrub.force_correct_attribute_escaping!(node) if needs_escaping
      sanitize_style_attribute(name, style_attr) if style_attr

      if name == "img" && !valid_active_storage_src?(node["src"])
        node.remove
        return
      end

      sanitize_thinkroom_metadata(node) if has_thinkroom_attr
    end

    def sanitize_style_attribute(name, style_attr)
      if ALIGNMENT_TAGS.include?(name)
        value = style_attr.value
        match = ALIGNMENT.match(value) || ALIGNMENT.match(Loofah::HTML5::Scrub.scrub_css(value))
        if match
          style_attr.value = "text-align: #{match[1].downcase}"
          return
        end
      end

      style_attr.remove
    end

    def sanitize_thinkroom_metadata(node)
      metadata = {}
      node.attribute_nodes.each do |attr|
        next unless THINKROOM_ATTRIBUTES_SET.include?(attr.name)

        metadata[attr.name] = attr.value
        attr.remove
      end
      return if metadata.empty?

      restore_provenance(node, metadata) if valid_provenance?(node, metadata)
      restore_suggestion(node, metadata) if valid_suggestion?(node, metadata)
      restore_sketch(node, metadata) if valid_sketch?(node, metadata)
      restore_highlighter(node, metadata) if valid_highlighter?(node, metadata)
    end

    def valid_active_storage_src?(source)
      source = source.to_s
      return false if source.blank? || source.include?("\\") || source.match?(/%(?:2f|5c)/i)

      uri = URI.parse(source)
      return false if uri.scheme || uri.host || uri.userinfo || uri.query || uri.fragment

      decoded_path = URI::DEFAULT_PARSER.unescape(uri.path.to_s)
      return false if decoded_path.split("/").any? { |segment| %w[. ..].include?(segment) }

      decoded_path.match?(ACTIVE_STORAGE_PATH)
    rescue URI::InvalidURIError
      false
    end

    def valid_provenance?(node, metadata)
      node.name == "span" &&
        !metadata["data-provenance"].nil? &&
        PROVENANCE_KINDS.include?(metadata["data-kind"]) &&
        PROVENANCE_STATES.include?(metadata["data-state"]) &&
        metadata["data-author"].to_s.length <= MAX_AUTHOR_LENGTH
    end

    def restore_provenance(node, metadata)
      node["data-provenance"] = ""
      node["data-kind"] = metadata["data-kind"]
      node["data-author"] = metadata["data-author"].to_s
      node["data-state"] = metadata["data-state"]
    end

    def valid_suggestion?(node, metadata)
      suggestion_id = metadata["data-suggestion-id"].to_s
      SUGGESTION_TAGS.include?(node.name) &&
        suggestion_id.present? &&
        suggestion_id.length <= MAX_SUGGESTION_ID_LENGTH &&
        metadata["data-author"].to_s.length <= MAX_AUTHOR_LENGTH
    end

    def restore_suggestion(node, metadata)
      node["data-suggestion-id"] = metadata["data-suggestion-id"]
      node["data-author"] = metadata["data-author"].to_s
    end

    def valid_sketch?(node, metadata)
      return false unless node.name == "figure" && !metadata["data-thinkroom-sketch"].nil?
      return false unless metadata["data-sketch-id"].to_s.match?(/\A[a-zA-Z0-9_-]{1,100}\z/)
      height = metadata["data-sketch-height"].to_s
      return false if height.present? && !height.match?(/\A(?:1[89]\d|[2-9]\d{2}|1[01]\d{2}|1200)\z/)

      ThinkroomSketch.parse(
        metadata["data-scene"],
        description: metadata["data-description"],
        format_version: metadata["data-format-version"]
      ).present?
    end

    def restore_sketch(node, metadata)
      SKETCH_ATTRIBUTES.each do |attribute|
        node[attribute] = metadata[attribute].to_s
      end
      node["data-thinkroom-sketch"] = ""
      node["data-format-version"] = ThinkroomSketch::FORMAT_VERSION.to_s
    end

    def valid_highlighter?(node, metadata)
      node.name == "span" &&
        !metadata["data-highlighter"].nil? &&
        HighlightPalette::COLOR_IDS.include?(metadata["data-color"])
    end

    def restore_highlighter(node, metadata)
      node["data-highlighter"] = ""
      node["data-color"] = metadata["data-color"]
    end
  end

  TRUSTED_SCRUBBER = Scrubber.new(trusted_metadata: true).freeze
  EXTERNAL_SCRUBBER = Scrubber.new(trusted_metadata: false).freeze

  private_constant :ALLOWED_TAGS, :ALLOWED_ATTRIBUTES, :EXTERNAL_ALLOWED_ATTRIBUTES,
                   :DROP_WITH_CONTENT_SET, :THINKROOM_ATTRIBUTES_SET,
                   :ALIGNMENT_TAGS, :SUGGESTION_TAGS, :BUTTON_SCOPE_BARRIERS,
                   :Scrubber, :TRUSTED_SCRUBBER, :EXTERNAL_SCRUBBER

  class << self
    def external(source)
      DocumentHtml.within_limits { sanitize(source, trusted_metadata: false) }
    end

    def snapshot(source)
      DocumentHtml.within_limits { sanitize(source, trusted_metadata: true) }
    end

    # Parses and scrubs a trusted snapshot into a Nokogiri::HTML5::DocumentFragment
    # without serializing to HTML, allowing DocumentPreviewHtml to transform the
    # same tree in-place instead of round-tripping through HTML again.
    # An optional block runs on the parsed fragment right before scrubbing.
    def snapshot_fragment(source)
      DocumentHtml.within_limits do
        fragment = DocumentHtml.parse(source.to_s)
        yield fragment if block_given?
        TRUSTED_SCRUBBER.scrub_fragment(fragment)
      end
    end

    private

    def sanitize(source, trusted_metadata:)
      original = source.to_s
      return Result.new(content: "", changed?: false) if original.empty?

      fragment = DocumentHtml.parse(original)
      scrubber = trusted_metadata ? TRUSTED_SCRUBBER : EXTERNAL_SCRUBBER
      fragment = scrubber.scrub_fragment(fragment)

      content = fragment.to_html
      Result.new(content:, changed?: content != original)
    end
  end
end
