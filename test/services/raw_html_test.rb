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
    "an extra table column" => "| a |\n| - |\n| x | <a href=\"https://example.com\">link</a> |",
    "a split code span in a table" => "| a | b |\n| - | - |\n| ` | <b> |",
    "a heading" => "# Title <small>x</small>",
    "a link text" => "[<b>x</b>](https://example.com)",
    "a footnote" => "x[^1]\n\n[^1]: <b>note</b>",
    "a definition that is a footnote" => "[^1]: <b>",
    "a footnote nothing refers to" => "[^1]: =<b>",
    "a footnote after a line of spaces" => "[^1]: a\n  \n    <div>",
    "a footnote after a CR line of spaces" => "[^1]: a\r  \r    <div>",
    "after front matter" => "---\na: |\n ```\n---\n\n<div>",
    "after front matter with trailing space on closing fence" => "---\n```\n--- \n\n<a href=\"https://example.com\">x</a>",
    "a list after front matter that never closes" => "---\n-     <b>",
    "a list after CRLF front matter that never closes" => "---\r\n-     <b>",
    "a comment with dashes" => "a <!-- b -- c -->",
    "a declaration after a comment that never closes" => "a <!-- <!X y>",
    "a CDATA after doubled open-comment" => "a <<!--\n<![CDATA[z]]>",
    "a break with an attribute" => "<br class=\"x\">",
    "a span of another kind" => "<span class=\"x\">a</span>",
    "stray closing span" => "plain </span> text",
    "valueless suggestion tag" => "<ins data-suggestion-id>x</ins>",
    "invalid highlighter color" => "<span data-highlighter data-color=\"bogus\">x</span>",
    "multiline provenance block" => "<span data-provenance data-kind=\"human\" data-author=\"Ann\" data-state=\"verbatim\">\nplain",
    "editor markup with more attributes" => "<span data-highlighter data-color=\"blue\" onclick=\"x\">a</span>",
    "reordered provenance attributes" => '<span data-kind="human" data-provenance data-author="Ann" data-state="verbatim">a</span>',
    "uppercase provenance tag" => '<SPAN data-provenance data-kind="human" data-author="Ann" data-state="verbatim">a</span>',
    "single-quoted provenance attributes" => "<span data-provenance data-kind='human' data-author='Ann' data-state='verbatim'>a</span>",
    "unclosed provenance span" => '<span data-provenance data-kind="human" data-author="Ann" data-state="verbatim">a',
    "unclosed highlighter span" => '<span data-highlighter data-color="blue">a',
    "unclosed suggestion tag" => '<ins data-suggestion-id="1" data-author="Ann">a',
    "non-empty provenance flag attribute" => '<span data-provenance="yes" data-kind="human" data-author="Ann" data-state="verbatim">a</span>',
    "cross-block provenance close" => "<span data-provenance data-kind=\"human\" data-author=\"Ann\" data-state=\"verbatim\">a\n\n</span>",
    "a tracked change in another of its kind" => '<ins data-suggestion-id="1"><ins data-suggestion-id="2">a</ins></ins>',
    "a fence in front matter that a code block closes" => "---\n```\n---\n\n```\n<b>\n```",
    "a tag behind many comparisons" => "<div>#{"1 < 2 " * 12}<a href=\"https://example.com\" x=\"",
    "a tag after a link that takes the backslash in" => "[1]www.example.com/\\<img src=x>",
    "a CDATA that ends with more brackets" => "a <![CDATA[x]]]>",
    "a quote after a delimiter row" => "|-|\n> 2) ~~~ `<b>`",
    "an item that opens with a tagged fence" => "a\n2) -->\n>\t2)  ```</b>",
    "an item that opens with a definition" => "2) [a]: -->\n\n\n    ![</b>",
    "an empty line before a delimiter row" => "a\n<br />\n| - |",
    "reversed editor tags" => '</span><span data-highlighter data-color="blue">'
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
    "a rule, then a list with code" => "***\n-     <b>",
    "front matter" => "---\ntitle: a -- b\n---\n\n- one\n\n      code",
    "a comment as code" => "`<!-- a -- b -->`",
    "a list after a rule, and a table, with code" => "---\n- `<b>`\n\n| a |\n| - |\n| `<b>` |\n\n> `<i>`",
    "numbered items with code" => "1. `<b>`\n2. two\n\n   ```html\n   <p>\n   ```\n3. ```\n   <p>\n   ```",
    "a link and an escape" => "https://example.com and \\<b>",
    "an empty line" => "a\n\n<br />\n\nb",
    "provenance" => '<span data-provenance data-kind="human" data-author="Ann" data-state="verbatim">a</span>',
    "a highlight" => '<span data-highlighter data-color="blue">a</span>',
    "a tracked change" => '<ins data-suggestion-id="1" data-author="Ann">a</ins><del data-suggestion-id="2" data-author="Ann">b</del>'
  }.freeze

  HTML.each do |name, source|
    test "HTML is found in #{name}" do
      assert RawHtml.in_markdown?(source), source
    end
  end

  PLAIN.each do |name, source|
    test "no HTML is found in #{name}" do
      assert_not RawHtml.in_markdown?(source), source
    end
  end

  test "large tables are read as the editor reads them" do
    header = "|" + " a |" * 1_001
    row = "|" + " - |" * 1_001
    assert RawHtml.in_markdown?("#{header}\n#{row}\n| ` | <b> |\n")
  end

  test "text of any encoding and depth is read" do
    assert_not RawHtml.in_markdown?("caf\xE9".b)
    assert RawHtml.in_markdown?("#{'> ' * 3_000}<b>")
    assert RawHtml.in_markdown?("a\0 <b>")
  end

  test "front matter that is not ASCII ends where the parser ends it" do
    front = "---\ntitle: #{"日本語" * 5}\n---\n\n"
    assert_not RawHtml.in_markdown?("#{front}plain `<b>`")
    assert RawHtml.in_markdown?("#{front}<mark>note</mark>")
    assert RawHtml.in_markdown?("---\ntitle: #{"日本語" * 5}\nnote: <mark>x</mark>\n---\n\nplain")
  end

  test "a source the parser refuses counts as HTML" do
    original = DocumentMarkdown.method(:parse)
    DocumentMarkdown.define_singleton_method(:parse) { |*, **| raise Commonmarker::NestingDepthExceededError }
    assert RawHtml.in_markdown?("a < b")
    assert_not RawHtml.in_markdown?("no markup")
  ensure
    DocumentMarkdown.define_singleton_method(:parse, original)
  end

  test "an HTML node counts wherever it is, and text that names one does not" do
    assert live?("base")
    assert live?("deep_html")
    assert live?("too_deep")
    assert live?("unreadable", base: true)
    assert_not live?("plain_code")
    assert_not live?("break_only")
    assert_not RawHtml.in_live?(Y::Doc.new)
  end

  test "live front matter counts by what its saved source holds" do
    %w[frontmatter_html fm_code_fence_html fm_unclosed_fence fm_list_value].each { |name| assert live?(name, text: true), name }
    %w[frontmatter_plain fm_indented_html].each { |name| assert_not live?(name, text: true), name }
  end

  private

  UPDATES = JSON.parse(Rails.root.join("test/fixtures/files/html_account_updates.json").read).freeze

  def live?(name, base: false, text: false)
    ydoc = Y::Doc.new
    ydoc.apply_update(Base64.strict_decode64(UPDATES["base"])) if base || text
    ydoc.apply_update(Base64.strict_decode64(UPDATES["remove"])) if text
    ydoc.apply_update(Base64.strict_decode64(UPDATES.fetch(name)))
    RawHtml.in_live?(ydoc)
  end
end
