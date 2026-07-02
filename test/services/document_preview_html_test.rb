require "test_helper"

class DocumentPreviewHtmlTest < ActiveSupport::TestCase
  # A realistic markdown sketch fence: the SketchData wrapper (formatVersion +
  # an excalidraw scene), matching what the editor serializes.
  def sketch_fence(height: 600, id: "sketch_1", description: "flow", elements: [])
    payload = {
      id: id,
      formatVersion: 1,
      description: description,
      height: height,
      scene: { type: "excalidraw", version: 2, elements: elements }
    }
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

  test "strips the newline Commonmarker emits after every <br>" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "Line one\nLine two\nLine three")

    # Under white-space: break-spaces, "<br>\n" renders as TWO forced breaks —
    # each soft break made the preview one line taller than the editor.
    assert_includes html, "<br>Line two"
    assert_includes html, "<br>Line three"
    refute_includes html, "<br>\n"
  end

  test "preserves whitespace inside code blocks" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "```ruby\ndef x\n  1\nend\n```")

    assert_includes html, "def x\n  1\nend"
  end

  test "replicates ProseMirror's trailing break after a block image" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "![alt](/rails/active_storage/blobs/redirect/abc/x.png)")

    # The editor renders <img> + separator + trailing break (one extra line
    # box); without the same structure the paragraph is a line shorter in the
    # preview and everything below jumps at swap.
    assert_includes html, 'class="ProseMirror-separator"'
    assert_includes html, 'class="ProseMirror-trailingBreak"'
  end

  test "renders a Mermaid fence as the editor's loading figure plus visible source when editable" do
    html = DocumentPreviewHtml.call(
      format: "markdown",
      content: "Before\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter",
      editable: true
    )

    assert_includes html, 'class="mermaid-diagram"'
    assert_includes html, 'data-state="loading"'
    assert_includes html, "Rendering diagram…"
    # Edit mode keeps the source visible under the figure, exactly like the editor.
    assert_includes html, "flowchart LR"
    assert_includes html, "Before"
    assert_includes html, "After"
  end

  test "hides Mermaid source when the editor will not be editable" do
    html = DocumentPreviewHtml.call(
      format: "markdown",
      content: "```mermaid\nflowchart LR\n  A --> B\n```",
      editable: false
    )

    assert_includes html, 'class="mermaid-diagram"'
    refute_includes html, "flowchart LR"
  end

  test "sizes the Mermaid figure from persisted render hints" do
    source = "flowchart LR\n  A --> B"
    hash = DocumentPreviewHtml.mermaid_source_hash(source)
    html = DocumentPreviewHtml.call(
      format: "markdown",
      content: "```mermaid\n#{source}\n```",
      render_hints: { "mermaid" => { hash => 421 } }
    )

    assert_includes html, "min-height: 421px"
  end

  test "mermaid_source_hash matches the editor's FNV-1a base36 hash" do
    # Reference value computed with app/frontend/editor/mermaid.ts sourceHash.
    assert_equal "1op0dzs", DocumentPreviewHtml.mermaid_source_hash("flowchart LR\n  A --> B")
  end

  test "does not replace an ordinary code fence that mentions Mermaid" do
    html = DocumentPreviewHtml.call(
      format: "markdown",
      content: "```text\nmermaid flowchart LR\n```"
    )

    refute_includes html, "mermaid-diagram"
    assert_includes html, "mermaid flowchart LR"
  end

  test "wraps tables in the editor's table-block structure" do
    html = DocumentPreviewHtml.call(
      format: "markdown",
      content: "| A | B |\n| --- | --- |\n| 1 | 2 |"
    )

    assert_includes html, 'class="milkdown-table-block"'
    assert_includes html, 'class="table-wrapper"'
    assert_match(/<div class="milkdown-table-block"><div class="table-wrapper"><table>/, html)
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

  test "replaces a real sketch fence with the live sketch figure and drawn scene" do
    elements = [ { type: "rectangle", x: 10, y: 10, width: 100, height: 50, strokeColor: "#1e1e1e" } ]
    html = DocumentPreviewHtml.call(
      format: "markdown",
      content: "Before\n\n#{sketch_fence(height: 600, elements: elements)}\n\nAfter"
    )

    assert_includes html, 'class="thinkroom-sketch"'
    assert_includes html, 'class="thinkroom-sketch-preview"'
    assert_includes html, "height: 600px"
    assert_includes html, "sketch-preview-svg"
    assert_includes html, "<rect" # the scene is actually drawn, not a gray box
    assert_includes html, "--sketch-tape-width" # deterministic tape variation
    refute_includes html, "formatVersion" # raw scene JSON never reaches the preview
  end

  test "marks sketches editable only when the viewer gets sketch controls" do
    fence = sketch_fence

    interactive = DocumentPreviewHtml.call(format: "markdown", content: fence, sketch_interactive: true)
    readonly = DocumentPreviewHtml.call(format: "markdown", content: fence, sketch_interactive: false)

    assert_includes interactive, "thinkroom-sketch is-editable"
    assert_includes interactive, "Add a title…"
    refute_includes readonly, "is-editable"
    refute_includes readonly, "Add a title…"
  end

  test "hides the empty caption on non-interactive sketches like the editor does" do
    html = DocumentPreviewHtml.call(format: "markdown", content: sketch_fence(description: ""))

    assert_includes html, "thinkroom-sketch-caption is-empty"
  end

  test "does NOT skeletonize a non-sketch code block that merely has a scene key" do
    # A JSON/config code sample with a top-level "scene" key must survive as code
    # (the sanitizer strips the lang hint, so detection keys on the sketch shape).
    fence = "```json\n#{JSON.generate({ scene: "a beach at sunset", note: "tutorial" })}\n```"
    html = DocumentPreviewHtml.call(format: "markdown", content: fence)

    refute_includes html, "thinkroom-sketch"
    assert_includes html, "a beach at sunset"
  end

  test "keeps an invalid-id sketch fence as a code block, matching the editor" do
    payload = { id: "bad id with spaces", formatVersion: 1, scene: { type: "excalidraw", version: 2, elements: [] } }
    html = DocumentPreviewHtml.call(format: "markdown", content: "```excalidraw\n#{JSON.generate(payload)}\n```")

    refute_includes html, "thinkroom-sketch"
  end

  test "clamps sketch height to the allowed range" do
    high = DocumentPreviewHtml.call(format: "markdown", content: sketch_fence(height: 999_999))
    low = DocumentPreviewHtml.call(format: "markdown", content: sketch_fence(height: 10))

    assert_includes high, "height: #{DocumentPreviewHtml::MAX_SKETCH_HEIGHT}px"
    assert_includes low, "height: #{DocumentPreviewHtml::MIN_SKETCH_HEIGHT}px"
  end

  test "falls back to the default height when the sketch omits one" do
    payload = { id: "s1", formatVersion: 1, scene: { type: "excalidraw", version: 2, elements: [] } }
    fence = "```excalidraw\n#{JSON.generate(payload)}\n```"

    html = DocumentPreviewHtml.call(format: "markdown", content: fence)

    assert_includes html, "height: #{DocumentPreviewHtml::DEFAULT_SKETCH_HEIGHT}px"
  end

  test "renders an html sketch figure at its reserved height" do
    scene = { type: "excalidraw", version: 2, elements: [ { type: "text", text: "Review" } ], appState: {}, files: {} }.to_json
    figure = %(<figure data-thinkroom-sketch data-sketch-id="flow_1" data-sketch-height="320" ) +
      %(data-format-version="1" data-description="Flow" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Flow</figcaption></figure>)

    html = DocumentPreviewHtml.call(format: "html", content: figure)

    assert_includes html, 'class="thinkroom-sketch"'
    assert_includes html, "height: 320px"
    assert_includes html, "Review" # the text element is drawn into the SVG
  end
end
