# Reports whether a markdown document's inline excalidraw fences were
# recognized as sketches. Recognition mirrors DocumentPlainText exactly — same
# Commonmarker render, same `pre[lang="excalidraw"] > code` selector, same
# ThinkroomSketch.parse arguments — so a "kept as a code block" warning on the
# create response fires precisely when plain_text would echo raw scene JSON.
class MarkdownSketchAudit
  Result = Data.define(:fence_count, :unrecognized_count) do
    def unrecognized? = unrecognized_count.positive?
  end

  class << self
    def call(content)
      source = content.to_s
      return Result.new(fence_count: 0, unrecognized_count: 0) if source.blank?

      html = Commonmarker.to_html(
        source,
        plugins: { table: true, strikethrough: true, tasklist: true }
      )
      fragment = Nokogiri::HTML5.fragment(html)

      fence_count = 0
      unrecognized_count = 0
      fragment.css('pre[lang="excalidraw"] > code').each do |node|
        fence_count += 1
        unrecognized_count += 1 unless recognized?(node.text)
      end

      Result.new(fence_count:, unrecognized_count:)
    end

    private

    # True only when the fence parses to the same Sketch ThinkroomSketch.parse
    # would accept — the single recognition authority shared with the renderer.
    def recognized?(source)
      payload = JSON.parse(source)
      return false unless payload.is_a?(Hash)

      ThinkroomSketch.parse(
        JSON.generate(payload.fetch("scene")),
        description: payload["description"],
        format_version: payload["formatVersion"]
      ).present?
    rescue JSON::ParserError, JSON::NestingError, KeyError
      false
    end
  end
end
