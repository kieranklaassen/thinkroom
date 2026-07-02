# Client-measured render geometry persisted on Document#render_hints —
# currently Mermaid figure heights keyed by an FNV-1a base36 hash of the
# diagram source. Owns both halves of the pipeline so their invariants hold
# by construction: sanitize (ingest) and merge (storage) share one cap, so a
# request's accepted hints can never evict themselves from storage.
class RenderHints
  # Hints are hostile input (client-measured pixels): namespace allowlist,
  # hash-shaped keys (FNV base36 of the diagram source), integer heights
  # within the figure's plausible on-screen range.
  KEY_PATTERN = /\A[a-z0-9]{1,13}\z/
  HEIGHT_RANGE = (96..2000)
  MAX_PER_NAMESPACE = 200

  class << self
    # => sanitized hints hash, or nil when nothing valid was submitted.
    def sanitize(raw)
      hints = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw
      return nil unless hints.is_a?(Hash)

      mermaid = hints["mermaid"]
      return nil unless mermaid.is_a?(Hash)

      cleaned = mermaid.filter_map do |key, value|
        next unless key.to_s.match?(KEY_PATTERN)

        height = Integer(value, exception: false)
        next unless height && HEIGHT_RANGE.cover?(height)

        [ key.to_s, height ]
      end.first(MAX_PER_NAMESPACE).to_h

      cleaned.empty? ? nil : { "mermaid" => cleaned }
    end

    # Keep at most MAX_PER_NAMESPACE entries per namespace, newest-wins:
    # re-measured hashes move to the tail, and hashes for since-deleted
    # diagrams eventually age out of the head.
    def merge(existing, incoming)
      incoming.each_with_object(existing.deep_dup) do |(namespace, hints), merged|
        current = merged[namespace].is_a?(Hash) ? merged[namespace] : {}
        combined = current.except(*hints.keys).merge(hints)
        merged[namespace] = combined.to_a.last(MAX_PER_NAMESPACE).to_h
      end
    end
  end
end
