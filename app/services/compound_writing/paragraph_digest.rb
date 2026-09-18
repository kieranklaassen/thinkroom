module CompoundWriting
  # A cheap fingerprint of the judged paragraphs that the browser can compute
  # identically (app/frontend/editor/paragraph_projection.ts): FNV-1a 32-bit
  # over the codepoints of every paragraph, with a unit separator between
  # paragraphs. Codepoints, not bytes or UTF-16 units, so both runtimes agree.
  module ParagraphDigest
    OFFSET = 0x811c9dc5
    PRIME = 0x01000193
    SEPARATOR = 0x1f

    module_function

    def of(texts)
      hash = OFFSET
      Array(texts).each_with_index do |text, index|
        hash = mix(hash, SEPARATOR) if index.positive?
        text.to_s.each_codepoint { |codepoint| hash = mix(hash, codepoint) }
      end
      hash.to_s(16).rjust(8, "0")
    end

    def mix(hash, value)
      ((hash ^ (value & 0xffffffff)) * PRIME) & 0xffffffff
    end
    private_class_method :mix
  end
end
