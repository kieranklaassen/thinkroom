require "test_helper"

class DocumentMarkdownTest < ActiveSupport::TestCase
  OPTIONS = {
    options: { render: { unsafe: true }, extension: { header_ids: nil } },
    plugins: DocumentPlainText::MARKDOWN_PLUGINS
  }.freeze

  test "a document with very many addresses shows them as text" do
    content = "ada@example.com, " * 201

    html = DocumentPreviewHtml.call(format: "markdown", content:)
    assert_no_match(/<a /, html)
    assert_equal 201, html.scan("ada@example.com").size

    fragment = DocumentPlainText.fragment(format: "markdown", content:)
    assert_empty fragment.css("a")
    assert_equal content.strip, DocumentPlainText.text(fragment, format: "markdown")
  end

  test "an address counts however it is written" do
    [ "@", "&commat;", "&#64;", "&#0064;", "&#x40;", "&#X0040;" ].each do |sign|
      html = DocumentMarkdown.to_html("ada#{sign}example.com " * 201, **OPTIONS)

      assert_no_match(/<a /, html, sign)
      assert_includes html, "ada@example.com"
    end
  end

  test "ordinary addresses and links stay linked" do
    [ "ada@example.com " * 200, "https://example.com (www.example.com)\n" * 2_000 ].each do |source|
      assert_equal Commonmarker.to_html(source, **OPTIONS), DocumentMarkdown.to_html(source, **OPTIONS)
    end
    content = "ada@example.com " * 200
    assert_equal 200, DocumentPlainText.fragment(format: "markdown", content:).css("a").size
  end

  test "written links stay links among very many addresses" do
    html = DocumentMarkdown.to_html("[Ada](mailto:ada@example.com) <ada@example.com> " * 101, **OPTIONS)

    assert_equal 202, html.scan('<a href="mailto:ada@example.com">').size
  end

  test "the text of a document is read without heading ids" do
    fragment = DocumentPlainText.fragment(format: "markdown", content: "# Notes\n\n# Notes")

    assert_empty fragment.css("[id], a")
  end
end
