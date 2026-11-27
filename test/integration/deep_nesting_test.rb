require "test_helper"

# Very deep nesting is handled: what cannot be formatted shows as its source,
# and what is stored stays exactly as it was sent.
class DeepNestingTest < ActionDispatch::IntegrationTest
  BROWSER = { "User-Agent" => "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" }.freeze
  LEVELS = [ 100, 399, 400, 500, 1_000, 5_000, 50_000 ].freeze
  SECONDS = 20

  MARKDOWN = {
    "quotes" => ->(n, text) { "#{"> " * n}#{text}" },
    "single-line lists" => ->(n, text) { "#{"- " * n}#{text}" },
    "indented lists" => ->(n, text) { (0...[ n, 1_000 ].min).map { |i| "#{"  " * i}- #{text}" }.join("\n") },
    "emphasis" => ->(n, text) { "#{"*" * n}#{text}#{"*" * n}" },
    "mixed emphasis" => ->(n, text) { "#{"~~a *" * (n / 2)}#{text}#{"*~~" * (n / 2)}" },
    "links" => ->(n, text) { "#{"[" * n}#{text}#{"](u)" * n}" },
    "images" => ->(n, text) { "#{"![" * n}#{text}#{"](u)" * n}" },
    "brackets" => ->(n, text) { "#{"[" * n}#{text}#{"]" * n}" },
    "nested HTML" => ->(n, text) { "#{"<div>" * n}#{text}#{"</div>" * n}" },
    "inline HTML" => ->(n, text) { "a #{"<span>" * n}#{text}#{"</span>" * n}" }
  }.freeze

  HTML = {
    "quotes" => ->(n, text) { "#{"<blockquote>" * n}#{text}#{"</blockquote>" * n}" },
    "lists" => ->(n, text) { "#{"<ul><li>" * n}#{text}#{"</li></ul>" * n}" },
    "emphasis" => ->(n, text) { "#{"<em>" * n}#{text}#{"</em>" * n}" },
    "unclosed" => ->(n, text) { "#{"<b>" * n}#{text}" }
  }.freeze

  { "markdown" => MARKDOWN, "html" => HTML }.each do |format, shapes|
    shapes.each do |name, shape|
      test "#{format} #{name} at every depth have a preview, a text and a title" do
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        LEVELS.product([ "", "words" ]).each do |levels, text|
          content = shape.call(levels, text)
          html = DocumentPreviewHtml.call(format:, content:)
          DocumentPreviewHtml.block_count(html)
          plain = DocumentPlainText.call(format:, content:)
          DocumentTitle.call(format:, content:)
          assert_includes html + plain, text unless name == "images" # alt text only
          assert_operator html.bytesize, :<, 8.megabytes
        end
        assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, SECONDS
      end
    end
  end

  test "the deepest formatted level and the first one past it" do
    formatted = DocumentPreviewHtml.call(format: "markdown", content: "#{">" * 396} words")
    assert_includes formatted, "<blockquote>"
    assert_not_includes formatted, DocumentPreviewHtml::TOO_COMPLEX_NOTICE

    source = DocumentPreviewHtml.call(format: "markdown", content: "#{">" * 400} a <b> & c")
    assert_equal "<p><em>#{DocumentPreviewHtml::TOO_COMPLEX_NOTICE}</em></p>" \
                 "<pre><code>#{"&gt;" * 400} a &lt;b&gt; &amp; c</code></pre>", source
    assert_equal 3, DocumentPreviewHtml.block_count(source)
  end

  test "an element with too many attributes shows as its source" do
    content = "<p #{(1..500).map { |i| "a#{i}=1" }.join(" ")}>words</p>"
    assert_includes DocumentPreviewHtml.call(format: "html", content:), DocumentPreviewHtml::TOO_COMPLEX_NOTICE
    assert_includes DocumentPlainText.call(format: "html", content:), "words"
  end

  test "a preview that gains wrappers at the limit still has a block count" do
    (380..400).each do |levels|
      html = DocumentPreviewHtml.call(format: "markdown", content: "#{">" * levels} | a |\n#{">" * levels} |---|")
      assert_kind_of Integer, DocumentPreviewHtml.block_count(html)
    end
  end

  test "another argument error is not taken for a limit" do
    assert_raises(ArgumentError) { DocumentHtml.within_limits { raise ArgumentError, "something else" } }
  end

  test "markdown is stored as sent and every reader of it gets an answer" do
    [ ">" * 400 + " words", "*" * 1_000 + "words" + "*" * 1_000 ].each do |content|
      post api_docs_path, params: { content:, title: "Deep" }, as: :json, headers: { "X-Agent-Name" => "Scout" }
      assert_response :created
      assert_equal content, response.parsed_body["content"]
      assert_includes response.parsed_body["plain_text"], "words"

      document = Document.find_by!(slug: response.parsed_body["slug"])
      assert_equal content, document.current_content

      get document_page_path(document.slug), headers: BROWSER
      assert_response :success
      assert_includes response.body, DocumentPreviewHtml::TOO_COMPLEX_NOTICE
      [ api_doc_path(document.slug), document_page_path(document.slug, format: :json), document_page_path(document.slug, format: :txt) ].each do |path|
        get path
        assert_response :success
      end
      assert_equal "Deep", document.display_title
      assert_equal "Deep", DocumentSocialPreview.new(document).title

      post document_snapshot_path(document.slug), params: { content: }, as: :json
      assert_response :success
      assert_equal content, document.reload.content_snapshot

      post api_doc_suggestions_path(document.slug), params: { body: content }, as: :json, headers: { "X-Agent-Name" => "Scout" }
      assert_response :created
      assert_equal content, document.suggestions.sole.body
    end
  end

  test "a document shown as its source starts no editor and keeps its seed claim" do
    headers = BROWSER.merge("X-Inertia" => "true", "X-Inertia-Version" => InertiaController.safe_vite_digest.to_s)
    { ">" * 400 + " words" => true, ">" * 300 + " words" => false, DocumentPreviewHtml::TOO_COMPLEX_NOTICE => false }.each do |content, source_only|
      document = Document.create!(title: "Deep", seed_content: content)
      get document_mode_path(document.slug, "edit"), headers: headers
      assert_response :success
      props = response.parsed_body["props"]["document"]
      assert_equal source_only, props["source_only"]
      assert_equal !source_only, props["seed_granted"]
      assert_equal source_only ? "pending" : "claimed", document.reload.seed_state
    end
  end

  test "html that cannot be checked is refused with a reason and changes nothing" do
    deep = "#{"<blockquote>" * 1_000}words"
    assert_no_difference -> { Document.count } do
      post api_docs_path, params: { content: deep, format: "html" }, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal DocumentHtml::TooComplex::MESSAGE, response.parsed_body["error"]

    document = Document.create!(title: "Page", content_format: "html", seed_content: "<p>kept</p>")
    patch api_doc_path(document.slug), params: { content: deep }, as: :json
    assert_response :unprocessable_entity

    post api_doc_suggestions_path(document.slug), params: { body: deep }, as: :json, headers: { "X-Agent-Name" => "Scout" }
    assert_response :unprocessable_entity
    post document_suggestions_path(document.slug), params: { body: deep }
    assert_redirected_to document_page_path(document.slug)

    post document_snapshot_path(document.slug), params: { content: deep, state_vector: "AA==" }, as: :json
    assert_response :unprocessable_entity
    assert_equal DocumentHtml::TooComplex::MESSAGE, response.parsed_body["error"]

    assert_equal "<p>kept</p>", document.reload.current_content
    assert_empty document.suggestions
  end

  test "a raw HTML block at the size limit is bounded too" do
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    html = DocumentPreviewHtml.call(format: "markdown", content: "<div>" * (Document::MAX_CONTENT_BYTES / 5))
    assert_includes html, DocumentPreviewHtml::TOO_COMPLEX_NOTICE
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 5
  end

  test "much raw HTML that is not deep still renders, with the same tags filtered" do
    content = "#{"<div>a</div><script>b</script>\n\n" * 5_000}<div>end</div>"
    assert_operator content.count("<") * content.bytesize, :>, 2_000_000_000
    html = DocumentPreviewHtml.call(format: "markdown", content:)
    assert_includes html, "&lt;script&gt;b"
    assert_not_includes html, DocumentPreviewHtml::TOO_COMPLEX_NOTICE
  end
end
