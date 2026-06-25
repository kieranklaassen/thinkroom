# Server-rendered HTML for the document's current content, painted instantly on
# page load so the editor frame shows real text before Milkdown finishes its
# async boot. The live editor (hydrated from yjs_state) swaps in over this once
# it is ready; because both render the same content into the same prose styles,
# the swap is seamless. See app/frontend/pages/documents/show.tsx (doc-editor-stack).
class DocumentPreviewHtml
  DEFAULT_SKETCH_HEIGHT = 448
  MIN_SKETCH_HEIGHT = 180
  MAX_SKETCH_HEIGHT = 1200

  class << self
    def call(format:, content:)
      source = content.to_s
      return "" if source.blank?

      html = if format == "html"
        source
      else
        Commonmarker.to_html(
          source,
          plugins: { table: true, strikethrough: true, tasklist: true }
        )
      end

      # Security boundary: document content is authored by humans and agents, so
      # it is sanitized before it can reach dangerouslySetInnerHTML on the client.
      sanitized = HtmlDocumentSanitizer.snapshot(html).content
      fragment = Nokogiri::HTML5.fragment(sanitized)
      skeletonize_sketches(fragment, format:)
      fragment.to_html
    end

    private

    # Replace each sketch with a neutral, height-reserving box. The preview can't
    # run Excalidraw, so without this a markdown doc would flash raw scene JSON
    # and an HTML doc would collapse the canvas — both reflow when the live editor
    # mounts the real sketch. A fixed-height placeholder keeps the layout stable.
    # Runs post-sanitize, so the injected inline height is trusted, not user input.
    def skeletonize_sketches(fragment, format:)
      sketch_nodes(fragment, format:).each do |node, height|
        node.replace(skeleton(node.document, height))
      end
    end

    def sketch_nodes(fragment, format:)
      if format == "html"
        fragment.css("figure[data-thinkroom-sketch]").map do |node|
          [ node, clamp_height(node["data-sketch-height"]) ]
        end
      else
        # The excalidraw fence sanitizes down to <pre><code>{scene json}</code></pre>
        # (the lang hint is dropped), so the JSON payload itself is the signal.
        fragment.css("pre > code").filter_map do |code|
          payload = parse_scene(code.text) or next
          [ code.parent, clamp_height(payload["height"]) ]
        end
      end
    end

    def parse_scene(text)
      data = JSON.parse(text)
      data if data.is_a?(Hash) && data.key?("scene")
    rescue JSON::ParserError
      nil
    end

    def skeleton(document, height)
      figure = Nokogiri::XML::Node.new("figure", document)
      figure["class"] = "doc-sketch-skeleton"
      figure["style"] = "height: #{height}px"
      figure["aria-hidden"] = "true"
      figure
    end

    def clamp_height(raw)
      value = raw.to_i
      return DEFAULT_SKETCH_HEIGHT if value <= 0

      value.clamp(MIN_SKETCH_HEIGHT, MAX_SKETCH_HEIGHT)
    end
  end
end
