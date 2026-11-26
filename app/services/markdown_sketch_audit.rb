# Reports whether a markdown document's inline excalidraw fences were
# recognized as sketches. Recognition mirrors DocumentPlainText exactly — same
# parsed fragment, same `pre[lang="excalidraw"] > code` selector, same
# ThinkroomSketch.parse arguments — so a "kept as a code block" warning on the
# create response fires precisely when plain_text would echo raw scene JSON.
class MarkdownSketchAudit
  Result = Data.define(:fence_count, :unrecognized_count) do
    def unrecognized? = unrecognized_count.positive?

    # The agent-facing warning for unrecognized fences, or nil when every fence
    # parsed. Lives next to the count so each API surface (create, suggestions)
    # reports the same message without duplicating the pluralization.
    def warning_message
      return unless unrecognized?

      if unrecognized_count == 1
        "An excalidraw block was not a valid sketch and was kept as a code block."
      else
        "#{unrecognized_count} excalidraw blocks were not valid sketches and were kept as code blocks."
      end
    end
  end

  class << self
    def call(content)
      source = content.to_s
      return Result.new(fence_count: 0, unrecognized_count: 0) if source.blank?

      self.in(DocumentPlainText.fragment(format: "markdown", content: source))
    end

    # The audit of an already parsed source. Read it before the text
    # (DocumentPlainText.text), which replaces recognized sketches in place.
    def in(fragment)
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
