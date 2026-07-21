# The fixed 10-color highlighter palette. Ids must stay in sync with
# HIGHLIGHT_COLORS in app/frontend/editor/highlighter/palette.ts — they gate
# what the HTML sanitizer trusts and which legend names may be persisted.
module HighlightPalette
  COLOR_IDS = %w[yellow green blue pink purple orange teal red gray brown].freeze
  MAX_NAME_LENGTH = 64

  class << self
    # Legend names are hostile input (any writer can send them): keys must be
    # palette colors and values are squished, capped strings. Blank names
    # clear the entry. => { "yellow" => "Urgent" } or nil when nothing valid
    # was submitted.
    def sanitize_names(raw)
      names = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw
      return nil unless names.is_a?(Hash)

      cleaned = names.filter_map do |key, value|
        next unless COLOR_IDS.include?(key.to_s)

        [ key.to_s, value.to_s.squish.first(MAX_NAME_LENGTH) ]
      end.to_h

      cleaned.empty? ? nil : cleaned
    end

    # Merge sanitized incoming names into the stored map; blank names delete.
    def merge_names(existing, incoming)
      existing = existing.is_a?(Hash) ? existing : {}
      incoming.each_with_object(existing.dup) do |(color, name), merged|
        if name.blank?
          merged.delete(color)
        else
          merged[color] = name
        end
      end
    end
  end
end
