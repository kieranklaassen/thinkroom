require "test_helper"

class RawHtmlTest < ActiveSupport::TestCase
  HTML = {
    "a block" => "<div>\nhi\n</div>",
    "an inline tag" => "some <b>bold</b> text",
    "a closing tag" => "stray </b> tag",
    "a comment" => "a <!-- note --> b",
    "a declaration" => "<!DOCTYPE html>",
    "an instruction" => "<?php echo 1 ?>",
    "a custom element" => "<x-card />",
    "a list item" => "- one\n- <u>two</u>",
    "a quote" => "> <div>\n> hi",
    "a table cell" => "| a |\n| - |\n| <u>b</u> |",
    "a split code span in a table" => "| a | b |\n| - | - |\n| ` | <b> |",
    "a heading" => "# Title <small>x</small>",
    "a link text" => "[<b>x</b>](https://example.com)",
    "a footnote" => "x[^1]\n\n[^1]: <b>note</b>",
    "a definition that is a footnote" => "[^1]: <b>",
    "after front matter" => "---\na: |\n ```\n---\n\n<div>",
    "a break with an attribute" => "<br class=\"x\">",
    "a span of another kind" => "<span class=\"x\">a</span>",
    "editor markup with more attributes" => "<span data-highlighter data-color=\"blue\" onclick=\"x\">a</span>"
  }.freeze

  PLAIN = {
    "text" => "# Title\n\nHello **world** and [a link](https://example.com)",
    "a fenced block" => "```html\n<div>hi</div>\n```",
    "an indented block" => "    <div>hi</div>",
    "inline code" => "use `<div>` here",
    "escaped text" => "a \\<b> c",
    "entities" => "&lt;b&gt;bold&lt;/b&gt;",
    "comparisons" => "1 < 2 and a <3 and x<-y",
    "autolinks" => "<https://example.com> <me@example.com>",
    "an image" => "![alt](/x.png)",
    "a sketch" => "```excalidraw\n{\"text\":\"<b>\"}\n```",
    "an empty line" => "a\n\n<br />\n\nb",
    "provenance" => '<span data-provenance data-kind="human" data-author="Ann" data-state="verbatim">a</span>',
    "a highlight" => '<span data-highlighter data-color="blue">a</span>',
    "a tracked change" => '<ins data-suggestion-id="1" data-author="Ann">a</ins><del data-suggestion-id="2" data-author="Ann">b</del>'
  }.freeze

  HTML.each do |name, source|
    test "HTML is found in #{name}" do
      assert RawHtml.in_markdown(source).any?, source
    end
  end

  PLAIN.each do |name, source|
    test "no HTML is found in #{name}" do
      assert_empty RawHtml.in_markdown(source), source
    end
  end

  test "large tables are read as the editor reads them" do
    header = "|" + " a |" * 1_001
    row = "|" + " - |" * 1_001
    assert RawHtml.in_markdown("#{header}\n#{row}\n| ` | <b> |\n").any?
  end

  test "a second copy is more, and a move is not" do
    before = RawHtml.in_markdown("a <u>b</u>\n\nc")
    assert_empty RawHtml.more(RawHtml.in_markdown("c\n\na <u>b</u>"), before)
    assert_equal({ "<u>" => 1, "</u>" => 1 }, RawHtml.more(RawHtml.in_markdown("a <u>b</u> <u>b</u>"), before))
  end

  test "markup ignores text beside it but not its tags, attributes, comments or scripts" do
    before = RawHtml.markup(RawHtml.in_markdown("<div class=\"a\">hi</div>\n\n<script>x</script>"))
    same = "<div class=\"a\">hi</div> joined\n\n<script>x</script>"
    assert_empty RawHtml.more(RawHtml.markup(RawHtml.in_markdown(same)), before)
    [ "<div class=\"b\">hi</div>", "<div class=\"a\"><i>hi</i></div>", "<div class=\"a\"><!-- c --></div>",
      "<script>y</script>", "<td>x</td>", "</section>", "<!DOCTYPE html>" ].each do |source|
      assert RawHtml.more(RawHtml.markup(RawHtml.in_markdown(source)), before).any?, source
    end
  end

  test "a HTML body counts its elements, and plain text has none" do
    assert RawHtml.in_html("<p>hi</p>").any?
    assert RawHtml.in_html("a <!-- c -->").any?
    assert_empty RawHtml.in_html("just text & more")
  end

  test "text of any encoding and depth is read" do
    assert_empty RawHtml.in_markdown("caf\xE9".b)
    assert RawHtml.in_markdown("#{'> ' * 3_000}<b>").any?
    assert RawHtml.in_markdown("a\0 <b>").any?
  end
end
