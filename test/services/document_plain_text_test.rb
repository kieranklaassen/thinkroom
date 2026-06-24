require "test_helper"

class DocumentPlainTextTest < ActiveSupport::TestCase
  test "extracts rendered text from markdown" do
    source = <<~MARKDOWN
      # Notes

      **Bold** and [linked](https://example.com).

      | A | B |
      | --- | --- |
      | 1 | 2 |
    MARKDOWN

    text = DocumentPlainText.call(format: "markdown", content: source)

    assert_equal "Notes Bold and linked. A B 1 2", text
  end

  test "extracts rendered text from html" do
    source = "<h1>Notes</h1><p><strong>Bold</strong> text.</p><ul><li>One</li><li>Two</li></ul>"

    assert_equal "Notes Bold text. One Two",
                 DocumentPlainText.call(format: "html", content: source)
  end

  test "markdown Thinkroom markup contributes content but not tags" do
    source = 'Before <span data-provenance data-kind="ai">robot</span> ' \
      'and <ins data-suggestion-id="x">new</ins>'

    assert_equal "Before robot and new",
                 DocumentPlainText.call(format: "markdown", content: source)
  end

  test "extracts sketch description and labels without exposing scene JSON" do
    scene = {
      type: "excalidraw", version: 2,
      elements: [
        { type: "rectangle" },
        { type: "text", text: "Draft" },
        { type: "text", text: "Review" }
      ],
      appState: {}, files: {}
    }
    markdown = <<~MARKDOWN
      Before

      ```excalidraw
      #{JSON.generate({ id: "approval_1", formatVersion: 1, description: "Approval flow", scene: })}
      ```

      After
    MARKDOWN
    html = %(<p>Before</p><figure data-thinkroom-sketch data-sketch-id="approval_1" data-format-version="1" data-description="Approval flow" data-scene="#{CGI.escapeHTML(scene.to_json)}"><figcaption>Approval flow</figcaption></figure><p>After</p>)

    assert_equal "Before Sketch: Approval flow — Draft, Review After",
                 DocumentPlainText.call(format: "markdown", content: markdown)
    assert_equal "Before Sketch: Approval flow — Draft, Review After",
                 DocumentPlainText.call(format: "html", content: html)
  end
end
