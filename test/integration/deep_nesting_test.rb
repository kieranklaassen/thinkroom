require "test_helper"

# Very deep nesting is handled: a document shows formatted or as its source, and
# what is stored stays exactly as it was sent.
class DeepNestingTest < ActionDispatch::IntegrationTest
  BROWSER = { "User-Agent" => "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" }.freeze
  LEVELS = [ 100, 399, 400, 500, 1_000, 5_000, 50_000 ].freeze

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
      test "#{format} #{name} have a preview, a text and a title" do
        LEVELS.product([ "", "words" ]).each do |levels, text|
          content = shape.call(levels, text)
          html, plain = within_a_request { [ DocumentPreviewHtml.call(format:, content:), DocumentPlainText.call(format:, content:) ] }
          DocumentPreviewHtml.block_count(html)
          DocumentTitle.call(format:, content:)
          assert_includes html + plain, text unless name == "images" # alt text only
          assert_operator html.bytesize, :<, 8.megabytes
        end
      end
    end
  end

  test "a document shows formatted or as its source" do
    formatted = DocumentPreviewHtml.call(format: "markdown", content: "#{">" * 396} words")
    assert_includes formatted, "<blockquote>"
    assert_not_includes formatted, DocumentPreviewHtml::TOO_COMPLEX_NOTICE

    source = DocumentPreviewHtml.call(format: "markdown", content: "#{">" * 400} a <b> & c")
    assert_equal "<p><em>#{DocumentPreviewHtml::TOO_COMPLEX_NOTICE}</em></p>" \
                 "<pre><code>#{"&gt;" * 400} a &lt;b&gt; &amp; c</code></pre>", source
    assert_equal 3, DocumentPreviewHtml.block_count(source)
  end

  test "a source with a null character has a text" do
    assert_includes DocumentPlainText.call(format: "markdown", content: "#{">" * 400} a\0b"), "a\uFFFDb"
  end

  test "an element with many attributes shows as its source" do
    content = "<p #{(1..500).map { |i| "a#{i}=1" }.join(" ")}>words</p>"
    assert_includes DocumentPreviewHtml.call(format: "html", content:), DocumentPreviewHtml::TOO_COMPLEX_NOTICE
    assert_includes DocumentPlainText.call(format: "html", content:), "words"
  end

  test "a preview with table wrappers has a block count" do
    (380..400).each do |levels|
      html = DocumentPreviewHtml.call(format: "markdown", content: "#{">" * levels} | a |\n#{">" * levels} |---|")
      assert_kind_of Integer, DocumentPreviewHtml.block_count(html)
    end
  end

  test "another argument error is passed on" do
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
    formatted_like_source = "*#{DocumentPreviewHtml::TOO_COMPLEX_NOTICE}*\n\n```\nhi\n```"
    { formatted_like_source => false, ">" * 400 + " words" => true, ">" * 300 + " words" => false, DocumentPreviewHtml::TOO_COMPLEX_NOTICE => false }.each do |content, source_only|
      document = Document.create!(title: "Deep", seed_content: content)
      get document_mode_path(document.slug, "edit"), headers: inertia_headers
      assert_response :success
      props = response.parsed_body["props"]["document"]
      assert_equal source_only, props["source_only"]
      assert_equal !source_only, props["seed_granted"]
      assert_equal source_only ? "pending" : "claimed", document.reload.seed_state
    end
  end

  test "html over the limits gets a reason and the document stays as it is" do
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
    get document_page_path(document.slug), headers: inertia_headers
    assert_equal DocumentHtml::TooComplex::MESSAGE, response.parsed_body.dig("props", "errors", "suggestion")

    post document_snapshot_path(document.slug), params: { content: deep, state_vector: "AA==" }, as: :json
    assert_response :unprocessable_entity
    assert_equal DocumentHtml::TooComplex::MESSAGE, response.parsed_body["error"]
    assert_equal true, response.parsed_body["too_complex"]

    assert_equal "<p>kept</p>", document.reload.current_content
    assert_empty document.suggestions
  end

  test "a large raw HTML block reads depth first and shows as its source" do
    content = "<div>" * (Document::MAX_CONTENT_BYTES / "<div>".bytesize)
    filters = []
    renderer = DocumentPreviewHtml.method(:markdown_html)
    DocumentPreviewHtml.define_singleton_method(:markdown_html) do |source, tagfilter: true|
      filters << tagfilter
      renderer.call(source, tagfilter:)
    end
    assert_includes DocumentPreviewHtml.call(format: "markdown", content:), DocumentPreviewHtml::TOO_COMPLEX_NOTICE
    assert_equal [ false ], filters
  ensure
    DocumentPreviewHtml.define_singleton_method(:markdown_html, renderer)
    DocumentPreviewHtml.singleton_class.send(:private, :markdown_html)
  end

  test "much raw HTML reads depth first, then renders with the same tags filtered" do
    content = "#{"<div>a</div><script>b</script>\n\n" * 5_000}<div>end</div>"
    assert_operator content.count("<") * content.bytesize, :>, DocumentPreviewHtml.singleton_class::DEPTH_FIRST_SIZE
    html = DocumentPreviewHtml.call(format: "markdown", content:)
    assert_includes html, "&lt;script&gt;b"
    assert_not_includes html, DocumentPreviewHtml::TOO_COMPLEX_NOTICE
  end

  test "a deep Mermaid fence shows as source" do
    content = "#{">" * 400} words\n\n```mermaid\ngraph TD\n```"
    assert_includes DocumentPreviewHtml.call(format: "markdown", content:), DocumentPreviewHtml::TOO_COMPLEX_NOTICE
  end

  test "much raw HTML that names a filtered tag renders as the renderer renders it" do
    padding = "<div></div>\n" * 13_000
    [ "<textarea\f>\n#{"<div>" * 600}", "<svg>#{"<style>" * 600}" ].each do |block|
      content = "<div>\n#{block}\n#{padding}"
      assert_operator content.count("<") * content.bytesize, :>, DocumentPreviewHtml.singleton_class::DEPTH_FIRST_SIZE
      assert_nothing_raised { HtmlDocumentSanitizer.snapshot(DocumentPreviewHtml.send(:markdown_html, content)) }
      assert_not DocumentPreviewHtml.source?(DocumentPreviewHtml.call(format: "markdown", content:), content)
    end
  end

  test "a deep snapshot with live edits after it opens the editor with the live document" do
    document = Document.create!(title: "Deep", seed_content: "words", content_snapshot: ">" * 400 + " old")
    get document_mode_path(document.slug, "edit"), headers: inertia_headers
    assert response.parsed_body.dig("props", "document", "source_only")

    ydoc = Y::Doc.new
    ydoc.get_text("t") << "newer"
    YjsPersistence.merge(document, Base64.strict_encode64(ydoc.encode_state_as_update))
    [ -> { }, -> { YjsPersistence.fold!(document.reload) } ].each do |step|
      step.call
      get document_mode_path(document.slug, "edit"), headers: inertia_headers
      props = response.parsed_body.dig("props", "document")
      assert_equal [ true, false ], props.values_at("source_preview", "source_only")
      assert_includes props["content_html"], "old"
    end
    assert_predicate document.reload, :live_crdt?
    assert_not document.source_only?
    stored = Y::Doc.new
    stored.apply_update(Base64.strict_decode64(response.parsed_body.dig("props", "document", "yjs_state_b64")))
    assert_equal "newer", stored.get_text("t").to_s
  end

  test "an image in html over the limits is still claimed" do
    blob = ActiveStorage::Blob.create_and_upload!(io: StringIO.new("image"), filename: "a.png", content_type: "image/png", identify: false)
    asset = DocumentAsset.create!(uploader_name: "Scout", expires_at: 1.hour.from_now)
    asset.file.attach(blob)
    document = Document.create!(title: "Page", content_format: "html", seed_content: "<p>kept</p>")
    source = %(#{"<blockquote>" * 1_000}<img src="/rails/active_storage/blobs/redirect/#{blob.signed_id}/a.png">)

    DocumentAsset.claim_from_html!(document:, source:)

    assert_equal document, asset.reload.document
  end

  private

  def inertia_headers
    BROWSER.merge("X-Inertia" => "true", "X-Inertia-Version" => InertiaController.safe_vite_digest.to_s)
  end

  # What one page load does, it does within the time a request may take.
  def within_a_request(&)
    Timeout.timeout(20, &)
  end
end
