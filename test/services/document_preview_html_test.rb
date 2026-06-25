require "test_helper"

class DocumentPreviewHtmlTest < ActiveSupport::TestCase
  test "renders markdown to sanitized prose html" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "# Title\n\nA **bold** line.")

    assert_includes html, "Title"
    assert_includes html, "<strong>bold</strong>"
    assert_includes html, "<p>"
  end

  test "returns empty string for blank content" do
    assert_equal "", DocumentPreviewHtml.call(format: "markdown", content: "")
    assert_equal "", DocumentPreviewHtml.call(format: "html", content: nil)
  end

  test "strips scripts and unsafe markup" do
    html = DocumentPreviewHtml.call(format: "markdown", content: "<script>alert(1)</script>\n\nsafe")

    refute_includes html, "<script"
    refute_includes html, "alert(1)"
    assert_includes html, "safe"
  end

  test "replaces a markdown sketch fence with a height-reserving skeleton" do
    fence = <<~MARKDOWN
      Before

      ```excalidraw
      {"scene":[],"description":"flow","formatVersion":1,"height":600}
      ```

      After
    MARKDOWN

    html = DocumentPreviewHtml.call(format: "markdown", content: fence)

    assert_includes html, 'class="doc-sketch-skeleton"'
    assert_includes html, "height: 600px"
    # The raw scene JSON must never reach the preview.
    refute_includes html, "formatVersion"
  end

  test "clamps an out-of-range sketch height" do
    fence = "```excalidraw\n{\"scene\":[],\"height\":999999}\n```"

    html = DocumentPreviewHtml.call(format: "markdown", content: fence)

    assert_includes html, "height: #{DocumentPreviewHtml::MAX_SKETCH_HEIGHT}px"
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
