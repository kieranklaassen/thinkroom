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
end
