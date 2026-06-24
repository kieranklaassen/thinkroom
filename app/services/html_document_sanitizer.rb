require "uri"

class HtmlDocumentSanitizer
  Result = Data.define(:content, :changed?)

  TAGS = %w[
    p h1 h2 h3 h4 h5 h6 blockquote pre code br hr
    ul ol li strong b em i s del a img
    table thead tbody tr th td span ins
  ].freeze

  ATTRIBUTES = %w[
    href title src alt start style colspan rowspan colwidth
    data-language data-item-type data-label data-list-type data-spread data-checked
    data-is-header data-provenance data-kind data-author data-state data-suggestion-id
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
  THINKROOM_ATTRIBUTES = (PROVENANCE_ATTRIBUTES + SUGGESTION_ATTRIBUTES).uniq.freeze
  EXTERNAL_ATTRIBUTES = (ATTRIBUTES - THINKROOM_ATTRIBUTES).freeze

  class << self
    def external(source)
      sanitize(source, trusted_metadata: false)
    end

    def snapshot(source)
      sanitize(source, trusted_metadata: true)
    end

    private

    def sanitize(source, trusted_metadata:)
      original = source.to_s
      source_fragment = Nokogiri::HTML5.fragment(original)
      source_fragment.css(DROP_WITH_CONTENT.join(",")).remove
      sanitized = Rails::HTML5::SafeListSanitizer.new.sanitize(
        source_fragment.to_html,
        tags: TAGS,
        attributes: ATTRIBUTES
      ).to_s

      fragment = Nokogiri::HTML5.fragment(sanitized)
      fragment.traverse do |node|
        next unless node.element?

        sanitize_style(node)
        sanitize_image(node)
        sanitize_thinkroom_metadata(node, trusted: trusted_metadata)
      end

      content = fragment.to_html
      Result.new(content:, changed?: content != original)
    end

    def sanitize_style(node)
      style = node["style"]
      return unless style

      if %w[td th].include?(node.name) && (match = ALIGNMENT.match(style))
        node["style"] = "text-align: #{match[1].downcase}"
      else
        node.remove_attribute("style")
      end
    end

    def sanitize_image(node)
      return unless node.name == "img"

      node.remove unless valid_active_storage_src?(node["src"])
    end

    def sanitize_thinkroom_metadata(node, trusted:)
      metadata = THINKROOM_ATTRIBUTES.to_h { |attribute| [ attribute, node[attribute] ] }
      strip_thinkroom_metadata(node)
      return unless trusted

      restore_provenance(node, metadata) if valid_provenance?(node, metadata)
      restore_suggestion(node, metadata) if valid_suggestion?(node, metadata)
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
      %w[ins del].include?(node.name) &&
        suggestion_id.present? &&
        suggestion_id.length <= MAX_SUGGESTION_ID_LENGTH &&
        metadata["data-author"].to_s.length <= MAX_AUTHOR_LENGTH
    end

    def restore_suggestion(node, metadata)
      node["data-suggestion-id"] = metadata["data-suggestion-id"]
      node["data-author"] = metadata["data-author"].to_s
    end

    def strip_thinkroom_metadata(node)
      THINKROOM_ATTRIBUTES.each { |attribute| node.remove_attribute(attribute) }
    end
  end
end
