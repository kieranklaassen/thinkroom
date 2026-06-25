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

      html = Commonmarker.to_html(source, plugins: DocumentPlainText::MARKDOWN_PLUGINS)
      fragment = Nokogiri::HTML5.fragment(html)

      fence_count = 0
      unrecognized_count = 0
      fragment.css('pre[lang="excalidraw"] > code').each do |node|
        fence_count += 1
        # ThinkroomSketch.parse_markdown_fence is the single recognition
        # authority the renderer also uses, so a fence counts as unrecognized
        # here exactly when DocumentPlainText would leave its raw JSON visible.
        unrecognized_count += 1 unless ThinkroomSketch.parse_markdown_fence(node.text)
      end

      Result.new(fence_count:, unrecognized_count:)
    end
  end
end
