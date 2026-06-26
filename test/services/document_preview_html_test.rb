require "test_helper"

class DocumentPreviewHtmlTest < ActiveSupport::TestCase
  # A realistic markdown sketch fence: the SketchData wrapper (formatVersion +
  # an excalidraw scene), matching what the editor serializes.
  def sketch_fence(height: 600)
    payload = { formatVersion: 1, description: "flow", height: height, scene: { type: "excalidraw", version: 2, elements: [] } }
    "```excalidraw\n#{JSON.generate(payload)}\n```"
  end

  test "renders markdown to sanitized prose html" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "# Title\n\nA **bold** line.")

    assert_includes html, "<h1>Title</h1>"
    assert_includes html, "<strong>bold</strong>"
  end

  test "returns empty string for blank content" do
    assert_equal "", DocumentPreviewHtml.call(format: "markdown", content: "")
    assert_equal "", DocumentPreviewHtml.call(format: "html", content: nil)
  end

  test "collapses inter-block whitespace so the preview matches the editor DOM" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "# Title\n\nParagraph one.\n\n## Section\n")

    # ProseMirror emits no whitespace text nodes between block elements; the
    # editor renders with white-space: break-spaces, so a stray "\n" would show
    # as a phantom blank line and shift the text on swap.
    assert_includes html, "</h1><p>"
    assert_includes html, "</p><h2>"
    refute_match(/>\s+</, html)
  end

  test "preserves whitespace inside code blocks" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "```ruby\ndef x\n  1\nend\n```")

    assert_includes html, "def x\n  1\nend"
  end

  test "replaces a Mermaid fence with a first-paint skeleton" do
    html = DocumentPreviewHtml.call(
      format: "markdown",
      content: "Before\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter"
    )

    assert_includes html, 'class="doc-mermaid-skeleton"'
    refute_includes html, "flowchart LR"
    assert_includes html, "Before"
    assert_includes html, "After"
  end

  test "does not replace an ordinary code fence that mentions Mermaid" do
    html = DocumentPreviewHtml.call(
      format: "markdown",
      content: "```text\nmermaid flowchart LR\n```"
    )

    refute_includes html, "doc-mermaid-skeleton"
    assert_includes html, "mermaid flowchart LR"
  end

  test "strips scripts and unsafe markup in markdown" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "<script>alert(1)</script>\n\nsafe")

    refute_includes html, "<script"
    refute_includes html, "alert(1)"
    assert_includes html, "safe"
  end

  test "strips event handlers and scripts on the html passthrough path" do
    source = "<p>safe</p><script>evil()</script><img src=\"x\" onerror=\"steal()\">"
    html = DocumentPreviewHtml.call(format: "html", content: source)

    refute_includes html, "<script"
    refute_includes html, "onerror"
    refute_includes html, "evil()"
    assert_includes html, "safe"
  end

  test "replaces a real sketch fence with a height-reserving skeleton" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "Before\n\n#{sketch_fence(height: 600)}\n\nAfter")

    assert_includes html, 'class="doc-sketch-skeleton"'
    assert_includes html, "height: 600px"
    refute_includes html, "formatVersion" # raw scene JSON never reaches the preview
  end

  test "does NOT skeletonize a non-sketch code block that merely has a scene key" do
    # A JSON/config code sample with a top-level "scene" key must survive as code
    # (the sanitizer strips the lang hint, so detection keys on the sketch shape).
    fence = "```json\n#{JSON.generate({ scene: "a beach at sunset", note: "tutorial" })}\n```"
    html = DocumentPreviewHtml.call(format: "markdown", content: fence)

    refute_includes html, "doc-sketch-skeleton"
    assert_includes html, "a beach at sunset"
  end

  test "clamps sketch height to the allowed range" do
    high = DocumentPreviewHtml.call(format: "markdown", content: sketch_fence(height: 999_999))
    low = DocumentPreviewHtml.call(format: "markdown", content: sketch_fence(height: 10))

    assert_includes high, "height: #{DocumentPreviewHtml::MAX_SKETCH_HEIGHT}px"
    assert_includes low, "height: #{DocumentPreviewHtml::MIN_SKETCH_HEIGHT}px"
  end

  test "falls back to the default height when the sketch omits one" do
    payload = { formatVersion: 1, scene: { type: "excalidraw", elements: [] } }
    fence = "```excalidraw\n#{JSON.generate(payload)}\n```"

    html = DocumentPreviewHtml.call(format: "markdown", content: fence)

    assert_includes html, "height: #{DocumentPreviewHtml::DEFAULT_SKETCH_HEIGHT}px"
  end

  test "reserves height for an html sketch figure" do
    scene = { type: "excalidraw", version: 2, elements: [ { type: "text", text: "Review" } ], appState: {}, files: {} }.to_json
    figure = %(<figure data-thinkroom-sketch data-sketch-id="flow_1" data-sketch-height="320" ) +
      %(data-format-version="1" data-description="Flow" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Flow</figcaption></figure>)

    html = DocumentPreviewHtml.call(format: "html", content: figure)

    assert_includes html, 'class="doc-sketch-skeleton"'
    assert_includes html, "height: 320px"
  end
end
