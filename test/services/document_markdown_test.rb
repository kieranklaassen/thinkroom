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

  test "a line with very many links shows them as text" do
    links = "https://example.com/a " * 2_500

    assert_no_match(/<a /, DocumentMarkdown.to_html(links, **OPTIONS))
    assert_no_match(/<a /, DocumentMarkdown.to_html("https://example.com/#{")" * 12_000}", **OPTIONS))
  end

  test "many links in many lines, and a long line without links, stay as they are" do
    [ "https://example.com/a\n" * 2_500, "#{"word " * 40_000}\n#{"https://example.com (a)\n" * 200}", "&amp; " * 40_000 ].each do |source|
      assert_equal Commonmarker.to_html(source, **OPTIONS), DocumentMarkdown.to_html(source, **OPTIONS)
    end
  end

  test "written links stay links among very many addresses" do
    html = DocumentMarkdown.to_html("[Ada](mailto:ada@example.com) <ada@example.com> " * 101, **OPTIONS)

    assert_equal 202, html.scan('<a href="mailto:ada@example.com">').size
  end

  test "a table of very many columns shows as text" do
    [ "", "> ", "- " ].each do |container|
      html = DocumentMarkdown.to_html(table(1_001, container:), **OPTIONS)

      assert_no_match(/<table/, html)
      assert_includes html, "|---|"
    end
    assert_no_match(/<table/, DocumentMarkdown.to_html(table(1_001).gsub("\n", "\r"), **OPTIONS))
  end

  test "tables of very many cells show as text" do
    [
      table(10, rows: 2_000), table(10, rows: 2_000, row: "a"), table(10, rows: 2_000, row: "|-|"),
      table(10, rows: 2_000, row: "a", newline: "\r\n"), table(10, rows: 2_000, row: "a", newline: "\r"),
      "#{table(10, rows: 500, row: "a")}\n" * 4, "a\n:-:\n#{"b\n" * 20_000}", "a|b\n-|-\n#{"c\n" * 10_000}"
    ].each do |source|
      assert_no_match(/<table/, DocumentMarkdown.to_html(source, **OPTIONS))
    end
  end

  test "ordinary tables stay as they are" do
    [
      table(1_000), table(10, rows: 1_999), table(10, rows: 1_999, row: "a"), "#{table(3)}\n" * 2_000,
      "#{table(8)}\n#{"a\n" * 30_000}", "a | b\n--|--\n`x|y` | c\\|d\n", "a || b\n" * 1_000,
      "#{table(2)}\n```\n#{"- " * 40}\n#{"line\n" * 600}```\n", "#{table(2)}\n```\n#{"----- " * 10}\n#{"#{"value " * 10}\n" * 2_001}```\n"
    ].each do |source|
      assert_equal Commonmarker.to_html(source, **OPTIONS), DocumentMarkdown.to_html(source, **OPTIONS)
    end
  end

  test "the text of a document is read without heading ids" do
    fragment = DocumentPlainText.fragment(format: "markdown", content: "# Notes\n\n# Notes")

    assert_empty fragment.css("[id], a")
  end

  test "deeply nested markdown exceeding Commonmarker's limit raises TooComplex" do
    deep_lists = (0...600).map { |level| "#{"  " * level}- words" }.join("\n")

    assert_raises(DocumentHtml::TooComplex) do
      DocumentMarkdown.to_html(deep_lists, **OPTIONS)
    end
  end

  test "unsafe markdown escapes GFM disallowed raw HTML tags while keeping allowed inline HTML" do
    html = DocumentMarkdown.to_html(
      %(<script>alert(1)</script> <TEXTAREA>x</textarea> <span data-provenance>ok</span>),
      **OPTIONS
    )

    assert_includes html, "&lt;script>alert(1)&lt;/script>"
    assert_includes html, "&lt;TEXTAREA>x&lt;/textarea>"
    assert_includes html, "<span data-provenance>ok</span>"
  end

  private

  def table(columns, rows: 2, row: "|#{"a|" * columns}", container: "", newline: "\n")
    lines = [ "|#{"a|" * columns}", "|#{"---|" * columns}", *[ row ] * rows ]
    lines.each_with_index.map { |line, index| "#{index.zero? || container != "- " ? container : "  "}#{line}#{newline}" }.join
  end
end
